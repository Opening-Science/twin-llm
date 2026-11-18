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

const COMMIT = "b7af336aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const BUILD: BuildInfo = {
  appVersion: "0.1.0",
  commit: COMMIT,
  dirty: false,
  mode: "build",
};

const DISK: DiskProvenance = { commit: COMMIT };

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
    ]);
    expect(unavailableCheck(provenanceBase).howTo).toBe(result.howTo);
  });

  test("a commit made after the build means a rebuild is needed, not ok", () => {
    const result = check({}, { commit: "c".repeat(40) });
    expect(result.status).toBe("unknown");
    expect(result.summary).toBe(
      "This server runs a clean build of b7af336aaaaa, but the files on disk changed since: the checkout is at cccccccccccc. Rebuild needed to run them.",
    );
  });

  test("a development server is unknown", () => {
    const dev = check({ mode: "dev" });
    expect(dev.status).toBe("unknown");
    expect(dev.summary).toStartWith("This is a development server.");
    expect(dev.links?.length).toBe(3);
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

  test("no commit is unknown", () => {
    expect(check({ commit: null }).status).toBe("unknown");
  });
});

describe("changedSinceBuild", () => {
  test("ignores what could not be read now", () => {
    expect(changedSinceBuild(BUILD, { commit: null })).toEqual([]);
  });
});
