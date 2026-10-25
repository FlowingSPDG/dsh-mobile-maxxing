window.__ModuleLoader__.load({
  id: "dsh-mobile-maxxing",
  factory(require) {
    // dsh-mobile-maxxing — browser half.
    //
    // One module carries three behaviours that used to be separate plugins:
    // the PWA shell, the mobile-device UX, and the session-id copy row.
    // They ship together because the client module system maps one package to
    // one browser module: a package cannot register several.
    //
    // Each part below is the body of what was its own plugin, unchanged. The
    // parts are independent — each returns its own `{ inject, apply }`, and
    // `apply` at the bottom runs them in order.
    //
    // Nothing here depends on a build step: this file is loaded verbatim by
    // the client module loader.
    // ---------------------------------------------------------------------
    // UI copy
    //
    // The host half injects one dictionary (lib/copy.js) into the index and
    // into the service-worker config, so the strings this package renders have
    // a single source. A future Japanese pack fills COPY.ja: every lookup
    // falls back to English per key, so a partial pack is safe.
    // ---------------------------------------------------------------------
    const COPY = globalThis.__RDSH_PWA_COPY__ ?? { en: {}, ja: {} };
    /** Upstream label vocabularies (never rendered), for language-independent matching. */
    const PROBES = globalThis.__RDSH_PWA_PROBES__ ?? {};

    /** One normalised language this dictionary can render, or "". */
    function knownLang(value) {
      const lang = String(value ?? "").toLowerCase().split("-")[0];
      return lang !== "" && COPY[lang] !== undefined ? lang : "";
    }

    /**
     * The language chosen for this device's mobile UI, or "" when this device
     * follows the shared/browser locale. Set only after the desktop gate in the
     * mobile half; the copy lookup above must see it before the host global.
     */
    let localDisplayLanguage = "";
    /** The shared DSH locale, tracked so "System" copy follows the shell. */
    let localDisplayHostLanguage = "";

    /**
     * The language host injected for this page, then the document language,
     * then English.
     *
     * `index.js` sets `globalThis.__RDSH_PWA_LANG__` from its own `lang`
     * option (ja by default). That independent value is what makes the
     * reference Japanese UI appear even when the shell document stays
     * `lang="en"`, and an explicit en must win over a ja shell in the same
     * way. The document language is only the fallback for a host that did not
     * inject the global.
     */
    function currentLang() {
      // A device-local display language wins. If the selected DSH locale has
      // no copy pack in this package (for example zh), render English rather
      // than inventing a partial translation; the DSH UI itself still follows
      // the selected locale.
      const local = knownLang(localDisplayLanguage);
      if (local !== "") return local;
      if (localDisplayLanguage !== "") return "en";
      // With a locale service, "System" means the shared DSH UI language, not
      // the host's independent ja-by-default copy global.
      const host = knownLang(localDisplayHostLanguage);
      if (host !== "") return host;
      if (localDisplayHostLanguage !== "") return "en";
      return knownLang(globalThis.__RDSH_PWA_LANG__)
        || knownLang(document.documentElement.lang)
        || "en";
    }

    /**
     * One UI string, falling back to English and then to the key itself.
     *
     * @param {string} key - a key from lib/copy.js.
     * @param {object} [params] - values for `{name}` placeholders.
     * @returns {string}
     */
    function t(key, params) {
      const localized = COPY[currentLang()];
      const value = localized !== null && localized !== undefined
        && typeof localized[key] === "string" && localized[key] !== ""
        ? localized[key]
        : COPY.en?.[key];
      if (typeof value !== "string") return key;
      if (params === undefined || params === null) return value;
      return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    /** Probe labels, or the English fallbacks when the host sent no dictionary. */
    function probeValues(key, fallback) {
      if (Array.isArray(PROBES[key]) && PROBES[key].length > 0) return PROBES[key];
      if (fallback === undefined) return [];
      return Array.isArray(fallback) ? fallback : [fallback];
    }

    /**
     * A regex over one probe vocabulary, or null when nothing is known.
     *
     * @param {string} key - a PROBES entry.
     * @param {string} [flags] - regex flags.
     * @param {string|string[]} [fallback] - English labels when PROBES is absent.
     * @param {boolean} [exact] - anchor to a whole label instead of a substring.
     */
    function probeRegex(key, flags = "i", fallback, exact = false) {
      const values = probeValues(key, fallback);
      if (values.length === 0) return null;
      const source = values.join("|");
      return new RegExp(exact ? `^(?:${source})$` : source, flags);
    }

    const cssValue = (value) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');

    /** A CSS attribute selector for one probe vocabulary. */
    function ariaLabelSelector(tag, key, fallback) {
      return probeValues(key, fallback).map((value) => `${tag}[aria-label="${cssValue(value)}"]`).join(", ");
    }

    /** A CSS "aria-label contains" selector for one probe vocabulary. */
    function ariaContainsSelector(tag, key, fallback) {
      return probeValues(key, fallback).map((value) => `${tag}[aria-label*="${cssValue(value)}"]`).join(", ");
    }

    /**
     * Merge `<meta name="viewport">` directives without duplicating a key.
     *
     * The host's early head does not touch the viewport (the stock meta is
     * parsed later, and a second one must not appear), so the mobile half owns
     * the value. Unknown tokens the page already carries are kept: only the
     * keys in `wanted` are replaced, and each key appears once.
     */
    function viewportContent(current, wanted) {
      const order = [];
      const values = new Map();
      for (const token of String(current ?? "").split(",")) {
        const trimmed = token.trim();
        if (trimmed === "") continue;
        const at = trimmed.indexOf("=");
        const key = (at === -1 ? trimmed : trimmed.slice(0, at)).trim().toLowerCase();
        if (key === "" || values.has(key)) continue;
        values.set(key, trimmed);
        order.push(key);
      }
      for (const [key, value] of Object.entries(wanted)) {
        if (!values.has(key)) order.push(key);
        values.set(key, value);
      }
      return order.map((key) => values.get(key)).join(", ");
    }

    // ---------------------------------------------------------------------

    // Device mode: the host bootstrap decides it once, this bundle consumes it.
    //
    // The canonical value is `globalThis.__RDSH_DEVICE_MODE__` (a string).
    // If it is missing or invalid, a valid `html[data-rdsh-device-mode]` is the
    // fallback; if neither is valid, the mode is desktop (fail closed). The
    // host's single classifier writes both before this module runs. This half
    // never re-classifies from UA, width, pointer or touch points, and a resize
    // never changes the mode.
    const NARROW_QUERY = "(max-width: 767px)";

    function readDeviceMode() {
      try {
        const injected = globalThis.__RDSH_DEVICE_MODE__;
        if (typeof injected === "string" && (injected === "mobile" || injected === "desktop")) return injected;
        const attr = document !== null && document !== undefined && document.documentElement !== null && document.documentElement !== undefined
          ? document.documentElement.getAttribute("data-rdsh-device-mode")
          : null;
        if (attr === "mobile" || attr === "desktop") return attr;
      } catch (error) {
        /* a broken bootstrap is the same as an absent one */
      }
      return "desktop";
    }

    const DEVICE_MODE = readDeviceMode();

    // Desktop must keep the upstream UI: do not build or apply any plugin part.
    if (DEVICE_MODE !== "mobile") return { apply() {} };

    // Keep the DOM marker in step with the value this bundle will use. This is
    // propagation of the host decision, not a second classifier.
    try {
      if (document !== null && document !== undefined && document.documentElement !== null && document.documentElement !== undefined) {
        document.documentElement.setAttribute("data-rdsh-device-mode", DEVICE_MODE);
      }
    } catch (error) {
      /* a document without documentElement only affects the CSS hook */
    }

    // Shared clipboard + toast
    //
    // Two surfaces copy text: the session menu (its id) and the right-panel
    // file tree (a path or a name). Both use the same secure-context path and
    // the same fallback, so there is one place where a failed clipboard is
    // handled.
    // ---------------------------------------------------------------------
    const TOAST_HOST_ID = "rdsh-session-id-copy-toast";
    const TOAST_ROOT_KEY = "__rdshSessionIdCopyToastRoot";

    async function copyText(text) {
      const clipboard =
        typeof navigator === "object" && navigator !== null ? navigator.clipboard : undefined;
      if (clipboard && typeof clipboard.writeText === "function") {
        try {
          await clipboard.writeText(text);
          return true;
        } catch (error) {
          // Permission denied or no focus: use the selection fallback below.
        }
      }
      let area;
      try {
        area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.top = "0";
        area.style.left = "0";
        area.style.width = "1px";
        area.style.height = "1px";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        area.setSelectionRange(0, text.length);
        return typeof document.execCommand === "function" && document.execCommand("copy") === true;
      } catch (error) {
        return false;
      } finally {
        area?.remove();
      }
    }

    // One body portal, one root per page: a live reload must not stack roots.
    function notify(text) {
      try {
        const React = require("react");
        const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
        const { createRoot } = require("react-dom/client");
        let host = document.getElementById(TOAST_HOST_ID);
        if (host === null) {
          host = document.createElement("div");
          host.id = TOAST_HOST_ID;
          document.body.appendChild(host);
        }
        const root = (window[TOAST_ROOT_KEY] = window[TOAST_ROOT_KEY] ?? createRoot(host));
        root.render(
          React.createElement(primitives.Toast, {
            text,
            tone: "success",
            onDone: () => {
              root.render(null);
            },
          }),
        );
      } catch (error) {
        // The copy itself already succeeded; a missing toast is not fatal.
      }
    }

    // ---------------------------------------------------------------------
    // dsh-mobile-maxxing — PWA shell: manifest, service worker, install prompt, notification transport.
    // ---------------------------------------------------------------------
    function pwaPart() {

    // dsh-mobile-maxxing — browser half.
    //
    // Makes the DSH Web GUI behave like an app: registers the app-shell service
    // worker (offline launch + static-asset caching), surfaces the install
    // prompt in the sidebar and in Settings, offers a reload when a new build
    // is waiting, reports the offline state, and insets the layout for notches
    // and home indicators when launched standalone.
    //
    // The host half (index.js) serves /manifest.webmanifest, /sw.js and the
    // icons, and adds viewport-fit=cover to the index. Nothing here depends on
    // a build step: this file is loaded verbatim by the client module loader.
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    const SCOPE = new URL("./", document.baseURI);
    const SW_URL = new URL("sw.js", SCOPE).href;
    /** Script URL of the notification plugin's worker (see unifyWorker below). */
    const PUSH_WORKER_PATH = "/push/sw.js";
    const STYLE_ATTR = "data-dsh-mobile-maxxing-style";
    const ROOT_ATTR = "data-dsh-mobile-maxxing";
    const UPDATE_POLL_MS = 30 * 60 * 1000;
    const UPDATE_MIN_GAP_MS = 5 * 60 * 1000;
    const INSTALL_PROMPT_KEY = "dsh-mobile-maxxing:install-prompt-dismissed";
    const INSTALL_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

    const STANDALONE_QUERY = "(display-mode: standalone)";
    const FULLSCREEN_QUERY = "(display-mode: fullscreen)";
    const MINIMAL_QUERY = "(display-mode: minimal-ui)";

    function isStandalone() {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
      if (window.matchMedia(STANDALONE_QUERY).matches) return true;
      if (window.matchMedia(FULLSCREEN_QUERY).matches) return true;
      if (window.matchMedia(MINIMAL_QUERY).matches) return true;
      return navigator.standalone === true;
    }

    function isIos() {
      const ua = navigator.userAgent || "";
      const platform = navigator.platform || "";
      // A desktop-site iPhone keeps the Apple platform string while the UA
      // turns into a Macintosh one. The host classifier trusts platform for
      // the same reason; the install hint must not lose those devices.
      if (/iPad|iPhone|iPod/.test(ua) || /iPad|iPhone|iPod/.test(platform)) return true;
      // iPadOS 13+ reports a desktop Mac UA; touch points give it away.
      return platform === "MacIntel" && navigator.maxTouchPoints > 1;
    }

    const CSS = `
html[data-dsh-mobile-maxxing="standalone"] #root {
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
}
html[data-dsh-mobile-maxxing="standalone"] { overscroll-behavior-y: none; }
html[data-dsh-mobile-maxxing="standalone"] body { overscroll-behavior-y: contain; }
html[data-dsh-mobile-maxxing="standalone"] .dsh-mobile-maxxing-toasts { top: calc(env(safe-area-inset-top, 0px) + 10px); }

/* Mobile devices: keep the toast column clear of the 64px sidebar header, and
   hang the install card on the right so the logo (session list) stays tappable.
   This is a device-mode rule, not a width rule: a tablet at 1024px keeps it. */
html[data-rdsh-device-mode="mobile"] .dsh-mobile-maxxing-toasts { top: calc(env(safe-area-inset-top, 0px) + 8px); padding-top: 56px; }
html[data-rdsh-device-mode="mobile"] .dsh-mobile-maxxing-install { align-self: flex-end; max-width: min(330px, calc(100vw - 24px)); flex-wrap: wrap; row-gap: 8px; }
html[data-rdsh-device-mode="mobile"] .dsh-mobile-maxxing-install .dsh-mobile-maxxing-card-text { flex: 1 1 100%; }
html[data-rdsh-device-mode="mobile"] .dsh-mobile-maxxing-install-actions { display: flex; gap: 8px; margin-left: auto; align-items: center; }

.dsh-mobile-maxxing-toasts {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 960; display: flex; flex-direction: column; align-items: center;
  gap: 8px; width: min(420px, calc(100vw - 24px)); pointer-events: none;
}
.dsh-mobile-maxxing-pill {
  pointer-events: none; padding: 6px 14px; border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform, #2a2a2e);
  color: var(--dsw-alias-label-secondary, #cfd3d6);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.35));
  font-size: 12px; line-height: 18px; white-space: nowrap;
}
.dsh-mobile-maxxing-card {
  pointer-events: auto; display: flex; align-items: center; gap: 10px;
  width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 14px;
  background: var(--dsw-alias-bg-module-platform, #2a2a2e);
  color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.35));
  font-size: 13px; line-height: 1.5;
}
.dsh-mobile-maxxing-card-text { flex: 1; min-width: 0; }
.dsh-mobile-maxxing-card button {
  font: inherit; font-size: 13px; cursor: pointer; border-radius: 999px;
  padding: 5px 12px; border: 0;
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh-mobile-maxxing-card button:hover { background: var(--dsw-alias-button-primary-hover, #5c78ff); }
.dsh-mobile-maxxing-card button.dsh-mobile-maxxing-quiet {
  background: transparent; color: var(--dsw-alias-label-secondary, #cfd3d6);
  padding: 5px 8px;
}
.dsh-mobile-maxxing-card button.dsh-mobile-maxxing-quiet:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }

.dsh-mobile-maxxing-foot {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 36px; min-width: 36px; padding: 0 10px; border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
  font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.dsh-mobile-maxxing-foot[data-wide="false"] { width: 36px; min-width: 36px; padding: 0; }
.dsh-mobile-maxxing-foot:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.dsh-mobile-maxxing-foot svg { flex: none; }

.dsh-mobile-maxxing-section { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary, #f9fafb); }
.dsh-mobile-maxxing-cardbox {
  border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(255,255,255,.12)));
  background: var(--dsw-alias-settings-card-fill, transparent);
  border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
}
.dsh-mobile-maxxing-title { margin: 0; font-size: 16px; font-weight: 500; }
.dsh-mobile-maxxing-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); }
.dsh-mobile-maxxing-rows { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; margin: 0; font-size: 13px; }
.dsh-mobile-maxxing-rows dt { color: var(--dsw-alias-label-secondary, #cfd3d6); }
.dsh-mobile-maxxing-rows dd { margin: 0; overflow-wrap: anywhere; }
.dsh-mobile-maxxing-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dsh-mobile-maxxing-actions button {
  font: inherit; font-size: 13px; min-height: 34px; padding: 0 14px; border-radius: 9px; cursor: pointer;
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
}
.dsh-mobile-maxxing-actions button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.dsh-mobile-maxxing-actions button.dsh-mobile-maxxing-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh-mobile-maxxing-actions button:disabled { opacity: .45; cursor: default; }
.dsh-mobile-maxxing-note { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); margin: 0; }
.dsh-mobile-maxxing-code { font-family: var(--dsh-font-family-code, monospace); font-size: 12px; }
`;

    // ---------------------------------------------------------------------
    // Store
    // ---------------------------------------------------------------------
    const state = {
      installable: false,
      standalone: isStandalone(),
      offline: typeof navigator.onLine === "boolean" ? !navigator.onLine : false,
      bootError: "",
      updateReady: false,
      updateDismissed: false,
      // pending | active | unsupported | insecure | error
      sw: "pending",
      swError: "",
      swScript: "",
      build: "",
      cache: "",
      ios: isIos(),
      mode: DEVICE_MODE,
      secure: typeof window.isSecureContext === "boolean" ? window.isSecureContext : false,
      installing: false,
      installDismissed: false,
    };
    const subscribers = new Set();
    // Small ring buffer for diagnostics (and for tests that drive the page).
    const transitions = [];
    function emit(patch, source) {
      Object.assign(state, patch);
      transitions.push({ at: Date.now(), patch, source: source ?? "" });
      if (transitions.length > 40) transitions.shift();
      for (const fn of subscribers) {
        try {
          fn();
        } catch {
          /* a broken subscriber must not stop the others */
        }
      }
    }
    function useStore() {
      const [, tick] = useState(0);
      useEffect(() => {
        const force = () => tick((n) => (n + 1) % 1000000);
        subscribers.add(force);
        return () => {
          subscribers.delete(force);
        };
      }, []);
      return state;
    }

    // ---------------------------------------------------------------------
    // Install prompt
    // ---------------------------------------------------------------------
    let installEvent = null;

    async function promptInstall() {
      if (installEvent === null) return "unavailable";
      const event = installEvent;
      installEvent = null;
      emit({ installable: false, installing: true });
      try {
        event.prompt();
        const choice = await event.userChoice;
        const outcome = choice && choice.outcome ? choice.outcome : "dismissed";
        // "accepted" installs the app but leaves this tab a tab: the standalone
        // state stays owned by the display-mode media query.
        if (outcome === "accepted") emit({ installable: false });
        return outcome;
      } catch {
        return "error";
      } finally {
        emit({ installing: false });
      }
    }

    // ---------------------------------------------------------------------
    // Service worker
    // ---------------------------------------------------------------------
    let registration = null;
    let updateRequested = false;
    let reloading = false;
    let lastUpdateCheck = 0;

    async function applyUpdate() {
      updateRequested = true;
      emit({ updateReady: false });
      try {
        const reg = registration ?? (await navigator.serviceWorker.getRegistration());
        if (reg !== null && reg !== undefined && reg.waiting !== null) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          // controllerchange reloads; keep a fallback for a worker that
          // already activated behind our back.
          setTimeout(() => {
            if (!reloading) location.reload();
          }, 1500);
          return;
        }
        location.reload();
      } catch {
        location.reload();
      }
    }

    async function checkForUpdate() {
      const now = Date.now();
      if (now - lastUpdateCheck < 3000) return;
      lastUpdateCheck = now;
      try {
        const reg = registration ?? (await navigator.serviceWorker.getRegistration());
        if (reg === null || reg === undefined) return;
        emit({}, "checked");
        await reg.update();
        const waiting = reg.waiting === null ? "" : reg.waiting.scriptURL;
        if (isOwnWorker(waiting) && navigator.serviceWorker.controller !== null) emit({ updateReady: true }, "check");
      } catch {
        /* offline or the server is restarting; the next poll retries */
      }
    }

    function watchRegistration(reg) {
      const note = () => {
        const waiting = reg.waiting === null ? "" : reg.waiting.scriptURL;
        if (isOwnWorker(waiting) && navigator.serviceWorker.controller !== null) emit({ updateReady: true }, "watch");
      };
      note();
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (installing === null) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") note();
        });
      });
    }

    async function pingWorker() {
      try {
        const reg = registration ?? (await navigator.serviceWorker.getRegistration());
        const worker = reg === null || reg === undefined ? null : reg.active;
        if (worker === null) return;
        const channel = new MessageChannel();
        const reply = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 1200);
          channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            resolve(event.data ?? null);
          };
        });
        worker.postMessage({ type: "PING" }, [channel.port2]);
        const data = await reply;
        if (data && typeof data === "object") emit({ build: String(data.build ?? ""), cache: String(data.cache ?? "") });
      } catch {
        /* the badge simply stays empty */
      }
    }

    /**
     * Whether a service worker script URL is this plugin's own worker.
     * @param {string|undefined} url
     * @returns {boolean}
     */
    function isOwnWorker(url) {
      if (typeof url !== "string" || url === "") return false;
      try {
        return new URL(url).pathname === new URL(SW_URL).pathname;
      } catch {
        return false;
      }
    }

    /**
     * Tolerate the notification plugin's null-subscription bug.
     *
     * `dsh-notify-push` reads `getSubscription()` and tests `!== undefined`, so
     * a browser returning null throws inside its controllerchange handler. The
     * redirection below hands it a registration whose `getSubscription()`
     * reports "no subscription" the way that code expects; every other member
     * passes through to the real object.
     *
     * @param {ServiceWorkerRegistration} registration
     * @returns {ServiceWorkerRegistration}
     */
    function tolerateNullSubscription(registration) {
      const manager = registration.pushManager;
      if (manager === undefined || manager === null) return registration;
      const pushManager = new Proxy(manager, {
        get(target, property) {
          if (property === "getSubscription") {
            return async () => (await target.getSubscription()) ?? undefined;
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return new Proxy(registration, {
        get(target, property) {
          if (property === "pushManager") return pushManager;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }

    /**
     * Redirect the notification plugin's worker registration to ours.
     *
     * A browser allows one controlling worker per scope, so `dsh-notify-push`
     * (registered at /push/sw.js with scope "/") and this plugin would keep
     * replacing each other on every controllerchange: the loser stays
     * "waiting", the offline cache never controls the page and the update
     * banner fires on a worker that is not an update. Our worker implements
     * that plugin's push/notificationclick contract, so pointing its
     * registration here keeps notifications working and leaves exactly one
     * worker in charge.
     *
     * The wrapper only rewrites that one script URL; every other registration
     * passes through untouched, and cleanup restores the original function.
     */
    function unifyWorker() {
      const prototype = Object.getPrototypeOf(navigator.serviceWorker);
      const nativeRegister = prototype.register;
      const patched = function register(url, options) {
        try {
          const resolved = new URL(String(url), document.baseURI);
          if (resolved.pathname.endsWith(PUSH_WORKER_PATH)) {
            return nativeRegister.call(this, SW_URL, { ...options, scope: SCOPE.pathname })
              .then(tolerateNullSubscription);
          }
        } catch {
          /* fall through to the untouched registration */
        }
        return nativeRegister.call(this, url, options);
      };
      prototype.register = patched;
      return () => {
        if (prototype.register === patched) prototype.register = nativeRegister;
      };
    }

    async function registerWorker() {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        emit({ sw: "unsupported" });
        return;
      }
      if (!state.secure) {
        emit({ sw: "insecure" });
        return;
      }
      try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (existing !== null && existing !== undefined) {
          const worker = existing.active ?? existing.waiting ?? existing.installing;
          const script = worker === null ? "" : worker.scriptURL;
          if (!isOwnWorker(script) && script.endsWith(PUSH_WORKER_PATH)) {
            // Replace the notification worker with the unified one. Its push
            // subscription is recreated by that plugin on controllerchange.
            await existing.unregister();
          } else if (script !== "" && !isOwnWorker(script)) {
            // An unknown worker owns this scope: never fight it, just report.
            emit({ sw: "shared", swScript: script });
            return;
          }
        }
        registration = await navigator.serviceWorker.register(SW_URL, {
          scope: SCOPE.pathname,
          updateViaCache: "none",
        });
        emit({ sw: navigator.serviceWorker.controller !== null ? "active" : "pending" });
        watchRegistration(registration);
        navigateWhenControllerChanges();
        if (registration.active !== null) void pingWorker();
        navigator.serviceWorker.ready.then(() => {
          emit({ sw: "active" });
          void pingWorker();
        }).catch(() => {});
      } catch (error) {
        emit({ sw: "error", swError: String((error && error.message) || error) });
      }
    }

    function navigateWhenControllerChanges() {
      if (navigator.serviceWorker.controller !== null) {
        emit({ sw: "active" });
        void pingWorker();
        return;
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (updateRequested) {
          if (!reloading) {
            reloading = true;
            location.reload();
          }
          return;
        }
        emit({ sw: "active" }, "controllerchange");
        void pingWorker();
      }, { once: false });
    }

    // ---------------------------------------------------------------------
    // Toasts (plain DOM: they must survive any React tree remount)
    // ---------------------------------------------------------------------
    let toastRoot = null;
    let renderedSignature = "";

    function installPromptSnoozed() {
      try {
        const until = Number(localStorage.getItem(INSTALL_PROMPT_KEY) || 0);
        return Number.isFinite(until) && until > Date.now();
      } catch {
        return false;
      }
    }

    function snoozeInstallPrompt() {
      try {
        localStorage.setItem(INSTALL_PROMPT_KEY, String(Date.now() + INSTALL_PROMPT_SNOOZE_MS));
      } catch {
        /* private mode: the prompt simply returns next launch */
      }
      emit({ installDismissed: true });
    }

    /**
     * Whether the conversation is still the empty "new session" view. The
     * install card only belongs there: on a live transcript it would cover the
     * header tabs.
     */
    function onWelcomeScreen() {
      const header = document.querySelector("header[data-window-drag]");
      return header !== null && /_headerBlank/.test(header.className);
    }

    /** The release banner: whether a compact install affordance belongs on screen. */
    function showInstallPrompt() {
      if (state.standalone || state.installDismissed) return false;
      if (state.mode !== "mobile") return false;
      if (!state.installable && !state.ios) return false;
      if (!onWelcomeScreen()) return false;
      return !installPromptSnoozed();
    }

    function renderToasts() {
      if (toastRoot === null) return;
      const install = showInstallPrompt();
      const signature = JSON.stringify([state.offline, state.updateReady && !state.updateDismissed, install]);
      if (signature === renderedSignature) return;
      renderedSignature = signature;
      toastRoot.replaceChildren();
      if (install) {
        const card = document.createElement("div");
        card.className = "dsh-mobile-maxxing-card dsh-mobile-maxxing-install";
        const text = document.createElement("span");
        text.className = "dsh-mobile-maxxing-card-text";
        text.textContent = state.installable
          ? t("pwa.install.promptable")
          : t("pwa.install.iosHint");
        const installButton = document.createElement("button");
        installButton.type = "button";
        installButton.textContent = t("pwa.install.button");
        installButton.addEventListener("click", () => void promptInstall());
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "dsh-mobile-maxxing-quiet";
        dismiss.textContent = t("pwa.later");
        dismiss.addEventListener("click", snoozeInstallPrompt);
        const actions = document.createElement("div");
        actions.className = "dsh-mobile-maxxing-install-actions";
        if (state.installable) actions.append(installButton);
        actions.append(dismiss);
        card.append(text, actions);
        toastRoot.append(card);
      }
      if (state.updateReady && !state.updateDismissed) {
        const card = document.createElement("div");
        card.className = "dsh-mobile-maxxing-card";
        const text = document.createElement("span");
        text.className = "dsh-mobile-maxxing-card-text";
        text.textContent = t("pwa.update.available");
        const reload = document.createElement("button");
        reload.type = "button";
        reload.textContent = t("pwa.update.reload");
        reload.addEventListener("click", () => void applyUpdate());
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "dsh-mobile-maxxing-quiet";
        dismiss.textContent = t("pwa.later");
        dismiss.addEventListener("click", () => emit({ updateDismissed: true }));
        card.append(text, reload, dismiss);
        toastRoot.append(card);
      }
      if (state.offline) {
        const pill = document.createElement("div");
        pill.className = "dsh-mobile-maxxing-pill";
        pill.textContent = t("pwa.offline");
        toastRoot.append(pill);
      }
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------
    function InstallIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M12 3v11m0 0 4-4m-4 4-4-4",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
        h("path", {
          d: "M4.5 16.5V18A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-1.5",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
        }),
      );
    }

    function InstallFooterAction({ wide }) {
      const s = useStore();
      if (!s.installable) return null;
      return h(
        "button",
        {
          type: "button",
          className: "dsh-mobile-maxxing-foot",
          "data-wide": wide ? "true" : "false",
          title: t("pwa.install.title"),
          "aria-label": t("pwa.install.title"),
          onClick: () => void promptInstall(),
        },
        h(InstallIcon, { size: wide ? 16 : 18 }),
        wide ? h("span", null, t("pwa.install.button")) : null,
      );
    }

    function swLabel(s) {
      switch (s.sw) {
        case "active":
          return s.updateReady ? t("pwa.sw.activeUpdate") : t("pwa.sw.active");
        case "unsupported":
          return t("pwa.sw.unsupported");
        case "insecure":
          return t("pwa.sw.insecure");
        case "shared":
          return t("pwa.sw.shared");
        case "error":
          return t("pwa.sw.error");
        default:
          return t("pwa.sw.pending");
      }
    }

    function installLabel(s) {
      if (s.standalone) return t("pwa.install.state.standalone");
      if (s.installable) return t("pwa.install.state.installable");
      if (s.ios) return t("pwa.install.state.ios");
      if (!s.secure) return t("pwa.install.state.insecure");
      return t("pwa.install.state.unsupported");
    }

    function PwaSettingsSection() {
      const s = useStore();
      const [message, setMessage] = useState("");
      const [busy, setBusy] = useState(false);

      const install = async () => {
        const outcome = await promptInstall();
        setMessage(outcome === "accepted"
          ? t("pwa.install.accepted")
          : outcome === "dismissed" ? t("pwa.install.dismissed") : t("pwa.install.unavailable"));
      };
      const check = async () => {
        setBusy(true);
        setMessage("");
        try {
          const reg = registration ?? (await navigator.serviceWorker.getRegistration());
          if (reg === null || reg === undefined) {
            setMessage(t("pwa.check.noWorker"));
          } else {
            await reg.update();
            const waiting = reg.waiting !== null;
            emit({ updateReady: waiting && navigator.serviceWorker.controller !== null });
            setMessage(waiting ? t("pwa.check.available") : t("pwa.check.latest"));
          }
        } catch {
          setMessage(t("pwa.check.failed"));
        } finally {
          setBusy(false);
          void pingWorker();
        }
      };

      return h(
        "section",
        { className: "dsh-mobile-maxxing-section" },
        h(
          "div",
          { className: "dsh-mobile-maxxing-cardbox" },
          h("h3", { className: "dsh-mobile-maxxing-title" }, t("pwa.section.title")),
          h("p", { className: "dsh-mobile-maxxing-desc" }, t("pwa.section.desc")),
          h(
            "dl",
            { className: "dsh-mobile-maxxing-rows" },
            h("dt", null, t("pwa.row.displayMode")),
            h("dd", null, s.standalone ? t("pwa.row.displayMode.standalone") : t("pwa.row.displayMode.browser")),
            h("dt", null, t("pwa.row.install")),
            h("dd", null, installLabel(s)),
            h("dt", null, t("pwa.row.offline")),
            h("dd", null, swLabel(s)),
            s.build !== "" ? h("dt", null, t("pwa.row.build")) : null,
            s.build !== "" ? h("dd", { className: "dsh-mobile-maxxing-code" }, s.build) : null,
          ),
          h(
            "div",
            { className: "dsh-mobile-maxxing-actions" },
            s.installable ? h("button", { type: "button", className: "dsh-mobile-maxxing-primary", onClick: install, disabled: busy }, t("pwa.install.button")) : null,
            s.updateReady ? h("button", { type: "button", className: "dsh-mobile-maxxing-primary", onClick: () => void applyUpdate() }, t("pwa.action.reloadUpdate")) : null,
            h("button", { type: "button", onClick: check, disabled: busy }, busy ? t("pwa.action.checking") : t("pwa.action.check")),
          ),
          message !== "" ? h("p", { className: "dsh-mobile-maxxing-note" }, message) : null,
          s.ios && !s.standalone
            ? h("p", { className: "dsh-mobile-maxxing-note" }, t("pwa.note.ios"))
            : null,
          !s.secure ? h("p", { className: "dsh-mobile-maxxing-note" }, t("pwa.note.insecure")) : null,
          s.sw === "error" && s.swError !== "" ? h("p", { className: "dsh-mobile-maxxing-note" }, t("pwa.note.swError", { error: s.swError })) : null,
          s.bootError !== "" ? h("p", { className: "dsh-mobile-maxxing-note" }, t("pwa.note.bootError", { error: s.bootError })) : null,
        ),
      );
    }

    // The mobile settings tab merges this section instead of showing the
    // separate "アプリ" tab.
    globalThis.__RDSH_PWA_SETTINGS_SECTION__ = PwaSettingsSection;

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------
    let booted = false;

    function boot(ctx) {
      if (booted) return;
      booted = true;

      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute(STYLE_ATTR, "true");
        style.textContent = CSS;
        document.head.appendChild(style);

        toastRoot = document.createElement("div");
        toastRoot.className = "dsh-mobile-maxxing-toasts";
        toastRoot.setAttribute("role", "status");
        toastRoot.setAttribute("aria-live", "polite");
        document.body.appendChild(toastRoot);

        const applyMode = () => {
          const standalone = isStandalone();
          document.documentElement.setAttribute(ROOT_ATTR, standalone ? "standalone" : "browser");
          emit({ standalone });
          renderToasts();
        };
        applyMode();

        // Belt and braces: if the served index predates the host tap, the
        // viewport still has to allow drawing under the notch.
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport !== null && !/viewport-fit\s*=\s*cover/i.test(viewport.content)) {
          viewport.content = viewportContent(viewport.content, { "viewport-fit": "viewport-fit=cover" });
        }

        const modeQueries = [STANDALONE_QUERY, FULLSCREEN_QUERY, MINIMAL_QUERY].map((query) => window.matchMedia(query));
        for (const media of modeQueries) media.addEventListener("change", applyMode);

        const onOnline = () => {
          emit({ offline: false });
          renderToasts();
          void checkForUpdate();
        };
        const onOffline = () => {
          emit({ offline: true });
          renderToasts();
        };
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        const onBeforeInstall = (event) => {
          event.preventDefault();
          installEvent = event;
          emit({ installable: true });
        };
        const onInstalled = () => {
          installEvent = null;
          emit({ installable: false });
          renderToasts();
        };
        window.addEventListener("beforeinstallprompt", onBeforeInstall);
        window.addEventListener("appinstalled", onInstalled);

        const restoreRegister = unifyWorker();
        const unsubscribe = subscribeToStore(renderToasts);
        // Navigation swaps the welcome view for a transcript (and back); the
        // install card depends on which one is mounted.
        let toastTimer = 0;
        const viewObserver = new MutationObserver(() => {
          if (toastTimer !== 0) return;
          toastTimer = setTimeout(() => {
            toastTimer = 0;
            renderToasts();
          }, 300);
        });
        viewObserver.observe(document.body, { childList: true, subtree: true });
        renderToasts();
        // Diagnostics surface: the Settings section reads the same store, and
        // an end-to-end test can assert on it without scraping the DOM.
        globalThis.__RDSH_PWA__ = {
          get state() { return { ...state }; },
          get transitions() { return transitions.slice(); },
          // Read-only diagnostic used by the regression that keeps the iOS
          // A2HS hint when the device requested the desktop site.
          showInstallPrompt,
          applyUpdate,
          checkForUpdate,
          promptInstall,
        };
        void registerWorker();

        // Poll for a new deployment while the tab stays open, and refresh the
        // check when the user comes back to it.
        const timer = setInterval(() => {
          if (document.visibilityState === "visible") void checkForUpdate();
        }, UPDATE_POLL_MS);
        const onVisible = () => {
          if (document.visibilityState === "visible" && Date.now() - lastUpdateCheck > UPDATE_MIN_GAP_MS) void checkForUpdate();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);

        return () => {
          style.remove();
          toastRoot.remove();
          toastRoot = null;
          renderedSignature = "";
          emit({ installDismissed: false });
          for (const media of modeQueries) media.removeEventListener("change", applyMode);
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
          window.removeEventListener("beforeinstallprompt", onBeforeInstall);
          window.removeEventListener("appinstalled", onInstalled);
          window.removeEventListener("focus", onVisible);
          document.removeEventListener("visibilitychange", onVisible);
          clearInterval(timer);
          clearTimeout(toastTimer);
          viewObserver.disconnect();
          unsubscribe();
          restoreRegister();
          delete globalThis.__RDSH_PWA__;
          // A live reload disposes and re-applies the plugin: let the effect
          // mount again instead of leaving the shell torn down.
          booted = false;
        };
      }, "dsh-mobile-maxxing: app shell");
    }

    // Subscribers are a Set of no-arg callbacks; the hook and the toast
    // renderer share it.
    function subscribeToStore(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        try {
          boot(ctx);
        } catch (error) {
          // Surface a boot failure to Settings and to tests instead of leaving
          // only a console trace behind.
          console.error("[dsh-mobile-maxxing] boot failed", error);
          emit({ bootError: String((error && error.message) || error) });
        }
        ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
          name: "sidebar.footer.action",
          id: "pwa-install",
          order: 40,
        }, InstallFooterAction));
      },
    };
    }

    // ---------------------------------------------------------------------
    // rdsh-mobile-ux — mobile-device UX: drawer, settings, composer, in-app banners.
    // ---------------------------------------------------------------------
    function mobilePart() {

    // rdsh-mobile-ux — browser half.
    //
    // Phone-width behaviour for the DSH Web UI. Upstream class names are CSS
    // module hashes that change between releases, so this plugin never styles
    // a hash directly: `decorate()` maps the live DOM onto stable
    // `data-rdsh-*` hooks using structure (slots, aria labels, row keys) and
    // the stylesheet only targets those hooks. A renamed upstream class stops
    // a hook from matching and leaves the stock layout in place (fail closed).
    //
    // What it does, in the order a phone user meets it:
    //   * the session rail becomes an overlay drawer with a slide animation and
    //     a tappable backdrop, so the chat is never squeezed
    //   * a floating three-dot button sits where the rail logo used to be while
    //     the drawer is closed, and taps on it open the drawer (the drawer's
    //     own DeepSeek HARNESS brand stays untouched)
    //   * opening a session closes the drawer and does not steal focus into the
    //     composer; starting a new session closes the drawer too
    //   * Settings stacks its navigation over the content instead of squeezing
    //     both into 390px
    //   * controls that cannot work inside an installed PWA (open in editor /
    //     terminal, feedback, sign in) are hidden through a readable list
    //   * running sessions animate their label instead of showing a spinner
    //   * the profile's hide list and notification setup live in Settings
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    // ---------------------------------------------------------------------
    // rdsh-mobile-ux — device-mode UX: drawer, settings, composer, in-app banners.
    // ---------------------------------------------------------------------
    const NOTIFY_DEVICE_TURNS_KEY = "rdsh-mobile-ux:notify-device-turns";
    const ENTER_TO_SEND_KEY = "rdsh-mobile-ux:enter-to-send";
    const CONFIG = globalThis.__RDSH_MOBILE_UX_CONFIG__ && typeof globalThis.__RDSH_MOBILE_UX_CONFIG__ === "object"
      ? globalThis.__RDSH_MOBILE_UX_CONFIG__
      : {};
    // The host default is "outline"; this fallback covers the case where the
    // config script never landed, and must match or the two disagree.
    const ANIMATION = ["aurora", "breathing", "outline", "none"].includes(CONFIG.runningAnimation)
      ? CONFIG.runningAnimation
      : "outline";
    /** Shown in Settings so a stale PWA bundle is easy to spot. */
    const BUILD = "2026-10-24.legacy-parity";

    // Upstream labels are matched through PROBES (all known locales). The
    // English fallbacks keep decoration working if the host's probe script
    // never landed; the injected vocabularies cover every known locale.
    const STOP_PROBE = probeRegex("stop", "i", "stop");
    const ACTIONS_PROBE = probeRegex("actions", "i", "actions");
    const TURNS_PROBE = probeRegex("turns", "i", ["turns", "turn", "steps", "step"]);
    const CACHE_PROBE = probeRegex("cacheHit", "i", "cache hit");
    const CONTEXT_PROBE = probeRegex("context", "i", "context");

    /**
     * Controls that have no meaning inside an installed app on a mobile device.
     *
     * This is the reference list, restored. It is applied only when the host
     * bootstrap selected mobile mode, so a desktop keeps every entry even in a
     * narrow window. "Open configuration file" is an addition from the merged
     * build: the host-side action also dead-ends in a mobile browser.
     */
    const HIDE_DEFAULT = [
      "Open configuration file",
      "More actions",
      "Feedback",
      "Sign in",
      "Keyboard shortcuts",
      "Desktop notifications",
      "Show coding view",
      "Built-in plugins",
    ];

    /**
     * Upstream's native "open in <app>" split button (#33).
     *
     * `@deepseek-ai/dsh-client-ui-open-in-app` marks the wrapper with
     * `data-open-target` (directory|file) and its halves with
     * `data-open-path-open` / `data-open-path-more`. The visible wording is the
     * host app's own name ("Open in Chrome"), which is not in the shipped
     * locales, so a label list can never catch it; the prominent half also has
     * no aria-label at all. Hiding the wrapper is therefore the only complete
     * match. It is a phone-only CSS rule, and it must not hide browser
     * preview features (wrap, reload, the viewer picker) that live in the same
     * header.
     */
    const OPEN_TARGET_SELECTOR = "[data-open-target]";

    // ---------------------------------------------------------------------
    // Store
    // ---------------------------------------------------------------------
    /**
     * Wrap code-review lines by default on a phone (#34).
     *
     * A code default, not a user setting: upstream owns the toggle and the
     * only remembered choice is an explicit OFF on a surface (see
     * `suppressReviewWrap`). Keeping this as a flag documents the decision
     * without adding a second source of truth or a new settings row.
     */
    const REVIEW_WRAP_DEFAULT = true;

    /** Browser-local theme choice; also read while the store initialises. */
    const DEVICE_THEME_KEY = "dsh-mobile-maxxing:device-theme";
    /** Browser-local display choices. Never a Host setting and never synced. */
    const LOCAL_DISPLAY_KEY = "rdsh-mobile-ux:local-display";
    /** The three published theme font roles and their accepted integer ranges. */
    const LOCAL_FONT_SPECS = {
      text: { min: 10, max: 22, default: 14, variable: "--dsh-content-font-size" },
      code: { min: 10, max: 16, default: 11, variable: "--dsh-code-font-size" },
      terminal: { min: 10, max: 20, default: 13, variable: "--dsh-terminal-font-size" },
    };
    const LOCAL_FONT_ROLES = ["text", "code", "terminal"];
    const DEVICE_THEME_MODES = ["", "light", "dark", "system"];
    // The device-theme choices are rendered through the copy table so a future
    // Japanese pack can translate them without touching this file.
    const DEVICE_THEME_KEYS = {
      "": "mux.deviceTheme.follow",
      light: "mux.deviceTheme.light",
      dark: "mux.deviceTheme.dark",
      system: "mux.deviceTheme.system",
    };

    const state = {
      // Window geometry only: the Settings card reports it and responsive CSS
      // uses it. It never selects the device mode.
      narrow: window.matchMedia(NARROW_QUERY).matches,
      // The device mode the host bootstrap fixed for this page (and the same
      // value `phone()` returns), kept in the store so Settings can decide
      // which cards and rows apply.
      mode: DEVICE_MODE,
      phone: phone(),
      drawerOpen: false,
      notifications: { supported: false, permission: "default", subscribed: false, ready: false },
      notice: "",
      bootError: "",
      enterToSend: readEnterToSend(),
      notifyDeviceTurns: readNotifyDeviceTurns(),
      deviceTheme: readDeviceTheme(),
      deviceThemeNote: "",
      localPermission: readLocalPermission(),
      permissionOptions: [],
      permissionSharedDefault: "",
      permissionError: "",
      localDisplay: readLocalDisplaySettings(),
    };
    const subscribers = new Set();
    function emit(patch) {
      Object.assign(state, patch);
      for (const fn of subscribers) {
        try {
          fn();
        } catch {
          /* one broken subscriber must not stop the rest */
        }
      }
    }
    function useStore() {
      const [, tick] = useState(0);
      useEffect(() => {
        const force = () => tick((n) => (n + 1) % 1000000);
        subscribers.add(force);
        return () => {
          subscribers.delete(force);
        };
      }, []);
      return state;
    }

    function narrow() {
      return window.matchMedia(NARROW_QUERY).matches;
    }

    /**
     * Is this device running the mobile UI?
     *
     * This is the one value the host bootstrap fixed before the bundle ran:
     * phones and tablets (including iPad's desktop-like UA) are `mobile`;
     * ordinary PCs, Windows touch laptops and narrow desktop windows are
     * `desktop`. Width, pointer kind, touch points and an installed-app
     * display mode never change it. If the bootstrap is missing or invalid,
     * the module already failed closed to desktop.
     */
    function phone() {
      return DEVICE_MODE === "mobile";
    }

    function readEnterToSend() {
      try {
        return localStorage.getItem(ENTER_TO_SEND_KEY) === "1";
      } catch {
        return false;
      }
    }

    function writeEnterToSend(value) {
      try {
        if (value) localStorage.setItem(ENTER_TO_SEND_KEY, "1");
        else localStorage.removeItem(ENTER_TO_SEND_KEY);
      } catch {
        /* private mode: the choice lasts for this page */
      }
      emit({ enterToSend: value });
    }

    /**
     * Treat turns sent from this browser as phone turns (#15).
     *
     * The host defaults to `onlyMobileTurns: true`, and the client only marks a
     * session after a send from a phone. A desktop send is therefore never
     * notified. The setting writer for the host config is not available to a
     * browser module, so this is a per-browser opt-in: while it is on, this
     * browser announces its sends through the same mobile-send endpoint a phone
     * uses. The host config stays untouched, which also means the choice is
     * remembered per browser profile rather than per profile.
     */
    function readNotifyDeviceTurns() {
      try {
        return localStorage.getItem(NOTIFY_DEVICE_TURNS_KEY) === "1";
      } catch {
        return false;
      }
    }

    function writeNotifyDeviceTurns(value) {
      try {
        if (value) localStorage.setItem(NOTIFY_DEVICE_TURNS_KEY, "1");
        else localStorage.removeItem(NOTIFY_DEVICE_TURNS_KEY);
      } catch {
        /* private mode: the choice lasts for this page */
      }
      emit({ notifyDeviceTurns: value });
      scheduleDecorate();
    }

    /** The live value of the #15 opt-in (the store copy only drives the UI). */
    function notifyDeviceTurns() {
      return readNotifyDeviceTurns();
    }

    // ---------------------------------------------------------------------
    // Per-device default permission preset
    //
    // The shared General row writes the Host's `defaultPreset`, which seeds
    // every device's new sessions. A phone that wants another default must not
    // write that value, so the choice lives in localStorage and is applied to
    // the blank session this device is about to open, with the same
    // `/permission <preset>` command the in-session switcher sends. The
    // session's own log records it; nothing outside this browser changes.
    // ---------------------------------------------------------------------
    const LOCAL_PERMISSION_KEY = "rdsh-mobile-ux:local-permission";
    const PERMISSION_VALUE_LABELS = {
      "read-only": "localPermission.readOnly",
      "workspace-write": "localPermission.workspaceWrite",
      "danger-full-access": "localPermission.fullAccess",
      auto: "localPermission.auto",
    };
    // The upstream row's English labels, so a host-renamed preset keeps its
    // own name while a built-in one uses our copy.
    const PERMISSION_ENGLISH_NAMES = {
      "read-only": "Read Only",
      "workspace-write": "Workspace Write",
      "danger-full-access": "Full access",
      auto: "Auto review",
    };

    function readLocalPermission() {
      try {
        const value = localStorage.getItem(LOCAL_PERMISSION_KEY);
        return typeof value === "string" && value !== "" ? value : null;
      } catch {
        return null;
      }
    }

    function writeLocalPermission(value) {
      const next = typeof value === "string" && value !== "" ? value : null;
      try {
        if (next === null) localStorage.removeItem(LOCAL_PERMISSION_KEY);
        else localStorage.setItem(LOCAL_PERMISSION_KEY, next);
      } catch {
        /* private mode: the choice lasts for this page */
      }
      emit({ localPermission: next });
    }

    /** One preset's label, preferring this package's copy for built-in keys. */
    function permissionOptionLabel(option) {
      const key = PERMISSION_VALUE_LABELS[option.value];
      if (key !== undefined && (option.name === option.value || option.name === PERMISSION_ENGLISH_NAMES[option.value])) return t(key);
      return option.name;
    }

    /** Read the permission catalog once for the Mobile card. */
    async function loadPermissionCatalog(remote) {
      if (remote === undefined || remote === null || remote.permissionPresets === undefined) {
        emit({ permissionError: t("localPermission.unavailable") });
        return;
      }
      try {
        const result = await remote.permissionPresets.catalog();
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        const catalog = result.value;
        emit({
          permissionOptions: catalog.options.map((option) => ({
            value: option.value,
            name: option.name,
            description: typeof option.description === "string" ? option.description : "",
          })),
          permissionSharedDefault: catalog.defaultPreset,
          permissionError: "",
        });
      } catch (error) {
        emit({ permissionError: t("localPermission.unavailableDetail", { error: String((error && error.message) || error) }) });
      }
    }

    /**
     * Apply this browser's preset to one freshly opened blank session.
     *
     * The command itself is asynchronous, so the caller raises a composer
     * block first (see installLocalPermissionDefault): a prompt cannot be
     * submitted under the shared default while this round-trip is in flight.
     */
    async function applyLocalPermissionToSession(sessions, sessionId) {
      const preset = readLocalPermission();
      if (preset === null || typeof sessionId !== "string" || sessionId === "") return;
      if (sessions === undefined || sessions === null) return;
      try {
        await sessions.using(sessionId, { source: "mobilePermissionDefault" }, async (reference) => {
          const live = reference.binding.session;
          const result = await live.command(`/permission ${preset}`);
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
          if (!result.value.matched) throw new Error(t("localPermission.unsupported"));
        });
      } catch (error) {
        console.warn("[rdsh-mobile-ux] local default permission failed", error);
        emit({ permissionError: t("localPermission.applyFailed", { error: String((error && error.message) || error) }) });
      }
    }

    /**
     * Wrap the one navigation entry point every new-session flow uses
     * (`startSession` and `openWorkspace` both reach it through `this`), so the
     * preset lands on the blank session before it is shown. The wrapper is an
     * instance property restored on disposal; the shared service and the Host
     * see no change.
     *
     * The first send must not race the command, so the wrapper also raises the
     * session's composer block (the public `ctx.conversation.blocks` face)
     * before the session is shown and clears it once the command settles. The
     * submit button and Enter stay inert for exactly that round-trip; nothing
     * is queued or replayed, so a send cannot be delivered twice.
     */
    function installLocalPermissionDefault(scope, workspace, sessions, blocks) {
      if (workspace === undefined || workspace === null) return;
      const original = workspace.openWorkspaceSession;
      if (typeof original !== "function" || Object.hasOwn(workspace, "openWorkspaceSession")) return;
      const canBlock = blocks !== null && blocks !== undefined && typeof blocks.set === "function";
      const wrapper = function (workspaceId, beforeOpen, reuse) {
        const open = typeof beforeOpen === "function" ? beforeOpen : null;
        return original.call(this, workspaceId, (sessionId) => {
          const preset = readLocalPermission();
          const gate = canBlock && preset !== null && typeof sessionId === "string" && sessionId !== "";
          if (!gate) {
            if (open !== null) open(sessionId);
            void applyLocalPermissionToSession(sessions, sessionId);
            return;
          }
          let released = false;
          let previous;
          try {
            previous = typeof blocks.storeFor === "function" ? blocks.storeFor(sessionId)?.getSnapshot?.() : undefined;
          } catch (error) {
            previous = undefined;
          }
          const block = { reason: t("localPermission.applying") };
          const release = () => {
            if (released) return;
            released = true;
            try {
              // Restore what the composer showed before this gate, and never
              // clear a newer block another plugin raised while we waited.
              if (typeof blocks.storeFor === "function") {
                const current = blocks.storeFor(sessionId)?.getSnapshot?.();
                if (current === block) blocks.set(sessionId, previous);
              } else {
                blocks.set(sessionId, undefined);
              }
            } catch (error) {
              /* the conversation fiber may be gone */
            }
          };
          try {
            blocks.set(sessionId, block);
          } catch (error) {
            /* the block registry may be gone; the command still runs */
          }
          try {
            if (open !== null) open(sessionId);
          } catch (error) {
            release();
            throw error;
          }
          void applyLocalPermissionToSession(sessions, sessionId).finally(release);
        }, reuse);
      };
      workspace.openWorkspaceSession = wrapper;
      scope.effect(() => () => {
        if (workspace.openWorkspaceSession === wrapper) delete workspace.openWorkspaceSession;
      });
    }

    // ---------------------------------------------------------------------
    // Per-device theme
    // ---------------------------------------------------------------------
    // The app's theme is a profile setting (settings/document), so the phone's
    // picker writes the *shared* value and every connected browser follows —
    // that is issue #5. This override is browser-local: it never calls
    // `theme.setTheme()` and never touches settings, it only repaints the same
    // DOM the upstream presenter owns (body[data-ds-dark-theme] /
    // html{color-scheme} / meta[name=theme-color]). If that contract is gone,
    // the override gives up instead of leaving a half-painted page.
    function readDeviceTheme() {
      try {
        const value = localStorage.getItem(DEVICE_THEME_KEY);
        return typeof value === "string" && DEVICE_THEME_MODES.includes(value) ? value : "";
      } catch (error) {
        return "";
      }
    }

    /** What the DOM looked like before the first override, for a clean release. */
    let deviceThemeBaseline = null;
    /** Set when the override cannot work here; the shared theme then stands. */
    let deviceThemeBlocked = false;
    let deviceThemeSnapshot = null;
    let deviceThemeCheck = 0;
    let deviceThemeRetries = 0;

    function captureDeviceBaseline() {
      if (deviceThemeBaseline !== null) return;
      deviceThemeBaseline = {
        dark: document.body.hasAttribute("data-ds-dark-theme"),
        colorScheme: document.documentElement.style.colorScheme || "",
        source: document.documentElement.dataset.dsThemeSource ?? "",
        themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "",
      };
    }

    function bodyCanvasColor() {
      try {
        return getComputedStyle(document.body).backgroundColor;
      } catch (error) {
        return "";
      }
    }

    /** The palette variable itself, so the check survives a transparent body
     *  (the macOS shell paints the canvas elsewhere). */
    function paletteSignature() {
      try {
        const value = getComputedStyle(document.body).getPropertyValue("--dsw-alias-bg-base");
        return typeof value === "string" ? value.trim() : "";
      } catch (error) {
        return "";
      }
    }

    /** Keep `meta[name=theme-color]` (the browser chrome) on the painted colour. */
    function paintThemeColor() {
      const color = bodyCanvasColor();
      if (typeof color !== "string" || color === "") return;
      const metas = document.querySelectorAll('meta[name="theme-color"]');
      const meta = metas.length === 0 ? null : metas[metas.length - 1];
      if (meta !== null) meta.setAttribute("content", color);
    }

    /** Undo every DOM write this override made. */
    function releaseDeviceTheme() {
      // Invalidate a verification frame queued by applyDeviceTheme(): after a
      // dispose it must not retry and repaint the palette.
      deviceThemeCheck += 1;
      if (deviceThemeBaseline === null) return;
      const baseline = deviceThemeBaseline;
      deviceThemeBaseline = null;
      const html = document.documentElement;
      html.removeAttribute("data-rdsh-device-theme");
      // Assigning "" removes the declaration, in the DOM and in the stub.
      html.style.colorScheme = baseline.colorScheme;
      if (baseline.source === "") delete html.dataset.dsThemeSource;
      else html.dataset.dsThemeSource = baseline.source;
      document.body.toggleAttribute("data-ds-dark-theme", baseline.dark);
      const metas = document.querySelectorAll('meta[name="theme-color"]');
      const meta = metas.length === 0 ? null : metas[metas.length - 1];
      if (meta !== null && baseline.themeColor !== "") meta.setAttribute("content", baseline.themeColor);
    }

    function deviceThemeScheme(mode) {
      if (mode === "light" || mode === "dark") return mode;
      if (mode !== "system") return null;
      try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } catch (error) {
        return null;
      }
    }

    /**
     * Paint the stored per-device choice over the shared theme, in mobile mode.
     *
     * Called at boot, after every `theme/change` (one microtask later, so the
     * upstream presenter has already written) and when the UI changes the
     * value. A desktop releases the override: #44 keeps upstream's palette
     * there. The result is checked on the next frame:
     * if the palette attribute was reverted or the body colour did not move,
     * the contract is not there and the override is abandoned for good.
     */
    function applyDeviceTheme() {
      if (typeof document === "undefined" || document.body === null) return;
      // #44: the per-device palette belongs to the mobile surface. A desktop
      // paints upstream's palette from the shared setting, so a mobile choice
      // made in this browser cannot change a desktop screenshot.
      if (!phone()) {
        releaseDeviceTheme();
        return;
      }
      if (deviceThemeBlocked) return;
      const mode = readDeviceTheme();
      const html = document.documentElement;
      if (mode === "") {
        releaseDeviceTheme();
        if (state.deviceThemeNote !== "") emit({ deviceThemeNote: "" });
        return;
      }
      // A registered palette supplies its own token layer, which this override
      // cannot replace: mixing the two produces a page no theme owns.
      const custom = deviceThemeSnapshot !== null && Object.keys(deviceThemeSnapshot?.active?.tokens ?? {}).length > 0;
      if (custom) {
        releaseDeviceTheme();
        if (state.deviceThemeNote !== "custom") emit({ deviceThemeNote: "custom" });
        return;
      }
      const scheme = deviceThemeScheme(mode);
      if (scheme === null) {
        releaseDeviceTheme();
        return;
      }
      captureDeviceBaseline();
      const dark = scheme === "dark";
      const before = document.body.hasAttribute("data-ds-dark-theme");
      const beforePalette = before === dark ? "" : paletteSignature();
      html.setAttribute("data-rdsh-device-theme", scheme);
      html.style.colorScheme = scheme;
      html.dataset.dsThemeSource = scheme;
      document.body.toggleAttribute("data-ds-dark-theme", dark);
      paintThemeColor();
      if (state.deviceThemeNote !== "") emit({ deviceThemeNote: "" });
      if (before === dark) return;
      deviceThemeCheck += 1;
      const token = deviceThemeCheck;
      const verify = () => {
        if (token !== deviceThemeCheck || deviceThemeBlocked) return;
        const lost = document.body.hasAttribute("data-ds-dark-theme") !== dark;
        const unchanged = beforePalette !== "" && paletteSignature() === beforePalette;
        if (!lost && !unchanged) {
          deviceThemeRetries = 0;
          return;
        }
        // A presenter that boots after this plugin writes the shared palette
        // once; one retry settles that without declaring the contract dead.
        if (deviceThemeRetries < 2) {
          deviceThemeRetries += 1;
          applyDeviceTheme();
          return;
        }
        deviceThemeBlocked = true;
        releaseDeviceTheme();
        emit({ deviceThemeNote: "unsupported" });
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(verify);
      else setTimeout(verify, 32);
    }

    /** Store the choice and repaint. Never writes the shared preference. */
    function writeDeviceTheme(value) {
      const next = DEVICE_THEME_MODES.includes(value) ? value : "";
      try {
        if (next === "") localStorage.removeItem(DEVICE_THEME_KEY);
        else localStorage.setItem(DEVICE_THEME_KEY, next);
      } catch (error) {
        /* private mode: the choice lasts for this page */
      }
      // An explicit choice re-arms a blocked override: the user may have
      // updated DSH since, and silently ignoring the picker is worse than one
      // more failed attempt (the frame check re-blocks it immediately).
      deviceThemeBlocked = false;
      deviceThemeRetries = 0;
      deviceThemeCheck += 1;
      emit({ deviceTheme: next, deviceThemeNote: "" });
      applyDeviceTheme();
    }

    /**
     * Wire the override to the theme service.
     *
     * No service (desktop shell without ui-theme, the unit-test stub) means no
     * shared value to fall back from: leave the DOM alone entirely.
     */
    function attachDeviceTheme(ctx) {
      let service;
      try {
        service = typeof ctx.get === "function" ? ctx.get("theme") : undefined;
      } catch (error) {
        service = undefined;
      }
      if (service === undefined || service === null) return;
      ctx.effect(() => {
        // A disposed effect must ignore its own queued work. applyDeviceTheme
        // schedules a frame and theme/change schedules a microtask; either can
        // outlive the cleanup and repaint the phone palette after it was
        // released.
        let active = true;
        try {
          const snapshot = service.getTheme();
          if (snapshot !== undefined && snapshot !== null) deviceThemeSnapshot = snapshot;
        } catch (error) {
          deviceThemeSnapshot = null;
        }
        if (active) applyDeviceTheme();
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            if (active) applyDeviceTheme();
          });
        }
        let media = null;
        try {
          media = window.matchMedia("(prefers-color-scheme: dark)");
        } catch (error) {
          media = null;
        }
        const onSystemScheme = () => {
          if (active) applyDeviceTheme();
        };
        media?.addEventListener?.("change", onSystemScheme);
        const offTheme = ctx.on("theme/change", (snapshot) => {
          if (snapshot !== undefined && snapshot !== null) deviceThemeSnapshot = snapshot;
          // The presenter applies synchronously inside its own listener; run
          // after every listener so the device choice is the one that stands.
          queueMicrotask(() => {
            if (active) applyDeviceTheme();
          });
        });
        return () => {
          active = false;
          media?.removeEventListener?.("change", onSystemScheme);
          if (typeof offTheme === "function") offTheme();
          releaseDeviceTheme();
        };
      }, "rdsh-mobile-ux: device theme");
    }

    // ---------------------------------------------------------------------
    // Device-local display: font sizes and UI language.
    //
    // Both controls are deliberately browser-local. The theme and locale
    // services expose only shared writers (`setFontSize` / `setLocale`), so
    // this block never calls them: it projects a local snapshot onto each
    // service for the lifetime of the mobile page and restores the Host
    // snapshot on dispose. `theme.getTheme()` / `locale.getSnapshot()` remain
    // the public read API; the local projection is a runtime/DOM override, not
    // a durable setting and not a remote call.
    // ---------------------------------------------------------------------
    let localDisplayRuntime = null;

    /**
     * Japanese language pack for the shared locale service (#64).
     *
     * Upstream ships zh and en only, so the display-language picker cannot
     * offer Japanese by itself. The dictionaries live in lib/copy.js (the one
     * module allowed to carry UI copy) and the host injects them as
     * `__RDSH_PWA_LOCALES__`; this page adds the language through the public
     * `addLanguage`/`register` API. A namespace without a ja dictionary falls
     * through the declared ja -> en chain to its English copy, which is the
     * locale service's documented behaviour. The pack is installed only on a
     * phone, so a desktop catalog stays exactly upstream's (#44).
     */
    const JA_LOCALE_PACK = globalThis.__RDSH_PWA_LOCALES__?.ja ?? null;

    /**
     * Register the Japanese pack when the public locale API is present.
     *
     * Returns a disposer that removes the definition and every dictionary. A
     * missing `addLanguage`/`register` (an older shell, the unit-test stub) or a
     * catalog where another pack already owns ja leaves the picker untouched.
     */
    function installJapaneseLocale(localeService) {
      if (!phone() || localeService === null || localeService === undefined) return null;
      if (typeof localeService.addLanguage !== "function" || typeof localeService.register !== "function") return null;
      const pack = JA_LOCALE_PACK;
      if (pack === null || typeof pack !== "object" || pack.language === null || typeof pack.language !== "object"
        || pack.dictionaries === null || typeof pack.dictionaries !== "object") return null;
      let removeLanguage;
      try {
        removeLanguage = localeService.addLanguage(pack.language);
      } catch (error) {
        // Another pack already defines ja: its catalog and dictionaries stand.
        return null;
      }
      const disposers = typeof removeLanguage === "function" ? [removeLanguage] : [];
      for (const [namespace, dictionary] of Object.entries(pack.dictionaries)) {
        try {
          const removeDictionary = localeService.register(namespace, "ja", dictionary);
          if (typeof removeDictionary === "function") disposers.push(removeDictionary);
        } catch (error) {
          console.warn("[rdsh-mobile-ux] ja dictionary failed", namespace, error);
        }
      }
      return () => {
        for (const dispose of disposers.reverse()) {
          try {
            dispose();
          } catch (error) {
            /* the locale fiber may already be gone */
          }
        }
      };
    }

    /** Read only this browser's display choices; malformed data means "follow Host". */
    function readLocalDisplaySettings() {
      const empty = {
        fonts: null,
        fontsLocal: false,
        language: "",
        languages: [],
        available: { fonts: true, language: true },
        reason: { fonts: "", language: "" },
      };
      try {
        const raw = JSON.parse(localStorage.getItem(LOCAL_DISPLAY_KEY) || "null");
        if (raw === null || typeof raw !== "object") return empty;
        const fonts = raw.fonts;
        const validFonts = fonts !== null && fonts !== undefined && typeof fonts === "object"
          && LOCAL_FONT_ROLES.every((role) => {
            const value = Number(fonts[role]);
            const spec = LOCAL_FONT_SPECS[role];
            return Number.isInteger(value) && value >= spec.min && value <= spec.max;
          });
        return {
          fonts: validFonts ? {
            text: Number(fonts.text),
            code: Number(fonts.code),
            terminal: Number(fonts.terminal),
          } : null,
          fontsLocal: validFonts,
          language: typeof raw.language === "string" ? raw.language : "",
          languages: [],
          available: { fonts: true, language: true },
          reason: { fonts: "", language: "" },
        };
      } catch (error) {
        return empty;
      }
    }

    /** Persist only this browser's choices. Never a settings/remote write. */
    function writeLocalDisplaySettings(display) {
      try {
        localStorage.setItem(LOCAL_DISPLAY_KEY, JSON.stringify({
          fonts: display.fontsLocal ? display.fonts : null,
          language: display.language,
        }));
      } catch (error) {
        /* private mode: the choice lasts for this page */
      }
    }

    function clampLocalFont(role, value) {
      const spec = LOCAL_FONT_SPECS[role];
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return spec.default;
      return Math.max(spec.min, Math.min(spec.max, Math.round(parsed)));
    }

    /** Apply one-step font changes to the local state and the local projection. */
    function setLocalDisplayFont(role, delta) {
      if (!LOCAL_FONT_SPECS[role] || state.localDisplay.available.fonts === false) return;
      const current = state.localDisplay.fonts;
      if (current === null || current === undefined) return;
      const next = {
        ...current,
        [role]: clampLocalFont(role, current[role] + delta),
      };
      if (next[role] === current[role]) return;
      const display = { ...state.localDisplay, fonts: next, fontsLocal: true };
      writeLocalDisplaySettings(display);
      emit({ localDisplay: display });
      localDisplayRuntime?.applyTheme();
    }

    /** Select a supported locale for this browser only; "" follows the Host. */
    function setLocalDisplayLanguage(id) {
      const display = state.localDisplay;
      if (display.available.language === false) return;
      const next = typeof id === "string" ? id : "";
      const supported = next === "" || display.languages.some((entry) => entry.id === next);
      if (!supported) return;
      const updated = { ...display, language: next };
      localDisplayLanguage = next;
      writeLocalDisplaySettings(updated);
      emit({ localDisplay: updated });
      localDisplayRuntime?.applyLocale();
    }

    /**
     * Local-only projection of the theme and locale services.
     *
     * Public API evidence: reads use `theme.getTheme()` and
     * `locale.getSnapshot()`; no `setFontSize`, `setFontSize` shortcut,
     * `setLocale`, `ctx.settings`, `configForms`, `remote` or `fetch` is used.
     * The snapshots are replaced on the service object only for this mobile
     * page and restored by the effect cleanup. Locale listeners are notified
     * directly (not through `locale/change`) so the native shell bridge never
     * observes the device-local choice.
     */
    function attachLocalDisplay(ctx) {
      let theme;
      let locale;
      try {
        theme = typeof ctx.get === "function" ? ctx.get("theme") : undefined;
      } catch (error) {
        theme = undefined;
      }
      try {
        locale = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
      } catch (error) {
        locale = undefined;
      }
      const themeService = theme !== null && theme !== undefined && typeof theme.getTheme === "function" ? theme : null;
      const localeService = locale !== null && locale !== undefined && typeof locale.getSnapshot === "function" ? locale : null;
      // Register before the first snapshot read so a stored "ja" is a valid
      // choice on this page load, and before the picker copies the catalog.
      let jaLocaleDispose = installJapaneseLocale(localeService);
      let hostTheme = null;
      let hostLocale = null;
      try {
        hostTheme = themeService?.getTheme() ?? null;
      } catch (error) {
        hostTheme = null;
      }
      try {
        hostLocale = localeService?.getSnapshot() ?? null;
      } catch (error) {
        hostLocale = null;
      }
      const hostFonts = hostTheme?.fontSizes;
      const themeUsable = themeService !== null
        && hostFonts !== null && hostFonts !== undefined && typeof hostFonts === "object"
        && LOCAL_FONT_ROLES.every((role) => Number.isInteger(hostFonts[role]))
        && "snapshot" in themeService;
      const themeReason = themeService === null
        ? "theme-missing"
        : (!themeUsable ? "theme-shape" : "");
      const localeShape = localeService !== null
        && hostLocale !== null && hostLocale !== undefined
        && typeof hostLocale.active === "string"
        && Array.isArray(hostLocale.locales)
        && "snapshot" in localeService
        && localeService.listeners !== null && localeService.listeners !== undefined
        && typeof localeService.listeners[Symbol.iterator] === "function";
      const options = localeShape ? localeOptionsFrom(hostLocale) : [];
      const localeUsable = localeShape && options.length > 0;
      const localeReason = localeService === null
        ? "locale-missing"
        : (!localeShape ? "locale-shape" : (options.length === 0 ? "no-locales" : ""));
      const stored = readLocalDisplaySettings();
      const language = localeUsable && stored.language !== "" && options.some((entry) => entry.id === stored.language)
        ? stored.language
        : "";
      const fonts = stored.fonts ?? (themeUsable ? hostFonts : {
        text: 14,
        code: 11,
        terminal: 13,
      });
      state.localDisplay = {
        fonts,
        fontsLocal: themeUsable && stored.fonts !== null,
        language,
        languages: options,
        available: { fonts: themeUsable, language: localeUsable },
        reason: { fonts: themeReason, language: localeReason },
      };
      localDisplayLanguage = language;
      localDisplayHostLanguage = typeof hostLocale?.active === "string" ? hostLocale.active : "";
      localDisplayRuntime = {
        applyTheme: () => {},
        applyLocale: () => {},
      };

      const themeEpoch = { value: 0 };
      const localeEpoch = { value: 0 };
      let projectingTheme = false;
      let disposed = false;
      const baseDocumentLang = document.documentElement.lang;

      const emitTheme = (snapshot) => {
        projectingTheme = true;
        try {
          ctx.emit("theme/change", snapshot);
        } finally {
          projectingTheme = false;
        }
      };

      const notifyLocale = () => {
        const listeners = localeService?.listeners;
        if (listeners === null || listeners === undefined || typeof listeners[Symbol.iterator] !== "function") return;
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            /* one broken LocaleFace must not stop the rest */
          }
        }
      };

      const applyTheme = () => {
        if (state.localDisplay.available.fonts !== true || themeService === null || hostTheme === null) return;
        if (!state.localDisplay.fontsLocal) {
          if (themeService.snapshot !== hostTheme) themeService.snapshot = hostTheme;
          return;
        }
        themeEpoch.value += 1;
        const revision = hostTheme.revision + 1000 + themeEpoch.value;
        themeService.snapshot = Object.freeze({
          ...hostTheme,
          fontSizes: Object.freeze({ ...state.localDisplay.fonts }),
          revision,
        });
        emitTheme(themeService.snapshot);
      };

      const applyLocale = () => {
        if (state.localDisplay.available.language !== true || localeService === null || hostLocale === null) return;
        const chosen = state.localDisplay.language;
        if (chosen === "" || !state.localDisplay.languages.some((entry) => entry.id === chosen)) {
          if (localeService.snapshot !== hostLocale) localeService.snapshot = hostLocale;
          if (document.documentElement.lang !== baseDocumentLang) document.documentElement.lang = baseDocumentLang;
          notifyLocale();
          return;
        }
        localeEpoch.value += 1;
        const revision = hostLocale.revision + 1000 + localeEpoch.value;
        localeService.snapshot = Object.freeze({
          ...hostLocale,
          active: chosen,
          revision,
        });
        document.documentElement.lang = chosen === "zh" ? "zh-CN" : chosen;
        notifyLocale();
      };

      localDisplayRuntime = { applyTheme, applyLocale };
      emit({ localDisplay: state.localDisplay });

      ctx.effect(() => {
        const offTheme = ctx.on("theme/change", (snapshot) => {
          if (projectingTheme || disposed || snapshot === null || snapshot === undefined) return;
          if (state.localDisplay.available.fonts !== true) return;
          hostTheme = snapshot;
          if (!state.localDisplay.fontsLocal) {
            emit({
              localDisplay: {
                ...state.localDisplay,
                fonts: snapshot.fontSizes,
              },
            });
          }
          queueMicrotask(() => {
            if (!disposed) applyTheme();
          });
        });
        const offLocale = ctx.on("locale/change", (snapshot) => {
          if (disposed || snapshot === null || snapshot === undefined) return;
          if (state.localDisplay.available.language !== true) return;
          hostLocale = snapshot;
          localDisplayHostLanguage = typeof snapshot.active === "string" ? snapshot.active : "";
          const nextOptions = localeOptionsFrom(snapshot);
          const chosen = state.localDisplay.language;
          const valid = chosen === "" || nextOptions.some((entry) => entry.id === chosen);
          if (nextOptions.length !== state.localDisplay.languages.length
            || nextOptions.some((entry, index) => entry.id !== state.localDisplay.languages[index]?.id)) {
            emit({ localDisplay: { ...state.localDisplay, languages: nextOptions, language: valid ? chosen : "" } });
          }
          if (!valid) {
            localDisplayLanguage = "";
            writeLocalDisplaySettings({ ...state.localDisplay, language: "" });
          }
          queueMicrotask(() => {
            if (!disposed) applyLocale();
          });
        });
        try {
          applyTheme();
          applyLocale();
        } catch (error) {
          console.error("[rdsh-mobile-ux] local display failed", error);
        }
        return () => {
          disposed = true;
          offTheme?.();
          offLocale?.();
          try {
            if (state.localDisplay.available.fonts === true && themeService !== null && hostTheme !== null) {
              themeService.snapshot = hostTheme;
              emitTheme(hostTheme);
            }
          } catch (error) {
            /* the theme fiber may already be gone */
          }
          try {
            if (state.localDisplay.available.language === true && localeService !== null && hostLocale !== null) {
              localeService.snapshot = hostLocale;
              notifyLocale();
            }
            if (document.documentElement.lang !== baseDocumentLang) document.documentElement.lang = baseDocumentLang;
          } catch (error) {
            /* the locale fiber may already be gone */
          }
          if (typeof jaLocaleDispose === "function") {
            jaLocaleDispose();
            jaLocaleDispose = null;
          }
          localDisplayLanguage = "";
          localDisplayHostLanguage = "";
          localDisplayRuntime = null;
        };
      }, "rdsh-mobile-ux: local display");
    }

    /** The locale definitions the shared service currently exposes. */
    function localeOptions(localeService) {
      let snapshot;
      try {
        snapshot = localeService?.getSnapshot?.();
      } catch (error) {
        return [];
      }
      return localeOptionsFrom(snapshot);
    }

    function localeOptionsFrom(snapshot) {
      const list = Array.isArray(snapshot?.locales) ? snapshot.locales : [];
      return list
        .filter((entry) => entry !== null && entry !== undefined && typeof entry.id === "string" && entry.id !== "")
        .map((entry) => ({ id: entry.id, label: typeof entry.label === "string" && entry.label !== "" ? entry.label : entry.id }));
    }

    /**
     * Some client bundles register a slash command with a plain string where
     * the runtime calls `description()` / `label()`. That single bad row makes
     * the whole command source throw, which is what breaks the composer's "+"
     * menu (and "/"). Coerce the descriptor fields the runtime invokes.
     */
    function normalizeCommandContribution(contribution) {
      if (contribution === null || typeof contribution !== "object") return contribution;
      const next = { ...contribution };
      for (const field of ["label", "description"]) {
        if (next[field] !== undefined && typeof next[field] !== "function") {
          const value = String(next[field]);
          next[field] = () => value;
        }
      }
      if (next.available !== undefined && typeof next.available !== "function") {
        const value = next.available;
        next.available = () => value;
      }
      return next;
    }

    function patchCommandUi(ctx) {
      ctx.inject(["commandUi"], (scope) => {
        const service = scope.get("commandUi");
        if (service === null || service === undefined) return;
        const registry = service.live && service.live.contributions;
        if (registry instanceof Map) {
          for (const [name, contribution] of [...registry]) registry.set(name, normalizeCommandContribution(contribution));
        }
        const originalRegister = service.register;
        service.register = function register(contribution) {
          return originalRegister.call(this, normalizeCommandContribution(contribution));
        };
        return () => {
          service.register = originalRegister;
        };
      });
    }

    /**
     * Drop the safe-area measurements. `env()` is not width-dependent, so a
     * wide iPad in standalone mode still reports insets; #44 keeps the root
     * padding and the custom properties off a desktop viewport.
     */
    function releaseSafeArea() {
      const root = document.documentElement;
      for (const name of ["top", "bottom", "left", "right"]) root.removeAttribute(`data-rdsh-safe-${name}`);
      root.removeAttribute("data-rdsh-native-gap");
      root.style.removeProperty("--rdsh-safe-top");
      root.style.removeProperty("--rdsh-safe-bottom");
      root.style.removeProperty("--rdsh-safe-left");
      root.style.removeProperty("--rdsh-safe-right");
      root.style.removeProperty("--rdsh-native-gap-px");
    }

    function measureSafeArea() {
      if (!phone()) {
        releaseSafeArea();
        return;
      }
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const top = parseFloat(style.paddingTop) || 0;
      const bottom = parseFloat(style.paddingBottom) || 0;
      const left = parseFloat(style.paddingLeft) || 0;
      const right = parseFloat(style.paddingRight) || 0;
      probe.remove();
      const root = document.documentElement;
      // iOS 26 standalone: the native web view is ~status-bar-height shorter
      // than the screen (screen.height - innerHeight), so the unpainted strip is
      // below the web view. The home indicator is in that strip, not inside the
      // page; the inner bottom safe-area padding would only enlarge the blank.
      const viewport = window.visualViewport;
      const keyboardOpen = viewport !== null && viewport !== undefined && viewport.height < window.innerHeight - 100;
      const screenHeight = window.screen && Number.isFinite(window.screen.height) ? window.screen.height : 0;
      const nativeGap = window.navigator.standalone === true && !keyboardOpen && screenHeight > 0 && screenHeight - window.innerHeight > 8;
      root.toggleAttribute("data-rdsh-native-gap", nativeGap);
      for (const [name, value] of [["top", top], ["bottom", bottom], ["left", left], ["right", right]]) {
        if (value > 0) root.setAttribute(`data-rdsh-safe-${name}`, "");
        else root.removeAttribute(`data-rdsh-safe-${name}`);
      }
      root.style.setProperty("--rdsh-safe-top", `${top}px`);
      root.style.setProperty("--rdsh-safe-bottom", `${bottom}px`);
      root.style.setProperty("--rdsh-safe-left", `${left}px`);
      root.style.setProperty("--rdsh-safe-right", `${right}px`);
      root.style.setProperty("--rdsh-native-gap-px", `${nativeGap ? Math.max(0, Math.round(screenHeight - window.innerHeight)) : 0}px`);
    }

    /**
     * One measured safe-area edge, in CSS pixels. JS cannot read env(), and the
     * popovers clamp their own position, so they use the same values
     * measureSafeArea() read. A desktop (or a device that reports nothing)
     * gives 0 and the old 12px gutters are unchanged.
     */
    function safeInset(edge) {
      const value = parseFloat(document.documentElement.style.getPropertyValue(`--rdsh-safe-${edge}`));
      return Number.isFinite(value) && value > 0 ? value : 0;
    }

    /** The host can still turn the standard hide list off; the browser cannot. */
    function hideDisabled() {
      return CONFIG.showHiddenControls === true;
    }

    /**
     * Does the host already run a phone drawer of its own?
     *
     * `@deepseek-ai/dsh-client-ui-mobile` paints `data-dsh-mobile-layout`
     * onto the document and gives the session list its own way in (the header
     * toggle), its own way out (`data-dsh-mobile-drawer-backdrop`) and its own
     * open/closed state (`data-dsh-mobile-drawer`). It also keeps the frame's
     * `data-sidebar-collapsed` unset for the whole phone session, so the rail
     * state this module reads below says "open" no matter what the user did.
     *
     * The two drawers cannot share the screen: upstream's toggle is the one the
     * header shows, upstream's backdrop covers the screen, and this module's
     * own button would be hidden underneath them. Where the host owns the
     * drawer, this module follows its state and injects nothing.
     */
    function hostsOwnDrawer() {
      // The layout attribute is written by that package's presenter for the
      // whole smartphone session, and removed on dispose or on a desktop.
      return document.documentElement.getAttribute("data-dsh-mobile-layout") === "smartphone";
    }

    // ---------------------------------------------------------------------
    // Decoration: live DOM → stable hooks
    // ---------------------------------------------------------------------
    function frame() {
      const root = document.getElementById("root");
      const slot = root && root.firstElementChild;
      return slot && slot.firstElementChild;
    }

    function classToken(element, pattern) {
      return element && element.classList ? [...element.classList].some((token) => pattern.test(token)) : false;
    }

    function labelOf(element) {
      const aria = element.getAttribute("aria-label");
      if (aria && aria.trim() !== "") return aria.trim();
      const item = element.querySelector('[class*="_itemLabel"]');
      const text = item ? item.textContent : element.textContent;
      return (text || "").trim().replace(/\s+/g, " ");
    }

    function hideLabels() {
      return [...HIDE_DEFAULT, ...(Array.isArray(CONFIG.hideLabels) ? CONFIG.hideLabels : [])];
    }

    function shouldHide(label, labels) {
      const normalized = label.toLowerCase();
      return labels.some((entry) => {
        const target = entry.toLowerCase();
        return normalized === target || normalized.startsWith(`${target} `) || normalized.startsWith(`${target}:`);
      });
    }

    let readGeneralSettingsLabel = () => "General";

    function decorateMobileSettingsTabs(modal) {
      if (!phone() || modal === null) return;
      const generalLabel = readGeneralSettingsLabel();
      const tabs = [...modal.querySelectorAll("nav button")];
      const mobile = tabs.find((button) => labelOf(button) === t("tab.mobile"));
      let generalActive = false;
      for (const button of tabs) {
        const general = labelOf(button) === generalLabel;
        button.toggleAttribute("data-rdsh-settings-tab-hidden", general);
        if (general && button.getAttribute("aria-current") === "true") generalActive = true;
      }
      if (generalActive && mobile !== undefined) {
        mobile.click();
        mobile.focus();
      }
    }

    function applyHideList(disabled) {
      const labels = hideLabels();
      // Hide the controls that dead-end on a mobile device. Desktop mode
      // keeps every control, whatever the window width.
      const hideOnThisDevice = !disabled && phone();
      for (const element of document.querySelectorAll("button[aria-label], [role='menuitem']")) {
        const label = labelOf(element);
        if (label === "" || label.length > 48) continue;
        if (hideOnThisDevice && shouldHide(label, labels)) {
          element.setAttribute("data-rdsh-hidden", "");
        } else {
          element.removeAttribute("data-rdsh-hidden");
        }
      }
      const modal = document.querySelector('[data-shortcut-modal="settings"]');
      decorateMobileSettingsTabs(modal);
      // PC-only settings rows and action buttons. Matched by their label, not
      // by an upstream class: the row container is found through structure,
      // and a bare action button ("Open configuration file") is hidden as the
      // button itself.
      if (modal !== null && hideOnThisDevice) {
        const rowHidden = new Set();
        for (const element of modal.querySelectorAll("*")) {
          if (element.children.length !== 0) continue;
          const text = (element.textContent || "").trim().replace(/\s+/g, " ");
          if (text === "" || text.length > 48 || !shouldHide(text, labels)) continue;
          let row = element;
          while (row !== null && row !== modal) {
            const cls = typeof row.className === "string" ? row.className : "";
            const isRow = /(^|_)(?:row|setting)(?:_|$)|dswsnd-row/.test(cls);
            const isButton = row.tagName === "BUTTON" || row.getAttribute("role") === "button";
            if (isRow || isButton) {
              row.setAttribute("data-rdsh-setting-hidden", "");
              rowHidden.add(row);
              break;
            }
            row = row.parentElement;
          }
        }
        for (const row of modal.querySelectorAll("[data-rdsh-setting-hidden]")) {
          if (!rowHidden.has(row)) row.removeAttribute("data-rdsh-setting-hidden");
        }
      } else if (modal !== null) {
        // Leaving the phone (or turning hiding off) must not leave a stale
        // attribute behind for the next pass to trip over.
        for (const row of modal.querySelectorAll("[data-rdsh-setting-hidden]")) row.removeAttribute("data-rdsh-setting-hidden");
      }
      // Two plugins can add a "copy this session's id" row. Keep one: prefer the
      // localised rdsh row (it reports success) and drop the stock duplicate.
      const menu = document.querySelector("[role='menu']");
      if (menu !== null && hideOnThisDevice) {
        const items = [...menu.querySelectorAll("[role='menuitem']")];
        const localised = items.find((item) => (item.textContent || "").includes(t("sessionId.label")));
        const stock = items.find((item) => /^Copy Session ID$/i.test(labelOf(item)));
        if (localised !== undefined && stock !== undefined) {
          stock.setAttribute("data-rdsh-hidden", "");
        }
      }
    }

    function unringSessionTitle(title) {
      // The animated ring used to wrap the label in its own element; it no
      // longer does, so only the attribute it added is left to clear.
      title.removeAttribute("data-rdsh-ringed");
    }

    function ringSessionRow(row) {
      row.setAttribute("data-rdsh-ring-row", "");
    }

    function unringSessionRow(row) {
      row.removeAttribute("data-rdsh-ring-row");
      const title = row.querySelector("[data-rdsh-session-title]");
      if (title !== null) unringSessionTitle(title);
    }

    const SESSION_FRAME_KEY = "rdsh-mobile-ux:session-frames";
    const FRAME_COLORS = [
      { id: "blue", label: t("frame.color.blue"), value: "#7aaaff" },
      { id: "green", label: t("frame.color.green"), value: "#5bd6a5" },
      { id: "amber", label: t("frame.color.amber"), value: "#ffd166" },
      { id: "red", label: t("frame.color.red"), value: "#ff6b6b" },
      { id: "purple", label: t("frame.color.purple"), value: "#b48cff" },
      { id: "pink", label: t("frame.color.pink"), value: "#ff8fc7" },
    ];
    function readSessionFrames() {
      try {
        const value = JSON.parse(localStorage.getItem(SESSION_FRAME_KEY) || "{}");
        return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch {
        return {};
      }
    }
    let sessionFrames = readSessionFrames();
    function sessionFrameOf(row) {
      const key = row.getAttribute("data-row-key") || "";
      const id = key.startsWith("session:") ? key.slice("session:".length) : "";
      const value = id === "" ? undefined : sessionFrames[id];
      return typeof value === "string" && value !== "" ? value : null;
    }
    function applySessionFrame(row) {
      const color = sessionFrameOf(row);
      if (color === null) {
        row.removeAttribute("data-rdsh-session-frame");
        row.style.removeProperty("--rdsh-session-frame");
      } else {
        row.setAttribute("data-rdsh-session-frame", "");
        row.style.setProperty("--rdsh-session-frame", color);
      }
    }
    function saveSessionFrame(sessionId, color) {
      if (color === null) delete sessionFrames[sessionId];
      else sessionFrames[sessionId] = color;
      try { localStorage.setItem(SESSION_FRAME_KEY, JSON.stringify(sessionFrames)); } catch { /* private mode */ }
      scheduleDecorate();
    }

    function decorateSessionRows() {
      // #44: every session-row hook, including the colour frame, dresses the
      // mobile sidebar. Desktop keeps upstream's rows untouched; the frame
      // rule itself lives in the mobile stylesheet.
      if (!phone()) {
        if (rowHooksActive) clearSessionRowHooks();
        return;
      }
      rowHooksActive = true;
      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        row.setAttribute("data-rdsh-session", "");
        const children = [...row.children];
        const status = children.find((child) => classToken(child, /_slot$/));
        const title = children.find((child) => classToken(child, /_title$/));
        if (status) {
          status.setAttribute("data-rdsh-status", "");
          // Idle rows keep an empty 16px status slot; on a phone that width
          // belongs to the title.
          if (status.children.length === 0 && (status.textContent || "").trim() === "") status.setAttribute("data-rdsh-status-empty", "");
          else status.removeAttribute("data-rdsh-status-empty");
        }
        if (title) title.setAttribute("data-rdsh-session-title", "");
        applySessionFrame(row);
        const running = row.querySelector('svg[data-state="ongoing"]') !== null;
        if (running) row.setAttribute("data-rdsh-running", "");
        else row.removeAttribute("data-rdsh-running");
        // Only a running session sweeps. An open but idle session is marked
        // with the static frame below, so "open" never looks like "working".
        const selected = row.getAttribute("aria-selected") === "true";
        if (ANIMATION === "outline" && running) ringSessionRow(row);
        else unringSessionRow(row);
        row.toggleAttribute("data-rdsh-open-row", selected);
        // The row actions carry the "..." menu plus archive/pin shortcuts. On a
        // phone only the menu earns its width; the shortcuts stay in the menu.
        const actions = children.find((child) => classToken(child, /_rowActions$/));
        if (actions) {
          for (const button of actions.querySelectorAll("button")) {
            if (/^Session actions/i.test(button.getAttribute("aria-label") || "")) button.removeAttribute("data-rdsh-row-minor");
            else button.setAttribute("data-rdsh-row-minor", "");
          }
        }
      }
    }

    /** Whether the last pass wrote session-row hooks (so a wide pass is cheap). */
    let rowHooksActive = false;

    const SESSION_ROW_HOOKS = [
      "data-rdsh-running",
      "data-rdsh-ring-row",
      "data-rdsh-open-row",
      "data-rdsh-session-frame",
      "data-rdsh-row-minor",
      "data-rdsh-row-menu",
      "data-rdsh-dragging",
    ];

    /**
     * Strip every session-row hook.
     *
     * Reached from the desktop guard and from dispose: the styling lives in
     * the mobile stylesheet, so a desktop never applies it, but leaving the
     * attributes behind means a later mobile pass starts from another
     * layout's leftovers, and `[data-rdsh-running]` on a desktop row is a lie
     * to anything that reads the DOM. The colour frame is stripped here too:
     * it is a mobile feature under #44.
     */
    function clearSessionRowHooks() {
      rowHooksActive = false;
      for (const attribute of SESSION_ROW_HOOKS) {
        for (const element of document.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
      }
      for (const element of document.querySelectorAll("[data-rdsh-session], [data-rdsh-status], [data-rdsh-session-title], [data-rdsh-ringed]")) {
        if (element.hasAttribute("data-rdsh-session")) element.removeAttribute("data-rdsh-session");
        if (element.hasAttribute("data-rdsh-status")) {
          element.removeAttribute("data-rdsh-status");
          element.removeAttribute("data-rdsh-status-empty");
        }
        if (element.hasAttribute("data-rdsh-session-title")) element.removeAttribute("data-rdsh-session-title");
        element.removeAttribute("data-rdsh-ringed");
      }
      for (const row of document.querySelectorAll("[data-row-key^='session:']")) row.style.removeProperty("--rdsh-session-frame");
    }

    /**
     * Every attribute the mobile surface writes onto DOM.
     *
     * Kept in one place so `clearPhoneHooks()` is exhaustive: a hook added to
     * a decorate function without being listed here is caught by
     * `tests/boundary-issues.test.mjs`, which walks the live DOM after dispose
     * and a desktop boot. Device/PWA attributes are deliberately absent:
     * `data-dsh-mobile-maxxing`, the notification diagnostics
     * (`data-rdsh-badge-hook`, `-sessions-hook`, `-running-subagents`),
     * `data-rdsh-notice-host` and the style markers. The safe-area attributes
     * are listed: #44 keeps their root padding off a desktop even when a
     * standalone iPad reports non-zero insets.
     */
    const PHONE_HOOKS = [
      "data-rdsh-frame",
      "data-rdsh-center-col",
      "data-rdsh-rightbar-col",
      "data-rdsh-sidebar",
      "data-rdsh-drawer",
      "data-rdsh-anim",
      "data-rdsh-safe-top",
      "data-rdsh-safe-bottom",
      "data-rdsh-safe-left",
      "data-rdsh-safe-right",
      "data-rdsh-native-gap",
      "data-rdsh-header",
      "data-rdsh-crumbs",
      "data-rdsh-conversation",
      "data-rdsh-rightpanel",
      "data-rdsh-rightpanel-open",
      "data-rdsh-rtab",
      "data-rdsh-code-pre",
      "data-rdsh-code-scroll",
      "data-rdsh-question-card",
      "data-rdsh-question-frame",
      "data-rdsh-question-tile",
      "data-rdsh-question-arrow",
      "data-rdsh-todo-item",
      "data-rdsh-todo-text",
      "data-rdsh-todo-status",
      "data-rdsh-goal-objective",
      "data-rdsh-goal-text",
      "data-rdsh-goal-actions",
      "data-rdsh-goal-editing",
      "data-rdsh-header-title",
      "data-rdsh-header-running",
      "data-rdsh-typing",
      "data-rdsh-typing-layer",
      "data-rdsh-typing-caret",
      "data-rdsh-toast",
      "data-rdsh-toast-dismissed",
      "data-rdsh-model-search",
      "data-rdsh-model-search-row",
      "data-rdsh-model-button",
      "data-rdsh-settings-nav-arrow",
      "data-rdsh-nav-scroll",
      "data-rdsh-nav-tabclick",
      "data-rdsh-fade-left",
      "data-rdsh-fade-right",
      "data-rdsh-options-observer",
      "data-rdsh-stat-text",
      "data-rdsh-composer-dock",
      "data-rdsh-composer-root",
      "data-rdsh-has-dock",
      "data-rdsh-add",
      "data-rdsh-hide-settings",
      "data-rdsh-queue-dock",
      "data-rdsh-queue-panel",
      "data-rdsh-queue-row",
      "data-rdsh-queue-index",
      "data-rdsh-queue-preview",
      "data-rdsh-queue-for",
      "data-rdsh-queue-text",
      "data-rdsh-workspace-menu",
      "data-rdsh-workspace-viewport",
      "data-rdsh-workspace-hidden",
      "data-rdsh-workspace-search",
      "data-rdsh-workspace-empty",
      "data-rdsh-workspace-trigger",
      "data-rdsh-activity-chip",
      "data-rdsh-activity-spinner",
      "data-rdsh-activity-icon",
      "data-rdsh-activity-generated",
      "data-rdsh-transcript",
      "data-rdsh-transcript-column",
      "data-rdsh-user-stack",
      "data-rdsh-user-bubble",
      "data-rdsh-edit-card",
      "data-rdsh-edit-header",
      "data-rdsh-edit-row",
      "data-rdsh-scroll",
      "data-rdsh-route-heading",
      "data-rdsh-route-detail",
      "data-rdsh-sidebar-toggle",
      "data-rdsh-more-row",
      "data-rdsh-settings-row",
      "data-rdsh-settings-tab-hidden",
      "data-rdsh-hidden",
      "data-rdsh-setting-hidden",
      "data-rdsh-lightbox",
      "data-rdsh-crop-button",
      "data-rdsh-crop-overlay",
      "data-rdsh-swipe",
      "data-rdsh-auto-fired",
    ];

    function clearOwnedAttribute(name) {
      for (const element of document.querySelectorAll(`[${name}]`)) element.removeAttribute(name);
    }

    /**
     * Strip the other mobile-only hooks whose styling lives in the mobile
     * stylesheet.
     *
     * Also the single cleanup path for dispose and the defensive desktop boot.
     * It restores what this module changed (attributes, injected nodes, inline
     * styles, viewport meta, device palette) and leaves upstream's own state
     * alone: no upstream attribute or style is touched unless this module wrote
     * it first.
     */
    function clearPhoneHooks() {
      // Nodes and listeners that are not recoverable from an attribute alone.
      closeQueueUi();
      clearWorkspacePicker();
      clearSettingsNavArrows();
      closeDetailPopover();
      closeFramePalette();
      clearLightboxHooks();
      closeCropOverlay();
      clearDetailPanelHooks();
      clearQuestionArrows();
      clearModelSearch();
      clearActivityChips();
      clearPreviewTools();
      // The file-tree tools own document-level pointer/scroll listeners. This
      // teardown must retire them too, or a mobile boot leaves them behind.
      disposeWorkspaceTools();
      clearComposerHooks();
      clearTypingAnimations();
      removeRouteBack();
      settleDrawer();
      removeDrawerNodes();
      // Inline styles this module wrote onto upstream nodes.
      clearQueueDockHooks();
      clearToastHooks();
      for (const layer of document.querySelectorAll("[data-rdsh-typing-layer]")) layer.remove();
      for (const attribute of PHONE_HOOKS) clearOwnedAttribute(attribute);
      clearSessionRowHooks();
      releaseSafeArea();
      releaseViewportLock();
      releaseDeviceTheme();
      clearTerminalFit();
    }

    function decorateEditCards() {
      for (const element of document.querySelectorAll("[data-rdsh-edit-card]")) element.removeAttribute("data-rdsh-edit-card");
      for (const element of document.querySelectorAll("[data-rdsh-edit-header], [data-rdsh-edit-row]")) {
        element.removeAttribute("data-rdsh-edit-header");
        element.removeAttribute("data-rdsh-edit-row");
      }
      // The tighter edit summary is a mobile layout rule; the scan itself is
      // expensive, so desktop only clears what a previous pass wrote.
      if (!phone()) return;
      for (const element of document.querySelectorAll("span, div")) {
        if (element.children.length !== 0) continue;
        if (!/^Edited \d+ files?$/.test((element.textContent || "").trim())) continue;
        const card = element.closest('[class*="_card"]');
        if (card === null) continue;
        card.setAttribute("data-rdsh-edit-card", "");
        const header = card.querySelector("button");
        if (header !== null) header.setAttribute("data-rdsh-edit-header", "");
        for (const row of card.querySelectorAll("li > button, button")) {
          if (row !== header) row.setAttribute("data-rdsh-edit-row", "");
        }
        break;
      }
    }

    let rightPanelNode = null;
    let rightPanelWatch = null;
    let rightPanelIO = null;

    /**
     * Upstream's own wrapper for the right sidebar.
     *
     * Everything below searches inside this subtree only. Without a boundary
     * the collapse button of a hidden `SessionView` (the full-screen Plugins
     * and Automation-tasks routes keep one mounted at 0x0) walked up past its
     * own panel to the app frame, and the frame then looked like an open
     * panel: the header and the drawer button were hidden by CSS and there was
     * no way back on a phone.
     */
    const RIGHT_PANEL_ROOT = "[data-sidebar-right-panel]";

    /** The collapse button of a panel that is actually laid out. */
    function visibleCollapseButton() {
      for (const button of document.querySelectorAll('[aria-label="Collapse right sidebar"]')) {
        // Visibility is deliberately not part of this: the real panel keeps
        // its chrome mounted while closed (clipped to a zero-width column and
        // parked off-screen), and its rect stays non-zero. Only a panel that
        // never rendered is 0x0.
        const rect = button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (button.closest(RIGHT_PANEL_ROOT) === null) continue;
        return button;
      }
      return null;
    }

    function syncRightPanelOpen() {
      const panel = rightPanelNode;
      let open = false;
      if (panel !== null && panel.isConnected) {
        // A panel inside a `[hidden]` subtree is upstream saying "another route
        // owns the screen"; its own box may still measure, so check the host.
        const host = panel.closest(RIGHT_PANEL_ROOT) ?? panel;
        open = host.closest("[hidden]") === null
          && getComputedStyle(panel).visibility !== "hidden"
          && panel.getBoundingClientRect().width > 0;
      }
      document.documentElement.toggleAttribute("data-rdsh-rightpanel-open", open);
      if (open) scheduleTerminalFit();
      else clearTerminalFit();
    }

    function watchRightPanel(panel) {
      if (rightPanelNode !== panel) {
        rightPanelWatch?.disconnect();
        rightPanelIO?.disconnect();
        rightPanelNode = panel;
        rightPanelWatch = new MutationObserver(syncRightPanelOpen);
        rightPanelWatch.observe(panel, { attributes: true, attributeFilter: ["class", "style"] });
        rightPanelIO = new IntersectionObserver(syncRightPanelOpen, { threshold: 0.25 });
        rightPanelIO.observe(panel);
      }
      syncRightPanelOpen();
    }

    /**
     * Drop every right-panel hook.
     *
     * The panel node is replaced when the route or the pane changes, and the
     * old tag has to go with it: two tagged nodes at once apply the panel's
     * mobile layout (max-width, overflow, padding) to the whole app.
     */
    function forgetRightPanel() {
      for (const node of document.querySelectorAll("[data-rdsh-rightpanel]")) node.removeAttribute("data-rdsh-rightpanel");
      rightPanelWatch?.disconnect();
      rightPanelIO?.disconnect();
      rightPanelWatch = null;
      rightPanelIO = null;
      rightPanelNode = null;
      document.documentElement.removeAttribute("data-rdsh-rightpanel-open");
    }

    /**
     * Promote a docked right panel to fullscreen once.
     *
     * The reference build did this on every slow decorate pass, via the
     * panel's own "Enter fullscreen" button. Upstream now labels the same
     * control "Fullscreen" / "全屏"; match the known labels, but only inside a
     * laid-out panel and only once per button, so a hidden ghost from another
     * route can never be clicked and a failed promotion cannot loop.
     */
    let rightPanelFitPending = false;

    function visibleFullscreenButton() {
      const selector = ariaLabelSelector("button", "fullscreen", ["Enter fullscreen", "Fullscreen"]);
      for (const button of document.querySelectorAll(selector)) {
        const rect = button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (button.closest(RIGHT_PANEL_ROOT) === null) continue;
        if (button.closest("[hidden]") !== null) continue;
        if (getComputedStyle(button).visibility === "hidden") continue;
        return button;
      }
      return null;
    }

    function ensureRightPanelFits() {
      if (!phone()) {
        rightPanelFitPending = false;
        return;
      }
      const enter = visibleFullscreenButton();
      if (enter === null) {
        // The panel closed, or the click turned the button into "exit": the
        // next open may promote again.
        rightPanelFitPending = false;
        return;
      }
      if (rightPanelFitPending) return;
      if (enter.getAttribute("data-rdsh-auto-fired") === "1") return;
      rightPanelFitPending = true;
      enter.setAttribute("data-rdsh-auto-fired", "1");
      enter.click();
    }

    /**
     * Tag the scroller that owns a code preview.
     *
     * The viewer scrolls in both axes by default; the lock in the stylesheet
     * keys off this attribute so a long line cannot be panned sideways.
     */
    function decorateCodePreview() {
      if (!phone()) {
        clearOwnedAttribute("data-rdsh-code-pre");
        clearOwnedAttribute("data-rdsh-code-scroll");
        return;
      }
      for (const pre of document.querySelectorAll("[data-rdsh-rightpanel] [data-textpreview-body] pre:not([data-rdsh-code-pre])")) {
        pre.setAttribute("data-rdsh-code-pre", "");
        let node = pre.parentElement;
        while (node !== null && node !== document.body) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") {
            node.setAttribute("data-rdsh-code-scroll", "");
            break;
          }
          node = node.parentElement;
        }
      }
    }

    // ---------------------------------------------------------------------
    // #34 / #35: review wrap default and the phone preview kebab
    //
    // Both features own only their `data-rdsh-*` hooks and only act inside the
    // right panel. The upstream surfaces are matched through attributes
    // (`data-changes-review`, `data-textpreview-*`), never through a hashed
    // class. A wide desktop never gets a node, an attribute or a style from
    // this section: decoration creates the kebab only in the phone query, and
    // `clearPhoneHooks` takes everything down when the window widens.
    // ---------------------------------------------------------------------

    /** True only while a user (not this plugin) changed a review wrap toggle. */
    let reviewWrapProbeTimer = 0;
    /** Auto-fired / opted-out surfaces; pane ids survive a rerender of the root. */
    let reviewWrapAutoFired = new WeakSet();
    let reviewWrapUserOff = new WeakSet();
    /** root -> surface key marked auto-fired; a new root is a new surface. */
    let reviewWrapAutoRootKeys = new WeakMap();
    const reviewWrapUserOffKeys = new Set();

    /** The stable piece of a review surface: its dockkit pane, else its file. */
    function reviewSurfaceKey(root) {
      const pane = root.closest?.("[data-dockkit-pane]");
      const paneId = pane === null || pane === undefined ? null : pane.getAttribute("data-dockkit-pane");
      if (paneId !== null && paneId !== "") {
        // dockkit gives every tab an id and only the active pane's active tab
        // is laid out, so this identifies the review tab across rerenders.
        const tab = pane.querySelector?.('[data-dockkit-tab][aria-selected="true"]');
        const tabId = tab === null || tab === undefined ? null : tab.getAttribute("data-dockkit-tab");
        if (tabId !== null && tabId !== "") return `pane:${paneId}:tab:${tabId}`;
        return `pane:${paneId}`;
      }
      const file = root.querySelector?.("[data-review-file]");
      const path = file === null || file === undefined ? null : file.getAttribute("data-review-file");
      if (path !== null && path !== "") return `file:${path}`;
      return "";
    }

    function reviewWrapIsOff(root) {
      // Keyed surfaces must decide by the pane/tab key only. React reuses the
      // root when the pane switches tabs; a root-level OFF from tab A would
      // otherwise block tab B's default. Keyless surfaces fall back to root.
      const key = reviewSurfaceKey(root);
      if (key !== "") return reviewWrapUserOffKeys.has(key);
      return reviewWrapUserOff.has(root);
    }

    function reviewWrapAutoDone(root) {
      const key = reviewSurfaceKey(root);
      // The pair, not the tab key alone: React reuses the root when switching
      // tabs (new key must get its own default), and a remount creates a new
      // root (a new surface with no user choice gets the default again).
      if (reviewWrapAutoRootKeys.has(root)) return reviewWrapAutoRootKeys.get(root) === key;
      if (key === "") return root.getAttribute("data-rdsh-review-auto") === "1";
      return false;
    }

    function markReviewWrapAuto(root) {
      const key = reviewSurfaceKey(root);
      reviewWrapAutoRootKeys.set(root, key);
      if (key !== "") return;
      // Only keyless surfaces need a DOM marker, and only their own wrapper:
      // there is no tab identity to keep the two apart otherwise.
      reviewWrapAutoFired.add(root);
      // A desktop click is remembered, but the mobile hooks are not painted
      // in desktop mode (the 390px desktop must stay untouched).
      if (!phone()) return;
      root.setAttribute("data-rdsh-review-auto", "1");
    }

    function suppressReviewWrap(root) {
      reviewWrapUserOff.add(root);
      const key = reviewSurfaceKey(root);
      if (key !== "") reviewWrapUserOffKeys.add(key);
      if (phone()) root.setAttribute("data-rdsh-review-off", "");
      markReviewWrapAuto(root);
    }

    function allowReviewWrap(root) {
      reviewWrapUserOff.delete(root);
      const key = reviewSurfaceKey(root);
      if (key !== "") reviewWrapUserOffKeys.delete(key);
      if (phone()) root.removeAttribute("data-rdsh-review-off");
      markReviewWrapAuto(root);
    }

    /**
     * Turn wrap on once per review surface, through upstream's own button.
     *
     * Clicking the real `[data-review-tool="wrap"]` is what makes upstream
     * render the wrapped layout; forcing CSS alone leaves the side-by-side
     * grid (and its horizontal travel) in place. A user who turns it off wins:
     * the surface (pane id, else file path) is remembered for this page and is
     * never clicked again, including after React replaces the review root.
     *
     * Upstream side effect, stated in the PR: with wrap on, the diff falls back
     * from side-by-side to the unified row layout. This plugin never clicks the
     * split toggle, so a reader who wants both columns turns wrap off and that
     * choice stays off for the surface.
     */
    function decorateReviewWrap() {
      if (!phone() || REVIEW_WRAP_DEFAULT !== true) return;
      for (const root of document.querySelectorAll("[data-rdsh-rightpanel] [data-changes-review]")) {
        const toggle = root.querySelector('[data-review-tool="wrap"]');
        root.setAttribute("data-rdsh-review", "");
        if (toggle === null) continue;
        if (toggle.disabled === true) continue;
        if (toggle.getAttribute("aria-pressed") === "true") root.setAttribute("data-rdsh-review-wrap", "");
        else root.removeAttribute("data-rdsh-review-wrap");
        const pressed = toggle.getAttribute("aria-pressed") === "true";
        // An explicit user OFF wins; see noteReviewWrapClick.
        if (reviewWrapIsOff(root)) {
          root.setAttribute("data-rdsh-review-off", "");
          continue;
        }
        // A reused root can still carry the previous tab's OFF attribute; the
        // key decides, so drop the stale hook before applying tab B's default.
        root.removeAttribute("data-rdsh-review-off");
        if (pressed) {
          if (!reviewWrapAutoDone(root)) markReviewWrapAuto(root);
          continue;
        }
        if (reviewWrapAutoDone(root)) continue;
        markReviewWrapAuto(root);
        toggle.click();
      }
    }

    /**
     * Remember a real user's wrap choice after React has committed the toggle.
     *
     * `HTMLElement.click()` from this plugin produces an untrusted event, so an
     * explicit OFF (untrusted === false) can never be mistaken for our own
     * default-on click. The check runs after the upstream handler so the new
     * `aria-pressed` is the source of truth.
     */
    function noteReviewWrapClick(event) {
      if (event.isTrusted !== true) return;
      const toggle = event.target.closest?.('[data-review-tool="wrap"]');
      if (toggle === null || toggle === undefined) return;
      const root = toggle.closest("[data-changes-review]");
      if (root === null) return;
      const pane = root.closest("[data-dockkit-pane]");
      clearTimeout(reviewWrapProbeTimer);
      reviewWrapProbeTimer = setTimeout(() => {
        const liveRoot = pane !== null && pane.isConnected ? pane.querySelector("[data-changes-review]") : root;
        if (liveRoot === null || liveRoot.isConnected !== true) return;
        const current = liveRoot.querySelector('[data-review-tool="wrap"]');
        if (current === null) return;
        if (current.getAttribute("aria-pressed") === "true") allowReviewWrap(liveRoot);
        else suppressReviewWrap(liveRoot);
        scheduleDecorate();
      }, 0);
    }

    /** The preview menu currently owned by the kebab (null when closed). */
    let previewMenu = null;
    let previewMenuAnchor = null;
    let previewMenuHeader = null;
    let previewMenuDismiss = null;
    let previewMenuSignature = "";
    let previewMenuSeq = 0;

    /**
     * The header that owns a text preview: the path's direct parent, and only
     * when it also carries Reload. Climbing further could mistake a container
     * holding several previews for one header.
     */
    function previewHeaderOf(path) {
      const header = path.parentElement;
      if (header === null || header === document.body) return null;
      return header.querySelector?.('[data-textpreview-tool="reload"]') !== null && header.querySelector?.('[data-textpreview-tool="reload"]') !== undefined
        ? header
        : null;
    }

    function previewActionLabel(button) {
      const aria = button.getAttribute("aria-label");
      if (aria !== null && aria.trim() !== "") return aria.trim();
      const title = button.getAttribute("title");
      if (title !== null && title.trim() !== "") return title.trim();
      return (button.textContent || "").trim().replace(/\s+/g, " ");
    }

    /**
     * Buttons the kebab may offer.
     *
     * The path and the viewer picker stay in the header (the picker renders
     * the current renderer's name and its upstream Menu is anchored to the
     * visible button). Wrap is excluded on purpose: the phone stylesheet
     * already forces text previews to wrap, so the stock toggle is hidden by
     * the same query and would be a dead control. `#33`'s native open targets
     * and upstream's deliberately-hidden auto-refresh stay out too.
     */
    function previewSecondaryButtons(header) {
      return [...header.querySelectorAll("button")].filter((button) => {
        if (button.hasAttribute("data-rdsh-preview-kebab")) return false;
        if (button.hasAttribute("data-document-viewer-menu")) return false;
        if (button.getAttribute("data-textpreview-tool") === "wrap") return false;
        if (button.closest("[hidden]") !== null) return false;
        if (button.closest(OPEN_TARGET_SELECTOR) !== null) return false;
        return previewActionLabel(button) !== "";
      });
    }

    function previewMenuSignatureOf(header) {
      return previewSecondaryButtons(header)
        .map((button) => `${previewActionLabel(button)}:${button.disabled === true ? "1" : "0"}:${button.getAttribute("aria-pressed") ?? ""}`)
        .join("|");
    }

    function closePreviewMenu({ restore = false } = {}) {
      if (previewMenu === null) return false;
      const menu = previewMenu;
      const anchor = previewMenuAnchor;
      menu.remove();
      if (previewMenuDismiss !== null) {
        document.removeEventListener("pointerdown", previewMenuDismiss.pointer, true);
        document.removeEventListener("keydown", previewMenuDismiss.key, true);
        window.removeEventListener("resize", previewMenuDismiss.resize);
        previewMenuDismiss = null;
      }
      anchor?.setAttribute("aria-expanded", "false");
      anchor?.removeAttribute("aria-controls");
      previewMenu = null;
      previewMenuAnchor = null;
      previewMenuHeader = null;
      previewMenuSignature = "";
      if (restore && anchor !== null && anchor !== undefined && anchor.isConnected) anchor.focus({ preventScroll: true });
      return true;
    }

    function livePreviewAction(header, button) {
      if (header.isConnected !== true) return null;
      // Resolve by the visible label first: a rerender may reuse an action id
      // for a different control, and calling the wrong one is worse than not
      // finding it. The id remains a fallback for an unlabelled icon button.
      const label = previewActionLabel(button);
      const byLabel = previewSecondaryButtons(header).find((entry) => previewActionLabel(entry) === label);
      if (byLabel !== undefined) return byLabel;
      const id = button.getAttribute("data-rdsh-preview-action");
      if (id === null) return null;
      return header.querySelector(`[data-rdsh-preview-action="${cssValue(id)}"]`);
    }

    function focusPreviewMenuItem(index) {
      if (previewMenu === null) return;
      const items = [...previewMenu.querySelectorAll('[role="menuitem"]')].filter((item) => item.disabled !== true);
      if (items.length === 0) return;
      const at = Math.max(0, Math.min(items.length - 1, index));
      items[at].focus({ preventScroll: true });
    }

    function onPreviewMenuKey(event) {
      if (previewMenu === null) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePreviewMenu({ restore: true });
        return;
      }
      const active = document.activeElement;
      if (active === null || !previewMenu.contains(active)) return;
      const items = [...previewMenu.querySelectorAll('[role="menuitem"]')].filter((item) => item.disabled !== true);
      if (items.length === 0) return;
      const at = items.indexOf(active);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusPreviewMenuItem(at < 0 ? 0 : (at + 1) % items.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusPreviewMenuItem(at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusPreviewMenuItem(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusPreviewMenuItem(items.length - 1);
      } else if (event.key === "Tab") {
        // Let the browser move focus, but do not leave a floating menu behind.
        closePreviewMenu({ restore: false });
      }
    }

    function openPreviewMenu(header, kebab, focusLast = false) {
      closePreviewMenu();
      const buttons = previewSecondaryButtons(header);
      if (buttons.length === 0) return false;
      const menu = document.createElement("div");
      menu.className = "rdsh-mux-preview-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", t("mux.preview.menu"));
      menu.setAttribute("data-rdsh-preview-menu", "");
      menu.id = `rdsh-preview-menu-${++previewMenuSeq}`;
      for (const button of buttons) {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.setAttribute("tabindex", "-1");
        item.textContent = previewActionLabel(button);
        item.disabled = button.disabled === true;
        if (item.disabled) item.setAttribute("aria-disabled", "true");
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const live = livePreviewAction(header, button);
          closePreviewMenu({ restore: true });
          if (live !== null && live.disabled !== true) live.click();
        });
        menu.append(item);
      }
      // The listener is registered before the menu is shown so a tap on the
      // very next frame cannot miss it; closing removes both listeners.
      const dismiss = (event) => {
        if (previewMenu?.contains(event.target)) return;
        if (previewMenuAnchor?.contains(event.target)) return;
        closePreviewMenu({ restore: false });
      };
      const key = (event) => onPreviewMenuKey(event);
      const resize = () => closePreviewMenu({ restore: false });
      previewMenu = menu;
      previewMenuAnchor = kebab;
      previewMenuHeader = header;
      previewMenuSignature = previewMenuSignatureOf(header);
      previewMenuDismiss = { pointer: dismiss, key, resize };
      document.addEventListener("pointerdown", dismiss, true);
      document.addEventListener("keydown", key, true);
      window.addEventListener("resize", resize);
      document.body.append(menu);
      const rect = kebab.getBoundingClientRect();
      const width = Math.min(240, window.innerWidth - 24);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.round(Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)))}px`;
      const height = menu.getBoundingClientRect().height;
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 6);
      menu.style.top = `${Math.round(top)}px`;
      kebab.setAttribute("aria-expanded", "true");
      kebab.setAttribute("aria-controls", menu.id);
      const enabled = [...menu.querySelectorAll('[role="menuitem"]')].filter((item) => item.disabled !== true);
      const target = focusLast ? enabled[enabled.length - 1] : enabled[0];
      target?.focus({ preventScroll: true });
      return true;
    }

    function togglePreviewMenu(header, kebab) {
      if (previewMenu !== null && previewMenuAnchor === kebab) {
        closePreviewMenu({ restore: true });
        return;
      }
      openPreviewMenu(header, kebab);
    }

    /**
     * Keep an open menu in step with upstream instead of closing it.
     *
     * A rerender can disable a control (busy reload) or relabel it; mirroring
     * that into the existing items preserves focus and avoids a menu that
     * disappears under the user's finger. A changed item count (a new action
     * appeared) cannot be mapped safely, so that case closes the menu.
     */
    function refreshPreviewMenuItems() {
      if (previewMenu === null || previewMenuHeader === null) return false;
      const buttons = previewSecondaryButtons(previewMenuHeader);
      const items = [...previewMenu.querySelectorAll('[role="menuitem"]')];
      if (items.length !== buttons.length) return false;
      for (let index = 0; index < items.length; index += 1) {
        const button = buttons[index];
        const item = items[index];
        item.textContent = previewActionLabel(button);
        const disabled = button.disabled === true;
        item.disabled = disabled;
        if (disabled) item.setAttribute("aria-disabled", "true");
        else item.removeAttribute("aria-disabled");
      }
      return true;
    }

    function ensurePreviewKebab(header) {
      let kebab = [...header.children].find((child) => child.hasAttribute?.("data-rdsh-preview-kebab"));
      if (kebab !== undefined) return kebab;
      kebab = document.createElement("button");
      kebab.type = "button";
      kebab.className = "rdsh-mux-preview-kebab";
      kebab.setAttribute("data-rdsh-preview-kebab", "");
      kebab.setAttribute("aria-label", t("mux.preview.more"));
      kebab.setAttribute("aria-haspopup", "menu");
      kebab.setAttribute("aria-expanded", "false");
      kebab.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>';
      kebab.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePreviewMenu(header, kebab);
      });
      kebab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        // The same keydown bubbles to the document handler; without this the
        // just-opened menu would immediately advance one extra item.
        event.stopPropagation();
        openPreviewMenu(header, kebab, event.key === "ArrowUp");
      });
      header.append(kebab);
      return kebab;
    }

    /** Tag headers, refresh moved actions and close a menu that went stale. */
    function decoratePreviewTools() {
      if (!phone()) {
        clearPreviewTools();
        return;
      }
      const seenHeaders = new Set();
      for (const path of document.querySelectorAll("[data-rdsh-rightpanel] [data-textpreview-path]")) {
        const header = previewHeaderOf(path);
        if (header === null) continue;
        seenHeaders.add(header);
        header.setAttribute("data-rdsh-preview-header", "");
        // Recompute the moved set every pass: a changed file can add or remove
        // an upstream action in the same header.
        const secondary = new Set(previewSecondaryButtons(header));
        for (const old of header.querySelectorAll("[data-rdsh-preview-secondary]")) {
          if (!secondary.has(old)) {
            old.removeAttribute("data-rdsh-preview-secondary");
            old.removeAttribute("data-rdsh-preview-action");
          }
        }
        let index = 0;
        for (const button of secondary) {
          button.setAttribute("data-rdsh-preview-secondary", "");
          button.setAttribute("data-rdsh-preview-action", String(index++));
        }
        ensurePreviewKebab(header);
      }
      if (previewMenu !== null) {
        const alive = seenHeaders.has(previewMenuHeader)
          && previewMenuAnchor?.isConnected === true
          && previewMenuHeader.contains(previewMenuAnchor);
        if (!alive) {
          closePreviewMenu({ restore: false });
        } else {
          const signature = previewMenuSignatureOf(previewMenuHeader);
          if (signature !== previewMenuSignature) {
            if (refreshPreviewMenuItems()) previewMenuSignature = signature;
            else closePreviewMenu({ restore: false });
          }
        }
      }
      decorateReviewWrap();
    }

    /**
     * Remove every node, attribute and listener this section owns.
     *
     * Deliberately leaves the per-surface memory alone: a user's explicit OFF
     * must survive a phone -> desktop -> phone round trip. Only dispose clears
     * that memory.
     */
    function clearPreviewTools() {
      closePreviewMenu();
      for (const attribute of ["data-rdsh-preview-header", "data-rdsh-preview-secondary", "data-rdsh-preview-action", "data-rdsh-review", "data-rdsh-review-wrap", "data-rdsh-review-auto", "data-rdsh-review-off"]) {
        for (const element of document.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
      }
      for (const node of document.querySelectorAll("[data-rdsh-preview-kebab]")) node.remove();
      // An auto-fired surface is not a user choice: after a width round trip a
      // remounted review should get the default once again. An explicit OFF is
      // different and stays in `reviewWrapUserOff*` until dispose.
      reviewWrapAutoFired = new WeakSet();
      reviewWrapAutoRootKeys = new WeakMap();
    }

    /** Full teardown: DOM plus the in-memory choices (boot dispose only). */
    function disposePreviewTools() {
      clearPreviewTools();
      clearTimeout(reviewWrapProbeTimer);
      reviewWrapProbeTimer = 0;
      reviewWrapAutoFired = new WeakSet();
      reviewWrapUserOff = new WeakSet();
      reviewWrapAutoRootKeys = new WeakMap();
      reviewWrapUserOffKeys.clear();
    }

    function decorateRightPanel() {
      // #44: the panel hooks and the open marker belong to mobile mode.
      // Desktop drops the observer and both attributes instead of keeping a
      // stale state that #46's stacking rule could apply there.
      if (!phone()) {
        forgetRightPanel();
        return;
      }
      const collapse = visibleCollapseButton();
      if (collapse === null) {
        // No laid-out panel anywhere: close the state instead of keeping the
        // last one. A full-screen route (Plugins, Automation tasks) leaves the
        // chat's panel mounted but unrendered, and a stale "open" hides the
        // header and the drawer button.
        if (rightPanelNode !== null) forgetRightPanel();
        return;
      }
      const boundary = collapse.closest(RIGHT_PANEL_ROOT);
      // The panel is the nearest ancestor that already spans the phone (the
      // fullscreen layer), not a hash-named class that changes per release.
      let node = collapse.parentElement;
      while (node !== null && node !== boundary && node !== document.body) {
        const rect = node.getBoundingClientRect();
        if (rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.5) {
          // A rotation changes those thresholds, so the next pass can pick a
          // different node; exactly one may carry the hook.
          for (const stale of document.querySelectorAll("[data-rdsh-rightpanel]")) {
            if (stale !== node) stale.removeAttribute("data-rdsh-rightpanel");
          }
          node.setAttribute("data-rdsh-rightpanel", "");
          watchRightPanel(node);
          return;
        }
        node = node.parentElement;
      }
      if (rightPanelNode !== null) forgetRightPanel();
    }

    /**
     * Mark the right panel's tabs.
     *
     * dockkit draws them as `[role="tab"][data-dockkit-tab]`; the attribute is
     * the stable part (the class is hashed per release), and the stylesheet
     * needs its own hook to size and pan them on a phone. The tap compensation
     * lives in the pointer handlers below and keys off the same attribute.
     */
    function decorateRightPanelTabs() {
      if (!phone()) {
        clearOwnedAttribute("data-rdsh-rtab");
        return;
      }
      for (const tab of document.querySelectorAll('[data-rdsh-rightpanel] [role="tab"][data-dockkit-tab]')) {
        tab.setAttribute("data-rdsh-rtab", "");
      }
    }

    /** The plugin context, kept so the session projection can be looked up. */
    let hostCtx = null;
    /** An optional service, without cordis' absent-service property throw. */
    function optionalService(name) {
      if (hostCtx === null || typeof hostCtx.get !== "function") return null;
      try {
        return hostCtx.get(name) ?? null;
      } catch (error) {
        return null;
      }
    }

    /** `sessions` is optional: resolving it per call keeps a late provider and
     *  a replaced client generation working, and an absent one only costs the
     *  used/max text. */
    function sessionsService() {
      return optionalService("sessions");
    }

    /** Mirrors the upstream `formatTokens` so the dock and the panel agree. */
    function formatTokenCount(value) {
      const scaled = (candidate) => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10));
      if (value < 1e3) return String(Math.round(value));
      if (value < 1e6) return `${scaled(value / 1e3)}K`;
      return `${scaled(value / 1e6)}M`;
    }

    /**
     * The `contextPressure` projection, from the public Session list snapshot.
     *
     * `ClientSessions.projectionValues()` is a private manager method: calling
     * it on the service threw a TypeError, so the dock never had figures. The
     * list snapshot carries the same finished values the upstream
     * `useProjection("contextPressure")` seat reads — `byId[id].projectionValues`
     * is the documented row face, and `projectionsBySession[id].values` is the
     * same value for a row whose summary hint has not landed yet.
     */
    function contextPressureOf(sessions, sessionId) {
      try {
        const snapshot = typeof sessions.list?.getSnapshot === "function" ? sessions.list.getSnapshot() : null;
        if (snapshot === null || typeof snapshot !== "object") return null;
        const hint = snapshot.byId?.[sessionId]?.projectionValues?.contextPressure;
        if (hint !== null && hint !== undefined && typeof hint === "object") return hint;
        const values = snapshot.projectionsBySession?.[sessionId]?.values?.contextPressure;
        return values !== null && values !== undefined && typeof values === "object" ? values : null;
      } catch (error) {
        return null;
      }
    }

    /** Ask the host once per Session for a projection the list has not carried. */
    let contextRefreshFor = null;
    function requestContextRefresh(sessions, sessionId) {
      if (contextRefreshFor === sessionId) return;
      contextRefreshFor = sessionId;
      if (typeof sessions.refreshProjections !== "function") return;
      try {
        const pending = sessions.refreshProjections(sessionId);
        if (pending !== null && typeof pending?.catch === "function") pending.catch(() => {});
      } catch (error) {
        /* older client: the percentage alone is still correct */
      }
    }

    /**
     * "12.3K/1M" for the context meter, read from the Session projection.
     *
     * The panel that shows these figures is only mounted while it is open, so
     * the old code opened it with a real click, read the DOM after 80ms and
     * closed it again — which flashed the menu (and, through the
     * `*_panel` CSS, any other dialog) on every update. The projection carries
     * the same numbers without touching the DOM; when it is missing the dock
     * falls back to the percentage that the button's aria-label already has.
     *
     * The numerator is the same pair upstream's `contextOccupancy` uses: the
     * provider-anchored `pressureTokens` plus the heuristic reprice of what the
     * surface gained since that sample. `contextWindow` is the route capacity.
     */
    function contextUsageText(sessionId = decoratedSessionId()) {
      const sessions = sessionsService();
      if (sessions === null || sessions === undefined || sessionId === null || sessionId === undefined) return "";
      const pressure = contextPressureOf(sessions, sessionId);
      if (pressure === null) {
        requestContextRefresh(sessions, sessionId);
        return "";
      }
      const used = pressure.projectedTokens ?? pressure.pressureTokens;
      const window = pressure.contextWindow;
      if (typeof used !== "number" || typeof window !== "number" || !(window > 0)) return "";
      return `${formatTokenCount(used)}/${formatTokenCount(window)}`;
    }

    let settingsArrows = null;
    let settingsTabResetPending = false;

    /** Reset the options scroller only after the new tab's section has been
     *  committed. Resetting on the click scrolls the old section first, which
     *  is the visible "flick" on iOS. */
    function observeSettingsOptions(modal) {
      const options = modal.querySelector('[class*="VOzbGW_options"]');
      if (options === null || options.hasAttribute("data-rdsh-options-observer")) return null;
      options.setAttribute("data-rdsh-options-observer", "");
      const observer = new MutationObserver(() => {
        if (!settingsTabResetPending) return;
        settingsTabResetPending = false;
        if (options.scrollTop !== 0) options.scrollTop = 0;
      });
      observer.observe(options, { childList: true, subtree: true });
      return observer;
    }

    function settingsNavList() {
      const modal = document.querySelector('[data-shortcut-modal="settings"]');
      if (modal === null) return null;
      const nav = modal.querySelector("nav");
      const list = nav === null ? null : nav.querySelector('[class*="navList"]');
      return list === null || nav === null ? null : { modal, nav, list };
    }

    function positionSettingsArrows() {
      if (settingsArrows === null) return;
      const found = settingsNavList();
      if (found === null) {
        settingsArrows.left.hidden = true;
        settingsArrows.right.hidden = true;
        return;
      }
      const { list } = found;
      settingsArrows.list = list;
      const rect = list.getBoundingClientRect();
      const firstTab = list.querySelector("button");
      const tabRect = firstTab === null ? rect : firstTab.getBoundingClientRect();
      const top = `${Math.round(tabRect.top + (tabRect.height - 30) / 2)}px`;
      settingsArrows.left.style.left = `${Math.round(rect.left + 2)}px`;
      settingsArrows.left.style.top = top;
      settingsArrows.right.style.left = `${Math.round(rect.right - 32)}px`;
      settingsArrows.right.style.top = top;
      const max = Math.max(0, list.scrollWidth - list.clientWidth);
      const canLeft = list.scrollLeft > 2;
      const canRight = list.scrollLeft < max - 2;
      settingsArrows.left.hidden = !canLeft;
      settingsArrows.right.hidden = !canRight;
      list.toggleAttribute("data-rdsh-fade-left", canLeft);
      list.toggleAttribute("data-rdsh-fade-right", canRight);
    }

    /**
     * Remove the settings arrows and every listener/observer that came with
     * them. Reached on dispose and the defensive desktop boot, so a desktop
     * gets neither the nodes nor a listener that keeps scrolling an invisible list.
     */
    function clearSettingsNavArrows() {
      const state = settingsArrows;
      if (state === null) return;
      settingsArrows = null;
      state.observer?.disconnect();
      if (state.list !== null) {
        if (state.scrollHandler !== null) state.list.removeEventListener("scroll", state.scrollHandler);
        if (state.tabHandler !== null) state.list.removeEventListener("click", state.tabHandler, true);
        for (const attribute of ["data-rdsh-nav-scroll", "data-rdsh-nav-tabclick", "data-rdsh-fade-left", "data-rdsh-fade-right"]) {
          state.list.removeAttribute(attribute);
        }
      }
      for (const modal of document.querySelectorAll('[data-shortcut-modal="settings"]')) {
        for (const options of modal.querySelectorAll("[data-rdsh-options-observer]")) options.removeAttribute("data-rdsh-options-observer");
      }
      state.left.remove();
      state.right.remove();
    }

    function installSettingsNavArrows() {
      if (!phone()) {
        clearSettingsNavArrows();
        return;
      }
      const found = settingsNavList();
      if (found === null) {
        if (settingsArrows !== null) {
          settingsArrows.left.hidden = true;
          settingsArrows.right.hidden = true;
        }
        return;
      }
      if (settingsArrows === null) {
        const make = (side) => {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("data-rdsh-settings-nav-arrow", side);
          button.setAttribute("aria-label", side === "left" ? t("mux.nav.scrollLeft") : t("mux.nav.scrollRight"));
          button.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${side === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"}"/></svg>`;
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const list = settingsArrows === null ? null : settingsArrows.list;
            if (list === null) return;
            const amount = Math.max(140, list.clientWidth * 0.7);
            list.scrollBy({ left: side === "left" ? -amount : amount, behavior: "smooth" });
          });
          document.body.append(button);
          return button;
        };
        settingsArrows = {
          left: make("left"),
          right: make("right"),
          list: null,
          modal: null,
          observer: null,
          scrollHandler: null,
          tabHandler: null,
        };
      }
      const { list, modal } = found;
      if (settingsArrows.list !== list) {
        // The previous modal/list is gone: its observer and listeners must go
        // with it, not stay attached to a detached node.
        settingsArrows.observer?.disconnect();
        settingsArrows.observer = null;
        settingsArrows.scrollHandler = null;
        settingsArrows.tabHandler = null;
        settingsArrows.list = list;
        settingsArrows.modal = modal;
      }
      if (!list.hasAttribute("data-rdsh-nav-scroll")) {
        list.setAttribute("data-rdsh-nav-scroll", "");
        settingsArrows.scrollHandler = positionSettingsArrows;
        list.addEventListener("scroll", settingsArrows.scrollHandler, { passive: true });
      }
      if (!list.hasAttribute("data-rdsh-nav-tabclick")) {
        list.setAttribute("data-rdsh-nav-tabclick", "");
        settingsArrows.tabHandler = (event) => {
          if (event.target.closest("[data-rdsh-settings-nav-arrow]") !== null) return;
          if (event.target.closest("button") === null) return;
          settingsTabResetPending = true;
        };
        list.addEventListener("click", settingsArrows.tabHandler, true);
      }
      if (settingsArrows.observer === null) settingsArrows.observer = observeSettingsOptions(modal);
      positionSettingsArrows();
    }

    function decorateStatsDock() {
      // `contextUsedMax` below opens the context panel to read its figures and
      // closes it again. The probe only hides itself on a phone, so on a wide
      // screen the panel would flash open on every decorate pass.
      if (!phone()) {
        clearOwnedAttribute("data-rdsh-stat-text");
        return;
      }
      // A projection frame has to repaint the dock even when the upstream
      // aria-label (the percentage) did not change.
      watchActivitySources();
      const dock = document.querySelector("[data-rdsh-composer-dock]");
      if (dock === null) return;
      const buttons = [...dock.querySelectorAll("button")].filter((button) => button.getAttribute("aria-label") !== null);
      const ariaOf = (button) => button.getAttribute("aria-label") || "";
      const activity = buttons.find((button) => TURNS_PROBE.test(ariaOf(button)));
      const usage = buttons.find((button) => CACHE_PROBE.test(ariaOf(button)));
      const context = buttons.find((button) => CONTEXT_PROBE.test(ariaOf(button)));

      const set = (button, text) => {
        if (button === undefined) return;
        if (text === "") button.removeAttribute("data-rdsh-stat-text");
        else if (button.getAttribute("data-rdsh-stat-text") !== text) button.setAttribute("data-rdsh-stat-text", text);
      };

      if (activity !== undefined) {
        const aria = ariaOf(activity);
        const numbers = aria.match(/\d[\d,.]*(?:\s*[KMB])?/gi) || [];
        const turns = numbers[0];
        const tok = numbers.length > 1 ? numbers[numbers.length - 1] : undefined;
        const turnsLabel = turns === undefined
          ? ""
          : t(turns === "1" ? "mux.stats.turn" : "mux.stats.turns", { count: turns });
        set(activity, tok === undefined || turnsLabel === ""
          ? turnsLabel
          : `${turnsLabel} · ${t("mux.stats.tokPerSec", { speed: tok })}`);
      }
      if (usage !== undefined) {
        const percents = [...ariaOf(usage).matchAll(/(\d+)%/g)];
        const hit = percents.length > 0 ? percents[percents.length - 1][1] : undefined;
        set(usage, hit === undefined ? "" : t("mux.stats.cacheHit", { percent: hit }));
      }
      if (context !== undefined) {
        const percent = ariaOf(context).match(/(\d+)%/);
        const usedMax = percent === null ? "" : contextUsageText();
        set(context, percent === null ? "" : `${percent[1]}%${usedMax === "" ? "" : ` · ${usedMax}`}`);
      }
    }

    /**
     * The model-search field and the pointerdown listener this module added to
     * its row. Kept so dispose and the desktop boot can remove the listener
     * and put `disabled` back; a desktop must not inherit the mobile disabled
     * search.
     */
    let modelSearchState = null;

    function clearModelSearch() {
      const record = modelSearchState;
      modelSearchState = null;
      if (record === null) return;
      if (record.row !== null) record.row.removeEventListener("pointerdown", record.handler, true);
      if (record.input.isConnected) record.input.disabled = record.wasDisabled;
    }

    function decorateModelSearch() {
      if (!phone()) {
        clearModelSearch();
        return;
      }
      // The picker was closed and React took the input with it. Forget the tap
      // that enabled it, so the next open starts disabled again.
      if (modelSearchState !== null && !modelSearchState.input.isConnected) clearModelSearch();
      const menu = document.querySelector('[class*="_7KE1Ra_menu"]');
      if (menu === null) return;
      const input = menu.querySelector("input");
      if (input === null) return;
      if (modelSearchState !== null && modelSearchState.input !== input) clearModelSearch();
      if (!input.hasAttribute("data-rdsh-model-search")) {
        input.setAttribute("data-rdsh-model-search", "");
        const row = input.closest('[class*="_7KE1Ra_searchRow"]') ?? input.parentElement;
        if (row !== null) {
          row.setAttribute("data-rdsh-model-search-row", "");
          // The picker focuses this field by itself when it opens the model
          // pane. Disabled inputs ignore .focus(), so opening the picker no
          // longer pulls focus (or the keyboard) into the search.
          const handler = () => {
            input.disabled = false;
            // Record the tap on the record itself: the app re-renders the
            // picker on pointerdown, and the next decorate pass would disable
            // and blur the field before its own rAF focus could run.
            if (modelSearchState !== null && modelSearchState.input === input) modelSearchState.active = true;
            requestAnimationFrame(() => input.focus({ preventScroll: true }));
          };
          row.addEventListener("pointerdown", handler, true);
          modelSearchState = { input, row, handler, wasDisabled: input.disabled, active: false };
        }
      }
      // Once the user has tapped the row the field belongs to them until the
      // picker closes; re-disabling it here is what dropped the keyboard.
      if (modelSearchState !== null && modelSearchState.input === input && modelSearchState.active) return;
      if (!input.disabled) input.disabled = true;
      if (document.activeElement === input) input.blur();
    }

    /**
     * The tabindex/title/role values the Todo and Goal rows had before this
     * module wrote on them, so a resize restores upstream state instead of
     * deleting an attribute that was not ours.
     */
    const detailRowOriginal = new WeakMap();

    function clearDetailPanelHooks() {
      for (const item of document.querySelectorAll("[data-rdsh-todo-item], [data-rdsh-goal-objective]")) {
        const original = detailRowOriginal.get(item);
        if (original !== undefined) {
          detailRowOriginal.delete(item);
          for (const [name, value] of Object.entries(original)) {
            if (value === null) item.removeAttribute(name);
            else item.setAttribute(name, value);
          }
        }
      }
      for (const attribute of ["data-rdsh-todo-item", "data-rdsh-todo-text", "data-rdsh-todo-status", "data-rdsh-goal-objective", "data-rdsh-goal-text", "data-rdsh-goal-actions", "data-rdsh-goal-editing"]) {
        for (const element of document.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
      }
    }

    function rememberDetailRow(element, names) {
      if (detailRowOriginal.has(element)) return;
      const original = {};
      for (const name of names) original[name] = element.getAttribute(name);
      detailRowOriginal.set(element, original);
    }

    function decorateTodoPanel() {
      if (!phone()) {
        clearDetailPanelHooks();
        return;
      }
      const panel = document.querySelector('[data-testid="todo-panel"]');
      if (panel === null) return;
      for (const item of panel.querySelectorAll("li")) {
        const content = item.querySelector('[class*="_content"]');
        if (content === null) continue;
        const text = (content.textContent || "").trim();
        if (text === "") continue;
        rememberDetailRow(item, ["tabindex", "title"]);
        item.setAttribute("data-rdsh-todo-item", "");
        item.setAttribute("data-rdsh-todo-text", text);
        const status = item.querySelector('[role="img"][aria-label]');
        if (status !== null) item.setAttribute("data-rdsh-todo-status", status.getAttribute("aria-label") || "");
        // No `role="button"` here: the row already contains the real checkbox
        // button, and nesting an interactive role inside another one is
        // invalid. `tabindex` keeps the text reachable from the keyboard (the
        // keydown handler below opens the popover), which is what the role was
        // buying.
        item.setAttribute("tabindex", "0");
        item.setAttribute("title", text);
      }
    }

    function decorateGoalBar() {
      if (!phone()) {
        clearDetailPanelHooks();
        return;
      }
      const bar = document.querySelector("[data-goal-bar]");
      if (bar === null) return;
      const objective = bar.querySelector('[class*="_objective"]');
      if (objective !== null) {
        const text = (objective.textContent || "").trim();
        if (text !== "") {
          rememberDetailRow(objective, ["role", "tabindex", "title"]);
          objective.setAttribute("data-rdsh-goal-objective", "");
          objective.setAttribute("data-rdsh-goal-text", text);
          objective.setAttribute("role", "button");
          objective.setAttribute("tabindex", "0");
          objective.setAttribute("title", text);
        }
      }
      const actions = bar.querySelector('[class*="_actions"]');
      if (actions !== null) actions.setAttribute("data-rdsh-goal-actions", "");
      if (bar.querySelector('[class*="_editBar"]') !== null) bar.setAttribute("data-rdsh-goal-editing", "");
      else bar.removeAttribute("data-rdsh-goal-editing");
    }

    /** Labels a session shows before it has been named (all known locales). */
    const UNTITLED = probeRegex("untitled", "i", ["new session", "new chat", "untitled"], true);
    /** Last title seen per target, so only the first naming animates. */
    const titleSeen = new Map();
    /** How many passes each target has played; a session is named twice. */
    const titlePasses = new Map();
    /** Passes allowed per session: the initial label, then the model's name. */
    const TITLE_PASSES = 2;
    /** When each target was last seen working, to recognise a generated name. */
    const titleWorkingAt = new Map();
    /** How long after a turn a generated name still counts as "just named". */
    const NAME_GRACE_MS = 45000;

    function untitled(text) {
      const value = (text || "").trim();
      return value === "" || UNTITLED.test(value);
    }

    /** Per-character delay while typing; punctuation and spaces pause longer. */
    const TYPE_MS = 44;
    const TYPE_PAUSE_MS = 130;
    /** Erasing is quicker than typing, the way a held backspace reads. */
    const ERASE_MS = 26;
    /** Beat between "empty" and the next name, so the erase is visible. */
    const RETYPE_GAP_MS = 240;

    /**
     * Write a session name over the real one, character by character.
     *
     * React owns the text node, so the real text is made transparent and a
     * positioned copy is animated on top: re-rendering mid-animation cannot
     * leave a half-written title behind, the accessible name never changes,
     * and the layer is removed when the last character lands.
     *
     * A session is named twice — an initial label, then the name the model
     * settles on — so the second pass erases the first one before typing, the
     * way a person would clear the line and start again.
     *
     * @param {Element} element - the title element React renders into.
     * @param {string} next - the name to end on.
     * @param {string} [previous] - the name to erase first.
     */
    /** The text React owns, ignoring the layer this module paints over it. */
    function sessionTitleText(element) {
      let out = "";
      for (const node of element.childNodes) {
        if (node.nodeType === 3) out += node.nodeValue || "";
        else if (node.nodeType === 1 && !node.hasAttribute("data-rdsh-typing-layer")) out += node.textContent || "";
      }
      return out.trim();
    }

    function animateSessionTitle(element, next, previous) {
      if (element.hasAttribute("data-rdsh-typing")) return null;
      element.setAttribute("data-rdsh-typing", "");
      const layer = document.createElement("span");
      layer.setAttribute("data-rdsh-typing-layer", "");
      layer.setAttribute("aria-hidden", "true");
      const caret = document.createElement("span");
      caret.setAttribute("data-rdsh-typing-caret", "");
      let timer = 0;
      let shown = "";
      const stop = () => {
        clearTimeout(timer);
        element.removeAttribute("data-rdsh-typing");
        layer.remove();
      };
      const paint = (value) => {
        shown = value;
        layer.textContent = value;
        layer.append(caret);
      };
      const typeNext = () => {
        let index = 0;
        const step = () => {
          index += 1;
          paint(next.slice(0, index));
          if (index >= next.length) {
            timer = setTimeout(stop, 1100);
            return;
          }
          const char = next[index - 1] || "";
          timer = setTimeout(step, /[。、．，,.!?！？・:;：；\s]/.test(char) ? TYPE_PAUSE_MS : TYPE_MS);
        };
        step();
      };
      const eraseThenType = () => {
        let index = previous.length;
        const step = () => {
          index -= 1;
          paint(previous.slice(0, Math.max(0, index)));
          if (index > 0) {
            timer = setTimeout(step, ERASE_MS);
            return;
          }
          timer = setTimeout(typeNext, RETYPE_GAP_MS);
        };
        step();
      };
      element.append(layer);
      if (typeof previous === "string" && previous !== "") eraseThenType();
      else typeNext();
      // What is on screen right now, so a name that arrives mid-animation can
      // erase it instead of appearing under the running one. `reattach` exists
      // because React writes the title with `textContent`, which drops the
      // layer: without it the real text shows for a frame and the animation
      // starts over from the full previous name.
      return {
        visible: () => shown,
        cancel: stop,
        reattach: () => {
          if (layer.isConnected) return;
          element.append(layer);
          layer.textContent = shown;
          layer.append(caret);
        },
      };
    }

    /** MutationObserver + the elements it watches, so titles retype promptly. */
    let titleTextWatch = null;
    let titleTextTargets = [];
    /** The running animation per target, so a newer name can replace it. */
    const titleAnimations = new Map();

    /**
     * Observe the title elements themselves.
     *
     * The main observer watches childList and a few attributes only: adding
     * characterData there would fire on every streamed transcript token. The
     * generated name arrives as a text change, so it needs its own tiny
     * observer, re-targeted whenever the decorated set changes.
     */
    function watchTitleText(elements) {
      const unchanged = elements.length === titleTextTargets.length
        && elements.every((element, index) => element === titleTextTargets[index]);
      if (unchanged) return;
      if (titleTextWatch === null) titleTextWatch = new MutationObserver(() => scheduleDecorate());
      titleTextWatch.disconnect();
      for (const element of elements) titleTextWatch.observe(element, { childList: true, characterData: true, subtree: true });
      titleTextTargets = elements;
    }

    /**
     * Mark the header title while the session it names is working.
     *
     * The sidebar row already animates, but on a phone the sidebar is usually
     * closed, so the header is the only place that can say "this session is
     * running". The running set comes from the session store: the DOM only
     * carries the id.
     */
    function decorateHeaderTitle() {
      if (!phone()) {
        clearOwnedAttribute("data-rdsh-header-title");
        clearOwnedAttribute("data-rdsh-header-running");
        return;
      }
      const crumb = document.querySelector('[data-rdsh-crumbs] [class*="_crumbCurrent"]');
      if (crumb === null) return;
      crumb.setAttribute("data-rdsh-header-title", "");
      const host = document.querySelector("[data-conversation-session]");
      const id = host === null ? "" : (host.getAttribute("data-conversation-session") || "");
      const running = id !== "" && globalThis.__RDSH_MOBILE_UX_RUNNING__ instanceof Set
        && globalThis.__RDSH_MOBILE_UX_RUNNING__.has(id);
      crumb.toggleAttribute("data-rdsh-header-running", running);
    }

    /**
     * Give a full-screen route heading a mobile-only inset for the FAB.
     *
     * Plugins and Automation tasks render their own H1 near the left edge. On
     * a phone the floating drawer button sits over x8..48, so the heading row
     * needs to start at 56px or later. Identify it structurally: a visible H1
     * in the centre column, outside the conversation/sidebar/chat header, and
     * only when the chat surface is not the one on screen. No upstream hashed
     * class is used.
     */
    function decorateRouteHeading() {
      const tagged = [...document.querySelectorAll("[data-rdsh-route-heading]")];
      const clear = () => {
        for (const wrapper of tagged) wrapper.removeAttribute("data-rdsh-route-heading");
      };
      if (!phone()) {
        clear();
        return;
      }
      const conversation = document.querySelector("[data-rdsh-conversation]");
      if (conversation !== null) {
        const rect = conversation.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0
          && getComputedStyle(conversation).visibility !== "hidden"
          && conversation.closest("[hidden]") === null;
        if (visible) {
          // A chat is on screen: its H1 (welcome card) is not a route heading.
          clear();
          return;
        }
      }
      const scope = document.querySelector("[data-rdsh-center-col]") ?? document.body;
      if (scope === null) {
        clear();
        return;
      }
      const heading = [...scope.querySelectorAll("h1")]
        .filter((h1) => {
          const rect = h1.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          return h1.closest("[data-rdsh-conversation], [data-rdsh-sidebar], [data-rdsh-header], header[data-window-drag], nav, [role='dialog'], [data-shortcut-modal], article") === null;
        })
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (heading === undefined) {
        clear();
        return;
      }
      const wrapper = heading.parentElement;
      if (wrapper === null || wrapper === scope) {
        clear();
        return;
      }
      if (wrapper.hasAttribute("data-rdsh-route-heading") || heading.getBoundingClientRect().left < 56) {
        wrapper.setAttribute("data-rdsh-route-heading", "");
      }
      for (const stale of tagged) {
        if (stale !== wrapper) stale.removeAttribute("data-rdsh-route-heading");
      }
    }

    /**
     * Is this element actually laid out?
     *
     * A full-screen route keeps the previous screen mounted at 0x0 (the same
     * ghost the right-panel code guards against), so carrying an attribute is
     * not the same as being on screen.
     */
    function routeLaidOut(element) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (element.closest("[hidden]") !== null) return false;
      return getComputedStyle(element).visibility !== "hidden";
    }

    /**
     * The upstream screen that replaced the chat with a route's detail view.
     *
     * Plugins render the detail itself: a bundle page marks it
     * `data-plugin-detail`, a built-in plugin `data-plugin-item-detail`, and
     * the breadcrumb at its top is the way back.
     *
     * Automation tasks keep the list and the detail side by side; upstream
     * hides the list below 760px, which leaves the detail's own close button
     * as the only way back. While both panes fit the list is still on screen
     * and nothing is owed, so that state keeps the normal layout.
     *
     * @returns {{container: Element, source: Element|null, back: boolean}|null}
     */
    function routeDetailOf() {
      for (const container of document.querySelectorAll("[data-plugin-detail], [data-plugin-item-detail]")) {
        if (routeLaidOut(container)) return { container, source: null, back: false };
      }
      const page = document.querySelector('[data-testid="task-manager-page"]');
      if (page === null || !routeLaidOut(page)) return null;
      const closeLabels = probeValues("closeTaskDetail", ["Close details"]);
      const close = [...page.querySelectorAll("button[aria-label]")]
        .find((button) => closeLabels.includes(button.getAttribute("aria-label") || "") && routeLaidOut(button)) ?? null;
      if (close === null) return null;
      // Which pane owns the close button, and is the other one gone? Upstream
      // hides the list with `display:none`, which collapses its box to 0x0.
      let pane = close;
      while (pane.parentElement !== null && pane.parentElement !== page) pane = pane.parentElement;
      const others = [...page.children].filter((child) => child !== pane);
      const listGone = others.length === 0 || others.some((child) => !routeLaidOut(child));
      return listGone ? { container: page, source: close, back: true } : null;
    }

    /** The phone's own way out of a route detail, built once on boot. */
    let routeBack = null;

    function installRouteBack() {
      if (routeBack !== null) return;
      routeBack = document.createElement("button");
      routeBack.type = "button";
      routeBack.className = "rdsh-mux-route-back";
      routeBack.setAttribute("aria-label", t("mux.route.back"));
      routeBack.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>';
      routeBack.addEventListener("click", () => {
        // Re-read the screen: the route may have changed since the last frame.
        const detail = routeDetailOf();
        if (detail !== null && detail.source !== null) detail.source.click();
      });
      document.body.append(routeBack);
    }

    function removeRouteBack() {
      routeBack?.remove();
      routeBack = null;
    }

    /**
     * Mark a full-screen route's detail and hand its top-left slot over.
     *
     * That slot is the drawer button's. On a phone it sits exactly over the
     * Plugins breadcrumb and over the task detail's first tab, so both screens
     * read as dead ends (#61, #62). The marker retires the drawer button from
     * the mobile stylesheet; where the only way back is upstream's far-right
     * close button, the same slot becomes a back button and the detail keeps a
     * matching top inset so nothing runs underneath it.
     */
    function decorateRouteBack() {
      if (!phone()) {
        for (const tagged of document.querySelectorAll("[data-rdsh-route-detail]")) tagged.removeAttribute("data-rdsh-route-detail");
        routeBack?.toggleAttribute("data-visible", false);
        return;
      }
      const detail = routeDetailOf();
      const container = detail === null ? null : detail.container;
      for (const tagged of document.querySelectorAll("[data-rdsh-route-detail]")) {
        if (tagged !== container) tagged.removeAttribute("data-rdsh-route-detail");
      }
      if (container !== null) {
        const marker = detail.back ? "back" : "detail";
        if (container.getAttribute("data-rdsh-route-detail") !== marker) container.setAttribute("data-rdsh-route-detail", marker);
      }
      if (routeBack !== null) routeBack.toggleAttribute("data-visible", detail !== null && detail.back);
    }

    /** Cancel every running title animation and remove its overlay. */
    function clearTypingAnimations() {
      for (const controller of titleAnimations.values()) controller.cancel();
      titleAnimations.clear();
      for (const element of document.querySelectorAll("[data-rdsh-typing]")) element.removeAttribute("data-rdsh-typing");
      for (const layer of document.querySelectorAll("[data-rdsh-typing-layer]")) layer.remove();
    }

    function decorateSessionTitleTyping() {
      if (!phone()) {
        clearTypingAnimations();
        return;
      }
      const running = globalThis.__RDSH_MOBILE_UX_RUNNING__ instanceof Set
        ? globalThis.__RDSH_MOBILE_UX_RUNNING__
        : new Set();
      const targets = [];
      const crumb = document.querySelector('[data-rdsh-crumbs] [class*="_crumbCurrent"]');
      const header = document.querySelector("[data-conversation-session]");
      const headerId = header === null ? "" : (header.getAttribute("data-conversation-session") || "");
      if (crumb !== null && headerId !== "") targets.push({ key: `head:${headerId}`, id: headerId, element: crumb, running: running.has(headerId) });
      for (const title of document.querySelectorAll("[data-rdsh-session-title]")) {
        const row = title.closest('[data-row-key^="session:"]');
        if (row === null) continue;
        const key = row.getAttribute("data-row-key") || "";
        const id = key.startsWith("session:") ? key.slice("session:".length) : key;
        targets.push({ key: `row:${key}`, id, element: title, running: row.hasAttribute("data-rdsh-running") });
      }
      watchTitleText(targets.map((entry) => entry.element));
      const now = Date.now();
      for (const { key, id, element, running: working } of targets) {
        if (element.hasAttribute("data-rdsh-typing")) {
          const active = titleAnimations.get(key);
          if (active === undefined) element.removeAttribute("data-rdsh-typing");
          else if (element.querySelector("[data-rdsh-typing-layer]") === null) active.reattach();
        }
        if (working) titleWorkingAt.set(key, now);
        // Read React's text, not the layer, so a name landing mid-animation is
        // still seen as a change: the label the model replaces arrives while the
        // fallback is usually still being typed.
        const text = sessionTitleText(element);
        const previous = titleSeen.get(key);
        if (text !== "") titleSeen.set(key, text);
        else if (previous === undefined) titleSeen.set(key, "");
        if (text === "") continue;
        // First sight is the baseline: a page reload must not retype history.
        if (previous === undefined || previous === text) continue;
        const passes = titlePasses.get(key) ?? 0;
        if (passes >= TITLE_PASSES) continue;
        // An unnamed session shows the working directory or its raw id in the
        // header, so "untitled" alone misses the case this animation is for.
        // A name is generated while the session works (or right after), and a
        // manual rename later does not qualify.
        const generated = working
          || untitled(previous)
          || previous === id
          || now - (titleWorkingAt.get(key) ?? 0) < NAME_GRACE_MS;
        // The first pass is the initial label. The second is the name the model
        // settles on, which arrives on its own schedule, so it is allowed
        // without the running window and erases the label first.
        if (passes === 0 && !generated) continue;
        titlePasses.set(key, passes + 1);
        // Why the running animation is cancelled rather than awaited: waiting
        // would reveal the new name the moment the layer is removed, and only
        // then start erasing it — a pop followed by a pointless animation.
        const active = titleAnimations.get(key);
        const eraseFrom = active === undefined ? (passes === 0 ? "" : previous) : active.visible();
        active?.cancel();
        const controller = animateSessionTitle(element, text, eraseFrom);
        if (controller === null) titleAnimations.delete(key);
        else titleAnimations.set(key, controller);
      }
    }

    /** Upward travel that counts as "flick the banner away". */
    const TOAST_SWIPE_PX = 32;

    /**
     * Let a notice be swiped up, the way an iOS banner is dismissed.
     *
     * The component owns its own lifetime and renders through a portal, so the
     * gesture only moves the element out of sight; its timer retires it as
     * usual. Nothing here touches React's tree.
     */
    /** Swipe listeners per toast, so desktop/dispose can remove them again. */
    const toastSwipeState = new WeakMap();

    function clearToastHooks() {
      for (const toast of document.querySelectorAll("[data-rdsh-toast]")) {
        toast.style.removeProperty("transform");
        toast.style.removeProperty("opacity");
        const handlers = toastSwipeState.get(toast);
        if (handlers !== undefined) {
          toastSwipeState.delete(toast);
          toast.removeEventListener("pointerdown", handlers.down);
          toast.removeEventListener("pointermove", handlers.move);
          toast.removeEventListener("pointerup", handlers.up);
          toast.removeEventListener("pointercancel", handlers.up);
        }
      }
      clearOwnedAttribute("data-rdsh-toast");
      clearOwnedAttribute("data-rdsh-toast-dismissed");
    }

    function decorateToasts() {
      if (!phone()) {
        clearToastHooks();
        return;
      }
      for (const toast of document.querySelectorAll('body > [role="alert"]')) {
        if (toastSwipeState.has(toast)) {
          toast.setAttribute("data-rdsh-toast", "");
          continue;
        }
        toast.setAttribute("data-rdsh-toast", "");
        let startX = 0;
        let startY = 0;
        let offset = 0;
        let tracking = false;
        const release = () => {
          tracking = false;
          offset = 0;
          toast.style.removeProperty("transform");
          toast.style.removeProperty("opacity");
        };
        const down = (event) => {
          if (event.pointerType === "mouse") return;
          tracking = true;
          startX = event.clientX;
          startY = event.clientY;
          offset = 0;
        };
        const move = (event) => {
          if (!tracking) return;
          const dy = event.clientY - startY;
          const dx = Math.abs(event.clientX - startX);
          // Upwards only, and only while the gesture is clearly vertical.
          if (dy > 0 || Math.abs(dy) < dx) {
            offset = 0;
            return;
          }
          offset = dy;
          toast.style.transform = `translate(-50%, ${Math.round(dy)}px)`;
          toast.style.opacity = String(Math.max(0.15, 1 + dy / 140));
        };
        const up = () => {
          if (!tracking) return;
          if (offset <= -TOAST_SWIPE_PX) {
            toast.setAttribute("data-rdsh-toast-dismissed", "");
            tracking = false;
            return;
          }
          release();
        };
        toast.addEventListener("pointerdown", down);
        toast.addEventListener("pointermove", move);
        toast.addEventListener("pointerup", up);
        toast.addEventListener("pointercancel", up);
        toastSwipeState.set(toast, { down, move, up });
      }
    }

    /** One scroll-down bubble per question card, keyed by its scroll body. */
    const questionArrowState = new Map();

    function clearQuestionArrows() {
      for (const { button, body, handler } of questionArrowState.values()) {
        body.removeEventListener("scroll", handler);
        button.remove();
      }
      questionArrowState.clear();
    }

    function decorateQuestionArrow(card) {
      const body = [...card.querySelectorAll("div")].find((element) => {
        if (element.scrollHeight <= element.clientHeight + 2) return false;
        const overflow = getComputedStyle(element).overflowY;
        return overflow === "auto" || overflow === "scroll";
      });
      const current = questionArrowState.get(card);
      if (body === undefined) {
        if (current !== undefined) {
          current.body.removeEventListener("scroll", current.handler);
          current.button.remove();
          questionArrowState.delete(card);
        }
        return;
      }
      if (current !== undefined && current.body === body && current.button.isConnected) {
        current.update();
        return;
      }
      if (current !== undefined) {
        current.body.removeEventListener("scroll", current.handler);
        current.button.remove();
        questionArrowState.delete(card);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rdsh-mux-question-arrow";
      button.setAttribute("data-rdsh-question-arrow", "");
      button.setAttribute("aria-label", "Scroll question content down");
      button.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg>';
      const update = () => {
        const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
        const scrollable = body.scrollHeight > body.clientHeight + 2;
        button.hidden = !scrollable || atEnd;
        button.disabled = !scrollable || atEnd;
      };
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        body.scrollBy({ top: Math.max(120, Math.round(body.clientHeight * 0.7)), behavior: "smooth" });
      });
      body.addEventListener("scroll", update, { passive: true });
      card.append(button);
      questionArrowState.set(card, { body, button, update, handler: update });
      update();
    }

    function decorateQuestionCards() {
      if (!phone()) {
        clearQuestionArrows();
        for (const attribute of ["data-rdsh-question-card", "data-rdsh-question-frame", "data-rdsh-question-tile"]) {
          clearOwnedAttribute(attribute);
        }
        return;
      }
      const live = new Set();
      for (const card of document.querySelectorAll('[class*="_card"]')) {
        if (card.querySelector('[class*="_options"], [class*="_strip"]') === null) continue;
        card.setAttribute("data-rdsh-question-card", "");
        const frame = card.closest('[class*="_frame"]');
        if (frame !== null) frame.setAttribute("data-rdsh-question-frame", "");
        for (const tile of card.querySelectorAll('[class*="_options"] > [class*="_option"], [class*="_options"] > [class*="_customRow"]')) {
          tile.setAttribute("data-rdsh-question-tile", "");
        }
        decorateQuestionArrow(card);
        live.add(card);
      }
      for (const [card, state] of questionArrowState) {
        if (live.has(card)) continue;
        state.body.removeEventListener("scroll", state.handler);
        state.button.remove();
        questionArrowState.delete(card);
      }
    }

    /**
     * The viewport the page shipped with, before the mobile zoom lock.
     *
     * #44: the lock is a mobile affordance, so a desktop keeps this exact
     * value. `owned` records a meta this module had to create (a host that
     * shipped none); that one is removed instead of rewritten.
     */
    let viewportBaseline = null;
    let viewportMetaOwned = false;

    /** Undo `enforceNoZoomViewport()`. Safe to call when nothing was written. */
    function releaseViewportLock() {
      if (viewportBaseline === null) return;
      const baseline = viewportBaseline;
      viewportBaseline = null;
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta !== null) {
        if (viewportMetaOwned) meta.remove();
        else if (baseline.content === null) meta.removeAttribute("content");
        else if (meta.getAttribute("content") !== baseline.content) meta.setAttribute("content", baseline.content);
      }
      viewportMetaOwned = false;
    }

    /**
     * Pin the viewport exactly as the legacy plugin did, in mobile mode only.
     *
     * This is the shipped contract: no pinch zoom, edge-to-edge, and the
     * composer riding above the keyboard via the fixed string. The 16px form
     * fields (below, in the stylesheet) remain the zoom guard. A desktop is
     * upstream's: it keeps the host's `viewport-fit=cover` and its own zoom,
     * and the value captured before the first lock is restored on dispose.
     */
    function enforceNoZoomViewport() {
      if (!phone()) {
        releaseViewportLock();
        return;
      }
      let meta = document.querySelector('meta[name="viewport"]');
      if (meta === null) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "viewport");
        document.head.append(meta);
        viewportMetaOwned = true;
      }
      if (viewportBaseline === null) {
        viewportBaseline = { content: viewportMetaOwned ? null : meta.getAttribute("content") };
      }
      // `interactive-widget=resizes-content` keeps the layout viewport in step
      // with the on-screen keyboard on Android/Chrome; iOS shrinks only the
      // visual viewport, which the mobile UX handles itself.
      const content = viewportContent(meta.getAttribute("content"), {
        width: "width=device-width",
        "initial-scale": "initial-scale=1",
        "maximum-scale": "maximum-scale=1",
        "user-scalable": "user-scalable=no",
        "viewport-fit": "viewport-fit=cover",
        "interactive-widget": "interactive-widget=resizes-content",
      });
      if (meta.getAttribute("content") !== content) meta.setAttribute("content", content);
    }

    /**
     * Undo a focus zoom that is already on screen.
     *
     * The 16px rule below is supposed to stop iOS from zooming the composer.
     * It does not always: a field rendered by a layout that slipped under 16px
     * (a smaller display font, a panel that re-inline-sizes it) zooms on focus,
     * and WebKit keeps that zoom for the rest of the document — the page then
     * looks thrown to another corner and stays there after the keyboard
     * closes. The viewport meta is no help either: iOS ignores
     * `maximum-scale` / `user-scalable` in Safari.
     *
     * What is left is to notice the zoom and put it back. A magnified page
     * reports a visual viewport narrower than its layout viewport (a keyboard
     * only ever shrinks the height), and the published scale is then above 1.
     * Bring the field to the centre of the screen instead of letting the
     * browser scroll it off to one side: with the reset blocked, that at least
     * leaves the user looking at what they are typing.
     */
    function releaseFocusZoom() {
      const view = window.visualViewport;
      if (view === null || view === undefined || !(view.width > 0)) return;
      const zoomed = view.width < window.innerWidth - 1 || (typeof view.scale === "number" && view.scale > 1.02);
      document.documentElement.toggleAttribute("data-rdsh-focus-zoom", zoomed);
      if (!zoomed) return;
      const field = document.activeElement;
      if (field === null || field === undefined || typeof field.scrollIntoView !== "function") return;
      if (field.closest('[contenteditable="true"], input, textarea') === null) return;
      try {
        // `nearest` would leave a field the zoom pushed out of view where it
        // is; centring is the point of this call.
        field.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      } catch {
        /* an engine without options still gets the no-zoom default */
      }
    }

    const ACTIVITY_ICONS = {
      shell: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.7" y="2.7" width="12.6" height="10.6" rx="2"/><path d="M4.4 6.2l2.3 1.8-2.3 1.8"/><path d="M8.4 10.2h3.3"/></svg>',
      subagent: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="4.6" r="2.1"/><path d="M3.6 13.4c0-2.6 2-4.4 4.4-4.4s4.4 1.8 4.4 4.4"/><path d="M11.6 3.2a2.2 2.2 0 0 1 0 3.9"/></svg>',
    };

    /**
     * Remove the chips, the owned ring and the icon this module injected.
     *
     * A native spinner tagged by an older build keeps its identity: only the
     * generic marker is dropped. Generated nodes and the self-drawn ring are
     * ours, so they go together with the chip state and subscriptions.
     */
    function clearActivityChips() {
      for (const tagged of document.querySelectorAll("[data-rdsh-activity-spinner]")) {
        if (isOwnedActivityRing(tagged)) tagged.remove();
        else tagged.removeAttribute("data-rdsh-activity-spinner");
      }
      for (const generated of document.querySelectorAll("[data-rdsh-activity-generated]")) generated.remove();
      for (const icon of document.querySelectorAll("[data-rdsh-activity-icon]")) icon.remove();
      for (const attribute of ["data-rdsh-activity-chip", "data-rdsh-activity-state", "data-rdsh-activity-running"]) {
        for (const element of document.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
      }
      unwatchActivitySources();
    }

    /** Upstream marks a live chip "N subagents running" / "N background jobs
     *  running". The word is the last-resort state source when the client
     *  services are not in this profile; it is not the state itself. */
    const ACTIVITY_RUNNING_PROBE = probeRegex("activityRunning", "i", "running");

    /** Re-read while a ring turns, so completion lands well inside one second. */
    const ACTIVITY_POLL_MS = 500;
    /** One live subscription per source kind; replaced with the service instance. */
    const activityWatches = { list: null, jobs: null, status: null };
    const activityStops = { list: null, jobs: null, status: null };
    let activityPoll = 0;

    /**
     * Follow one public source. The unsubscriber belongs to the exact instance
     * that minted it: a replaced service (reconnect, profile reload) drops the
     * old one instead of leaving a stale subscription behind.
     */
    function watchActivitySource(kind, source) {
      if (activityWatches[kind] === source) return;
      const previous = activityStops[kind];
      activityStops[kind] = null;
      activityWatches[kind] = null;
      if (typeof previous === "function") {
        try {
          previous();
        } catch (error) {
          /* the old generation is already gone */
        }
      }
      if (source === null || source === undefined) return;
      if (typeof source.subscribe !== "function") return;
      try {
        const stop = source.subscribe(() => scheduleDecorate());
        activityWatches[kind] = source;
        if (typeof stop === "function") activityStops[kind] = stop;
      } catch (error) {
        /* an unavailable source only costs live freshness */
      }
    }

    /** Follow the projections the header chips mirror: Session list, jobs, status. */
    function watchActivitySources() {
      if (!phone()) return;
      const sessions = sessionsService();
      watchActivitySource("list", sessions?.list ?? null);
      const jobs = optionalService("jobs");
      watchActivitySource("jobs", jobs?.state ?? null);
      const uiSession = optionalService("uiSession");
      watchActivitySource("status", uiSession?.sessionStatus ?? null);
    }

    function stopActivityPoll() {
      if (activityPoll === 0) return;
      clearInterval(activityPoll);
      activityPoll = 0;
    }

    function unwatchActivitySources() {
      for (const kind of Object.keys(activityWatches)) {
        const stop = activityStops[kind];
        activityStops[kind] = null;
        activityWatches[kind] = null;
        if (typeof stop !== "function") continue;
        try {
          stop();
        } catch (error) {
          /* already disposed with its service */
        }
      }
      stopActivityPoll();
    }

    /** Poll only while something is running; idle chips own no timer. */
    function syncActivityPoll(running) {
      if (!running) {
        stopActivityPoll();
        return;
      }
      if (activityPoll !== 0) return;
      activityPoll = setInterval(() => {
        if (!phone()) {
          stopActivityPoll();
          return;
        }
        scheduleDecorate();
      }, ACTIVITY_POLL_MS);
    }

    /** Running (or stopping) shell jobs of one Session, from the jobs service. */
    function runningShellJobs(sessionId) {
      if (sessionId === null || sessionId === undefined) return null;
      const jobs = optionalService("jobs");
      if (jobs === null) return null;
      try {
        const rows = jobs.state?.getSnapshot?.()?.rows?.[sessionId];
        if (!Array.isArray(rows)) return null;
        return rows.filter((job) => job?.status === "running" || job?.status === "stopping").length;
      } catch (error) {
        return null;
      }
    }

    /**
     * Running direct children of one root Session: the Session's own
     * `subagentCatalog` filtered by the public `sessionStatus` map. Counting
     * the whole client would spin this chip for another Session's child (#40).
     */
    function runningSubagents(sessionId) {
      if (sessionId === null || sessionId === undefined) return null;
      const uiSession = optionalService("uiSession");
      const sessions = sessionsService();
      let statuses;
      let snapshot;
      try {
        statuses = uiSession?.sessionStatus?.getSnapshot?.();
        snapshot = sessions?.list?.getSnapshot?.();
      } catch (error) {
        return null;
      }
      const catalog = snapshot?.projectionsBySession?.[sessionId]?.values?.subagentCatalog;
      if (statuses === null || statuses === undefined || typeof statuses.get !== "function" || !Array.isArray(catalog)) return null;
      let count = 0;
      for (const entry of catalog) {
        if (entry === null || entry === undefined) continue;
        const running = statuses.get(entry.id)?.running ?? snapshot?.byId?.[entry.id]?.running;
        if (running === true) count += 1;
      }
      return count;
    }

    /**
     * The Session the decorators follow: the slot's own id when it has run,
     * otherwise upstream's `[data-conversation-session]` (the same DOM fact
     * `shownSessionId()` reads for notification routing).
     */
    function decoratedSessionId() {
      if (currentSessionId !== null) return currentSessionId;
      const shown = shownSessionId();
      return shown === "" ? null : shown;
    }

    /** The two real running facts behind the chips; `null` means "unknown". */
    function activityState(sessionId = decoratedSessionId()) {
      return { shell: runningShellJobs(sessionId), subagent: runningSubagents(sessionId) };
    }

    /**
     * Upstream count chips start with their number ("3 subagents running",
     * "3 个子智能体"). The label vocabulary is a probe table because the shell
     * translates it; the running word inside it is probed separately.
     */
    const ACTIVITY_CHIP_LABEL = (() => {
      const labels = probeValues("activityChip", [
        "subagent", "subagents",
        "background job", "background jobs",
        "shell command", "shell commands",
      ]);
      if (labels.length === 0) return null;
      return new RegExp(`^\\d[\\d,.]*\\s+(?:${labels.join("|")})`, "i");
    })();

    /** The subagent nouns, so a non-English label still picks the right glyph. */
    const ACTIVITY_SUBAGENT_PROBE = probeRegex("activitySubagentChip", "i", "subagent");

    function headerActivityChips() {
      if (ACTIVITY_CHIP_LABEL === null) return [];
      return [...document.querySelectorAll("header button[aria-label]")]
        .filter((button) => ACTIVITY_CHIP_LABEL.test((button.getAttribute("aria-label") || "").trim()));
    }

    function activityChipOf(target) {
      if (target === null || target === undefined || typeof target.closest !== "function") return null;
      return target.closest("[data-rdsh-activity-chip]") ?? null;
    }

    /**
     * A second tap on the chip of an open panel closes it (#41).
     *
     * Both upstream triggers carry `aria-expanded`; the jobs chip toggles on
     * its own click, the subagent catalog only opens. Their roots already
     * close on Escape, which restores focus to the trigger, so the tap
     * synthesizes that key rather than depending on a hash-named close button.
     * A click on another chip, or inside the open panel, is left to upstream.
     */
    function handleActivityChipClick(chip, event) {
      if (!phone() || chip === null || chip === undefined) return false;
      if (chip.getAttribute("aria-expanded") !== "true") return false;
      if (event !== null && event !== undefined) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        else if (typeof event.stopPropagation === "function") event.stopPropagation();
      }
      try {
        chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      } catch (error) {
        /* a detached trigger has nothing to close */
      }
      return true;
    }

    /**
     * Whether a tagged node is the ring this plugin created.
     *
     * Older builds set `data-rdsh-activity-generated` on every ring they made
     * (a fallback span or a clone); the current build marks a self-drawn span
     * with `rdsh-activity-ring`. A node with only the generic
     * `data-rdsh-activity-spinner` is an upstream spinner the old build
     * adopted in place: it belongs to upstream and must keep its identity.
     */
    function isOwnedActivityRing(node) {
      if (node === null || node === undefined) return false;
      if (node.hasAttribute("data-rdsh-activity-generated")) return true;
      return node.tagName === "SPAN" && String(node.className || "").split(/\s+/).includes("rdsh-activity-ring");
    }

    /** The ring is ours; never adopt or clone an upstream spinner. */
    function ensureActivityRing(button) {
      let ring = button.querySelector("[data-rdsh-activity-spinner]");
      if (ring !== null && ring !== undefined) {
        if (!isOwnedActivityRing(ring)) {
          // An older build tagged the upstream spinner in place. Give the node
          // back to upstream (drop only our marker) and draw a separate ring.
          ring.removeAttribute("data-rdsh-activity-spinner");
          ring = null;
        } else if (ring.tagName !== "SPAN") {
          // An older build cloned a spinner into a generated SVG; that clone
          // is ours to replace, unlike the upstream node above.
          ring.remove();
          ring = null;
        }
      }
      if (ring !== null && ring !== undefined) {
        if (!String(ring.className || "").split(/\s+/).includes("rdsh-activity-ring")) {
          ring.className = "rdsh-activity-ring";
          ring.innerHTML = "";
        }
        return ring;
      }
      ring = document.createElement("span");
      ring.className = "rdsh-activity-ring";
      ring.setAttribute("data-rdsh-activity-spinner", "");
      ring.setAttribute("aria-hidden", "true");
      button.prepend(ring);
      return ring;
    }

    /** Header shell/subagent chips become icon-only live indicators. */
    function decorateHeaderActivityChips(buttons = headerActivityChips()) {
      if (!phone()) {
        clearActivityChips();
        return;
      }
      if (buttons.length === 0) {
        stopActivityPoll();
        return;
      }
      watchActivitySources();
      const state = activityState();
      let runningAny = false;
      for (const button of buttons) {
        const label = button.getAttribute("aria-label") || "";
        const kind = ACTIVITY_SUBAGENT_PROBE !== null && ACTIVITY_SUBAGENT_PROBE.test(label) ? "subagent" : "shell";
        button.setAttribute("data-rdsh-activity-chip", kind);
        const projected = kind === "subagent" ? state.subagent : state.shell;
        const running = projected === null
          ? ACTIVITY_RUNNING_PROBE !== null && ACTIVITY_RUNNING_PROBE.test(label)
          : projected > 0;
        runningAny = runningAny || running;
        button.setAttribute("data-rdsh-activity-state", running ? "running" : "idle");
        button.toggleAttribute("data-rdsh-activity-running", running);
        ensureActivityRing(button);
        if (button.querySelector("[data-rdsh-activity-icon]") === null) {
          const icon = document.createElement("span");
          icon.setAttribute("data-rdsh-activity-icon", "");
          icon.setAttribute("aria-hidden", "true");
          icon.innerHTML = ACTIVITY_ICONS[kind];
          button.append(icon);
        }
      }
      syncActivityPoll(runningAny);
    }

    /** Add a Settings row to the sidebar panel list, matching Plugins. */
    function openSettingsViaAccountMenu() {
      const trigger = document.querySelector(ariaLabelSelector("button", "accountMenu", "Account menu"));
      if (trigger === null) return;
      settingsPendingUntil = Date.now() + 2000;
      trigger.click();
      setTimeout(maybeOpenSettings, 30);
      setTimeout(maybeOpenSettings, 120);
      setTimeout(maybeOpenSettings, 300);
    }

    function decorateSidebarSettingsRow() {
      // #17: the replacement row belongs to the mobile drawer. Desktop keeps
      // the stock account row, and swapping it there only loses the stock menu.
      if (!phone()) {
        // Desktop mode and dispose must undo the swap, or the tagged account
        // row stays hidden by the mobile stylesheet and Settings becomes
        // unreachable.
        for (const tagged of document.querySelectorAll("[data-rdsh-more-row]")) tagged.removeAttribute("data-rdsh-more-row");
        for (const injected of document.querySelectorAll("[data-rdsh-settings-row]")) injected.remove();
        return;
      }
      const nav = document.querySelector("nav.hHd-Xa_panelList");
      if (nav === null) return;
      // The account "More" row is not used on the phone.
      //
      // Never let the Settings row this function injects answer the account
      // lookup. Its label is localized, and `COPY.ja` used to make it "設定",
      // which is also one of PROBES.accountMenu. On the second decorate pass
      // `querySelector` then returned the injected row, its parent nav was
      // tagged `data-rdsh-more-row`, and the stylesheet hid the whole panel
      // list (the four rows collapsed to 0x0).
      const accountSelector = ariaLabelSelector("button", "accountMenu", "Account menu");
      const isInjected = (element) => element.hasAttribute("data-rdsh-settings-row");
      const account = [...document.querySelectorAll(accountSelector)].find((button) => !isInjected(button))
        ?? [...document.querySelectorAll("button")].find((button) => !isInjected(button) && button.innerText.trim() === "More")
        ?? null;
      // Resolve the row that actually owns the account menu, and clear any
      // stale tag from an earlier pass (including a nav tagged by the bug
      // above) before writing the new one.
      let moreRow = null;
      if (account !== null) {
        const candidate = account.closest('[class*="yHnPSG_anchor"]') ?? account.parentElement ?? null;
        // The nav itself (or an ancestor containing it) is the panel list, not
        // the account row; tagging it hides every panel row.
        if (candidate !== null && candidate !== nav && !candidate.contains(nav)) moreRow = candidate;
      }
      for (const tagged of document.querySelectorAll("[data-rdsh-more-row]")) {
        if (tagged !== moreRow) tagged.removeAttribute("data-rdsh-more-row");
      }
      if (moreRow !== null) moreRow.setAttribute("data-rdsh-more-row", "");
      const auto = nav.querySelector('button[aria-label="Automation tasks"]');
      let row = nav.querySelector("[data-rdsh-settings-row]");
      if (row === null) {
        row = document.createElement("button");
        row.type = "button";
        row.className = "hHd-Xa_panelRow";
        row.setAttribute("aria-label", t("mux.settingsRow"));
        row.setAttribute("data-rdsh-settings-row", "");
        row.innerHTML = `<span class="hHd-Xa_panelGlyph" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.1"/><path d="M6.9 1.9h2.2l.35 1.5 1.28.74 1.45-.5 1.1 1.9-1.05 1.1.1 1.48 1.05 1.1-1.1 1.9-1.45-.5-1.28.74-.35 1.5H6.9l-.35-1.5-1.28-.74-1.45.5-1.1-1.9 1.05-1.1-.1-1.48-1.05-1.1 1.1-1.9 1.45.5 1.28-.74z"/></svg></span><span class="hHd-Xa_panelTitle hHd-Xa_wide">${t("mux.settingsRow")}</span>`;
        row.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSettingsViaAccountMenu();
        });
      }
      const anchor = auto ?? nav.querySelector('button[aria-label="Plugins"]');
      // Two exclusive branches. Written as one `if` with a trailing `else if`,
      // the second branch also ran when the row was already directly after the
      // anchor but not last, so `after()` and `append()` moved the row on every
      // pass: the mutation woke this very observer and the row oscillated once
      // per frame. Only the branch that applies may move it.
      if (anchor !== null) {
        if (anchor.nextElementSibling !== row) anchor.after(row);
      } else if (nav.lastElementChild !== row) {
        nav.append(row);
      }
    }

    /**
     * Tag the drawer's own header toggle for the mobile stylesheet.
     *
     * The reference styled that button through an upstream hash class. This
     * package never names a hash: the sidebar slot bounds the search and the
     * action label identifies the button, with the drag-header structure as
     * the fallback for a localised label. Scoping to the sidebar keeps close,
     * right-panel and composer buttons on their stock paint. Desktop drops
     * the tag, so the stock control and its tooltip come back.
     */
    function decorateSidebarToggle() {
      if (!phone()) {
        for (const element of document.querySelectorAll("[data-rdsh-sidebar-toggle]")) {
          element.removeAttribute("data-rdsh-sidebar-toggle");
        }
        return;
      }
      const sidebar = document.querySelector('[data-slot="sidebar"]');
      if (sidebar === null) return;
      let toggle = sidebar.querySelector('button[aria-label="Open sidebar"], button[aria-label="Collapse sidebar"]');
      if (toggle === null) {
        // Localised label: the toggle is the only labelled button with a
        // direct SVG icon in the sidebar's drag header (the brand button wraps
        // its logo in a span).
        for (const header of sidebar.querySelectorAll("[data-window-drag]")) {
          toggle = [...header.querySelectorAll("button[aria-label]")]
            .find((button) => button.querySelector(":scope > svg") !== null) ?? null;
          if (toggle !== null) break;
        }
      }
      if (toggle === null) return;
      for (const element of document.querySelectorAll("[data-rdsh-sidebar-toggle]")) {
        if (element !== toggle) element.removeAttribute("data-rdsh-sidebar-toggle");
      }
      toggle.setAttribute("data-rdsh-sidebar-toggle", "");
    }

    const ADD_LABEL = t("add.label");
    const ADD_STOCK_LABEL = t("add.stock");
    const ADD_SELECTOR = `[data-rdsh-add], [aria-label="${ADD_LABEL}"], [aria-label="${ADD_STOCK_LABEL}"]`;

    function addButton() {
      // Structure first: the composer's only listbox trigger is the "+" button.
      // Labels are localised, so they are only the fallback.
      const composer = document.querySelector("[data-composer-input]");
      const card = composer === null ? null : composer.closest('[class*="_card"]');
      const structural = card === null ? null : card.querySelector('button[aria-haspopup="listbox"]');
      return structural || document.querySelector(ADD_SELECTOR);
    }

    function addButtonOf(target) {
      if (target === null || target === undefined || target.closest === undefined) return null;
      const button = target.closest("button");
      return button !== null && button === addButton() ? button : null;
    }

    /**
     * Put the "+" label back and drop the composer hooks. Only a label this
     * module wrote is restored: an upstream label that already said the stock
     * text is left exactly as it is.
     */
    function clearComposerHooks() {
      const add = addButton();
      if (add !== null && add.getAttribute("aria-label") === ADD_LABEL) add.setAttribute("aria-label", ADD_STOCK_LABEL);
      for (const attribute of ["data-rdsh-model-button", "data-rdsh-add", "data-rdsh-composer-root", "data-rdsh-composer-dock", "data-rdsh-has-dock"]) {
        for (const element of document.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
      }
      document.documentElement.removeAttribute("data-rdsh-has-dock");
    }

    function decorateComposer() {
      if (!phone()) {
        clearComposerHooks();
        return;
      }
      for (const model of document.querySelectorAll('button[aria-label^="Select model"]')) {
        model.setAttribute("data-rdsh-model-button", "");
      }
      const add = addButton();
      if (add === null) {
        document.documentElement.removeAttribute("data-rdsh-has-dock");
        return;
      }
      add.setAttribute("data-rdsh-add", "");
      // #17: the short "attach only" label and the picker hijack below are a
      // mobile-device affordance, the same condition as `phone()`.
      if (add.getAttribute("aria-label") !== ADD_LABEL) add.setAttribute("aria-label", ADD_LABEL);
      const card = add.closest('[class*="_card"]');
      if (card === null || card.parentElement === null) {
        document.documentElement.removeAttribute("data-rdsh-has-dock");
        return;
      }
      card.parentElement.setAttribute("data-rdsh-composer-root", "");
      // The stats dock (turns / tok/s / cache hit / context %) is essential.
      // On a phone it moves out of the layout so the composer can sit as low
      // as possible, and fills the safe-area strip below the card instead of
      // leaving a blank band there.
      let hasDock = false;
      for (const sibling of card.parentElement.children) {
        if (sibling === card) continue;
        const stats = sibling.querySelector(ariaContainsSelector("button", "stats", ["tok", "turns", "context"]));
        if (stats !== null) {
          sibling.setAttribute("data-rdsh-composer-dock", "");
          hasDock = true;
        } else {
          sibling.removeAttribute("data-rdsh-composer-dock");
        }
      }
      document.documentElement.toggleAttribute("data-rdsh-has-dock", hasDock);
    }

    function markScrollers() {
      if (!phone()) {
        clearOwnedAttribute("data-rdsh-scroll");
        return;
      }
      for (const element of document.querySelectorAll("[data-rdsh-frame] div")) {
        if (element.hasAttribute("data-rdsh-scroll")) continue;
        if (element.scrollHeight <= element.clientHeight + 4) continue;
        const overflow = getComputedStyle(element).overflowY;
        if (overflow !== "auto" && overflow !== "scroll") continue;
        element.setAttribute("data-rdsh-scroll", "");
      }
    }

    let lastSlowAt = 0;

    function decorateFast() {
      // One mode decision per pass. Every tag below belongs to the mobile
      // surface; on desktop the same pass only removes leftovers, so a
      // MutationObserver firing between frames cannot re-create a hook.
      const onPhone = phone();
      const root = frame();
      if (root !== null) {
        if (onPhone) {
          root.setAttribute("data-rdsh-frame", "");
          // The app switches these columns to auto-placement while its sidebar is
          // open. Our drawer takes that column out of flow, so auto-placement
          // shifts everything one column left: the chat lands on the 0px column
          // and the empty right column fills the screen. Pin them instead.
          for (const child of root.children) {
            const cls = typeof child.className === "string" ? child.className : "";
            if (cls.includes("_centerCol")) child.setAttribute("data-rdsh-center-col", "");
            else if (cls.includes("_rightbarCol")) child.setAttribute("data-rdsh-rightbar-col", "");
          }
          const sidebar = document.querySelector('[data-slot="sidebar"]');
          // Newer hosts run their own smartphone drawer (the `ui-mobile`
          // package: its toggle in the header, its backdrop in the shell
          // overlay, its own `data-dsh-mobile-*` state). When that is the case
          // this plugin must not compete with it: upstream already draws the
          // way in and the way out, and it never writes `data-sidebar-collapsed`
          // on a phone, so the rail state below would read "open" forever and
          // both drawers would sit on top of each other.
          if (hostsOwnDrawer()) {
            settleDrawer();
            const open = document.documentElement.getAttribute("data-dsh-mobile-drawer") === "open";
            if (open !== state.drawerOpen) emit({ drawerOpen: open });
            document.documentElement.setAttribute("data-rdsh-drawer", open ? "open" : "closed");
            document.documentElement.setAttribute("data-rdsh-host-drawer", "");
          } else {
            document.documentElement.removeAttribute("data-rdsh-host-drawer");
            // The drawer is the layout's own node (SidebarRoot), and it has to
            // leave the layout before it can be a sheet over it: fix it in the
            // column instead and the column keeps its row, so the chat header
            // picks up the list's width and the drawer covers the whole screen.
            liftDrawer(root, sidebar);
            const open = !root.hasAttribute("data-sidebar-collapsed");
            if (open !== state.drawerOpen) emit({ drawerOpen: open });
            document.documentElement.setAttribute("data-rdsh-drawer", open ? "open" : "closed");
          }
        } else {
          settleDrawer();
          document.documentElement.removeAttribute("data-rdsh-host-drawer");
          for (const attribute of ["data-rdsh-frame", "data-rdsh-center-col", "data-rdsh-rightbar-col", "data-rdsh-sidebar", "data-rdsh-drawer"]) {
            clearOwnedAttribute(attribute);
          }
        }
      }
      const header = document.querySelector("header[data-window-drag]");
      if (header !== null) {
        if (onPhone) header.setAttribute("data-rdsh-header", "");
        else header.removeAttribute("data-rdsh-header");
      }
      if (onPhone) {
        if (document.documentElement.getAttribute("data-rdsh-anim") !== ANIMATION) {
          document.documentElement.setAttribute("data-rdsh-anim", ANIMATION);
        }
      } else {
        document.documentElement.removeAttribute("data-rdsh-anim");
      }
      // Decorate the image lightbox on the same mutation that creates it. The
      // slow pass is throttled (900ms), which can leave a freshly opened
      // lightbox without the crop/safe-area hooks.
      decorateLightbox();
      decorateRightPanel();
      decorateRightPanelTabs();
      decorateWorkspaceFiles();
      decorateCodePreview();
      decoratePreviewTools();
      decorateQuestionCards();
      decorateTodoPanel();
      decorateGoalBar();
      decorateHeaderTitle();
      decorateSessionTitleTyping();
      decorateToasts();
      decorateModelSearch();
      installSettingsNavArrows();
      decorateStatsDock();
      enforceNoZoomViewport();
      if (onPhone) {
        const crumbs = document.querySelector('nav[aria-label="Session hierarchy"]');
        if (crumbs !== null) crumbs.setAttribute("data-rdsh-crumbs", "");
        for (const slot of document.querySelectorAll('[data-slot="main.conversation"], [data-slot="conversation"]')) {
          slot.setAttribute("data-rdsh-conversation", "");
        }
      } else {
        clearOwnedAttribute("data-rdsh-crumbs");
        clearOwnedAttribute("data-rdsh-conversation");
      }
      // Session rows are decorated at every width, but the function itself
      // writes the colour frame and every other row hook only in the phone
      // layout (#44); on a desktop it clears leftovers from a narrower pass.
      decorateSessionRows();
      decorateRouteHeading();
      decorateRouteBack();
      decorateQueueDock();
      decorateWorkspacePicker();
      decorateComposer();
      decorateHeaderActivityChips();
      decorateSidebarSettingsRow();
      decorateSidebarToggle();
      // The right panel keeps its chrome mounted even while closed (it is
      // clipped by a zero-width column), so presence of its buttons says
      // nothing. The dock strip is the real signal: it sits on-screen only
      // while the panel is open.
      const hideListDisabled = hideDisabled();
      // The hidden-rows attribute follows the same mode contract as the list
      // itself, so the JS writer and the stylesheet scope cannot drift apart.
      if (onPhone !== state.phone) emit({ phone: onPhone });
      document.documentElement.toggleAttribute("data-rdsh-hide-settings", onPhone && !hideListDisabled);
      applyHideList(hideListDisabled);
      maybeOpenSettings();
    }

    /**
     * Work that is too expensive for every mutation (style reads over the whole
     * transcript): keep it to about once a second.
     */
    function decorateTranscript() {
      if (!phone()) {
        clearOwnedAttribute("data-rdsh-transcript");
        clearOwnedAttribute("data-rdsh-transcript-column");
        return;
      }
      const scroller = document.querySelector('[class*="scrollBody"]');
      if (scroller === null) return;
      for (const node of scroller.querySelectorAll('[class*="_scroll"], [class*="_column"]')) {
        // A node this plugin already tagged stays tagged: the tag is what sets
        // the 16px gutters, so the "24px or more" heuristic below can never
        // hold again. Re-checking it dropped the column on every re-mount
        // (session switch, panel change) and the width reverted to 100%.
        const tagged = node.hasAttribute("data-rdsh-transcript");
        if (!tagged) {
          const style = getComputedStyle(node);
          const left = parseFloat(style.paddingLeft) || 0;
          const right = parseFloat(style.paddingRight) || 0;
          if (!(left >= 24 && right >= 24 && node.getBoundingClientRect().width >= scroller.clientWidth * 0.8)) continue;
          node.setAttribute("data-rdsh-transcript", "");
        }
        const column = node.querySelector('[class*="_column"]');
        if (column !== null) column.setAttribute("data-rdsh-transcript-column", "");
        return;
      }
    }

    function decorateUserBubbles() {
      if (!phone()) {
        clearOwnedAttribute("data-rdsh-user-stack");
        clearOwnedAttribute("data-rdsh-user-bubble");
        return;
      }
      for (const item of document.querySelectorAll('[data-chat-flow-kind="user"]')) {
        const stack = item.querySelector('[class*="userStack"]');
        if (stack !== null) stack.setAttribute("data-rdsh-user-stack", "");
        const bubble = item.querySelector('[class*="_bubble"]');
        if (bubble !== null) bubble.setAttribute("data-rdsh-user-bubble", "");
      }
    }

    function decorateSlow() {
      decorateEditCards();
      decorateRightPanel();
      decorateTranscript();
      decorateUserBubbles();
      markScrollers();
      // After decorateRightPanel so a just-tagged panel exists, and on the
      // slow pass so a click cannot be issued on every mutation.
      ensureRightPanelFits();
    }

    function decorate() {
      decorateFast();
      const now = Date.now();
      if (now - lastSlowAt > 900) {
        lastSlowAt = now;
        decorateSlow();
      }
    }

    /**
     * Whether the boot effect is still mounted. A decorate frame queued before
     * dispose must not run after it: it would re-lock the viewport and re-add
     * the phone hooks that dispose just removed.
     */
    let live = false;
    let scheduled = false;
    function scheduleDecorate() {
      if (!live || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        if (!live) return;
        scheduled = false;
        try {
          decorate();
        } catch (error) {
          console.error("[rdsh-mobile-ux] decorate failed", error);
        }
      });
    }

    // ---------------------------------------------------------------------
    // Drawer: floating button, backdrop, animation
    // ---------------------------------------------------------------------
    let fab = null;
    let backdrop = null;

    /** The drawer node this module lifted out of the layout, and where it was. */
    let drawerLayer = null;
    let drawerOrigin = null;

    /**
     * Move the session list out of the layout and onto its own overlay.
     *
     * The phone drawer has to own the whole screen for the duration of the
     * swipe: the list is what the drawer is, and the chat behind it must not
     * reflow while the sheet is open. A `position: fixed` on the list alone
     * does not do that — a fixed box leaves its flow slot behind, so in the
     * app frame (`[data-app-frame]`, a grid whose first track is the sidebar
     * column) the chat header stays as narrow as the list was and the dimmed
     * strip is only as wide as the chat. The list is therefore re-parented
     * into a layer that is a child of the frame itself, outside every column,
     * with the slot's anchor left behind so the layout still finds a box in
     * the place it expects.
     *
     * The original parent and sibling are kept: `settleDrawer` puts the node
     * back on dispose, on a desktop boot and as soon as the app re-renders the
     * slot (React would otherwise throw on a child that moved).
     */
    function liftDrawer(root, sidebar) {
      if (sidebar === null || sidebar === undefined || sidebar.parentElement === null) {
        settleDrawer();
        return;
      }
      // The slot renders `[data-slot="sidebar"]` with `display: contents`; the
      // layout's own node inside it is what has to move, but that node is not
      // always the box the app paints (here the column wrapper is). The sheet
      // is therefore the outermost element the slot owns that has a box of its
      // own: walk down through single-child wrappers and stop before the
      // list's own rows.
      let drawer = sidebar;
      while (drawer.children.length === 1 && drawer.firstElementChild !== null
        && !drawer.hasAttribute("data-row-key") && !drawer.hasAttribute("role")) {
        const child = drawer.firstElementChild;
        if (typeof child.getBoundingClientRect !== "function") break;
        if (child.hasAttribute("data-row-key") || child.hasAttribute("role")) break;
        drawer = child;
      }
      // A subtree the app has since painted somewhere else is not the drawer:
      // in the live layout the plugin's own theme presentation keeps a second
      // copy of the app chrome around for the first paint, and lifting that
      // one would freeze the drawer while the real list sat unmoved. Only a
      // visibly laid-out subtree is taken.
      if (typeof drawer.getBoundingClientRect === "function") {
        const box = drawer.getBoundingClientRect();
        if (!(box.width > 0) || !(box.height > 0)) {
          if (drawerLayer !== null) settleDrawer();
          return;
        }
      }
      if (typeof drawer.setAttribute !== "function" || typeof drawer.append !== "function") {
        if (drawerLayer !== null) settleDrawer();
        return;
      }
      // A full-screen route keeps its own copy of the app chrome mounted at
      // 0x0; lifting that one would drag the wrong tree onto the screen.
      if (typeof root.getBoundingClientRect === "function") {
        const box = root.getBoundingClientRect();
        if (!(box.width > 0) || !(box.height > 0)) return;
      }
      if (typeof root.append !== "function" || typeof drawer.append !== "function") return;
      if (drawerLayer === null) {
        const parent = drawer.parentElement;
        const layer = document.createElement("div");
        layer.className = "rdsh-mux-drawer-layer";
        layer.setAttribute("data-rdsh-drawer-layer", "");
        root.append(layer);
        if (parent !== null && typeof parent.setAttribute === "function") parent.setAttribute("data-rdsh-sidebar-host", "");
        drawerLayer = layer;
        drawerOrigin = { parent, sibling: drawer.nextSibling ?? null };
        drawer.setAttribute("data-rdsh-sidebar", "");
        layer.append(drawer);
        return;
      }
      if (drawerLayer.parentElement !== root) root.append(drawerLayer);
      if (drawer.parentElement !== drawerLayer) {
        // The app re-rendered the slot (or re-created it under a new node):
        // the node our layer holds is stale, and React owns it. Send it home
        // before the layout is asked to reconcile a child that moved.
        const stale = drawerLayer.firstElementChild;
        if (stale !== null && stale !== drawer && drawerOrigin !== null) {
          stale.removeAttribute("data-rdsh-sidebar");
          const { parent, sibling } = drawerOrigin;
          const anchor = sibling !== null && sibling.isConnected === true && sibling.parentElement === parent ? sibling : null;
          if (parent !== null && typeof parent.append === "function") {
            if (anchor !== null) anchor.after(stale);
            else parent.append(stale);
          } else {
            stale.remove();
          }
        }
        drawer.setAttribute("data-rdsh-sidebar", "");
        drawerLayer.append(drawer);
      }
    }

    /**
     * Put the lifted drawer back into the layout.
     *
     * Safe when nothing moved, and safe to call more than once: the node goes
     * back to the exact parent and next sibling it was taken from.
     */
    function settleDrawer() {
      const layer = drawerLayer;
      const origin = drawerOrigin;
      drawerLayer = null;
      drawerOrigin = null;
      if (layer === null) return;
      const drawer = layer.firstElementChild;
      if (drawer !== null) {
        drawer.removeAttribute("data-rdsh-sidebar");
        if (origin !== null && origin.parent !== null && typeof origin.parent.append === "function") {
          const anchor = origin.sibling !== null && origin.sibling.isConnected === true && origin.sibling.parentElement === origin.parent
            ? origin.sibling
            : null;
          if (anchor !== null) anchor.after(drawer);
          else origin.parent.append(drawer);
        } else {
          drawer.remove();
        }
      }
      if (layer.parentElement !== null) layer.remove();
      for (const host of document.querySelectorAll("[data-rdsh-sidebar-host]")) host.removeAttribute("data-rdsh-sidebar-host");
    }

    function toggleDrawer() {
      const button = document.querySelector('[aria-label="Open sidebar"], [aria-label="Collapse sidebar"]');
      if (button !== null) button.click();
    }

    function closeDrawer() {
      const frameElement = frame();
      if (frameElement === null) {
        // A full-screen route may not render the app frame at all. Reflect the
        // closed state instead of leaving `data-rdsh-drawer="open"` behind for
        // the next route (the FAB keys off this attribute).
        document.documentElement.setAttribute("data-rdsh-drawer", "closed");
        if (state.drawerOpen) emit({ drawerOpen: false });
        scheduleDecorate();
        return;
      }
      if (!frameElement.hasAttribute("data-sidebar-collapsed")) {
        const collapse = document.querySelector('[aria-label="Collapse sidebar"]');
        if (collapse !== null) {
          collapse.click();
        } else {
          // Route content replaced the sidebar chrome: there is nothing to
          // click, so record the state the next decorate pass should show.
          document.documentElement.setAttribute("data-rdsh-drawer", "closed");
          if (state.drawerOpen) emit({ drawerOpen: false });
        }
      }
      scheduleDecorate();
    }

    let currentSessionId = null;

    /**
     * Tell the push host that the next turn belongs to this device.
     *
     * A phone send is marked automatically. On a desktop that is the #15
     * opt-in: without it the host's `onlyMobileTurns` default means a PC send
     * is never notified, and a desktop window silently changing that would be
     * the same width-based behaviour #17 removes.
     */
    function markMobileSession(sessionId = currentSessionId) {
      if (sessionId === null) return;
      if (!phone() && !notifyDeviceTurns()) return;
      void fetch(`${PUSH_API}/mobile-send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The host routes this turn's end back to the app that started it.
        body: JSON.stringify({ sessionId, origin: location.origin }),
        keepalive: true,
      }).catch(() => {});
    }

    let notificationTotal = 0;

    function applyNotificationCount(count) {
      notificationTotal = Math.max(0, Math.floor(Number(count) || 0));
      if (fab === null) return;
      const badge = fab.querySelector(".rdsh-mux-fab-badge");
      if (badge !== null) {
        badge.textContent = notificationTotal === 0 ? "" : notificationTotal > 99 ? "99+" : String(notificationTotal);
        badge.toggleAttribute("data-visible", notificationTotal > 0);
      }
      fab.setAttribute("aria-label", notificationTotal > 0
        ? t("mux.fab.openWithCount", { count: notificationTotal })
        : t("mux.fab.open"));
    }

    function countSessionStatuses(statuses, mainIds) {
      if (statuses === null || statuses === undefined || typeof statuses.entries !== "function") return 0;
      let count = 0;
      for (const [sessionId, status] of statuses.entries()) {
        if (mainIds !== null && !mainIds.has(sessionId)) continue;
        const kind = status?.pendingInteraction?.kind;
        const waiting = kind === "question" || kind === "approval" || kind === "plan-review";
        if (status?.completionUnread === true || waiting) count += 1;
      }
      return count;
    }

    function NotificationWatcher(props) {
      const useSessionStatus = props.useSessionStatus;
      const useSessions = props.useSessions;
      const hasHook = typeof useSessionStatus === "function";
      const hasSessions = typeof useSessions === "function";
      const statuses = hasHook ? useSessionStatus((value) => value) : null;
      const sessions = hasSessions ? useSessions((value) => value) : null;
      useEffect(() => {
        const byId = sessions !== null && sessions !== undefined ? sessions.byId : null;
        const mainIds = byId !== null && byId !== undefined && typeof byId === "object"
          ? new Set(Object.entries(byId).filter(([, row]) => row !== null && row !== undefined && row.origin !== "subagent").map(([id]) => id))
          : null;
        const total = countSessionStatuses(statuses, null);
        const main = countSessionStatuses(statuses, mainIds);
        applyNotificationCount(main);
        // Cross-Session running-subagent diagnostic. The header chips read the
        // scoped jobs/sessionStatus projections instead, so a running child of
        // another Session cannot spin this Session's chip (#40).
        let runningSubagents = 0;
        const runningIds = new Set();
        if (byId !== null && byId !== undefined && typeof byId === "object" && statuses !== null && statuses !== undefined && typeof statuses.get === "function") {
          for (const [id, row] of Object.entries(byId)) {
            if (row === null || row === undefined || statuses.get(id)?.running !== true) continue;
            runningIds.add(id);
            if (row.origin === "subagent") runningSubagents += 1;
          }
        }
        globalThis.__RDSH_MOBILE_UX_RUNNING__ = runningIds;
        document.documentElement.setAttribute("data-rdsh-running-subagents", String(runningSubagents));
        document.documentElement.toggleAttribute("data-rdsh-badge-hook", hasHook);
        document.documentElement.toggleAttribute("data-rdsh-sessions-hook", hasSessions);
        globalThis.__RDSH_MOBILE_UX_BADGE__ = { total, main, subagents: Math.max(0, total - main), runningSubagents, mainIds: mainIds === null ? null : [...mainIds] };
        scheduleDecorate();
      }, [statuses, sessions, hasHook, hasSessions]);
      return null;
    }

    /**
     * The drawer's floating button and backdrop, created only in mobile mode
     * (#44): a desktop has no injected nodes to leave behind.
     */
    function installDrawer() {
      if (fab !== null) return;
      fab = document.createElement("button");
      fab.type = "button";
      fab.className = "rdsh-mux-fab";
      fab.setAttribute("aria-label", t("mux.fab.open"));
      fab.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg><span class="rdsh-mux-fab-badge" aria-hidden="true"></span>';
      fab.addEventListener("click", toggleDrawer);

      backdrop = document.createElement("div");
      backdrop.className = "rdsh-mux-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      // Why a touch and not the click: the app frame already owns "a press
      // outside the panel closes it", and on a touch its pointerdown listener
      // runs before any click. Pressing the uncovered strip therefore collapses
      // the frame first, and the click that follows a moment later would find
      // a frame that is already closed — or worse, the element that slid into
      // the finger's place — and do nothing. Closing on the touch itself keeps
      // the intent: one tap on the uncovered screen dismisses the sheet.
      backdrop.addEventListener("pointerdown", (event) => {
        if (event.isPrimary === false) return;
        // The release decides: a press that turned into a scroll or a swipe
        // fires pointercancel instead and leaves the sheet where it is.
        const release = () => {
          backdrop.removeEventListener("pointerup", release);
          backdrop.removeEventListener("pointercancel", cancel);
          closeDrawer();
        };
        const cancel = () => {
          backdrop.removeEventListener("pointerup", release);
          backdrop.removeEventListener("pointercancel", cancel);
        };
        backdrop.addEventListener("pointerup", release, { once: true });
        backdrop.addEventListener("pointercancel", cancel, { once: true });
      });
      backdrop.addEventListener("click", closeDrawer);

      document.body.append(backdrop, fab);
      applyNotificationCount(notificationTotal);
    }

    function removeDrawerNodes() {
      fab?.remove();
      backdrop?.remove();
      fab = null;
      backdrop = null;
    }

    let toastTimer = 0;

    function mobileToast(text) {
      let toast = document.querySelector(".rdsh-mux-toast");
      if (toast === null) {
        toast = document.createElement("div");
        toast.className = "rdsh-mux-toast";
        toast.setAttribute("role", "status");
        document.body.append(toast);
      }
      toast.textContent = text;
      toast.setAttribute("data-show", "");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.remove(), 2800);
    }

    function pickFiles(kind) {
      const add = addButton();
      const card = add === null ? null : add.closest('[class*="_card"]');
      const input = (card === null ? null : card.querySelector('input[type="file"]'))
        || document.querySelector('input[type="file"]');
      if (input === null || input.disabled) {
        mobileToast(t("mux.toast.noFileInput"));
        return;
      }
      // iOS reads accept when the picker opens, so set it for this one gesture
      // and put the input back afterwards.
      const previous = input.getAttribute("accept");
      input.setAttribute("accept", kind === "image" ? "image/*" : "");
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        window.removeEventListener("focus", restore);
        if (previous === null) input.removeAttribute("accept");
        else input.setAttribute("accept", previous);
      };
      input.addEventListener("change", restore, { once: true });
      // The picker returns focus when it closes, including on cancel.
      window.addEventListener("focus", restore);
      setTimeout(restore, 60000);
      input.value = "";
      input.click();
    }

    /** The composer focuses the editor on mousedown; that opens the keyboard. */
    function onMouseDownCapture(event) {
      // Paired with the "+" hijack below: on a desktop the stock mousedown must
      // reach the composer's own menu (#17).
      if (!phone()) return;
      if (addButtonOf(event.target) === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    // ---------------------------------------------------------------------
    // Session rows: tap opens, long press drags
    // ---------------------------------------------------------------------
    let tapCandidate = null;
    /** The right panel tab under the finger, for the same replay as a row. */
    let tabCandidate = null;
    /** A pan that started on the strip's empty gutter rather than a tab. */
    let stripPanCandidate = null;
    let tabReplayTimer = 0;
    /**
     * Right-panel tab drag is gated on a long press.
     *
     * dockkit starts its tab drag from `pointerdown` + a 4px `pointermove`
     * (`DRAG_THRESHOLD = 4` in the shipped bundle), and its strip is
     * `touch-action: none`, so a plain tap or a sideways swipe used to become a
     * reorder. Until this timer fires, every `pointermove` for the touch is
     * stopped before the app's window-level listener sees it; the upstream
     * listener stays armed from the original pointerdown, so once the hold
     * fires the next move starts the *real* reorder (no order of our own).
     */
    const TAB_HOLD_MS = 450;
    /** Movement before the hold is cancelled; wind, not a drag. */
    const TAB_HOLD_SLOP_PX = 10;
    let tabHoldTimer = 0;
    /** The tab a completed hold-drag belonged to, for its release click. */
    let tabDraggedTab = null;
    let tabDragSuppressUntil = 0;
    /** The row whose long press opened its menu, so the release click is eaten. */
    let menuOpenedUntil = 0;
    /** Long-press: held still this long and it opens the row menu. */
    const LONG_PRESS_MS = 480;
    /** Movement past this many pixels turns the gesture into a drag instead. */
    const LONG_PRESS_SLOP_PX = 12;

    /**
     * The row's own "..." trigger.
     *
     * Structure first: upstream class names are hashed, but the actions
     * container is the only one holding buttons inside a session row.
     */
    function sessionMenuButton(row) {
      const scoped = row.querySelector('[class*="_rowActions"] button');
      if (scoped !== null) return scoped;
      return [...row.querySelectorAll("button")].find((button) => ACTIONS_PROBE.test(button.getAttribute("aria-label") || "")) ?? null;
    }

    function cancelLongPress() {
      if (longPressTimer !== 0) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
    }

    function fireLongPress() {
      const candidate = tapCandidate;
      longPressTimer = 0;
      if (candidate === null || candidate.cancelled || candidate.fired) return;
      const button = sessionMenuButton(candidate.row);
      if (button === null) return;
      candidate.fired = true;
      candidate.cancelled = true;
      // A row that is neither selected nor hovered hides its actions, so the
      // trigger measures 0x0 and the menu portal opens at the top-left corner.
      // Reveal it for the click and keep it measurable while React positions
      // the portal; the app's own menu-open class takes over from there.
      // A long press must not leave the system's own affordances behind: iOS can
      // have started a selection and its callout before the timer fired.
      try {
        globalThis.getSelection?.()?.removeAllRanges();
      } catch { /* selection API unavailable */ }
      candidate.row.setAttribute("data-rdsh-row-menu", "");
      setTimeout(() => candidate.row.removeAttribute("data-rdsh-row-menu"), 1500);
      // Open the menu first: the arm window below also swallows clicks, and
      // arming it before this click would eat the very click that opens it.
      button.click();
      // The release still synthesises a click on the row, which would open the
      // session on top of the menu. Generous because a held finger can stay
      // down, and one-shot so the next real tap is unaffected.
      menuOpenedUntil = Date.now() + 4000;
    }

    let longPressTimer = 0;

    /** A row click that lands on a control inside the row is that control's. */
    function controlInsideRow(target) {
      const control = target.closest && target.closest("button, [role='button'], [role='menuitem'], input, textarea");
      return control !== null && control !== undefined && control.closest('[data-row-key^="session:"]') !== null;
    }

    // ---------------------------------------------------------------------
    // Queued messages: attach the dock to the composer, preview the text, and
    // offer the existing row actions from a long-press menu.
    // ---------------------------------------------------------------------
    let queuePress = null;
    let queuePressTimer = 0;
    let queueSuppressClickUntil = 0;
    let queuePreview = null;
    let queueMenu = null;
    let queueDismiss = null;

    function cancelQueuePressTimerOnly() {
      if (queuePressTimer !== 0) {
        clearTimeout(queuePressTimer);
        queuePressTimer = 0;
      }
    }

    function closeQueueUi() {
      if (queuePressTimer !== 0) {
        clearTimeout(queuePressTimer);
        queuePressTimer = 0;
      }
      queuePress = null;
      queuePreview?.remove();
      queuePreview = null;
      queueMenu?.remove();
      queueMenu = null;
      if (queueDismiss !== null) {
        document.removeEventListener("pointerdown", queueDismiss.pointer, true);
        document.removeEventListener("keydown", queueDismiss.key, true);
        queueDismiss = null;
      }
    }

    function closeQueuePreview() {
      queuePreview?.remove();
      queuePreview = null;
      if (queueMenu === null && queueDismiss !== null) {
        document.removeEventListener("pointerdown", queueDismiss.pointer, true);
        document.removeEventListener("keydown", queueDismiss.key, true);
        queueDismiss = null;
      }
    }

    function closeQueueMenu() {
      queueMenu?.remove();
      queueMenu = null;
      if (queuePreview === null && queueDismiss !== null) {
        document.removeEventListener("pointerdown", queueDismiss.pointer, true);
        document.removeEventListener("keydown", queueDismiss.key, true);
        queueDismiss = null;
      }
    }

    function queueRowAction(row, pattern) {
      return [...row.querySelectorAll("button[aria-label]")]
        .find((button) => pattern.test(button.getAttribute("aria-label") || "")) ?? null;
    }

    function queueMenuAt(row) {
      closeQueueUi();
      const preview = row.querySelector("[data-rdsh-queue-preview]");
      const text = (preview?.getAttribute("data-rdsh-queue-text") || "").trim();
      const menu = document.createElement("div");
      menu.className = "rdsh-mux-queue-menu";
      menu.setAttribute("role", "menu");
      const items = [
        { label: "Edit", pattern: /^Edit queued message$/i },
        { label: "Send now", pattern: /^Steer queued message$/i },
        { label: "Remove", pattern: /^Remove queued message$/i },
      ];
      for (const item of items) {
        const action = queueRowAction(row, item.pattern);
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
        button.disabled = action === null || action.disabled === true || text === "";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (action !== null && action.disabled !== true) action.click();
          closeQueueUi();
        });
        menu.append(button);
      }
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.setAttribute("role", "menuitem");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeQueueMenu();
      });
      menu.append(cancel);
      document.body.append(menu);
      const rect = row.getBoundingClientRect();
      // #59: keep the long-press menu inside the measured safe zone.
      const left = safeInset("left");
      const right = safeInset("right");
      const floor = safeInset("top") + 12;
      const width = Math.min(260, window.innerWidth - left - right - 24);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.round(Math.max(left + 12, Math.min(rect.left, window.innerWidth - right - width - 12)))}px`;
      menu.style.top = `${Math.round(Math.max(floor, rect.top - 8 - menu.getBoundingClientRect().height))}px`;
      queueMenu = menu;
      attachQueueDismiss();
    }

    function queuePreviewAt(preview) {
      if (queuePreview !== null && queuePreview.getAttribute("data-rdsh-queue-for") === preview.getAttribute("data-rdsh-queue-for")) {
        closeQueuePreview();
        return;
      }
      closeQueueUi();
      const row = preview.closest("[data-rdsh-queue-row]");
      if (row === null) return;
      const text = preview.getAttribute("data-rdsh-queue-text") || "";
      const panel = document.createElement("div");
      panel.className = "rdsh-mux-queue-preview";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Queued message preview");
      panel.setAttribute("data-rdsh-queue-for", preview.getAttribute("data-rdsh-queue-for"));
      panel.textContent = text;
      document.body.append(panel);
      const composer = document.querySelector("[data-rdsh-composer-root]");
      const composerTop = composer === null ? window.innerHeight : composer.getBoundingClientRect().top;
      const rowTop = row.getBoundingClientRect().top;
      const bottom = Math.max(12, window.innerHeight - Math.min(composerTop, rowTop) + 8);
      panel.style.bottom = `${Math.round(bottom)}px`;
      queuePreview = panel;
      attachQueueDismiss();
    }

    function attachQueueDismiss() {
      if (queueDismiss !== null) return;
      const pointer = (event) => {
        if (queuePreview?.contains(event.target) || queueMenu?.contains(event.target)) return;
        if (event.target.closest?.("[data-rdsh-queue-preview]") !== null && event.target.closest?.("[data-rdsh-queue-preview]") !== undefined) return;
        closeQueueUi();
      };
      const key = (event) => {
        if (event.key === "Escape") closeQueueUi();
      };
      queueDismiss = { pointer, key };
      document.addEventListener("pointerdown", pointer, true);
      document.addEventListener("keydown", key, true);
    }

    function cancelQueuePress() {
      if (queuePressTimer !== 0) {
        clearTimeout(queuePressTimer);
        queuePressTimer = 0;
      }
      queuePress = null;
    }

    // ---------------------------------------------------------------------
    // New-session workspace picker: search + a bounded scroll viewport, with
    // the existing "Add workspace…" footer left outside the scroll area. The
    // trigger and the menu are recognized by structure, never by their
    // localized labels (#39).
    // ---------------------------------------------------------------------
    let workspacePickerPending = false;
    let workspacePickerState = null;
    let workspacePickerWatch = null;
    let workspacePickerWatchTimer = 0;

    /**
     * Stop watching for the picker's portal.
     *
     * The observer exists only between the trigger click and the first
     * decorated panel: the search row has to be in the menu before its first
     * visible paint, otherwise upstream's anchor pass measures the old height
     * and the panel jumps on the next frame.
     */
    function stopWorkspacePickerWatch() {
      if (workspacePickerWatchTimer !== 0) {
        clearTimeout(workspacePickerWatchTimer);
        workspacePickerWatchTimer = 0;
      }
      workspacePickerWatch?.disconnect();
      workspacePickerWatch = null;
    }

    /**
     * Mark the next menu as the workspace chooser and catch its mount.
     *
     * `decorateWorkspacePicker()` used to run only from the rAF decorate pass,
     * which can land after the panel's first paint. A MutationObserver
     * callback runs at the microtask checkpoint of the commit that mounts the
     * portal, so the search row and its attributes are in place before the
     * upstream rAF anchor pass measures the panel.
     */
    function beginWorkspacePicker() {
      workspacePickerPending = true;
      if (workspacePickerWatch !== null) return;
      workspacePickerWatch = new MutationObserver(() => {
        decorateWorkspacePicker();
        if (workspacePickerState !== null && workspacePickerState.menu.isConnected) {
          stopWorkspacePickerWatch();
        } else if (!workspacePickerPending) {
          // The panel was found but had no list (or closed again): there is
          // nothing left to wait for, so do not keep a body observer alive.
          stopWorkspacePickerWatch();
        }
      });
      workspacePickerWatch.observe(document.body, { childList: true, subtree: true });
      // A menu that was already mounted (a re-open that reuses the portal) is
      // decorated without waiting for another mutation.
      decorateWorkspacePicker();
      if (workspacePickerState !== null && workspacePickerState.menu.isConnected) {
        stopWorkspacePickerWatch();
        return;
      }
      workspacePickerWatchTimer = setTimeout(() => {
        workspacePickerWatchTimer = 0;
        workspacePickerPending = false;
        stopWorkspacePickerWatch();
        scheduleDecorate();
      }, 1500);
    }

    function clearWorkspacePicker() {
      const state = workspacePickerState;
      workspacePickerState = null;
      workspacePickerPending = false;
      if (state === null) return;
      state.input.removeEventListener("keydown", state.keydown);
      state.search.remove();
      state.empty.remove();
      for (const wrapper of state.wrappers) {
        wrapper.removeAttribute("data-rdsh-workspace-hidden");
      }
      state.menu.removeAttribute("data-rdsh-workspace-menu");
      state.viewport.removeAttribute("data-rdsh-workspace-viewport");
    }

    /**
     * The control a workspace-picker click came from, or null.
     *
     * Both picker entries carry the localized `hero.chooseWorkspace` label
     * ("Choose workspace" / "选择工作区"), so matching that aria-label only
     * ever recognized an English UI (#39). Their structure does not localize:
     * the hero WorkspaceChip is the popup control in the same row as the
     * picker's slot outlet, and the session-less composer is the popup draft
     * editor (`data-composer-input`). Both mirror the picker's open state in
     * `aria-expanded`.
     */
    function workspaceTriggerControl(target) {
      if (target.closest === undefined) return null;
      const control = target.closest('[aria-haspopup="menu"]');
      if (control === null) return null;
      if (control.getAttribute("role") === "menuitem") return null;
      if (!control.hasAttribute("aria-expanded")) return null;
      if (control.hasAttribute("data-composer-input")) return control;
      const row = control.parentElement;
      return row !== null && row.querySelector('[data-slot="conversation.hero.workspace"]') !== null ? control : null;
    }

    /**
     * Whether a picker trigger currently reports its menu open.
     *
     * `aria-expanded` is the picker's own open state, so the menu can be told
     * apart from the other icon menus upstream without reading any localized
     * string. This also covers a picker opened from the keyboard (Enter/Space
     * on the session-less composer), which never produces the click below.
     */
    function workspacePickerOpen() {
      for (const control of document.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]')) {
        if (workspaceTriggerControl(control) !== null) return true;
      }
      return false;
    }

    /** The rows of every list a menu surface holds, viewport first. */
    function workspaceMenuLists(menu) {
      const lists = [];
      for (const child of menu.children) {
        const rows = [...child.querySelectorAll('button[role="menuitem"]')];
        if (rows.length > 0) lists.push(rows);
      }
      return lists;
    }

    /**
     * The picker's menu surface, recognized by its parts, not its text.
     *
     * Upstream's shared Menu renders `[role="menu"]` as a scrolling viewport
     * plus an optional footer ("Add workspace…", or none without a directory
     * flow). The picker's rows are folder rows, so every row carries an icon.
     * The other menus that also have icon rows (open-in-app's app list) are
     * not open at the same time as the chooser, so the picker's own
     * `aria-expanded` state separates them without reading a label (#39).
     * Matching the English footer text left the picker undecorated outside
     * English: `menu.addWorkspace` is "添加工作区…" in zh.
     */
    function workspacePickerMenu() {
      const pickerOpen = workspacePickerOpen() || workspacePickerPending;
      for (const menu of document.querySelectorAll('[role="menu"]')) {
        if (menu.getAttribute("data-rdsh-workspace-menu") === "") return menu;
        if (!pickerOpen) continue;
        const lists = workspaceMenuLists(menu);
        if (lists.length === 0) continue;
        if (!lists[0].every((row) => row.querySelector("svg") !== null)) continue;
        return menu;
      }
      return null;
    }

    function decorateWorkspacePicker() {
      if (!phone()) {
        clearWorkspacePicker();
        return;
      }
      const menu = workspacePickerMenu();
      if (menu === null) {
        // While the trigger's observer is still waiting, a menu-less mutation
        // (focus, aria-expanded) must not cancel the pending picker.
        if (!workspacePickerPending) clearWorkspacePicker();
        return;
      }
      if (workspacePickerState !== null && workspacePickerState.menu === menu) {
        return;
      }
      clearWorkspacePicker();
      const viewport = [...menu.children].find((child) => child.querySelector?.('button[role="menuitem"]') !== null && child.querySelector?.('button[role="menuitem"]') !== undefined);
      if (viewport === undefined) {
        workspacePickerPending = false;
        return;
      }
      const wrappers = [...viewport.querySelectorAll('button[role="menuitem"]')].map((button) => button.parentElement ?? button);
      const search = document.createElement("div");
      search.className = "rdsh-mux-workspace-search";
      search.setAttribute("data-rdsh-workspace-search", "");
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = t("workspace.search.placeholder");
      input.setAttribute("aria-label", t("workspace.search.placeholder"));
      input.autocomplete = "off";
      input.spellcheck = false;
      search.append(input);
      const empty = document.createElement("div");
      empty.className = "rdsh-mux-workspace-empty";
      empty.setAttribute("data-rdsh-workspace-empty", "");
      empty.textContent = t("workspace.search.noMatches");
      empty.hidden = true;
      const apply = () => {
        const query = input.value.trim().toLowerCase();
        let shown = 0;
        for (const wrapper of wrappers) {
          const label = (wrapper.textContent || "").trim().toLowerCase();
          const match = query === "" || label.includes(query);
          wrapper.toggleAttribute("data-rdsh-workspace-hidden", !match);
          if (match) shown += 1;
        }
        empty.hidden = shown !== 0;
      };
      const keydown = (event) => {
        if (event.key !== "Escape") {
          event.stopPropagation();
          return;
        }
        if (input.value !== "") {
          input.value = "";
          apply();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // An empty search lets the trusted Escape bubble to the upstream menu
        // close handler. Only a non-empty search is consumed here.
        return;
      };
      input.addEventListener("input", apply);
      input.addEventListener("keydown", keydown);
      // Directly before the viewport: the search row is part of the panel's
      // measured height, while "Add workspace…" stays outside the scroller.
      menu.insertBefore(search, viewport);
      viewport.append(empty);
      menu.setAttribute("data-rdsh-workspace-menu", "");
      viewport.setAttribute("data-rdsh-workspace-viewport", "");
      workspacePickerState = { menu, viewport, wrappers, input, search, empty, keydown };
      workspacePickerPending = false;
      apply();
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }

    /**
     * The title/tabindex values the queue preview had before this module wrote
     * on them (usually none), so a resize restores upstream's own attributes
     * rather than deleting whatever was there.
     */
    const queuePreviewOriginal = new WeakMap();

    function clearQueueDockHooks() {
      for (const bridge of document.querySelectorAll("[data-rdsh-queue-join]")) bridge.remove();
      for (const panel of document.querySelectorAll("[data-rdsh-queue-clip]")) {
        panel.style.removeProperty("clip-path");
        panel.removeAttribute("data-rdsh-queue-clip");
      }
      for (const dock of document.querySelectorAll("[data-rdsh-queue-dock]")) dock.style.removeProperty("margin-bottom");
      for (const preview of document.querySelectorAll("[data-rdsh-queue-preview]")) {
        const original = queuePreviewOriginal.get(preview);
        if (original === undefined) continue;
        queuePreviewOriginal.delete(preview);
        if (original.title === null) preview.removeAttribute("title");
        else preview.setAttribute("title", original.title);
        if (original.tabindex === null) preview.removeAttribute("tabindex");
        else preview.setAttribute("tabindex", original.tabindex);
      }
      for (const attribute of ["data-rdsh-queue-dock", "data-rdsh-queue-panel", "data-rdsh-queue-row", "data-rdsh-queue-index", "data-rdsh-queue-preview", "data-rdsh-queue-for", "data-rdsh-queue-text", "data-rdsh-queue-join"]) {
        for (const element of document.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
      }
    }

    // ---------------------------------------------------------------------
    // Right-panel workspace files: long-press copy and explicit search.
    //
    // The tree is upstream's, and its stable hooks (verified against
    // @deepseek-ai/dsh-client-ui-sidebar-files 0.2.1-rc.2) are:
    //   [data-files-state="tree"][data-files-root="<absolute root>"]
    //   [data-files-body] > ul li[data-files-entry="file|directory"]
    //     with data-files-path="<absolute path>"
    //   header PathLabel: [data-path-label][data-files-path]
    //     title="<absolute root>"
    // A row's path is already absolute; a relative one is joined to the real
    // root the tree reports instead of inventing a path.
    // ---------------------------------------------------------------------
    const FILES_HIGHLIGHT = "rdsh-files-search";
    const FILES_PRESS_MS = 500;
    const FILES_PRESS_SLOP_PX = 10;
    let filesRoot = null;
    let filesSearch = null;
    let filesPress = null;
    let filesMenu = null;
    let filesClickGuard = null;
    let filesRootTrigger = null;
    let filesRootTriggerSaved = null;
    let workspaceToolsInstalled = false;

    /** An absolute path from the tree's real root and one of its entry paths. */
    function filesAbsolutePath(root, path) {
      const value = String(path ?? "").replace(/\\/g, "/").trim();
      if (value === "") return "";
      if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:\//.test(value)) {
        return value.length > 1 ? value.replace(/\/+$/, "") : value;
      }
      const base = String(root?.getAttribute?.("data-files-root") ?? "")
        .replace(/\\/g, "/")
        .replace(/\/+$/, "");
      if (base === "") return "";
      return `${base}/${value}`.replace(/\/+$/, "");
    }

    function filesBaseName(path) {
      const parts = String(path ?? "").replace(/\\/g, "/").split("/").filter((part) => part !== "");
      return parts.length === 0 ? "" : parts[parts.length - 1];
    }

    function filesTreeRoot() {
      for (const root of document.querySelectorAll('[data-files-state="tree"]')) {
        // An open panel carries the panel hook; a closed one is clipped to a
        // zero-width column, so its tree is still mounted but not visible.
        if (root.closest("[data-rdsh-rightpanel]") !== null) return root;
        const rect = root.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return root;
      }
      return null;
    }

    function filesRowPath(root, row) {
      return filesAbsolutePath(root, row.getAttribute("data-files-path"));
    }

    /**
     * The name span upstream draws inside a row's button.
     *
     * Structure only: the icon is an SVG child and the name is the last
     * element child without children of its own. A missing span degrades to
     * the basename for filtering and skips highlighting.
     */
    function filesRowLabel(row) {
      const button = row.querySelector("button");
      if (button === null) return null;
      const spans = [...button.children].filter((child) => child.tagName === "SPAN" && child.children.length === 0);
      return spans.length === 0 ? null : spans[spans.length - 1];
    }

    function filesRowName(root, row) {
      const label = filesRowLabel(row);
      const text = label === null ? "" : (label.textContent || "").trim();
      return text === "" ? filesBaseName(filesRowPath(root, row)) : text;
    }

    function filesTextNodes(node, out) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out.push(child);
        else filesTextNodes(child, out);
      }
      return out;
    }

    /**
     * A case-insensitive matcher over the original string.
     *
     * Lowercasing first is wrong for highlighting: characters such as `İ`
     * expand to two code units when lowercased, so an index taken from the
     * lowered string can point past the original text node. Matching on the
     * original string keeps every offset in Range's coordinate space.
     */
    function filesQueryPattern(query, flags) {
      const source = String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      try {
        return new RegExp(source, `${flags}u`);
      } catch (error) {
        try {
          return new RegExp(source, flags);
        } catch (fallbackError) {
          return null;
        }
      }
    }

    function clearFilesHighlight() {
      const api = globalThis.CSS;
      if (api === null || typeof api !== "object" || api.highlights === undefined) return;
      if (typeof api.highlights.delete === "function") api.highlights.delete(FILES_HIGHLIGHT);
    }

    /**
     * Highlight the query inside one row's name without touching its DOM.
     *
     * CSS Custom Highlight ranges paint over the existing text nodes, so
     * upstream's React tree, its button handlers and its text selection are
     * all left exactly as they were.
     */
    function filesHighlightRanges(row, query) {
      const api = globalThis.CSS;
      if (api === null || typeof api !== "object" || api.highlights === undefined) return [];
      if (typeof globalThis.Highlight !== "function" || typeof document.createRange !== "function") return [];
      const label = filesRowLabel(row);
      if (label === null || query === "") return [];
      const pattern = filesQueryPattern(query, "gi");
      if (pattern === null) return [];
      const ranges = [];
      for (const node of filesTextNodes(label, [])) {
        const text = node.textContent || "";
        for (const match of text.matchAll(pattern)) {
          if (match[0].length === 0) continue;
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          ranges.push(range);
        }
      }
      return ranges;
    }

    /** Filter the mounted tree, keeping ancestors of a matching row visible. */
    function runFilesSearch(value) {
      const state = filesSearch;
      if (state === null) return;
      const query = String(value ?? "").trim();
      const body = state.root.querySelector("[data-files-body]") ?? state.root;
      const rows = [...body.querySelectorAll('li[data-files-entry]')];
      clearFilesHighlight();
      for (const row of rows) row.removeAttribute("data-rdsh-files-hidden");
      state.query = query;
      if (query === "") {
        state.empty.hidden = true;
        return;
      }
      const direct = new Set();
      const keep = new Set();
      const matcher = filesQueryPattern(query, "i");
      if (matcher === null) {
        state.empty.hidden = true;
        return;
      }
      for (const row of rows) {
        const name = filesRowName(state.root, row);
        if (!matcher.test(name)) continue;
        direct.add(row);
        let parent = row.parentElement;
        while (parent !== null && parent !== body) {
          if (parent.tagName === "LI" && parent.hasAttribute("data-files-entry")) keep.add(parent);
          parent = parent.parentElement;
        }
      }
      const ranges = [];
      for (const row of rows) {
        const hit = direct.has(row);
        row.toggleAttribute("data-rdsh-files-hidden", !hit && !keep.has(row));
        if (hit) ranges.push(...filesHighlightRanges(row, query));
      }
      if (ranges.length > 0) {
        const api = globalThis.CSS;
        if (api !== null && typeof api === "object" && api.highlights !== undefined && typeof api.highlights.set === "function") {
          const highlight = new globalThis.Highlight(...ranges);
          api.highlights.set(FILES_HIGHLIGHT, highlight);
        }
      }
      state.empty.hidden = direct.size !== 0;
    }

    function onFilesSearchSubmit() {
      runFilesSearch(filesSearch?.input.value ?? "");
    }

    function onFilesSearchKeyDown(event) {
      const state = filesSearch;
      if (state === null) return;
      if (event.key === "Escape") {
        // A non-empty field clears on Escape; an empty one lets the shell
        // handle the key (usually closing the panel).
        if (state.input.value !== "") {
          state.input.value = "";
          runFilesSearch("");
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      // Explicit submission only: typing never filters.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        runFilesSearch(state.input.value);
      }
    }

    /**
     * Insert the search row between the header and the scrolling tree.
     *
     * It lives outside [data-files-body], so scrolling the tree never moves
     * the field, and the no-hit line stays visible while the tree is empty.
     * That line is a block below the field row, not a third item in it: as a
     * flex sibling it took width from the input (#43).
     */
    function ensureFilesSearch(root) {
      if (filesSearch !== null && filesSearch.root === root && filesSearch.search.isConnected !== false) return filesSearch;
      if (filesSearch !== null) {
        filesSearch.input.removeEventListener("keydown", onFilesSearchKeyDown);
        filesSearch.button.removeEventListener("click", onFilesSearchSubmit);
        filesSearch.search.remove();
        filesSearch = null;
      }
      clearFilesHighlight();
      const search = document.createElement("div");
      search.className = "rdsh-mux-files-search";
      search.setAttribute("data-rdsh-files-search", "");
      const row = document.createElement("div");
      row.className = "rdsh-mux-files-search-row";
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = t("files.search.placeholder");
      input.setAttribute("aria-label", t("files.search.placeholder"));
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("data-rdsh-files-search-input", "");
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 18H4.5A1.5 1.5 0 0 1 3 16.5v-10A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5V10"/><circle cx="15" cy="15" r="3.5"/><path d="m17.5 17.5 3 3"/></svg>';
      button.setAttribute("aria-label", t("files.search.submit"));
      button.title = t("files.search.submit");
      button.setAttribute("data-rdsh-files-search-button", "");
      const empty = document.createElement("div");
      empty.className = "rdsh-mux-files-empty";
      empty.setAttribute("data-rdsh-files-empty", "");
      empty.textContent = t("files.search.noMatches");
      empty.hidden = true;
      row.append(input, button);
      search.append(row, empty);
      input.addEventListener("keydown", onFilesSearchKeyDown);
      button.addEventListener("click", onFilesSearchSubmit);
      const body = root.querySelector("[data-files-body]");
      if (body === null) root.append(search);
      else root.insertBefore(search, body);
      filesSearch = { root, search, input, button, empty, query: "" };
      return filesSearch;
    }

    /** Tag the open tree and keep its injected row in sync with a live route. */
    function decorateWorkspaceFiles() {
      if (!phone()) {
        teardownWorkspaceFiles();
        return;
      }
      const root = filesTreeRoot();
      if (root === null) {
        teardownWorkspaceFiles();
        return;
      }
      if (filesRoot !== null && filesRoot !== root) teardownWorkspaceFiles();
      filesRoot = root;
      root.setAttribute("data-rdsh-files-tree", "");
      const pathLabel = root.querySelector("[data-path-label][data-files-path]");
      if (pathLabel === null) restoreFilesRootTrigger();
      else ensureFilesRootTrigger(pathLabel);
      ensureFilesSearch(root);
      if (filesSearch !== null && filesSearch.query !== "") runFilesSearch(filesSearch.query);
    }

    /**
     * Restore the root path's own attributes after a phone session.
     *
     * The label is a plain `<span>` upstream. On a phone it briefly becomes a
     * keyboard-reachable menu trigger; every attribute this module adds is
     * removed (or put back to its original value) on desktop, panel close and
     * dispose.
     */
    function restoreFilesRootTrigger() {
      const trigger = filesRootTrigger;
      const saved = filesRootTriggerSaved;
      filesRootTrigger = null;
      filesRootTriggerSaved = null;
      if (trigger === null || saved === null) return;
      trigger.removeEventListener("keydown", onFilesRootKeyDown);
      trigger.removeAttribute("data-rdsh-files-root-path");
      for (const [name, value] of Object.entries(saved)) {
        if (value === null) trigger.removeAttribute(name);
        else trigger.setAttribute(name, value);
      }
    }

    function ensureFilesRootTrigger(pathLabel) {
      if (filesRootTrigger === pathLabel) return;
      restoreFilesRootTrigger();
      filesRootTrigger = pathLabel;
      filesRootTriggerSaved = {
        tabindex: pathLabel.getAttribute("tabindex"),
        role: pathLabel.getAttribute("role"),
        "aria-haspopup": pathLabel.getAttribute("aria-haspopup"),
        "aria-expanded": pathLabel.getAttribute("aria-expanded"),
        "aria-label": pathLabel.getAttribute("aria-label"),
      };
      pathLabel.setAttribute("data-rdsh-files-root-path", "");
      pathLabel.setAttribute("tabindex", "0");
      if (!pathLabel.hasAttribute("role")) pathLabel.setAttribute("role", "button");
      pathLabel.setAttribute("aria-haspopup", "menu");
      pathLabel.setAttribute("aria-expanded", "false");
      if (!pathLabel.hasAttribute("aria-label")) {
        const title = pathLabel.getAttribute("title");
        if (title !== null && title !== "") pathLabel.setAttribute("aria-label", title);
      }
      pathLabel.addEventListener("keydown", onFilesRootKeyDown);
    }

    function onFilesRootKeyDown(event) {
      if (filesRootTrigger === null) return;
      const opens = event.key === "Enter"
        || event.key === " "
        || event.key === "Spacebar"
        || event.key === "ContextMenu"
        || (event.key === "F10" && event.shiftKey === true);
      if (!opens) return;
      event.preventDefault();
      event.stopPropagation();
      const root = filesRoot;
      const label = filesRootTrigger;
      if (root === null || label === null) return;
      const path = filesAbsolutePath(
        root,
        label.getAttribute("title") || root.getAttribute("data-files-root") || "",
      );
      if (path === "") return;
      closeFilesMenu();
      openFilesMenu({ kind: "root", path, anchor: label });
    }

    function cancelFilesPress() {
      if (filesPress === null) return;
      if (filesPress.timer !== 0) clearTimeout(filesPress.timer);
      filesPress = null;
    }

    /** What a long press on the tree would act on: a row or the root path. */
    function filesAnchorAt(target) {
      if (!phone() || filesRoot === null) return null;
      if (target === null || target.closest === undefined) return null;
      // Another tree/panel may be mounted (a hidden route, a second tab, a
      // future split view). Only rows inside the tree this module decorated
      // are copy targets.
      if (!filesRoot.contains(target)) return null;
      const row = target.closest("li[data-files-entry]");
      if (row !== null) {
        const entry = row.getAttribute("data-files-entry");
        if (entry !== "file" && entry !== "directory") return null;
        const path = filesRowPath(filesRoot, row);
        if (path === "") return null;
        return { kind: "entry", path, row, anchor: row.querySelector("button") ?? row };
      }
      const label = target.closest("[data-path-label][data-files-path]");
      if (label !== null) {
        const path = filesAbsolutePath(
          filesRoot,
          label.getAttribute("title") || filesRoot.getAttribute("data-files-root") || "",
        );
        if (path === "") return null;
        return { kind: "root", path, anchor: label };
      }
      return null;
    }

    /** Is this event still the finger that started the long press? */
    function filesSamePointer(event) {
      if (filesPress === null) return false;
      if (filesPress.pointerId === null) return true;
      return typeof event.pointerId !== "number" || event.pointerId === filesPress.pointerId;
    }

    function onFilesPointerDown(event) {
      if (!phone() || event.pointerType === "mouse" || event.isPrimary === false) return;
      // This document capture listener is registered at boot, so it runs before
      // the menu's own dismiss listener: closing here would remove the item
      // from under the finger and its click would land on the tree (#42).
      if (filesMenu !== null && filesMenu.node.contains(event.target)) return;
      // A second finger must not replace or cancel the press already running.
      if (filesPress !== null && !filesSamePointer(event)) return;
      if (filesMenu !== null) closeFilesMenu();
      const hit = filesAnchorAt(event.target);
      if (hit === null) return;
      cancelFilesPress();
      filesPress = {
        ...hit,
        x: typeof event.clientX === "number" ? event.clientX : 0,
        y: typeof event.clientY === "number" ? event.clientY : 0,
        pointerId: typeof event.pointerId === "number" ? event.pointerId : null,
        timer: 0,
      };
      filesPress.timer = setTimeout(() => {
        if (filesPress === null) return;
        const press = filesPress;
        filesPress = null;
        // Open first: openFilesMenu() retires an older guard, so the row that
        // started this press must be armed afterwards.
        openFilesMenu(press);
        if (press.row !== undefined) armFilesClickGuard(press.row);
      }, FILES_PRESS_MS);
    }

    function onFilesPointerMove(event) {
      if (!filesSamePointer(event) || event.isPrimary === false) return;
      const dx = (typeof event.clientX === "number" ? event.clientX : 0) - filesPress.x;
      const dy = (typeof event.clientY === "number" ? event.clientY : 0) - filesPress.y;
      if (Math.hypot(dx, dy) > FILES_PRESS_SLOP_PX) cancelFilesPress();
    }

    function onFilesPointerUp(event) {
      if (!filesSamePointer(event)) return;
      cancelFilesPress();
    }

    function onFilesPointerCancel(event) {
      if (!filesSamePointer(event)) return;
      cancelFilesPress();
    }

    function onFilesScroll(event) {
      const target = event === undefined || event === null ? undefined : event.target;
      // The transcript behind the right panel streams and scrolls constantly.
      // Only a scroll that can move the tree (or our fixed menu) may cancel a
      // press or close the menu.
      const related = target === undefined
        || target === null
        || target === document
        || target === document.documentElement
        || target === document.body
        || target === window
        || (filesRoot !== null && filesRoot.contains(target))
        || (filesMenu !== null && filesMenu.node.contains(target));
      if (!related) return;
      cancelFilesPress();
      if (filesMenu !== null) closeFilesMenu();
    }

    /**
     * Right-click on a narrow window and Android's long-press context menu.
     *
     * The pointer timer excludes the mouse (a mouse hold is not a touch
     * gesture), so the contextmenu event is the mouse/keyboard route. It is
     * also what suppresses Android's native menu on rows that opt out of text
     * selection.
     */
    function onFilesContextMenu(event) {
      if (!phone() || filesRoot === null) return;
      const target = event.target;
      if (target === null || target === undefined || target.closest === undefined) return;
      if (filesMenu !== null && filesMenu.node.contains(target)) {
        event.preventDefault();
        return;
      }
      const hit = filesAnchorAt(target);
      if (hit === null) return;
      event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      cancelFilesPress();
      if (filesMenu !== null && filesMenu.anchor === hit.anchor) return;
      closeFilesMenu();
      openFilesMenu(hit);
    }

    /**
     * A long press ends in a click; never let that click open or toggle the
     * row. The listener is scoped to the pressed row and retires itself, so no
     * document-level click handler is left behind (which would also compete
     * with the app's own click handling on every page).
     */
    function onFilesRowClickGuard(event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      clearFilesClickGuard();
    }

    function clearFilesClickGuard() {
      const guard = filesClickGuard;
      filesClickGuard = null;
      if (guard === null) return;
      if (guard.timer !== 0) clearTimeout(guard.timer);
      guard.row.removeEventListener("click", onFilesRowClickGuard, true);
    }

    function armFilesClickGuard(row) {
      clearFilesClickGuard();
      const guard = { row, timer: 0 };
      filesClickGuard = guard;
      guard.timer = setTimeout(clearFilesClickGuard, 900);
      row.addEventListener("click", onFilesRowClickGuard, true);
    }

    function copyFilesText(text) {
      void copyText(text).then((copied) => {
        if (copied) notify(t("files.copied"));
      });
    }

    function addFilesMenuItem(menu, label, action) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-rdsh-files-menu-item", "");
      item.textContent = label;
      item.addEventListener("click", () => {
        action();
        closeFilesMenu(true);
      });
      menu.append(item);
      return item;
    }

    function openFilesMenu(hit) {
      closeFilesMenu();
      const menu = document.createElement("div");
      menu.className = "rdsh-mux-files-menu";
      menu.setAttribute("data-rdsh-file-menu", "");
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", hit.kind === "root" ? t("files.menu.root") : t("files.menu.entry"));
      const items = [addFilesMenuItem(menu, t("files.menu.copyPath"), () => copyFilesText(hit.path))];
      if (hit.kind === "entry") {
        items.push(addFilesMenuItem(menu, t("files.menu.copyName"), () => copyFilesText(filesBaseName(hit.path))));
      }
      document.body.append(menu);
      const rect = typeof hit.anchor.getBoundingClientRect === "function"
        ? hit.anchor.getBoundingClientRect()
        : { left: 12, top: 12, bottom: 12, right: 12 };
      const insetLeft = safeInset("left");
      const insetRight = safeInset("right");
      const floor = safeInset("top") + 12;
      const width = Math.min(240, Math.max(160, window.innerWidth - insetLeft - insetRight - 24));
      menu.style.width = `${width}px`;
      const height = typeof menu.getBoundingClientRect === "function" ? menu.getBoundingClientRect().height : 0;
      let top = rect.bottom + 6;
      if (height > 0 && top + height > window.innerHeight - 12) top = Math.max(floor, rect.top - height - 6);
      const left = Math.min(Math.max(insetLeft + 12, rect.left), Math.max(insetLeft + 12, window.innerWidth - insetRight - width - 12));
      menu.style.top = `${Math.round(top)}px`;
      menu.style.left = `${Math.round(left)}px`;
      filesMenu = { node: menu, anchor: hit.anchor, items };
      if (hit.kind === "root" && hit.anchor === filesRootTrigger) hit.anchor.setAttribute("aria-expanded", "true");
      items[0]?.focus?.();
      document.addEventListener("pointerdown", onFilesMenuPointerDown, true);
      document.addEventListener("keydown", onFilesMenuKeyDown, true);
    }

    function closeFilesMenu(restoreFocus = false) {
      const current = filesMenu;
      filesMenu = null;
      clearFilesClickGuard();
      if (current === null) return;
      document.removeEventListener("pointerdown", onFilesMenuPointerDown, true);
      document.removeEventListener("keydown", onFilesMenuKeyDown, true);
      current.node.remove();
      if (current.anchor === filesRootTrigger) current.anchor.setAttribute("aria-expanded", "false");
      if (restoreFocus && current.anchor.isConnected !== false && typeof current.anchor.focus === "function") {
        current.anchor.focus({ preventScroll: true });
      }
    }

    function onFilesMenuPointerDown(event) {
      if (filesMenu === null) return;
      if (filesMenu.node.contains(event.target)) return;
      closeFilesMenu();
    }

    function onFilesMenuKeyDown(event) {
      const current = filesMenu;
      if (current === null) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFilesMenu(true);
        return;
      }
      const items = current.items;
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement);
      if (event.key === "Tab") {
        // A menu is not a focus trap: close it, put focus back on the trigger
        // and let the browser's default Tab move to the next element.
        event.stopPropagation();
        closeFilesMenu(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      let next;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (at === -1) next = event.key === "ArrowDown" ? 0 : items.length - 1;
      else next = (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus?.();
    }

    /** Remove the injected search, hooks and menu, restoring upstream rows. */
    function teardownWorkspaceFiles() {
      closeFilesMenu();
      cancelFilesPress();
      restoreFilesRootTrigger();
      if (filesSearch !== null) {
        filesSearch.input.removeEventListener("keydown", onFilesSearchKeyDown);
        filesSearch.button.removeEventListener("click", onFilesSearchSubmit);
        filesSearch.search.remove();
        filesSearch = null;
      }
      clearFilesHighlight();
      for (const element of document.querySelectorAll("[data-rdsh-files-hidden]")) element.removeAttribute("data-rdsh-files-hidden");
      for (const element of document.querySelectorAll("[data-rdsh-files-tree]")) element.removeAttribute("data-rdsh-files-tree");
      for (const element of document.querySelectorAll("[data-rdsh-files-root-path]")) element.removeAttribute("data-rdsh-files-root-path");
      filesRoot = null;
    }

    /**
     * Document-level pointer listeners for the tree.
     *
     * Phone-only and installed once. Delegation means React can replace rows
     * without this plugin attaching anything to them; the listeners are
     * removed on leaving the phone layout, on pagehide and on boot teardown.
     */
    function installWorkspaceTools() {
      if (workspaceToolsInstalled || !phone()) return;
      workspaceToolsInstalled = true;
      document.addEventListener("pointerdown", onFilesPointerDown, true);
      document.addEventListener("pointermove", onFilesPointerMove, true);
      document.addEventListener("pointerup", onFilesPointerUp, true);
      document.addEventListener("pointercancel", onFilesPointerCancel, true);
      document.addEventListener("scroll", onFilesScroll, true);
      document.addEventListener("contextmenu", onFilesContextMenu, true);
      window.addEventListener("pagehide", onWorkspacePageHide);
    }

    function onWorkspacePageHide(event) {
      // A bfcache entry keeps its listeners and DOM; only a real unload tears
      // the workspace resources down.
      if (event !== undefined && event !== null && event.persisted === true) return;
      disposeWorkspaceTools();
    }

    function disposeWorkspaceTools() {
      if (workspaceToolsInstalled) {
        workspaceToolsInstalled = false;
        document.removeEventListener("pointerdown", onFilesPointerDown, true);
        document.removeEventListener("pointermove", onFilesPointerMove, true);
        document.removeEventListener("pointerup", onFilesPointerUp, true);
        document.removeEventListener("pointercancel", onFilesPointerCancel, true);
        document.removeEventListener("scroll", onFilesScroll, true);
        document.removeEventListener("contextmenu", onFilesContextMenu, true);
        window.removeEventListener("pagehide", onWorkspacePageHide);
      }
      stopWorkspacePickerWatch();
      clearWorkspacePicker();
      teardownWorkspaceFiles();
    }


    // Draw corner-only patches below the queue row. The composer itself is never changed.
    function decorateQueueJoin(panel, dock) {
      const editor = document.querySelector("[data-composer-input]");
      const card = editor === null ? null : editor.closest('[class*="_card"]');
      const oldBridge = dock?.querySelector("[data-rdsh-queue-join]");
      const clear = () => {
        oldBridge?.remove();
        panel?.style.removeProperty("clip-path");
        panel?.removeAttribute("data-rdsh-queue-clip");
      };
      if (!phone() || panel === null || card === null || dock === null) {
        clear();
        return;
      }

      panel.style.removeProperty("clip-path");
      panel.removeAttribute("data-rdsh-queue-clip");
      const queueRect = panel.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const radiusPair = (value, width, height) => {
        const parts = String(value || "0").trim().split(/\s+/);
        const resolve = (part, dimension) => part.endsWith("%")
          ? dimension * (parseFloat(part) || 0) / 100
          : parseFloat(part) || 0;
        return { x: resolve(parts[0], width), y: resolve(parts[1] || parts[0], height) };
      };
      const cardStyle = getComputedStyle(card);
      const leftRadius = radiusPair(cardStyle.borderTopLeftRadius, cardRect.width, cardRect.height);
      const rightRadius = radiusPair(cardStyle.borderTopRightRadius, cardRect.width, cardRect.height);
      const leftRx = Math.min(leftRadius.x, cardRect.width / 2);
      const leftRy = Math.min(leftRadius.y, cardRect.height / 2);
      const rightRx = Math.min(rightRadius.x, cardRect.width / 2);
      const rightRy = Math.min(rightRadius.y, cardRect.height / 2);
      const overlap = queueRect.bottom - cardRect.top;
      const fmt = (value) => String(Number(value.toFixed(3)));
      const paths = [];
      let maxY = 0;

      const addCorner = (side, rx, ry) => {
        if (rx <= 0 || ry <= 0 || overlap >= ry) return;
        const tangent = side === "left" ? cardRect.left + rx : cardRect.right - rx;
        const start = side === "left"
          ? Math.max(queueRect.left, cardRect.left)
          : Math.min(queueRect.right, cardRect.right);
        let end = side === "left"
          ? Math.min(queueRect.right, tangent)
          : Math.max(queueRect.left, tangent);
        if (side === "left" ? start >= end : start <= end) return;
        if (overlap > 0) {
          const inset = rx * Math.sqrt(Math.max(0, 1 - Math.pow(1 - overlap / ry, 2)));
          const zeroY = side === "left" ? tangent - inset : tangent + inset;
          end = side === "left" ? Math.min(end, zeroY) : Math.max(end, zeroY);
        }
        if (side === "left" ? start >= end : start <= end) return;
        const depthAt = (x) => {
          const t = side === "left" ? (tangent - x) / rx : (x - tangent) / rx;
          return ry * (1 - Math.sqrt(Math.max(0, 1 - t * t))) - overlap;
        };
        if (depthAt(start) <= 0) return;
        const startLocal = start - queueRect.left;
        const endLocal = end - queueRect.left;
        let path = "M " + fmt(startLocal) + " 0 L " + fmt(endLocal) + " 0";
        for (let i = 1; i <= 20; i += 1) {
          const x = end + (start - end) * i / 20;
          const y = Math.max(0, depthAt(x));
          maxY = Math.max(maxY, y);
          path += " L " + fmt(x - queueRect.left) + " " + fmt(y);
        }
        paths.push(path + " Z");
      };

      addCorner("left", leftRx, leftRy);
      addCorner("right", rightRx, rightRy);
      const gap = Math.max(0, -overlap);
      const flatLeft = cardRect.left + leftRx;
      const flatRight = cardRect.right - rightRx;
      const centerLeft = Math.max(queueRect.left, flatLeft);
      const centerRight = Math.min(queueRect.right, flatRight);
      if (gap > 0 && centerRight > centerLeft) {
        paths.push("M " + fmt(centerLeft - queueRect.left) + " 0 H " + fmt(centerRight - queueRect.left)
          + " V " + fmt(gap) + " H " + fmt(centerLeft - queueRect.left) + " Z");
        maxY = Math.max(maxY, gap);
      }

      if (paths.length === 0 || maxY <= 0) {
        oldBridge?.remove();
        return;
      }
      const svgNS = "http://www.w3.org/2000/svg";
      const bridge = oldBridge || document.createElementNS(svgNS, "svg");
      bridge.setAttribute("data-rdsh-queue-join", "");
      bridge.setAttribute("aria-hidden", "true");
      bridge.setAttribute("viewBox", "0 0 " + fmt(queueRect.width) + " " + fmt(maxY));
      bridge.setAttribute("preserveAspectRatio", "none");
      Object.assign(bridge.style, {
        position: "absolute",
        left: (queueRect.left - dockRect.left) + "px",
        top: (queueRect.bottom - dockRect.top) + "px",
        width: queueRect.width + "px",
        height: maxY + "px",
        overflow: "visible",
        pointerEvents: "none",
        zIndex: "0",
      });
      bridge.replaceChildren();
      // Upstream paints the queue panel's real background in `::before`
      // (`--dsw-specific-menu`); the panel element itself is transparent (the
      // composer uses `--dsw-specific-input-major`). Prefer the queue colour,
      // then a real panel colour, and only then the composer as a fallback.
      const transparent = (value) => !value
        || value === "transparent"
        || value === "rgba(0, 0, 0, 0)"
        || value === "rgba(0,0,0,0)";
      let fill = "";
      try {
        fill = getComputedStyle(panel, "::before").backgroundColor;
      } catch (error) {
        /* an older engine without pseudo-element styles falls through */
      }
      const panelColor = getComputedStyle(panel).backgroundColor;
      if (transparent(fill)) fill = transparent(panelColor) ? cardStyle.backgroundColor : panelColor;
      for (const data of paths) {
        const shape = document.createElementNS(svgNS, "path");
        shape.setAttribute("d", data);
        shape.setAttribute("fill", fill);
        bridge.append(shape);
      }
      if (!oldBridge) dock.append(bridge);
    }

    function decorateQueueDock() {
      if (!phone()) {
        if (queuePreview !== null || queueMenu !== null) closeQueueUi();
        clearQueueDockHooks();
        return;
      }
      const dock = document.querySelector("[data-queue-dock]");
      if (dock === null) {
        if (queuePreview !== null || queueMenu !== null) closeQueueUi();
        return;
      }
      dock.setAttribute("data-rdsh-queue-dock", "");
      const panel = dock.querySelector('[class*="_panel"]');
      if (panel !== null) panel.setAttribute("data-rdsh-queue-panel", "");
      // Drop the queue until its bottom edge rests on the card's top edge: the
      // card is never moved and never reshaped. The composer stack is a flex
      // column whose gap is 6px in a session and 8px in the hero, so cancel
      // whatever the parent actually uses instead of guessing a constant.
      if (panel !== null && dock.parentElement !== null) {
        const gapPx = Number.parseFloat(getComputedStyle(dock.parentElement).rowGap);
        // 1px past the card's top edge so its 0.5px outline cannot draw a
        // line across the join.
        if (Number.isFinite(gapPx) && gapPx > 0) dock.style.marginBottom = (-(gapPx + 1)) + "px";
      }

      decorateQueueJoin(panel, dock);
      let index = 0;
      for (const row of dock.querySelectorAll("li")) {
        const preview = row.querySelector('[class*="_preview"]');
        if (preview === null) continue;
        row.setAttribute("data-rdsh-queue-row", "");
        row.setAttribute("data-rdsh-queue-index", String(index));
        const text = (preview.textContent || "").trim().replace(/\s+/g, " ");
        if (!queuePreviewOriginal.has(preview)) {
          queuePreviewOriginal.set(preview, {
            title: preview.getAttribute("title"),
            tabindex: preview.getAttribute("tabindex"),
          });
        }
        preview.setAttribute("data-rdsh-queue-preview", "");
        preview.setAttribute("data-rdsh-queue-for", String(index));
        preview.setAttribute("data-rdsh-queue-text", text);
        preview.setAttribute("title", text);
        preview.setAttribute("tabindex", "0");
        index += 1;
      }
    }

    /** Drop the pending tab hold and its lift styling (not the block). */
    function cancelTabHold() {
      if (tabHoldTimer !== 0) {
        clearTimeout(tabHoldTimer);
        tabHoldTimer = 0;
      }
      tabCandidate?.tab.removeAttribute("data-rdsh-tab-hold");
    }

    /**
     * Restore the strip's own `scroll-behavior` after a manual pan.
     *
     * dockkit ships `scroll-behavior: smooth` (it focuses a tab by scrolling);
     * a finger pan must not inherit that easing, so it is forced to auto only
     * while this gesture owns the strip.
     */
    function releaseTabStrip(candidate) {
      if (candidate === null || candidate === undefined || candidate.strip === null) return;
      if (candidate.scrollBehavior === undefined) return;
      if (candidate.scrollBehavior === "") candidate.strip.style.removeProperty("scroll-behavior");
      else candidate.strip.style.scrollBehavior = candidate.scrollBehavior;
      candidate.scrollBehavior = undefined;
    }

    /**
     * The finger stayed put for {@link TAB_HOLD_MS}: release the move gate.
     *
     * The upstream drag was armed by the original pointerdown and only waits
     * for a move; keeping its listener means the reorder lands in dockkit's own
     * state, so the plugin never owns a second tab order.
     */
    function fireTabHold() {
      tabHoldTimer = 0;
      const candidate = tabCandidate;
      if (candidate === null || candidate.cancelled || candidate.held) return;
      candidate.held = true;
      candidate.blocking = false;
      candidate.tab.setAttribute("data-rdsh-tab-hold", "");
    }


    /**
     * The tab scroller for a pointerdown on the strip's empty area.
     *
     * Only the tab elements are tagged with `data-rdsh-rtab`, so a swipe that
     * starts on the caret/gutter or the strip fill used to have no gesture
     * owner at all. Resolve the same scroller from those containers, but never
     * from buttons or a tab close control.
     */
    function stripForPan(target) {
      if (target === null || target === undefined || typeof target.closest !== "function") return null;
      // Same scope as the tagged tabs: only the right panel's dockkit strip.
      // Left/other dockkit surfaces keep their own drag behaviour.
      if (target.closest("[data-sidebar-right-panel]") === null) return null;
      if (target.closest("button, a, input, [data-dockkit-tab-close]") !== null) return null;
      const tabs = target.closest("[data-dockkit-strip-tabs]");
      if (tabs !== null) return tabs;
      const fill = target.closest("[data-dockkit-strip-fill]");
      if (fill === null) return null;
      return fill.closest("[data-dockkit-strip]")?.querySelector("[data-dockkit-strip-tabs]") ?? null;
    }

    function cancelStripPan() {
      if (stripPanCandidate === null) return;
      releaseStripPan(stripPanCandidate);
      stripPanCandidate = null;
    }

    function releaseStripPan(candidate) {
      if (candidate === null || candidate === undefined) return;
      if (candidate.scrollBehavior === undefined) return;
      if (candidate.scrollBehavior === "") candidate.strip.style.removeProperty("scroll-behavior");
      else candidate.strip.style.scrollBehavior = candidate.scrollBehavior;
      candidate.scrollBehavior = undefined;
    }

    function onPointerDown(event) {
      if (!phone()) return;
      // A new primary contact starts a new gesture: drop a stale strip pan,
      // a pending tab tap replay and an old tab hold. Secondary fingers must
      // not disturb the first pointer.
      if (event.isPrimary !== false) {
        cancelStripPan();
        clearTimeout(tabReplayTimer);
        if (tabCandidate !== null) {
          cancelTabHold();
          tabCandidate.tab.removeAttribute("data-rdsh-tab-hold");
          releaseTabStrip(tabCandidate);
          tabCandidate = null;
        }
      }
      // xterm keeps its real input in a visually hidden textarea. Focusing it
      // from the tap/pointerdown gesture is what asks iOS for the keyboard.
      const queuePreviewTarget = event.target.closest && event.target.closest("[data-rdsh-queue-preview]");
      if (queuePreviewTarget !== null && queuePreviewTarget !== undefined && event.pointerType !== "mouse") {
        queuePress = { preview: queuePreviewTarget, x: event.clientX, y: event.clientY, at: Date.now() };
        cancelQueuePressTimerOnly();
        queuePressTimer = setTimeout(() => {
          queuePressTimer = 0;
          const press = queuePress;
          queuePress = null;
          if (press === null) return;
          queueSuppressClickUntil = Date.now() + 800;
          const row = press.preview.closest("[data-rdsh-queue-row]");
          if (row !== null) queueMenuAt(row);
        }, LONG_PRESS_MS);
        return;
      }
      const terminal = event.target.closest && event.target.closest(".xterm, [class*='xterm']");
      if (terminal !== null) {
        const input = terminal.querySelector("textarea.xterm-helper-textarea, textarea");
        if (input !== null) input.focus({ preventScroll: true });
      }
      const send = event.target.closest && event.target.closest('[data-rdsh-composer-root] [class*="primary"]');
      if (send !== null && send !== undefined && send.disabled !== true && !STOP_PROBE.test(send.getAttribute("aria-label") || "")) {
        markMobileSession();
      }
      // Right panel tabs: dockkit arms a reorder on pointerdown and starts it
      // after 4px, so a tap or a sideways swipe became a drag. Block the move
      // until the hold fires; the app's own listener stays armed and completes
      // the reorder from the moves that follow.
      const tab = event.target.closest && event.target.closest("[data-rdsh-rtab]");
      // A second finger is not a new tab gesture: the first pointer already
      // owns the hold/drag state, and `pointerId` keeps its moves separate.
      if (tab !== null && tab !== undefined && event.pointerType !== "mouse" && event.isPrimary !== false) {
        const close = event.target.closest && event.target.closest("[data-dockkit-tab-close]");
        if (close === null || close === undefined) {
          clearTimeout(tabReplayTimer);
          clearTimeout(tabHoldTimer);
          if (tabCandidate !== null) {
            tabCandidate.tab.removeAttribute("data-rdsh-tab-hold");
            releaseTabStrip(tabCandidate);
          }
          const strip = tab.closest("[data-dockkit-strip-tabs]") ?? tab.closest('[role="tablist"]')?.querySelector("[data-dockkit-strip-tabs]") ?? null;
          const scrollBehavior = strip === null ? undefined : (strip.style.scrollBehavior ?? "");
          if (strip !== null) strip.style.scrollBehavior = "auto";
          tabCandidate = {
            tab,
            at: Date.now(),
            x: event.clientX,
            y: event.clientY,
            fired: false,
            held: false,
            blocking: true,
            cancelled: false,
            pointerId: event.pointerId,
            // dockkit's strip is `touch-action: none`, so the finger cannot
            // pan it natively. Keep the real scroller and pan it ourselves.
            strip,
            scrollBehavior,
            lastX: event.clientX,
            lastY: event.clientY,
          };
          tabHoldTimer = setTimeout(fireTabHold, TAB_HOLD_MS);
        }
      }
      if (tab === null || tab === undefined) {
        const strip = event.pointerType !== "mouse" && event.isPrimary !== false ? stripForPan(event.target) : null;
        if (strip !== null && strip.scrollWidth > strip.clientWidth) {
          cancelStripPan();
          stripPanCandidate = {
            strip,
            at: Date.now(),
            x: event.clientX,
            y: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            moved: false,
            pointerId: event.pointerId,
            scrollBehavior: strip.style.scrollBehavior,
          };
          strip.style.scrollBehavior = "auto";
        }
      }
      const row = event.target.closest && event.target.closest('[data-row-key^="session:"]');
      if (row === null || row === undefined) return;
      if (event.pointerType === "mouse") return;
      if (controlInsideRow(event.target)) return;
      tapCandidate = { row, at: Date.now(), x: event.clientX, y: event.clientY, cancelled: false, fired: false };
      // A held finger opens the menu; a moving one reorders, which is the
      // gesture the app already owns.
      cancelLongPress();
      longPressTimer = setTimeout(fireLongPress, LONG_PRESS_MS);
    }

    /** Movement cancels the long press and leaves the drag to the app. */
    function onPointerMove(event) {
      const stripPan = stripPanCandidate;
      if (stripPan !== null && (stripPan.pointerId === undefined || event.pointerId === undefined || event.pointerId === stripPan.pointerId)) {
        // Native overflow scrolling owns the finger and its momentum.
        return;
      }
      const tabMove = tabCandidate;
      if (tabMove !== null && (tabMove.pointerId === undefined || event.pointerId === undefined || event.pointerId === tabMove.pointerId)) {
        if (!tabMove.held) {
          const distance = Math.abs(event.clientX - tabMove.x) + Math.abs(event.clientY - tabMove.y);
          if (distance > TAB_HOLD_SLOP_PX && !tabMove.cancelled) {
            tabMove.cancelled = true;
            cancelTabHold();
          }
          // Do not write scrollLeft here: the browser owns normal swipes.
        }
        if (tabMove.blocking) {
          // Reaches dockkit's window-level pointermove before it can start the
          // 4px drag. The original pointerdown is untouched, so a held finger
          // is still driving the app's drag when this gate opens.
          event.stopImmediatePropagation();
        }
        return;
      }
      if (queuePress !== null && Math.abs(event.clientX - queuePress.x) + Math.abs(event.clientY - queuePress.y) > LONG_PRESS_SLOP_PX) {
        cancelQueuePress();
      }
      const candidate = tapCandidate;
      if (candidate === null || longPressTimer === 0) return;
      if (Math.abs(event.clientX - candidate.x) + Math.abs(event.clientY - candidate.y) > LONG_PRESS_SLOP_PX) cancelLongPress();
    }

    function onPointerUp(event) {
      cancelQueuePress();
      cancelLongPress();
      if (stripPanCandidate !== null && (stripPanCandidate.pointerId === undefined || event.pointerId === undefined || event.pointerId === stripPanCandidate.pointerId)) {
        releaseStripPan(stripPanCandidate);
        stripPanCandidate = null;
        return;
      }
      const tabTap = tabCandidate;
      if (tabTap !== null && (tabTap.pointerId === undefined || event.pointerId === undefined || event.pointerId === tabTap.pointerId)) {
        if (tabTap.held) {
          // The app just reordered with its own drag. Its release click would
          // now switch (or re-select) a tab, so eat exactly that one.
          cancelTabHold();
          tabTap.tab.removeAttribute("data-rdsh-tab-hold");
          releaseTabStrip(tabTap);
          tabDraggedTab = tabTap.tab;
          tabDragSuppressUntil = Date.now() + 400;
          tabCandidate = null;
        } else {
          const moved = Math.abs(event.clientX - tabTap.x) + Math.abs(event.clientY - tabTap.y) > 14;
          releaseTabStrip(tabTap);
          if (moved || tabTap.cancelled || Date.now() - tabTap.at > 600) {
            if (moved || tabTap.cancelled) {
              // A pan is not a tap: eat the click the browser may still
              // synthesise for the release, but only on this tab.
              tabDraggedTab = tabTap.tab;
              tabDragSuppressUntil = Date.now() + 400;
            }
            tabCandidate = null;
          } else {
            // One replay, only if the app did not deliver the click itself: a
            // pointerdown that became a tab drag leaves the active tab unchanged
            // and the tap would otherwise do nothing at all.
            clearTimeout(tabReplayTimer);
            tabReplayTimer = window.setTimeout(() => {
              if (tabCandidate === tabTap) tabCandidate = null;
              if (tabTap.fired || !tabTap.tab.isConnected) return;
              tabTap.fired = true;
              tabTap.tab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            }, 250);
          }
        }
        if (tabHoldTimer !== 0) {
          clearTimeout(tabHoldTimer);
          tabHoldTimer = 0;
        }
      }
      const candidate = tapCandidate;
      if (candidate === null) return;
      tapCandidate = null;
      const moved = Math.abs(event.clientX - candidate.x) + Math.abs(event.clientY - candidate.y) > 14;
      if (candidate.cancelled || moved || Date.now() - candidate.at > 500) return;
      // Chrome can spend a touch on a native drag attempt and never synthesise
      // the click. If no click landed shortly after the finger lifted, replay
      // exactly one on the row so a short tap always opens the session.
      setTimeout(() => {
        if (candidate.fired) return;
        candidate.row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }, 260);
    }

    function onPointerCancel(event) {
      cancelQueuePress();
      if (stripPanCandidate !== null
        && (event?.pointerId === undefined
          || stripPanCandidate.pointerId === undefined
          || event.pointerId === stripPanCandidate.pointerId)) {
        cancelStripPan();
      }
      if (tabHoldTimer !== 0) {
        clearTimeout(tabHoldTimer);
        tabHoldTimer = 0;
      }
      if (tabCandidate !== null) {
        tabCandidate.tab.removeAttribute("data-rdsh-tab-hold");
        releaseTabStrip(tabCandidate);
        tabCandidate = null;
      }
    }

    function onDragStartCapture(event) {
      cancelLongPress();
      if (tapCandidate !== null) tapCandidate.cancelled = true;
      const row = event.target.closest && event.target.closest('[data-row-key^="session:"]');
      if (row !== null && row !== undefined) row.setAttribute("data-rdsh-dragging", "");
    }

    function onDragEndCapture(event) {
      const row = event.target.closest && event.target.closest('[data-row-key^="session:"]');
      if (row !== null && row !== undefined) row.removeAttribute("data-rdsh-dragging");
    }

    /** Mobile long-press must only reorder; the app's dblclick rename is off. */
    function onSessionTitleDoubleClick(event) {
      if (!phone()) return;
      if (event.target.closest === undefined || event.target.closest("[data-rdsh-session-title]") === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    /** Suppress the iOS text callout/context menu on session titles and tabs. */
    function onSessionContextMenu(event) {
      if (!phone()) return;
      if (event.target.closest === undefined) return;
      if (event.target.closest("[data-rdsh-session-title], [data-rdsh-session], [data-rdsh-rtab], [data-dockkit-tab]") === null) return;
      event.preventDefault();
    }

    /**
     * Nearest horizontally scrolled ancestor, or null.
     *
     * A rightward swipe that starts on content already scrolled to the right
     * belongs to that content, not to the sheet's close gesture.
     */
    function scrolledLeftAncestor(target) {
      let node = target;
      while (node !== null && node !== undefined && node !== document.body) {
        if (node.nodeType === 1) {
          const style = getComputedStyle(node);
          if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollLeft > 1) return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    /**
     * Starts that belong to the panel's own chrome, not its body.
     *
     * The tab strip is a horizontal scroller with a reorder gesture of its own
     * (#31); a left/right swipe there must never be read as "close the panel".
     * dockkit puts the collapse button in the same strip chrome, so excluding
     * the strip also excludes that row, while the ✕ itself keeps its click.
     */
    function rightPanelChromeStart(target) {
      if (target === null || target === undefined || typeof target.closest !== "function") return false;
      return target.closest(
        `${RIGHT_PANEL_ROOT} [role="tablist"], ${RIGHT_PANEL_ROOT} [data-dockkit-strip], ${RIGHT_PANEL_ROOT} [data-dockkit-tab], ${RIGHT_PANEL_ROOT} header`,
      ) !== null;
    }

    // Edge swipe from the left opens the session drawer; from the right it
    // pulls the preview/right sidebar (the app's own "Open right sidebar").
    // While the preview is open the left-to-right gesture closes it instead.
    let edgeSwipe = null;
    function onEdgeSwipeStart(event) {
      if (!phone() || event.touches.length !== 1) return;
      if (document.querySelector("[data-rdsh-lightbox], [data-rdsh-crop-overlay], [data-shortcut-modal=settings]") !== null) return;
      const touch = event.touches[0];
      const target = event.target;
      const fromRight = touch.clientX >= window.innerWidth - 36;
      const drawerOpen = document.documentElement.getAttribute("data-rdsh-drawer") === "open";
      const panelOpen = document.documentElement.hasAttribute("data-rdsh-rightpanel-open");
      // While the preview is open, a rightward swipe anywhere on it goes back
      // to the chat, the way a pushed iOS screen does. This is checked before
      // the edge rules below, and it owns the left edge too: opening the
      // drawer on top of the preview would stack two sheets. The drawer wins
      // only once it is already open.
      if (panelOpen && !drawerOpen) {
        if (target instanceof Element) {
          if (rightPanelChromeStart(target)) return;
          if (scrolledLeftAncestor(target) !== null) return;
          if (target.closest("input, textarea, [contenteditable=true], .xterm, [class*='xterm']") !== null) return;
        }
        edgeSwipe = { x: touch.clientX, y: touch.clientY, fromRight: false, closesPanel: true };
        return;
      }
      if (drawerOpen) {
        // The drawer owns the screen while it is open, so a leftward swipe
        // closes it from anywhere on it: a session row, the dimmed chat behind
        // it, the right edge. It must never pull the preview over the list.
        // Ported from #1 by @neutron42-jp.
        if (fromRight) return;
        edgeSwipe = { x: touch.clientX, y: touch.clientY, fromRight: false, closesDrawer: true };
        return;
      }
      if (!fromRight && touch.clientX > 36) return;
      if (target instanceof Element) {
        // Form fields always own the gesture. At the left edge a button may be
        // the route's full-width row: a tap is still a tap (no movement means
        // no preventDefault), while a rightward drag must open the drawer.
        if (target.closest("input, textarea, [contenteditable=true]") !== null) return;
        if (touch.clientX > 36 && target.closest("button, a, [role=button]") !== null) return;
      }
      edgeSwipe = { x: touch.clientX, y: touch.clientY, fromRight };
    }
    function onEdgeSwipeMove(event) {
      if (edgeSwipe === null || event.touches.length !== 1) return;
      // The mode is fixed, but a gesture can outlive the layout it started
      // in; a desktop page must not continue it.
      if (!phone()) {
        edgeSwipe = null;
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - edgeSwipe.x;
      const dy = touch.clientY - edgeSwipe.y;
      // A vertical finger belongs to the list under it: drop the gesture and
      // let the scroll proceed. Once the movement is clearly horizontal the
      // page must not scroll, or opening the drawer also drags the session
      // list (and the preview drags the content) under the finger.
      if (Math.abs(dy) > Math.abs(dx)) {
        if (Math.abs(dy) > 10) edgeSwipe = null;
        return;
      }
      if (Math.abs(dx) > 4 && event.cancelable) event.preventDefault();
      if (edgeSwipe.closesDrawer === true) {
        if (dx > -64) return;
        edgeSwipe = null;
        if (event.cancelable) event.preventDefault();
        closeDrawer();
        return;
      }
      if (edgeSwipe.closesPanel === true) {
        if (dx < 64) return;
        edgeSwipe = null;
        if (event.cancelable) event.preventDefault();
        visibleCollapseButton()?.click();
        return;
      }
      if (edgeSwipe.fromRight) {
        if (dx > -64) return;
        edgeSwipe = null;
        if (event.cancelable) event.preventDefault();
        document.querySelector('[aria-label="Open right sidebar"]')?.click();
        return;
      }
      if (dx < 64) return;
      edgeSwipe = null;
      if (event.cancelable) event.preventDefault();
      toggleDrawer();
    }
    /**
     * Drop the in-flight gestures.
     *
     * A rotation (or the keyboard opening) can swallow the `touchend` that
     * would have cleared these, and a stale start point turns the next
     * touchmove into a jump-sized swipe: the drawer opens or the preview
     * closes without a gesture. Also called on dispose and the desktop boot,
     * so coordinates from a previous mount cannot fire in the next one.
     */
    function resetGestures() {
      cancelQueuePress();
      edgeSwipe = null;
      touchStart = null;
      terminalDrag = null;
      cancelTabHold();
      releaseTabStrip(tabCandidate);
      tabCandidate = null;
      tabDraggedTab = null;
      tapCandidate = null;
      clearTimeout(tabReplayTimer);
      cancelLongPress();
    }
    function onEdgeSwipeEnd() {
      edgeSwipe = null;
      endTerminalDrag();
    }

    // ---------------------------------------------------------------------
    // Input: Enter inserts a newline unless the user opts into sending
    // ---------------------------------------------------------------------
    function composerEditor(target) {
      if (target === null || target === undefined || target.closest === undefined) return null;
      return target.closest('[contenteditable="true"], textarea');
    }

    /** A popup that owns Enter (slash commands, workspace picker, menus). */
    function openPopup() {
      for (const element of document.querySelectorAll('[role="listbox"], [role="menu"]')) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return element;
      }
      return null;
    }

    /**
     * Insert one soft line break through the editor's own beforeinput path.
     * A synthetic Shift+Enter works on Chrome but not on iOS: the software
     * keyboard reports keyCode 229, so the app's keymap treats the synthetic
     * chord as an active composition and swallows it. `insertLineBreak` is
     * handled by Lexical as plain JS, independent of key trust or keyCode.
     */
    function insertLineBreak(editor) {
      if (editor.tagName === "TEXTAREA") {
        const start = editor.selectionStart ?? editor.value.length;
        const end = editor.selectionEnd ?? start;
        editor.setRangeText("\n", start, end, "end");
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      try {
        editor.dispatchEvent(new InputEvent("beforeinput", {
          inputType: "insertLineBreak",
          bubbles: true,
          cancelable: true,
        }));
      } catch {
        const event = new Event("beforeinput", { bubbles: true, cancelable: true });
        event.inputType = "insertLineBreak";
        editor.dispatchEvent(event);
      }
      // Do not insert a native <br> here as a "fallback": Lexical applies
      // beforeinput on the next update, so a synchronous execCommand inserts a
      // second break and desynchronises the editor state.
    }

    function onKeyDownCapture(event) {
      // Enter follows the device mode: mobile gets newline by default, a
      // desktop stays stock unless the #15 opt-in is on.
      const finger = phone();
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      // Desktop stays out of the key path entirely unless the #15 opt-in is on.
      // When it is, the stock composer still owns the send; this only marks the
      // session so the host notifies this device.
      if (!finger && !notifyDeviceTurns()) return;
      const editor = composerEditor(event.target);
      if (editor === null) return;
      // Only the message composer. A rename field or another contenteditable
      // keeps its own Enter behaviour (commit, newline, …).
      if (editor.closest("[data-composer-input]") === null) return;
      // The app marks the root while an IME composition owns Return; that
      // Return belongs to the IME (confirm the conversion), not to us.
      if (editor.closest("[data-composer-composing]") !== null) return;
      // A selected command chip owns Enter (remove or expand it).
      if (editor.querySelector("[data-selected]") !== null) return;
      // While a menu is open, Enter selects its highlighted row.
      if (openPopup() !== null) return;
      if (!finger) {
        markMobileSession();
        return;
      }
      if (state.enterToSend) {
        markMobileSession();
        closeKeyboardAfterSend();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      insertLineBreak(editor);
    }

    // ---------------------------------------------------------------------
    // Overscroll: no document rubber-band at the ends of a scroll container
    // ---------------------------------------------------------------------
    let touchStart = null;

    // ---------------------------------------------------------------------
    // Terminal: a finger drag becomes a wheel event
    //
    // The xterm.js that DSH 0.2.x bundles (6.0.0) has no touch path at all:
    // `.xterm-viewport` is empty, the screen lives in `.xterm-scrollable-element`
    // and a VS Code `SmoothScrollableElement` owns the scroll position in JS.
    // Its only input is `wheel` (xtermjs/xterm.js#5489; the fix, #5563, is
    // 6.1.0). So a touch drag has to be translated into wheel events rather
    // than into CSS: there is no DOM scroller to unlock.
    //
    // The constants come from `StandardWheelEvent` + the Scrollable it feeds:
    // a pixel-mode wheel delta is divided by 40 and then multiplied by 50, so
    // 0.8 wheel-pixels per finger-pixel keeps the text under the finger.
    // ---------------------------------------------------------------------
    const XTERM_SCROLLER = ".xterm-scrollable-element";
    /** Movement before a drag is read as a scroll rather than a tap. */
    const TERMINAL_SLOP_PX = 4;
    const TERMINAL_WHEEL_PER_PX = 0.8;
    /** One event is at most this many pixels, so a jump cannot fling the view. */
    const TERMINAL_WHEEL_MAX_PX = 32;
    let terminalDrag = null;

    /** The scrolling node of the terminal under `target`, or null. */
    function xtermScroller(target) {
      if (target === null || target === undefined || target.closest === undefined) return null;
      const terminal = target.closest(".xterm");
      if (terminal === null) return null;
      return terminal.querySelector(XTERM_SCROLLER) ?? terminal.querySelector(".xterm-screen") ?? terminal;
    }

    function startTerminalDrag(event) {
      if (CONFIG.terminalTouchScroll === false || event.touches.length !== 1) {
        terminalDrag = null;
        return;
      }
      const scroller = xtermScroller(event.target);
      if (scroller === null) {
        terminalDrag = null;
        return;
      }
      const touch = event.touches[0];
      terminalDrag = { scroller, x: touch.clientX, y: touch.clientY, vertical: false, cancelled: false };
    }

    /**
     * Feed one finger movement to the terminal.
     *
     * Returns true when this gesture belongs to the terminal, so the caller
     * leaves the event alone: the bridge has already done the preventDefault
     * the overscroll guard would otherwise do for the wrong reason.
     */
    function moveTerminalDrag(event) {
      const drag = terminalDrag;
      if (drag === null || drag.cancelled || event.touches.length !== 1) return false;
      const touch = event.touches[0];
      const dy = touch.clientY - drag.y;
      const dx = touch.clientX - drag.x;
      if (!drag.vertical) {
        if (Math.abs(dy) < TERMINAL_SLOP_PX) return true;
        // A sideways drag is a gesture for something else (the preview's
        // back-swipe used to claim it); stop tracking instead of scrolling.
        if (Math.abs(dy) <= Math.abs(dx)) {
          drag.cancelled = true;
          return false;
        }
        drag.vertical = true;
      }
      drag.y = touch.clientY;
      if (event.cancelable) event.preventDefault();
      const pixels = Math.max(-TERMINAL_WHEEL_MAX_PX, Math.min(TERMINAL_WHEEL_MAX_PX, dy));
      // A plain Event, not a WheelEvent: Chrome and Safari put `wheelDeltaY` on
      // real WheelEvents, and xterm prefers that (120-based) value, which would
      // make the speed browser-dependent. Without it, the pixel branch applies.
      const wheel = new Event("wheel", { bubbles: true, cancelable: true });
      wheel.deltaY = -pixels * TERMINAL_WHEEL_PER_PX;
      wheel.deltaX = 0;
      wheel.deltaMode = 0; /* DOM_DELTA_PIXEL */
      wheel.clientX = touch.clientX;
      wheel.clientY = touch.clientY;
      wheel.pageX = touch.clientX;
      wheel.pageY = touch.clientY;
      drag.scroller.dispatchEvent(wheel);
      return true;
    }

    function endTerminalDrag() {
      terminalDrag = null;
    }

    // ---------------------------------------------------------------------
    // Terminal: keep the screen inside the visual viewport
    //
    // The bundled terminal mounts xterm in a div and fits it from a
    // ResizeObserver on that div (`fitScreen`: `fit.proposeDimensions()` then
    // `xterm.resize` + `model.resize`, so the Host grid follows too). On iOS
    // the keyboard shrinks `visualViewport` without shrinking the layout
    // viewport, so that observer never fires and the last rows stay behind the
    // keyboard. There is no public handle on the xterm instance and no fit
    // event to call; the observable path is geometry. Shrinking the mount node
    // to the visible band makes the app's own observer run the real fit.
    //
    // There is deliberately no synthetic scroll here. xterm 6 builds a
    // `SmoothScrollableElement`, whose `setScrollPosition` feeds an internal
    // `Scrollable` and re-renders rows; `.xterm-scrollable-element` is only a
    // `position: relative` wrapper with no overflow (see client.terminal.js
    // `AbstractScrollableElement`). Its `HTMLElement.scrollTop` is not the
    // terminal's scroll position, and a wheel event is application input for
    // mouse-tracking / alternate-buffer programs. Fit alone is what this
    // plugin may do; the upstream `xterm.resize` keeps the viewport where the
    // terminal itself decides.
    //
    // #67: that internal position is still readable. The vertical scrollbar
    // xterm renders is a DOM slider, and `style.top + style.height` against the
    // track's height is where the terminal is looking
    // (client.terminal.js `AbstractScrollbar.render`). Output that arrives
    // while the slider is at the end is followed by xterm itself; while it is
    // anywhere else, the fit is held back, because refitting drops the rows
    // above the viewport and would pull a reader down. The slider is only
    // observed (never written, and no scroll is synthesised), and the held fit
    // runs again when the slider returns to the end.
    //
    // `fitScreen` is gated on the screen being writable, so a read-only
    // terminal keeps its Host grid and does not refit.
    // ---------------------------------------------------------------------
    let terminalFitFrame = 0;
    let terminalFitHeight = 0;
    let terminalFitMount = null;
    /** The scrollbar a held fit is waiting on, and the terminal that owns it. */
    let terminalScrollWatch = null;
    let terminalScrollTarget = null;
    let terminalScrollTerminal = null;
    let terminalScrollFrame = 0;

    /** The vertical scrollbar xterm renders inside `terminal`, or null. */
    function terminalScrollbar(terminal) {
      const scroller = terminal.querySelector(XTERM_SCROLLER);
      if (scroller === null) return null;
      return scroller.querySelector(".scrollbar.vertical") ?? null;
    }

    /**
     * Whether the terminal is showing the bottom of its scrollback.
     *
     * A missing slider or an unmeasured track means "nothing to scroll", which
     * is the bottom for this purpose; the caller then keeps the plain fit.
     */
    function terminalAtBottom(terminal) {
      const bar = terminalScrollbar(terminal);
      const slider = bar === null ? null : bar.querySelector(".slider");
      if (slider === null) return true;
      const track = bar.getBoundingClientRect().height;
      const top = Number.parseFloat(slider.style.top);
      const size = Number.parseFloat(slider.style.height);
      if (!(track > 0) || !Number.isFinite(top) || !Number.isFinite(size)) return true;
      return top + size >= track - 1;
    }

    function stopTerminalScrollWatch() {
      if (terminalScrollFrame !== 0) {
        cancelAnimationFrame(terminalScrollFrame);
        terminalScrollFrame = 0;
      }
      if (terminalScrollWatch !== null) {
        terminalScrollWatch.disconnect();
        terminalScrollWatch = null;
      }
      terminalScrollTarget = null;
      terminalScrollTerminal = null;
    }

    /**
     * Wait for a scrolled-up reader to come back to the end of the scrollback.
     *
     * Returns false when there is nothing to observe (no scrollbar, no
     * MutationObserver), so the caller falls back to fitting as before.
     */
    function watchTerminalScroll(terminal) {
      if (!phone() || typeof MutationObserver !== "function") return false;
      const bar = terminalScrollbar(terminal);
      if (bar === null) return false;
      if (terminalScrollWatch !== null && terminalScrollTarget === bar) {
        terminalScrollTerminal = terminal;
        return true;
      }
      stopTerminalScrollWatch();
      terminalScrollTarget = bar;
      terminalScrollTerminal = terminal;
      terminalScrollWatch = new MutationObserver(() => {
        if (terminalScrollFrame !== 0) return;
        if (typeof requestAnimationFrame !== "function") return;
        terminalScrollFrame = requestAnimationFrame(() => {
          terminalScrollFrame = 0;
          const current = terminalScrollTerminal;
          if (current === null || current.isConnected === false) {
            stopTerminalScrollWatch();
            return;
          }
          // Still up the scrollback: leave the reader where they are.
          if (!terminalAtBottom(current)) return;
          stopTerminalScrollWatch();
          scheduleTerminalFit();
        });
      });
      // Output moves `style.top`/`style.height`; a scroll moves `style.top`;
      // the visibility class changes when the scrollback fills or empties.
      terminalScrollWatch.observe(bar, {
        attributes: true,
        attributeFilter: ["style", "class"],
        subtree: true,
      });
      return true;
    }

    function clearTerminalFit() {
      if (terminalFitFrame !== 0) {
        cancelAnimationFrame(terminalFitFrame);
        terminalFitFrame = 0;
      }
      stopTerminalScrollWatch();
      terminalFitHeight = 0;
      terminalFitMount = null;
      for (const mount of document.querySelectorAll("[data-rdsh-terminal-fit]")) {
        mount.style.removeProperty("height");
        mount.style.removeProperty("flex");
        mount.removeAttribute("data-rdsh-terminal-fit");
      }
    }

    /**
     * Fit the mounted terminal to the part of it the visual viewport shows.
     *
     * Runs in one rAF and only writes when the measured height changes, so the
     * ResizeObserver the app installed cannot bounce.
     */
    function applyTerminalFit() {
      terminalFitFrame = 0;
      if (!phone() || !document.documentElement.hasAttribute("data-rdsh-rightpanel-open")) {
        clearTerminalFit();
        return;
      }
      const viewport = window.visualViewport;
      if (viewport === null || viewport === undefined) {
        clearTerminalFit();
        return;
      }
      // Android resizes the layout viewport, so the app's observer already
      // fits; only the iOS-style "layout stays, visual viewport shrinks" case
      // needs this path. A URL bar alone is a smaller inset but still real.
      const layoutHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
      if (!(layoutHeight - viewport.height > 1)) {
        clearTerminalFit();
        return;
      }
      let mount = null;
      let terminal = null;
      for (const section of document.querySelectorAll("[data-sidebar-terminal]")) {
        if (section.closest("[hidden]") !== null) continue;
        const xterm = section.querySelector(".xterm");
        if (xterm === null || xterm.parentElement === null) continue;
        const rect = xterm.parentElement.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) continue;
        mount = xterm.parentElement;
        terminal = xterm;
        break;
      }
      if (mount === null) {
        clearTerminalFit();
        return;
      }
      const rect = mount.getBoundingClientRect();
      const visibleBottom = viewport.offsetTop + viewport.height;
      const height = Math.floor(visibleBottom - rect.top);
      if (!(height >= 24)) {
        clearTerminalFit();
        return;
      }
      // #67: a reader up the scrollback owns the view. The refit drops the rows
      // above the viewport, so writing this height would jump them; hold the
      // fit until the slider is back at the end (watchTerminalScroll).
      if (!terminalAtBottom(terminal) && watchTerminalScroll(terminal)) return;
      stopTerminalScrollWatch();
      if (terminalFitMount !== null && terminalFitMount !== mount) {
        terminalFitMount.style.removeProperty("height");
        terminalFitMount.style.removeProperty("flex");
        terminalFitMount.removeAttribute("data-rdsh-terminal-fit");
      }
      if (Math.abs(height - terminalFitHeight) > 0.5 || terminalFitMount !== mount) {
        terminalFitHeight = height;
        terminalFitMount = mount;
        mount.setAttribute("data-rdsh-terminal-fit", "");
        mount.style.height = `${height}px`;
        mount.style.flex = "0 0 auto";
      }
    }

    function scheduleTerminalFit() {
      if (!phone()) {
        clearTerminalFit();
        return;
      }
      if (typeof requestAnimationFrame !== "function") return;
      if (terminalFitFrame !== 0) return;
      terminalFitFrame = requestAnimationFrame(applyTerminalFit);
    }

    function scrollableAncestor(target) {
      let node = target;
      while (node !== null && node !== undefined && node !== document.body) {
        if (node.nodeType === 1) {
          const style = getComputedStyle(node);
          if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 2) return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    function onTouchStart(event) {
      startTerminalDrag(event);
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      touchStart = { y: event.touches[0].clientY, x: event.touches[0].clientX };
    }

    function onTouchMove(event) {
      if (moveTerminalDrag(event)) return;
      const tabMove = tabCandidate;
      if (tabMove !== null) {
        if (event.touches.length === 1) {
          const touch = event.touches[0];
          if (!tabMove.held && !tabMove.cancelled
            && Math.abs(touch.clientX - tabMove.x) + Math.abs(touch.clientY - tabMove.y) > TAB_HOLD_SLOP_PX) {
            tabMove.cancelled = true;
            cancelTabHold();
          }
          // Only a held tab blocks native scrolling for reordering.
          if (tabMove.held && event.cancelable) event.preventDefault();
        }
        return;
      }
      if (stripForPan(event.target) !== null) return;
      if (touchStart === null || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dy = touch.clientY - touchStart.y;
      const dx = touch.clientX - touchStart.x;
      touchStart = { y: touch.clientY, x: touch.clientX };
      if (Math.abs(dy) <= Math.abs(dx)) return;
      const target = event.target;
      // `.xterm` scrolls through JS, so `scrollableAncestor` never sees it and
      // the guard below would cancel every vertical drag in the terminal. The
      // bridge above owns those.
      if (target !== null && target.closest !== undefined && target.closest("textarea, input, .xterm")) return;
      const scroller = scrollableAncestor(target);
      if (scroller === null) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) {
        if (event.cancelable) event.preventDefault();
      }
    }

    // ---------------------------------------------------------------------
    // Click routing: session open, title popover, one-tap settings
    // ---------------------------------------------------------------------
    let settingsPendingUntil = 0;

    function maybeOpenSettings() {
      if (settingsPendingUntil === 0) return;
      if (Date.now() > settingsPendingUntil) {
        settingsPendingUntil = 0;
        return;
      }
      const menu = document.querySelector("[role='menu']");
      if (menu === null) return;
      const settingsProbe = probeRegex("settingsMenu", "", ["Settings"], true) ?? /^Settings$/;
      const item = [...menu.querySelectorAll("[role='menuitem']")].find((entry) => settingsProbe.test(labelOf(entry)));
      if (item === undefined) return;
      settingsPendingUntil = 0;
      item.click();
    }

    /**
     * The dismiss pair for the open detail popover, so closing always removes
     * both listeners instead of leaving a closure on `document`.
     */
    let detailDismiss = null;

    function closeDetailPopover() {
      document.querySelector(".rdsh-mux-detail")?.remove();
      if (detailDismiss !== null) {
        document.removeEventListener("pointerdown", detailDismiss.pointer, true);
        document.removeEventListener("keydown", detailDismiss.key, true);
        detailDismiss = null;
      }
    }

    function showDetailPopover(anchor, title, text, meta) {
      closeDetailPopover();
      if (text === null || text === undefined || text === "") return;
      const pop = document.createElement("div");
      pop.className = "rdsh-mux-detail";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", title);
      const head = document.createElement("div");
      head.className = "rdsh-mux-detail-head";
      const name = document.createElement("span");
      name.className = "rdsh-mux-detail-title";
      name.textContent = title;
      head.append(name);
      if (meta !== null && meta !== undefined && meta !== "") {
        const badge = document.createElement("span");
        badge.className = "rdsh-mux-detail-meta";
        badge.textContent = meta;
        head.append(badge);
      }
      const body = document.createElement("div");
      body.className = "rdsh-mux-detail-body";
      body.textContent = text;
      pop.append(head, body);
      document.body.append(pop);
      const rect = anchor.getBoundingClientRect();
      // #59: the status bar sits above the page; keep the popover below it.
      const left = safeInset("left");
      const right = safeInset("right");
      const floor = safeInset("top") + 12;
      const width = Math.min(360, window.innerWidth - left - right - 24);
      pop.style.width = `${width}px`;
      const height = pop.getBoundingClientRect().height;
      let top = rect.top - height - 8;
      if (top < floor) top = Math.min(window.innerHeight - height - 12, rect.bottom + 8);
      pop.style.top = `${Math.round(Math.max(floor, top))}px`;
      pop.style.left = `${Math.round(Math.max(left + 12, Math.min(rect.left, window.innerWidth - right - width - 12)))}px`;
      const dismiss = (event) => {
        if (!pop.contains(event.target)) closeDetailPopover();
      };
      const dismissKey = (event) => {
        if (event.key === "Escape") closeDetailPopover();
      };
      // The listener stays until the popover is actually closed: retiring it
      // on the first tap made an inside tap disable the outside dismissal.
      setTimeout(() => {
        if (!pop.isConnected) return;
        detailDismiss = { pointer: dismiss, key: dismissKey };
        document.addEventListener("pointerdown", dismiss, true);
        document.addEventListener("keydown", dismissKey, true);
      }, 0);
    }

    function showTitlePopover(crumbs) {
      document.querySelector(".rdsh-mux-titlepop")?.remove();
      const text = (crumbs.textContent || "").trim();
      if (text === "") return;
      const popover = document.createElement("div");
      popover.className = "rdsh-mux-titlepop";
      popover.setAttribute("role", "status");
      popover.textContent = text;
      const rect = crumbs.getBoundingClientRect();
      const header = document.querySelector("header[data-window-drag]");
      const belowHeader = header === null ? rect.bottom : header.getBoundingClientRect().bottom;
      // #59: the status bar is part of the page inset, not of the header.
      const left = safeInset("left");
      const right = safeInset("right");
      const floor = safeInset("top") + 12;
      popover.style.top = `${Math.round(Math.max(floor, rect.bottom + 8, belowHeader + 4))}px`;
      const width = Math.min(320, window.innerWidth - left - right - 24);
      popover.style.width = `${width}px`;
      popover.style.left = `${Math.round(Math.max(left + 12, Math.min(rect.left, window.innerWidth - right - width - 12)))}px`;
      document.body.append(popover);
      const dismiss = () => popover.remove();
      setTimeout(dismiss, 2600);
      document.addEventListener("pointerdown", dismiss, { once: true });
    }

    /**
     * Whether the click landed on a button that starts a new session.
     *
     * The app labels all three of them with the same wording: "New session" for
     * the sidebar button and the brand row, "New session in <name>" for a
     * workspace's "+". The vocabulary lives in the probe table, like every
     * other upstream label this package matches.
     */
    let newSessionPattern = null;

    function isNewSessionButton(target) {
      const button = target.closest("button[aria-label]");
      if (button === null) return false;
      if (newSessionPattern === null) newSessionPattern = probeRegex("newSession", "i", "new session") ?? /new session/i;
      return newSessionPattern.test(button.getAttribute("aria-label") || "");
    }

    /**
     * A sidebar row that opens a full-screen route.
     *
     * Plugins and Automation tasks replace the chat with their own screen; the
     * phone drawer must not stay over that screen. New Session, session rows
     * and Settings are handled separately.
     */
    const PANEL_ROUTE_PATTERN = /^(?:Plugins|Automation tasks)$/i;

    function isPanelRouteButton(target) {
      const button = target.closest("button[aria-label]");
      if (button === null) return false;
      return PANEL_ROUTE_PATTERN.test(button.getAttribute("aria-label") || "");
    }

    function onClickCapture(event) {
      const target = event.target;
      if (target === null || target.closest === undefined) return;

      // A header activity chip whose own panel is open closes it on the second
      // tap; any other chip click (including the first one) stays upstream so
      // the old panel's outside-pointer close switches panels naturally.
      const activityChip = activityChipOf(target);
      if (activityChip !== null && handleActivityChipClick(activityChip, event)) return;

      // A completed hold-drag is a reorder, not a tab selection. The browser
      // can still synthesise the release click on the tab that was dragged;
      // eat that one only, and only for a moment so the next tap works.
      if (tabDraggedTab !== null) {
        if (Date.now() >= tabDragSuppressUntil) {
          tabDraggedTab = null;
        } else if (target.closest("[data-rdsh-rtab]") === tabDraggedTab) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }

      // The app delivered the tab click itself; the replay must stay cancelled.
      if (tabCandidate !== null && target.closest("[data-rdsh-rtab]") === tabCandidate.tab) tabCandidate.fired = true;

      // #34: a real click on a review's wrap toggle is the user's choice. The
      // trusted check keeps this plugin's own default-on click out of the
      // record, so OFF is respected on every later render pass.
      noteReviewWrapClick(event);

      // Workspace picker: the click that opens the chooser arms the observer
      // that decorates its portal before the first paint. The trigger is
      // recognized by its popup wiring, not its localized aria-label (#39).
      // The search row is a mobile affordance, so desktop only opens the
      // stock menu.
      if (phone() && target.closest) {
        const trigger = workspaceTriggerControl(target);
        if (trigger !== null) trigger.setAttribute("data-rdsh-workspace-trigger", "");
        // The same control closes an open menu; only the opening click starts
        // the observer. aria-expanded still carries the pre-click state here.
        if (trigger !== null && trigger.getAttribute("aria-expanded") !== "true") beginWorkspacePicker();
      }
      // Queued message: tap toggles the full-text preview. The native row still
      // owns its edit/remove/steer buttons; this branch only wraps the preview.
      const queuePreviewTarget = target.closest && target.closest("[data-rdsh-queue-preview]");
      if (queuePreviewTarget !== null && queuePreviewTarget !== undefined) {
        if (Date.now() < queueSuppressClickUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        queuePreviewAt(queuePreviewTarget);
        return;
      }
      // xterm's helper textarea is the actual input; a click gesture focusing it
      // asks iOS to show the keyboard.
      if (phone()) {
        const terminal = target.closest(".xterm, [class*='xterm']");
        if (terminal !== null) {
          const input = terminal.querySelector("textarea.xterm-helper-textarea, textarea");
          if (input !== null) input.focus({ preventScroll: true });
        }
      }
      // Fallback for keyboard activation of the send/queue button, and the
      // #15 opt-in that treats this browser's turns as phone turns.
      if (phone() || notifyDeviceTurns()) {
        const primary = target.closest && target.closest('[data-rdsh-composer-root] [class*="primary"]');
        if (primary !== null && primary !== undefined && primary.disabled !== true && !STOP_PROBE.test(primary.getAttribute("aria-label") || "")) {
          markMobileSession();
          closeKeyboardAfterSend();
        }
      }
      // Phone "+": open the OS file/photo picker directly. Commands live in "/".
      // #17: on a desktop-width-only window the stock menu stays intact.
      if (addButtonOf(target) !== null && phone()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pickFiles("file");
        return;
      }
      // Todo rows and the goal objective are truncated in the dock; tapping
      // opens a read-only popover with the full text.
      const todoItem = target.closest("[data-rdsh-todo-item]");
      if (todoItem !== null && phone()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showDetailPopover(todoItem, t("mux.detail.todo"), todoItem.getAttribute("data-rdsh-todo-text"), todoItem.getAttribute("data-rdsh-todo-status"));
        return;
      }
      const goalObjective = target.closest("[data-rdsh-goal-objective]");
      if (goalObjective !== null && phone()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const goalBar = goalObjective.closest("[data-goal-bar]");
        const goalLabel = goalBar === null ? null : goalBar.querySelector('[class*="_label"]');
        showDetailPopover(goalObjective, t("mux.detail.goal"), goalObjective.getAttribute("data-rdsh-goal-text"), goalLabel === null ? null : goalLabel.textContent.trim());
        return;
      }
      // Right sidebar: its class does not change on open/close, so re-read the
      // computed visibility after the click has settled.
      if (rightPanelNode !== null) {
        // The slide transition can outlive the click; re-read after it settles.
        setTimeout(syncRightPanelOpen, 60);
        setTimeout(syncRightPanelOpen, 350);
        setTimeout(syncRightPanelOpen, 900);
      }

      // "New session" (the sidebar's own button, its brand row, and a
      // workspace's "+") opens a blank session behind the drawer, so the drawer
      // closes just as it does for a tapped session row. Match by label, not
      // by hashed class; a session row never carries one of these buttons.
      if (phone() && isNewSessionButton(target)) {
        setTimeout(closeDrawer, 0);
        return;
      }

      // Plugins / Automation tasks open a full-screen route. Close the drawer
      // after the app has handled the click, so the route is not left under an
      // open drawer (and the FAB comes back). A desktop sidebar is never
      // touched: this branch is mode-gated.
      if (phone() && isPanelRouteButton(target)) {
        setTimeout(closeDrawer, 0);
        return;
      }

      const row = target.closest('[data-row-key^="session:"]');
      if (row !== null && phone()) {
        // Only the release click is a target: the click this module sends to
        // the row's own "..." trigger starts inside its actions, and eating that
        // one left every long press after the first without a menu.
        if (Date.now() < menuOpenedUntil && target.closest('[class*="_rowActions"]') === null) {
          menuOpenedUntil = 0;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (controlInsideRow(target)) return;
        if (tapCandidate !== null) tapCandidate.fired = true;
        // Close after the row's own handler has opened the session.
        setTimeout(closeDrawer, 0);
        return;
      }

      if (target.closest('[data-shortcut-modal="settings"]') !== null) return;

      const crumbs = target.closest("[data-rdsh-crumbs]");
      if (crumbs !== null && phone()) {
        showTitlePopover(crumbs);
        return;
      }

    }

    // ---------------------------------------------------------------------
    // Focus: opening a session must not steal the composer
    // ---------------------------------------------------------------------
    let allowFocusElement = null;
    let allowFocusUntil = 0;

    function textBoxOf(element) {
      if (!(element instanceof Element)) return null;
      const field = element.closest('input, textarea, [contenteditable="true"]');
      if (field === null) return null;
      if (field.tagName === "INPUT") {
        const type = (field.getAttribute("type") || "text").toLowerCase();
        if (["button", "submit", "reset", "checkbox", "radio", "range", "file", "color", "image", "hidden"].includes(type)) return null;
      }
      if (field.disabled === true || field.readOnly === true) return null;
      return field;
    }

    function onFocusPointer(event) {
      if (!phone()) return;
      const field = textBoxOf(event.target);
      allowFocusElement = field;
      allowFocusUntil = field === null ? 0 : Date.now() + 1500;
    }

    function onModelFocusOut(event) {
      if (!phone()) return;
      const target = event.target;
      if (target === null || target === undefined || target.closest === undefined) return;
      const root = target.closest('[class*="_7KE1Ra_root"]');
      const menu = document.querySelector('[class*="_7KE1Ra_menu"]');
      if (menu === null) return;
      if (root === null && !menu.contains(target)) return;
      const related = event.relatedTarget;
      if (related !== null && related !== undefined) {
        const inside = root?.contains(related) === true || menu.contains(related);
        if (!inside) return;
      }
      event.stopPropagation();
    }

    function onFocusInGuard(event) {
      if (!phone()) return;
      const field = textBoxOf(event.target);
      if (field === null) return;
      // Popovers (the model picker's search, dialogs, etc.) focus their own
      // inputs programmatically. Blurring those closes the popover because the
      // menu's onBlur sees no related focus target.
      if (field.closest('[role="menu"], [role="dialog"], [role="listbox"], [class*="_7KE1Ra_menu"], .xterm, [class*="xterm"]') !== null) return;
      if (field === allowFocusElement && Date.now() <= allowFocusUntil) return;
      // Deferred: Safari/the app re-focuses synchronously from its onFocus
      // handler, so an immediate blur() recurses until the stack overflows.
      setTimeout(() => {
        if (document.activeElement === field) field.blur();
      }, 0);
    }

    // ---------------------------------------------------------------------
    // Keyboard: a sent message puts it away
    // ---------------------------------------------------------------------
    /** How long after a send the draft may take to leave the composer. */
    const SEND_SETTLE_MS = 2000;
    const SEND_POLL_MS = 50;
    let sendSettleTimer = 0;

    /**
     * Put the soft keyboard away once the app has taken the draft.
     *
     * The stock composer keeps focus after a send so a desktop user can go on
     * typing, and it holds focus through the toolbar press itself (the send
     * button's mousedown refocuses the editor). On a phone that leaves the
     * keyboard over the reply the user is waiting to read. Call this from the
     * gesture that sends; it runs before the app's own handler, so the draft is
     * still in the editor and the wait below is for the app to clear it.
     *
     * A send the app refuses (an upload still running, a failed submit that
     * restores the draft) leaves the text in place and the keyboard open, so
     * the user can fix it. Only a phone is affected: a desktop window keeps
     * its focus, narrow or not.
     *
     * Ported from #22 by @AliceSaikawa.
     */
    function closeKeyboardAfterSend() {
      if (!phone()) return;
      const deadline = Date.now() + SEND_SETTLE_MS;
      clearTimeout(sendSettleTimer);
      const settle = () => {
        sendSettleTimer = 0;
        const editor = document.querySelector("[data-composer-input]");
        if (editor === null) return;
        if ((editor.textContent || "").trim() !== "") {
          if (Date.now() < deadline) sendSettleTimer = setTimeout(settle, SEND_POLL_MS);
          return;
        }
        // Only the composer's own keyboard: a field the user has moved on to
        // (a rename, the model search) keeps its focus.
        if (document.activeElement === editor) editor.blur();
      };
      // After this click finishes, so the app's submit has already run.
      sendSettleTimer = setTimeout(settle, 0);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        document.querySelector(".rdsh-mux-titlepop")?.remove();
        closeDetailPopover();
        return;
      }
      if (!phone() || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target;
      if (target === null || target === undefined || target.closest === undefined) return;
      const todoItem = target.closest("[data-rdsh-todo-item]");
      if (todoItem !== null) {
        event.preventDefault();
        showDetailPopover(todoItem, t("mux.detail.todo"), todoItem.getAttribute("data-rdsh-todo-text"), todoItem.getAttribute("data-rdsh-todo-status"));
        return;
      }
      const goalObjective = target.closest("[data-rdsh-goal-objective]");
      if (goalObjective !== null) {
        event.preventDefault();
        const goalBar = goalObjective.closest("[data-goal-bar]");
        const goalLabel = goalBar === null ? null : goalBar.querySelector('[class*="_label"]');
        showDetailPopover(goalObjective, t("mux.detail.goal"), goalObjective.getAttribute("data-rdsh-goal-text"), goalLabel === null ? null : goalLabel.textContent.trim());
      }
    }

    // ---------------------------------------------------------------------
    // Session color frame: a "3-dot menu" item plus a small palette
    // ---------------------------------------------------------------------
    function frameIcon() {
      return h("svg", {
        width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1, "aria-hidden": "true",
      },
        h("rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5 }),
        h("rect", { x: 5.5, y: 5.5, width: 5, height: 5, rx: 1.2 }),
        h("circle", { cx: 12.5, cy: 3.5, r: 1.2, fill: "currentColor", stroke: "none" }));
    }

    function closeFramePalette() {
      document.querySelector(".rdsh-frame-pop")?.remove();
      document.querySelector(".rdsh-frame-backdrop")?.remove();
    }

    function showFramePalette(sessionId, anchor) {
      closeFramePalette();
      const pop = document.createElement("div");
      pop.className = "rdsh-frame-pop";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", t("frame.paletteAria"));
      const current = sessionFrames[sessionId];
      const title = document.createElement("div");
      title.className = "rdsh-frame-pop-title";
      title.textContent = t("frame.paletteTitle");
      const swatches = document.createElement("div");
      swatches.className = "rdsh-frame-swatches";
      for (const color of FRAME_COLORS) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "rdsh-frame-swatch";
        swatch.style.background = color.value;
        swatch.setAttribute("aria-label", color.label);
        swatch.setAttribute("data-current", String(current === color.value));
        swatch.addEventListener("click", () => {
          saveSessionFrame(sessionId, color.value);
          closeFramePalette();
          mobileToast(t("frame.applied", { color: color.label }));
        });
        swatches.append(swatch);
      }
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "rdsh-frame-clear";
      clear.textContent = t("frame.clear");
      clear.addEventListener("click", () => {
        saveSessionFrame(sessionId, null);
        closeFramePalette();
        mobileToast(t("frame.cleared"));
      });
      pop.append(title, swatches, clear);
      document.body.append(pop);
      const rect = pop.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const anchorRect = anchor instanceof Element ? anchor.getBoundingClientRect() : (anchor ?? null);
      const left = anchorRect === null ? 16 : Math.max(8, Math.min(anchorRect.right - width, window.innerWidth - width - 8));
      const top = anchorRect === null ? window.innerHeight - height - 24 : Math.max(8, Math.min(anchorRect.bottom + 8, window.innerHeight - height - 24));
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      const backdrop = document.createElement("div");
      backdrop.className = "rdsh-frame-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", closeFramePalette);
      document.body.append(backdrop);
    }

    function ColorFrameMenuItem(props) {
      const sessionId = props.sessionId;
      const menuState = typeof props.useMenuOpenState === "function" ? props.useMenuOpenState() : null;
      const setMenuOpen = Array.isArray(menuState) ? menuState[1] : null;
      if (typeof sessionId !== "string") return null;
      // The frame is painted by the mobile stylesheet, so the row that sets it
      // is a mobile affordance too (#44). A desktop menu keeps upstream's rows
      // exactly as they were.
      if (!phone()) return null;
      return h("button", {
        type: "button",
        role: "menuitem",
        className: "rdsh-frame-menu-item",
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          const anchorRect = event.currentTarget.getBoundingClientRect();
          if (typeof setMenuOpen === "function") setMenuOpen(false);
          setTimeout(() => showFramePalette(sessionId, anchorRect), 0);
        },
      }, h("span", { className: "rdsh-frame-menu-icon", "aria-hidden": "true" }, frameIcon()), h("span", null, t("frame.menu")));
    }

    // ---------------------------------------------------------------------
    // Image lightbox: safe-area close, swipe-down dismiss, simple crop
    // ---------------------------------------------------------------------
    const CROP_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 2v14a1 1 0 0 0 1 1h14"/><path d="M2 7h14a1 1 0 0 1 1 1v14"/></svg>';

    function lightboxDialog() {
      // Do not key this off the dialog's localized aria-label: with the UI in
      // Japanese ("元の画像のプレビュー") the crop/safe-area hooks never attached.
      for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
        if (dialog.hasAttribute("data-rdsh-crop-overlay")) continue;
        if (dialog.hasAttribute("data-shortcut-modal")) continue;
        if (dialog.querySelector('[class*="_stage_"]') !== null && dialog.querySelector("img") !== null) return dialog;
      }
      for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
        if (dialog.hasAttribute("data-rdsh-crop-overlay")) continue;
        if (dialog.hasAttribute("data-shortcut-modal")) continue;
        if (dialog.querySelector("img") !== null && dialog.querySelector('button[class*="_close_"]') !== null) return dialog;
      }
      return null;
    }

    /**
     * Dialogs whose swipe listeners were attached. A WeakSet, not the
     * attribute: `clearLightboxHooks()` removes the attribute on desktop, and
     * re-entering mobile mode must not add a second set of listeners.
     */
    const lightboxSwipeAttached = new WeakSet();

    function attachLightboxSwipe(dialog) {
      if (lightboxSwipeAttached.has(dialog)) {
        dialog.setAttribute("data-rdsh-swipe", "");
        return;
      }
      lightboxSwipeAttached.add(dialog);
      dialog.setAttribute("data-rdsh-swipe", "");
      const stage = dialog.querySelector('[class*="_stage_"]');
      const close = dialog.querySelector('[class*="_close_"]');
      if (stage === null || close === null) return;
      let start = null;
      const reset = () => {
        start = null;
        stage.style.transition = "transform .18s ease, opacity .18s ease";
        stage.style.transform = "";
        stage.style.opacity = "";
        setTimeout(() => { stage.style.transition = ""; }, 200);
      };
      dialog.addEventListener("touchstart", (event) => {
        if (dialog.querySelector("[data-rdsh-crop-overlay]") !== null) return;
        if (event.touches.length !== 1) return;
        if (event.target.closest("button") !== null) return;
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY, dy: 0 };
        stage.style.transition = "none";
      }, { passive: true });
      dialog.addEventListener("touchmove", (event) => {
        if (start === null || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {
          return;
        }
        event.preventDefault();
        start.dy = dy;
        stage.style.transform = `translateY(${Math.round(dy)}px)`;
        stage.style.opacity = String(Math.max(0.25, 1 - dy / 500));
      }, { passive: false });
      dialog.addEventListener("touchend", () => {
        if (start === null) return;
        const dy = start.dy;
        if (dy > 90) {
          start = null;
          close.click();
          stage.style.transform = "";
          stage.style.opacity = "";
          stage.style.transition = "";
        } else {
          reset();
        }
      }, { passive: true });
      dialog.addEventListener("touchcancel", reset, { passive: true });
    }

    const imageEditRecords = new Map();

    /** Locate the composer thumbnail that owns this lightbox image. */
    function composerImageFor(src) {
      const root = document.querySelector('[data-rdsh-composer-root]');
      if (root === null || typeof src !== "string" || src === "") return null;
      for (const img of root.querySelectorAll("img")) {
        if ((img.currentSrc || img.src) !== src) continue;
        const item = img.closest('[class*="_imageItem"]');
        return { src, img, item, remove: item?.querySelector('button[aria-label^="Remove image"]') ?? null };
      }
      return null;
    }

    function readAsDataUrl(blob) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    }

    async function srcToDataUrl(src) {
      const response = await fetch(src);
      return readAsDataUrl(await response.blob());
    }

    function attachFileToComposer(file) {
      const input = document.querySelector('[data-rdsh-composer-root] input[type="file"]')
        ?? document.querySelector('input[type="file"]');
      if (input === null) return false;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    function openCrop(dialog) {
      if (document.querySelector("[data-rdsh-crop-overlay]") !== null) return;
      const source = dialog.querySelector("img");
      if (source === null) return;
      const src = source.currentSrc || source.src;
      const composer = composerImageFor(src);
      let record = imageEditRecords.get(src) ?? null;
      if (record === null && composer !== null) {
        record = { originalSrc: src, originalData: null, currentSrc: src, rotation: 0, cropNorm: null };
        imageEditRecords.set(src, record);
      }
      const editSrc = record?.originalData ?? record?.originalSrc ?? src;
      const initialRotation = record?.rotation ?? 0;
      const initialCrop = record?.cropNorm ?? null;
      const overlay = document.createElement("div");
      overlay.className = "rdsh-crop-overlay";
      overlay.setAttribute("data-rdsh-crop-overlay", "");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", t("crop.aria"));
      overlay.innerHTML = `
        <div class="rdsh-crop-head">
          <strong>${t("crop.title")}</strong>
          <div class="rdsh-crop-head-actions">
            <button type="button" class="rdsh-crop-rotate" data-rotate="-90" aria-label="${t("crop.rotateLeft")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
            <button type="button" class="rdsh-crop-rotate" data-rotate="90" aria-label="${t("crop.rotateRight")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button>
            <button type="button" class="rdsh-crop-close" aria-label="${t("crop.close")}">×</button>
          </div>
        </div>
        <div class="rdsh-crop-stage"><div class="rdsh-crop-wrap"><img class="rdsh-crop-image" alt="" draggable="false"><div class="rdsh-crop-box"><span class="rdsh-crop-handle" data-corner="nw"></span><span class="rdsh-crop-handle" data-corner="ne"></span><span class="rdsh-crop-handle" data-corner="sw"></span><span class="rdsh-crop-handle" data-corner="se"></span></div></div></div>
        <div class="rdsh-crop-actions"><button type="button" class="rdsh-crop-cancel">${t("crop.cancel")}</button><button type="button" class="rdsh-crop-save">${t("crop.save")}</button></div>`;
      const image = overlay.querySelector(".rdsh-crop-image");
      const wrap = overlay.querySelector(".rdsh-crop-wrap");
      const stage = overlay.querySelector(".rdsh-crop-stage");
      const box = overlay.querySelector(".rdsh-crop-box");
      const save = overlay.querySelector(".rdsh-crop-save");
      const close = () => closeCrop();
      overlay.querySelector(".rdsh-crop-close").addEventListener("click", () => closeCrop());
      overlay.querySelector(".rdsh-crop-cancel").addEventListener("click", () => closeCrop());
      const state = { x: 0, y: 0, w: 0, h: 0 };
      let cropNorm = initialCrop === null ? null : { ...initialCrop };
      let move = null;
      let rotation = 0;
      let rotatedUrl = null;
      let baseReady = false;
      let initialRotationApplied = false;
      const base = new Image();
      base.onload = () => { baseReady = true; maybeApplyInitialRotation(); };
      base.onerror = () => { baseReady = false; };
      base.src = editSrc;
      const render = () => {
        box.style.left = `${state.x}px`;
        box.style.top = `${state.y}px`;
        box.style.width = `${state.w}px`;
        box.style.height = `${state.h}px`;
      };
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      const syncNorm = () => {
        const iw = image.clientWidth;
        const ih = image.clientHeight;
        if (iw === 0 || ih === 0 || state.w <= 0 || state.h <= 0) return;
        cropNorm = { x: state.x / iw, y: state.y / ih, w: state.w / iw, h: state.h / ih };
      };
      const fit = () => {
        const iw = image.naturalWidth;
        const ih = image.naturalHeight;
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        if (iw === 0 || ih === 0 || sw === 0 || sh === 0) return;
        const availW = Math.max(1, sw - 24);
        const availH = Math.max(1, sh - 24);
        const scale = Math.min(availW / iw, availH / ih);
        const width = Math.max(1, Math.round(iw * scale));
        const height = Math.max(1, Math.round(ih * scale));
        wrap.style.width = `${width}px`;
        wrap.style.height = `${height}px`;
        image.style.width = `${width}px`;
        image.style.height = `${height}px`;
        if (cropNorm === null) {
          // Start with the full image: the four handles sit on its corners.
          state.x = 0; state.y = 0;
          state.w = width; state.h = height;
          cropNorm = { x: 0, y: 0, w: 1, h: 1 };
        } else {
          const x = clamp(cropNorm.x * width, 0, Math.max(0, width - 1));
          const y = clamp(cropNorm.y * height, 0, Math.max(0, height - 1));
          state.x = x;
          state.y = y;
          state.w = clamp(cropNorm.w * width, 1, width - x);
          state.h = clamp(cropNorm.h * height, 1, height - y);
        }
        render();
      };
      const onResize = () => fit();
      window.addEventListener("resize", onResize);
      image.addEventListener("load", () => {
        fit();
        maybeApplyInitialRotation();
      });
      image.src = editSrc;
      if (image.complete) fit();
      requestAnimationFrame(fit);

      const applyRotation = (delta, rotateCrop = true) => {
        if (!baseReady || base.naturalWidth === 0) return;
        // Rotate the crop rectangle with the image so the same content stays
        // selected. Normalized coordinates are orientation-independent.
        const norm = cropNorm ?? { x: 0, y: 0, w: 1, h: 1 };
        const step = ((delta % 360) + 360) % 360;
        if (rotateCrop && step === 90) {
          cropNorm = { x: 1 - (norm.y + norm.h), y: norm.x, w: norm.h, h: norm.w };
        } else if (rotateCrop && step === 270) {
          cropNorm = { x: norm.y, y: 1 - (norm.x + norm.w), w: norm.h, h: norm.w };
        }
        rotation = (rotation + delta + 360) % 360;
        const canvas = document.createElement("canvas");
        const sideways = rotation % 180 !== 0;
        canvas.width = sideways ? base.naturalHeight : base.naturalWidth;
        canvas.height = sideways ? base.naturalWidth : base.naturalHeight;
        const context = canvas.getContext("2d");
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(rotation * Math.PI / 180);
        context.drawImage(base, -base.naturalWidth / 2, -base.naturalHeight / 2);
        canvas.toBlob((blob) => {
          if (blob === null) return;
          if (rotatedUrl !== null) URL.revokeObjectURL(rotatedUrl);
          rotatedUrl = URL.createObjectURL(blob);
          image.src = rotatedUrl;
          if (image.complete) fit();
          requestAnimationFrame(fit);
        }, "image/png");
      };
      const maybeApplyInitialRotation = () => {
        if (initialRotationApplied || !baseReady || initialRotation === 0) return;
        initialRotationApplied = true;
        applyRotation(initialRotation, false);
      };
      for (const button of overlay.querySelectorAll("[data-rotate]")) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          applyRotation(Number(button.getAttribute("data-rotate")));
        });
      }
      const closeCrop = () => {
        window.removeEventListener("resize", onResize);
        if (rotatedUrl !== null) URL.revokeObjectURL(rotatedUrl);
        overlay.remove();
      };
      const onMove = (event) => {
        if (move === null) return;
        const dx = event.clientX - move.sx;
        const dy = event.clientY - move.sy;
        if (move.kind === "move") {
          state.x = clamp(move.x + dx, 0, image.clientWidth - state.w);
          state.y = clamp(move.y + dy, 0, image.clientHeight - state.h);
        } else {
          let left = move.x;
          let top = move.y;
          let right = move.x + move.w;
          let bottom = move.y + move.h;
          if (move.corner.includes("e")) right = clamp(right + dx, left + 48, image.clientWidth);
          if (move.corner.includes("s")) bottom = clamp(bottom + dy, top + 48, image.clientHeight);
          if (move.corner.includes("w")) left = clamp(left + dx, 0, right - 48);
          if (move.corner.includes("n")) top = clamp(top + dy, 0, bottom - 48);
          state.x = left; state.y = top; state.w = right - left; state.h = bottom - top;
        }
        render();
        syncNorm();
      };
      box.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".rdsh-crop-handle") !== null) return;
        event.preventDefault();
        move = { kind: "move", sx: event.clientX, sy: event.clientY, x: state.x, y: state.y, w: state.w, h: state.h };
        box.setPointerCapture(event.pointerId);
      });
      for (const handle of box.querySelectorAll(".rdsh-crop-handle")) {
        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          move = { kind: "resize", corner: handle.getAttribute("data-corner"), sx: event.clientX, sy: event.clientY, x: state.x, y: state.y, w: state.w, h: state.h };
          handle.setPointerCapture(event.pointerId);
        });
      }
      box.addEventListener("pointermove", onMove);
      box.addEventListener("pointerup", () => { move = null; });
      box.addEventListener("pointercancel", () => { move = null; });
      save.addEventListener("click", async () => {
        if (state.w <= 0 || state.h <= 0) return;
        const scaleX = image.naturalWidth / image.clientWidth;
        const scaleY = image.naturalHeight / image.clientHeight;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(state.w * scaleX));
        canvas.height = Math.max(1, Math.round(state.h * scaleY));
        const context = canvas.getContext("2d");
        context.drawImage(image, state.x * scaleX, state.y * scaleY, state.w * scaleX, state.h * scaleY, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (blob === null) return;
        syncNorm();
        if (record !== null) {
          record.rotation = rotation;
          record.cropNorm = cropNorm === null ? null : { ...cropNorm };
        }
        const file = new File([blob], `crop-${Date.now()}.png`, { type: "image/png" });
        const closePreview = () => {
          dialog.querySelector('button[class*="_close_"]')?.click();
        };
        try {
          if (record !== null) {
            if (record.originalData === null) {
              try {
                record.originalData = await srcToDataUrl(record.originalSrc);
              } catch {
                record.originalData = record.originalSrc;
              }
            }
            const oldSrc = record.currentSrc;
            const current = composerImageFor(oldSrc);
            current?.remove?.click();
            if (!attachFileToComposer(file)) {
              mobileToast(t("crop.addFailed"));
              return;
            }
            const name = file.name;
            let tries = 0;
            const timer = setInterval(() => {
              const root = document.querySelector('[data-rdsh-composer-root]');
              const remove = root === null ? null : [...root.querySelectorAll("button")]
                .find((button) => button.getAttribute("aria-label") === `Remove image ${name}`);
              const img = remove?.closest('[class*="_imageItem"]')?.querySelector("img") ?? null;
              if (img !== null) {
                clearInterval(timer);
                const newSrc = img.currentSrc || img.src;
                imageEditRecords.delete(oldSrc);
                record.currentSrc = newSrc;
                imageEditRecords.set(newSrc, record);
              } else if (++tries > 50) {
                clearInterval(timer);
              }
            }, 100);
            mobileToast(t("crop.updated"));
          } else {
            if (!attachFileToComposer(file)) {
              mobileToast(t("crop.addFailed"));
              return;
            }
            mobileToast(t("crop.added"));
          }
          close();
          closePreview();
        } catch {
          mobileToast(t("crop.addFailed"));
        }
      });
      document.body.append(overlay);
    }

    /** Close the phone crop editor through its own cancel path (revokes URLs). */
    function closeCropOverlay() {
      for (const overlay of document.querySelectorAll("[data-rdsh-crop-overlay]")) {
        const cancel = overlay.querySelector(".rdsh-crop-cancel");
        if (cancel !== null) cancel.click();
        else overlay.remove();
      }
    }

    /** Remove the crop button and the hooks this module put on a dialog. */
    function clearLightboxHooks() {
      for (const button of document.querySelectorAll("[data-rdsh-crop-button]")) button.remove();
      for (const dialog of document.querySelectorAll("[data-rdsh-lightbox]")) dialog.removeAttribute("data-rdsh-lightbox");
      for (const dialog of document.querySelectorAll("[data-rdsh-swipe]")) dialog.removeAttribute("data-rdsh-swipe");
    }

    function decorateLightbox() {
      // The crop button and the full-bleed styling are phone affordances: a
      // desktop viewer keeps its own chrome and its own close button.
      if (!phone()) {
        clearLightboxHooks();
        return;
      }
      const dialog = lightboxDialog();
      if (dialog === null) return;
      if (!dialog.hasAttribute("data-rdsh-lightbox")) dialog.setAttribute("data-rdsh-lightbox", "");
      if (dialog.querySelector("[data-rdsh-crop-button]") === null) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-rdsh-crop-button", "");
        button.setAttribute("aria-label", t("crop.aria"));
        button.innerHTML = CROP_ICON;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openCrop(dialog);
        });
        dialog.append(button);
      }
      attachLightboxSwipe(dialog);
    }

    // ---------------------------------------------------------------------
    // Notifications (Web Push in the installed app)
    // ---------------------------------------------------------------------
    function urlBase64ToUint8Array(base64) {
      const padding = "=".repeat((4 - (base64.length % 4)) % 4);
      const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(normalized);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      return bytes;
    }

    async function notificationStatus() {
      if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
        return { supported: false, permission: "unsupported", subscribed: false, ready: false };
      }
      let subscribed = false;
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = registration === null || registration === undefined ? null : await registration.pushManager.getSubscription();
        subscribed = subscription !== null && subscription !== undefined;
      } catch {
        subscribed = false;
      }
      return {
        supported: true,
        permission: Notification.permission,
        subscribed,
        ready: navigator.serviceWorker.controller !== null,
      };
    }

    /**
     * Tell the push host which deployed origin this page is.
     *
     * The host delivers each event to one origin only: the app that started
     * the turn, or the newest origin that has talked to it, and never to every
     * stored subscription (#27). After a process restart it has to learn that
     * origin again, so a boot-time `/config` request is enough: its guard
     * records the request origin from the Origin/Referer headers without
     * changing any notification setting, and without one the host logs
     * `push skipped` instead of guessing.
     */
    let pushOriginNoted = false;
    function notePushOrigin() {
      if (pushOriginNoted) return;
      pushOriginNoted = true;
      void fetch(`${PUSH_API}/config`, { cache: "no-store" }).catch(() => {});
    }

    async function refreshNotificationStatus() {
      notePushOrigin();
      emit({ notifications: await notificationStatus() });
    }

    async function enableNotifications() {
      if (typeof Notification === "undefined") throw new Error(t("notify.unsupported"));
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(t("notify.permissionMissing"));
      const registration = await navigator.serviceWorker.ready;
      const response = await fetch(`${PUSH_API}/vapid`, { cache: "no-store" });
      if (!response.ok) throw new Error(t("notify.unavailable"));
      const { publicKey } = await response.json();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing === null
        ? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
        : existing;
      const saved = await fetch(`${PUSH_API}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `origin` becomes the VAPID contact for pushes: Apple rejects
        // mailto:root@localhost with 403 BadJwtToken, but accepts the app's own
        // https origin.
        body: JSON.stringify({ subscription: subscription.toJSON(), label: navigator.userAgent, origin: location.origin }),
      });
      if (!saved.ok) throw new Error(t("notify.subscribeFailed", { status: saved.status }));
      await refreshNotificationStatus();
    }

    async function disableNotifications() {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration === null || registration === undefined ? null : await registration.pushManager.getSubscription();
      if (subscription !== null) {
        try {
          await fetch(`${PUSH_API}/unsubscribe`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            // The host scopes the delete to this app's origin, so a shared
            // store (the other installed app) keeps its own subscription.
            body: JSON.stringify({ endpoint: subscription.endpoint, origin: location.origin }),
          });
        } catch {
          /* the browser-side unsubscribe below still removes the endpoint */
        }
        await subscription.unsubscribe();
      }
      await refreshNotificationStatus();
    }

    async function sendTestNotification() {
      // A local showNotification always succeeds, so it proves nothing about
      // the push path. Ask the host to push for real, and fall back to the
      // local notification only when the host has no such route.
      let pushed = null;
      try {
        const response = await fetch(`${PUSH_API}/test`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Carrying the id makes the test banner tappable: it opens the same
          // session a real notification would. The origin tells the host which
          // installed app is asking, so the push cannot reach the other one.
          body: JSON.stringify({ sessionId: currentSessionId ?? "", origin: location.origin }),
        });
        if (response.status !== 404 && response.status !== 405) {
          pushed = await response.json();
        }
      } catch {
        pushed = null;
      }
      if (pushed !== null) {
        const result = Array.isArray(pushed.results) ? pushed.results[0] : null;
        if (pushed.ok === true) return;
        const detail = result === null || result === undefined
          ? String(pushed.error ?? t("notify.unknownError"))
          : `${result.status || "-"} ${result.error ?? ""}`.trim();
        throw new Error(t("notify.rejected", { detail }));
      }
      // No host route: still prove the two local paths, which is what the
      // user will actually see.
      const shown = notifyUser({
        title: t("notify.testTitle"),
        body: t("notify.testBody"),
        sessionId: currentSessionId ?? "",
        kind: "test",
      });
      if (!shown) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration === null || registration === undefined) throw new Error(t("notify.noWorker"));
        await registration.showNotification(t("notify.testTitle"), {
          body: t("notify.testLocalBody"),
          icon: "pwa/icon-192.png",
          badge: "pwa/badge-96.png",
          tag: "rdsh-mobile-ux:test",
        });
      }
    }

    // ---------------------------------------------------------------------
    // Notifications: in-app banner, sound, session deep link
    // ---------------------------------------------------------------------

    /**
     * Where the browser half keeps the notification routes.
     *
     * They are this package's own (`/api/dsh-mobile-maxxing/push/…`): the notification
     * plugin this package replaces (`dsh-notify-push`) is credited in
     * README.md for the overall design, but nothing here calls its API.
     */
    // Relative to the page so a deployment under a proxy prefix (/dsh/…) keeps
    // working; every caller does fetch(`${PUSH_API}/…`).
    const PUSH_API = "api/dsh-mobile-maxxing/push";

    /** Preset notification sounds, synthesised — no audio files to ship. */
    const SOUND_PRESETS = {
      none: { label: t("mux.sound.none"), notes: [[0, 0, 0]] },
      // A short two-note rise: the "something finished" shape.
      chime: { label: t("mux.sound.chime"), notes: [[880, 0.09, 0.5], [1320, 0.16, 0.16]] },
      // One soft blip, for questions that should not startle.
      pop: { label: t("mux.sound.pop"), notes: [[660, 0.05, 0.35]] },
      // Three descending notes: distinct without being loud.
      drop: { label: t("mux.sound.drop"), notes: [[1175, 0.07, 0.34], [880, 0.07, 0.1], [660, 0.12, 0.1]] },
      // A quiet double tap for "still working".
      tick: { label: t("mux.sound.tick"), notes: [[1500, 0.03, 0.42], [1500, 0.03, 0.1]] },
    };

    const SOUND_KEY = "rdsh-mobile-ux:notify-sound";
    const VOLUME_KEY = "rdsh-mobile-ux:notify-volume";

    /** Read the chosen sound preset, falling back to the default. */
    function readSoundPreset() {
      try {
        const value = localStorage.getItem(SOUND_KEY);
        if (typeof value === "string" && value in SOUND_PRESETS) return value;
      } catch {
        /* private mode */
      }
      return typeof CONFIG.notificationSound === "string" && CONFIG.notificationSound in SOUND_PRESETS
        ? CONFIG.notificationSound
        : "chime";
    }

    /** Read the chosen volume (0–1). */
    function readSoundVolume() {
      try {
        const stored = localStorage.getItem(VOLUME_KEY);
        // Number(null) is 0, so an unset key must be checked before coercing:
        // otherwise "never saved" reads as "muted".
        if (stored !== null) {
          const raw = Number(stored);
          if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
        }
      } catch {
        /* private mode */
      }
      return 0.5;
    }

    let audioContext = null;

    /** Lazily create the audio context; returns null when unavailable. */
    function soundContext() {
      if (audioContext !== null && audioContext.state !== "closed") return audioContext;
      const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (typeof Ctor !== "function") return null;
      try {
        audioContext = new Ctor();
      } catch {
        return null;
      }
      return audioContext;
    }

    /**
     * Play a notification sound.
     *
     * Each preset is a list of `[frequency, duration, delay]` notes rendered
     * with a short attack and exponential release, so it reads as a chime
     * rather than a click. Nothing is fetched: the whole sound is generated.
     *
     * @param {string} [preset] - one of {@link SOUND_PRESETS}; defaults to the
     *   stored choice.
     * @param {number} [volume] - 0–1; defaults to the stored level.
     * @returns {boolean} whether a sound was scheduled.
     */
    function playNoticeSound(preset = readSoundPreset(), volume = readSoundVolume()) {
      if (preset === "none" || volume <= 0) return false;
      const spec = SOUND_PRESETS[preset];
      if (spec === undefined) return false;
      const context = soundContext();
      if (context === null) return false;
      // iOS suspends the context until a gesture; a resumed one is a no-op.
      if (context.state === "suspended") void context.resume().catch(() => {});
      const start = context.currentTime + 0.01;
      for (const [frequency, duration, delay] of spec.notes) {
        const at = start + delay;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, at);
        // A short ramp in avoids the click a hard start produces.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.35), at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + duration + 0.02);
      }
      return true;
    }

    /** Whether the page is on screen right now. */
    function pageVisible() {
      return typeof document !== "undefined" && document.visibilityState === "visible";
    }

    let noticeRoot = null;
    let noticeHost = null;
    /** The last reason a banner was skipped, so a repeating one logs once. */
    let noticeSkipReason = "";

    /**
     * Say why an in-app banner was not shown, once per reason.
     *
     * A skipped banner is otherwise silent in both directions: this side
     * returns false, and the worker, seeing no ack, leaves the system
     * notification to appear. That is the right fallback, but it leaves no
     * trace when a page should have shown the banner. The reason is logged
     * once and cleared by the next successful banner, so a shell that never
     * had the primitives logs one line instead of one per notification.
     *
     * @param {string} reason - why the banner could not be rendered.
     */
    function warnNoticeSkipped(reason) {
      if (noticeSkipReason === reason) return;
      noticeSkipReason = reason;
      console.warn(`[rdsh-mobile-ux] in-app banner skipped: ${reason}`);
    }

    /**
     * Show one in-app notification banner.
     *
     * This is the front-of-house path: when the app is on screen the user is
     * already looking at it, so a system notification would only stack on top
     * of the thing that caused it. The banner is the same `Toast` primitive the
     * app uses for its own messages, so it inherits the look, the placement and
     * the swipe-to-dismiss decoration this plugin already installs.
     *
     * @param {object} options
     * @param {string} options.title - headline, usually the session name.
     * @param {string} [options.body] - one line of detail.
     * @param {string} [options.sessionId] - session the banner is about.
     * @param {string} [options.kind] - turn-end | question | test | notice.
     * @returns {boolean} whether the banner was shown.
     */
    function showInAppNotice({ title, body = "", sessionId = "", kind = "notice" }) {
      if (!pageVisible()) {
        warnNoticeSkipped("the page is not visible");
        return false;
      }
      let primitives;
      let createRoot;
      try {
        primitives = require("@deepseek-ai/dsh-client-ui-primitives");
        ({ createRoot } = require("react-dom/client"));
      } catch (error) {
        // Without the primitives (an older shell) there is nothing to render.
        const detail = String((error && error.message) || error);
        warnNoticeSkipped(`the notification primitives are unavailable (${detail})`);
        return false;
      }
      if (typeof primitives?.Toast !== "function") {
        warnNoticeSkipped("the shell has no Toast primitive");
        return false;
      }
      if (noticeHost === null) {
        noticeHost = document.createElement("div");
        noticeHost.setAttribute("data-rdsh-notice-host", "");
        document.body.append(noticeHost);
      }
      if (noticeRoot === null) noticeRoot = createRoot(noticeHost);
      const openSession = () => {
        if (sessionId !== "") requestSession(sessionId);
        // A banner that was acted on should not linger.
        noticeRoot?.render(null);
      };
      noticeRoot.render(h(
        primitives.Toast,
        {
          // The session name is the headline; the detail is what happened.
          text: body === "" ? title : `${title} — ${body}`,
          holdMs: kind === "question" ? 6000 : 4200,
          actions: sessionId === ""
            ? undefined
            : [{ label: t("notify.open"), prefix: " ", onClick: openSession }],
          // The component owns its lifetime; this clears the tree afterwards.
          onDone: () => {
            noticeRoot?.render(null);
          },
        },
      ));
      // A banner made it: the next failure is news again.
      noticeSkipReason = "";
      return true;
    }

    /**
     * Deliver one notification through the right channel.
     *
     * On screen → in-app banner (plus the sound). Otherwise the service worker
     * has already turned it into a system notification, so this only runs the
     * sound when the page is allowed to make one.
     *
     * @param {object} notice - `{ title, body, sessionId, kind }`.
     */
    function notifyUser(notice) {
      // A banner only appears while the page is on screen, so the sound rides
      // with it; a backgrounded page lets the service worker make its own noise.
      if (!pageVisible()) {
        warnNoticeSkipped("the page is not visible");
        return false;
      }
      playNoticeSound(notice.kind === "question" ? "pop" : readSoundPreset());
      return showInAppNotice(notice);
    }

    // --- Session selection -------------------------------------------------

    /** How long a selected session is re-asserted after a notification tap. */
    const SESSION_CONFIRM_MS = 15000;
    /** Set while this module is opening a session, to stop re-entrancy. */
    let selectingSession = false;
    /** The session a notification asked for, until the DOM shows it. */
    let wantedSession = "";
    let wantedUntil = 0;
    let sessionOpener = null;

    /**
     * Ask for one session to be opened.
     *
     * The SPA has no URL routing for sessions, so the only way in is
     * `uiWorkspace.openSession`. Opening during boot loses a race against the
     * SPA restoring its own last session, so the request is re-asserted until
     * the chat actually shows that session.
     *
     * @param {string} sessionId - session to select.
     */
    function requestSession(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (sessionId === currentSessionId) return;
      wantedSession = sessionId;
      wantedUntil = Date.now() + SESSION_CONFIRM_MS;
      sessionOpener?.();
    }

    /** The session the chat is currently showing, read from the DOM. */
    function shownSessionId() {
      try {
        return document.querySelector("[data-conversation-session]")?.getAttribute("data-conversation-session") ?? "";
      } catch {
        return "";
      }
    }

    /**
     * Bind session selection to the client services.
     *
     * @param {object} scope - injected context carrying `uiWorkspace`.
     */
    function attachSessionOpener(scope) {
      const uiWorkspace = scope.get("uiWorkspace");
      if (uiWorkspace === undefined) return;
      const sessions = typeof scope.get === "function" ? scope.get("sessions") : undefined;
      // A session the catalog does not know cannot be opened; when there is no
      // catalog, trying is still safe because retain() rejects unknown ids.
      const known = (id) => {
        if (sessions === undefined) return true;
        try {
          return sessions?.list?.getSnapshot()?.byId?.[id] !== undefined;
        } catch {
          return true;
        }
      };
      /**
       * Select once, guarded.
       *
       * `openSession` retains the session, which publishes a new list snapshot,
       * which can call back in synchronously. Without the guard that nests
       * until the stack overflows and nothing is ever opened.
       */
      sessionOpener = () => {
        if (selectingSession) return;
        if (wantedSession === "") return;
        const id = wantedSession;
        if (!known(id)) {
          wantedSession = "";
          return;
        }
        selectingSession = true;
        try {
          uiWorkspace.openSession(id);
        } catch {
          // The workspace is not ready yet; the timer keeps retrying.
          selectingSession = false;
          return;
        }
        selectingSession = false;
      };
      // Boot restores its own session after ours, so keep asserting until the
      // chat shows the one that was asked for, then stop.
      const timer = setInterval(() => {
        if (wantedSession === "") return;
        if (shownSessionId() === wantedSession) {
          wantedSession = "";
          return;
        }
        if (Date.now() > wantedUntil) {
          wantedSession = "";
          return;
        }
        sessionOpener?.();
      }, 500);
      scope.effect?.(() => () => clearInterval(timer));
    }

    /** Read `?session=` once, then drop it from the address bar. */
    function sessionFromUrl() {
      try {
        const url = new URL(location.href);
        const id = url.searchParams.get("session");
        if (id === null || id === "") return "";
        url.searchParams.delete("session");
        history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        return id;
      } catch {
        return "";
      }
    }

    /**
     * Worker message names that hand a notification to this page.
     *
     * The current name comes first; `rdsh-pwa` is the worker of the package
     * this one replaced. A message carries exactly one `type`, so a hand-off
     * can match only one entry and is never handled twice.
     */
    const NOTIFY_MESSAGES = ["dsh-mobile-maxxing:notify", "rdsh-pwa:notify"];
    /**
     * Worker message names that ask for a session to be opened.
     *
     * `dsh-notify-push` and `rdsh-pwa` are the previous packages' names. An
     * old worker can still be the one controlling a page until its update
     * lands, and its notification taps must keep working across the hand-over.
     */
    const OPEN_SESSION_MESSAGES = [
      "dsh-mobile-maxxing:open-session",
      "dsh-notify-push:open-session",
      "rdsh-pwa:open-session",
    ];

    /**
     * Route a service-worker message to the right handler.
     *
     * Two shapes arrive here: a notification the worker declined to show
     * because a window was visible, and a click on a system notification.
     *
     * @param {MessageEvent} event - message from the worker.
     */
    function onWorkerMessage(event) {
      const data = event?.data;
      if (data === null || typeof data !== "object") return;
      if (NOTIFY_MESSAGES.includes(data.type)) {
        const shown = notifyUser({
          title: typeof data.title === "string" ? data.title : "DSH",
          body: typeof data.body === "string" ? data.body : "",
          sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
          kind: typeof data.kind === "string" ? data.kind : "notice",
        });
        // The worker shows a system banner unless we take the notification, so
        // acknowledge only when a banner was actually rendered.
        if (shown) event?.ports?.[0]?.postMessage("shown");
        return;
      }
      if (OPEN_SESSION_MESSAGES.includes(data.type)) {
        requestSession(typeof data.sessionId === "string" ? data.sessionId : "");
      }
    }

    // ---------------------------------------------------------------------
    // UI: Settings section
    // ---------------------------------------------------------------------
    function LocalPermissionSection() {
      const s = useStore();
      const [message, setMessage] = useState("");
      const options = Array.isArray(s.permissionOptions) ? s.permissionOptions : [];
      const chosen = typeof s.localPermission === "string" && s.localPermission !== "" ? s.localPermission : "";
      const shared = typeof s.permissionSharedDefault === "string" ? s.permissionSharedDefault : "";
      const sharedOption = options.find((option) => option.value === shared);
      const sharedLabel = sharedOption === undefined ? shared : permissionOptionLabel(sharedOption);

      return h(
        "div",
        { className: "rdsh-mux-card" },
        h("h3", { className: "rdsh-mux-title" }, t("localPermission.title")),
        h("p", { className: "rdsh-mux-desc" }, t("localPermission.desc")),
        h(
          "label",
          { className: "rdsh-mux-slider" },
          h("span", null, t("localPermission.label")),
          h(
            "select",
            {
              className: "rdsh-mux-select",
              value: chosen,
              onChange: (event) => {
                writeLocalPermission(event.target.value);
                setMessage(t("localPermission.saved"));
              },
            },
            h("option", { value: "" }, t("localPermission.follow")),
            options.map((option) => h("option", { key: option.value, value: option.value }, permissionOptionLabel(option))),
          ),
        ),
        shared === ""
          ? null
          : h("p", { className: "rdsh-mux-note" }, t("localPermission.shared", { preset: sharedLabel })),
        h("p", { className: "rdsh-mux-note" }, t("localPermission.hostNote")),
        s.permissionError === "" ? null : h("p", { className: "rdsh-mux-note" }, s.permissionError),
        message === "" ? null : h("p", { className: "rdsh-mux-note" }, message),
      );
    }

    function MobileSection() {
      const s = useStore();
      // The rows this section keeps are decided by the device, not the window
      // width, so a desktop never reads mobile-only copy.
      const onPhone = s.phone === true;
      const [message, setMessage] = useState("");
      const [busy, setBusy] = useState(false);
      const [sound, setSound] = useState(readSoundPreset);
      const [volume, setVolume] = useState(readSoundVolume);

      useEffect(() => {
        void refreshNotificationStatus();
      }, []);

      const run = async (action, success) => {
        setBusy(true);
        setMessage("");
        try {
          await action();
          setMessage(success);
        } catch (error) {
          setMessage(String((error && error.message) || error));
        } finally {
          setBusy(false);
          scheduleDecorate();
        }
      };

      return h(
        "section",
        { className: "rdsh-mux-section" },
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, t("mux.deviceTheme.title")),
          h("p", { className: "rdsh-mux-desc" }, t("mux.deviceTheme.desc")),
          h(
            "label",
            { className: "rdsh-mux-slider" },
            h("span", null, t("mux.deviceTheme.label")),
            h(
              "select",
              {
                className: "rdsh-mux-select",
                value: s.deviceTheme,
                onChange: (event) => writeDeviceTheme(event.target.value),
              },
              Object.entries(DEVICE_THEME_KEYS).map(([id, key]) => h("option", { key: id, value: id }, t(key))),
            ),
          ),
          h("p", { className: "rdsh-mux-note" }, t("mux.deviceTheme.note")),
          s.deviceThemeNote === "custom"
            ? h("p", { className: "rdsh-mux-note" }, t("mux.deviceTheme.custom"))
            : null,
          s.deviceThemeNote === "unsupported"
            ? h("p", { className: "rdsh-mux-note" }, t("mux.deviceTheme.unsupported"))
            : null,
        ),
        onPhone ? h(LocalPermissionSection) : null,
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, t("mux.section.title")),
          // #15: on a desktop this card must not describe a layout it is not
          // running, and the layout row is a phone/window fact. The
          // notification controls below stay: they are useful everywhere.
          h("p", { className: "rdsh-mux-desc" }, onPhone ? t("mux.section.desc") : t("mux.section.desc.desktop")),
          onPhone ? h("p", { className: "rdsh-mux-note" }, t("mux.section.plusNote")) : null,
          h(
            "div",
            { className: "rdsh-mux-actions" },
            h("button", {
              type: "button",
              className: "rdsh-mux-primary",
              disabled: busy || !s.notifications.supported,
              onClick: () => run(enableNotifications, t("mux.message.enabled")),
            }, s.notifications.permission === "granted" ? t("mux.action.reRegister") : t("mux.action.enable")),
            h("button", {
              type: "button",
              disabled: busy || s.notifications.permission !== "granted",
              onClick: () => run(sendTestNotification, t("mux.message.testSent")),
            }, t("mux.action.test")),
            s.notifications.permission === "granted"
              ? h("button", {
                type: "button",
                disabled: busy,
                onClick: () => run(disableNotifications, t("mux.message.disabled")),
              }, t("mux.action.disable"))
              : null,
          ),
          s.notifications.permission === "denied"
            ? h("p", { className: "rdsh-mux-note" }, t("mux.note.blocked"))
            : null,
          h("h4", { className: "rdsh-mux-subtitle" }, t("mux.sound.title")),
          h("p", { className: "rdsh-mux-desc" }, t("mux.sound.desc")),
          h(
            "div",
            { className: "rdsh-mux-sound-row" },
            h(
              "select",
              {
                className: "rdsh-mux-select",
                value: sound,
                onChange: (event) => {
                  const next = event.target.value;
                  setSound(next);
                  try {
                    localStorage.setItem(SOUND_KEY, next);
                  } catch {
                    /* private mode */
                  }
                  // Preview immediately: picking a sound you cannot hear is
                  // guesswork.
                  playNoticeSound(next, volume);
                },
              },
              Object.entries(SOUND_PRESETS).map(([id, preset]) => h("option", { key: id, value: id }, preset.label)),
            ),
            h("button", {
              type: "button",
              className: "rdsh-mux-secondary",
              onClick: () => playNoticeSound(sound, volume),
            }, t("mux.sound.preview")),
          ),
          h(
            "label",
            { className: "rdsh-mux-slider" },
            h("span", null, t("mux.sound.volume")),
            h("input", {
              type: "range",
              min: "0",
              max: "100",
              step: "5",
              value: String(Math.round(volume * 100)),
              onChange: (event) => {
                const next = Number(event.target.value) / 100;
                setVolume(next);
                try {
                  localStorage.setItem(VOLUME_KEY, String(next));
                } catch {
                  /* private mode */
                }
              },
              onPointerUp: () => playNoticeSound(sound, volume),
            }),
            h("span", { className: "rdsh-mux-slider-value" }, `${Math.round(volume * 100)}%`),
          ),
          // #15: the host defaults to `onlyMobileTurns: true`, so a desktop
          // send is never notified unless this browser opts in.
          h(
            "label",
            { className: "rdsh-mux-check" },
            h("input", {
              type: "checkbox",
              checked: s.notifyDeviceTurns === true,
              onChange: (event) => writeNotifyDeviceTurns(event.target.checked),
            }),
            t("mux.notify.deviceTurns"),
          ),
          h("p", { className: "rdsh-mux-note" }, t("mux.notify.deviceTurns.note")),
          h("p", { className: "rdsh-mux-note" }, t("mux.note.notifyScope")),
          message !== "" ? h("p", { className: "rdsh-mux-note" }, message) : null,
        ),
        // One Mobile tab carries both sections inline; the separate tabs are
        // no longer registered.
        onPhone ? h(LocalDisplaySettingsSection) : null,
        onPhone ? h(InputSection) : null,
        onPhone && typeof globalThis.__RDSH_PWA_SETTINGS_SECTION__ === "function"
          ? h(globalThis.__RDSH_PWA_SETTINGS_SECTION__)
          : null,
        s.bootError !== "" ? h("p", { className: "rdsh-mux-note" }, t("mux.bootError", { error: s.bootError })) : null,
      );
    }

    function InputSection() {
      const s = useStore();
      return h(
        "section",
        { className: "rdsh-mux-section" },
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, t("mux.input.title")),
          h("p", { className: "rdsh-mux-desc" }, t("mux.input.desc")),
          h(
            "label",
            { className: "rdsh-mux-check" },
            h("input", {
              type: "checkbox",
              checked: s.enterToSend,
              onChange: (event) => writeEnterToSend(event.target.checked),
            }),
            t("mux.input.enterToSend"),
          ),
          h("p", { className: "rdsh-mux-note" }, s.enterToSend
            ? t("mux.input.current.enterSends")
            : t("mux.input.current.enterNewline")),
        ),
      );
    }

    /**
     * Device-local font size and language controls.
     *
     * Kept as its own component (not folded into the Mobile card) so another
     * unrelated Settings block can be cherry-picked beside it. All writes go
     * to localStorage and the local projections above; no Host setting is
     * touched.
     */
    function LocalDisplaySettingsSection() {
      const s = useStore();
      const display = s.localDisplay;
      const fonts = display.fonts ?? { text: 14, code: 11, terminal: 13 };
      const languages = display.languages ?? [];
      const available = display.available ?? { fonts: true, language: true };
      const reasons = display.reason ?? {};
      const reasonText = (kind) => {
        const reason = String(reasons[kind] ?? "");
        const key = {
          "theme-missing": "localDisplay.reason.themeMissing",
          "theme-shape": "localDisplay.reason.themeShape",
          "locale-missing": "localDisplay.reason.localeMissing",
          "locale-shape": "localDisplay.reason.localeShape",
          "no-locales": "localDisplay.reason.noLocales",
        }[reason];
        return key === undefined ? reason : t(key);
      };
      return h(
        "section",
        { className: "rdsh-mux-section" },
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, t("localDisplay.title")),
          h("p", { className: "rdsh-mux-desc" }, t("localDisplay.desc")),
          ...LOCAL_FONT_ROLES.map((role) => {
            const spec = LOCAL_FONT_SPECS[role];
            const value = fonts[role];
            const label = t(`localDisplay.${role}`);
            return h(
              "div",
              { className: "rdsh-mux-font-row", key: role },
              h("span", { className: "rdsh-mux-font-label" }, label),
              h(
                "div",
                { className: "rdsh-mux-font-control" },
                h("button", {
                  type: "button",
                  className: "rdsh-mux-step",
                  "aria-label": `${label} −`,
                  disabled: available.fonts === false || value <= spec.min,
                  onClick: () => setLocalDisplayFont(role, -1),
                }, "−"),
                h("span", { className: "rdsh-mux-font-value" }, `${value}px`),
                h("button", {
                  type: "button",
                  className: "rdsh-mux-step",
                  "aria-label": `${label} +`,
                  disabled: available.fonts === false || value >= spec.max,
                  onClick: () => setLocalDisplayFont(role, 1),
                }, "+"),
              ),
            );
          }),
          available.fonts === false
            ? h("p", { className: "rdsh-mux-note" }, t("localDisplay.unavailable", { reason: reasonText("fonts") }))
            : null,
          h(
            "label",
            { className: "rdsh-mux-slider" },
            h("span", null, t("localDisplay.language")),
            h(
              "select",
              {
                className: "rdsh-mux-select",
                value: display.language,
                disabled: available.language === false,
                onChange: (event) => setLocalDisplayLanguage(event.target.value),
              },
              h("option", { value: "" }, t("localDisplay.language.system")),
              languages.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.label)),
            ),
          ),
          available.language === false
            ? h("p", { className: "rdsh-mux-note" }, t("localDisplay.unavailable", { reason: reasonText("language") }))
            : h("p", { className: "rdsh-mux-note" }, t("localDisplay.language.note")),
          h("p", { className: "rdsh-mux-note" }, t("localDisplay.note")),
        ),
      );
    }

    function LiveSpeed({ sessionId }) {
      // The label belongs to the mobile surface, not to a window width: it
      // appears whenever this device runs the mobile UI, at any viewport size.
      const store = useStore();
      const phone = store.phone;
      const [speed, setSpeed] = useState(null);
      useEffect(() => {
        currentSessionId = typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
        return () => {
          if (currentSessionId === sessionId) currentSessionId = null;
        };
      }, [sessionId]);
      useEffect(() => {
        if (!sessionId || !phone) {
          setSpeed(null);
          return undefined;
        }
        let active = true;
        const update = async () => {
          try {
            const response = await fetch(`/api/rdsh-mobile-ux/live-speed?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
            if (!response.ok) {
              if (active) setSpeed(null);
              return;
            }
            const data = await response.json();
            if (active) setSpeed(Number.isFinite(data?.tps) && data.tps > 0 ? Math.round(data.tps) : null);
          } catch {
            if (active) setSpeed(null);
          }
        };
        void update();
        const timer = window.setInterval(() => void update(), 500);
        return () => {
          active = false;
          window.clearInterval(timer);
        };
      }, [sessionId, phone]);
      if (!phone || speed === null) return null;
      return h("span", {
        className: "rdsh-mux-live-speed",
        title: t("mux.liveSpeed.title"),
        "aria-label": t("mux.liveSpeed.aria", { speed }),
      }, `≈ ${speed} tok/s`);
    }

    // ---------------------------------------------------------------------
    // Styles
    //
    // The layout stylesheet is split in two. The mobile half is inserted as a
    // separate <style> only when the bootstrapped mode is "mobile": no rule is
    // enabled by a max-width wrapper, and a resize cannot add or remove it.
    //
    //   CSS_DEVICE  the plugin's own chrome that is not device-specific: the
    //               shared toast and the Settings cards.
    //   CSS_PHONE   everything that reshapes upstream on a mobile device:
    //               drawer, right panel, composer, transcript, question cards,
    //               queue, workspace picker, settings navigation, animations,
    //               the session colour frame and the safe-area root padding.
    //
    // A mobile rule belongs in CSS_PHONE; the mobile-mode style node is the
    // contract.
    // ---------------------------------------------------------------------
    const CSS_DEVICE = `
.rdsh-mux-toast {
  position: fixed; z-index: 960; left: 50%;
  bottom: calc(max(env(safe-area-inset-bottom, 0px), var(--rdsh-safe-bottom, 0px)) + 104px);
  max-width: calc(100vw - 48px); box-sizing: border-box;
  padding: 9px 14px; border-radius: 999px;
  background: var(--dsw-alias-toast-bg, #353638); color: var(--dsw-alias-toast-label, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  font-size: 13px; line-height: 1.4; text-align: center; pointer-events: none;
  opacity: 0; transform: translateX(-50%) translateY(6px);
  transition: opacity .16s ease, transform .16s ease;
}
.rdsh-mux-toast[data-show] { opacity: 1; transform: translateX(-50%); }


.rdsh-mux-section { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary, #f9fafb); }
.rdsh-mux-card {
  border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(255,255,255,.12)));
  background: var(--dsw-alias-settings-card-fill, transparent);
  border-radius: 12px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.rdsh-mux-title { margin: 0; font-size: 16px; font-weight: 500; }
.rdsh-mux-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); }
.rdsh-mux-secondary {
  flex: 0 0 auto; padding: 8px 12px; border-radius: 9px;
  font: inherit; font-size: 13px; cursor: pointer;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-alias-bg-layer-2, #26262a);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
}
.rdsh-mux-slider {
  display: flex; align-items: center; gap: 10px; margin: 0 0 8px;
  font-size: 13px; color: var(--dsw-alias-label-secondary, #cfd3d6);
}
.rdsh-mux-slider input[type="range"] { flex: 1 1 auto; min-width: 0; accent-color: var(--dsw-alias-link, #4d6bfe); }
.rdsh-mux-slider-value {
  flex: 0 0 auto; min-width: 42px; text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #f9fafb);
}
.rdsh-mux-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rdsh-mux-actions button, .rdsh-mux-card > button {
  font: inherit; font-size: 13px; min-height: 34px; padding: 0 14px; border-radius: 9px; cursor: pointer;
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
}
.rdsh-mux-actions button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.rdsh-mux-subtitle {
  margin: 16px 0 6px; font-size: 13px; font-weight: 600;
  color: var(--dsw-alias-label-primary, #f9fafb);
}
.rdsh-mux-sound-row { display: flex; align-items: center; gap: 8px; margin: 8px 0 10px; }
.rdsh-mux-select {
  flex: 1 1 auto; min-width: 0; box-sizing: border-box;
  padding: 8px 10px; border-radius: 9px; font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-alias-bg-layer-2, #26262a);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  -webkit-appearance: none; appearance: none;
}
.rdsh-mux-actions button.rdsh-mux-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #f9fafb);
  color: var(--dsw-alias-label-primary-foreground, #151517);
}
.rdsh-mux-actions button:disabled { opacity: .45; cursor: default; }
.rdsh-mux-note { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); }
.rdsh-mux-check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.rdsh-mux-font-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--dsw-alias-label-secondary, #cfd3d6); }
.rdsh-mux-font-label { min-width: 0; }
.rdsh-mux-font-control { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.rdsh-mux-font-value { min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, #f9fafb); }
.rdsh-mux-step {
  width: 30px; height: 30px; padding: 0; border-radius: 8px;
  font: inherit; font-size: 16px; line-height: 1; cursor: pointer;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-alias-bg-layer-2, #26262a);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
}
.rdsh-mux-step:disabled { opacity: .4; cursor: default; }

`;

    const CSS_PHONE = `
/* Controls the hide list matched. The attribute these selectors key off is
   written only while phone() holds (see applyHideList), and the rules sit in
   the mobile sheet as well: a desktop keeps every control. */
html[data-rdsh-hide-settings] [data-rdsh-hidden],
html[data-rdsh-hide-settings] [data-rdsh-setting-hidden] { display: none !important; }

/* Session colour frames and their menu/palette. The frame is a phone
   affordance in the #44 contract: a desktop sidebar is upstream's, unchanged. */
[data-rdsh-session-frame] {
  box-shadow: inset 0 0 0 2px var(--rdsh-session-frame) !important;
}
.rdsh-frame-menu-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border: 0; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.rdsh-frame-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.rdsh-frame-menu-icon { display: grid; place-items: center; width: 16px; height: 16px; opacity: .9; }
.rdsh-frame-backdrop { position: fixed; inset: 0; z-index: 900; background: transparent; }
.rdsh-frame-pop {
  position: fixed; z-index: 901; width: 252px; box-sizing: border-box;
  padding: 12px; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2, #2c2c2e); color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 14px 40px rgba(0,0,0,.3));
}
.rdsh-frame-pop-title { font-size: 12px; color: var(--dsw-alias-label-secondary, #cfd3d6); margin-bottom: 10px; }
.rdsh-frame-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.rdsh-frame-swatch {
  width: 30px; height: 30px; border-radius: 999px !important;
  border: 2px solid transparent; padding: 0; cursor: pointer;
}
.rdsh-frame-swatch[data-current="true"] { border-color: var(--dsw-alias-label-primary, #f9fafb); box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-2, #2c2c2e), 0 0 0 3px var(--dsw-alias-label-primary, #f9fafb); }
.rdsh-frame-clear {
  width: 100%; margin-top: 12px; padding: 8px 10px;
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16)); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
  font: inherit; font-size: 12px; cursor: pointer;
}

.rdsh-mux-live-speed { color: var(--dsw-alias-label-secondary, #a1a1aa); font-size: 11px; white-space: nowrap; }
/* #59: the drawer button follows the notch inset instead of a fixed 8px. */
.rdsh-mux-fab {
  position: fixed; left: calc(env(safe-area-inset-left, 0px) + 8px); top: calc(env(safe-area-inset-top, 0px) + 8px);
  width: 40px; height: 40px; border: 0; border-radius: 12px; z-index: 40;
  display: none; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-alias-bg-module-platform, #26262a);
  box-shadow: var(--dsw-shadow-lv2, 0 4px 12px rgba(0,0,0,.08));
  -webkit-tap-highlight-color: transparent; cursor: pointer;
}
.rdsh-mux-fab:active { transform: scale(.96); }
.rdsh-mux-fab-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 18px; height: 18px; padding: 0 4px;
  border-radius: 9px; box-sizing: border-box;
  background: var(--dsw-alias-state-error-primary, #ef4444);
  color: var(--dsw-alias-toast-label, #fff);
  font: 700 10px/14px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
  text-align: center; white-space: nowrap;
  border: 2px solid var(--dsw-alias-bg-base, #151517);
  box-shadow: var(--dsw-shadow-lv1, 0 2px 4px rgba(0,0,0,.05));
  display: none; pointer-events: none;
}
.rdsh-mux-fab-badge[data-visible] { display: block; }

/* A full-screen route's detail replaces the chat, and its first control sits
   in the corner the drawer button owns: the Plugins breadcrumb and the task
   detail's first tab were both painted under it (#61, #62). The marker retires
   the drawer button for as long as the detail is up; where upstream keeps its
   close button at the far right, the same slot becomes a back button and the
   detail keeps a matching top inset so its first row stays clear. */
html:has([data-rdsh-route-detail]) .rdsh-mux-fab { display: none !important; }
[data-rdsh-route-detail="back"] { padding-top: 56px !important; }
.rdsh-mux-route-back {
  position: fixed; left: 8px; top: calc(env(safe-area-inset-top, 0px) + 8px);
  width: 40px; height: 40px; border: 0; border-radius: 12px; z-index: 40;
  display: none; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-alias-bg-module-platform, #26262a);
  box-shadow: var(--dsw-shadow-lv2, 0 4px 12px rgba(0,0,0,.08));
  -webkit-tap-highlight-color: transparent; cursor: pointer;
}
.rdsh-mux-route-back[data-visible] { display: flex; }
.rdsh-mux-route-back:active { transform: scale(.96); }

.rdsh-mux-backdrop {
  position: fixed; inset: 0; z-index: 45; display: none;
  /* The reference dim (rgba(0,0,0,.35)), not a theme token whose alpha can
     drift with the palette. No fade: the dimming is a state change, and
     fading it looked like a second sheet sliding in behind the drawer. */
  background: rgba(0,0,0,.35); opacity: 0; pointer-events: none;
}

.rdsh-mux-detail {
  position: fixed; z-index: 990; box-sizing: border-box;
  padding: 10px 12px 12px; border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, #2c2c2e) !important;
  color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0,0,0,.3));
  font-size: 13px; line-height: 1.55; overflow-wrap: anywhere;
  max-height: min(50dvh, 380px); overflow-y: auto;
  animation: rdsh-mux-pop .14s ease-out;
}
.rdsh-mux-detail-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.rdsh-mux-detail-title {
  font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, #a1a1aa);
}
.rdsh-mux-detail-meta {
  font-size: 11px; color: var(--dsw-alias-label-tertiary, #a1a1aa);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  border-radius: 999px; padding: 1px 6px;
}
.rdsh-mux-detail-body { white-space: pre-wrap; }

.rdsh-mux-titlepop {
  position: fixed; z-index: 980; box-sizing: border-box;
  padding: 10px 12px; border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, #2c2c2e) !important;
  color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0,0,0,.3));
  font-size: 13px; line-height: 1.5; overflow-wrap: anywhere;
  animation: rdsh-mux-pop .14s ease-out;
}
@keyframes rdsh-mux-pop { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }

/* Image lightbox: keep the close/crop controls below the camera housing,
   shrink the image into the remaining safe area, and darken the backdrop.
   The viewer is a desktop surface too, so these stay on the phone. */

  [data-rdsh-lightbox] { background: rgba(0,0,0,.96) !important; }
  [data-rdsh-lightbox] [class*="_mask_"] { background: rgba(0,0,0,.96) !important; }
  [data-rdsh-lightbox] [class*="_close_"] {
    z-index: 5;
    top: calc(env(safe-area-inset-top, 0px) + 12px) !important;
    right: 16px !important;
    width: 40px !important; height: 40px !important;
    border-radius: 50% !important;
    background: rgba(44,44,46,.95) !important;
  }
  [data-rdsh-lightbox] [class*="_image_"] {
    max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 104px) !important;
    max-width: calc(100vw - 24px) !important;
  }
  [data-rdsh-crop-button] {
    position: absolute; z-index: 5; top: calc(env(safe-area-inset-top, 0px) + 12px); left: 16px;
    width: 40px; height: 40px; border: 0; border-radius: 50%;
    background: rgba(44,44,46,.95); color: #f9fafb;
    display: grid; place-items: center; z-index: 2; padding: 0;
  }

.rdsh-crop-overlay {
  position: fixed; inset: 0; z-index: 1200;
  display: flex; flex-direction: column;
  background: #000; color: #f9fafb;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.rdsh-crop-head {
  position: relative; z-index: 3;
  flex: 0 0 auto; height: 52px; padding: 0 12px 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 15px;
}
.rdsh-crop-close {
  width: 40px; height: 40px; border: 0; border-radius: 50%;
  background: rgba(44,44,46,.95); color: #f9fafb; font-size: 22px; line-height: 1;
}
.rdsh-crop-head-actions { display: flex; align-items: center; gap: 4px; }
.rdsh-crop-rotate {
  width: 40px; height: 40px; border: 0; border-radius: 50%;
  background: rgba(44,44,46,.95); color: #f9fafb;
  display: grid; place-items: center; padding: 0;
}
.rdsh-crop-stage {
  flex: 1 1 auto; min-height: 0; display: flex;
  align-items: center; justify-content: center; padding: 12px;
}
.rdsh-crop-wrap { position: relative; line-height: 0; max-width: 100%; max-height: 100%; }
.rdsh-crop-image {
  display: block; max-width: 100%; max-height: 100%;
  user-select: none; -webkit-user-select: none; -webkit-user-drag: none;
}
.rdsh-crop-box {
  position: absolute; box-sizing: border-box;
  border: 1.5px solid #fff; cursor: move; touch-action: none;
  box-shadow: 0 0 0 9999px rgba(0,0,0,.55);
}
.rdsh-crop-box::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% + .5px), transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% + .5px), transparent calc(66.66% + .5px)),
    linear-gradient(to bottom, transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% + .5px), transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% + .5px), transparent calc(66.66% + .5px));
}
.rdsh-crop-handle {
  position: absolute; width: 24px; height: 24px; box-sizing: border-box;
  border: 2px solid #fff; border-radius: 50%;
  background: rgba(0,0,0,.35); touch-action: none;
}
.rdsh-crop-handle[data-corner="nw"] { left: -12px; top: -12px; cursor: nwse-resize; }
.rdsh-crop-handle[data-corner="ne"] { right: -12px; top: -12px; cursor: nesw-resize; }
.rdsh-crop-handle[data-corner="sw"] { left: -12px; bottom: -12px; cursor: nesw-resize; }
.rdsh-crop-handle[data-corner="se"] { right: -12px; bottom: -12px; cursor: nwse-resize; }
.rdsh-crop-actions {
  position: relative; z-index: 3;
  flex: 0 0 auto; display: flex; gap: 10px; padding: 12px 16px;
}
.rdsh-crop-actions button {
  flex: 1 1 0; height: 46px; border: 0; border-radius: 12px;
  font: inherit; font-size: 15px; font-weight: 600;
}
.rdsh-crop-cancel { background: #2c2c2e; color: #f9fafb; }
.rdsh-crop-save { background: #f9fafb; color: #151517; }


/* Running session: animate the label itself, never the whole row. */
html:not([data-rdsh-anim="none"]) [data-rdsh-running] [data-rdsh-status] { display: none !important; }
[data-rdsh-running] [data-rdsh-session-title] {
  position: relative; border-radius: 8px; isolation: isolate;
}
[data-rdsh-running] [data-rdsh-session-title]::before {
  content: ""; position: absolute; inset: -3px -6px; z-index: -1; border-radius: 8px;
  background: linear-gradient(100deg,
    transparent 10%,
    color-mix(in srgb, var(--dsw-alias-link, #7aaaff) 45%, transparent) 42%,
    color-mix(in srgb, var(--dsw-alias-label-deep-diving, #a78bfa) 40%, transparent) 58%,
    transparent 90%);
  background-size: 220% 100%;
  animation: rdsh-mux-aurora 3.6s ease-in-out infinite;
  filter: blur(4px); opacity: .95;
}
[data-rdsh-running] [data-rdsh-session-title]::after {
  content: ""; position: absolute; left: -7px; top: 4px; bottom: 4px; width: 2px; border-radius: 2px;
  background: linear-gradient(180deg, var(--dsw-alias-link, #7aaaff), var(--dsw-alias-label-deep-diving, #a78bfa));
  box-shadow: 0 0 8px rgba(122,170,255,.7);
  animation: rdsh-mux-pulse 2.4s ease-in-out infinite;
}
@keyframes rdsh-mux-aurora {
  0% { background-position: 120% 0; opacity: .35 }
  50% { background-position: -20% 0; opacity: .9 }
  100% { background-position: -120% 0; opacity: .35 }
}
@keyframes rdsh-mux-pulse { 0%,100% { opacity: .45 } 50% { opacity: 1 } }
/* Variant: a quiet breathing label with a left activity bar. */
html[data-rdsh-anim="breathing"] [data-rdsh-running] [data-rdsh-session-title]::before {
  background: none; filter: none; opacity: 0;
}
html[data-rdsh-anim="breathing"] [data-rdsh-running] [data-rdsh-session-title] {
  animation: rdsh-mux-breathe 5.6s ease-in-out infinite;
}
@keyframes rdsh-mux-breathe {
  0%, 100% { color: var(--dsw-alias-label-primary, #f9fafb); text-shadow: none }
  50% { color: var(--dsw-alias-label-secondary, #cfd3d6); text-shadow: 0 0 10px rgba(122,170,255,.35) }
}

/* Variant B of mockups/animation-outline.html. The animated layer is a
   normal transform rotation, not an @property angle inside a conic-gradient.
   Safari/iOS reliably animates transforms; custom-property interpolation in
   background images is the part that stayed static. */
html[data-rdsh-anim="outline"] [data-rdsh-running] [data-rdsh-session-title]::before,
html[data-rdsh-anim="outline"] [data-rdsh-running] [data-rdsh-session-title]::after { display: none !important; }
html[data-rdsh-anim="outline"] [data-rdsh-ring-row] {
  /* #58: the fill is a surface, not an accent, so it comes from the palette.
     The hex fallbacks are the fixed values this block shipped with, which is
     still what a profile without ui-theme paints. */
  --rdsh-ring-fill: var(--dsw-alias-bg-layer-2, #1b1b1c);
  position: relative !important;
  isolation: isolate;
  overflow: hidden;
  border: 0 !important;
  border-radius: 12px !important;
  box-sizing: border-box;
  background: var(--rdsh-ring-fill) !important;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]::before {
  content: "";
  position: absolute;
  left: 50%; top: 50%;
  width: 170%; aspect-ratio: 1;
  z-index: 0;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 215deg,
    color-mix(in srgb, var(--dsw-alias-link, #7aaaff) 14%, transparent) 235deg,
    color-mix(in srgb, var(--dsw-alias-link, #7aaaff) 68%, transparent) 268deg,
    color-mix(in srgb, var(--dsw-alias-link, #7aaaff) 55%, var(--dsw-alias-label-primary, #f9fafb)) 292deg,
    color-mix(in srgb, var(--dsw-alias-link, #7aaaff) 30%, transparent) 315deg,
    transparent 336deg,
    transparent 360deg
  );
  transform: translate(-50%, -50%) rotate(0deg);
  animation: rdsh-ring-rotate 2.8s linear infinite;
  pointer-events: none;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]::after {
  content: "";
  position: absolute;
  inset: 2px;
  z-index: 0;
  border-radius: 10px;
  background: var(--rdsh-ring-fill);
  pointer-events: none;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row] > * {
  position: relative;
  z-index: 1;
}
/* Yellow only while a running session is also the open one. */
html[data-rdsh-anim="outline"] [data-rdsh-ring-row][aria-selected="true"] {
  --rdsh-ring-fill: var(--dsw-alias-bg-layer-3, #2d2d2e);
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row][aria-selected="true"]::before {
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 215deg,
    color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ffd166) 14%, transparent) 235deg,
    color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ffd166) 68%, transparent) 268deg,
    color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ffd166) 55%, var(--dsw-alias-label-primary, #f9fafb)) 292deg,
    color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ffd166) 30%, transparent) 315deg,
    transparent 336deg,
    transparent 360deg
  );
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]:hover:not([aria-selected="true"]) {
  --rdsh-ring-fill: var(--dsw-alias-interactive-bg-hover-solid, #242425);
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]:not([data-rdsh-session-frame]) {
  box-shadow: none !important;
}
/* An idle session that is merely open: a plain frame and a slightly lighter
   fill, with no sweep, so "open" and "working" stay distinguishable. */
html[data-rdsh-anim="outline"] [data-rdsh-open-row]:not([data-rdsh-ring-row]) {
  background: var(--dsw-alias-bg-layer-1, #232324) !important;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(255,255,255,.2)) !important;
  border-radius: 12px !important;
}
html[data-rdsh-anim="outline"] [data-rdsh-open-row]:not([data-rdsh-ring-row]):hover {
  background: var(--dsw-alias-interactive-bg-hover-solid, #29292b) !important;
}
/* A row with a user-chosen colour frame keeps that frame: only the fill moves. */
html[data-rdsh-anim="outline"] [data-rdsh-open-row][data-rdsh-session-frame]:not([data-rdsh-ring-row]) {
  box-shadow: inset 0 0 0 2px var(--rdsh-session-frame) !important;
}

/* The open session's title carries its running state: a light, slow sweep
   through the glyphs so a phone (where the sidebar is closed) still shows
   activity. The gradient is 3x the text and the position stays inside 0-100%,
   which is exactly the range that keeps it covering the element: a wider
   travel slides the highlight off the text and leaves the title invisible. */
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  [data-rdsh-header-title][data-rdsh-header-running] {
    background-image: linear-gradient(100deg,
      var(--dsw-alias-label-primary, #f9fafb) 0%,
      var(--dsw-alias-label-primary, #f9fafb) 38%,
      color-mix(in srgb, var(--dsw-alias-link, #7aaaff) 30%, var(--dsw-alias-label-primary, #f9fafb)) 47%,
      var(--dsw-alias-label-primary, #f9fafb) 50%,
      color-mix(in srgb, var(--dsw-alias-link, #7aaaff) 30%, var(--dsw-alias-label-primary, #f9fafb)) 53%,
      var(--dsw-alias-label-primary, #f9fafb) 62%,
      var(--dsw-alias-label-primary, #f9fafb) 100%);
    background-size: 300% 100%;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: rdsh-header-sheen 5.2s ease-in-out infinite;
  }
}
@keyframes rdsh-header-sheen {
  0% { background-position: 100% 0 }
  38% { background-position: 0% 0 }
  100% { background-position: 0% 0 }
}
@media (prefers-reduced-motion: reduce) {
  [data-rdsh-header-title][data-rdsh-header-running] {
    animation: none !important;
    background-image: none;
    -webkit-text-fill-color: currentColor;
  }
}

/* Notices: swipe up to dismiss. The component keeps pointer-events off so an
   announcement cannot intercept clicks; re-enable them only on our hook, which
   only exists while the gesture is available. */
[data-rdsh-toast] { pointer-events: auto; touch-action: none; }
[data-rdsh-toast][data-rdsh-toast-dismissed] {
  transform: translate(-50%, -170%) !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition: transform .24s cubic-bezier(.4, 0, 1, 1), opacity .24s linear !important;
}

/* A generated session name: animated over the (transparent) real text. */
[data-rdsh-typing] {
  position: relative;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  /* The running sheen paints the glyphs with a background, so an invisible
     fill is not enough: without this the real (new) text stays on screen and
     the erase reads as a caret moving over a name that never goes away. */
  background-image: none !important;
  -webkit-background-clip: border-box !important;
  background-clip: border-box !important;
}
[data-rdsh-typing-layer] {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  padding: inherit;
  color: var(--dsw-alias-label-primary, #f9fafb);
  -webkit-text-fill-color: currentColor;
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}
[data-rdsh-typing-caret] {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: -0.14em;
  background: currentColor;
  animation: rdsh-typing-blink .8s steps(1, end) infinite;
}
@keyframes rdsh-typing-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
@media (prefers-reduced-motion: reduce) {
  [data-rdsh-typing-caret] { animation: none !important; }
}
@keyframes rdsh-ring-rotate {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  html[data-rdsh-anim="outline"] [data-rdsh-ring-row]::before { animation: none !important; }
}
html[data-rdsh-anim="none"] [data-rdsh-running] [data-rdsh-session-title]::before,
html[data-rdsh-anim="none"] [data-rdsh-running] [data-rdsh-session-title]::after { display: none; }

@media (prefers-reduced-motion: reduce) {
  [data-rdsh-running] [data-rdsh-session-title]::before { animation: none; opacity: .4 }
  [data-rdsh-running] [data-rdsh-session-title]::after { animation: none }
  html[data-rdsh-anim="breathing"] [data-rdsh-running] [data-rdsh-session-title] { animation: none; color: var(--dsw-alias-label-primary, #f9fafb) }
}

  /* The mockup proved 100% is the layout viewport (844) while the native web
     view is 797 on iOS 26; the body could pan 47px. 100dvh is the web view
     height, and the grid makes the app fill exactly that one row. */
  html, body {
    height: 100dvh !important;
    min-height: 100dvh !important;
    overflow: hidden !important;
    overscroll-behavior: none !important;
  }
  body { display: grid !important; grid-template-rows: 100dvh !important; }
  #root { height: 100% !important; min-height: 0 !important; box-sizing: border-box !important; }
  [data-rdsh-scroll] { overscroll-behavior-y: contain; }

  /* One slide for both sheets, so opening and closing read the same whether
     the session list or the preview moves. 300ms / standard easing is the
     app's own "slow" token, which the panel already used. */
  html {
    --rdsh-slide-ms: 300ms;
    --rdsh-slide-ease: cubic-bezier(.4, 0, .2, 1);
  }
  /* The preview's slide lives on its dock host. The trailing visibility step
     is the app's own: it keeps the element painted until the slide-out ends,
     and is dropped while open so it appears at once. */
  [data-dockkit-host] {
    transition: transform var(--rdsh-slide-ms) var(--rdsh-slide-ease), visibility 0s linear var(--rdsh-slide-ms) !important;
  }
  [data-sidebar-right-open] [data-dockkit-host] {
    transition: transform var(--rdsh-slide-ms) var(--rdsh-slide-ease) !important;
  }

  /* The drawer floats above the chat; the grid never gives it a column. */
  [data-rdsh-frame] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
  /* Pin both columns in every state. The app switches between explicit
     placement and auto-placement as the sidebar opens and closes, and auto
     placement shifts everything one column left once our drawer leaves the
     flow: the chat lands on the 0px column and the empty right column fills
     the screen. Pinning only the open state left the closed state broken. */
  [data-rdsh-frame] [data-rdsh-center-col] { grid-column: 2 !important; }
  [data-rdsh-frame] [data-rdsh-rightbar-col] { grid-column: 3 !important; }
  [data-rdsh-frame][data-rightbar-fullscreen] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
  /* The session list is the slot's own node, and the plugin moves THAT node
     into an overlay layer it creates inside the app frame (see liftDrawer).
     Taking it out of the grid is what frees the one column the chat needs;
     the old in-column fixed positioning is kept for a node that is still in
     place (a frame without the app-frame marker, an app that re-renders it). */
  [data-rdsh-sidebar] {
    position: fixed !important; inset: 0 auto 0 0 !important;
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    /* #59: a landscape notch can sit on either side; the drawer's own padding
       keeps its rows clear of it (a fixed layer ignores #root's padding). */
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    width: 280px !important; max-width: 86vw; height: 100dvh !important; min-height: 100dvh;
    /* Above the app's own overlay layer (z-index 20) and every panel a plugin
       can mount there. */
    z-index: 60; overflow: hidden;
    transform: translateX(-104%);
    transition: transform var(--rdsh-slide-ms) var(--rdsh-slide-ease), box-shadow var(--rdsh-slide-ms) var(--rdsh-slide-ease);
    will-change: transform; background: var(--dsw-alias-bg-base, #1b1b1d);
  }
  /* The lifted drawer is anchored to the viewport, not to whatever box the
     layout slot happened to have: it is a sheet, not a column. */
  [data-rdsh-drawer-layer] {
    position: fixed !important; inset: 0 auto 0 0 !important;
    left: 0; top: 0; bottom: 0;
    box-sizing: border-box;
    max-width: 86vw; height: 100dvh; min-height: 0 !important;
    z-index: 60; overflow: hidden;
    transform: translateX(-104%);
    transition: transform var(--rdsh-slide-ms) var(--rdsh-slide-ease), box-shadow var(--rdsh-slide-ms) var(--rdsh-slide-ease);
    will-change: transform;
    background: var(--dsw-alias-bg-base, #1b1b1d);
    pointer-events: auto;
  }
  /* The slot's own anchor is a display:contents wrapper, and the drawer that
     replaces it would otherwise inherit that from the wrapper it came out of
     (a slot keeps its data-slot attribute). The lift re-tags whatever the app
     renders, so this rule decides how that box is painted. */
  [data-rdsh-sidebar] { display: block !important; }
  /* The chat keeps the width the drawer used to take and never moves; a
     drawer that a layout re-renders still must not squeeze it. */
  [data-rdsh-sidebar-host] { width: 0 !important; min-width: 0 !important; padding: 0 !important; border: 0 !important; overflow: visible !important; }
  /* The drop shadow lifts the drawer off the chat. It was removed once as the
     suspected "dark thing sliding in from the left"; the real cause was the
     chat column collapsing to 0px, which let an empty 390px column cover the
     screen. With that fixed the shadow is safe, and the dimmed backdrop keeps
     it from being the only separation. */
  html[data-rdsh-drawer="open"] [data-rdsh-sidebar],
  html[data-rdsh-drawer="open"] [data-rdsh-drawer-layer] {
    transform: translateX(0);
    box-shadow: 24px 0 56px rgba(0,0,0,.5);
  }
  html[data-rdsh-drawer="open"] .rdsh-mux-backdrop { display: block; opacity: 1; pointer-events: auto; }
  .rdsh-mux-fab { display: flex; }
  html[data-rdsh-drawer="open"] .rdsh-mux-fab { display: none; }
  /* Where the host draws the phone drawer itself (its own header toggle and
     backdrop), this module's button and dimming have nothing left to do: it
     would sit on the header's toggle and dim under the host's own sheet. */
  html[data-rdsh-host-drawer] .rdsh-mux-fab { display: none !important; }
  html[data-rdsh-host-drawer] .rdsh-mux-backdrop { display: none !important; }

  /* The drawer's own header toggle is the app's icon button, not a dialog
     close. The reference paints it label-primary in every pointer state and
     drops the sticky hover tint, the Android tap flash and the delayed
     tooltip. The hook is written only inside this width query (and removed
     when the window widens), so a desktop gets the stock control back. */
  [data-rdsh-sidebar-toggle],
  [data-rdsh-sidebar-toggle]:is(:hover, :active, :focus) {
    color: var(--dsw-alias-label-primary) !important;
    background: transparent !important;
    -webkit-tap-highlight-color: transparent;
  }
  [data-rdsh-sidebar-toggle] * { -webkit-tap-highlight-color: transparent; }
  html:has([data-rdsh-sidebar-toggle]:is(:hover, :focus)) [role="tooltip"] { display: none !important; }


  /* The account row in the sidebar footer is replaced by the settings row
     inside the panel list, so the original row is hidden. */
  [data-rdsh-more-row] { display: none !important; }

  /* Mobile mode merges the App and Input tabs into Mobile (the section
     inlines them). This attribute is only written under phone(), so a
     desktop keeps all three tabs. */
  [data-rdsh-settings-tab-hidden] { display: none !important; }

  [data-rdsh-settings-nav-arrow] {
    position: fixed; z-index: 1006; width: 30px; height: 30px;
    display: grid; place-items: center; padding: 0;
    border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12)); border-radius: 50%;
    background: var(--dsw-alias-button-floating-fill, #fff); color: var(--dsw-alias-label-primary, #f9fafb);
    box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.08));
    -webkit-tap-highlight-color: transparent;
  }
  [data-rdsh-settings-nav-arrow][hidden] { display: none !important; }
  [data-rdsh-settings-nav-arrow]:hover { background: var(--dsw-alias-button-floating-hover, #f1f3f5); }
  [data-rdsh-settings-nav-arrow]:active { transform: scale(.94); }
  [data-rdsh-settings-nav-arrow] svg { width: 16px; height: 16px; }
  /* The stats dock (turns / tok/s / cache hit / context %) stays visible, but
     moves out of the composer's layout. The card can then sit in the safe-area
     strip instead of leaving a blank band below it, and the stats fill that
     strip. */
  html[data-rdsh-has-dock][data-rdsh-safe-bottom] #root { padding-bottom: 0 !important; }
  html[data-rdsh-has-dock] [data-rdsh-composer-root] {
    position: relative;
    padding-bottom: 31px !important; /* 27px dock + 4px */
  }
  [data-rdsh-composer-dock] {
    position: absolute !important;
    left: 16px; right: 16px; bottom: 4px;
    height: 27px; box-sizing: border-box;
    padding: 0 !important;
    align-items: center;
    z-index: 8;
    background: var(--dsw-alias-bg-base, #151517);
  }
  [data-rdsh-composer-dock] button {
    font-size: 11px !important;
    padding: 1px 2px !important;
    gap: 3px !important;
  }
  /* The app label includes steps / total tokens; show only the four requested
     values, with no ellipsis. */
  [data-rdsh-stat-text] > span { display: none !important; }
  [data-rdsh-stat-text]::after {
    content: attr(data-rdsh-stat-text);
    white-space: nowrap;
    font: inherit;
    color: inherit;
  }
  /* Three pills plus their icons stay on one row, centered inside the same
     16px gutters as the composer and transcript. */
  [data-rdsh-composer-dock] { gap: 2px !important; justify-content: center !important; }
  [data-rdsh-transcript] {
    padding-left: 16px !important;
    padding-right: 16px !important;
  }
  /* Use the available conversation width, including on tablets. */
  [data-rdsh-transcript-column] {
    width: 100% !important;
    max-width: 100% !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  /* Keep the reasoning effort (Max etc.) visible; only the model name shrinks. */
  [data-rdsh-model-button] [class*="triggerLabel"] {
    flex: 1 1 auto !important;
    min-width: 0 !important;
  }
  [data-rdsh-model-button] [class*="triggerEffort"] {
    flex: 0 0 auto !important;
    width: auto !important;
    max-width: none !important;
    min-width: auto !important;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  [data-chat-flow-kind="turn-tail"] [class*="_header"] {
    padding-top: 6px !important;
    padding-bottom: 6px !important;
  }
  [data-chat-flow-kind="turn-tail"] [class*="_row"] {
    padding-top: 4px !important;
    padding-bottom: 4px !important;
  }
  /* The app caps a user bubble at 70.2% of the row. A little more room and
     padding makes the query bubble easier to read without touching replies. */
  [data-rdsh-user-stack] { max-width: 78% !important; }
  @media (max-width: 380px) {
    [data-rdsh-composer-dock] { gap: 0 !important; }
    [data-rdsh-composer-dock] button { font-size: 10px !important; padding: 1px 2px !important; }
  }
  /* Overlay UI belongs on top of the drawer's own chrome, not across it. */
  html[data-rdsh-drawer="open"] .dsh-mobile-maxxing-install,
  html[data-rdsh-drawer="open"] .dsh-mobile-maxxing-card { display: none; }
  /* Keep the hamburger in place at z-index 40; the right panel overlays it at 60. */

  /* Sessions: give the label the room the row actions used to take. */
  [data-rdsh-session] { padding-inline: 6px !important; }
  [data-rdsh-session] [data-rdsh-session-title] { margin-right: 4px !important; }
  [data-rdsh-row-minor] { display: none !important; }
  [data-rdsh-status-empty] { display: none; }
  /* The chat column sizes its content from fixed pixel floors upstream
     (680px and friends), so on a 390px phone the transcript is wider than the
     column and gets clipped. Size it from the column instead. These custom
     properties are the app's own knobs for exactly that. */
  [data-rdsh-conversation] {
    --dsh-chat-user-width: 100% !important;
    --dsh-chat-content-width: 100% !important;
    --dsh-composer-card-max-width: 100% !important;
  }
  [data-rdsh-conversation] > * {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    overflow-x: clip;
  }

  /* Clear the floating drawer button.
     It sits at x:8 with a 40px width, so the title needs a 64px left inset;
     without it the crumb starts at 20px and runs under the button. This inset
     used to come from rdsh-mobile-ui, so a profile without that plugin drew
     the session name straight through the button. */
  [data-rdsh-header] { padding-left: 64px !important; }
  /* Full-screen routes (Plugins / Automation tasks) draw their own H1 at the
     page's 24px gutter. Move only that heading, not the row's right-side
     actions: margin affects the H1 box, while the wrapper's other children
     keep their position. */
  [data-rdsh-route-heading] > h1 { margin-left: 40px !important; }
  [data-rdsh-header] [class*="_titleCluster"] { min-width: 0; flex: 1 1 auto; }
  /* Pin the activity chips to the right edge of the header. Without this the
     actions block sits directly after the title, so a short session name drags
     both chips left with it. */
  [data-rdsh-header] [class*="_headerActions"] { margin-left: auto !important; }
  [data-rdsh-header] [class*="_crumbs"] { min-width: 48px; overflow: hidden; text-overflow: ellipsis; }
  [data-rdsh-session] [class*="_rowActions"] { display: flex; }
  /* Keep the row's own menu-open class in the exception list: without it the
     trigger is hidden while the portal measures it. */
  [data-rdsh-session]:not([aria-selected="true"]):not(:focus-within):not([class*="_menuOpen"]):not([data-rdsh-row-menu]) [class*="_rowActions"] { display: none; }

  /* Composer input dock (Todo, Goal, other pre-composer panels): 16px gutters. */
  [data-testid="todo-panel"],
  [class*="nLMEza_dock"],
  [data-slot="conversation.input.dock"] > * {
    width: calc(100% - 32px) !important;
    max-width: calc(100% - 32px) !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  [class*="nLMEza_bar"] { max-width: 100% !important; }

  [data-rdsh-session][data-rdsh-row-menu] [class*="_rowActions"] { display: flex !important; }

  /* The long press belongs to the row menu, not to the system: no text
     selection and no iOS callout ("Copy", "Look Up", …) while holding a row.
     The app sets user-select on the row itself, but not on its children, and
     never disables the callout. */
  [data-rdsh-session],
  [data-rdsh-session] * {
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-touch-callout: none !important;
  }

  /* Todo rows / goal objective open a full-text popover on tap. */
  [data-rdsh-todo-item],
  [data-rdsh-goal-objective] { cursor: pointer; }
  [data-rdsh-todo-item]:active,
  [data-rdsh-goal-objective]:active { opacity: .72; }

  /* Goal edit mode: stack save/cancel so the inline editor gets the width. */
  [data-rdsh-goal-editing] { align-items: stretch !important; }
  [data-rdsh-goal-editing] [data-rdsh-goal-actions] {
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 2px !important;
  }
  [data-rdsh-goal-editing] [data-rdsh-goal-actions] > * { flex: none !important; }

  /* Shell/subagent header chips: icon + the same live spinner ring, no text. */
  [data-rdsh-activity-chip] {
    position: relative !important;
    width: 30px !important; height: 30px !important; min-width: 30px !important;
    padding: 0 !important; border-radius: 50% !important;
    display: grid !important; place-items: center !important;
    gap: 0 !important;
    color: var(--dsw-alias-label-secondary, #9ca3af);
    -webkit-tap-highlight-color: transparent;
  }
  [data-rdsh-activity-chip]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
  [data-rdsh-activity-chip] > span:not([data-rdsh-activity-icon]):not([data-rdsh-activity-spinner]) { display: none !important; }
  [data-rdsh-activity-chip] > svg:not([data-rdsh-activity-spinner]) { display: none !important; }
  [data-rdsh-activity-chip] [data-rdsh-activity-spinner] {
    position: absolute !important; inset: 3px !important;
    width: 24px !important; height: 24px !important;
    margin: auto !important; pointer-events: none;
  }
  [data-rdsh-activity-chip] [data-rdsh-activity-spinner] svg { width: 100% !important; height: 100% !important; }
  [data-rdsh-activity-chip] [data-rdsh-activity-icon] {
    position: relative; z-index: 1; width: 13px; height: 13px;
    display: grid; place-items: center;
  }
  [data-rdsh-activity-chip] [data-rdsh-activity-icon] svg { width: 13px; height: 13px; }
  .rdsh-activity-ring {
    display: block; border: 1.6px solid var(--dsw-alias-link, #7aaaff);
    border-radius: 50%;
    animation: none;
  }
  /* Only a running projection turns. A completed chip keeps the same ring,
     static and fully link, so it never looks busy again (#40, #57). The
     chip's own icon stays secondary: the ring carries the activity, not the
     idle label. */
  [data-rdsh-activity-chip][data-rdsh-activity-running] .rdsh-activity-ring {
    border-color: var(--dsw-alias-border-l3, rgba(0,0,0,.12));
    border-top-color: var(--dsw-alias-link, #7aaaff);
    animation: rdsh-activity-spin 1s linear infinite;
  }
  @keyframes rdsh-activity-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    /* The running ring already differs by its hollow track; no motion needed. */
    [data-rdsh-activity-chip][data-rdsh-activity-running] .rdsh-activity-ring { animation: none; }
  }

  /* Settings: full screen, stacked navigation, nothing narrowed. */
  /* Close lives on the top row with the Settings title, as a round button. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_close"] {
    position: fixed !important;
    top: calc(env(safe-area-inset-top, 0px) + 12px) !important;
    right: calc(env(safe-area-inset-right, 0px) + 12px) !important;
    width: 36px !important; height: 36px !important;
    padding: 0 !important;
    display: grid !important; place-items: center !important;
    border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12)) !important;
    border-radius: 50% !important;
    background: var(--dsw-alias-button-floating-fill, #fff) !important;
    color: var(--dsw-alias-label-primary) !important;
    box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.08));
    z-index: 1007 !important;
  }
  [data-shortcut-modal="settings"] [class*="VOzbGW_close"]:hover { background: var(--dsw-alias-button-floating-hover, #f1f3f5) !important; }
  [data-shortcut-modal="settings"] [class*="VOzbGW_close"] svg { width: 18px !important; height: 18px !important; }

  /* Tab names fade toward a scrollable edge, so the floating arrows never
     sit on top of a hard-cut label. The flags are set by positionSettingsArrows. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_navList"][data-rdsh-fade-left] {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 64px);
    mask-image: linear-gradient(to right, transparent 0, #000 64px);
  }
  [data-shortcut-modal="settings"] [class*="VOzbGW_navList"][data-rdsh-fade-right] {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 72px), transparent 100%);
    mask-image: linear-gradient(to right, #000 calc(100% - 72px), transparent 100%);
  }
  [data-shortcut-modal="settings"] [class*="VOzbGW_navList"][data-rdsh-fade-left][data-rdsh-fade-right] {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 64px, #000 calc(100% - 72px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 64px, #000 calc(100% - 72px), transparent 100%);
  }

  /* The settings panel is fully opaque on a phone; the blurred mask was the
     source of the iOS flash on each tab repaint. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_mask"] {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  [data-shortcut-modal="settings"],
  [data-shortcut-modal="settings"] [class*="VOzbGW_options"] {
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
  }

  [data-shortcut-modal="settings"] {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    max-width: none !important;
    height: 100% !important;
    max-height: none !important;
    border-radius: 0 !important;
    box-sizing: border-box !important;
    flex-direction: column;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    /* #59: the sheet is viewport-anchored, so it pads the notch sides itself. */
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }
  [data-shortcut-modal="settings"] > nav {
    width: 100%; padding: 16px 12px 0; gap: 8px;
    border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));
  }
  [data-shortcut-modal="settings"] > nav > div:last-child {
    flex-direction: row; overflow-x: auto; overflow-y: hidden; gap: 6px;
    margin-top: 10px; padding-bottom: 10px;
    scrollbar-width: none;
    border-top: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));
  }
  [data-shortcut-modal="settings"] > nav > div:last-child::-webkit-scrollbar { display: none; }
  [data-shortcut-modal="settings"] > nav > div:last-child button { flex: none; }
  [data-shortcut-modal="settings"] > nav + div { min-height: 0; }
  /* The close is fixed to the title row now; the old header row only held
     "Open configuration file" (a desktop action). Collapse it so the content
     begins directly at the tab strip. Tied to the hide list: with "stop
     hiding" the header (and that action) comes back, which is also how the
     debug switch can be checked. A desktop has no
     data-rdsh-hide-settings, so it keeps the stock header (#17). */
  html[data-rdsh-hide-settings] [data-shortcut-modal="settings"] > nav + div > div:first-child {
    height: 0 !important; min-height: 0 !important; padding: 0 !important;
    overflow: visible;
  }
  html[data-rdsh-hide-settings] [data-shortcut-modal="settings"] > nav + div > div:first-child [class*="VOzbGW_actions"] { display: none !important; }
  [data-shortcut-modal="settings"] > nav + div > div:last-child { padding: 0 12px 16px; }

  /* Settings: theme tiles side by side, never crushed. */
  [data-shortcut-modal="settings"] [class*="_8HJdBW_group"] { align-items: stretch !important; }
  [data-shortcut-modal="settings"] [class*="_8HJdBW_cubeRow"] {
    flex-direction: row !important; flex-wrap: nowrap !important;
    height: auto !important; align-items: stretch !important; gap: 8px !important;
  }
  [data-shortcut-modal="settings"] [class*="_8HJdBW_cubeRow"] > * {
    flex: 1 1 0 !important; width: auto !important; min-width: 0 !important;
    height: auto !important; min-height: 88px !important;
    padding: 12px 6px !important; box-sizing: border-box !important;
  }
  [data-shortcut-modal="settings"] [class*="_8HJdBW_cubeRow"] > * > * { max-width: 100%; }

  /* Rows matched by the hide list are hidden by
     html[data-rdsh-hide-settings] [data-rdsh-setting-hidden] above. There is
     deliberately no blanket rule over upstream row classes: it hid whole
     groups regardless of their label, which is what #17 reported. */

  /* Settings: no accidental horizontal scrolling in tab panels. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_options"] {
    overflow-x: hidden !important;
    scrollbar-gutter: stable;
  }
  [data-shortcut-modal="settings"] [class*="rtSEdW_section"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_group"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_cards"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_card"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_cardFoot"] {
    min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important;
  }
  [data-shortcut-modal="settings"] [class*="rtSEdW_cardFoot"] { flex-wrap: wrap !important; overflow: hidden; }
  [data-shortcut-modal="settings"] [class*="rtSEdW_iconButton"] { overflow: hidden; }

  /* Settings > Models: shrink provider names, never collide with actions. */
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowCard"] { min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowHead"] { min-width: 0 !important; gap: 8px !important; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowIdentity"] { min-width: 0 !important; overflow: hidden; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowName"] { min-width: 0 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowActions"] { flex-shrink: 0; gap: 6px; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowActions"] button { padding-left: 10px !important; padding-right: 10px !important; }

  /* Model picker: value never runs into the chevron. */
  [class*="_7KE1Ra_menu"] { max-width: calc(100vw - 24px) !important; box-sizing: border-box !important; }
  [class*="_7KE1Ra_cell"] { min-width: 0 !important; gap: 8px !important; }
  [class*="_7KE1Ra_cell"] > span:last-of-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  [data-rdsh-model-search]:disabled { opacity: 1 !important; cursor: text; }

  /* Agent question / plan review card: use the same 16px gutter and 349px
     column as the transcript, centred. max-width: 349px rather than a fixed
     width keeps it inside a viewport narrower than 349px. */
  [data-rdsh-question-frame] {
    /* The card is sized from the viewport, not the transcript's 349px
       column: 16px on each side is the same gutter as the composer. */
    box-sizing: border-box !important;
    width: 100% !important;
    max-width: 100% !important;
    justify-content: flex-start !important;
    padding-left: 16px !important; padding-right: 16px !important;
    padding-bottom: 10px !important;
    overflow-x: visible !important;
  }
  [data-rdsh-question-frame] > [data-rdsh-question-card] {
    flex: 0 0 auto !important;
    position: relative !important;
    width: calc(100vw - 32px) !important;
    max-width: calc(100vw - 32px) !important;
    margin-left: 0 !important; margin-right: 0 !important;
  }
  /* Each option row is a tile: a hairline plus a radius separates the rows
     without changing their hit area or padding. */
  [data-rdsh-question-card] [data-rdsh-question-tile] {
    border: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16)) !important;
    border-radius: 10px !important;
    background: var(--dsw-alias-bg-module-platform, rgba(255,255,255,.02));
  }
  [data-rdsh-question-card] [class*="_options"] { gap: 6px !important; }
  /* A down chevron bubble for a scrollable question body. It follows the
     Settings-tab arrow look, but sits over the card and disappears at the
     end of the scroll. */
  [data-rdsh-question-arrow] {
    position: absolute !important;
    right: 12px; bottom: 56px; z-index: 6;
    width: 30px; height: 30px; padding: 0;
    display: grid; place-items: center;
    border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
    border-radius: 50%;
    background: var(--dsw-alias-button-floating-fill, #fff);
    color: var(--dsw-alias-label-primary, #1b1b1d);
    box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.18));
    opacity: .78; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: opacity .12s ease, transform .12s ease;
  }
  [data-rdsh-question-arrow]:hover,
  [data-rdsh-question-arrow]:focus-visible { opacity: 1; transform: scale(1.04); }
  [data-rdsh-question-arrow]:active { transform: scale(.94); }
  [data-rdsh-question-arrow][hidden] { display: none !important; }
  [data-rdsh-question-arrow] svg { width: 15px; height: 15px; }
  /* Only the queue's lower corner join is layered over the composer. */
  [data-rdsh-queue-dock] {
    /* Layered over the composer so the queue's straight bottom edge crosses
       the card's top fillets instead of leaving them cut: this is the join
       the reference screenshot shows. */
    position: relative !important;
    z-index: 1 !important;
    overflow: visible !important;
    /* Same width as the composer card: the percentage resolves against the
       composer stack, which is exactly 32px wider than the card. */
    width: calc(100% - 32px) !important;
    max-width: none !important;
    margin-left: auto !important;
    margin-right: auto !important;
    /* The composer stack is a flex column whose gap is 6px in a session and
       8px in the hero, so any fixed margin leaves a band of background. The
       dock measures the live seam and writes the margin inline instead. */
    margin-bottom: 0;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  [data-rdsh-queue-panel] {
    position: relative !important;
    z-index: 1 !important;
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
  }
  [data-rdsh-queue-join] {
    display: block !important;
    overflow: visible !important;
    pointer-events: none !important;
  }
  .rdsh-mux-queue-preview {
    position: fixed; left: 16px; right: 16px; z-index: 985;
    box-sizing: border-box; padding: 12px 14px;
    max-height: min(50vh, 360px); overflow-y: auto;
    border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
    border-radius: 12px;
    background: var(--dsw-alias-bg-layer-2, #2c2c2e);
    color: var(--dsw-alias-label-primary, #f9fafb);
    box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.35));
    font-size: 14px; line-height: 1.55;
    white-space: pre-wrap; overflow-wrap: anywhere;
    -webkit-overflow-scrolling: touch;
  }
  .rdsh-mux-queue-menu {
    position: fixed; z-index: 990; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 1px; padding: 6px;
    border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
    border-radius: 12px;
    background: var(--dsw-alias-bg-layer-2, #2c2c2e);
    color: var(--dsw-alias-label-primary, #f9fafb);
    box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.35));
  }
  .rdsh-mux-queue-menu button {
    width: 100%; min-height: 38px; padding: 6px 10px;
    border: 0; border-radius: 8px; background: transparent;
    color: inherit; font: inherit; font-size: 13px; text-align: left;
  }
  .rdsh-mux-queue-menu button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
  .rdsh-mux-queue-menu button:disabled { opacity: .45; }
  /* New-session workspace picker: a search row, a bounded item viewport and
     the upstream Add workspace footer outside that viewport. */
  [data-rdsh-workspace-menu] { max-height: min(70vh, 520px) !important; overflow: hidden !important; }
  [data-rdsh-workspace-menu] [data-rdsh-workspace-viewport] {
    max-height: min(40vh, 320px) !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  [data-rdsh-workspace-menu] [data-rdsh-workspace-hidden] { display: none !important; }
  .rdsh-mux-workspace-search {
    flex: none; box-sizing: border-box; padding: 6px 0;
    border-bottom: .5px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1));
    background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  }
  .rdsh-mux-workspace-search input {
    display: block; box-sizing: border-box; width: 100%; height: 32px;
    margin: 0; padding: 0 8px; border-radius: 8px;
    border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
    background: var(--dsw-alias-bg-base, #1b1b1d);
    color: var(--dsw-alias-label-primary, #f9fafb);
    font: inherit; font-size: 16px; line-height: 20px;
    outline: none;
  }
  .rdsh-mux-workspace-search input:focus-visible {
    border-color: var(--dsw-alias-state-business-primary, #4d6bfe);
    /* The field spans the menu edge, so keep the ring inside the clip. */
    outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));
    outline-offset: -2px;
  }
  .rdsh-mux-workspace-empty {
    padding: 14px 12px; color: var(--dsw-alias-label-tertiary, #adb2b8);
    font-size: 13px;
  }
  /* Right-panel file tree: a long press must not select text or raise the
     iOS callout, and the explicit search row sits between the header and the
     scrolling body. Both are phone-only. */
  [data-rdsh-files-tree] [data-files-entry],
  [data-rdsh-files-tree] [data-files-entry] *,
  [data-rdsh-files-root-path],
  [data-rdsh-files-root-path] * {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  [data-rdsh-files-hidden] { display: none !important; }
  .rdsh-mux-files-search {
    flex: none; box-sizing: border-box; display: flex; flex-direction: column;
    background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  }
  .rdsh-mux-files-search-row {
    display: flex; align-items: center; gap: 6px; padding: 6px 4px;
    border-bottom: .5px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1));
  }
  .rdsh-mux-files-search input {
    min-width: 0; flex: 1; box-sizing: border-box; height: 32px;
    margin: 0; padding: 0 8px; border-radius: 8px;
    border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
    background: var(--dsw-alias-bg-base, #1b1b1d);
    color: var(--dsw-alias-label-primary, #f9fafb);
    font: inherit; font-size: 16px; line-height: 20px;
    outline: none;
  }
  .rdsh-mux-files-search input:focus-visible {
    border-color: var(--dsw-alias-state-business-primary, #4d6bfe);
    outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));
    outline-offset: 0;
  }
  .rdsh-mux-files-search button {
    flex: none; box-sizing: border-box; width: 32px; height: 32px;
    padding: 0; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
    background: var(--dsw-alias-button-elevated-fill, rgba(255,255,255,.08));
    color: var(--dsw-alias-label-primary, #f9fafb);
    font: inherit; font-size: 15px; line-height: 1;
  }
  .rdsh-mux-files-empty {
    padding: 10px 12px; color: var(--dsw-alias-label-tertiary, #adb2b8);
    font-size: 13px;
  }
  .rdsh-mux-files-menu {
    position: fixed; z-index: 990; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 1px; padding: 6px;
    border: .5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
    border-radius: 12px;
    background: var(--dsw-alias-bg-layer-2, #2c2c2e);
    color: var(--dsw-alias-label-primary, #f9fafb);
    box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.35));
  }
  .rdsh-mux-files-menu button {
    width: 100%; min-height: 38px; padding: 6px 10px;
    border: 0; border-radius: 8px; background: transparent;
    color: inherit; font: inherit; font-size: 14px; text-align: left;
  }
  .rdsh-mux-files-menu button:focus-visible {
    outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));
    outline-offset: -2px;
  }
  /* CSS Custom Highlight: painted over the upstream text nodes, no DOM edit. */
  ::highlight(rdsh-files-search) {
    background-color: var(--dsw-alias-state-business-secondary, rgba(77,107,254,.35));
    color: inherit;
  }
  /* Direct children only. [class*="_header"] also matches _headerActions,
     [class*="_footer"] matches _footerActions and [class*="_option"] matches
     _optionCopy / _optionLine / _optionLabel, so plain descendant selectors
     stacked the same padding four levels deep and inflated the card (one
     option row 66px → 114px). */
  [data-rdsh-question-card] > [class*="_header"] { padding: 12px 12px 0 16px !important; }
  [data-rdsh-question-card] > [class*="_strip"] { padding: 10px 12px !important; }
  [data-rdsh-question-card] > [class*="_summary"] { padding: 12px 16px !important; }
  [data-rdsh-question-card] > [class*="_footer"] { padding: 8px 10px 10px !important; }
  [data-rdsh-question-card] [class*="_options"] { padding: 4px 8px !important; }
  [data-rdsh-question-card] [class*="_options"] > button[class*="_option"],
  [data-rdsh-question-card] [class*="_options"] > [class*="_customRow"] { padding: 8px !important; }
  [data-rdsh-question-card] [class*="_customBlock"] { margin-left: 8px !important; margin-right: 8px !important; }
  /* The answer field takes its height from a hidden mirror, so both layers
     must share the font size (16px here stops iOS from zooming on focus). */
  [data-rdsh-question-card] [class*="_field"] > * { font-size: 16px !important; }
  /* The card clips its overflow, so a long unbroken token used to be cut. */
  [data-rdsh-question-card] [class*="_optionLabel"],
  [data-rdsh-question-card] [class*="_title"],
  [data-rdsh-question-card] [class*="_description"] { overflow-wrap: anywhere; }

  /* iOS zooms any focused field below 16px; this is a PWA and needs no zoom.
     The width-based text inflation is the second half of the same problem: it
     enlarges the text in landscape, which changes the effect size iOS measures
     on focus, so a 16px field on a wide phone can still zoom. Both are pinned
     for every field this surface can focus, including the ones the upstream
     composer styles itself (the contenteditable carries no font-size of its
     own; it inherits a 14px card). */
  html, body { touch-action: manipulation; }
  html {
    -webkit-text-size-adjust: 100% !important;
    text-size-adjust: 100% !important;
  }
  input, textarea, [contenteditable="true"],
  [data-composer-input],
  [data-composer-card] [contenteditable] {
    font-size: 16px !important;
    -webkit-text-size-adjust: 100% !important;
    text-size-adjust: 100% !important;
    touch-action: manipulation;
  }
  /* A page that is still magnified reports it here. releaseFocusZoom() centres
     the field the user is typing into, so the zoom cannot leave them looking
     at a corner of the page instead of the caret. */
  html[data-rdsh-focus-zoom] body { overflow: hidden; }
  /* The bundled xterm 6.0 has no touch path and scrolls only on wheel events,
     so the JS bridge owns the gesture. Keep the browser from claiming the drag
     as a pan/zoom before the touchmove handler sees it. (This alone cannot
     make the terminal scroll: there is no scrollable node behind it.) */
  .xterm, .xterm .xterm-screen, .xterm .xterm-scrollable-element { touch-action: none; }

  /* Edit summary: tighter rows. */
  [data-rdsh-edit-header] { height: 44px !important; min-height: 44px !important; padding: 4px 10px !important; }
  [data-rdsh-edit-row] { height: 26px !important; padding-top: 2px !important; padding-bottom: 2px !important; }

  /* Right panel: never wider than the phone, wide tables scroll inside it. */
  [data-rdsh-rightpanel] {
    max-width: 100vw !important; overflow-x: hidden;
    /* #46: a stacking context of its own, without touching upstream's
       absolute positioning on the panel root (rewriting it would pull the
       fullscreen sheet into flow). The column and that root are raised below;
       this layer only has to stay in the sheet's own context. */
    isolation: isolate;
    box-sizing: border-box;
    /* #59: the sheet is viewport-anchored. A zero top put the tab strip and the
       path under the status bar, and the sides ran under a landscape notch. */
    padding-top: env(safe-area-inset-top, 0px) !important;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--rdsh-native-gap-px, 0px)) !important;
    padding-left: env(safe-area-inset-left, 0px) !important;
    padding-right: env(safe-area-inset-right, 0px) !important;
  }
  /* The preview's close control is drawn as a panel glyph, which reads as
     "collapse this pane" rather than "leave the preview". Swap it for an X,
     the same glyph the tab close buttons already use. */
  [data-rdsh-rightpanel] [aria-label="Collapse right sidebar"] svg,
  [aria-label="Collapse right sidebar"] svg { display: none !important; }
  [aria-label="Collapse right sidebar"]::before {
    content: ""; width: 16px; height: 16px; display: block;
    background: currentColor;
    -webkit-mask: var(--rdsh-close-mask) center / contain no-repeat;
    mask: var(--rdsh-close-mask) center / contain no-repeat;
  }
  html { --rdsh-close-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4' stroke='black' stroke-width='1.7' stroke-linecap='round'/></svg>"); }

  /* #46: the preview sheet covers the header; the header itself stays in
     flow. Hiding it removed the header from layout (the chat jumped up by the
     header height on open and back on close). Raise the panel's positioned
     column and its upstream root above the header instead of rewriting the
     sheet's own position, so the header's rect is identical open or closed. */
  [data-rdsh-frame] [data-rdsh-rightbar-col] { z-index: 60; }
  [data-rdsh-frame] [data-sidebar-right-panel] { z-index: 60; }
  [data-rdsh-rightpanel] table { display: block; overflow-x: auto; max-width: 100%; }
  [data-rdsh-rightpanel] pre { max-width: 100%; }

  /* Right panel tabs (dockkit's file/preview strip).
     The reference build leaves their dimensions and hover affordances to
     upstream (28px rows, hover-only close). The tap replay in the pointer
     handlers is kept, but it must not restyle the tab strip.
     dockkit sets touch-action: none on the tab, the strip and the scroller
     because a finger drag is its reorder gesture. touch-action is the
     intersection along every ancestor up to the scroll container, so all
     layers must allow native panning. The browser owns scrolling and inertia;
     only a held tab cancels touchmove for reordering. */
  [data-sidebar-right-panel] [data-dockkit-strip],
  [data-sidebar-right-panel] [data-dockkit-strip-tabs],
  [data-sidebar-right-panel] [data-dockkit-strip-fill],
  [data-sidebar-right-panel] [data-dockkit-tab] { touch-action: pan-x pan-y; }
  /* A long press must reach the reorder gate, not start a selection/callout. */
  [data-rdsh-rtab] {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  /* The hold lifts the tab without changing its box: dockkit measures tab
     rects to choose a drop index, so no transform here. */
  [data-rdsh-rtab][data-rdsh-tab-hold] {
    position: relative;
    z-index: 3;
    opacity: .92;
    box-shadow: var(--dsw-elevation-prominent, 0 2px 8px rgba(0, 0, 0, .28));
  }

  /* Code files: wrap every line, including a single long token (URLs,
     minified lines). Wrapping only at spaces left those overflowing, which
     turned the viewer into a free two-axis scroller.
     The lines are their own boxes: .line carries
     "white-space: var(--dsl-code-block-line-white-space, pre)", so styling
     pre alone left them unwrapped (and the horizontal lock clipped them). */
  /* Do NOT style the code element: the newline text nodes between the .line
     spans live there, and giving them pre-wrap painted an empty row between
     every line (19px -> 38px). The lines carry their own content. */
  [data-rdsh-rightpanel] [data-textpreview-body] pre,
  [data-rdsh-rightpanel] [data-textpreview-body] pre .line {
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    word-break: break-word !important;
  }
  /* ...and the code scroller itself keeps no sideways travel. */
  [data-rdsh-code-scroll] { overflow-x: hidden !important; }
  /* Wrapping is forced above, so the viewer's own toggle no longer changes
     anything. Hide it rather than leave a control that does nothing. */
  [data-rdsh-rightpanel] [data-textpreview-tool="wrap"] { display: none !important; }

  /* #33: the host's native "open in <app>" split button. The wrapper carries
     data-open-target and both halves carry data-open-path-*; hiding it takes
     the dead half, the chevron and the missing-label case together. Only the
     native target, not browser preview controls in the same header. */
  [data-open-target] { display: none !important; }

  /* #35: the phone header keeps the path and the viewer picker visible. Every
     other action is offered by the kebab, which calls the original button. */
  [data-rdsh-preview-header] [data-rdsh-preview-secondary] { display: none !important; }

  /* #34: long unbroken tokens wrap only while upstream's own wrap state says
     ON. With wrap OFF (a user's explicit choice) the stock horizontal travel
     stays, so this rule cannot override that choice. */
  [data-rdsh-rightpanel] [data-changes-review] [data-review-wrap] [data-diff-line],
  [data-rdsh-rightpanel] [data-changes-review] [data-review-wrap] [data-diff-code] {
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    word-break: break-word !important;
  }

  /* Two controls in the panel header duplicate what the phone already is or
     cannot do: "Exit fullscreen" closes the panel exactly like the ✕ next to
     it, and "Split" needs width the phone does not have. Keep only the ✕. */
  [data-rdsh-rightpanel] [aria-label="Exit fullscreen"],
  [data-rdsh-rightpanel] [aria-label="Split"] { display: none !important; }

  /* The native strip already contains the home indicator. */
  html[data-rdsh-native-gap] [data-rdsh-sidebar],
  html[data-rdsh-native-gap] [data-rdsh-rightpanel],
  html[data-rdsh-native-gap] [data-shortcut-modal="settings"] { padding-bottom: 0 !important; }
/* Safe-area insets measured at runtime: the attributes/style this module
   writes are mobile-only (#44) and releaseSafeArea() strips them on dispose.
   The values themselves come from env() so a notched phone still draws under
   the status bar. */
html[data-rdsh-safe-top] #root { box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px); }
html[data-rdsh-safe-bottom] #root { box-sizing: border-box; padding-bottom: env(safe-area-inset-bottom, 0px); }
/* #59: a landscape notch lands on the left or the right. The header, the
   transcript and the composer are in flow inside #root, so these two rules are
   what keeps them out of the camera housing; the fixed layers carry their own
   insets because padding on #root cannot reach them. */
html[data-rdsh-safe-left] #root { box-sizing: border-box; padding-left: env(safe-area-inset-left, 0px); }
html[data-rdsh-safe-right] #root { box-sizing: border-box; padding-right: env(safe-area-inset-right, 0px); }
/* iOS 26 standalone native gap: the home indicator is in the unpainted strip
   below the web view, so an inner bottom safe-area pad only widens the blank. */
html[data-rdsh-native-gap][data-rdsh-safe-bottom] #root { padding-bottom: 0 !important; }

/* #35: the kebab and its menu. The kebab is only ever created inside the
   phone query by decoratePreviewTools; the wide desktop has no node. */
.rdsh-mux-preview-kebab {
  flex: none; box-sizing: border-box; width: 30px; height: 30px;
  margin-left: 2px; padding: 0; border: 0; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-secondary, #cfd3d6);
  background: transparent; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.rdsh-mux-preview-kebab:hover,
.rdsh-mux-preview-kebab[aria-expanded="true"] {
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));
}
.rdsh-mux-preview-kebab:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #7aaaff);
  outline-offset: 1px;
}
.rdsh-mux-preview-kebab svg { fill: currentColor; }
.rdsh-mux-preview-menu {
  position: fixed; z-index: 995; box-sizing: border-box;
  padding: 6px; border-radius: 12px;
  display: flex; flex-direction: column; gap: 2px;
  background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  box-shadow: var(--dsw-elevation-prominent, 0 14px 40px rgba(0,0,0,.3));
}
.rdsh-mux-preview-menu button {
  box-sizing: border-box; width: 100%; min-height: 40px;
  margin: 0; padding: 8px 10px; border: 0; border-radius: 8px;
  display: block; text-align: left; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; font: inherit; font-size: 14px;
  color: var(--dsw-alias-label-primary, #f9fafb); background: transparent;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.rdsh-mux-preview-menu button:hover,
.rdsh-mux-preview-menu button:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));
  outline: none;
}
.rdsh-mux-preview-menu button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #7aaaff);
  outline-offset: -2px;
}
.rdsh-mux-preview-menu button[disabled] {
  color: var(--dsw-alias-label-tertiary, #a1a1aa);
  cursor: default;
}

`;

    // The device half is always present. The mobile half is inserted as its
    // own stylesheet only when the host bootstrap selected "mobile"; there is
    // no width wrapper and a resize never adds or removes it. Sizing tweaks
    // that genuinely need a breakpoint stay inside CSS_PHONE (the 380px
    // composer rule is the only one today).
    const CSS = CSS_DEVICE;

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------
    let booted = false;

    function boot(ctx) {
      if (booted) return;
      booted = true;
      hostCtx = ctx;

      ctx.effect(() => {
        live = true;
        const style = document.createElement("style");
        style.setAttribute("data-rdsh-mux-style", "device");
        style.textContent = CSS;
        document.head.append(style);
        // The mobile surface is enabled by the bootstrapped mode, not by the
        // viewport: a 1024px iPad gets this sheet, a 390px desktop does not.
        let phoneStyle = null;
        if (phone()) {
          phoneStyle = document.createElement("style");
          phoneStyle.setAttribute("data-rdsh-mux-style", "phone");
          phoneStyle.textContent = CSS_PHONE;
          document.head.append(phoneStyle);
        }

        // #44: the drawer nodes and the animation attribute belong to the
        // mobile surface. A desktop boot injects neither; a mobile boot
        // installs them once and a resize never tears them down.
        if (phone()) {
          installDrawer();
          // The route-back slot shares the drawer button's corner; created in
          // the same mobile-only branch so a desktop has no injected node.
          installRouteBack();
          document.documentElement.setAttribute("data-rdsh-anim", ANIMATION);
        } else {
          clearPhoneHooks();
        }

        const observer = new MutationObserver(scheduleDecorate);
        // `data-sidebar-collapsed` / `data-rightbar-collapsed` are upstream's
        // own open/close signals on the app frame. They change without a
        // resize when the user toggles a sidebar, so without them the drawer
        // and right-panel state only caught up on the next unrelated mutation.
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "aria-selected", "data-state", "draggable", "data-sidebar-collapsed", "data-rightbar-collapsed"] });

        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("focusout", onModelFocusOut, true);
        document.addEventListener("pointerup", onPointerUp, true);
        document.addEventListener("pointercancel", onPointerCancel, true);
        document.addEventListener("mousedown", onMouseDownCapture, true);
        document.addEventListener("click", onClickCapture, true);
        // Phone-only tree long-press and search listeners; installed here so
        // the teardown below can remove exactly one set.
        if (phone()) installWorkspaceTools();
        // Window capture runs before the app's document-level key adapter. That
        // adapter treats a keyCode 229 Return as IME input and consumes it, so a
        // listener on document never gets the chance to insert a newline.
        window.addEventListener("keydown", onKeyDownCapture, true);
        // Notifications: the worker hands a payload here when a window is on
        // screen, and reports a tap the same way. `?session=` covers the cold
        // start, where no worker message can arrive before the page renders.
        navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
        const bootSession = sessionFromUrl();
        if (bootSession !== "") requestSession(bootSession);
        document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
        document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
        measureSafeArea();
        // A rotation changes both the query and the geometry, and iOS reports
        // the new safe-area insets a frame or two after the event. Re-measure
        // and decorate twice: once now (so the drawer/button state follows the
        // new width) and once after the transition has settled.
        //
        // Gestures are dropped only when the width really changed or on
        // orientationchange; a desktop has none. A keyboard or a collapsing
        // URL bar changes the height alone and must not cancel a swipe that is
        // already in flight; the legacy handler did not reset at all.
        let rotationTimer = 0;
        let gestureWidth = window.innerWidth;
        // Geometry/keyboard work belongs to the mobile surface. A desktop
        // resize only updates the Settings width readout via the media query;
        // it never measures insets, decorates or fits mobile chrome.
        const onLayoutResize = () => {
          if (!phone()) return;
          // Do not close the attach sheet here: opening it blurs the composer,
          // and the resulting keyboard-close resize would remove it instantly.
          measureSafeArea();
          scheduleDecorate();
          clearTimeout(rotationTimer);
          rotationTimer = window.setTimeout(() => {
            measureSafeArea();
            scheduleDecorate();
            scheduleTerminalFit();
          }, 350);
          // The keyboard inset has already changed when this runs; fit the
          // terminal (if one is open) on the same coalesced frame.
          scheduleTerminalFit();
        };
        const onResize = () => {
          if (window.innerWidth !== gestureWidth) {
            gestureWidth = window.innerWidth;
            resetGestures();
          }
          onLayoutResize();
        };
        const onOrientation = () => {
          gestureWidth = window.innerWidth;
          if (!phone()) return;
          resetGestures();
          onLayoutResize();
        };
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onOrientation);
        // The visual viewport reports the keyboard and the rotation's own
        // resize; without it an iPhone keyboard can leave the layout sized for
        // the covered viewport. It must not reset gestures: it fires for
        // height-only changes during a swipe.
        window.visualViewport?.addEventListener("resize", onLayoutResize);
        // The visual viewport can move without resizing (the browser scrolls a
        // focused field above the keyboard); both events share the rAF fit.
        window.visualViewport?.addEventListener("scroll", onLayoutResize);
        // A focus zoom changes the visual viewport's width in both of its
        // phases: the zoom itself and the scrolled-away page after it. Recover
        // from that on the same two events, before any of the geometry work.
        const onFocusZoom = () => {
          if (!phone()) return;
          releaseFocusZoom();
          onLayoutResize();
        };
        window.visualViewport?.addEventListener("resize", onFocusZoom);
        window.visualViewport?.addEventListener("scroll", onFocusZoom);
        patchCommandUi(ctx);
        document.addEventListener("dragstart", onDragStartCapture, true);
        document.addEventListener("dragend", onDragEndCapture, true);
        document.addEventListener("dblclick", onSessionTitleDoubleClick, true);
        document.addEventListener("contextmenu", onSessionContextMenu, true);
        document.addEventListener("touchstart", onEdgeSwipeStart, true);
        document.addEventListener("touchmove", onEdgeSwipeMove, { capture: true, passive: false });
        document.addEventListener("touchend", onEdgeSwipeEnd, true);
        document.addEventListener("touchcancel", onEdgeSwipeEnd, true);
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("pointerdown", onFocusPointer, true);
        document.addEventListener("focusin", onFocusInGuard, true);
        if (phone()) {
          const initial = textBoxOf(document.activeElement);
          if (initial !== null) setTimeout(() => { if (document.activeElement === initial) initial.blur(); }, 0);
        }
        const media = window.matchMedia(NARROW_QUERY);
        // Width is geometry only. Crossing 767px updates the readout and, on a
        // mobile device, re-measures the new geometry; it never installs or
        // tears down the mobile surface and never changes the mode.
        const applyWidthBoundary = () => {
          emit({ narrow: narrow() });
          if (!phone()) return;
          resetGestures();
          measureSafeArea();
          scheduleDecorate();
        };
        const onMedia = () => {
          applyWidthBoundary();
        };
        media.addEventListener("change", onMedia);

        scheduleDecorate();
        void refreshNotificationStatus();

        globalThis.__RDSH_MOBILE_UX__ = {
          get state() { return { ...state }; },
          get badgeCount() { return notificationTotal; },
          applyNotificationCount,
          readDeviceTheme,
          writeDeviceTheme,
          applyDeviceTheme,
          build: BUILD,
          lang: currentLang(),
          autoSettings: true,
          decorate: scheduleDecorate,
          // Re-reads the window width for the Settings readout and re-measures
          // mobile geometry. It cannot change the device mode.
          syncWidth: applyWidthBoundary,

          // Diagnostics used by the unit tests: the bootstrapped mode, the
          // layout predicate and the restored scroll hooks are observable
          // without a browser.
          get mode() { return DEVICE_MODE; },
          // Diagnostics used by the unit tests: the layout predicate and the
          // restored scroll hooks have to be observable without a browser.
          decorateNow: decorate,
          phone,
          markMobileSession,
          closeDrawer,
          openDrawer: toggleDrawer,
          enableNotifications,
          sendTestNotification,
        };

        return () => {
          try {
            observer.disconnect();
            unwatchActivitySources();
            contextRefreshFor = null;
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("pointerup", onPointerUp, true);
            document.removeEventListener("pointercancel", onPointerCancel, true);
            cancelStripPan();
            document.removeEventListener("mousedown", onMouseDownCapture, true);
            document.removeEventListener("click", onClickCapture, true);
            window.removeEventListener("keydown", onKeyDownCapture, true);
            document.removeEventListener("touchstart", onTouchStart, true);
            document.removeEventListener("touchmove", onTouchMove, true);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("orientationchange", onOrientation);
            window.visualViewport?.removeEventListener("resize", onLayoutResize);
            window.visualViewport?.removeEventListener("scroll", onLayoutResize);
            clearTerminalFit();
            resetGestures();
            clearTimeout(rotationTimer);
            clearTimeout(sendSettleTimer);
            document.removeEventListener("dragstart", onDragStartCapture, true);
            document.removeEventListener("dragend", onDragEndCapture, true);
            document.removeEventListener("dblclick", onSessionTitleDoubleClick, true);
            document.removeEventListener("contextmenu", onSessionContextMenu, true);
            document.removeEventListener("touchstart", onEdgeSwipeStart, true);
            document.removeEventListener("touchmove", onEdgeSwipeMove, true);
            document.removeEventListener("touchend", onEdgeSwipeEnd, true);
            document.removeEventListener("touchcancel", onEdgeSwipeEnd, true);
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("pointerdown", onFocusPointer, true);
            document.removeEventListener("focusin", onFocusInGuard, true);
            // Added at boot alongside the rest; without these two a re-mount
            // leaves the previous closure listening on every pointer move.
            document.removeEventListener("pointermove", onPointerMove, true);
            document.removeEventListener("focusout", onModelFocusOut, true);
            media.removeEventListener("change", onMedia);
            // Invalidate any decorate frame queued before this teardown. The
            // frame checks `live` before touching the DOM, so it cannot undo
            // the cleanup below.
            live = false;
            scheduled = false;
            // One teardown path: every owned attribute/node/listener/style,
            // the original viewport and the upstream palette. It runs even if
            // the window is still narrow, so a live reload starts clean.
            try {
              clearPhoneHooks();
            } catch (error) {
              console.error("[rdsh-mobile-ux] cleanup failed", error);
            }
            disposePreviewTools();
            rightPanelFitPending = false;
            style.remove();
            phoneStyle?.remove();
            rightPanelWatch?.disconnect();
            rightPanelIO?.disconnect();
            rightPanelWatch = null;
            rightPanelIO = null;
            rightPanelNode = null;
            settingsArrows = null;
            fab = null;
            backdrop = null;
            delete globalThis.__RDSH_MOBILE_UX__;
            navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
          } finally {
            // Even a failed teardown must leave the module bootable again; the
            // next apply then rebuilds every listener from scratch.
            booted = false;
          }
        };
      }, "rdsh-mobile-ux: phone layout");
    }

    // Test seam. The workspace behaviours are plain DOM functions; driving
    // them through boot() would need a whole browser, so a harness that sets
    // this flag before loading the module gets the same closures production
    // uses. Nothing reads it in a normal page.
    const workspaceTestHook = globalThis.__RDSH_WORKSPACE_TEST__;
    if (workspaceTestHook !== null && typeof workspaceTestHook === "object") {
      workspaceTestHook.workspace = {
        beginWorkspacePicker,
        decorateWorkspacePicker,
        workspaceTriggerControl,
        clearWorkspacePicker,
        decorateWorkspaceFiles,
        runFilesSearch,
        installWorkspaceTools,
        disposeWorkspaceTools,
        filesMenu: () => filesMenu,
        filesSearch: () => filesSearch,
      };
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        readGeneralSettingsLabel = () => {
          const label = ctx.slots.entries?.("settings.section")?.find((entry) => entry.options.id === "general")?.options.label;
          return (typeof label === "function" ? label() : label) ?? "General";
        };
        // Session selection needs the workspace service, which arrives on its
        // own schedule; without it a notification tap can only raise a banner.
        ctx.inject(["uiWorkspace", "sessions", "conversation"], (scope) => {
          attachSessionOpener(scope);
          if (phone()) installLocalPermissionDefault(scope, scope.uiWorkspace, scope.sessions, scope.conversation?.blocks ?? null);
        });
        ctx.inject(["remote", "remote.permissionPresets"], (scope) => {
          if (phone()) void loadPermissionCatalog(scope.remote);
        });
        try {
          attachDeviceTheme(ctx);
        } catch (error) {
          console.error("[rdsh-mobile-ux] device theme failed", error);
        }
        ctx.inject(["theme", "locale"], (scope) => {
          try {
            attachLocalDisplay(scope);
          } catch (error) {
            console.error("[rdsh-mobile-ux] local display failed", error);
          }
        });
        try {
          boot(ctx);
        } catch (error) {
          console.error("[rdsh-mobile-ux] boot failed", error);
          emit({ bootError: String((error && error.message) || error) });
        }
        ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
          name: "sidebar.workspaces.session.menu.item",
          id: "rdsh-color-frame",
          order: 150,
        }, ColorFrameMenuItem));
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay",
          id: "rdsh-mobile-ux-notifications",
          order: 92,
        }, NotificationWatcher));
        ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
          name: "conversation.composer.dock",
          id: "rdsh-mobile-ux-live-speed",
          order: 2,
          inject: (sessionId) => ({ sessionId }),
        }, LiveSpeed));
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "mobile-ux",
          order: -1,
          label: () => t("tab.mobile"),
        }, MobileSection));
      },
    };
    }

    // ---------------------------------------------------------------------
    // rdsh-session-id-copy — copy a session id from its row menu.
    // ---------------------------------------------------------------------
    function sessionIdCopyPart() {

    const React = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;

    const SLOT = "sidebar.workspaces.session.menu.item";
    const ENTRY_ID = "rdsh-session-id-copy";
    // After the shipped rows (pin 100 / rename 200 / fork 300 / archive 400).
    const ORDER = 500;
    // Resolved at render time so the device-local display language reaches
    // this row too; the registration label is likewise a getter.
    const label = () => t("sessionId.label");

    /** One "..." menu row: copy this Session's ID, then close the menu. */
    function CopySessionIdMenuItem({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState();
      const id = String(sessionId ?? "");
      return h(primitives.MenuItemButton, {
        // Icon seat of the shipped rows; the default 16px one-pixel outline,
        // like pin / rename / fork beside it.
        icon: h(primitives.IconCopyOutlineRegular, { key: "icon" }),
        onSelect: () => {
          setMenuOpen(false);
          void copyText(id).then((copied) => {
            if (copied) {
              notify(t("sessionId.copied"));
              return;
            }
            // 自動コピーが両方とも塞がれている環境では、選択済みの ID を見せる。
            if (typeof window === "object" && window !== null && typeof window.prompt === "function") {
              window.prompt(t("sessionId.manualPrompt"), id);
            }
          });
        },
        children: label(),
      });
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        // Wait for ui-workspace's declaration before contributing to it.
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register({ name: SLOT, id: ENTRY_ID, order: ORDER, label }, CopySessionIdMenuItem),
        );
      },
    };
    }

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------
    return {
      inject: ["slots"],
      apply(ctx) {
        // Order matters only for the one that touches the session menu: the id
        // copy row registers into its own slot, so any order works. Each part
        // is built and applied behind its own guard: one broken half must not
        // take the other two down with it.
        const factories = [
          ["pwa", pwaPart],
          ["mobile-ux", mobilePart],
          ["session-id-copy", sessionIdCopyPart],
        ];
        for (const [name, factory] of factories) {
          let part;
          try {
            part = factory();
          } catch (error) {
            console.error(`[dsh-mobile-maxxing] ${name} client half failed to build`, error);
            continue;
          }
          if (part === null || typeof part !== "object" || typeof part.apply !== "function") continue;
          try {
            part.apply(ctx);
          } catch (error) {
            console.error(`[dsh-mobile-maxxing] ${name} client half failed to apply`, error);
          }
        }
      },
    };
  },
});
