/**
 * The check of outgoing free text for the person's own stored values (#346,
 * docs/privacy-design.md 2.5). Before a request to a hosted model is written
 * to the disclosure ledger, its text (the person's words, earlier answers,
 * tool results) is searched for values stored on this machine, and the row
 * records what kinds were found and how many, never the values.
 *
 * Two ways to find a value:
 * - **Sealed lookups.** rsIDs and genome sites in the text are hashed with
 *   the person's index key and looked up in the keyed hash columns of their
 *   imported VCFs, so no stored variant is opened. `variantCandidates` lists
 *   what to look up; `lookupMatches` counts what was found.
 * - **Known values.** A short list of names the person stored (the names of
 *   imported files, body scan labels other than their own, the account id),
 *   opened once and searched for as whole words, ignoring case and
 *   diacritics (`knownValueMatches`, `foldedName`).
 * - **Stored values.** The person's imported readings, clinical records and
 *   twin notes, opened once per model call and matched in memory
 *   (`storedValueMatches`): a reading's number written with its own unit, a
 *   reading's code with its own number nearby, a clinical record's code or
 *   long name, a twin note line, a reading's number or a record's name
 *   next to that row's own date. A value the person typed in their own
 *   messages is not counted: they sent it themselves.
 *
 * A match of the person's own rsIDs or genome sites stops a request to a
 * hosted model (#356, `blocksSend`); every other kind is only recorded.
 *
 * A number is found in its locale spellings too (a decimal comma, thousands
 * marks such as `1'234` or `1.234,5`), and a unit ignores case, the micro
 * sign and spaces around a slash.
 *
 * A day is found in ISO and en-GB spellings (`2026-03-14`, `14/03/2026`,
 * `14 March 2026`), and counts only next to the reading or record it
 * belongs to (`datesIn`, a dated value).
 *
 * Approximate: a value written differently (another spelling, a unit
 * conversion, a rounded number) is not found, and wearable numbers are not
 * searched. Pure; the runtime is `free-text-check-runtime.ts`.
 */

export const FREE_TEXT_KIND = {
  rsid: "rsID",
  site: "genome site",
  file: "file name",
  label: "body scan label",
  account: "account id",
  lab: "lab value",
  coded: "coded value",
  clinical: "clinical record",
  note: "twin note line",
  dated: "dated value",
} as const;

export type FreeTextKind = (typeof FREE_TEXT_KIND)[keyof typeof FREE_TEXT_KIND];

const KIND_ORDER: readonly FreeTextKind[] = Object.values(FREE_TEXT_KIND);

/** How many distinct stored values of one kind the text held. */
export type FreeTextMatch = Readonly<{ kind: FreeTextKind; count: number }>;

/** The result of one check: kinds and counts only, in `FREE_TEXT_KIND` order. */
export type FreeTextCheck = Readonly<{ matches: readonly FreeTextMatch[] }>;

/** Checks one request's text; rejects when the stored values cannot be read. */
export type CheckFreeText = (text: string) => Promise<FreeTextCheck>;

/**
 * Sealed lookups per request are capped; the rest of a very long text is not
 * looked up. Stored values are matched in memory against values already
 * opened, so they make no lookups and need no cap.
 */
export const MAX_LOOKUPS = 500;

/** Known values shorter than this are not searched for: too many words would match. */
export const MIN_KNOWN_LENGTH = 4;

// ─── The text of a request ──────────────────────────────────────────────────

const stringLeaves = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
};

const decoded = (body: unknown): string | null => {
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  return null;
};

/**
 * The free text of a request body: the string values of a JSON body (so
 * keys and escapes are not searched), or the text itself. Null when the
 * body cannot be read up front (a stream or a form), which the ledger
 * records as not checked.
 */
export const requestText = (body: unknown): string | null => {
  if (body === undefined || body === null) return "";
  const text = decoded(body);
  if (text === null) return null;
  try {
    return stringLeaves(JSON.parse(text)).join("\n");
  } catch {
    return text;
  }
};

