import {
  EVAL_COHORT_ARCHIVE,
  SYNTHEA_JAR_SHA256,
  SYNTHEA_VERSION,
} from "@/infrastructure/local-artefacts";
import { ATLAS_IDS, ATLASES } from "@/packages/anatomy/manifest";
import { DEMO_BODIES, DEMO_BODY_IDS } from "@/packages/anatomy/demo-bodies";
import { RIGGED_BODIES } from "@/packages/anatomy/rigged-bodies";

import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * Files the app downloads or builds and pins by SHA-256: the Synthea JAR, the
 * evaluation cohort archive and the anatomy models. The server hashes the
 * ones on this machine; this module lists the pins and compares.
 */

export type PinnedArtefact = Readonly<{
  id: string;
  name: string;
  /** Where the file is looked for, as shown and as passed to sha256sum. */
  path: string;
  expectedSha256: string;
  /**
   * A rigged body baked on this machine can differ in the last bits of a
   * float and still be the same body, so a different hash there is not a
   * failure, only unconfirmed.
   */
  onMismatch: "not-ok" | "unknown";
}>;

export type ArtefactDirs = Readonly<{
  syntheaJar: string;
  syntheaDownloads: string;
  anatomy: string;
}>;

const join = (dir: string, file: string): string =>
  dir === "" || dir === "." ? file : `${dir.replace(/\/+$/, "")}/${file}`;

export const pinnedArtefacts = (dirs: ArtefactDirs): readonly PinnedArtefact[] => [
  {
    id: "synthea-jar",
    name: `Synthea ${SYNTHEA_VERSION} JAR`,
    path: dirs.syntheaJar,
    expectedSha256: SYNTHEA_JAR_SHA256,
    onMismatch: "not-ok",
  },
  {
    id: "eval-cohort",
    name: `Evaluation cohort (${EVAL_COHORT_ARCHIVE.tag})`,
    path: join(dirs.syntheaDownloads, EVAL_COHORT_ARCHIVE.archive),
    expectedSha256: EVAL_COHORT_ARCHIVE.archiveSha256,
    onMismatch: "not-ok",
  },
  ...ATLAS_IDS.map((id) => ({
    id: `atlas-${id}`,
    name: `Atlas: ${ATLASES[id].name}`,
    path: join(dirs.anatomy, ATLASES[id].fileName),
    expectedSha256: ATLASES[id].sha256,
    onMismatch: "not-ok" as const,
  })),
  ...DEMO_BODY_IDS.map((id) => ({
    id: `body-${id}`,
    name: DEMO_BODIES[id].name,
    path: join(dirs.anatomy, DEMO_BODIES[id].fileName),
    expectedSha256: DEMO_BODIES[id].sha256,
    onMismatch: "not-ok" as const,
  })),
  ...DEMO_BODY_IDS.map((id) => ({
    id: `rigged-${id}`,
    name: RIGGED_BODIES[id].name,
    path: join(dirs.anatomy, RIGGED_BODIES[id].fileName),
    expectedSha256: RIGGED_BODIES[id].sha256,
    onMismatch: "unknown" as const,
  })),
];

export type ArtefactResult = "matches" | "differs" | "not present";

/** `found` is the file's SHA-256, or null when there is no file. */
export const artefactResult = (expected: string, found: string | null): ArtefactResult =>
  found === null
    ? "not present"
    : found.toLowerCase() === expected.toLowerCase()
      ? "matches"
      : "differs";

const RESULT_TEXT: Readonly<Record<ArtefactResult, string>> = {
  matches: "Matches",
  differs: "Differs",
  "not present": "Not on this machine",
};

const quote = (path: string): string =>
  /^[\w./-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;

export const pinnedArtefactsCheck = (
  pins: readonly PinnedArtefact[],
  found: Readonly<Record<string, string | null>>,
): LabCheck => {
  const rows = pins.map((pin) => {
    const sha = found[pin.id] ?? null;
    return { pin, sha, result: artefactResult(pin.expectedSha256, sha) };
  });
  const present = rows.filter((row) => row.result !== "not present");
  const failed = rows.filter(
    (row) => row.result === "differs" && row.pin.onMismatch === "not-ok",
  );
  const unconfirmed = rows.filter(
    (row) => row.result === "differs" && row.pin.onMismatch === "unknown",
  );
  const matching = rows.filter((row) => row.result === "matches");
  const status =
    failed.length > 0
      ? "not-ok"
      : present.length === 0 || unconfirmed.length > 0
        ? "unknown"
        : "ok";
  const missing = rows.length - present.length;
  const parts = [
    present.length === 0
      ? "None of the pinned files is on this machine yet."
      : `Files on this machine that match their pins: ${matching.length} of ${present.length}.`,
    failed.length > 0
      ? `Different bytes: ${failed.map((row) => row.pin.name).join(", ")}.`
      : "",
    unconfirmed.length > 0
      ? `${unconfirmed.map((row) => row.pin.name).join(", ")} differ, which a local bake can do; \`bun run anatomy:bake-rigged\` checks its content digest.`
      : "",
    missing > 0 && present.length > 0
      ? `Not on this machine: ${plural(missing, "file")}.`
      : "",
  ];
  return {
    id: "pinned-artefacts",
    title: "Pinned artefacts",
    status,
    summary: parts.filter((part) => part !== "").join(" "),
    evidence: [],
    table: {
      caption: "Pinned files, expected and found SHA-256 (first 12 characters)",
      columns: ["File", "Expected", "Found", "Result"],
      rows: rows.map(({ pin, sha, result }) => [
        pin.name,
        shortHash(pin.expectedSha256),
        shortHash(sha),
        RESULT_TEXT[result],
      ]),
    },
    howTo: `sha256sum ${pins.map((pin) => quote(pin.path)).join(" \\\n  ")}`,
    links: [
      {
        label: "Where the pins are recorded (PROVENANCE.md)",
        href: "https://github.com/Opening-Science/twin-llm/blob/main/PROVENANCE.md",
      },
    ],
  };
};
