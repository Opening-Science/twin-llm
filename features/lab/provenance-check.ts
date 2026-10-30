import { type BuildInfo } from "@/infrastructure/env";

import { type LabCheck, type LabLink, shortHash } from "./lab-check";

/**
 * Which code this server runs: the app version, git commit, clean-tree flag
 * and open-twin pin and checkout written in at build time, against the
 * checkout on disk now. A built server runs what it was built from, so the
 * build's values decide, and a checkout that has moved since means a rebuild
 * is needed. `next dev` serves edits as they are saved, so there nothing
 * recorded at startup describes the running code.
 */

const REPO = "https://github.com/Opening-Science/twin-llm";
const SHA = /^[0-9a-f]{40}$/;

/** Read from disk when the page loads; null when it could not be read. */
export type DiskProvenance = Readonly<{
  commit: string | null;
  openTwinPinned: string | null;
  openTwinFound: string | null;
}>;

export type ProvenanceInput = Readonly<{ build: BuildInfo; disk: DiskProvenance }>;

/** Licence files at the build's commit when it is known and clean, else on main. */
export const provenanceLinks = (
  commit: string | null,
  dirty: boolean | null,
): readonly LabLink[] => {
  const ref = commit !== null && SHA.test(commit) && dirty === false ? commit : "main";
  return [
    { label: "PROVENANCE.md", href: `${REPO}/blob/${ref}/PROVENANCE.md` },
    { label: "NOTICE", href: `${REPO}/blob/${ref}/NOTICE` },
    { label: "LICENSE (Apache-2.0)", href: `${REPO}/blob/${ref}/LICENSE` },
    ...(ref === "main"
      ? []
      : [{ label: "Source at this commit", href: `${REPO}/tree/${ref}` }]),
  ];
};

const HOW_TO = [
  "git rev-parse HEAD && git status --short",
  "cat .open-twin/OPEN_TWIN_SHA",
  "grep -A2 'Synced (not vendored)' PROVENANCE.md",
].join("\n");

/** What the card shows even when the check cannot run. */
export const provenanceBase = {
  id: "provenance",
  title: "Provenance",
  howTo: HOW_TO,
} as const;

/** What changed on disk since the build, in words; empty when nothing did. */
export const changedSinceBuild = (build: BuildInfo, disk: DiskProvenance): string[] =>
  [
    disk.commit !== null && disk.commit !== build.commit
      ? `the checkout is at ${shortHash(disk.commit)}`
      : "",
    disk.openTwinPinned !== null && disk.openTwinPinned !== build.openTwinPinned
      ? "PROVENANCE.md pins another open-twin commit"
      : "",
    disk.openTwinFound !== null && disk.openTwinFound !== build.openTwinFound
      ? ".open-twin/ holds another commit"
      : "",
  ].filter((part) => part !== "");

const statusAndSummary = ({
  build,
  disk,
}: ProvenanceInput): Pick<LabCheck, "status" | "summary"> => {
  // Under `next dev` the open-twin packages compile from disk as they are now.
  const running = build.mode === "dev" ? disk : build;
  if (
    running.openTwinPinned !== null &&
    running.openTwinFound !== null &&
    running.openTwinPinned !== running.openTwinFound
  ) {
    return {
      status: "not-ok",
      summary:
        "The open-twin checkout this server runs is not the commit PROVENANCE.md pins. Run `bun run sync:open-twin` and rebuild.",
    };
  }
  if (build.mode === "dev") {
    return {
      status: "unknown",
      summary:
        "This is a development server. It serves changes as they are saved, so no commit describes the code it runs. Run `bun run build` and `bun run start` for a build this card can trace.",
    };
  }
  if (build.commit === null) {
    return {
      status: "unknown",
      summary:
        "This build has no git commit recorded, so the code it runs cannot be traced to one.",
    };
  }
  if (build.dirty === null) {
    return {
      status: "unknown",
      summary:
        "Git could not say whether this build's working tree was clean, so it is not known whether the build matches its commit.",
    };
  }
  if (build.dirty) {
    return {
      status: "unknown",
      summary:
        "This build was made from a working tree with changes that are not in its commit.",
    };
  }
  if (build.openTwinPinned === null || build.openTwinFound === null) {
    return {
      status: "unknown",
      summary: "The build commit is known, but the open-twin pin could not be compared.",
    };
  }
  const changes = changedSinceBuild(build, disk);
  if (changes.length > 0) {
    return {
      status: "unknown",
      summary: `This server runs a clean build of ${shortHash(build.commit)}, but the files on disk changed since: ${changes.join("; ")}. Rebuild needed to run them.`,
    };
  }
  return {
    status: "ok",
    summary:
      "Built from a clean commit that is still the checkout, and the open-twin checkout is the commit PROVENANCE.md pins.",
  };
};

const commitText = (build: BuildInfo): string =>
  build.commit === null
    ? "—"
    : `${shortHash(build.commit)}${
        build.dirty === null
          ? ", working tree not checked"
          : build.dirty
            ? " with uncommitted changes"
            : ""
      }`;

export const provenanceCheck = (input: ProvenanceInput): LabCheck => {
  const { build, disk } = input;
  const dev = build.mode === "dev";
  return {
    ...provenanceBase,
    ...statusAndSummary(input),
    evidence: [
      { label: "App version", value: build.appVersion ?? "—", mono: true },
      {
        label: dev ? "Git commit (server start)" : "Git commit (build)",
        value: commitText(build),
        mono: true,
      },
      { label: "Git commit (checkout now)", value: shortHash(disk.commit), mono: true },
      {
        label: dev ? "open-twin pin (PROVENANCE.md now)" : "open-twin pin (build)",
        value: shortHash(dev ? disk.openTwinPinned : build.openTwinPinned),
        mono: true,
      },
      {
        label: dev ? "open-twin checkout (now)" : "open-twin checkout (build)",
        value: shortHash(dev ? disk.openTwinFound : build.openTwinFound),
        mono: true,
      },
    ],
    links: provenanceLinks(dev ? null : build.commit, build.dirty),
  };
};
