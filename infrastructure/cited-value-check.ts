/**
 * Whether the number an answer states for a cited wearable value is the stored
 * reading behind the cited key (#545). Pure and deterministic, so the chat, the
 * thread export and the attribution study (#508) score an answer the same way.
 *
 * Where the answer states a number for a reading:
 * - At a mention of the reading: its key (`[sleep.score.2026-01-02]`), or its
 *   label without the day and vendor (`sleep score`; qualifiers such as
 *   `average`, `total` or `during sleep` may be left out, `HR` may be written
 *   `heart rate`, and an abbreviation in the label, such as `HRV`, stands alone).
 *   The longer mention wins where two overlap.
 * - The number is the first one after the mention in the same clause (up to
 *   `.`, `;`, `!`, `?`, a line end or the next mention) whose unit fits the
 *   reading, or one written just before it (`8,432 steps`, `45 ms HRV`) when no
 *   other mention comes first in that clause.
 * - Dates, keys, subject refs and LOINC codes are never read as values, nor is a
 *   difference (`7 ms below`, `by 5`). A whole number from 0 to 10 written
 *   without a unit counts only for a reading below 11.
 * - A label mention stands for every cited reading with that label (several
 *   days of one score); a key mention, and the label after it in the same
 *   clause, for that key's reading alone.
 *
 * How a number is read: `,` `'` thousands (`8,432`), `.` decimals, and a decimal
 * comma when one or two digits follow it (`45,3`; `45,300` is thousands). A unit
 * after it is read in the reading's own dimension (`7.5 h`, `452 min`,
 * `7 h 32 min`, `7:32` for a reading in minutes; `ms`, `bpm`, `%`, `kcal`, `km`,
 * …), so `m` is minutes for a reading in minutes and metres for one in metres. A
 * number with a unit of another dimension, or of days or nights, is not this
 * reading's.
 *
 * Match: the two agree within half the coarser of their precisions, in the
 * reading's unit. A number in the reading's own unit (or none) may round the
 * reading only to the decimals the app shows it with (`format-measure.ts`), so
 * `45 ms` stands for an HRV of 45.3 but `96%` not for an SpO2 of 96.4. A number
 * in another unit rounds at its own precision: `7.5 h` stands for 452 min,
 * `7 h` does not.
 *
 * Result per reading: `matched` when a number stated for it matches it; else
 * `not_matched` when a number stated for it matches none of the readings its
 * mention stands for; else `unstated`. A reading whose value is not a number is
 * not checked (null).
 */
import { MEASURES, measureKindFor } from "./format-measure";
import { blankOut, DATE_PATTERN, LOINC_PATTERN, UUID_PATTERN } from "./narrated-numbers";

export const VALUE_CHECK_STATUSES = ["matched", "not_matched", "unstated"] as const;

export type ValueCheckStatus = (typeof VALUE_CHECK_STATUSES)[number];

export type ValueCheck = Readonly<{
  status: ValueCheckStatus;
  /** The number as the answer wrote it, unit included; absent when unstated. */
  stated?: string;
}>;

export type CheckedReading = Readonly<{
  key: string;
  label: string;
  value: string | number;
  unit?: string;
}>;

type Units = Readonly<Record<string, number>>;

