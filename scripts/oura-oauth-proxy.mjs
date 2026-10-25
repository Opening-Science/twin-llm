#!/usr/bin/env node
/**
 * Oura developer apps often keep a legacy local redirect
 * `http://localhost:8787/callback`. Twin LLM's real handler lives at
 * `/api/oura/callback` on the Next port. This proxy bridges them for local MVP.
 *
 * Usage (separate terminal, while Next is on :3000):
 *   bun scripts/oura-oauth-proxy.mjs
 */
import { createServer } from "node:http";

const _listenHost = process.env.OURA_PROXY_HOST ?? "localhost";
const LISTEN_PORT = Number(process.env.OURA_PROXY_PORT ?? 8787);
const FORWARD_TO =
  process.env.OURA_PROXY_FORWARD ?? "http://localhost:3000/api/oura/callback";

const server = createServer((req, res) => {
  const incoming = new URL(req.url ?? "/", `http://${_listenHost}:${LISTEN_PORT}`);
  const target = new URL(FORWARD_TO);
  target.search = incoming.search;

  res.writeHead(302, { Location: target.toString() });
  res.end();
});

server.on("error", (error) => {
  console.error("[oura-proxy] failed to listen", error);
  process.exit(1);
});

server.listen(LISTEN_PORT, _listenHost, () => {
  console.error(
    `[oura-proxy] http://${_listenHost}:${LISTEN_PORT}/callback → ${FORWARD_TO}`,
  );
});
