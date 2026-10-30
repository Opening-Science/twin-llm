import { describe, expect, test } from "bun:test";

import {
  dirtyFlag,
  parseCommit,
  parseDirtyFlag,
  parseOpenTwinPin,
  parseOpenTwinShaFile,
} from "./build-stamp";

const PIN = "a9e126c952c91e19e064a962dda7d815a43564e5";

describe("parseOpenTwinPin", () => {
  test("reads the SHA under the synced line", () => {
    expect(
      parseOpenTwinPin(
        `## open-twin pins\n\nSynced (not vendored) at SHA:\n\n- \`${PIN}\`\n`,
      ),
    ).toBe(PIN);
  });
  test("null without that line", () => {
    expect(parseOpenTwinPin("# PROVENANCE\n")).toBe(null);
  });
});

describe("parseOpenTwinShaFile and parseCommit", () => {
  test("trim and check the SHA", () => {
    expect(parseOpenTwinShaFile(`${PIN}\n`)).toBe(PIN);
    expect(parseOpenTwinShaFile("main\n")).toBe(null);
    expect(parseCommit(`${PIN.toUpperCase()}\n`)).toBe(PIN);
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
