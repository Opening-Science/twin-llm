#!/usr/bin/env node
/**
 * Whoop requires https:// redirects. Twin LLM can stay on plain
 * http://localhost:3000 — this TLS proxy accepts Whoop's callback and 302s
 * into Next.
 *
 * Register in Whoop dashboard (exact match):
 *   https://localhost:8788/api/whoop/callback
 *
 * Usage (Next already on :3000):
 *   bun run whoop:proxy
 */
import { createServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const LISTEN_HOST = process.env.WHOOP_PROXY_HOST ?? "localhost";
const LISTEN_PORT = Number(process.env.WHOOP_PROXY_PORT ?? 8788);
const FORWARD_TO =
  process.env.WHOOP_PROXY_FORWARD ?? "http://localhost:3000/api/whoop/callback";

const keyPath = resolve(
  process.env.WHOOP_PROXY_KEY ?? "./certificates/localhost-key.pem",
);
const certPath = resolve(process.env.WHOOP_PROXY_CERT ?? "./certificates/localhost.pem");

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error(
    `[whoop-proxy] missing TLS files.\n  expected: ${keyPath}\n            ${certPath}`,
  );
  process.exit(1);
}

const server = createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  },
  (req, res) => {
    const incoming = new URL(req.url ?? "/", `https://${LISTEN_HOST}:${LISTEN_PORT}`);
    const target = new URL(FORWARD_TO);
    target.search = incoming.search;

    res.writeHead(302, { Location: target.toString() });
    res.end();
  },
);

server.on("error", (error) => {
  console.error("[whoop-proxy] failed to listen", error.message);
  process.exit(1);
});

server.listen(LISTEN_PORT, () => {
  console.log(
    `[whoop-proxy] https://localhost:${LISTEN_PORT}/api/whoop/callback → ${FORWARD_TO}`,
  );
  console.log(
    "[whoop-proxy] Visit https://localhost:8788/api/whoop/callback once in Safari, accept the cert, then Link Whoop from http://localhost:3000",
  );
});
