/**
 * Serves the nine query tools to an MCP client over stdio.
 *
 * Usage (from repo root, env from .env.local):
 *   bun run mcp:serve
 *
 * stdout is the protocol channel; logs go to stderr. Every call is audited
 * with actor `mcp` and one session id per process, as a chat turn is.
 */
import { randomUUID } from "node:crypto";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { serverEnv } from "../infrastructure/env";
import {
  assertTransportAllowedForDataMode,
  createQueryMcpServer,
  queryToolRunners,
} from "../packages/query-tools/mcp-server";
import { defaultQueryToolPorts } from "../packages/query-tools/ports";

const main = async (): Promise<void> => {
  const env = serverEnv();
  assertTransportAllowedForDataMode(env.DATA_MODE, "stdio");
  const scope = { actor: "mcp", sessionId: randomUUID(), mode: env.DATA_MODE };
  const server = createQueryMcpServer(queryToolRunners(scope, defaultQueryToolPorts()));
  await server.connect(new StdioServerTransport());
  console.error(`[mcp] query tools on stdio, DATA_MODE=${env.DATA_MODE}`);
};

await main();
