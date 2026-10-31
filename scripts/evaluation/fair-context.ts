/**
 * The fair data-in-prompt arm of the eval harness (#320): `bun run eval --
 * --arm context-fair`. The oracle arm (#302, `context-arm.ts`) pastes what
 * the answer key's own calls return, so its retrieval is perfect. This arm
 * pastes rows chosen without the key, by one fixed rule written before any
 * run:
 *
 * 1. The subject is the one the question names, read from the question text
 *    as the tools arm sees it (`subjectFromQuestion`): a UUID, else a
 *    `subject <id>` token with a digit, else "the first subject in cohort
 *    <id>", which the server resolves as the lowest subject_ref there. The
 *    item's `subject_ref` and key are never read.
 * 2. Every observation code with readings in that subject's record, ordered
 *    by its most recent reading (newest first, code as the tie-break), goes
 *    in as one compact block: code, display, unit, n, first and last date,
 *    and the `FAIR_RECENT_ROWS` most recent readings. Blocks go in until the
 *    next one would pass the cap; the rest are cut and named.
 * 3. The subject's conditions, then its medication requests, each go in
 *    whole when they still fit, else are cut.
 *
 * Synthetic wearable series are observation codes in this warehouse
 * (`scripts/synthetic-wearables`), so they enter by step 2. No v1 item's
 * context names a linked wearable, so there is no other wearable section.
 * Pure; the caller reads the record.
 */
import {
  JSON_CHARS_PER_TOKEN,
  estimateTokens,
} from "../../infrastructure/ollama-context";

import {
  BLOCK_END,
  BLOCK_START,
  cell,
  type ContextStats,
  type PastedCall,
} from "./context-arm";

/** Readings shown per code, newest first. Fixed before any run (#320). */
export const FAIR_RECENT_ROWS = 5;

/** The pasted blocks' tool name in `tool_results`: a server read, not a tool the model had. */
export const RECORD_TOOL = "subject_record";

export type SubjectPick =
  | Readonly<{ kind: "named"; subjectRef: string }>
  | Readonly<{ kind: "first-in-cohort"; cohortId: string }>
  | Readonly<{ kind: "none" }>;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/** `subject not-in-cohort-001`: an id token with a digit, so "subject in" is none. */
const NAMED = /\bsubject\s+([A-Za-z0-9][A-Za-z0-9-]*\d[A-Za-z0-9-]*)/i;
const FIRST_IN_COHORT =
  /\bfirst subject in cohort\s+([A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])/i;

/** The subject a question names, from its text alone. */
export const subjectFromQuestion = (question: string): SubjectPick => {
  const uuid = UUID.exec(question);
  if (uuid !== null) return { kind: "named", subjectRef: uuid[0].toLowerCase() };
  const first = FIRST_IN_COHORT.exec(question);
  if (first?.[1] !== undefined) return { kind: "first-in-cohort", cohortId: first[1] };
  const named = NAMED.exec(question);
  if (named?.[1] !== undefined) return { kind: "named", subjectRef: named[1] };
  return { kind: "none" };
};

/** The lowest subject_ref of a listing, as "the first subject in cohort" reads. */
export const firstSubject = (refs: readonly string[]): string | null =>
  [...refs].sort()[0] ?? null;

export type RecordObservation = Readonly<{
  loinc: string;
  display: string;
  unit: string;
  value: number;
  /** ISO-8601 instant. */
  at: string;
}>;

export type RecordCondition = Readonly<{
  code: string;
  display: string;
  onset: string | null;
  abatement: string | null;
  status: string | null;
}>;

export type RecordMedication = Readonly<{
  code: string;
  display: string;
  authored: string | null;
  status: string | null;
  dosage: string | null;
}>;

export type SubjectRecord = Readonly<{
  subjectRef: string;
  observations: readonly RecordObservation[];
  conditions: readonly RecordCondition[];
  medications: readonly RecordMedication[];
}>;

/** What the server read for an item. */
export type FairRead =
  | Readonly<{ kind: "record"; record: SubjectRecord }>
  | Readonly<{ kind: "refused"; subjectRef: string | null; code: string }>
  | Readonly<{ kind: "no-subject" }>;

export type CodeSummary = Readonly<{
  loinc: string;
  display: string;
  unit: string;
  n: number;
  first: string;
  last: string;
  /** The most recent readings, newest first. */
  rows: readonly Readonly<{ date: string; value: number }>[];
}>;

const day = (iso: string | null): string | null =>
  iso === null ? null : iso.slice(0, 10);

/**
 * One summary per code and unit (a code recorded in two units gets two),
 * ordered by most recent reading, newest first; code then unit break a tie.
 */
