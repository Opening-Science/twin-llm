import { describe, expect, test } from "bun:test";

import { getGbdStatusResponse } from "./gbd-status";

describe("GET /api/gbd/status", () => {
  test("not configured when URL or token is missing", async () => {
    const response = await getGbdStatusResponse({
      configured: () => false,
      listToolNames: async () => {
        throw new Error("should not list");
      },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ configured: false });
    const text = JSON.stringify(body);
    expect(text).not.toContain("question");
    expect(text).not.toContain("GBD_MCP_TOKEN");
  });

  test("ok path returns tool names only", async () => {
    const response = await getGbdStatusResponse({
      configured: () => true,
      listToolNames: async () => ["gbd_query"],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const text = JSON.stringify(body);
    expect(body).toEqual({
      configured: true,
      state: "ok",
      tools: ["gbd_query"],
    });
    expect(text).not.toContain("question");
    expect(text).not.toContain("GBD_MCP_TOKEN");
    expect(text).not.toContain("inputSchema");
  });

  test("list failure returns error without provider copy", async () => {
    const response = await getGbdStatusResponse({
      configured: () => true,
      listToolNames: async () => {
        throw new Error("upstream exploded with token=should-never-leak");
      },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const text = JSON.stringify(body);
    expect(body).toEqual({ configured: true, state: "error" });
    expect(text).not.toContain("question");
    expect(text).not.toContain("token");
    expect(text).not.toContain("should-never-leak");
    expect(text).not.toContain("upstream exploded");
  });
});
