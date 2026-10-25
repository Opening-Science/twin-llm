import { describe, expect, test } from "bun:test";

import { runConnect } from "./connect";

describe("vitronic connect CLI", () => {
  test("dry-run never prints a fingerprint", async () => {
    const chunks: string[] = [];
    const code = await runConnect(
      ["--dry-run"],
      {
        VITRONIC_BASE_URL: "https://scanner.example",
        VITRONIC_API_TOKEN: "token",
        VITRONIC_PROBAND_ID: "1",
        LOCAL_USER_ID: "local",
      },
      {
        stdout: { write: (chunk) => chunks.push(chunk) },
        stderr: { write: () => undefined },
      },
      async () => ({ tlsFingerprintSha256: "ab".repeat(32) }),
      async () => ({ id: "user-1" }),
    );
    expect(code).toBe(0);
    expect(chunks.join("")).toBe("");
  });

  test("prints only the connected fingerprint prefix", async () => {
    const chunks: string[] = [];
    const code = await runConnect(
      [],
      {
        VITRONIC_BASE_URL: "https://scanner.example",
        VITRONIC_API_TOKEN: "token",
        VITRONIC_PROBAND_ID: "1",
        LOCAL_USER_ID: "local",
      },
      {
        stdout: { write: (chunk) => chunks.push(chunk) },
        stderr: { write: () => undefined },
      },
      async () => ({ tlsFingerprintSha256: "abcdef0123456789".repeat(4) }),
      async () => ({ id: "user-1" }),
    );
    expect(code).toBe(0);
    expect(chunks.join("")).toBe("connected, fingerprint abcdef012345\n");
  });
});
