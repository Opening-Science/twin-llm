import "server-only";

import { gbdEnv } from "@/infrastructure/env";

import { GBD_TIMEOUT_MS } from "./constants";

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

let nextId = 1;
let initialized = false;

export const resetGbdClientForTests = (): void => {
  initialized = false;
  nextId = 1;
};

const parseBody = (raw: string, contentType: string): unknown => {
  const sse =
    contentType.includes("event-stream") ||
    raw.includes("\ndata:") ||
    raw.startsWith("event:");
  if (sse) {
    const lines = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    const last = lines.at(-1)?.slice(5).trim();
    if (!last || last === "[DONE]") {
      throw new Error("gbd-empty-sse");
    }
    return JSON.parse(last) as unknown;
  }
  return JSON.parse(raw) as unknown;
};

const rpc = async (method: string, params?: unknown): Promise<unknown> => {
  const env = gbdEnv();
  if (!env) throw new Error("gbd-not-configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GBD_TIMEOUT_MS);
  try {
    const response = await fetch(env.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${env.token}`,
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
    if (!response.ok) throw new Error("gbd-http-error");
    const body = parseBody(raw, response.headers.get("content-type") ?? "");
    if (typeof body === "object" && body !== null && "error" in body) {
      throw new Error("gbd-rpc-error");
    }
    if (typeof body === "object" && body !== null && "result" in body) {
      return (body as JsonRpcSuccess).result;
    }
    throw new Error("gbd-rpc-error");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("gbd-timeout");
    }
    throw error instanceof Error ? error : new Error("gbd-call-failed");
  } finally {
    clearTimeout(timer);
  }
};

export const initialize = async (): Promise<unknown> => {
  if (initialized) return null;
  const result = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "twin-llm", version: "0.1.0" },
  });
  initialized = true;
  return result;
};

export const listTools = async (): Promise<McpTool[]> => {
  await initialize();
  const result = await rpc("tools/list", {});
  if (typeof result !== "object" || result === null) {
    throw new Error("gbd-rpc-error");
  }
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) throw new Error("gbd-rpc-error");
  return tools.filter((tool): tool is McpTool => {
    return (
      typeof tool === "object" &&
      tool !== null &&
      typeof (tool as { name?: unknown }).name === "string"
    );
  });
};

export const listToolNames = async (): Promise<string[]> =>
  (await listTools()).map((tool) => tool.name);

export const callTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  await initialize();
  return rpc("tools/call", { name, arguments: args });
};
