import { EMPTY_VALUE, formatNumber } from "@/infrastructure/format-measure";
import { type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import { LAB_PATH } from "./lab-hub";

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

/** The badge's colour for each state; the words always say it. */
export const STATUS_TONE: Readonly<Record<CheckStatus, StatusTone>> = {
  ok: "ok",
  "not-ok": "warn",
  unknown: "neutral",
};

/** Each check has its own page under the list (#459). */
export const checkHref = (id: string): string => `${LAB_PATH.checks}/${id}`;

export type Evidence = Readonly<{ label: string; value: string; mono?: boolean }>;

export type EvidenceTable = Readonly<{
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}>;

export type LabLink = Readonly<{ label: string; href: string }>;

/**
 * A check's state. Unknown always carries its reason: one plain line the
 * list and the check's page show beside the badge, so no Unknown is left
 * unexplained (#483).
 */
export type CheckState = Readonly<
  { status: "ok" | "not-ok"; reason?: never } | { status: "unknown"; reason: string }
>;

/** The state for `status`; `reason` is kept only when it is Unknown. */
export const checkState = (status: CheckStatus, reason: string): CheckState =>
  status === "unknown" ? { status, reason } : { status };

/** Why the check is Unknown, or null when it is not. */
export const unknownReason = (state: CheckState): string | null =>
  state.status === "unknown" ? state.reason : null;

export type LabCheck = CheckState &
  Readonly<{
    id: string;
    title: string;
    /** One or two plain sentences: what this check found. */
    summary: string;
    evidence: readonly Evidence[];
    table?: EvidenceTable;
    /** Shell lines that repeat the check by hand. */
    howTo: string;
    links?: readonly LabLink[];
  }>;

/** The same check in another state; a reason it had before is dropped. */
export const withState = (check: LabCheck, state: CheckState): LabCheck => {
  const { status: _status, reason: _reason, ...body } = check;
  return { ...body, ...state };
};

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
  reason: "The check could not run just now.",
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
