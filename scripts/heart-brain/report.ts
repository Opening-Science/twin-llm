/**
 * The run summary (what was read, with which codes and seed) and its Markdown
 * report. Pure. Numbers only; no person-level row ever reaches the report.
 */
import { type ScoreRow } from "./af-tables";
import {
  CONDITION_CODES,
  type CodeEntry,
  ORAL_ANTICOAGULANT_CODES,
  TOPICS,
} from "./codes";
import { type MatchedResult } from "./matched";
import { type Spread } from "./permutation";
import { type Rate, type RateRatio } from "./poisson";
import { type Study, type StudyOptions } from "./study";

export type BatchRun = Readonly<{
  batch: string;
  seed: number | null;
  clinicianSeed: number | null;
  syntheaVersion: string | null;
  jarSha256: string | null;
  endDate: string | null;
  bundles: number;
  people: number;
  skipped: number;
  seconds: number;
}>;

export type Summary = Readonly<{
  title: string;
  generatedAt: string;
  options: StudyOptions;
  batches: readonly BatchRun[];
  codes: Readonly<{
    conditions: Readonly<Record<string, readonly CodeEntry[]>>;
    oralAnticoagulants: readonly CodeEntry[];
  }>;
  /** Codes in the data matching the search patterns, records per code. */
  codesSeen: Readonly<{
    cerebrovascular: Readonly<Record<string, number>>;
    anticoagulants: Readonly<Record<string, number>>;
  }>;
  study: Study;
}>;

export const buildSummary = (
  options: StudyOptions,
  batches: readonly BatchRun[],
  codesSeen: Summary["codesSeen"],
  study: Study,
  generatedAt: string,
): Summary => ({
  title: "Heart and brain relations in the synthetic cohort",
  generatedAt,
  options,
  batches,
  codes: { conditions: CONDITION_CODES, oralAnticoagulants: ORAL_ANTICOAGULANT_CODES },
  codesSeen,
  study,
});

const whole = (value: number): string => Math.round(value).toLocaleString("en-US");

const fixed = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined ? "n/a" : value.toFixed(digits);

const rate = (value: Rate): string =>
  value.per100 === null || value.ci === null
    ? `${value.events} events, no person-time`
    : `${fixed(value.per100)} (${fixed(value.ci.low)} to ${fixed(value.ci.high)})`;

const ratio = (value: RateRatio): string =>
  value === null
    ? "n/a"
    : `${fixed(value.ratio)} (${fixed(value.ci.low)} to ${fixed(value.ci.high)})`;

const spread = (value: Spread | null, digits = 2): string =>
  value === null
    ? "n/a"
    : `${fixed(value.mean, digits)} (${fixed(value.low, digits)} to ${fixed(value.high, digits)}, ${value.runs} runs)`;

const table = (head: readonly string[], rows: readonly (readonly string[])[]): string =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

const scoreRows = (rows: readonly ScoreRow[]) =>
  rows.map((row) => [
    row.group,
    whole(row.people),
    whole(row.rate.events),
    fixed(row.rate.personYears, 0),
    rate(row.rate),
  ]);

const matchedRow = (label: string, result: MatchedResult) => [
  label,
  `${whole(result.exposedPeople)} / ${whole(result.controlPeople)}`,
  rate(result.exposed),
  rate(result.controls),
  ratio(result.ratio),
];

const orderCells = (order: Study["order"]) => [
  whole(order.both),
  whole(order.strokeFirst),
  whole(order.sameDay),
  whole(order.afFirst),
];

const tally = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts).length === 0
    ? "none"
    : Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => `\`${key}\` (${whole(count)} records)`)
        .join("; ");

