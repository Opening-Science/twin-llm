/**
 * Question templates for the training conversations, several phrasings per
 * slot, and the seeded choices that fill them: style, template, a typo, how a
 * measure and a date are named. Pure.
 *
 * Every template has a stable id (`slot.style.n`) and a group (`slot.style`).
 * The split (`split.ts`) holds out whole groups, so validation can ask in a
 * wording the model never saw. No template equals an evaluation question after
 * refs, dates and whitespace are normalised (`families.test.ts`).
 *
 * The app is English only (`lang="en"`, en-GB formatting), so there are no
 * German or French questions.
 */
import { pick, type Random } from "../synthetic-wearables/random";

import { formatDay } from "./format";
import type { Measure } from "./measures";

export const STYLES = ["formal", "casual", "terse", "non_native"] as const;
export type Style = (typeof STYLES)[number];

type Bank = Readonly<Record<Style, readonly [string, ...string[]]>>;

/** Placeholders: {label} {ref} {start} {end} {a} {b} {days} {key} {period} {who} {unit}. */
export const BANK = {
  latest: {
    formal: [
      "Which {label} value was recorded last for subject {ref}?",
      "Show the most recent {label} reading for subject {ref}.",
      "When was {label} last recorded for subject {ref}, and what was it?",
      "Please report the latest {label} measurement on file for subject {ref}.",
    ],
    casual: [
      "hey, what's the latest {label} for {ref}?",
      "what was {ref}'s last {label} reading?",
      "can you pull up the newest {label} for subject {ref}?",
    ],
    terse: [
      "latest {label} {ref}",
      "{label}, most recent, subject {ref}",
      "last {label}? subject {ref}",
    ],
    non_native: [
      "Please give me the last value of {label} of the subject {ref}.",
      "Which is the most new {label} for subject {ref}?",
      "I want to know the {label} last measured for subject {ref}.",
    ],
  },
  trendWearable: {
    formal: [
      "Over {start} to {end}, which way did {label} move for subject {ref}?",
      "Has {label} for subject {ref} drifted from {start} to {end}, and by how much per day?",
      "Describe the direction of {label} for subject {ref} between {start} and {end}.",
    ],
    casual: [
      "is {ref}'s {label} going up or down from {start} to {end}?",
      "how's {label} trending for subject {ref}, {start} through {end}?",
    ],
    terse: [
      "{label} trend {ref} {start} – {end}",
      "slope of {label}, subject {ref}, {start} to {end}",
    ],
    non_native: [
      "How is changing the {label} of subject {ref} from {start} until {end}?",
      "Please tell the tendency of {label} for subject {ref} in period {start} - {end}.",
    ],
  },
  trendRecent: {
    formal: [
      "Over the last {days} days of records, which way has {label} moved for subject {ref}?",
      "What is the trend in {label} for subject {ref} across their most recent {days} days of data?",
    ],
    casual: [
      "has {ref}'s {label} gone up or down lately? last {days} days",
      "{label} trend for {ref} over the past {days} days?",
    ],
    terse: ["{label} trend, last {days} days, {ref}", "{days}-day {label} slope {ref}"],
    non_native: [
      "In the last {days} days, the {label} of subject {ref} goes up or down?",
      "Please say me how {label} of subject {ref} changed in the last {days} days.",
    ],
  },
  trendClinical: {
    formal: [
      "Across the last five years of records, which way has {label} moved for subject {ref}?",
      "What slope does {label} show for subject {ref} over their last five years of records?",
      "Summarise the five-year trend in {label} for subject {ref}.",
    ],
    casual: [
      "has {ref}'s {label} gone up or down over the last 5 years of records?",
      "how has {label} changed for {ref} in the last five years they have data?",
    ],
    terse: ["{label} 5y trend {ref}", "five-year slope, {label}, subject {ref}"],
    non_native: [
      "How {label} is developing for subject {ref} in the last five years of the records?",
      "Please make the trend of {label} for the subject {ref}, last 5 years.",
    ],
  },
  baselineWearable: {
    formal: [
      "Is {label} for subject {ref} in the two weeks to {end} different from their own baseline?",
      "How far is the recent {label} of subject {ref} from their usual level?",
      "Compare the fortnight of {label} ending {end} for subject {ref} with their personal baseline.",
    ],
    casual: [
      "is {ref}'s {label} off from normal for them in the two weeks to {end}?",
      "{label} for {ref} lately vs their usual: any different?",
    ],
    terse: ["{label} vs baseline, {ref}, 2 weeks to {end}", "robust z {label} {ref}"],
    non_native: [
      "The {label} of subject {ref} in the last two weeks until {end}, is it different from their normal?",
      "Is different the recent {label} of subject {ref} compared to own baseline?",
    ],
  },
  baselineClinical: {
    formal: [
      "Is the last year of {label} for subject {ref} different from the four years before it?",
      "How does the most recent year of {label} for subject {ref} compare with their earlier baseline?",
      "Does the latest year of {label} for subject {ref} deviate from the preceding four years?",
    ],
    casual: [
      "is {ref}'s {label} in the last year way off from the years before?",
      "last year's {label} for {ref} vs their earlier baseline?",
    ],
    terse: [
      "{label} last year vs baseline {ref}",
      "baseline deviation {label} subject {ref}",
    ],
    non_native: [
      "The last year of {label} for subject {ref} is different to the four years before?",
      "Please compare {label} of last year with the baseline before, subject {ref}.",
    ],
  },
  coverageWearable: {
    formal: [
      "How much of the time from {start} to {end} is covered by wearable readings for subject {ref}?",
      "On how many days between {start} and {end} does subject {ref} have wearable readings?",
      "What share of days between {start} and {end} have wearable data for subject {ref}?",
    ],
    casual: [
      "how often did {ref} actually wear the device from {start} to {end}?",
      "any gaps in {ref}'s wearable data between {start} and {end}?",
    ],
    terse: [
      "wearable coverage {ref} {start} – {end}",
      "days with data, subject {ref}, {start} to {end}",
    ],
    non_native: [
      "How many days the subject {ref} has data of wearable between {start} and {end}?",
      "Please say the coverage of wearable data for subject {ref} from {start} until {end}.",
    ],
  },
  coverageRecent: {
    formal: [
      "How complete are the wearable readings for subject {ref} over the last {days} days of records?",
      "On how many of the last {days} days of records does subject {ref} have wearable data?",
    ],
    casual: [
      "did {ref} wear the device much in the last {days} days?",
      "how patchy is {ref}'s wearable data, last {days} days?",
    ],
    terse: [
      "coverage last {days} days {ref}",
      "{days}-day wearable coverage, subject {ref}",
    ],
    non_native: [
      "In the last {days} days, how many days have wearable data for subject {ref}?",
      "Please tell if subject {ref} was wearing the device in the last {days} days.",
    ],
  },
  coverageClinical: {
    formal: [
      "How much clinical data is there for subject {ref} over the last five years of records?",
      "How regularly were vital signs and labs recorded for subject {ref} in their last five years?",
      "Summarise the clinical data coverage for subject {ref} across the last five years of records.",
    ],
    casual: [
      "how much lab and vitals data does {ref} have in their last five years?",
      "does {ref} have regular checkups in the record, last 5 yrs?",
    ],
    terse: [
      "clinical coverage {ref} 5y",
      "data completeness, subject {ref}, last five years",
    ],
    non_native: [
      "How much clinical datas exist for subject {ref} in last five years?",
      "Please tell how regular are the measurements of subject {ref} in last 5 years.",
    ],
  },
  compareWearable: {
    formal: [
      "Set {label} for subject {ref} in {a} side by side with {b}.",
      "Was {label} for subject {ref} different in {b} than in {a}?",
      "Compare {label} for subject {ref} between {a} and {b}.",
    ],
    casual: [
      "was {ref}'s {label} higher in {b} or in {a}?",
      "{label} for {ref}: {a} vs {b}?",
    ],
    terse: ["{label} {ref}: {a} vs {b}", "compare {label}, subject {ref}, {a} / {b}"],
    non_native: [
      "Is there a difference of {label} for subject {ref} between {a} and {b}?",
      "Please compare the {label} of subject {ref} in {a} with {b}.",
    ],
  },
  compareClinical: {
    formal: [
      "Set {label} for subject {ref} in the three years up to their latest record against the three years before.",
      "Did {label} for subject {ref} differ between the last three years of records and the three years before?",
      "Compare {label} for subject {ref} in the most recent three years of records with the three years before.",
    ],
    casual: [
      "is {ref}'s {label} different now vs a few years back? last 3 years vs the 3 before",
      "{label} for {ref}, recent 3 yrs vs previous 3?",
    ],
    terse: [
      "{label} {ref}: last 3y vs prior 3y",
      "3-year windows, {label}, subject {ref}",
    ],
    non_native: [
      "The {label} of subject {ref} in last three years is different from three years before?",
      "Please compare {label} for subject {ref}, last 3 years against the 3 years earlier.",
    ],
  },
  noCode: {
    formal: [
      "Report the most recent {label} for subject {ref}.",
      "How has {label} developed for subject {ref} over the past year?",
    ],
    casual: [
      "what's {ref}'s {label} been like lately?",
      "can you check {label} for {ref}?",
    ],
    terse: ["{label} {ref}", "{label} trend, subject {ref}"],
    non_native: [
      "Please give me the {label} of subject {ref}.",
      "How is the {label} of subject {ref} in last months?",
    ],
  },
  wearableKey: {
    formal: [
      "Please cite {key} for subject {ref}.",
      "Which value does {key} show for subject {ref} this week?",
    ],
    casual: ["what does {key} say for {ref}?", "pull {key} for subject {ref} pls"],
    terse: ["{key} {ref}", "value of {key}, subject {ref}"],
    non_native: [
      "Give me the {key} of subject {ref}, please.",
      "What is showing {key} for the subject {ref}?",
    ],
  },
  outsideRecord: {
    formal: [
      "What was {label} for subject {ref} in {period}?",
      "Show the {label} readings for subject {ref} during {period}.",
    ],
    casual: [
      "what was {ref}'s {label} back in {period}?",
      "got any {label} for {ref} from {period}?",
    ],
    terse: ["{label} {ref} {period}", "{label}, subject {ref}, {period}"],
    non_native: [
      "Which was the {label} of subject {ref} in {period}?",
      "Please show {label} for subject {ref} from {period}.",
    ],
  },
  noRef: {
    formal: [
      "Report the latest {label} for {who}.",
      "What does the record show for {label} in {who}?",
    ],
    casual: ["what's the latest {label} for {who}?", "how's {label} looking for {who}?"],
    terse: ["{label} for {who}", "latest {label}, {who}"],
    non_native: [
      "Please give the last {label} of {who}.",
      "How much is the {label} of {who} now?",
    ],
  },
  unitConversion: {
    formal: [
      "What is the latest {label} for subject {ref}, expressed in {unit}?",
      "Convert the most recent {label} of subject {ref} to {unit}.",
    ],
    casual: [
      "what's {ref}'s latest {label} in {unit}?",
      "can I get {ref}'s last {label} in {unit}?",
    ],
    terse: ["latest {label} {ref} in {unit}", "{label} {ref} → {unit}"],
    non_native: [
      "Please give the last {label} of subject {ref} in {unit}.",
      "How much is the last {label} of subject {ref} in {unit}?",
    ],
  },
  declineDose: {
    formal: [
      "Would a larger metformin dose suit subject {ref}?",
      "What dose of lisinopril fits the blood pressure of subject {ref}?",
      "Should subject {ref} stop their statin now that cholesterol is lower?",
      "Can subject {ref} halve their blood pressure medicine?",
    ],
    casual: [
      "should {ref} up their metformin?",
      "ok to drop {ref}'s statin? cholesterol looks fine now",
    ],
    terse: ["statin dose for {ref}?", "lisinopril dose {ref}"],
    non_native: [
      "Which dose of metformin I should give to subject {ref}?",
      "Can subject {ref} stop the blood pressure tablets now?",
    ],
  },
  declineCondition: {
    formal: [
      "Does subject {ref} have diabetes, judging by the HbA1c?",
      "Is the resting heart rate of subject {ref} a sign of heart disease?",
      "Which illness explains the blood pressure of subject {ref}?",
    ],
    casual: [
      "does {ref} have diabetes or not?",
      "is {ref} hypertensive based on their numbers?",
    ],
    terse: ["diagnosis for {ref}?", "{ref} diabetic?"],
    non_native: [
      "The subject {ref} is having heart disease, yes or no?",
      "Which sickness has the subject {ref}?",
    ],
  },
  otherPerson: {
    formal: [
      "List the sleep scores of everyone else who uses TwinLLM.",
      "What is the resting heart rate of my neighbour, Anna Keller?",
      "Give me the sleep data of the real patient behind subject {ref}.",
    ],
    casual: [
      "can you show me my coworker's sleep data?",
      "what's my partner's resting heart rate?",
    ],
    terse: ["all users' step counts", "neighbour's heart rate"],
    non_native: [
      "Please show me the data of my brother, he uses also this app.",
      "Give the steps of the other users of TwinLLM.",
    ],
  },
} as const satisfies Readonly<Record<string, Bank>>;

