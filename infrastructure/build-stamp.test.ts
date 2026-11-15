import { describe, expect, test } from "bun:test";

import { dirtyFlag, parseCommit, parseDirtyFlag } from "./build-stamp";

const SHA = "a9e126c952c91e19e064a962dda7d815a43564e5";

describe("parseCommit", () => {
  test("trims and checks the SHA", () => {
    expect(parseCommit(`${SHA.toUpperCase()}\n`)).toBe(SHA);
    expect(parseCommit("main\n")).toBe(null);
    expect(parseCommit(null)).toBe(null);
  });
});

describe("dirtyFlag", () => {
  test("a git status that failed is unknown, not clean", () => {
    expect(dirtyFlag(null)).toBe("unknown");
    expect(parseDirtyFlag(dirtyFlag(null))).toBe(null);
  });
  test("empty output is clean, any line is dirty", () => {
    expect(dirtyFlag("")).toBe("false");
    expect(dirtyFlag(" M app/page.tsx")).toBe("true");
    expect(parseDirtyFlag("false")).toBe(false);
    expect(parseDirtyFlag("true")).toBe(true);
    expect(parseDirtyFlag(undefined)).toBe(null);
  });
});
