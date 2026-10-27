import { describe, expect, test } from "bun:test";

import appRunOk from "./fixtures/app-run-ok.json";
import dataListOk from "./fixtures/data-list-ok.json";
import dataPathsOk from "./fixtures/data-paths-ok.json";
import doctorEmulator from "./fixtures/doctor-emulator.json";
import errorArkRefused from "./fixtures/error-ark-refused.json";
import errorLocked from "./fixtures/error-locked.json";
import statusEmulator from "./fixtures/status-emulator-unenrolled.json";
import statusOk from "./fixtures/status-ok.json";
import statusRealShape from "./fixtures/status-real-shape.json";
import {
  allPathsStartWithGenome,
  ARK_PATH_PREFIX,
  ARK_SLOT_NAMES,
  arkAppRunDocumentSchema,
  arkDataListDocumentSchema,
  arkDataPathsDocumentSchema,
  arkDoctorDocumentSchema,
  arkErrorDocumentSchema,
  arkStatusDocumentSchema,
  isErrorDocument,
  parseStderrEvents,
  redactDoctorDocument,
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

  test("data list names the six 0.5.0 slots by their slot field", () => {
    const parsed = arkDataListDocumentSchema.parse(dataListOk);
    expect(parsed.slots.map((slot) => slot.slot)).toEqual([...ARK_SLOT_NAMES]);
    expect(parsed.slots.map((slot) => slot.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("self-signed emulator status: attestation fields are null", () => {
    const parsed = arkStatusDocumentSchema.parse(statusEmulator);
    expect(parsed.serial).toBeNull();
    expect(parsed.hardware.model).toBeNull();
    expect(parsed.environment).toBeNull();
    expect(parsed.firmware.version).toBe("0.13.1-36da538");
  });

  test("doctor report keeps names and results only after redaction", () => {
    const parsed = arkDoctorDocumentSchema.parse(doctorEmulator);
    const safe = redactDoctorDocument(parsed);
    expect(safe.checks[0]).toEqual({ name: "ark", result: "ok" });
    expect(safe.checks).toHaveLength(13);
  });

  test("0.5.0 error object carries hints and the Ark's remote code", () => {
    const parsed = arkErrorDocumentSchema.parse(errorArkRefused);
    expect(parsed.error.hints).toEqual([]);
    expect(parsed.error.remote?.code).toBe("9001");
  });

  test("path excerpt and helper stay under v1/genome", () => {
    const parsed = arkDataPathsDocumentSchema.parse(dataPathsOk);
    expect(parsed.paths.length).toBeGreaterThanOrEqual(2);
    expect(allPathsStartWithGenome(parsed.paths)).toBe(true);
    expect(parsed.paths.every((entry) => entry.path.startsWith(ARK_PATH_PREFIX))).toBe(
      true,
    );
  });

  test("ark run document keeps stdout as the report bytes", () => {
    const parsed = arkAppRunDocumentSchema.parse(appRunOk);
    expect(parsed.success).toBe(true);
    expect(parsed.app).toEqual({ name: "fixture", version: "0.1.0", develop: false });
    expect(parsed.paths).toEqual(["v1/genome/rsids/rs72921001"]);
    expect(parsed.stdout).toContain("Synthetic fixture report");
  });

  test("the 0.3.5 run document (app as a file name) no longer parses", () => {
    const old = { task: "1", app: "x.wasm", success: true, duration_seconds: 1 };
    expect(arkAppRunDocumentSchema.safeParse(old).success).toBe(false);
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
