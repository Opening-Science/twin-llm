/**
 * The open-anatomy skeleton: one CT case's bones as a GLB, with `atlas.json`
 * beside it. Built from public CC BY CT data (not a real person's scan of this
 * body) and never committed here; ANATOMY_SKELETON_GLB names a local file.
 *
 * What the viewer reads:
 * - from each GLB node: its name (the ontology id, `FMA_7485`), and in
 *   `extras` the term, the English name (`name`, or `label` in the explode
 *   contract), `modelled` and, when present, `explode`;
 * - from atlas.json: the case, its scope, an attribution when it gives one,
 *   the structures it left out (`excluded`, and Stage 1's `girdleLeftOut`)
 *   and the structures it marks as modelled.
 *
 * A left-out structure is never drawn and never named as present; the panel
 * says it is left out. Pure: parsing and matching only.
 */
import { parseExplode, type ExplodeVector } from "./explode";

export type LeftOut = Readonly<{ label: string; reason: string | null }>;

export type SkeletonAtlas = Readonly<{
  /** The open-anatomy case id, e.g. `s0086`; null when neither file names one. */
  caseId: string | null;
  scope: string | null;
  attribution: string | null;
  excluded: readonly LeftOut[];
  /** Node names, terms or labels atlas.json marks as modelled. */
  modelled: readonly string[];
}>;

export type SkeletonNode = Readonly<{
  /** The node name: the ontology id with `_` for `:`. */
  name: string;
  term: string | null;
  /** English name for display, first letter capitalised. */
  label: string;
  modelled: boolean;
  explode: ExplodeVector | null;
}>;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const entryLabel = (value: unknown): string | null => {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return text(row.label) ?? text(row.name) ?? text(row.term);
};

const leftOut = (value: unknown): LeftOut | null => {
  const label = entryLabel(value);
  if (label === null) return null;
  const reason =
    value && typeof value === "object"
      ? text((value as { reason?: unknown }).reason)
      : null;
  return { label, reason };
};

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** Same key for `FMA:7485`, `FMA_7485`, `Left clavicle` and `left_clavicle`. */
export const matchKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[:\s-]+/g, "_");

/** TotalSegmentator's Latin labels for the bones a scan may cut. */
const LATIN: Readonly<Record<string, string>> = {
  clavicula: "clavicle",
  scapula: "scapula",
  humerus: "humerus",
  femur: "femur",
  hip: "hip bone",
  rib: "rib",
};

const PLURAL: Readonly<Record<string, string>> = {
  clavicle: "clavicles",
  scapula: "scapulae",
  humerus: "humeri",
  femur: "femora",
  "hip bone": "hip bones",
};

/** `clavicula_left` → { part: "clavicle", side: "left" }; other labels keep their words. */
const splitSide = (label: string): Readonly<{ part: string; side: string | null }> => {
  const words = label
    .trim()
    .toLowerCase()
    .split(/[_\s]+/);
  const side = words.find((word) => word === "left" || word === "right") ?? null;
  const rest = words.filter((word) => word !== "left" && word !== "right").join(" ");
  return { part: LATIN[rest] ?? rest, side };
};

/** The English name a left-out label stands for: `clavicula_left` → `left clavicle`. */
export const leftOutName = (label: string): string => {
  const { part, side } = splitSide(label);
  return side ? `${side} ${part}` : part;
};

/** Parses atlas.json (or the status payload built from it); anything odd is dropped. */
export const parseSkeletonAtlas = (value: unknown): SkeletonAtlas => {
  const row =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const excluded = [...list(row.excluded), ...list(row.girdleLeftOut)]
    .map(leftOut)
    .filter((entry): entry is LeftOut => entry !== null);
  // One entry per structure, the first spelling kept: `clavicula_left` and
  // `Left clavicle` are the same bone.
  const unique = excluded.filter(
    (entry, index) =>
      excluded.findIndex(
        (other) =>
          matchKey(leftOutName(other.label)) === matchKey(leftOutName(entry.label)),
      ) === index,
  );
  const fromNodes = list(row.nodes)
    .filter(
      (node) =>
        !!node &&
        typeof node === "object" &&
        (node as { modelled?: unknown }).modelled === true,
    )
    .map(entryLabel);
  const modelled = [...list(row.modelled).map(entryLabel), ...fromNodes].filter(
    (entry): entry is string => entry !== null,
  );
  return {
    caseId: text(row.case) ?? text(row.caseId),
    scope: text(row.scope),
    attribution: text(row.attribution),
    excluded: unique,
    modelled: [...new Set(modelled)],
  };
};