/** Spellings, lower case, with the factor to the dimension's base unit. */
const UNITLESS: Units = {
  "": 1,
  point: 1,
  points: 1,
  pts: 1,
  step: 1,
  steps: 1,
  "/100": 1,
  "out of 100": 1,
};
const PERCENT: Units = { "%": 1, percent: 1, "per cent": 1, pct: 1 };
const MILLISECONDS: Units = { ms: 1, msec: 1, millisecond: 1, milliseconds: 1 };
const PER_MINUTE: Units = {
  bpm: 1,
  "beats per minute": 1,
  "beats/min": 1,
  "beats/minute": 1,
  "b/min": 1,
  "/min": 1,
  "per minute": 1,
  "{beats}/min": 1,
};
const PER_HOUR: Units = {
  "/h": 1,
  "/hr": 1,
  "per hour": 1,
  "an hour": 1,
  "events per hour": 1,
  "events/h": 1,
};
const VO2: Units = { "ml/kg/min": 1, "ml/kg/minute": 1 };
const LENGTH: Units = {
  m: 1,
  metre: 1,
  metres: 1,
  meter: 1,
  meters: 1,
  km: 1000,
  kilometre: 1000,
  kilometres: 1000,
  kilometer: 1000,
  kilometers: 1000,
  cm: 0.01,
  centimetre: 0.01,
  centimetres: 0.01,
  centimeter: 0.01,
  centimeters: 0.01,
  mm: 0.001,
  mi: 1609.344,
  mile: 1609.344,
  miles: 1609.344,
};
/** Base: minutes. */
const TIME: Units = {
  s: 1 / 60,
  sec: 1 / 60,
  secs: 1 / 60,
  second: 1 / 60,
  seconds: 1 / 60,
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
};
const ENERGY: Units = {
  kcal: 1,
  kilocalorie: 1,
  kilocalories: 1,
  cal: 1,
  calorie: 1,
  calories: 1,
  kj: 1 / 4.184,
};
const MASS: Units = {
  kg: 1,
  kilogram: 1,
  kilograms: 1,
  g: 0.001,
  gram: 0.001,
  grams: 0.001,
  lb: 0.45359237,
  lbs: 0.45359237,
  pound: 0.45359237,
  pounds: 0.45359237,
};
const ANGLE: Units = {
  rad: 1,
  radian: 1,
  radians: 1,
  "°": Math.PI / 180,
  deg: Math.PI / 180,
  degree: Math.PI / 180,
  degrees: Math.PI / 180,
};

/** In this order a stored `m` is metres: length comes before time. */
const DIMENSIONS: readonly Units[] = [
  UNITLESS,
  PERCENT,
  MILLISECONDS,
  PER_MINUTE,
  PER_HOUR,
  VO2,
  LENGTH,
  TIME,
  ENERGY,
  MASS,
  ANGLE,
];

/** Stored units that are counts or scores, so a plain number states them. */
const STORED_UNITLESS = new Set(["{steps}", "{steps}/d", "{count}", "{score}", "1"]);

/** Words after a number that make it a count of periods, never a reading. */
const PERIOD_WORDS = [
  "day",
  "days",
  "night",
  "nights",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "time",
  "times",
];

type ReadingUnit = Readonly<{ units: Units; factor: number }>;

