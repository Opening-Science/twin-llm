/**
 * Which published source each claim of an answer cites (#612).
 *
 * The literature searches ask the model to end a sentence that rests on a
 * passage with the passage's id in brackets (`[ean-als-2024]`, `[PMC1234567]`)
 * and a claim no passage supports with `[unsupported]`. This reads the
 * answer's sentences and resolves each id against what the turn's searches
 * actually returned, so a source is linked only when a tool gave it and an
 * id no search returned shows as invented rather than passing as a citation.
 *
 * Pure, so the server runs it on a saved answer's stored tool parts, the
 * browser on the parts it streamed, and the eval scorer on a run's replies.
 * It reads what the answer says about its sources; it judges neither the
 * claim nor the person.
 */
import { z } from "zod";

import { sectionSpans, sectionText } from "./parse-twin-answer";
import { looksLikeId, UNSUPPORTED_MARK } from "./source-ids";

export type ReferenceKind = "guideline" | "article" | "note";

/** A document a search returned this turn, as an answer may cite it. */
export type ReferenceSource = Readonly<{
  /** The id the answer writes in brackets: a guideline id or a PMC id. */
  label: string;
  kind: ReferenceKind;
  title: string;
  /** Empty when the hit had none (an OpenTwin note). */
  url: string;
  /** 0 when unknown. */
  year: number;
}>;

/** A tool call of the turn, as streamed or stored. */
export type ClaimSourcePart = Readonly<{ output?: unknown }>;

const guidelineHit = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  society: z.string(),
  url: z.string(),
  ingestMode: z.string(),
});

const literatureHit = z.object({
  kind: z.literal("literature"),
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  pmcid: z.string().min(1),
  url: z.string(),
});

const noteHit = z.object({
  id: z.string().min(1),
  title: z.string(),
  file: z.string(),
  sectionHeading: z.string(),
});

const toSources = (hit: unknown): readonly ReferenceSource[] => {
  const article = literatureHit.safeParse(hit);
  if (article.success) {
    const { pmcid, id, title, url, year } = article.data;
    const source = { kind: "article" as const, title, url, year };
    // The PMC id is what the tool text asks for; the document id also resolves.
    return [
      { ...source, label: pmcid },
      { ...source, label: id },
    ];
  }
  const guideline = guidelineHit.safeParse(hit);
  if (guideline.success) {
    const { id, title, url, year } = guideline.data;
    return [{ label: id, kind: "guideline", title, url, year }];
  }
  const note = noteHit.safeParse(hit);
  if (note.success) {
    return [
      { label: note.data.id, kind: "note", title: note.data.title, url: "", year: 0 },
    ];
  }
  return [];
};

/**
 * Every document the turn's searches returned, keyed by the lower-case id an
 * answer may write. A passage returned twice is one source.
 */
export const referenceSources = (
  parts: readonly ClaimSourcePart[],
): ReadonlyMap<string, ReferenceSource> => {
  const sources = new Map<string, ReferenceSource>();
  for (const part of parts) {
    if (!Array.isArray(part.output)) continue;
    for (const hit of part.output as readonly unknown[]) {
      for (const source of toSources(hit)) {
        const key = source.label.toLowerCase();
        if (!sources.has(key)) sources.set(key, source);
      }
    }
  }
  return sources;
};

export { UNSUPPORTED_MARK };

