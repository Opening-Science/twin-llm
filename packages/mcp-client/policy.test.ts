import { describe, expect, test } from "bun:test";

import { PROVIDER_NOT_PERMITTED_FOR_DATA_MODE } from "@/infrastructure/data-mode-policy";

import { MCP_SERVER_NOT_PERMITTED_ERROR, permitServerForDataMode } from "./policy";
import type { McpServerEntry } from "./registry";

const local: McpServerEntry = {
  name: "local-tools",
  transport: "stdio",
  locality: "local",
};
const remote: McpServerEntry = {
  name: "gbd",
  transport: "http",
  locality: "remote",
  url: "https://example.test/mcp",
};

const DENIED = {
  ok: false,
  code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  error: MCP_SERVER_NOT_PERMITTED_ERROR,
} as const;

describe("permitServerForDataMode", () => {
  test("local server, synthetic mode: allowed", () => {
    expect(permitServerForDataMode(local, "synthetic")).toEqual({ ok: true });
  });

  test("local server, personal mode: allowed", () => {
    expect(permitServerForDataMode(local, "personal")).toEqual({ ok: true });
  });

  test("remote server, synthetic mode: allowed", () => {
    expect(permitServerForDataMode(remote, "synthetic")).toEqual({ ok: true });
  });

  test("remote server, personal mode: refused", () => {
    expect(permitServerForDataMode(remote, "personal")).toEqual(DENIED);
  });

  test("the refusal names the data-mode code", () => {
    expect(MCP_SERVER_NOT_PERMITTED_ERROR).toBe(
      "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE: A remote MCP server may not be used with personal data. Use a local server, or DATA_MODE=synthetic.",
    );
  });
});