const readingUnit = (unit: string | undefined): ReadingUnit => {
  const raw = (unit ?? "").trim().toLowerCase();
  const stored = STORED_UNITLESS.has(raw) ? "" : raw;
  const units = DIMENSIONS.find((dimension) => stored in dimension);
  return units === undefined
    ? { units: { [stored]: 1 }, factor: 1 }
    : { units, factor: units[stored] ?? 1 };
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const KNOWN_UNITS: readonly string[] = [
  ...new Set([...DIMENSIONS.flatMap((units) => Object.keys(units)), ...PERIOD_WORDS]),
]
  .filter((unit) => unit !== "")
  .sort((a, b) => b.length - a.length);

/** The unit written right after a number. */
const UNIT_AFTER = new RegExp(
  `^ ?(${KNOWN_UNITS.map((unit) => `${escape(unit)}${/[a-z0-9]$/.test(unit) ? "(?![a-z0-9])" : ""}`).join("|")})`,
  "i",
);

/** A number that is a difference, not a reading: `7 ms below`, `by 5`. */
const DIFFERENCE_AFTER =
  /^\s*(?:lower|higher|below|above|more|less|fewer|shorter|longer|up|down|under|over)(?![a-z])/i;
const DIFFERENCE_BEFORE = /(?:\bby|\+)\s*$/i;

const NUMBER =
  /(?<![\w.,'’+])(?:(?<=^|[\s(=:~≈<>±])-)?(?:\d{1,3}(?:[,'’]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?!\d)/g;

const HOURS_MINUTES =
  /(?<![\w.,])(\d+) ?(?:h|hr|hrs|hours?)(?:,? and |,? | ?)(\d{1,2}) ?(?:m|min|mins|minutes?)(?![a-z])/gi;

const CLOCK = /(?<![\d:.])(\d{1,2}):([0-5]\d)(?![\d:])/g;

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;

/** Day and month without a year (`2 Jan`, `Jan 2nd`); `DATE_PATTERN` has the rest. */
const DAY_MONTH = new RegExp(
  String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}(?![a-z])|\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b`,
  "gi",
);

/** A stored key as the answer may write it, bracketed or bare. */
const BRACKETED = /\[[^\]\n]*\]/g;
const BARE_KEY = /\b[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+/gi;

/** The text with everything that is never a stated value blanked out, positions kept. */
const valueText = (text: string): string =>
  [UUID_PATTERN, BRACKETED, BARE_KEY, DATE_PATTERN, DAY_MONTH, LOINC_PATTERN].reduce(
    (out, pattern) => blankOut(out, pattern),
    text.replace(/−/g, "-"),
  );

/** A number the answer wrote, read in one reading's dimension. */
type StatedNumber = Readonly<{
  /** As written, unit included. */
  text: string;
  start: number;
  /** Where the number and its unit end. */
  end: number;
  /** In the dimension's base unit. */
  base: number;
  /** The precision it was written to, in the base unit. */
  resolution: number;
  /** Written in the reading's own unit or with none, so display precision applies. */
  ownUnit: boolean;
  decimals: number;
  /** A whole number from 0 to 10 without a unit. */
  smallWhole: boolean;
}>;

/** `8,432` and `1'234.5` group thousands; `45,3` and `7,25` are decimal commas. */
export const parseStatedNumber = (
  raw: string,
): Readonly<{ value: number; decimals: number }> => {
  const grouped = /^-?\d{1,3}(?:[,'’]\d{3})+(?:\.\d+)?$/.test(raw);
  const plain = grouped ? raw.replace(/[,'’]/g, "") : raw.replace(",", ".");
  return { value: Number(plain), decimals: plain.split(".")[1]?.length ?? 0 };
};

const compositeDurations = (text: string, at: number): readonly StatedNumber[] =>
  [...text.matchAll(HOURS_MINUTES), ...text.matchAll(CLOCK)].map((match) => {
    const start = at + (match.index ?? 0);
    return {
      text: match[0],
      start,
      end: start + match[0].length,
      base: Number(match[1]) * 60 + Number(match[2]),
      resolution: 1,
      ownUnit: false,
      decimals: 0,
      smallWhole: false,
    };
  });

/**
 * The numbers of `text` that could state a reading in `unit`, in order; `at` is
 * where `text` starts in the answer.
 */
const statedNumbers = (
  text: string,
  unit: ReadingUnit,
  at: number,
): readonly StatedNumber[] => {
  const composite = unit.units === TIME ? compositeDurations(text, at) : [];
  const inside = (index: number) =>
    composite.some((c) => index >= c.start && index < c.end);
  const single = [...text.matchAll(NUMBER)].flatMap((match): StatedNumber[] => {
    const local = match.index ?? 0;
    if (inside(at + local)) return [];
    if (DIFFERENCE_BEFORE.test(text.slice(Math.max(0, local - 4), local))) return [];
    const numberEnd = local + match[0].length;
    const written = UNIT_AFTER.exec(text.slice(numberEnd, numberEnd + 24));
    const spelled = (written?.[1] ?? "").toLowerCase();
    const factor = spelled === "" ? unit.factor : unit.units[spelled];
    if (factor === undefined) return [];
    const end = numberEnd + (written?.[0].length ?? 0);
    if (DIFFERENCE_AFTER.test(text.slice(end, end + 12))) return [];
    const { value, decimals } = parseStatedNumber(match[0]);
    return [
      {
        text: text.slice(local, end),
        start: at + local,
        end: at + end,
        base: value * factor,
        resolution: 10 ** -decimals * factor,
        ownUnit: factor === unit.factor,
        decimals,
        smallWhole: spelled === "" && decimals === 0 && value >= 0 && value <= 10,
      },
    ];
  });
  return [...composite, ...single].sort((a, b) => a.start - b.start);
};

const decimalsOf = (value: number): number =>
  Number.isInteger(value) ? 0 : (String(value).split(".")[1]?.length ?? 0);

/** The decimals the app shows the reading with; 1 for a fraction of no known kind. */
const shownDecimals = (reading: CheckedReading, value: number): number => {
  if (Number.isInteger(value)) return 0;
  const kind = measureKindFor(reading.key, reading.unit);
  return kind === null ? 1 : MEASURES[kind].decimals;
};

const statedMatches = (
  stated: StatedNumber,
  reading: CheckedReading,
  value: number,
): boolean => {
  const { factor } = readingUnit(reading.unit);
  const readingResolution = 10 ** -decimalsOf(value) * factor;
  const mayRound = !stated.ownUnit || stated.decimals >= shownDecimals(reading, value);
  const half =
    (mayRound ? Math.max(stated.resolution, readingResolution) : readingResolution) / 2;
  return Math.abs(stated.base - value * factor) <= half * (1 + 1e-9) + 1e-12;
};

const numericValue = (value: string | number): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
};

const normalise = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

const VENDOR_WORDS = ["whoop", "oura", "bodyloop", "google health", "google"];
const QUALIFIERS = [
  "average",
  "avg",
  "mean",
  "nightly",
  "daily",
  "total",
  "cycle",
  "day",
  "rmssd",
  "during sleep",
  "duration",
];
/** Words too broad to stand for one reading on their own. */
const TOO_BROAD = new Set([
  "sleep",
  "score",
  "time",
  "heart",
  "rate",
  "heart rate",
  "day",
  "activity",
  "workout",
  "stress",
  "balance",
]);

const withoutWord = (text: string, word: string): string =>
  normalise(
    text.replace(new RegExp(`(?<![a-z0-9])${escape(word)}(?![a-z0-9])`, "g"), " "),
  );

const HR = /(?<![a-z])hr(?![a-z])/;

const ABBREVIATION = /\b[A-Z][A-Z0-9]{2,}\b/g;

/** The ways an answer may name a reading, from its stored label, lower case. */
export const labelAliases = (label: string): readonly string[] => {
  const base = normalise(label.replace(/\s*\([^)]*\)\s*$/, "").split(",")[0] ?? "");
  const unvendored = VENDOR_WORDS.reduce(withoutWord, base);
  const named = [
    base,
    unvendored,
    QUALIFIERS.reduce(withoutWord, unvendored),
    ...QUALIFIERS.map((word) => withoutWord(unvendored, word)),
  ];
  const spelled = named.flatMap((alias) =>
    HR.test(alias) ? [alias, alias.replace(HR, "heart rate")] : [alias],
  );
  // An abbreviation in the label names the measure on its own: `Sleep HRV`.
  const abbreviations = [...label.matchAll(ABBREVIATION)]
    .map((match) => match[0].toLowerCase())
    .filter((word) => !VENDOR_WORDS.includes(word));
  return [...new Set([...spelled, ...abbreviations])].filter(
    (alias) => alias.length >= 3 && !TOO_BROAD.has(alias),
  );
};

type Mention = Readonly<{
  start: number;
  end: number;
  /** Indexes of the readings it stands for. */
  readings: readonly number[];
  /** The reading a key names; null for a label. */
  key: number | null;
}>;

const occurrences = (lower: string, needle: string): readonly number[] => {
  const pattern = new RegExp(
    `(?<![a-z0-9_.-])${escape(needle)}(?![a-z0-9_-]|\\.[a-z0-9])`,
    "g",
  );
  return [...lower.matchAll(pattern)].map((match) => match.index ?? 0);
};

/** Every mention of a cited reading, in order; the longer one where two overlap. */
const mentionsIn = (
  text: string,
  readings: readonly CheckedReading[],
): readonly Mention[] => {
  const lower = text.toLowerCase();
  const keyMentions = readings.flatMap((reading, index) =>
    occurrences(lower, reading.key.toLowerCase()).map((start): Mention => ({
      start,
      end: start + reading.key.length,
      readings: [index],
      key: index,
    })),
  );
  const byAlias = readings.reduce((map, reading, index) => {
    for (const alias of labelAliases(reading.label)) {
      map.set(alias, [...(map.get(alias) ?? []), index]);
    }
    return map;
  }, new Map<string, number[]>());
  const labelMentions = [...byAlias.entries()].flatMap(([alias, indexes]) =>
    occurrences(lower, alias).map((start): Mention => ({
      start,
      end: start + alias.length,
      readings: indexes,
      key: null,
    })),
  );
  return [...keyMentions, ...labelMentions]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<Mention[]>((kept, mention) => {
      const last = kept.at(-1);
      return last !== undefined && mention.start < last.end ? kept : [...kept, mention];
    }, []);
};

const CLAUSE_END = /[.!?](?=\s|$)|[;\n]/g;

const clauseEndAfter = (text: string, at: number): number => {
  const found = text.slice(at).search(CLAUSE_END);
  return found === -1 ? text.length : at + found;
};

const clauseStartBefore = (text: string, at: number): number =>
  Math.max(
    0,
    ...[...text.slice(0, at).matchAll(CLAUSE_END)].map(
      (end) => (end.index ?? 0) + end[0].length,
    ),
  );

/** Only spaces, or `of`, between a number and the mention after it. */
const ADJACENT_GAP = /^\s*(?:of\s+)?$/i;

type Claim = Readonly<{ mention: Mention; reading: number; stated: StatedNumber }>;

/**
 * One check per reading, in order; null for a reading whose value is not a
 * number. `text` is the reply without its thinking.
 */
export const checkCitedValues = (
  text: string,
  readings: readonly CheckedReading[],
): readonly (ValueCheck | null)[] => {
  const values = valueText(text);
  const numeric = readings.map((reading) => numericValue(reading.value));
  const mentions = mentionsIn(text, readings);
  // A label later in a key's own clause names that key's reading: it neither
  // ends the key's clause nor states a number for the label's other readings.
  const sameAsKey = (keyMention: Mention, other: Mention): boolean =>
    keyMention.key !== null &&
    other.key === null &&
    other.start > keyMention.start &&
    other.readings.includes(keyMention.key) &&
    other.start < clauseEndAfter(values, keyMention.end);

  const claims = mentions.flatMap((mention, at): Claim[] => {
    if (mentions.some((earlier) => sameAsKey(earlier, mention))) return [];
    const clauseEnd = clauseEndAfter(values, mention.end);
    const next = mentions.slice(at + 1).find((other) => !sameAsKey(mention, other));
    const stop = Math.min(clauseEnd, next?.start ?? clauseEnd);
    const clauseStart = clauseStartBefore(values, mention.start);
    const previous = mentions[at - 1];
    const alone = previous === undefined || previous.end <= clauseStart;
    return mention.readings.flatMap((index): Claim[] => {
      const value = numeric[index];
      const reading = readings[index];
      if (value === null || value === undefined || reading === undefined) return [];
      const unit = readingUnit(reading.unit);
      const usable = (stated: StatedNumber) => !stated.smallWhole || Math.abs(value) < 11;
      const before = alone
        ? statedNumbers(values.slice(clauseStart, mention.start), unit, clauseStart)
            .filter(usable)
            .filter((stated) =>
              ADJACENT_GAP.test(values.slice(stated.end, mention.start)),
            )
            .at(-1)
        : undefined;
      const after = statedNumbers(
        values.slice(mention.end, stop),
        unit,
        mention.end,
      ).find(usable);
      return [before, after].flatMap((stated) =>
        stated === undefined ? [] : [{ mention, reading: index, stated }],
      );
    });
  });

  const matches = (claim: Claim, index: number): boolean => {
    const value = numeric[index];
    const reading = readings[index];
    return (
      value !== null &&
      value !== undefined &&
      reading !== undefined &&
      statedMatches(claim.stated, reading, value)
    );
  };

  return readings.map((_, index): ValueCheck | null => {
    if (numeric[index] === null) return null;
    const mine = claims.filter((claim) => claim.reading === index);
    const hit = mine.find((claim) => matches(claim, index));
    if (hit !== undefined) return { status: "matched", stated: hit.stated.text.trim() };
    const miss = mine.find(
      (claim) => !claim.mention.readings.some((other) => matches(claim, other)),
    );
    return miss === undefined
      ? { status: "unstated" }
      : { status: "not_matched", stated: miss.stated.text.trim() };
  });
};
