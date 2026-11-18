import { type BuildInfo } from "@/infrastructure/env";

import { type CheckState, type LabCheck, type LabLink, shortHash } from "./lab-check";

/**
 * Which code this server runs: the app version, git commit and clean-tree
 * flag written in at build time, against the checkout on disk now. A built server runs what it was built from, so the
 * build's values decide, and a checkout that has moved since means a rebuild
 * is needed. `next dev` serves edits as they are saved, so there nothing
 * recorded at startup describes the running code.
 */

const REPO = "https://github.com/Opening-Science/twin-llm";
const SHA = /^[0-9a-f]{40}$/;

/** Read from disk when the page loads; null when it could not be read. */
export type DiskProvenance = Readonly<{
  commit: string | null;
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

const HOW_TO = "git rev-parse HEAD && git status --short";

/** What the list and the check's page show even when the check cannot run. */
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
  ].filter((part) => part !== "");

const statusAndSummary = ({
  build,
  disk,
}: ProvenanceInput): CheckState & Pick<LabCheck, "summary"> => {
  if (build.mode === "dev") {
    return {
      status: "unknown",
      reason: "A development server: no commit describes the code it runs.",
      summary:
        "This is a development server. It serves changes as they are saved, so no commit describes the code it runs. Run `bun run build` and `bun run start` for a build this check can trace.",
    };
  }
  if (build.commit === null) {
    return {
      status: "unknown",
      reason: "This build has no git commit recorded.",
      summary:
        "This build has no git commit recorded, so the code it runs cannot be traced to one.",
    };
  }
  if (build.dirty === null) {
    return {
      status: "unknown",
      reason: "Git could not say whether the build's working tree was clean.",
      summary:
        "Git could not say whether this build's working tree was clean, so it is not known whether the build matches its commit.",
    };
  }
  if (build.dirty) {
    return {
      status: "unknown",
      reason: "Built from a working tree with uncommitted changes.",
      summary:
        "This build was made from a working tree with changes that are not in its commit.",
    };
  }
  const changes = changedSinceBuild(build, disk);
  if (changes.length > 0) {
    return {
      status: "unknown",
      reason: "Files on disk changed since this build; rebuild to run them.",
      summary: `This server runs a clean build of ${shortHash(build.commit)}, but the files on disk changed since: ${changes.join("; ")}. Rebuild needed to run them.`,
    };
  }
  return {
    status: "ok",
    summary: "Built from a clean commit that is still the checkout.",
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
    ],
    links: provenanceLinks(dev ? null : build.commit, build.dirty),
  };
};
