import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runStartup } from "./startup-order";

describe("runStartup", () => {
  test("umask first, then the environment, then the storage check", async () => {
    const calls: string[] = [];
    await runStartup({
      restrictUmask: () => calls.push("umask"),
      readEnvironment: () => calls.push("env"),
      checkStorage: async () => {
        calls.push("storage");
      },
    });
    expect(calls).toEqual(["umask", "env", "storage"]);
  });

  test("a failed storage check stops the start", async () => {
    await expect(
      runStartup({
        restrictUmask: () => undefined,
        readEnvironment: () => undefined,
        checkStorage: async () => {
          throw new Error("refused");
        },
      }),
    ).rejects.toThrow("refused");
  });

  test("instrumentation.ts runs its steps through runStartup", async () => {
    const source = await readFile(join(import.meta.dir, "../instrumentation.ts"), "utf8");
    expect(source).toContain("runStartup({");
    expect(source).toContain("restrictUmask: storage.restrictUmask");
  });
});
