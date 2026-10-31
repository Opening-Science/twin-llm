import { describe, expect, test } from "bun:test";

import { ANCHOR_USAGE, parseAnchorArgs } from "./anchor-args";

describe("parseAnchorArgs", () => {
  test("one command per run", () => {
    expect(parseAnchorArgs(["init"])).toEqual({
      ok: true,
      args: { command: "init", withoutOldKey: false },
    });
    expect(parseAnchorArgs(["rotate", "--", "--without-old-key"])).toEqual({
      ok: true,
      args: { command: "rotate", withoutOldKey: true },
    });
  });

  test("an unknown command or flag prints the usage", () => {
    expect(parseAnchorArgs([])).toEqual({ ok: false, error: ANCHOR_USAGE });
    expect(parseAnchorArgs(["send"])).toEqual({ ok: false, error: ANCHOR_USAGE });
    expect(parseAnchorArgs(["write", "--now"])).toEqual({
      ok: false,
      error: `anchor: unknown flag --now\n${ANCHOR_USAGE}`,
    });
  });

  test("--without-old-key is for rotate only", () => {
    expect(parseAnchorArgs(["init", "--without-old-key"])).toEqual({
      ok: false,
      error: "anchor: --without-old-key goes with rotate only",
    });
  });
});
