import { createHash } from "node:crypto";

export const GENESIS_PREV_HASH = "0".repeat(64);

export type CanonicalAuditEvent = {
  readonly actor: string;
  readonly args_sha256: string;
  readonly prev_hash: string;
  readonly result_sha256: string;
  readonly row_count: number;
  readonly seq: number;
  readonly session_id: string;
  readonly subject_ref: string | null;
  readonly tool: string;
  readonly ts: string;
};

const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
};

export const toCanonicalJson = (value: unknown): string =>
  JSON.stringify(sortKeysDeep(value));

export const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

export const hashEvent = (event: CanonicalAuditEvent): string =>
  sha256Hex(event.prev_hash + toCanonicalJson(event));