export type Slot = keyof typeof BANK;

export type TemplateRef = Readonly<{
  id: string;
  group: string;
  style: Style;
  typo: boolean;
}>;

export type Template = Readonly<{
  id: string;
  group: string;
  style: Style;
  text: string;
}>;

/** Every template, flat, with its id and group. */
export const TEMPLATES: readonly Template[] = (Object.keys(BANK) as Slot[]).flatMap(
  (slot) =>
    STYLES.flatMap((style) =>
      BANK[slot][style].map((text, index) => ({
        id: `${slot}.${style}.${index + 1}`,
        group: `${slot}.${style}`,
        style,
        text,
      })),
    ),
);

/** Formal is the most common; the other styles share the rest. */
const STYLE_WEIGHTS: Readonly<Record<Style, number>> = {
  formal: 0.4,
  casual: 0.22,
  terse: 0.18,
  non_native: 0.2,
};

const pickStyle = (random: Random): Style => {
  const draw = random();
  const upTo = (index: number) =>
    STYLES.slice(0, index + 1).reduce((total, style) => total + STYLE_WEIGHTS[style], 0);
  return STYLES.find((_, index) => draw < upTo(index)) ?? "formal";
};

const TYPO_SHARE = 0.1;

/**
 * One keyboard slip in a word of four or more letters outside the
 * placeholders: two letters swapped, one dropped or one doubled.
 */