// ─── Sealed lookups ─────────────────────────────────────────────────────────

const RSID = /(?<![A-Za-z0-9])rs\d{1,10}(?![A-Za-z0-9])/gi;
/**
 * A human chromosome (1 to 22, X, Y, M or MT) and a position of four digits
 * or more, so a time such as 10:30 or a citation such as 37:1701 is not one.
 */
const SITE =
  /(?<![A-Za-z0-9:])(chr)?(2[0-2]|1\d|[1-9]|X|Y|MT|M):(\d{4,10})(?![A-Za-z0-9:])/gi;

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

/** The two ways a VCF writes a chromosome: `chr7` and `7`. */
const siteSpellings = (chrom: string, pos: string): readonly string[] => {
  const bare = chrom.toUpperCase() === "M" ? "MT" : chrom.toUpperCase();
  const prefixed = `chr${bare === "MT" ? "M" : bare}`;
  return [`${bare}:${pos}`, `${prefixed}:${pos}`];
};

/** What the text names that a VCF could hold, each as one candidate per spelling. */
export type VariantCandidates = Readonly<{
  /** Lowercase rsIDs, as the keyed hash stores them. */
  rsids: readonly string[];
  /** One entry per site in the text, with the spellings to look up. */
  sites: readonly Readonly<{ site: string; spellings: readonly string[] }>[];
}>;

export const variantCandidates = (text: string): VariantCandidates => {
  const rsids = unique([...text.matchAll(RSID)].map((match) => match[0].toLowerCase()));
  const sites = unique(
    [...text.matchAll(SITE)].map((match) =>
      siteSpellings(match[2] ?? "", match[3] ?? "").join("|"),
    ),
  ).map((joined) => ({ site: joined, spellings: joined.split("|") }));
  const rsidCap = Math.min(rsids.length, MAX_LOOKUPS);
  return {
    rsids: rsids.slice(0, rsidCap),
    sites: sites.slice(0, Math.max(0, MAX_LOOKUPS - rsidCap)),
  };
};

/**
 * Counts the candidates a lookup found. `hashesOf` gives every keyed hash a
 * stored row may hold for one spelling; `found` is the hashes the person's
 * rows hold among those asked for.
 */
export const lookupMatches = (
  candidates: VariantCandidates,
  hashesOf: Readonly<{
    rsid: (rsid: string) => readonly string[];
    site: (spelling: string) => readonly string[];
  }>,
  found: Readonly<{ rsids: ReadonlySet<string>; sites: ReadonlySet<string> }>,
): readonly FreeTextMatch[] => {
  const rsids = candidates.rsids.filter((rsid) =>
    hashesOf.rsid(rsid).some((hash) => found.rsids.has(hash)),
  ).length;
  const sites = candidates.sites.filter((site) =>
    site.spellings.some((spelling) =>
      hashesOf.site(spelling).some((hash) => found.sites.has(hash)),
    ),
  ).length;
  return [
    { kind: FREE_TEXT_KIND.rsid, count: rsids },
    { kind: FREE_TEXT_KIND.site, count: sites },
  ];
};

/** True when the text holds something shaped like an rsID or a genome site. */
export const hasGenomeShapedText = (text: string): boolean => {
  const candidates = variantCandidates(text);
  return candidates.rsids.length > 0 || candidates.sites.length > 0;
};

// ─── Known values ───────────────────────────────────────────────────────────

/** One stored name to search for, with its kind. */
export type KnownValue = Readonly<{ kind: FreeTextKind; value: string }>;

/**
 * One spelling for a name: compatibility forms, case and diacritics folded
 * (`José` and `JOSE`, `Müller` and `muller`, `ß` as `ss`), runs of space as
 * one. Only names and phrases are folded this way; units and numbers have
 * their own spellings (`unitSpelling`, `separatedReadings`).
 */
