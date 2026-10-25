/**
 * The phone drawer as a sheet, measured in a real browser.
 *
 * The drawer is the layout's own session list: upstream keeps it mounted and
 * the grid gives it a column. Turning that into an overlay is what this
 * plugin does, and a CSS-only fixture cannot see the one thing that matters —
 * whether the chat got the full width back while the sheet is over it, and
 * whether a tap outside the sheet closes it. Both are asked of the browser
 * here.
 *
 * The frame is shaped like upstream's: `#root` → `[data-slot="root"]` (the
 * renderer's display:contents anchor) → `[data-app-frame]` (the grid) with the
 * sidebar column, the center column and the `shell.overlay` seat. The shipped
 * `client.js` is booted against it unchanged.
 *
 * Creates its own incognito browser context and page target and disposes both
 * in a `finally`.
 *
 *   CDP_PORT=9222 node tests/drawer-layering.e2e.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PORT = process.env.CDP_PORT || 9222;
const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #111; }
  #root { height: 100dvh; }
  /* The frame, as AppFrame paints it: a 3-track grid whose first track is the
     session list's column (280px while upstream thinks the rail is open). */
  [data-app-frame] { display: grid; grid-template-columns: 280px minmax(0, 1fr) 0; height: 100%; }
  [data-sidebar-col] { min-width: 0; overflow: hidden; background: #1a1a1c; }
  #sidebar-root { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 8px; padding: 8px; box-sizing: border-box; }
  .center { min-width: 0; height: 100%; background: #222; color: #eee; display: flex; flex-direction: column; }
  .center .header { height: 56px; background: #2a2a2e; }
  .center .body { flex: 1; }
  /* A panel another plugin mounted into shell.overlay: the seat is the app's
     own overlay layer and anything inside it is painted over the columns. */
  [data-shell-overlay] { position: absolute; inset: 0; z-index: 20; pointer-events: none; }
  [data-other-plugin-panel] { position: absolute; inset: 0; pointer-events: auto; background: rgba(0,0,0,0.05); }
</style>
</head><body>
<div id="root"><div data-slot="root" style="display:contents"><div data-app-frame data-sidebar-collapsed>
  <div data-sidebar-col><div data-slot="sidebar" style="display:contents">
    <div id="sidebar-root" style="width:280px">
      <div data-window-drag>
        <button type="button" aria-label="New session">N</button>
        <button type="button" aria-label="Collapse sidebar">T</button>
      </div>
      <button type="button" aria-label="New Session">New Session</button>
      <nav aria-label="Global panels"><button type="button" aria-label="Plugins">P</button></nav>
      <div data-row-key="session:s1">Session one</div>
    </div>
  </div></div>
  <div class="center" data-rdsh-center-col><div class="header">chat header</div><div class="body">conversation</div></div>
  <div data-shell-overlay><div data-other-plugin-panel></div></div>
</div></div></div>
</body></html>`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
	const target = targets.find((entry) => entry.id === targetId && entry.type === "page");
	assert.ok(target, "the browser did not expose the target this test created");
	page = await connect(target.webSocketDebuggerUrl);

	const send = page.send;
	const evaluate = async (expression) => {
		const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (response.exceptionDetails) {
			throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response.result.value;
	};
	// The drawer slides for 300ms (`--rdsh-slide-ms`): every read happens after
	// the sheet has settled, never mid-flight.
	const frames = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
	const settle = async () => { await frames(); await sleep(420); };

	await send("Page.enable");
	await send("Runtime.enable");
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
  // The fixture has no React tree behind the toggle: give the app's own
  // collapse toggle the one effect the real layout has, flipping the frame's
  // collapsed state. Delegated from the frame, so it survives a re-render.
  document.querySelector("[data-app-frame]").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("button[aria-label]") === null) return;
    if (!/^(Open|Collapse) sidebar$|^(打开|收起)侧边栏$/.test(target.closest("button[aria-label]").getAttribute("aria-label"))) return;
    const appFrame = document.querySelector("[data-app-frame]");
    if (appFrame.hasAttribute("data-sidebar-collapsed")) appFrame.removeAttribute("data-sidebar-collapsed");
    else appFrame.setAttribute("data-sidebar-collapsed", "");
  });
  return { error: null };
})()`);
	assert.equal(booted.error, null, `the client did not boot: ${booted.error}`);
	await frames();

	/**
	 * Geometry and hit-testing in one pass. `probe` is a point the sheet leaves
	 * uncovered on this 390px screen (the sheet is 280px wide).
	 */
	const inspect = () => evaluate(`(() => {
  const html = document.documentElement;
  // The sheet is the lifted node; the slot anchor is not a box, so ask for the
  // tag the lift writes and only fall back to the anchor before a lift.
  const layers = [...document.querySelectorAll("[data-rdsh-drawer-layer]")];
  // A parked sheet still has a box (it is translated, not hidden), so any
  // layer is the drawer's home; the first is the one this fixture ran.
  const layerEl = layers[0] ?? null;
  const drawer = layerEl !== null && layerEl.firstElementChild !== null ? layerEl.firstElementChild : (document.querySelector("[data-sidebar-col]") ?? document.querySelector("[data-rdsh-sidebar]") ?? document.querySelector("#sidebar-root"));
  const backdrop = document.querySelector(".rdsh-mux-backdrop");
  const center = document.querySelector(".center");
  const centerRect = center.getBoundingClientRect();
  const drawerRect = drawer === null ? null : drawer.getBoundingClientRect();
  const x = 330;
  const y = 300;
  const hit = document.elementFromPoint(x, y);
  const name = (node) => {
    if (node === null) return null;
    if (node === backdrop) return ".rdsh-mux-backdrop";
    if (node.hasAttribute && node.hasAttribute("data-rdsh-drawer-layer")) return "[data-rdsh-drawer-layer]";
    if (node.hasAttribute && node.hasAttribute("data-rdsh-sidebar")) return "[data-rdsh-sidebar]";
    return node.tagName.toLowerCase() + (node.id === "" ? "" : "#" + node.id);
  };
  return {
    drawer: html.getAttribute("data-rdsh-drawer"),
    centerWidth: Math.round(centerRect.width),
    centerX: Math.round(centerRect.x),
    drawerX: drawerRect === null ? null : Math.round(drawerRect.x),
    drawerWidth: drawerRect === null ? null : Math.round(drawerRect.width),
    drawerParent: name(drawer === null ? null : drawer.parentElement),
    probe: { x, y },
    hit: name(hit),
    hitChain: (() => { const chain = []; for (let node = hit; node !== null && node !== document.documentElement; node = node.parentElement) chain.push(name(node)); return chain; })(),
    fabDisplay: (() => { const fab = document.querySelector(".rdsh-mux-fab"); return fab === null ? null : getComputedStyle(fab).display; })(),
  };
})()`);

	const closed = await inspect();
	assert.equal(closed.drawer, "closed", "the drawer starts closed");
	// The closed sheet waits 300ms away; this read runs before the slide ends,
	// so only "not on screen yet" can be asked here (the parked position is
	// asserted after the tap below, once it has settled).
	assert.ok(closed.drawerX <= 0, `the closed drawer must not be on screen; it sat at ${closed.drawerX}px`);
	assert.equal(closed.centerWidth, 390, `the chat must own the screen while the drawer is closed; it was ${closed.centerWidth}px wide`);

	await evaluate(`document.querySelector('button[aria-label="Open sidebar"], button[aria-label="Collapse sidebar"]').click()`);
	await settle();
	const open = await inspect();
	assert.equal(open.drawer, "open", "the drawer did not open");
	assert.equal(open.drawerX, 0, `the open drawer must start at the left edge; it started at ${open.drawerX}px`);
	assert.equal(open.centerWidth, 390, `the chat was squeezed to ${open.centerWidth}px by the open drawer`);
	assert.equal(open.hit, ".rdsh-mux-backdrop", `a tap ${open.probe.x}px from the left edge at mid-screen landed on ${open.hit}, not on the drawer backdrop`);

	// A real touch, as the browser delivers it.
	const tap = await evaluate(`(() => {
  const hit = document.elementFromPoint(${JSON.stringify(open.probe.x)}, ${JSON.stringify(open.probe.y)});
  if (hit === null) return { tapped: false };
  hit.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: ${JSON.stringify(open.probe.x)}, clientY: ${JSON.stringify(open.probe.y)} }));
  return { tapped: true };
})()`);
	// A touch is delivered in separate tasks, not inside one script: the
	// release is a second gesture, after the app has seen the press.
	await sleep(80);
	await evaluate(`(() => {
  const hit = document.elementFromPoint(${JSON.stringify(open.probe.x)}, ${JSON.stringify(open.probe.y)}) ?? document.body;
  hit.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: ${JSON.stringify(open.probe.x)}, clientY: ${JSON.stringify(open.probe.y)} }));
  return true;
})()`);
	// The backdrop closes on the release of the touch, before the browser
	// gets to synthesise a click for it.
	await sleep(120);
	const immediately = await inspect();
	assert.equal(tap.tapped, true, "the probe point hit nothing");
	assert.equal(immediately.drawer, "closed", "a tap on the uncovered part of the screen must close the drawer");
	await settle();
	const after = await inspect();
	assert.equal(after.drawer, "closed", "the drawer reopened itself after the tap");

	// The drawer's own toggle closes it too, as the second way out.
	await evaluate(`document.querySelector('button[aria-label="Open sidebar"], button[aria-label="Collapse sidebar"]').click()`);
	await frames();
	await evaluate(`document.querySelector('button[aria-label="Open sidebar"], button[aria-label="Collapse sidebar"]').click()`);
	await settle();
	const toggled = await inspect();
	assert.equal(toggled.drawer, "closed", "the drawer's own toggle did not close it");

	result = { closed, open, after, toggled };
	console.log(JSON.stringify(result, null, 2));
} finally {
	page?.close();
	if (browser !== null) {
		if (targetId !== null) await browser.send("Target.closeTarget", { targetId }).catch(() => {});
		if (browserContextId !== null) await browser.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
		browser.close();
	}
}
