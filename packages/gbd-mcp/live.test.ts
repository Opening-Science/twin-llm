import { describe, expect, test } from "bun:test";

import { composeGbdQuestion } from "./compose";
import { GBD_MCP_TOOL } from "./constants";
import { gbdPopulationInput } from "./input";

const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";

describe.skipIf(!runLive)("gbd-mcp live (RUN_LIVE=1)", () => {
  test("initialize, tools/list, and one structured call", async () => {
    const { initialize, listTools, callTool } = await import("./client");
    await initialize();
    const tools = await listTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((tool) => tool.name)).toContain(GBD_MCP_TOOL);

    const fields = gbdPopulationInput.parse({
      measure: "deaths",
      sex: "both",
      age: "all_ages",
      year: "2021",
      location: "Global",
      cause: "All causes",
    });
    const result = await callTool(GBD_MCP_TOOL, {
      question: composeGbdQuestion(fields),
    });
    expect(result).toBeDefined();
  });
});