export const foldedName = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-GB")
    .replace(/ß/g, "ss")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

const normalized = foldedName;

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}_]/u.test(char);

const containsWord = (haystack: string, needle: string): boolean => {
  const at = (from: number): boolean => {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return false;
    const before = haystack[index - 1];
    const after = haystack[index + needle.length];
    const edgeOk =
      (!isWordChar(needle[0]) || !isWordChar(before)) &&
      (!isWordChar(needle[needle.length - 1]) || !isWordChar(after));
    return edgeOk || at(index + 1);
  };
  return at(0);
};

/** Counts the distinct known values the text holds as whole words, ignoring case. */
export const knownValueMatches = (
  text: string,
  known: readonly KnownValue[],
): readonly FreeTextMatch[] => {
  const haystack = normalized(text);
  const wanted = unique(
    known
      .map((item) => ({ kind: item.kind, value: normalized(item.value) }))
      .filter((item) => item.value.length >= MIN_KNOWN_LENGTH)
      .map((item) => `${item.kind}\u0000${item.value}`),
  );
  const found = wanted.filter((entry) =>
    containsWord(haystack, entry.slice(entry.indexOf("\u0000") + 1)),
  );
  return KIND_ORDER.map((kind) => ({
    kind,
    count: found.filter((entry) => entry.startsWith(`${kind}\u0000`)).length,
  }));
};

/**
 * True for an account id worth searching for: eight characters or more with
 * a letter and a digit (`user_2abc...`), not a word such as the local `local`.
 */
export const isDistinctiveId = (id: string): boolean =>
  id.length >= 8 && /\p{L}/u.test(id) && /\p{N}/u.test(id);

// ─── Stored values ──────────────────────────────────────────────────────────

/**
 * One imported reading, opened: its code (null without one), number and unit
 * as stored, and its day (`2026-03-14`) when the file gave one.
 */
export type StoredReading = Readonly<{
  code: string | null;
  value: string;
  unit: string;
  date?: string | null;
}>;

/**
 * One imported clinical record, opened: its code (null without one), name,
 * and its day (onset or authored) when the file gave one.
 */
export type StoredRecord = Readonly<{
  code: string | null;
  display: string;
  date?: string | null;
}>;

/** The person's stored values to search for, opened once per model call. */
export type StoredValues = Readonly<{
  readings: readonly StoredReading[];
  records: readonly StoredRecord[];
  /** Note titles and the lines of their lists. */
  noteLines: readonly string[];
}>;

export const NO_STORED_VALUES: StoredValues = {
  readings: [],
  records: [],
  noteLines: [],
};

/** A code shorter than this, or without a digit, is too common a token to search for. */
export const MIN_CODE_LENGTH = 4;

/** Clinical record names shorter than this are not searched for: "Asthma" is a word anyone writes. */
export const MIN_RECORD_NAME_LENGTH = 24;

/** Twin note lines shorter than this are not searched for. */
export const MIN_NOTE_LINE_LENGTH = 24;

/** How far around a code, in characters, a reading's number is looked for. */
export const CODE_WINDOW = 80;

/** A number without its sign: `195`, `5.4`. Not a part of a longer number or word. */
const NUMBER = /(?<![\p{L}\p{N}_.])\d+(?:\.\d+)?(?![\p{N}]|\.\d)/gu;

/** The number as one spelling: `5.40` and `5.4` are the same; null when not a number. */
export const canonicalNumber = (text: string): string | null => {
  const trimmed = text.trim().replace(/^[-+]/, "");
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  return String(Number(trimmed));
};

/**
 * A run of digits joined by the marks people group thousands or write
 * decimals with: `1,234.5`, `1.234,5`, `1'234.5` (Swiss), `1 234,5` with a
 * no-break or thin space. A plain space is not one: "3 195" is two numbers.
 */
