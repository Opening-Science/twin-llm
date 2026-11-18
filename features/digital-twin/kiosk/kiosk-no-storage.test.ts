import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Nothing of a visit outlives it: the kiosk keeps its session in memory
 * only. No file of the kiosk reaches for browser storage, cookies or the
 * shared panel memory, so a reset back to the attract loop leaves nothing
 * for the next person to find.
 */
const DIR = fileURLToPath(new URL(".", import.meta.url));
const SOURCES = readdirSync(DIR).filter(
  (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
);
const STORAGE =
  /localStorage|sessionStorage|indexedDB|document\.cookie|usePanelOpen|caches\./;

describe("the kiosk keeps nothing", () => {
  test("reads its own source files", () => {
    expect(SOURCES).toContain("kiosk-screen.tsx");
    expect(SOURCES).toContain("kiosk-session.ts");
  });

  test("no kiosk file touches browser storage or cookies", () => {
    expect(
      SOURCES.filter((name) => STORAGE.test(readFileSync(`${DIR}/${name}`, "utf8"))),
    ).toEqual([]);
  });
});