export const renderReport = (summary: Summary): string => {
  const { study, options } = summary;
  const people = study.people;
  const order = study.order;
  const time = study.timeToStroke;
  const coc = study.sleepApneaAf;
  return [
    `# ${summary.title}`,
    "",
    "Synthetic data only. Synthea encodes rules, not medicine (Chen et al. 2019, BMC Medical Informatics and Decision Making). These numbers describe what the generator planted and whether this pipeline finds it again. Nothing here transfers to real people, and CHA2DS2-VASc is used only to describe groups.",
    "",
    "## Run",
    "",
    table(
      [
        "Batch",
        "Seed",
        "Clinician seed",
        "Synthea",
        "End date",
        "Bundles",
        "People",
        "Seconds",
      ],
      summary.batches.map((batch) => [
        batch.batch,
        String(batch.seed ?? "n/a"),
        String(batch.clinicianSeed ?? "n/a"),
        batch.syntheaVersion ?? "n/a",
        batch.endDate ?? "n/a",
        whole(batch.bundles),
        whole(batch.people),
        whole(batch.seconds),
      ]),
    ),
    "",
    `Analysis seed ${options.seed}, ${options.controlsPerExposed} matched controls per exposed person, ${options.permutations} shuffles. Jar sha256 ${summary.batches[0]?.jarSha256 ?? "n/a"}.`,
    "",
    options.historyYears === 0
      ? "Outcomes are counted over the whole exported record."
      : `Synthea exports only the last ${options.historyYears} years of history (\`exporter.years_of_history\`): ended conditions such as a stroke, and older medication orders, are left out before that, while active conditions keep their first onset. Person-time and outcomes are therefore counted only inside that window, before each batch's end date.`,
    "",
    "## People",
    "",
    table(
      ["Group", "People"],
      [
        ["All (living and deceased bundles)", whole(people)],
        ["Female", whole(study.female)],
        ["Deceased", whole(study.deceased)],
        ...TOPICS.map((topic) => [topic, whole(study.counts[topic])]),
        ["Any oral anticoagulant order", whole(study.anticoagulated)],
      ],
    ),
    "",
    "## Codes",
    "",
    ...TOPICS.map(
      (topic) =>
        `- ${topic}: ${summary.codes.conditions[topic]?.map((entry) => `${entry.code} ${entry.display}`).join(", ") ?? ""}`,
    ),
    `- Oral anticoagulants (RxNorm): ${summary.codes.oralAnticoagulants.map((entry) => `${entry.code} ${entry.display}`).join(", ")}`,
    "",
    `Cerebrovascular codes in the data: ${tally(summary.codesSeen.cerebrovascular)}.`,
    "",
    `Oral anticoagulant codes in the data: ${tally(summary.codesSeen.anticoagulants)}.`,
    "",
    "## CHA2DS2-VASc at AF onset",
    "",
    table(
      ["Score", "People"],
      Object.entries(study.scores)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([score, count]) => [score, whole(count)]),
    ),
    "",
    "## Stroke after AF onset",
    "",
    "People with AF and no stroke on or before onset, followed to the first stroke, death or the batch end date. Rates per 100 person-years with exact Poisson 95% intervals.",
    "",
    table(
      ["CHA2DS2-VASc", "People", "Strokes", "Person-years", "Rate per 100 py"],
      scoreRows(study.strokeByScore),
    ),
    "",
    `By oral anticoagulation (person-time split at the first order): ${whole(study.anticoagulation.everTreated)} of the AF people had an order on or after onset, a median of ${fixed(study.anticoagulation.medianDaysToFirstOrder, 0)} days after it.`,
    "",
    table(
      ["Person-time", "Strokes", "Person-years", "Rate per 100 py"],
      [
        [
          "Before the first order",
          whole(study.anticoagulation.without.events),
          fixed(study.anticoagulation.without.personYears, 0),
          rate(study.anticoagulation.without),
        ],
        [
          "From the first order",
          whole(study.anticoagulation.with.events),
          fixed(study.anticoagulation.with.personYears, 0),
          rate(study.anticoagulation.with),
        ],
      ],
    ),
    "",
    `Rate ratio, time from the first order against time before it: ${ratio(study.anticoagulation.ratio)}.`,
    "",
    `Time from AF onset to stroke (${whole(time.strokes)} strokes): median ${fixed(time.medianDays, 0)} days, quartiles ${fixed(time.quartileDays?.low, 0)} to ${fixed(time.quartileDays?.high, 0)}. Under 1 year ${time.byYears["<1"]}, 1 to 5 years ${time.byYears["1-5"]}, 5 to 10 years ${time.byYears["5-10"]}, 10 years or more ${time.byYears["10+"]}.`,
    "",
    "## Order of stroke and AF",
    "",
    table(
      ["People", "Both recorded", "Stroke first", "Same day", "AF first"],
      [
        ["All", ...orderCells(order)],
        ["Both onsets inside the window", ...orderCells(study.orderInWindow)],
      ],
    ),
    "",
    "## Planted rule against recovered",
    "",
    "Each exposure against age- and sex-matched people without it on the same day (same sex, born within a year). Rate ratio with a 95% log-scale interval.",
    "",
    table(
      ["Relation", "Planted", "Generator source", "Rate ratio", "Recovered", "Verdict"],
      study.rules.map((rule) => [
        rule.label,
        rule.planted,
        rule.source,
        ratio(rule.ratio),
        rule.recovered,
        rule.agreement,
      ]),
    ),
    "",
    table(
      [
        "Matched comparison",
        "Exposed / controls",
        "Exposed rate per 100 py",
        "Control rate per 100 py",
        "Rate ratio",
      ],
      study.rules.flatMap((rule) =>
        rule.result === null ? [] : [matchedRow(rule.label, rule.result)],
      ),
    ),
    "",
    "## Negative control: shuffled AF onsets",
    "",
    "Each AF onset moved to a random day in the same person's follow-up from age 45. If the stroke excess follows the AF date, it should shrink; what remains comes from who gets AF.",
    "",
    table(
      ["Measure", "Observed", "Shuffled mean (2.5% to 97.5%)"],
      [
        [
          "Share of AF and stroke people with AF first",
          fixed(study.shuffled.observedAfFirstShare),
          spread(study.shuffled.afFirstShare),
        ],
        [
          "AF then stroke, matched rate ratio",
          fixed(study.shuffled.observedRatio),
          spread(study.shuffled.ratio),
        ],
      ],
    ),
    "",
    "## Sleep apnea and AF",
    "",
    table(
      [
        "Sleep apnea and AF",
        "Sleep apnea only",
        "AF only",
        "Neither",
        "Crude OR",
        "OR within sex and age band",
      ],
      [
        [
          whole(coc.table.both),
          whole(coc.table.onlyA),
          whole(coc.table.onlyB),
          whole(coc.table.neither),
          fixed(coc.crudeOddsRatio),
          fixed(coc.adjustedOddsRatio),
        ],
      ],
    ),
    "",
  ].join("\n");
};
