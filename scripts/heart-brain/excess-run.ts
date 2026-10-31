/**
 * Host CLI for #323: reads an instrumented Synthea run (`out/fhir` and
 * `out/json` of the same people, see `excess.ts`) and writes what the stroke
 * calculator saw against what the record shows, before and after the
 * recorded AF onset.
 *
 *   bun run heart-brain:excess -- --run <synthea dir> --out research-out/heart-brain/excess.json
 *
 * The record is cut to the last `--history-years` (10, as in the 1M cohort)
 * before the oracle reads it, so it sees what #294 saw. Synthetic data only;
 * prints totals, never a person.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { dayNumber, historyStart } from "../../packages/query-tools/event-rates/cohort";
import { toPerson } from "./to-person";
import {
  addSums,
  afTiming,
  type AfTiming,
  dayOfMs,
  emptySums,
  enteredTimes,
  monitorChecks,
  personExcess,
  type SideSums,
  trueChance,
} from "./excess";
import { oracleSubject } from "./oracle";
import { oracleFacts } from "./oracle-facts";
import { bundleFacts } from "./person-facts";
import { poissonExactCi } from "../../packages/query-tools/event-rates/poisson";
import { specFor } from "./timing";

const flag = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const run = flag("--run", "");
const out = flag("--out", "research-out/heart-brain/excess.json");
const endDay = flag("--end-day", "2026-01-01");
const historyYears = Number(flag("--history-years", "10"));
if (run === "") {
  process.stderr.write(
    "Usage: bun run heart-brain:excess -- --run <synthea dir with out/fhir and out/json> [--out <file>] [--end-day 2026-01-01] [--history-years 10]\n",
  );
  process.exit(2);
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const fhirDir = join(run, "out", "fhir");
const jsonDir = join(run, "out", "json");
const names = (await readdir(jsonDir)).filter((name) => name.endsWith(".json")).sort();
const observedFrom = historyStart(endDay, historyYears);
const spec = specFor(0, [0]);

let before = emptySums();
let after = emptySums();
let people = 0;
let counted = 0;
let skipped = 0;
let monitorMissing = 0;
let checksNotOnStrokeCycle = 0;
let checksSeen = 0;
let strokeDayMismatch = 0;
const afTimings: Record<AfTiming, number> = {
  "in window": 0,
  "before previous visit": 0,
  "after recorded onset": 0,
};
const afLagDays: number[] = [];
// Every monitored check up to the first stroke: Synthea's own strokes against its chances.
let monitoredTruth = 0;
let monitoredStrokes = 0;

for (const name of names) {
  people += 1;
  const [bundleText, personText] = await Promise.all([
    readFile(join(fhirDir, name), "utf8"),
    readFile(join(jsonDir, name), "utf8"),
  ]);
  const bundle: unknown = JSON.parse(bundleText);
  const state: unknown = JSON.parse(personText);
  const facts = bundleFacts(bundle, "excess");
  const attributes =
    isObject(state) && isObject(state.attributes) ? state.attributes : null;
  if (facts === null || attributes === null || facts.person.sex === null) {
    skipped += 1;
    continue;
  }
  const entries = isObject(bundle) ? list(bundle.entry) : [];
  const full = oracleFacts(entries);
  const keep = <T>(rows: readonly (readonly [string, T])[]) =>
    rows.filter(([day]) => dayNumber(day) >= observedFrom);
  const recordFacts = {
    systolic: keep(full.systolic),
    smoker: keep(full.smoker),
    wellness: full.wellness.filter((day) => dayNumber(day) >= observedFrom),
  };
  const person = toPerson(facts.person, endDay, historyYears);
  const subject = oracleSubject(recordFacts, {
    sex: facts.person.sex,
    birth: facts.person.birth,
    onsets: facts.person.onsets,
  });

  const monitor = list(attributes["Excess Monitor Module"]);
  const checks = monitorChecks(monitor);
  if (checks.length === 0) monitorMissing += 1;

  // The monitor should wake exactly when stroke.json draws.
  const strokeHistory = list(attributes["Stroke Module"]);
  const draws = new Set(
    strokeHistory
      .filter(isObject)
      .filter((s) => s.state_name === "Chance_of_Stroke" && typeof s.exited === "number")
      .map((s) => s.exited as number),
  );
  const lastDraw = Math.max(...draws, Number.NEGATIVE_INFINITY);
  for (const check of checks) {
    if (check.at > lastDraw) continue;
    checksSeen += 1;
    if (!draws.has(check.at)) checksNotOnStrokeCycle += 1;
  }
  const strokeAt = enteredTimes(strokeHistory, "Stroke")[0];
  const recordedStroke = person.onset.stroke;
  if (
    strokeAt !== undefined &&
    recordedStroke !== undefined &&
    dayOfMs(strokeAt) !== recordedStroke
  ) {
    strokeDayMismatch += 1;
  }

  const monitoredUntil = strokeAt ?? lastDraw;
  monitoredTruth += checks
    .filter((check) => check.at <= monitoredUntil)
    .reduce((total, check) => total + trueChance(check), 0);
  const firstCheck = checks[0]?.at;
  if (strokeAt !== undefined && firstCheck !== undefined && strokeAt >= firstCheck) {
    monitoredStrokes += 1;
  }

  const afAt = enteredTimes(
    list(attributes["Atrial Fibrillation Module"]),
    "Diagnosis",
  )[0];
  if (afAt !== undefined && person.onset.af !== undefined) {
    const allWellness = full.wellness.map(dayNumber);
    afTimings[afTiming(dayOfMs(afAt), person.onset.af, allWellness)] += 1;
    afLagDays.push(person.onset.af - dayOfMs(afAt));
  }

  const sides = personExcess(person, subject, checks, spec);
  if (sides === null) continue;
  counted += 1;
  before = addSums(before, sides.before);
  after = addSums(after, sides.after);
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round = (value: number | null, digits = 3) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
const describe = (sums: SideSums) => {
  const ci = poissonExactCi(sums.observed);
  return {
    personYears: round(sums.days / 365.25, 1),
    observed: sums.observed,
    oracle: round(sums.oracle, 2),
    checks: sums.checks,
    truth: round(sums.truth, 2),
    observedOverTruth: {
      ratio: round(ratio(sums.observed, sums.truth)),
      low: round(ratio(ci.low, sums.truth)),
      high: round(ratio(ci.high, sums.truth)),
    },
    truthOverOracle: round(ratio(sums.truth, sums.oracle)),
    variants: Object.fromEntries(
      Object.entries(sums.variants).map(([name, value]) => [
        name,
        {
          expected: round(value, 2),
          overRecord: round(ratio(value, sums.variants.record)),
        },
      ]),
    ),
    bp: {
      recovered: sums.bpRecovered,
      ambiguous: sums.bpAmbiguous,
      meanPointsGain: round(ratio(sums.bpPointsGain, sums.bpRecovered)),
      controlledShare: round(ratio(sums.bpControlled, sums.checks)),
      sameBandAsRecordControlled: round(
        ratio(sums.bpSameBandControlled, sums.bpComparedControlled),
      ),
      comparedControlled: sums.bpComparedControlled,
      sameBandAsRecordUncontrolled: round(
        ratio(sums.bpSameBandUncontrolled, sums.bpComparedUncontrolled),
      ),
      comparedUncontrolled: sums.bpComparedUncontrolled,
      gainControlled: round(sums.bpGainControlled, 2),
      gainUncontrolled: round(sums.bpGainUncontrolled, 2),
    },
    afDisagreeShare: round(ratio(sums.afDisagree, sums.checks)),
    diabetesDisagreeShare: round(ratio(sums.diabetesDisagree, sums.checks)),
  };
};
const sortedLag = [...afLagDays].sort((a, b) => a - b);
const quantile = (q: number) =>
  sortedLag.length === 0 ? null : sortedLag[Math.floor(q * (sortedLag.length - 1))];

const result = {
  run,
  endDay,
  historyYears,
  people,
  skipped,
  counted,
  monitorMissing,
  checksOnStrokeCycle: { seen: checksSeen, notOnCycle: checksNotOnStrokeCycle },
  strokeDayMismatch,
  monitored: {
    strokes: monitoredStrokes,
    expected: round(monitoredTruth, 2),
    ratio: round(ratio(monitoredStrokes, monitoredTruth)),
    low: round(ratio(poissonExactCi(monitoredStrokes).low, monitoredTruth)),
    high: round(ratio(poissonExactCi(monitoredStrokes).high, monitoredTruth)),
  },
  afTiming: afTimings,
  afLagDays: {
    n: sortedLag.length,
    median: quantile(0.5),
    p90: quantile(0.9),
    max: quantile(1),
  },
  before: describe(before),
  after: describe(after),
};
await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
