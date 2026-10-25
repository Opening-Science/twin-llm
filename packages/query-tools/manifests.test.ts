import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mcpToolManifest, openaiToolList } from "./manifests";

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
