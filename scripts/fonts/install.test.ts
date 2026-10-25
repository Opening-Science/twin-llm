import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  BRAND_FONTS,
  defaultFontsDir,
  runFontsInstall,
  type InstallDeps,
} from "./install";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Two synthetic "fonts" with honest pins, so no licensed file is needed. */
const A = new Uint8Array([1, 2, 3]);
const B = new Uint8Array([4, 5]);
const FONTS = { "A.woff2": sha256(A), "B.woff2": sha256(B) };

const harness = (files: Record<string, Uint8Array>) => {
  const disk: Record<string, Uint8Array> = { ...files };
  const written: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: InstallDeps = {
    readFile: async (path) => disk[path] ?? null,
    writeFile: async (path, bytes) => {
      written.push(path);
      disk[path] = bytes;
    },
    mkdir: async () => {},
    sha256,
    targetDir: "/repo/public/fonts",
    defaultSourceDir: "/brand/fonts",
    fonts: FONTS,
  };
  const io = {
    stdout: { write: (s: string) => void out.push(s) },
    stderr: { write: (s: string) => void err.push(s) },
  };
  return { deps, io, disk, written, out, err };
};

describe("runFontsInstall", () => {
  test("copies every pinned file from the default folder", async () => {
    const h = harness({ "/brand/fonts/A.woff2": A, "/brand/fonts/B.woff2": B });
    expect(await runFontsInstall([], h.io, h.deps)).toBe(0);
    expect(h.written).toEqual([
      "/repo/public/fonts/A.woff2",
      "/repo/public/fonts/B.woff2",
    ]);
    // The bytes that were hashed are the bytes written, not a second read.
    expect(h.disk["/repo/public/fonts/A.woff2"]).toBe(h.disk["/brand/fonts/A.woff2"]!);
    expect(h.out.join("")).toBe("installed  A.woff2\ninstalled  B.woff2\n");
  });

  test("a folder on the command line wins over the default", async () => {
    const h = harness({ "/elsewhere/A.woff2": A, "/elsewhere/B.woff2": B });
    expect(await runFontsInstall(["/elsewhere"], h.io, h.deps)).toBe(0);
    expect(h.disk["/repo/public/fonts/A.woff2"]).toBe(h.disk["/elsewhere/A.woff2"]!);
  });

  test("refuses a file whose hash is not the licensed one", async () => {
    const h = harness({
      "/brand/fonts/A.woff2": new Uint8Array([9, 9, 9]),
      "/brand/fonts/B.woff2": B,
    });
    expect(await runFontsInstall([], h.io, h.deps)).toBe(1);
    expect(h.written).toEqual(["/repo/public/fonts/B.woff2"]);
    expect(h.err.join("")).toBe(
      "mismatch   A.woff2: not the licensed file, not copied\n" +
        "1 of 2 fonts not in place. The app falls back to system fonts.\n",
    );
  });

  test("reports a missing source file and exits 1", async () => {
    const h = harness({ "/brand/fonts/A.woff2": A });
    expect(await runFontsInstall([], h.io, h.deps)).toBe(1);
    expect(h.err[0]).toBe("missing    B.woff2 (not in /brand/fonts)\n");
  });

  test("leaves files already in place alone", async () => {
    const h = harness({
      "/repo/public/fonts/A.woff2": A,
      "/repo/public/fonts/B.woff2": B,
    });
    expect(await runFontsInstall([], h.io, h.deps)).toBe(0);
    expect(h.written).toEqual([]);
    expect(h.out.join("")).toBe("present    A.woff2\npresent    B.woff2\n");
  });

  test("does not replace a wrong file already in public/fonts without --force", async () => {
    const wrong = new Uint8Array([7, 7]);
    const h = harness({
      "/brand/fonts/A.woff2": A,
      "/brand/fonts/B.woff2": B,
      "/repo/public/fonts/A.woff2": wrong,
    });
    expect(await runFontsInstall([], h.io, h.deps)).toBe(1);
    expect(h.written).toEqual(["/repo/public/fonts/B.woff2"]);
    expect(h.disk["/repo/public/fonts/A.woff2"]).toBe(wrong);
    expect(h.err[0]).toBe(
      "mismatch   A.woff2: public/fonts/ holds a different file; rerun with --force to replace it\n",
    );
  });

  test("--force replaces a wrong file and says so", async () => {
    const h = harness({
      "/brand/fonts/A.woff2": A,
      "/brand/fonts/B.woff2": B,
      "/repo/public/fonts/A.woff2": new Uint8Array([7, 7]),
    });
    expect(await runFontsInstall(["--force"], h.io, h.deps)).toBe(0);
    expect(h.disk["/repo/public/fonts/A.woff2"]).toBe(A);
    expect(h.out.join("")).toBe(
      "replaced   A.woff2 (was mismatched)\ninstalled  B.woff2\n",
    );
  });

  test("--check copies nothing and names what is missing", async () => {
    const h = harness({ "/brand/fonts/A.woff2": A, "/repo/public/fonts/B.woff2": B });
    expect(await runFontsInstall(["--check"], h.io, h.deps)).toBe(1);
    expect(h.written).toEqual([]);
    expect(h.out.join("")).toBe("missing    A.woff2\npresent    B.woff2\n");
  });
});

test("the default folder is ~/Developer/osf-brand/fonts", () => {
  expect(defaultFontsDir("/Users/someone")).toBe(
    "/Users/someone/Developer/osf-brand/fonts",
  );
});

test("every font the CSS asks for is pinned, and nothing else", () => {
  const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");
  const asked = [...css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((m) => m[1]).sort();
  expect(asked).toEqual(Object.keys(BRAND_FONTS).sort());
});
