/**
 * The real app: the phone drawer and the composer, driven in a browser.
 *
 * Every other fixture in this suite is a shape this package wrote down. This
 * one boots the shipped DSH client — all of its plugins, from a running
 * server, through `tests/tools/dsh-proxy.mjs` — and looks at what the plugin
 * did to the live app frame: where the drawer sits, what a tap outside it
 * hits, and how large the composer's fields render.
 *
 *   DSH_UPSTREAM=http://127.0.0.1:3099 CDP_PORT=9222 node tests/live-app.e2e.mjs
 *
 * By default the live server's own `dsh-mobile-maxxing/client.js` is what
 * runs: the assertion is about the build that server serves. Set
 * `LOCAL_CLIENT=1` to answer that one request with the working-tree
 * `client.js` instead, for checking a change before it is installed.
 *
 * Creates its own incognito browser context and page target and disposes both
 * in a `finally`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PORT = process.env.CDP_PORT || 9222;
const BASE = (process.env.DSH_UPSTREAM || "http://127.0.0.1:3099").replace(/\/$/u, "");
const LOCAL_CLIENT = process.env.LOCAL_CLIENT === "1";
const localClient = LOCAL_CLIENT ? readFileSync(new URL("../client.js", import.meta.url), "utf8") : null;

async function connect(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let nextId = 0;
	const pending = new Map();
	const listeners = new Set();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.id === undefined) {
			for (const listener of listeners) void listener(message);
			return;
		}
		const call = pending.get(message.id);
		pending.delete(message.id);
		if (call === undefined) return;
		if (message.error) call.reject(new Error(message.error.message));
		else call.resolve(message.result);
	};
	return {
		on(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		send(method, params = {}) {
			const id = ++nextId;
			socket.send(JSON.stringify({ id, method, params }));
			return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
		},
		close() {
			try {
				socket.close();
			} catch {
				/* already closed */
			}
		},
	};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `expression` is truthy, or fail with the last value seen. */
async function waitFor(evaluate, expression, timeout = 30_000, interval = 250) {
	const started = Date.now();
	let value;
	while (Date.now() - started < timeout) {
		value = await evaluate(expression);
		if (value) return value;
		await sleep(interval);
	}
	throw new Error(`timed out waiting for: ${expression} (last value ${JSON.stringify(value)})`);
}

// A live server is required; skip (not fail) when there is none.
try {
	const probe = await fetch(`${BASE}/sw.js`, { signal: AbortSignal.timeout(5000) });
	assert.equal(probe.ok, true, `${BASE}/sw.js must be reachable`);
} catch (error) {
	console.error(`SKIP live-app.e2e: no DSH server at ${BASE} (${error.message})`);
	console.error("start one with: DSH_UPSTREAM=http://<host:port> node tests/tools/dsh-proxy.mjs");
	process.exit(2);
}

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
assert.ok(version.webSocketDebuggerUrl, "the CDP browser endpoint is required (CDP_PORT)");

