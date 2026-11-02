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
 *   opened once and searched for as whole words, ignoring case
 *   (`knownValueMatches`).
 * - **Stored values.** The person's imported readings, clinical records and
 *   twin notes, opened once per model call and matched in memory
 *   (`storedValueMatches`): a reading's number written with its own unit, a
 *   reading's code with its own number nearby, a clinical record's code or
 *   long name, a twin note line. A value the person typed in their own
 *   messages is not counted: they sent it themselves.
 *
 * A match of the person's own rsIDs or genome sites stops a request to a
 * hosted model (#356, `blocksSend`); every other kind is only recorded.
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

const normalized = (text: string): string =>
  text.normalize("NFKC").toLocaleLowerCase("en-GB").replace(/\s+/g, " ").trim();

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

/** One imported reading, opened: its code (null without one), number and unit as stored. */
export type StoredReading = Readonly<{
  code: string | null;
  value: string;
  unit: string;
}>;

/** One imported clinical record, opened: its code (null without one) and name. */
export type StoredRecord = Readonly<{ code: string | null; display: string }>;

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

const numbersIn = (text: string): readonly Readonly<{ value: string; end: number }>[] =>
  [...text.matchAll(NUMBER)].map((match) => ({
    value: String(Number(match[0])),
    end: (match.index ?? 0) + match[0].length,
  }));

const isDistinctiveCode = (code: string): boolean =>
  code.length >= MIN_CODE_LENGTH && /\p{N}/u.test(code);

/** A unit worth matching after a number: it has a letter or is `%`. */
const isUnit = (unit: string): boolean => /[\p{L}%]/u.test(unit);

const groupBy = (
  pairs: readonly (readonly [string, string])[],
): ReadonlyMap<string, ReadonlySet<string>> =>
  pairs.reduce((map, [key, value]) => {
    map.set(key, new Set([...(map.get(key) ?? []), value]));
    return map;
  }, new Map<string, Set<string>>());

/** `195 mg/dL`, `5.4mmol/L`: a stored number followed by its own unit, ignoring case. */
const labKeysIn = (text: string, readings: readonly StoredReading[]): Set<string> => {
  const unitsOf = groupBy(
    readings.flatMap((reading) => {
      const value = canonicalNumber(reading.value);
      const unit = normalized(reading.unit);
      return value === null || !isUnit(unit) ? [] : [[value, unit] as const];
    }),
  );
  const lower = text.toLocaleLowerCase("en-GB");
  return new Set(
    numbersIn(lower).flatMap(({ value, end }) => {
      const rest = lower.slice(end).replace(/^[ \u00a0]/, "");
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
