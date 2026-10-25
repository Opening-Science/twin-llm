#!/usr/bin/env node
/**
 * TLS front door for local Whoop OAuth (and the rest of the app).
 *
 * Whoop's dashboard is registered as:
 *   https://localhost:3000/api/whoop/callback
 * so something must speak HTTPS on :3000. Next stays on plain HTTP :3001.
 *
 * Terminal A:  bunx next dev -p 3001
 * Terminal B:  bun run https:gateway
 * Browser:     https://localhost:3000  (accept the self-signed cert once)
 */
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { connect as netConnect } from "node:net";

const LISTEN_HOST = process.env.HTTPS_GATEWAY_HOST ?? "127.0.0.1";
const LISTEN_PORT = Number(process.env.HTTPS_GATEWAY_PORT ?? 3000);
const UPSTREAM_HOST = process.env.HTTPS_GATEWAY_UPSTREAM_HOST ?? "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.HTTPS_GATEWAY_UPSTREAM_PORT ?? 3011);

const keyPath = resolve(
  process.env.HTTPS_GATEWAY_KEY ?? "./certificates/localhost-key.pem",
);
const certPath = resolve(
  process.env.HTTPS_GATEWAY_CERT ?? "./certificates/localhost.pem",
);

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error(`[https-gateway] missing TLS files at\n  ${keyPath}\n  ${certPath}`);
  process.exit(1);
}

const tls = {
  key: readFileSync(keyPath),
  cert: readFileSync(certPath),
};

const server = createHttpsServer(tls, (req, res) => {
  const headers = { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` };
  const proxy = httpRequest(
    {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on("error", (error) => {
    console.error("[https-gateway] upstream error", error.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end(
      `Bad gateway: is Next running on http://${UPSTREAM_HOST}:${UPSTREAM_PORT}?\n${error.message}`,
    );
  });
  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = netConnect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const path = req.url ?? "/";
    const lines = [
      `${req.method} ${path} HTTP/${req.httpVersion}`,
      `Host: ${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
    ];
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host" || value === undefined) continue;
      lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.on("error", (error) => {
  console.error("[https-gateway] failed to listen", error.message);
  if ("code" in error && error.code === "EADDRINUSE") {
    console.error(
      `[https-gateway] port ${LISTEN_PORT} is busy — stop plain \`bunx next dev\` on :3000 first, then run Next on :3001.`,
    );
  }
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[https-gateway] https://${LISTEN_HOST}:${LISTEN_PORT} → http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
  );
  console.log(
    `[https-gateway] Open https://${LISTEN_HOST}:${LISTEN_PORT} once and accept the cert warning, then Link Whoop again.`,
  );
});