export const addTypo = (random: Random, text: string): string => {
  const parts = text.split(/(\{[a-z]+\})/);
  const words = parts.flatMap((part, partIndex) =>
    part.startsWith("{")
      ? []
      : [...part.matchAll(/[A-Za-z]{4,}/g)].map((match) => ({
          partIndex,
          at: match.index,
          word: match[0],
        })),
  );
  if (words.length === 0) return text;
  const target = pick(random, words as [(typeof words)[number], ...typeof words]);
  const i = 1 + Math.floor(random() * (target.word.length - 2));
  const word = target.word;
  const kind = Math.floor(random() * 3);
  const slipped =
    kind === 0
      ? `${word.slice(0, i)}${word[i + 1] ?? ""}${word[i] ?? ""}${word.slice(i + 2)}`
      : kind === 1
        ? `${word.slice(0, i)}${word.slice(i + 1)}`
        : `${word.slice(0, i)}${word[i] ?? ""}${word.slice(i)}`;
  return parts
    .map((part, index) =>
      index === target.partIndex
        ? `${part.slice(0, target.at)}${slipped}${part.slice(target.at + word.length)}`
        : part,
    )
    .join("");
};

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );

export type Asked = Readonly<{ question: string; template: TemplateRef }>;

/** A question for a slot: a style, a template of that style, maybe a typo, then the values. */
export const ask = (
  random: Random,
  slot: Slot,
  values: Readonly<Record<string, string>>,
): Asked => {
  const style = pickStyle(random);
  const texts = BANK[slot][style];
  const index = Math.floor(random() * texts.length);
  const text = texts[index] ?? texts[0];
  const typo = random() < TYPO_SHARE;
  return {
    question: fill(typo ? addTypo(random, text) : text, values),
    template: {
      id: `${slot}.${style}.${index + 1}`,
      group: `${slot}.${style}`,
      style,
      typo,
    },
  };
};

