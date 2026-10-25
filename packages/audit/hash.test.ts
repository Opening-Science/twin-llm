import { describe, expect, test } from "bun:test";

import {
  GENESIS_PREV_HASH,
  hashEvent,
  sha256Hex,
  toCanonicalJson,
  type CanonicalAuditEvent,
} from "./hash";

const sample = (): CanonicalAuditEvent => ({
  actor: "local",
  args_sha256: "a".repeat(64),
  prev_hash: GENESIS_PREV_HASH,
  result_sha256: "b".repeat(64),
  row_count: 2,
  seq: 1,
  session_id: "turn-1",
  subject_ref: null,
  tool: "list_subjects",
  ts: "2026-09-27T15:00:00.000Z",
});

describe("audit hash", () => {
  test("genesis prev_hash is 64 zeros", () => {
    expect(GENESIS_PREV_HASH).toBe("0".repeat(64));
    expect(GENESIS_PREV_HASH).toHaveLength(64);
  });

  test("canonical JSON uses sorted keys and omits hash", () => {
    const json = toCanonicalJson(sample());
    expect(json).toBe(
      '{"actor":"local","args_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","result_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","row_count":2,"seq":1,"session_id":"turn-1","subject_ref":null,"tool":"list_subjects","ts":"2026-09-27T15:00:00.000Z"}',
    );
    expect(Object.hasOwn(JSON.parse(json) as object, "hash")).toBe(false);
  });

  test("hash is sha256(prev_hash + canonical JSON)", () => {
    const event = sample();
    expect(hashEvent(event)).toBe(sha256Hex(event.prev_hash + toCanonicalJson(event)));
  });
});
