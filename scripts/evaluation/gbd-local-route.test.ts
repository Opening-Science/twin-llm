import { describe, expect, test } from "bun:test";

import { withLocalGbd } from "./gbd-local-route";
import { auditTools } from "./score/turn";
import type { AnsweredLine } from "./score/types";

describe("S4 on the local GBD store", () => {
  test("the remote GBD env counts as met only when the store holds results", () => {
    const none = () => false;
    expect(withLocalGbd(none, true)("GBD_MCP_URL")).toBe(true);
    expect(withLocalGbd(none, true)("GBD_MCP_TOKEN")).toBe(true);
    expect(withLocalGbd(none, true)("OTHER")).toBe(false);
    expect(withLocalGbd(none, false)("GBD_MCP_URL")).toBe(false);
    expect(withLocalGbd((name) => name === "GBD_MCP_URL", false)("GBD_MCP_URL")).toBe(
      true,
    );
  });

  test("gbd_estimate in the audit also stands for gbd.gbd_query", () => {
    const line = {
      audit: [
        { tool: "gbd_estimate", refusal: null },
        { tool: "gbd_estimate", refusal: null },
        { tool: "guidelines.guideline_search", refusal: null },
      ],
    } as unknown as AnsweredLine;
    expect(auditTools(line)).toEqual([
      "gbd_estimate",
      "gbd.gbd_query",
      "guidelines.guideline_search",
    ]);
  });
});
