import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertFingerprintMatch,
  fingerprintSha256Hex,
  TlsPinMismatchError,
  TLS_PIN_MISMATCH,
  verifyPeerCertificate,
} from "./tls";

const tlsSource = readFileSync(join(import.meta.dir, "tls.ts"), "utf8");
const clientSource = readFileSync(join(import.meta.dir, "client.ts"), "utf8");

describe("BodyLoop TLS pin", () => {
  test("source never sets NODE_TLS_REJECT_UNAUTHORIZED", () => {
    expect(tlsSource).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED\s*=/);
    expect(clientSource).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED\s*=/);
    expect(tlsSource).not.toContain("process.env.NODE_TLS_REJECT_UNAUTHORIZED");
    expect(clientSource).not.toContain("process.env.NODE_TLS_REJECT_UNAUTHORIZED");
  });

  test("pin mismatch throws TlsPinMismatchError with no fallback", () => {
    const actual = fingerprintSha256Hex(Buffer.from("peer-cert-a"));
    const expected = fingerprintSha256Hex(Buffer.from("peer-cert-b"));
    expect(actual).not.toBe(expected);
    try {
      assertFingerprintMatch(actual, expected);
      throw new Error("expected TlsPinMismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(TlsPinMismatchError);
      expect((error as TlsPinMismatchError).code).toBe(TLS_PIN_MISMATCH);
      expect((error as TlsPinMismatchError).message).toBe(TLS_PIN_MISMATCH);
    }
    expect(() =>
      verifyPeerCertificate({ raw: Buffer.from("peer-cert-a") }, expected),
    ).toThrow(TlsPinMismatchError);
    expect(() =>
      verifyPeerCertificate({ raw: Buffer.from("peer-cert-a") }, expected),
    ).toThrow(TLS_PIN_MISMATCH);
    const hashed = createHash("sha256").update("peer-cert-a").digest("hex");
    expect(hashed).toBe(actual);
    expect(() => verifyPeerCertificate({ raw: Buffer.from("peer-cert-a") }, actual)).not.toThrow();
  });
});
