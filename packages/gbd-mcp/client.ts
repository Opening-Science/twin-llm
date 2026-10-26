import "server-only";

import { gbdEnv } from "@/infrastructure/env";
import {
  createMcpHttpClient,
  type McpHttpClient,
  type McpTool,
} from "@/packages/mcp-client/http-client";
import { findServer } from "@/packages/mcp-client/registry";

import { GBD_TIMEOUT_MS } from "./constants";

export type { McpTool };

let client: McpHttpClient | null = null;

export const resetGbdClientForTests = (): void => {
  client = null;
};

const gbdClient = (): McpHttpClient => {
  const env = gbdEnv();
  const server = findServer("gbd");
  if (!env || !server) throw new Error("gbd-not-configured");
  client ??= createMcpHttpClient({
    server,
    url: env.url,
    token: env.token,
    timeoutMs: GBD_TIMEOUT_MS,
  });
  return client;
};

export const initialize = async (): Promise<unknown> => gbdClient().initialize();

export const listTools = async (): Promise<McpTool[]> => gbdClient().listTools();

export const listToolNames = async (): Promise<string[]> =>
  (await listTools()).map((tool) => tool.name);

export const callTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => gbdClient().callTool(name, args);
