import { describe, expect, test } from "bun:test";

import type { BuildInfo } from "@/infrastructure/env";

import { unavailableCheck } from "./lab-check";
import {
  changedSinceBuild,
  type DiskProvenance,
  provenanceBase,
  provenanceCheck,
  provenanceLinks,
} from "./provenance-check";

const PIN = "a9e126c952c91e19e064a962dda7d815a43564e5";
const OTHER = "f".repeat(40);
const COMMIT = "b7af336aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const BUILD: BuildInfo = {
  appVersion: "0.1.0",
  commit: COMMIT,
  dirty: false,
  openTwinPinned: PIN,
  openTwinFound: PIN,
  mode: "build",
};

const DISK: DiskProvenance = { commit: COMMIT, openTwinPinned: PIN, openTwinFound: PIN };

const check = (build: Partial<BuildInfo> = {}, disk: Partial<DiskProvenance> = {}) =>
  provenanceCheck({ build: { ...BUILD, ...build }, disk: { ...DISK, ...disk } });

describe("provenanceLinks", () => {
  test("a clean commit links to files at that commit", () => {
    expect(provenanceLinks(COMMIT, false)[0]).toEqual({
      label: "PROVENANCE.md",
      href: `https://github.com/Opening-Science/twin-llm/blob/${COMMIT}/PROVENANCE.md`,
    });
    expect(provenanceLinks(COMMIT, false).length).toBe(4);
  });
  test("a dirty, unknown or missing build links to main", () => {
    expect(provenanceLinks(COMMIT, true).map((link) => link.href)).toEqual([
      "https://github.com/Opening-Science/twin-llm/blob/main/PROVENANCE.md",
      "https://github.com/Opening-Science/twin-llm/blob/main/NOTICE",
      "https://github.com/Opening-Science/twin-llm/blob/main/LICENSE",
    ]);
    expect(provenanceLinks(COMMIT, null).length).toBe(3);
    expect(provenanceLinks(null, false).length).toBe(3);
  });
});

describe("provenanceCheck", () => {
  test("a clean build that is still the checkout is ok", () => {
    const result = check();
    expect(result.status).toBe("ok");
    expect(result.evidence).toEqual([
      { label: "App version", value: "0.1.0", mono: true },
      { label: "Git commit (build)", value: "b7af336aaaaa", mono: true },
      { label: "Git commit (checkout now)", value: "b7af336aaaaa", mono: true },
      { label: "open-twin pin (build)", value: "a9e126c952c9", mono: true },
      { label: "open-twin checkout (build)", value: "a9e126c952c9", mono: true },
    ]);
    expect(unavailableCheck(provenanceBase).howTo).toBe(result.howTo);
  });

  test("a build whose open-twin checkout was not the pin is not ok", () => {
    expect(check({ openTwinFound: OTHER }).status).toBe("not-ok");
  });

  test("a commit made after the build means a rebuild is needed, not ok", () => {
    const result = check({}, { commit: "c".repeat(40) });
    expect(result.status).toBe("unknown");
    expect(result.summary).toBe(
      "This server runs a clean build of b7af336aaaaa, but the files on disk changed since: the checkout is at cccccccccccc. Rebuild needed to run them.",
    );
  });

  test("a new pin synced on disk without a rebuild is not reported as ok", () => {
    const result = check({}, { openTwinPinned: OTHER, openTwinFound: OTHER });
    expect(result.status).toBe("unknown");
    expect(result.summary).toContain(
      "PROVENANCE.md pins another open-twin commit; .open-twin/ holds another commit",
    );
  });

  test("a development server is unknown, judged on the files on disk", () => {
    const dev = check({ mode: "dev" });
    expect(dev.status).toBe("unknown");
    expect(dev.summary).toStartWith("This is a development server.");
    expect(dev.links?.length).toBe(3);
    expect(check({ mode: "dev" }, { openTwinFound: OTHER }).status).toBe("not-ok");
  });

  test("a dirty build is unknown and says so", () => {
    const result = check({ dirty: true });
    expect(result.status).toBe("unknown");
    expect(result.evidence[1].value).toBe("b7af336aaaaa with uncommitted changes");
  });

  test("a build whose git status failed is unknown, never clean", () => {
    const result = check({ dirty: null });
    expect(result.status).toBe("unknown");
    expect(result.evidence[1].value).toBe("b7af336aaaaa, working tree not checked");
  });

  test("no commit or no pin is unknown", () => {
    expect(check({ commit: null }).status).toBe("unknown");
    expect(check({ openTwinFound: null }).status).toBe("unknown");
  });
});

describe("changedSinceBuild", () => {
  test("ignores what could not be read now", () => {
    expect(
      changedSinceBuild(BUILD, {
        commit: null,
        openTwinPinned: null,
        openTwinFound: null,
      }),
    ).toEqual([]);
  });
});