/**
 * Why a configured skeleton is not shown: its file is missing or is not the
 * pinned build, or atlas.json beside it is missing or cannot be read.
 */
export const SKELETON_PROBLEMS = ["file", "atlas-missing", "atlas-invalid"] as const;
export type SkeletonProblem = (typeof SKELETON_PROBLEMS)[number];

export const isSkeletonProblem = (value: unknown): value is SkeletonProblem =>
  typeof value === "string" && (SKELETON_PROBLEMS as readonly string[]).includes(value);

/** What the status says about the skeleton: one of the two is always null. */
export type SkeletonStatus = Readonly<{
  skeleton: SkeletonAtlas | null;
  problem: SkeletonProblem | null;
}>;

export const NO_SKELETON: SkeletonStatus = { skeleton: null, problem: null };

/**
 * The skeleton from atlas.json's text (null: no such file), failing closed:
 * without a readable atlas.json nobody can say what the build left out or
 * who to credit, so the CT skeleton is not shown and the problem is named.
 * The case comes from the GLB's file name when atlas.json has none.
 */
export const skeletonFromAtlasJson = (
  raw: string | null,
  caseFromFile: string | null,
): SkeletonStatus => {
  if (raw === null) return { skeleton: null, problem: "atlas-missing" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { skeleton: null, problem: "atlas-invalid" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { skeleton: null, problem: "atlas-invalid" };
  }
  const atlas = parseSkeletonAtlas(value);
  return {
    skeleton: atlas.caseId ? atlas : { ...atlas, caseId: caseFromFile },
    problem: null,
  };
};

const capitalise = (value: string): string =>
  value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/** A GLB node as the viewer needs it. Extras come from GLTFLoader's `userData`. */
export const readSkeletonNode = (
  name: string,
  extras: Readonly<Record<string, unknown>>,
): SkeletonNode => {
  const term = text(extras.term);
  const label = text(extras.label) ?? text(extras.name) ?? term ?? name;
  return {
    name,
    term,
    label: capitalise(label),
    modelled: extras.modelled === true,
    explode: parseExplode(extras.explode),
  };
};

const nodeKeys = (node: SkeletonNode): ReadonlySet<string> =>
  new Set(
    [node.name, node.term, node.label]
      .filter((key): key is string => key !== null)
      .map(matchKey),
  );

/** Whether atlas.json leaves this node out, by its id, term, name or Latin label. */
export const isExcluded = (node: SkeletonNode, atlas: SkeletonAtlas): boolean => {
  const keys = nodeKeys(node);
  return atlas.excluded.some(
    (entry) =>
      keys.has(matchKey(entry.label)) || keys.has(matchKey(leftOutName(entry.label))),
  );
};

/** Modelled when the node says so or atlas.json lists it. */
export const isModelled = (node: SkeletonNode, atlas: SkeletonAtlas): boolean => {
  if (node.modelled) return true;
  const keys = nodeKeys(node);
  return atlas.modelled.some((entry) => keys.has(matchKey(entry)));
};

const joinWords = (words: readonly string[]): string =>
  words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/**
 * What was left out, in a few words: both sides of a bone read as its plural
 * ("clavicles"), one side as itself ("left humerus"). Empty when nothing was.
 */
export const leftOutSummary = (excluded: readonly LeftOut[]): string => {
  const byPart = new Map<string, Set<string>>();
  for (const entry of excluded) {
    const { part, side } = splitSide(entry.label);
    const sides = byPart.get(part) ?? new Set<string>();
    byPart.set(part, sides.add(side ?? ""));
  }
  const words = [...byPart.entries()].map(([part, sides]) => {
    if (sides.has("left") && sides.has("right"))
      return PLURAL[part] ?? `${part} (both sides)`;
    const side = [...sides].find((value) => value !== "");
    return side ? `${side} ${part}` : part;
  });
  return joinWords(words);
};
