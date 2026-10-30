import { EMPTY_VALUE, formatNumber } from "@/infrastructure/format-measure";

/**
 * The shape every Lab check returns: what was found, the evidence behind it,
 * and a command that repeats the check outside the app. Pure data, so the
 * server builds it and the page only draws it.
 */

export type CheckStatus = "ok" | "not-ok" | "unknown";

export const STATUS_LABEL: Readonly<Record<CheckStatus, string>> = {
  ok: "OK",
  "not-ok": "Not OK",
  unknown: "Unknown",
};

export type Evidence = Readonly<{ label: string; value: string; mono?: boolean }>;

export type EvidenceTable = Readonly<{
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}>;

export type LabLink = Readonly<{ label: string; href: string }>;

export type LabCheck = Readonly<{
  id: string;
  title: string;
  status: CheckStatus;
  /** One or two plain sentences: what this check found. */
  summary: string;
  evidence: readonly Evidence[];
  table?: EvidenceTable;
  /** Shell lines that repeat the check by hand. */
  howTo: string;
  links?: readonly LabLink[];
}>;

/** A section of the Lab page; Verifiability is the first. */
export type LabSection = Readonly<{
  id: string;
  title: string;
  intro: string;
  checks: readonly LabCheck[];
}>;

/** The first `length` hex digits of a hash, without an `sha256:` prefix. */
export const shortHash = (hash: string | null | undefined, length = 12): string =>
  hash ? hash.replace(/^sha256:/, "").slice(0, length) : EMPTY_VALUE;

/** "1 model", "3 models": counts in copy. */
export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${formatNumber(count, 0)} ${count === 1 ? one : many}`;

/** A check that could not run; the reason went to the server log. */
export const unavailableCheck = (
  base: Pick<LabCheck, "id" | "title" | "howTo">,
): LabCheck => ({
  ...base,
  status: "unknown",
  summary: "This check could not run just now. Reload the page to try again.",
  evidence: [],
});

export type TextPart = Readonly<{ code: boolean; text: string }>;

/** Splits copy on backticks so `commands` can be drawn as code. */
export const splitCode = (text: string): readonly TextPart[] =>
  text
    .split("`")
    .map((part, index) => ({ code: index % 2 === 1, text: part }))
    .filter((part) => part.text !== "");
