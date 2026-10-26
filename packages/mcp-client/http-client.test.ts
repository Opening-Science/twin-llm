import { describe, expect, test } from "bun:test";

import fixture from "@/packages/gbd-mcp/fixtures/tools-list.json";

import { createMcpHttpClient } from "./http-client";
import type { McpServerEntry } from "./registry";

const server: McpServerEntry = { name: "gbd", transport: "http", locality: "remote" };
const URL = "https://example.test/mcp";

type Call = { readonly url: string; readonly headers: unknown; readonly body: unknown };

const jsonResponse = (id: number, result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const fakeFetch = (
  calls: Call[],
  respond: (method: string, id: number) => Response,
): typeof fetch => {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string; id: number };
    calls.push({ url: String(input), headers: init?.headers, body });
    return respond(body.method, body.id);
  };
};

describe("createMcpHttpClient", () => {
  test("listTools initializes once and returns the fixture tools", async () => {
    const calls: Call[] = [];
    const client = createMcpHttpClient({
      server,
      url: URL,
      token: "t",
      timeoutMs: 1000,
      fetch: fakeFetch(calls, (method, id) =>
        method === "tools/list"
          ? jsonResponse(id, { tools: fixture.tools })
          : jsonResponse(id, { protocolVersion: "2024-11-05" }),
      ),
    });

    expect(await client.listTools()).toEqual([
      {
        name: "gbd_query",
        description: "Query IHME GBD population estimates.",
        inputSchema: {
          type: "object",
          properties: { question: { type: "string" } },
          required: ["question"],
        },
      },
    ]);
    expect(await client.listTools()).toHaveLength(1);

    expect(calls.map((call) => call.body)).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "twin-llm", version: "0.1.0" },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
    ]);
    expect(calls[0]?.url).toBe(URL);
    expect(calls[0]?.headers).toEqual({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer t",
    });
  });

  test("callTool sends tools/call with the arguments and returns the result", async () => {
    const calls: Call[] = [];
    const client = createMcpHttpClient({
      server,
      url: URL,
      timeoutMs: 1000,
      fetch: fakeFetch(calls, (method, id) =>
        method === "tools/call"
          ? jsonResponse(id, { content: [{ type: "text", text: "42" }] })
          : jsonResponse(id, {}),
      ),
    });

    expect(await client.callTool("gbd_query", { question: "q" })).toEqual({
      content: [{ type: "text", text: "42" }],
    });
    expect(calls[1]?.body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "gbd_query", arguments: { question: "q" } },
    });
    expect(calls[1]?.headers).toEqual({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
  });

  test("reads the last data line of an SSE body", async () => {
    const client = createMcpHttpClient({
      server,
      url: URL,
      timeoutMs: 1000,
      fetch: async () =>
        new Response(
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"a"}]}}\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });
    expect(await client.listTools()).toEqual([{ name: "a" }]);
  });

  test("errors carry the server name and never the body", async () => {
    const http = createMcpHttpClient({
      server,
      url: URL,
      timeoutMs: 1000,
      fetch: async () => new Response("secret body", { status: 500 }),
    });
    await expect(http.initialize()).rejects.toThrow("gbd-http-error");

    const rpc = createMcpHttpClient({
      server,
      url: URL,
      timeoutMs: 1000,
      fetch: async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(rpc.initialize()).rejects.toThrow("gbd-rpc-error");
  });
});