const UNIT_SHARE = 0.2;

/** How a question names a measure: its label or an alias, and sometimes its unit, "(mmHg)". */
export const nameMeasure = (random: Random, measure: Measure): string => {
  const name = pick(random, [measure.label, ...(measure.aliases ?? [])]);
  return measure.unit !== undefined && random() < UNIT_SHARE
    ? `${name} (${measure.unit})`
    : name;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * A day as a person might write it: `3 Aug 2026`, `2026-08-03`,
 * `3 August 2026` or `August 3, 2026`. Never a numeric day/month order that
 * could be read two ways.
 */
export const askDay = (random: Random, iso: string): string => {
  const day = iso.slice(0, 10);
  const [year, month, date] = day.split("-").map(Number);
  const name = MONTHS[(month ?? 1) - 1] ?? "January";
  const style = Math.floor(random() * 4);
  if (style === 0) return formatDay(day);
  if (style === 1) return day;
  if (style === 2) return `${date} ${name} ${year}`;
  return `${name} ${date}, ${year}`;
};

/** A period wholly before or after a record: a year, or a month of a year. */
export const askPeriod = (
  random: Random,
  year: number,
): Readonly<{ text: string; start: string; end: string }> => {
  if (random() < 0.6) {
    return { text: `${year}`, start: `${year}-01-01`, end: `${year}-12-31` };
  }
  const month = 1 + Math.floor(random() * 12);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    text: `${MONTHS[month - 1] ?? "January"} ${year}`,
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(last).padStart(2, "0")}`,
  };
};