export const codeSummaries = (
  observations: readonly RecordObservation[],
  recent: number = FAIR_RECENT_ROWS,
): CodeSummary[] => {
  const groups = new Map<string, RecordObservation[]>();
  for (const row of observations) {
    const key = `${row.loinc}\u0000${row.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const summaries = [...groups.values()].map((rows): CodeSummary => {
    const sorted = [...rows].sort((a, b) =>
      a.at < b.at ? 1 : a.at > b.at ? -1 : b.value - a.value,
    );
    const newest = sorted[0];
    const oldest = sorted[sorted.length - 1];
    return {
      loinc: newest?.loinc ?? "",
      display: newest?.display ?? "",
      unit: newest?.unit ?? "",
      n: sorted.length,
      first: oldest?.at ?? "",
      last: newest?.at ?? "",
      rows: sorted
        .slice(0, recent)
        .map((row) => ({ date: day(row.at) ?? "", value: row.value })),
    };
  });
  return summaries.sort((a, b) =>
    a.last !== b.last
      ? a.last < b.last
        ? 1
        : -1
      : a.loinc !== b.loinc
        ? a.loinc.localeCompare(b.loinc, "en", { numeric: true })
        : a.unit.localeCompare(b.unit),
  );
};

export const codeText = (index: number, code: CodeSummary): string =>
  [
    `[${index + 1}] ${code.loinc} ${cell(code.display)} unit=${cell(code.unit)} n=${code.n} first=${day(code.first) ?? ""} last=${day(code.last) ?? ""}`,
    code.rows.map((row) => `${row.date} ${cell(row.value)}`).join(" | "),
  ].join("\n");

export const conditionsText = (conditions: readonly RecordCondition[]): string =>
  [
    `conditions (${conditions.length}, oldest onset first):`,
    "onset | abatement | status | code | display",
    ...conditions.map((row) =>
      [
        day(row.onset) ?? "null",
        day(row.abatement) ?? "null",
        cell(row.status),
        row.code,
        cell(row.display),
      ].join(" | "),
    ),
  ].join("\n");

export const medicationsText = (medications: readonly RecordMedication[]): string =>
  [
    `medication requests (${medications.length}, oldest first):`,
    "authored | status | code | display | dosage",
    ...medications.map((row) =>
      [
        day(row.authored) ?? "null",
        cell(row.status),
        row.code,
        cell(row.display),
        cell(row.dosage),
      ].join(" | "),
    ),
  ].join("\n");

const byOnset = (a: RecordCondition, b: RecordCondition): number =>
  (a.onset ?? "") < (b.onset ?? "") ? -1 : (a.onset ?? "") > (b.onset ?? "") ? 1 : 0;

const byAuthored = (a: RecordMedication, b: RecordMedication): number =>
  (a.authored ?? "") < (b.authored ?? "")
    ? -1
    : (a.authored ?? "") > (b.authored ?? "")
      ? 1
      : 0;

export const NO_SUBJECT_TEXT =
  "No subject is named in the question, so no subject record was read.";

/** Per item: what the rule kept and what it cut (#320). */
export type FairStats = Readonly<{
  subject_ref: string | null;
  codes_total: number;
  codes_pasted: number;
  /** Codes cut by the cap, in the order they would have come. */
  codes_cut: readonly string[];
  conditions: Readonly<{ n: number; pasted: boolean }>;
  medications: Readonly<{ n: number; pasted: boolean }>;
  /** The read was refused (`SUBJECT_SCOPE_VIOLATION`, …); null when it was not. */
  refusal: string | null;
}>;

export type FairBlock = Readonly<{
  text: string;
  pasted: readonly PastedCall[];
  stats: ContextStats;
  fair: FairStats;
}>;

const tokensOf = (text: string): number => estimateTokens(text, JSON_CHARS_PER_TOKEN);

const wrap = (body: string): string => [BLOCK_START, body, BLOCK_END].join("\n");

const noRecord = (
  text: string,
  pasted: readonly PastedCall[],
  subjectRef: string | null,
  refusal: string | null,
  capTokens: number,
): FairBlock => {
  const block = wrap(text);
  return {
    text: block,
    pasted,
    stats: {
      calls: pasted.length,
      rows_total: 0,
      rows_pasted: 0,
      truncated: false,
      tokens: tokensOf(block),
      cap_tokens: capTokens,
    },
    fair: {
      subject_ref: subjectRef,
      codes_total: 0,
      codes_pasted: 0,
      codes_cut: [],
      conditions: { n: 0, pasted: false },
      medications: { n: 0, pasted: false },
      refusal,
    },
  };
};

type Layout = Readonly<{ codes: number; conditions: boolean; medications: boolean }>;

/**
 * The block for one item under the rule above. With no subject named, or a
 * refused read, the block says so. When even the heading and the cut note
 * do not fit, the block goes over the cap with no code and says so in
 * `stats` (`tokens` above `cap_tokens`).
 */
export const buildFairBlock = (read: FairRead, capTokens: number): FairBlock => {
  if (read.kind === "no-subject")
    return noRecord(NO_SUBJECT_TEXT, [], null, null, capTokens);
  if (read.kind === "refused") {
    const input = read.subjectRef === null ? {} : { subject_ref: read.subjectRef };
    return noRecord(
      `subject_record(${read.subjectRef === null ? "" : `subject_ref=${cell(read.subjectRef)}`})\nrefused: ${read.code}`,
      [{ tool: RECORD_TOOL, input, output: { code: read.code, error: "refused" } }],
      read.subjectRef,
      read.code,
      capTokens,
    );
  }

  const { record } = read;
  const codes = codeSummaries(record.observations);
  const conditions = [...record.conditions].sort(byOnset);
  const medications = [...record.medications].sort(byAuthored);
  const heading = `subject_ref=${cell(record.subjectRef)}: ${codes.length} observation codes, ${conditions.length} conditions, ${medications.length} medication requests in the record. Codes by most recent reading, newest first; each with n, first and last date and its ${FAIR_RECENT_ROWS} most recent readings, newest first (date value).`;

  const render = (layout: Layout): string => {
    const cutCodes = codes.slice(layout.codes).map((code) => code.loinc);
    const cutParts = [
      ...(cutCodes.length > 0
        ? [`${cutCodes.length} older codes not shown: ${cutCodes.join(", ")}`]
        : []),
      ...(conditions.length > 0 && !layout.conditions ? ["conditions not shown"] : []),
      ...(medications.length > 0 && !layout.medications
        ? ["medication requests not shown"]
        : []),
    ];
    return wrap(
      [
        heading,
        ...codes.slice(0, layout.codes).map((code, index) => codeText(index, code)),
        ...(layout.conditions && conditions.length > 0
          ? [conditionsText(conditions)]
          : []),
        ...(layout.medications && medications.length > 0
          ? [medicationsText(medications)]
          : []),
        ...(cutParts.length > 0
          ? [`(cut to fit the prompt: ${cutParts.join("; ")})`]
          : []),
      ].join("\n"),
    );
  };
  const fits = (layout: Layout): boolean => tokensOf(render(layout)) <= capTokens;

  // Codes until the next one would pass the cap; then each timeline if it still fits.
  let shown = 0;
  while (
    shown < codes.length &&
    fits({ codes: shown + 1, conditions: false, medications: false })
  ) {
    shown += 1;
  }
  const withConditions =
    shown === codes.length &&
    conditions.length > 0 &&
    fits({ codes: shown, conditions: true, medications: false });
  const withMedications =
    shown === codes.length &&
    medications.length > 0 &&
    fits({ codes: shown, conditions: withConditions, medications: true });
  const layout: Layout = {
    codes: shown,
    conditions: withConditions,
    medications: withMedications,
  };
  const text = render(layout);

  const subjectRef = record.subjectRef;
  const pasted: PastedCall[] = [
    ...codes.slice(0, shown).map((code) => ({
      tool: RECORD_TOOL,
      input: { subject_ref: subjectRef, loinc: code.loinc },
      output: {
        loinc: code.loinc,
        display: code.display,
        unit: code.unit,
        n: code.n,
        first: day(code.first),
        last: day(code.last),
        rows: code.rows,
      },
    })),
    ...(withConditions
      ? [
          {
            tool: RECORD_TOOL,
            input: { subject_ref: subjectRef, part: "conditions" },
            output: { n: conditions.length, rows: conditions },
          },
        ]
      : []),
    ...(withMedications
      ? [
          {
            tool: RECORD_TOOL,
            input: { subject_ref: subjectRef, part: "medications" },
            output: { n: medications.length, rows: medications },
          },
        ]
      : []),
  ];
  const rowsPasted =
    codes.slice(0, shown).reduce((sum, code) => sum + code.rows.length, 0) +
    (withConditions ? conditions.length : 0) +
    (withMedications ? medications.length : 0);
  const conditionsCut = conditions.length > 0 && !withConditions;
  const medicationsCut = medications.length > 0 && !withMedications;
  return {
    text,
    pasted,
    stats: {
      calls: pasted.length,
      rows_total: record.observations.length + conditions.length + medications.length,
      rows_pasted: rowsPasted,
      truncated: shown < codes.length || conditionsCut || medicationsCut,
      tokens: tokensOf(text),
      cap_tokens: capTokens,
    },
    fair: {
      subject_ref: subjectRef,
      codes_total: codes.length,
      codes_pasted: shown,
      codes_cut: codes.slice(shown).map((code) => code.loinc),
      conditions: { n: conditions.length, pasted: withConditions },
      medications: { n: medications.length, pasted: withMedications },
      refusal: null,
    },
  };
};
