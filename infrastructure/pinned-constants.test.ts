import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { syntheaPinText } from "../scripts/synthea/write-pin";

import { SYNTHEA_JAR_SHA256, SYNTHEA_VERSION } from "./local-artefacts";
import { DEFAULT_OLLAMA_BASE_URL } from "./ollama-context";

/**
 * Pins and default addresses are written down once. These tests read every
 * source file and fail on a second copy, so changing the constant changes
 * every place that uses it.
 */

const ROOT = join(import.meta.dir, "..");
const SOURCE_DIRS = ["app", "features", "infrastructure", "packages", "scripts"];
const SOURCE = new Bun.Glob("**/*.{ts,tsx,mjs,sh}");

const sourceFiles = async (): Promise<readonly string[]> => {
  const found = await Promise.all(
    SOURCE_DIRS.map(async (dir) =>
      (await Array.fromAsync(SOURCE.scan({ cwd: join(ROOT, dir) })))
        .filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes("node_modules"))
        .map((file) => `${dir}/${file}`),
    ),
  );
  return [...found.flat(), "next.config.ts", "proxy.ts"].sort();
};

const filesContaining = async (needle: string): Promise<readonly string[]> => {
  const files = await sourceFiles();
  const texts = await Promise.all(
    files.map(async (file) => [file, await readFile(join(ROOT, file), "utf8")] as const),
  );
  return texts.filter(([, text]) => text.includes(needle)).map(([file]) => file);
};

describe("one copy of each pin", () => {
  test("the default Ollama port is written only in ollama-context.ts", async () => {
    expect(DEFAULT_OLLAMA_BASE_URL).toContain(":11434");
    expect(await filesContaining(":11434")).toEqual(["infrastructure/ollama-context.ts"]);
  });

  test("the Synthea JAR hash is written only in local-artefacts.ts and its generated shell copy", async () => {
    expect(await filesContaining(SYNTHEA_JAR_SHA256)).toEqual([
      "infrastructure/local-artefacts.ts",
      "scripts/synthea/synthea-pin.sh",
    ]);
  });

  test("synthea-pin.sh is what `bun run synthea:pin` writes now", async () => {
    const text = await readFile(join(ROOT, "scripts/synthea/synthea-pin.sh"), "utf8");
    expect(text).toBe(syntheaPinText());
    expect(text).toContain(`SYNTHEA_VERSION=${SYNTHEA_VERSION}\n`);
  });

  test("generate-local.sh reads the pin file and sets no pin of its own", async () => {
    const script = await readFile(
      join(ROOT, "scripts/synthea/generate-local.sh"),
      "utf8",
    );
    expect(script).toContain('source "$ROOT/scripts/synthea/synthea-pin.sh"');
    expect(script).not.toMatch(/^\s*SYNTHEA_(VERSION|JAR_URL|JAR_SHA256)=/m);
  });
});
