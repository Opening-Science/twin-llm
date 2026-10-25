import { describe, expect, test } from "bun:test";

import { ingestSchema } from "./ingest-schema";

describe("ingestSchema", () => {
  test("accepts glb-only payloads", () => {
    const parsed = ingestSchema.safeParse({
      glbBase64: "Z2xURg==",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects empty payloads", () => {
    const parsed = ingestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});