const SEPARATED =
  /(?<![\p{L}\p{N}_.,'’   ])\d+(?:[.,'’   ]\d+)+(?![\p{N}]|[.,'’   ]\d)/gu;

const isDecimalMark = (char: string | undefined): boolean => char === "." || char === ",";

/** Groups after the first are three digits, one mark throughout, and the first is not 0. */
const isGrouped = (groups: readonly string[], marks: readonly string[]): boolean => {
  const head = groups[0] ?? "";
  return (
    head.length >= 1 &&
    head.length <= 3 &&
    !head.startsWith("0") &&
    groups.slice(1).every((group) => group.length === 3) &&
    marks.every((mark) => mark === marks[0])
  );
};

/**
 * Every number a separated token can mean, in the canonical spelling. `5,4`
 * is 5.4; `1,234` is 1234 or 1.234 (the locale is not known, so both);
 * `1'234.5` and `1.234,5` are 1234.5. Groups after the first must be three
 * digits, so a date such as `12.03.2024` or a version such as `2.0.1` means
 * no number.
 */
export const separatedReadings = (token: string): readonly string[] => {
  const groups = token.split(/\D/);
  const marks = token.replace(/\d/g, "").split("");
  const last = marks[marks.length - 1];
  const thousands = isGrouped(groups, marks) ? [groups.join("")] : [];
  const whole = groups.slice(0, -1);
  const decimal =
    isDecimalMark(last) &&
    (marks.length === 1 || (last !== marks[0] && isGrouped(whole, marks.slice(0, -1))))
      ? [`${whole.join("")}.${groups[groups.length - 1] ?? ""}`]
      : [];
  return unique(
    [...thousands, ...decimal].flatMap((reading) => canonicalNumber(reading) ?? []),
  );
};

/**
 * The numbers in a text and where each ends. A number written with a decimal
 * comma or thousands marks gives each number it can mean, besides its plain
 * digit runs, so a locale spelling is found and nothing found before is lost.
 */
const numbersIn = (text: string): readonly Readonly<{ value: string; end: number }>[] => [
  ...[...text.matchAll(NUMBER)].map((match) => ({
    value: String(Number(match[0])),
    end: (match.index ?? 0) + match[0].length,
  })),
  ...[...text.matchAll(SEPARATED)].flatMap((match) =>
    separatedReadings(match[0]).map((value) => ({
      value,
      end: (match.index ?? 0) + match[0].length,
    })),
  ),
];

const isDistinctiveCode = (code: string): boolean =>
  code.length >= MIN_CODE_LENGTH && /\p{N}/u.test(code);

/**
 * One spelling per unit: case, the micro sign (`µ`, `μ`, `u`, `mcg`) and
 * spaces around a slash do not matter, so `µmol/L`, `umol / l` and `mcg/dL`
 * meet a stored `umol/L` and `ug/dL`.
 */
export const unitSpelling = (unit: string): string =>
  normalized(unit)
    .replace(/[µμ]/g, "u")
    .replace(/mcg(?!\p{L})/gu, "ug")
    .replace(/\s*\/\s*/g, "/");

/** A unit worth matching after a number: it has a letter or is `%`. */
const isUnit = (unit: string): boolean => /[\p{L}%]/u.test(unit);

const groupBy = (
  pairs: readonly (readonly [string, string])[],
): ReadonlyMap<string, ReadonlySet<string>> =>
  pairs.reduce((map, [key, value]) => {
    map.set(key, new Set([...(map.get(key) ?? []), value]));
    return map;
  }, new Map<string, Set<string>>());

/** How many characters after a number are read for its unit. */
const UNIT_LOOKAHEAD = 64;

/**
 * `195 mg/dL`, `5.4mmol/L`, `5,4 mmol/l`, `1'234 \u00b5mol/L`: a stored number
 * followed by its own unit, in any of the spellings above of either.
 */
const labKeysIn = (text: string, readings: readonly StoredReading[]): Set<string> => {
  const unitsOf = groupBy(
    readings.flatMap((reading) => {
      const value = canonicalNumber(reading.value);
      const unit = unitSpelling(reading.unit);
      return value === null || !isUnit(unit) ? [] : [[value, unit] as const];
    }),
  );
  const lower = text.toLocaleLowerCase("en-GB");
  return new Set(
    numbersIn(lower).flatMap(({ value, end }) => {
      if (!unitsOf.has(value)) return [];
      const rest = unitSpelling(
        lower.slice(end, end + UNIT_LOOKAHEAD).replace(/^[ \u00a0\u2009\u202f]/, ""),
      );
      return [...(unitsOf.get(value) ?? [])]
        .filter((unit) => rest.startsWith(unit) && !isWordChar(rest[unit.length]))
        .map((unit) => `${value}|${unit}`);
    }),
  );
};

const tokenAt = (haystack: string, needle: string, index: number): boolean => {
  const before = haystack[index - 1];
  const after = haystack[index + needle.length];
  const edge = (char: string | undefined) =>
    char === undefined || !/[\p{L}\p{N}_-]/u.test(char);
  return edge(before) && edge(after);
};

/** Where a code stands as a whole token (`2093-3`, not `12093-3`). */
const tokenIndexes = (haystack: string, needle: string): readonly number[] => {
  const from = (start: number): readonly number[] => {
    const index = haystack.indexOf(needle, start);
    if (index < 0) return [];
    return [...(tokenAt(haystack, needle, index) ? [index] : []), ...from(index + 1)];
  };
  return needle === "" ? [] : from(0);
};

/** A stored code as a whole token with that code's own number within `CODE_WINDOW`. */
const codedKeysIn = (text: string, readings: readonly StoredReading[]): Set<string> => {
  const valuesOf = groupBy(
    readings.flatMap((reading) => {
      const value = canonicalNumber(reading.value);
      const code = reading.code === null ? "" : normalized(reading.code);
      return value === null || !isDistinctiveCode(code) ? [] : [[code, value] as const];
    }),
  );
  const lower = text.toLocaleLowerCase("en-GB");
  return new Set(
    [...valuesOf].flatMap(([code, values]) =>
      tokenIndexes(lower, code).flatMap((index) => {
        // The code's own digits are not a reading.
        const around = `${lower.slice(Math.max(0, index - CODE_WINDOW), index)} ${lower.slice(
          index + code.length,
          index + code.length + CODE_WINDOW,
        )}`;
        return numbersIn(around)
          .filter(({ value }) => values.has(value))
          .map(({ value }) => `${code}|${value}`);
      }),
    ),
  );
};

/** A clinical record whose code stands as a whole token, or whose long name is a whole phrase. */
const recordKeysIn = (text: string, records: readonly StoredRecord[]): Set<string> => {
  const haystack = normalized(text);
  return new Set(
    records.flatMap((record) => {
      const code = record.code === null ? "" : normalized(record.code);
      const name = normalized(record.display);
      const byCode = isDistinctiveCode(code) && tokenIndexes(haystack, code).length > 0;
      const byName =
        name.length >= MIN_RECORD_NAME_LENGTH && containsWord(haystack, name);
      return byCode || byName ? [`${code}|${name}`] : [];
    }),
  );
};

/** A twin note line, as a whole phrase, ignoring case and spacing. */
const noteKeysIn = (text: string, lines: readonly string[]): Set<string> => {
  const haystack = normalized(text);
  return new Set(
    lines
      .map(normalized)
      .filter(
        (line) => line.length >= MIN_NOTE_LINE_LENGTH && containsWord(haystack, line),
      ),
  );
};

// ─── Dates ──────────────────────────────────────────────────────────────────

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/** `2026-03-14`, also before a time (`2026-03-14T08:00`). */
const ISO_DATE = /(?<![\p{L}\p{N}-])(\d{4})-(\d{2})-(\d{2})(?![\p{N}])(?!(?!T\d)\p{L})/gu;
/** `14/03/2026`, `14.3.2026`, `14-03-2026`: day first, a four-digit year. */
const GB_NUMERIC_DATE =
  /(?<![\p{L}\p{N}./-])(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?![\p{L}\p{N}])/gu;
/** `14 March 2026`, `14th Mar. 2026`, `3 Sept 2026`. */
const GB_LONG_DATE =
  /(?<![\p{L}\p{N}])(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![\p{L}])\.?,?\s+(\d{4})(?![\p{L}\p{N}])/giu;

const pad = (value: number): string => String(value).padStart(2, "0");

/** The ISO day for a year, month and day, or null when there is no such day. */
const isoDay = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}`
    : null;
};

/** A day written in the text: its ISO spelling and where it stands. */
export type DateInText = Readonly<{ day: string; start: number; end: number }>;

const monthOf = (name: string | undefined): number =>
  MONTHS.findIndex((month) => month === (name ?? "").slice(0, 3).toLowerCase()) + 1;

const daysMatching = (
  text: string,
  pattern: RegExp,
  parts: (match: RegExpMatchArray) => readonly [number, number, number],
): readonly DateInText[] =>
  [...text.matchAll(pattern)].flatMap((match) => {
    const [year, month, day] = parts(match);
    const iso = isoDay(year, month, day);
    const start = match.index ?? 0;
    return iso === null ? [] : [{ day: iso, start, end: start + match[0].length }];
  });

/**
 * The days a text names, in ISO (`2026-03-14`) and en-GB spellings
 * (`14/03/2026`, `14.03.2026`, `14 March 2026`, `14th Mar 2026`). Day first
 * only: `03/14/2026` is no day, and a two-digit year is not read.
 */
export const datesIn = (text: string): readonly DateInText[] => [
  ...daysMatching(text, ISO_DATE, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]),
  ...daysMatching(text, GB_NUMERIC_DATE, (m) => [
    Number(m[4]),
    Number(m[3]),
    Number(m[1]),
  ]),
  ...daysMatching(text, GB_LONG_DATE, (m) => [Number(m[3]), monthOf(m[2]), Number(m[1])]),
];

/** The text with every day it names blanked, so a day's digits are not read as a number. */
const withoutDates = (text: string, dates: readonly DateInText[]): string =>
  dates.reduce(
    (masked, date) =>
      `${masked.slice(0, date.start)}${" ".repeat(date.end - date.start)}${masked.slice(date.end)}`,
    text,
  );

/**
 * A stored reading's number, or a clinical record's name (four characters
 * or more) or code, within `CODE_WINDOW` of that same row's own day. A day
 * alone, or a number next to another day, is not one: a day is too common
 * to count by itself.
 */
const datedKeysIn = (text: string, stored: StoredValues): Set<string> => {
  // Positions are taken in the lowercased text: lowercasing can change length.
  const lower = text.toLocaleLowerCase("en-GB");
  const dates = datesIn(lower);
  if (dates.length === 0) return new Set();
  const masked = withoutDates(lower, dates);
  const around = (date: DateInText): string =>
    `${masked.slice(Math.max(0, date.start - CODE_WINDOW), date.start)} ${masked.slice(
      date.end,
      date.end + CODE_WINDOW,
    )}`;
  const readingKeys = stored.readings.flatMap((reading) => {
    const value = canonicalNumber(reading.value);
    const day = reading.date ?? null;
    if (value === null || day === null) return [];
    return dates.some(
      (date) =>
        date.day === day && numbersIn(around(date)).some((each) => each.value === value),
    )
      ? [`reading|${day}|${value}`]
      : [];
  });
  const recordKeys = stored.records.flatMap((record) => {
    const day = record.date ?? null;
    if (day === null) return [];
    const name = normalized(record.display);
    const code = record.code === null ? "" : normalized(record.code);
    return dates.some((date) => {
      if (date.day !== day) return false;
      const nearby = normalized(around(date));
      return (
        (name.length >= MIN_KNOWN_LENGTH && containsWord(nearby, name)) ||
        (isDistinctiveCode(code) && tokenIndexes(nearby, code).length > 0)
      );
    })
      ? [`record|${day}|${code}|${name}`]
      : [];
  });
  return new Set([...readingKeys, ...recordKeys]);
};

/**
 * Counts the distinct stored values the text holds, per kind, leaving out
 * those that also stand in `typed`, the person's own messages: a value they
 * typed themselves is theirs to send. Record-only kinds; none of them blocks.
 */
export const storedValueMatches = (
  text: string,
  stored: StoredValues,
  typed: string = "",
): readonly FreeTextMatch[] => {
  const kinds: readonly (readonly [FreeTextKind, (each: string) => Set<string>])[] = [
    [FREE_TEXT_KIND.lab, (each) => labKeysIn(each, stored.readings)],
    [FREE_TEXT_KIND.coded, (each) => codedKeysIn(each, stored.readings)],
    [FREE_TEXT_KIND.clinical, (each) => recordKeysIn(each, stored.records)],
    [FREE_TEXT_KIND.note, (each) => noteKeysIn(each, stored.noteLines)],
    [FREE_TEXT_KIND.dated, (each) => datedKeysIn(each, stored)],
  ];
  return kinds.map(([kind, keysIn]) => {
    const own = typed === "" ? new Set<string>() : keysIn(typed);
    return { kind, count: [...keysIn(text)].filter((key) => !own.has(key)).length };
  });
};

// ─── The result ─────────────────────────────────────────────────────────────

/** Adds counts of the same kind, drops zeros and puts kinds in a fixed order. */
export const freeTextCheckOf = (
  ...parts: readonly (readonly FreeTextMatch[])[]
): FreeTextCheck => ({
  matches: KIND_ORDER.map((kind) => ({
    kind,
    count: parts
      .flat()
      .filter((match) => match.kind === kind)
      .reduce((sum, match) => sum + match.count, 0),
  })).filter((match) => match.count > 0),
});

// ─── Blocking (#356) ────────────────────────────────────────────────────────

/**
 * The kinds that stop a request to a hosted model: the person's own genome
 * identifiers. Every other kind is recorded and the request still goes.
 */
export const BLOCKING_KINDS: readonly FreeTextKind[] = [
  FREE_TEXT_KIND.rsid,
  FREE_TEXT_KIND.site,
];

/** True when the check found any of the person's own rsIDs or genome sites. */
export const blocksSend = (check: FreeTextCheck): boolean =>
  check.matches.some((match) => BLOCKING_KINDS.includes(match.kind) && match.count > 0);

/** What the person reads in the answer when a request was blocked. Fixed text. */
export const GENOME_IDS_BLOCKED_SENTENCE =
  "This question would have sent identifiers from your genome to a hosted model, so it was not sent. Ask with a local model, or without the variant IDs.";

/** "2 rsIDs, 1 genome site"; "no stored values found" when there are none. */
export const describeFreeTextCheck = (check: FreeTextCheck): string =>
  check.matches.length === 0
    ? "no stored values found"
    : check.matches
        .map((match) => `${match.count} ${match.kind}${match.count === 1 ? "" : "s"}`)
        .join(", ");

/** Reads a stored result back; anything that is not a list of known kinds and counts is null. */
export const parseFreeTextMatches = (stored: unknown): FreeTextCheck | null => {
  if (!Array.isArray(stored)) return null;
  const matches = stored.flatMap((item: unknown): readonly FreeTextMatch[] => {
    if (typeof item !== "object" || item === null) return [];
    const { kind, count } = item as Readonly<Record<string, unknown>>;
    const known = KIND_ORDER.find((each) => each === kind);
    return known !== undefined &&
      typeof count === "number" &&
      Number.isInteger(count) &&
      count > 0
      ? [{ kind: known, count }]
      : [];
  });
  return matches.length === stored.length ? freeTextCheckOf(matches) : null;
};
