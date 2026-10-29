import { describe, expect, test } from "bun:test";

import {
  parseOpenTwinPin,
  parseOpenTwinShaFile,
  provenanceCheck,
  provenanceLinks,
} from "./provenance-check";

const PIN = "a9e126c952c91e19e064a962dda7d815a43564e5";
const COMMIT = "b7af336aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const BASE = {
  appVersion: "0.1.0",
  commit: COMMIT,
  dirty: false,
  openTwinPinned: PIN,
  openTwinFound: PIN,
};

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

describe("parseOpenTwinShaFile", () => {
  test("trims and checks the SHA", () => {
    expect(parseOpenTwinShaFile(`${PIN}\n`)).toBe(PIN);
    expect(parseOpenTwinShaFile("main\n")).toBe(null);
  });
});

describe("provenanceLinks", () => {
  test("a clean commit links to files at that commit", () => {
    expect(provenanceLinks(COMMIT, false)[0]).toEqual({
      label: "PROVENANCE.md",
      href: `https://github.com/Opening-Science/twin-llm/blob/${COMMIT}/PROVENANCE.md`,
    });
    expect(provenanceLinks(COMMIT, false).length).toBe(4);
  });
  test("a dirty or unknown build links to main", () => {
    expect(provenanceLinks(COMMIT, true).map((link) => link.href)).toEqual([
      "https://github.com/Opening-Science/twin-llm/blob/main/PROVENANCE.md",
      "https://github.com/Opening-Science/twin-llm/blob/main/NOTICE",
      "https://github.com/Opening-Science/twin-llm/blob/main/LICENSE",
    ]);
    expect(provenanceLinks(null, false).length).toBe(3);
  });
});

describe("provenanceCheck", () => {
  test("clean commit and matching pin is ok", () => {
    const check = provenanceCheck(BASE);
    expect(check.status).toBe("ok");
    expect(check.evidence).toEqual([
      { label: "App version", value: "0.1.0", mono: true },
      { label: "Git commit (build)", value: "b7af336aaaaa", mono: true },
      { label: "open-twin pin (PROVENANCE.md)", value: "a9e126c952c9", mono: true },
      { label: "open-twin checkout", value: "a9e126c952c9", mono: true },
    ]);
  });
  test("a different open-twin checkout is not ok", () => {
    expect(provenanceCheck({ ...BASE, openTwinFound: "f".repeat(40) }).status).toBe(
      "not-ok",
    );
  });
  test("a dirty build is unknown and says so", () => {
    const check = provenanceCheck({ ...BASE, dirty: true });
    expect(check.status).toBe("unknown");
    expect(check.evidence[1].value).toBe("b7af336aaaaa with uncommitted changes");
  });
  test("no commit is unknown", () => {
    expect(provenanceCheck({ ...BASE, commit: null }).status).toBe("unknown");
  });
  test("a missing open-twin checkout is unknown", () => {
    expect(provenanceCheck({ ...BASE, openTwinFound: null }).status).toBe("unknown");
  });
});
