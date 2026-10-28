/**
 * The `anatomy_note` family (#210, anatomy track): which body system and
 * region a biomarker belongs to, read with `knowledge_search` from TwinLLM's
 * own OpenTwin biomarker catalogue. The answer cites the passage it found
 * (file, section and the catalogue's line) and says nothing the passage does
 * not. A marker the notes do not list gets an honest "nothing found". It is
 * reference material, never a statement about a person. Pure apart from `run`.
 */
import { anchorLayer, type Biomarker } from "../../packages/biomarkers/anchor-layer";
import { biomarkerByLoinc, listBiomarkers } from "../../packages/biomarkers/catalogue";
import { pick } from "../synthetic-wearables/random";

import {
  asked,
  type Draft,
  type Family,
  type FamilyContext,
  sections,
} from "./family-kit";
import { catalogueLine, type KnowledgeHit } from "./knowledge-notes";
import { ABSENT_MEASURES } from "./measures";
import { type Bank, askFrom } from "./questions";

/** Placeholders: {name} {code}. */
export const ANATOMY_BANK = {
  anatomyNote: {
    formal: [
      "Which body system and region does {name} (LOINC {code}) relate to?",
      "Where in the body does the biomarker catalogue place {name} (LOINC {code})?",
    ],
    casual: [
      "which organ is {name} ({code}) about?",
      "where does {name} sit in the body? LOINC {code}",
    ],
    terse: ["{name} {code}: system and region", "body region for LOINC {code} ({name})"],
    non_native: [
      "To which organ belongs the {name} (LOINC {code})?",
      "Please say me the body system of {name}, LOINC {code}.",
    ],
  },
} as const satisfies Readonly<Record<string, Bank>>;

export type AnatomyMarker = Readonly<{ name: string; code: string }>;

/** A short English name from the LOINC display: "Cholesterol [Mass/volume] in Serum" → "Cholesterol". */
export const shortName = (display: string): string =>
  (display.split(" [")[0] ?? display).replace(/ in (Serum or Plasma|Blood|Stool)$/, "");

const asMarker = (marker: Biomarker): AnatomyMarker => ({
  name: shortName(marker.loincDisplay),
  code: marker.loincCode,
});

/** The catalogue's markers, in its own order. */
export const CATALOGUE_MARKERS: readonly [AnatomyMarker, ...AnatomyMarker[]] = (() => {
  const [first, ...rest] = listBiomarkers(anchorLayer).map(asMarker);
  if (first === undefined) throw new Error("the Anchor catalogue is empty");
  return [first, ...rest];
})();

/** Codes the training asks about that the catalogue does not list, for the "nothing found" case. */
export const UNLISTED_MARKERS: readonly AnatomyMarker[] = ABSENT_MEASURES.filter(
  (measure) => biomarkerByLoinc(measure.loinc) === null,
).map((measure) => ({ name: measure.label, code: measure.loinc }));

const UNLISTED_SHARE = 0.2;

const hitsOf = (result: unknown): readonly KnowledgeHit[] =>
  Array.isArray(result) ? (result as KnowledgeHit[]) : [];

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One anatomy question and its answer from what `knowledge_search` found. The
 * GP's hand-over reuses it with a note naming the Anatomy agent.
 */
export const anatomyNote = async (
  context: FamilyContext,
  family: Family = "anatomy_note",
  note: string | null = null,
): Promise<Draft> => {
  const [firstUnlisted, ...restUnlisted] = UNLISTED_MARKERS;
  const marker =
    firstUnlisted !== undefined && context.random() < UNLISTED_SHARE
      ? pick(context.random, [firstUnlisted, ...restUnlisted])
      : pick(context.random, CATALOGUE_MARKERS);
  const question = askFrom(ANATOMY_BANK, context.random, "anatomyNote", {
    name: marker.name,
    code: marker.code,
  });
  const args = {
    query: `${marker.name} LOINC ${marker.code} body system and region`,
    k: 3,
  };
  const result = await context.run("knowledge_search", args);
  const hits = hitsOf(result);
  const withNote = (text: string) => (note === null ? text : `${text} ${note}`);
  const base = {
    family,
    ...asked(question),
    measureLoinc: marker.code,
    subjectRef: null,
    calls: [{ name: "knowledge_search", args, result }],
  } as const;
  const found = hits
    .map((hit) => ({ hit, line: catalogueLine(hit.passage, marker.code) }))
    .find((entry) => entry.line !== null);
  if (found === undefined || found.line === null) {
    return {
      ...base,
      outcome: "no_rows",
      reply: sections(
        hits.length === 0
          ? `I called \`knowledge_search\` for ${marker.name} (LOINC ${marker.code}). It returned no passage.`
          : `I called \`knowledge_search\` for ${marker.name} (LOINC ${marker.code}). It returned ${plural(hits.length, "passage")}, and none lists that code with a body system.`,
        withNote(
          `The OpenTwin knowledge notes have nothing on ${marker.name} (LOINC ${marker.code}), so I cannot say which body system or region it relates to. I will not guess one.`,
        ),
        "Nothing found in the notes is not the same as the marker belonging nowhere; the notes cover only the Anchor biomarker catalogue. No record of any subject was read.",
      ),
    };
  }
  const { hit, line } = found;
  return {
    ...base,
    outcome: "answered",
    reply: sections(
      `I called \`knowledge_search\` for ${marker.name} (LOINC ${marker.code}). It returned ${plural(hits.length, "passage")}; the one from ${hit.file}, section "${hit.sectionHeading}", lists: "${line.line}"`,
      withNote(
        `The OpenTwin biomarker catalogue lists ${marker.name} (LOINC ${marker.code}) under the ${line.system} system, region ${line.region}.${line.noSingleLocation ? " It also marks it as describing the whole body rather than one organ, so the body twin lights no region for it." : ""}`,
      ),
      "This is reference material from TwinLLM's own notes, taken from the Anchor catalogue unchanged. It says where a marker is placed, not anything about a person, and no record of any subject was read.",
    ),
  };
};
