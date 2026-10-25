import { describe, expect, test } from "bun:test";

import appRunOk from "./fixtures/app-run-ok.json";
import dataListOk from "./fixtures/data-list-ok.json";
import dataPathsOk from "./fixtures/data-paths-ok.json";
import errorLocked from "./fixtures/error-locked.json";
import statusOk from "./fixtures/status-ok.json";
import statusRealShape from "./fixtures/status-real-shape.json";
import {
  allPathsStartWithGenome,
  ARK_PATH_PREFIX,
  ARK_SLOT_NAMES,
  arkAppRunDocumentSchema,
  arkDataListDocumentSchema,
  arkDataPathsDocumentSchema,
  arkErrorDocumentSchema,
  arkStatusDocumentSchema,
  isErrorDocument,
  parseStderrEvents,
  redactStatusDocument,
} from "./schemas";

describe("ark-adapter schemas", () => {
  test("parses status without requiring pubkey", () => {
    const parsed = arkStatusDocumentSchema.parse(statusOk);
    expect(parsed.serial).toBe("test-001");
    expect(parsed.pubkey).toBeUndefined();
    expect("pubkey" in redactStatusDocument({ ...parsed, pubkey: "ff".repeat(32) })).toBe(
      false,
    );
  });

  test("parses the live status shape and redacts pubkey", () => {
    const parsed = arkStatusDocumentSchema.parse(statusRealShape);
    expect(parsed.name).toBeNull();
    expect(parsed.mismatch).toBeNull();
    expect(parsed.identity).toHaveLength(64);
    expect(parsed.pubkey).toBeUndefined();
    const redacted = redactStatusDocument({
      ...parsed,
      pubkey: "ab".repeat(64),
    });
    expect("pubkey" in redacted).toBe(false);
    expect(JSON.stringify(redacted)).not.toContain("pubkey");
  });

  test("data list names the four genome slots", () => {
    const parsed = arkDataListDocumentSchema.parse(dataListOk);
    expect(parsed.slots.map((slot) => slot.name)).toEqual([...ARK_SLOT_NAMES]);
  });

  test("path excerpt and helper stay under v1/genome", () => {
    const parsed = arkDataPathsDocumentSchema.parse(dataPathsOk);
    expect(parsed.paths.length).toBeGreaterThanOrEqual(2);
    expect(allPathsStartWithGenome(parsed.paths)).toBe(true);
    expect(parsed.paths.every((entry) => entry.path.startsWith(ARK_PATH_PREFIX))).toBe(
      true,
    );
  });

  test("app run document keeps stdout as the report bytes", () => {
    const parsed = arkAppRunDocumentSchema.parse(appRunOk);
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toContain("Synthetic fixture report");
  });

  test("error document and stderr JSON lines", () => {
    expect(isErrorDocument(errorLocked)).toBe(true);
    expect(arkErrorDocumentSchema.parse(errorLocked).error.code).toBe("locked");
    const events = parseStderrEvents(
      [
        '{"event":"progress","message":"uploading: 1048576/2097152 bytes (50%)"}',
        '{"event":"approve","message":"approve on the companion app"}',
        '{"event":"error","error":{"code":"locked","message":"Ark is locked"}}',
        "not-json",
      ].join("\n"),
    );
    expect(events.map((event) => event.event)).toEqual(["progress", "approve", "error"]);
  });
});