let result = null;
let browser = null;
let page = null;
let browserContextId = null;
let targetId = null;
try {
	browser = await connect(version.webSocketDebuggerUrl);
	({ browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: false }));
	({ targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId }));
	const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
	page = await connect(targets.find((entry) => entry.id === targetId && entry.type === "page").webSocketDebuggerUrl);

	const send = page.send;
	const evaluate = async (expression) => {
		const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (response.exceptionDetails) {
			throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response.result.value;
	};

	await send("Page.enable");
	await send("Runtime.enable");
	// The plugin is served as a `plugins/??…` combo, so the pattern matches the
	// whole route rather than one file name.
	await send("Fetch.enable", { patterns: [{ urlPattern: "*/plugins/*", requestStage: "Request" }] });
	const failures = [];
	page.on(async (message) => {
		if (message.method === "Fetch.requestPaused") {
			const { requestId, request } = message.params;
			if (LOCAL_CLIENT && /dsh-mobile-maxxing\/client\.js/u.test(request.url)) {
				await send("Fetch.fulfillRequest", {
					requestId,
					responseCode: 200,
					responseHeaders: [{ name: "content-type", value: "text/javascript; charset=utf-8" }, { name: "cache-control", value: "no-store" }],
					body: Buffer.from(localClient, "utf8").toString("base64"),
				}).catch(() => {});
			} else {
				await send("Fetch.continueRequest", { requestId }).catch(() => {});
			}
			return;
		}
		if (message.method === "Runtime.exceptionThrown") {
			failures.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "exception");
		}
	});

	// A phone screen at dpr 3, with the user agent a real iPhone sends: the
	// host bootstrap reads it, and that is what selects the mobile surface.
	await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
	await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
	const phoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
	await send("Network.enable");
	await send("Network.setUserAgentOverride", { userAgent: phoneUA });

	await send("Page.navigate", { url: `${BASE}/` });
	await evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true)) })");
	await waitFor(evaluate, "typeof globalThis.__RDSH_MOBILE_UX__ === 'object'", 60_000);
	await waitFor(evaluate, "document.querySelector('[data-app-frame]') !== null", 30_000);
	// The plugin decorates on a coalesced animation frame; two frames plus the
	// drawer's 300ms slide is enough for every hook and transition to settle.
	await sleep(1200);

	const boot = await evaluate(`(() => ({
  mode: globalThis.__RDSH_MOBILE_UX__?.mode ?? null,
  drawer: document.documentElement.getAttribute("data-rdsh-drawer"),
  frame: document.querySelector("[data-app-frame]") !== null,
  slot: document.querySelector('[data-slot="sidebar"]') !== null,
  client: (globalThis.__DSH_BOOT__?.entries ?? []).find((entry) => entry.id === "dsh-mobile-maxxing")?.url ?? null,
}))()`);
	assert.equal(boot.mode, "mobile", "the phone user agent must select the mobile surface");
	assert.equal(boot.frame, true, "the live app frame was not found");
	assert.notEqual(boot.client, null, "the plugin is not part of the live boot graph");

	/**
	 * The drawer, the chat column and the composer, asked of the live DOM.
	 *
	 * `sheet` is the drawer's occupied box (the lift's own layer, or the
	 * sidebar column when the layout did not lift it). `center` is the
	 * conversation column. `probe` is a point the sheet cannot cover on this
	 * 390px screen, used to see whether a tap dismisses the drawer.
	 */
	const inspect = () => evaluate(`(() => {
  const layers = [...document.querySelectorAll("[data-rdsh-drawer-layer]")];
  const layer = layers.find((node) => node.getBoundingClientRect().width > 0) ?? layers[0] ?? null;
  const sheet = layer === null ? document.querySelector("[data-sidebar-col]") : (layer.firstElementChild ?? layer);
  const backdrop = document.querySelector(".rdsh-mux-backdrop");
  const center = document.querySelector("[data-rdsh-center-col]");
  const rectOf = (node) => {
    if (node === null || node === undefined) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) };
  };
  const fields = [...document.querySelectorAll('[data-composer-input], [contenteditable="true"], input:not([type=hidden]), textarea')]
    .filter((field) => {
      const box = field.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })
    .map((field) => ({
      kind: field.hasAttribute("data-composer-input") ? "composer" : field.tagName.toLowerCase(),
      label: field.getAttribute("aria-label") ?? "",
      fontSize: getComputedStyle(field).fontSize,
    }));
  // A point the sheet cannot cover: just inside the screen edge, at mid height
  // (the sheet is narrower than the phone).
  const x = innerWidth - 8;
  const y = Math.round(innerHeight / 2);
  const hit = document.elementFromPoint(x, y);
  return {
    drawer: document.documentElement.getAttribute("data-rdsh-drawer"),
    sheet: rectOf(sheet),
    layer: rectOf(layer),
    center: rectOf(center),
    backdropDisplay: backdrop === null ? null : getComputedStyle(backdrop).display,
    hit: hit === null ? null : (hit === backdrop ? ".rdsh-mux-backdrop" : hit.tagName.toLowerCase()),
    probe: { x, y },
    fields,
  };
})()`);

	const before = await inspect();

	/**
	 * The drawer's way in, whichever drawer the page runs.
	 *
	 * A host that ships its own smartphone presentation draws the toggle in
	 * the conversation header (`[data-mobile-menu]`); this plugin then retires
	 * its floating button so there are not two ways in. An older host has no
	 * such drawer, and this plugin's button is the way in.
	 */
	const entry = await evaluate(`(() => {
  const hostToggle = document.querySelector("[data-mobile-menu]");
  if (hostToggle !== null) {
    hostToggle.click();
    return { by: "host", ok: true };
  }
  const fab = document.querySelector(".rdsh-mux-fab");
  if (fab === null) return { by: "none", ok: false };
  fab.click();
  return { by: "plugin", ok: true };
})()`);
	assert.equal(entry.ok, true, "no drawer button was found on the live app");
	await sleep(700);
	const opened = await inspect();
	assert.equal(opened.drawer, "open", `the ${entry.by} drawer button did not open the drawer on the live app`);
	assert.equal(opened.sheet?.x, 0, `the open drawer must start at the left edge; it started at ${opened.sheet?.x}px`);

	// 2. The way out: a real touch on the uncovered part of the screen.
	await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: opened.probe.x, y: opened.probe.y }] });
	await sleep(60);
	await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await sleep(700);
	const closed = await inspect();
	assert.equal(closed.drawer, "closed", "a tap outside the drawer did not close it on the live app");
	assert.ok(closed.sheet !== null && closed.sheet.x < -280, `the closed drawer must be parked off-screen; it sat at ${closed.sheet?.x}px`);

	// 3. The composer: every field is at or above the iOS focus-zoom threshold.
	const small = closed.fields.filter((field) => Number.parseFloat(field.fontSize) < 16);
	assert.deepEqual(small, [], "a composer field renders below the 16px iOS zoom threshold");
	assert.ok(closed.fields.some((field) => field.kind === "composer"), "the composer editor was not found on the live app");

	assert.deepEqual(failures, [], "the live app threw while the drawer was exercised");
	result = { boot, before, opened, closed, failures };
	console.log(JSON.stringify(result, null, 2));
} finally {
	page?.close();
	if (browser !== null) {
		if (targetId !== null) await browser.send("Target.closeTarget", { targetId }).catch(() => {});
		if (browserContextId !== null) await browser.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
		browser.close();
	}
}
