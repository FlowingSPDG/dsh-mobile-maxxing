/**
 * Focus zoom on a phone, measured in a real browser.
 *
 * iOS Safari zooms a focused text field whose computed font size is under
 * 16px and leaves the visual viewport offset there; the page then looks
 * "thrown" somewhere else until the user pinches back. The shipped stylesheet
 * guards every shipped field, but the guard is a single 16px declaration, and
 * a field that one-shot-zoomed keeps its zoom after the stylesheet changed.
 * This fixture boots the shipped client against the real composer markup and
 * asks the browser for the computed size of each field plus the visual
 * viewport state the plugin leaves behind.
 *
 *   CDP_PORT=9222 node tests/focus-zoom.e2e.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PORT = process.env.CDP_PORT || 9222;
const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/**
 * The composer's real shape: the draft editor is a contenteditable that only
 * carries `data-composer-input` (the composer stylesheet puts a 14px content
 * font size on the card and inherits it here), and the rename field is a bare
 * input inside a menu.
 */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --dsh-content-font-size: 14px; }
  html, body { margin: 0; height: 100%; background: #111; }
  .card { --dsh-content-font-size: 14px; font-size: var(--dsh-content-font-size); line-height: 24px; padding: 8px; }
  [contenteditable] { outline: none; min-height: 48px; color: #eee; }
  .rename { width: 200px; font-size: 14px; }
</style>
</head><body>
<div id="root"><div data-slot="root"><div data-app-frame>
  <div data-sidebar-col></div>
  <div data-rdsh-center-col>
    <div class="card" data-composer-card>
      <div data-composer-input contenteditable="true">draft</div>
    </div>
    <input class="rename" id="rename" type="text" value="session">
  </div>
</div></div></div>
</body></html>`;

async function connect(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let nextId = 0;
	const pending = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.id === undefined) return;
		const call = pending.get(message.id);
		pending.delete(message.id);
		if (call === undefined) return;
		if (message.error) call.reject(new Error(message.error.message));
		else call.resolve(message.result);
	};
	return {
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
	const frames = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");

	await send("Page.enable");
	await send("Runtime.enable");
	// A 390x844 phone screen at dpr 3 is the CSS geometry an iPhone 15 reports.
	await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
	await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
	await send("Page.addScriptToEvaluateOnNewDocument", {
		source: 'globalThis.__RDSH_DEVICE_MODE__ = "mobile";',
	});
	await send("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(FIXTURE)}` });
	await evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true)) })");

	const booted = await evaluate(`(() => {
  let definition = null;
  window.__ModuleLoader__ = { load(value) { definition = value; } };
  (0, eval)(${JSON.stringify(client)});
  if (definition === null) return { error: "the module did not register" };
  const noop = () => () => {};
  const ctx = {
    effect(fn) { const dispose = fn(); return typeof dispose === "function" ? dispose : () => {}; },
    inject(deps, callback) { return callback === undefined ? undefined : callback(ctx); },
    slots: { inject(deps, callback) { return typeof callback === "function" ? callback() : undefined; }, register() { return () => {}; }, entries() { return []; } },
    get() { return undefined; },
    on: noop,
    provide: noop,
  };
  definition.factory((name) => (name === "react" ? { createElement() {}, useState() { return [0, () => {}]; }, useEffect() {} } : {})).apply(ctx);
  return { error: null };
})()`);
	assert.equal(booted.error, null, `the client did not boot: ${booted.error}`);
	await frames();

	/** Computed field sizes plus the zoom state the page is left in. */
	const inspect = () => evaluate(`(() => {
  const fields = [...document.querySelectorAll('[data-composer-input], input, textarea, [contenteditable="true"]')];
  return {
    fields: fields.map((field) => ({
      kind: field.getAttribute("data-composer-input") !== null ? "composer" : field.tagName.toLowerCase(),
      fontSize: getComputedStyle(field).fontSize,
      textSizeAdjust: getComputedStyle(field).textSizeAdjust ?? getComputedStyle(field).webkitTextSizeAdjust,
    })),
    viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
    touchesAction: getComputedStyle(document.body).touchAction,
    focusZoomRendered: typeof CSS !== "undefined" && CSS.supports("selector(:has(*))"),
    attribute: document.documentElement.getAttribute("data-rdsh-focus-zoom"),
    scale: (() => {
      // What iOS does when it zooms: the visual viewport shrinks. Reading it
      // back is the only portable way to see whether a zoom is still latched.
      const view = window.visualViewport;
      return view === null ? null : { width: view.width, scale: view.scale ?? null };
    })(),
  };
})()`);

	const before = await inspect();
	result = { before };
	console.log(JSON.stringify(result, null, 2));

	// Every field a phone can focus must be at least 16px: that is the iOS
	// rule, and a single 16px on an `!important` rule is not the whole story
	// once a one-shot zoom has latched.
	const small = before.fields.filter((field) => Number.parseFloat(field.fontSize) < 16);
	assert.deepEqual(small, [], "a focusable field is below the 16px iOS zoom threshold");
	// A zoom latched before the guard cannot be undone by the stylesheet alone;
	// the plugin has to notice and undo it.
	assert.equal(before.attribute, null, "no focus-zoom state is published");
} finally {
	page?.close();
	if (browser !== null) {
		if (targetId !== null) await browser.send("Target.closeTarget", { targetId }).catch(() => {});
		if (browserContextId !== null) await browser.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
		browser.close();
	}
}
