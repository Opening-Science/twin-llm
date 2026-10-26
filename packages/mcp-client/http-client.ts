import "server-only";

import type { McpServerEntry } from "./registry";

/**
 * JSON-RPC 2.0 over one HTTP endpoint, as the MCP streamable-HTTP transport
 * speaks it. Errors carry a `<server>-` marker and never the response body.
 */

type JsonRpcSuccess = {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result: unknown;
};

export type McpTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
};

export type McpHttpClient = Readonly<{
  initialize: () => Promise<unknown>;
  listTools: () => Promise<McpTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}>;

export type McpHttpClientOptions = Readonly<{
  server: McpServerEntry;
  url: string;
  token?: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}>;

const parseBody = (raw: string, contentType: string, prefix: string): unknown => {
  const sse =
    contentType.includes("event-stream") ||
    raw.includes("\ndata:") ||
    raw.startsWith("event:");
  if (sse) {
    const lines = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    const last = lines.at(-1)?.slice(5).trim();
    if (!last || last === "[DONE]") {
      throw new Error(`${prefix}-empty-sse`);
    }
    return JSON.parse(last) as unknown;
  }
  return JSON.parse(raw) as unknown;
};

export const createMcpHttpClient = (options: McpHttpClientOptions): McpHttpClient => {
  const { server, url, token, timeoutMs } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const prefix = server.name;
  let nextId = 1;
  let initialized = false;

  const rpc = async (method: string, params?: unknown): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: nextId,
          method,
          ...(params === undefined ? {} : { params }),
        }),
        signal: controller.signal,
      });
      nextId += 1;
      const raw = await response.text();
      if (!response.ok) throw new Error(`${prefix}-http-error`);
      const body = parseBody(raw, response.headers.get("content-type") ?? "", prefix);
      if (typeof body === "object" && body !== null && "error" in body) {
        throw new Error(`${prefix}-rpc-error`);
      }
      if (typeof body === "object" && body !== null && "result" in body) {
        return (body as JsonRpcSuccess).result;
      }
      throw new Error(`${prefix}-rpc-error`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${prefix}-timeout`);
      }
      throw error instanceof Error ? error : new Error(`${prefix}-call-failed`);
    } finally {
      clearTimeout(timer);
    }
  };

  const initialize = async (): Promise<unknown> => {
    if (initialized) return null;
    const result = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "twin-llm", version: "0.1.0" },
    });
    initialized = true;
    return result;
  };

  const listTools = async (): Promise<McpTool[]> => {
    await initialize();
    const result = await rpc("tools/list", {});
    if (typeof result !== "object" || result === null) {
      throw new Error(`${prefix}-rpc-error`);
    }
    const tools = (result as { tools?: unknown }).tools;
    if (!Array.isArray(tools)) throw new Error(`${prefix}-rpc-error`);
    return tools.filter((tool): tool is McpTool => {
      return (
        typeof tool === "object" &&
        tool !== null &&
        typeof (tool as { name?: unknown }).name === "string"
      );
    });
  };

  const callTool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    await initialize();
    return rpc("tools/call", { name, arguments: args });
  };

  return { initialize, listTools, callTool };
};