/** One bracketed group, `[a]` or `[a, b]`, not a markdown link `[a](…)`. */
const BRACKET = /\[([^\][\n]{1,200})\](?!\()/g;

export type ClaimStatus = "cited" | "invented" | "unsupported" | "uncited";

export type Claim = Readonly<{
  /** The sentence without its bracketed ids. */
  text: string;
  /** Sources a search returned that the sentence cites, in order. */
  sources: readonly ReferenceSource[];
  /** Ids the sentence cites that no search returned this turn. */
  unknown: readonly string[];
  /** The sentence ends with `[unsupported]`. */
  marked: boolean;
  /**
   * `cited`: at least one returned source; `invented`: only ids no search
   * returned; `unsupported`: marked so; `uncited`: none of these.
   */
  status: ClaimStatus;
}>;

/** Case-sensitive, so a sentence ending "… says no." still ends there. */
const ABBREVIATIONS = /(?:\be\.g|\bi\.e|\bet al|\bvs|\bapprox|\bcf|\bDr|\bFig|\bNo)\.$/;

/** A stop, the bracketed ids right after it, then a space or the line's end. */
const BOUNDARY = /[.!?](?:\s*\[[^\][\n]{1,200}\](?!\())*(?=\s|$)/g;

/**
 * A line cut into sentences. A sentence ends at `.`, `!` or `?` followed by
 * a space or the line's end, unless the stop closes an abbreviation; bracketed
 * ids written right after the stop (`… lowers it. [esc-ccs-2019]`) still
 * belong to it.
 */
const sentencesOf = (line: string): string[] => {
  const out: string[] = [];
  let start = 0;
  for (const match of line.matchAll(BOUNDARY)) {
    if (ABBREVIATIONS.test(line.slice(start, match.index + 1))) continue;
    const end = match.index + match[0].length;
    out.push(line.slice(start, end).trim());
    start = end;
  }
  out.push(line.slice(start).trim());
  return out.filter((sentence) => sentence !== "");
};

const BULLET = /^(?:[-*+]|\d+[.)])\s+/;

/** The answer's sentences, outside headings, code and empty lines. */
const answerSentences = (answer: string): string[] => {
  const sentences: string[] = [];
  let inCode = false;
  for (const raw of answer.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || line === "" || line.startsWith("#") || line.startsWith("|")) continue;
    sentences.push(...sentencesOf(line.replace(BULLET, "")));
  }
  return sentences;
};

/** A sentence that only joins or introduces, with fewer than three words, is no claim. */
const isClaim = (text: string): boolean =>
  (text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 3;

const statusOf = (
  sources: readonly ReferenceSource[],
  unknown: readonly string[],
  marked: boolean,
): ClaimStatus => {
  if (sources.length > 0) return "cited";
  if (unknown.length > 0) return "invented";
  return marked ? "unsupported" : "uncited";
};

const toClaim = (
  sentence: string,
  sources: ReadonlyMap<string, ReferenceSource>,
): Claim | null => {
  const cited: ReferenceSource[] = [];
  const unknown: string[] = [];
  let marked = false;
  const text = sentence
    .replace(BRACKET, (whole, inner: string) => {
      const tokens = inner.split(/[,;]\s*/).map((token) => token.trim());
      let read = false;
      for (const token of tokens) {
        if (token.toLowerCase() === UNSUPPORTED_MARK) {
          marked = true;
          read = true;
          continue;
        }
        const source = sources.get(token.toLowerCase());
        if (source !== undefined) {
          if (!cited.includes(source)) cited.push(source);
          read = true;
        } else if (looksLikeId(token)) {
          if (!unknown.includes(token)) unknown.push(token);
          read = true;
        }
      }
      return read ? "" : whole;
    })
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!isClaim(text)) return null;
  return {
    text,
    sources: cited,
    unknown,
    marked,
    status: statusOf(cited, unknown, marked),
  };
};

/**
 * The claims of a reply's Answer section (the whole reply when it has none),
 * each with the sources it cites among those the turn's searches returned.
 */
export const answerClaims = (
  reply: string,
  parts: readonly ClaimSourcePart[],
): readonly Claim[] => {
  const answer = sectionText(sectionSpans(reply), reply, "answer") ?? reply;
  const sources = referenceSources(parts);
  return answerSentences(answer).flatMap((sentence) => {
    const claim = toClaim(sentence, sources);
    return claim === null ? [] : [claim];
  });
};

export type ClaimCoverage = Readonly<Record<ClaimStatus, number> & { claims: number }>;

/** How many claims fall under each status. */
export const claimCoverage = (claims: readonly Claim[]): ClaimCoverage => {
  const count = (status: ClaimStatus): number =>
    claims.filter((claim) => claim.status === status).length;
  return {
    claims: claims.length,
    cited: count("cited"),
    invented: count("invented"),
    unsupported: count("unsupported"),
    uncited: count("uncited"),
  };
};
