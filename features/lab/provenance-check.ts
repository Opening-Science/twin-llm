import { type LabCheck, type LabLink, shortHash } from "./lab-check";

/**
 * Which code this server was built from: the app version and git commit
 * written in at build time, and the open-twin pin PROVENANCE.md records
 * against the one the `.open-twin/` checkout says it holds.
 */

const REPO = "https://github.com/Opening-Science/twin-llm";
const SHA = /^[0-9a-f]{40}$/;

/** The open-twin SHA under "Synced (not vendored) at SHA:" in PROVENANCE.md. */
export const parseOpenTwinPin = (provenance: string): string | null => {
  const match = /Synced \(not vendored\) at SHA:\s*-\s*`([0-9a-f]{40})`/.exec(provenance);
  return match ? match[1] : null;
};

/** `.open-twin/OPEN_TWIN_SHA`: one SHA, maybe with a newline. */
export const parseOpenTwinShaFile = (text: string): string | null => {
  const sha = text.trim().toLowerCase();
  return SHA.test(sha) ? sha : null;
};

export type ProvenanceInput = Readonly<{
  appVersion: string | null;
  commit: string | null;
  dirty: boolean;
  /** From PROVENANCE.md. */
  openTwinPinned: string | null;
  /** From `.open-twin/OPEN_TWIN_SHA`. */
  openTwinFound: string | null;
}>;

/** Licence files at the build's commit when it is known and clean, else on main. */
export const provenanceLinks = (
  commit: string | null,
  dirty: boolean,
): readonly LabLink[] => {
  const ref = commit !== null && SHA.test(commit) && !dirty ? commit : "main";
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

const statusAndSummary = (
  input: ProvenanceInput,
): Pick<LabCheck, "status" | "summary"> => {
  const { commit, dirty, openTwinPinned, openTwinFound } = input;
  if (
    openTwinPinned !== null &&
    openTwinFound !== null &&
    openTwinPinned !== openTwinFound
  ) {
    return {
      status: "not-ok",
      summary:
        "The open-twin checkout is not the commit PROVENANCE.md pins. Run `bun run sync:open-twin` and rebuild.",
    };
  }
  if (commit === null) {
    return {
      status: "unknown",
      summary:
        "This build has no git commit recorded, so the code it runs cannot be traced to one.",
    };
  }
  if (dirty) {
    return {
      status: "unknown",
      summary:
        "This build was made from a working tree with changes that are not in its commit.",
    };
  }
  if (openTwinPinned === null || openTwinFound === null) {
    return {
      status: "unknown",
      summary: "The build commit is known, but the open-twin pin could not be compared.",
    };
  }
  return {
    status: "ok",
    summary:
      "Built from a clean commit, and the open-twin checkout is the commit PROVENANCE.md pins.",
  };
};

export const provenanceCheck = (input: ProvenanceInput): LabCheck => ({
  id: "provenance",
  title: "Provenance",
  ...statusAndSummary(input),
  evidence: [
    { label: "App version", value: input.appVersion ?? "—", mono: true },
    {
      label: "Git commit (build)",
      value:
        input.commit === null
          ? "—"
          : `${shortHash(input.commit)}${input.dirty ? " with uncommitted changes" : ""}`,
      mono: true,
    },
    {
      label: "open-twin pin (PROVENANCE.md)",
      value: shortHash(input.openTwinPinned),
      mono: true,
    },
    { label: "open-twin checkout", value: shortHash(input.openTwinFound), mono: true },
  ],
  howTo: HOW_TO,
  links: provenanceLinks(input.commit, input.dirty),
});
