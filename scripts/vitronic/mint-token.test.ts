import { describe, expect, test } from "bun:test";

import { runMint } from "./mint-token";

describe("mint-token CLI", () => {
  test("dry-run never prints a token", async () => {
    const chunks: string[] = [];
    const code = await runMint(
      ["--dry-run"],
      {
        BODYLOOP_BASE_URL: "https://scanner.example",
        BODYLOOP_USERNAME: "admin",
        BODYLOOP_PASSWORD: "not-a-real-password",
      },
      {
        stdout: { write: (chunk) => chunks.push(chunk) },
        stderr: { write: () => undefined },
      },
    );
    expect(code).toBe(0);
    expect(chunks.join("")).toBe("");
  });
});
