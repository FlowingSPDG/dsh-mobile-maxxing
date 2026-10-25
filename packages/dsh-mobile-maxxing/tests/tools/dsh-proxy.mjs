/**
 * Serve the real `index.html` of a running DSH Web instance, so a browser can
 * render the actual app shell instead of a fixture.
 *
 * `dsh web` refuses the index without its browser session cookie, and minting
 * one needs the launch token, which only lives in the process. This proxy
 * mints a valid cookie from the persisted browser-session secret (the same
 * derivation `@deepseek-ai/dsh-client-connection` uses), forwards every other
 * request untouched, and rewrites the page's absolute asset paths to relative
 * ones so the document also works on a `data:` URL.
 *
 *   DSH_UPSTREAM=http://100.106.174.39:3080 node tests/tools/dsh-proxy.mjs
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

const upstream = process.env.DSH_UPSTREAM ?? "http://127.0.0.1:3080";
const port = Number(process.env.DSH_PROXY_PORT ?? 3099);
const authority = new URL(upstream).host;

/** base64url, as the connection package encodes it. */
function encodeBase64Url(value) {
	return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** The stored browser-session secret, read from the DSH home credentials. */
function readSecret(home = join(homedir(), ".dsh")) {
	const text = readFileSync(join(home, ".credentials.yaml"), "utf8");
	const lines = text.split(/\r?\n/u);
	const at = lines.findIndex((line) => line.trim() === "client-connection/browser-session:");
	if (at === -1) throw new Error("no client-connection/browser-session record in the credentials file");
	for (let index = at + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (/^\s{0,2}\S/u.test(line)) break;
		const match = line.match(/^\s+secret:\s*(\S+)\s*$/u);
		if (match !== null) return Buffer.from(match[1], "base64url");
	}
	throw new Error("the browser-session record has no secret");
}

/** The cookie name the connection package derives from the request authority. */
const cookieName = "dsh-auth-" + encodeBase64Url(createHash("sha256").update(authority).digest());

/** A signed v1 browser cookie for this authority. */
function browserCookie(secret) {
	const now = Date.now();
	const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 86_400_000 };
	const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
	const signature = encodeBase64Url(createHmac("sha256", secret).update(body).digest());
	return { payload, value: `v1.${body}.${signature}` };
}

/**
 * Point the page's root-absolute URLs at the proxy, so a document served from
 * a `data:` URL can still load the app's modules and styles.
 */
function rewriteIndex(html, assetRoot) {
	return html
		.replaceAll('href="/', `href="${assetRoot}/`)
		.replaceAll('src="/', `src="${assetRoot}/`)
		.replaceAll('from "/', `from "${assetRoot}/`)
		.replaceAll('import("/', `import("${assetRoot}/`)
		.replaceAll("'/", `'${assetRoot}/`);
}

function start() {
	const secret = readSecret();
	const server = createServer((incoming, outgoing) => {
		const url = new URL(incoming.url ?? "/", `http://127.0.0.1:${port}`);
		// `/app/` is the raw index; `/index.html` the one rewritten for a
		// data: fixture, on the same origin so its modules resolve.
		const wantsIndex = url.pathname === "/app/" || url.pathname === "/index.html";
		// The plugin module route is a `??query` combo, so the search string is
		// the path's own tail: forward the request target as it arrived.
		const upstreamPath = wantsIndex ? "/" : incoming.url ?? "/";
		const headers = { ...incoming.headers, host: authority, cookie: `${cookieName}=${browserCookie(secret).value}` };
		// The proxy does not re-compress, so ask for a plain body it can rewrite.
		delete headers["accept-encoding"];
		const proxied = request(`${upstream}${upstreamPath}`, { method: incoming.method, headers }, (reply) => {
			const chunks = [];
			reply.on("data", (chunk) => chunks.push(chunk));
			reply.on("end", () => {
				let body = Buffer.concat(chunks);
				const type = String(reply.headers["content-type"] ?? "");
				if (wantsIndex && type.includes("text/html")) {
					body = Buffer.from(rewriteIndex(body.toString("utf8"), `http://127.0.0.1:${port}`), "utf8");
				}
				const pass = { ...reply.headers };
				// The body is re-sent as identity bytes: the upstream framing
				// headers would describe the compressed or chunked original.
				delete pass["content-encoding"];
				delete pass["transfer-encoding"];
				pass["content-length"] = String(body.length);
				if (wantsIndex) pass["access-control-allow-origin"] = "*";
				outgoing.writeHead(reply.statusCode ?? 502, pass);
				outgoing.end(body);
			});
		});
		proxied.on("error", (error) => {
			outgoing.writeHead(502, { "content-type": "text/plain" });
			outgoing.end(`proxy failed: ${error.message}`);
		});
		incoming.pipe(proxied);
	});
	server.listen(port, "127.0.0.1", () => {
		console.log(`DSH proxy on http://127.0.0.1:${port} -> ${upstream} (cookie ${cookieName})`);
	});
	return server;
}

start();
