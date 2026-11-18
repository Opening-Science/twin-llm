import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mcpToolManifest, openaiToolList } from "./manifests";
import { TOOL_DEFINITIONS } from "./schemas";

const SNAPSHOT_DIR = join(import.meta.dir, "__snapshots__");

const readSnapshot = (name: string): unknown =>
  JSON.parse(readFileSync(join(SNAPSHOT_DIR, name), "utf8"));

// The snapshots hold the JSON that reaches clients; zod also attaches non-enumerable metadata.
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("tool schema snapshots", () => {
  test("OpenAI tool list equals the committed snapshot", () => {
    expect(asJson(openaiToolList())).toEqual(readSnapshot("openai-tools.json"));
  });

  test("MCP manifest equals the committed snapshot", () => {
    expect(asJson(mcpToolManifest())).toEqual(readSnapshot("mcp-tools.json"));
  });
});

describe("day and period descriptions (#852)", () => {
  const described = (name: string): string =>
    TOOL_DEFINITIONS.find((tool) => tool.name === name)?.description ?? "";

  test.each(["show_my_day", "show_my_period"])(
    "%s names sensor glucose as its own measure, with its lag note",
    (name) => {
      const text = described(name);
      expect(text).toContain("sensor glucose (99504-3)");
      expect(text).toContain("sensor_lag");
      expect(text).toMatch(/never (pooled or )?compared with blood/);
    },
  );

  test("show_my_period names the sensor summary and when it alone is refused", () => {
    expect(described("show_my_period")).toContain(
      "sensor_glucose alone is refused over 5000 sensor readings or when not in mg/dL",
    );
  });
});
