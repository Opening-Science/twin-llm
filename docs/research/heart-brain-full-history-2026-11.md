# Heart and brain: full-history batches and a rule-change test (November 2026)

Issue #295, a follow-up to #262 (`heart-brain-timing-2026-10.md`). Research
use only, synthetic data only.

Synthea encodes rules, not medicine. Every number below describes what an
analysis pipeline finds in data made by those rules. None of it is evidence
about people, and nothing here transfers to people.

## The question

The 1M batches were exported with Synthea's default
`exporter.years_of_history = 10`, so ended conditions before 2016 are
missing and the within-person design of #262 counts time from 2016 only. On
all 100 batches that left 26 strokes before AF onset against 272 after
(age-adjusted rate ratio 3.09, 2.07 to 4.63). Two things were open:

1. With the whole record exported, how many strokes before AF onset are
   there, and does the within-person ratio hold?
2. Does the pipeline follow a planted rule when the rule changes? #294 checked
   the size of the effect against Synthea's own calculator; this changes the
   rule and checks that the estimate moves with it.

## How it was run

```sh
# One batch with the whole record (seed 1000 + N, clinician seed 2000 + N)
SYNTHEA_JAR=<pinned v4.0.0 jar> \
  scripts/heart-brain/full-history/generate-batch.sh 1 ../synthea-1m-v2/fullhist/batches

# The analyses, reading every person's whole record
bun run heart-brain -- --batches 001-006 --archives ../synthea-1m-v2/fullhist/batches \
  --out research-out/hb-full --history-years 0
bun run heart-brain:timing -- --batches 001-006 --out research-out/hb-full --history-years 0
bun run heart-brain:oracle -- --batches 001-006 --archives ../synthea-1m-v2/fullhist/batches \
  --out research-out/hb-full --history-years 0
```

`generate-batch.sh` repeats the 1M recipe (`synthea-1m-v2/run-worker.sh`):
Synthea v4.0.0 (jar SHA-256 `ed43c20a...e6ecc1`, checked before each run, the
local copy, never downloaded again), Massachusetts, 10,000 living people,
reference and end date 2026-01-01, UTC, one generator thread, run with
`nice -n 10`. The only change to the properties is
`exporter.years_of_history = 0`. Archives are written next to the 1M batches
in `synthea-1m-v2/fullhist/` and never committed. Every archive's SHA-256, the
checksum of its patient files (`sha256sum *.json | sort | sha256sum`, as for
the 1M batches), the properties hash, the record counts and the run time are
in [`scripts/heart-brain/full-history/manifest.json`](../../scripts/heart-brain/full-history/manifest.json),
with the 10-year archive of the same batch beside each.

`heart-brain:oracle` takes a new flag, `--af-factor`, that multiplies the
calculator's hazard on days with AF on (1, the released jar, by default); it
is used only for the rule-change test.

## Data

Batches 001 to 006, regenerated with seeds 1001 to 1006 and clinician seeds
2001 to 2006: 69,193 bundles (60,000 living, 9,193 deceased), none skipped,
none without a BP on record.

- Each batch took 80 to 120 minutes of one core (4,820 to 7,229 s wall, with
  up to six Synthea runs at once on 8 cores) and is about 100 GB of FHIR JSON
  before compression, 2.3 to 2.5 GB as `.tar.zst` (the 10-year archives are
  about 0.86 GB). Free disk stayed at 1.4 TB.
- The same seed gives the same people. Batches 001, 002, 003, 005 and 006 have
  exactly the record counts of their 10-year runs. Batch 004 has 11,537
  records against 11,535: all 11,535 file names of the 10-year run are there,
  plus two more deceased people. The cause is not known; it does not touch
  the other batches, and the analysis uses batch 004 as generated.
- The person files cannot be compared byte for byte with the 10-year ones,
  because the export itself differs.

Extracting the people files and the oracle files took 5 to 14 minutes per
batch.

## Part 1: strokes before AF onset with the whole record

### Methods

The #262 designs without change, with `--history-years 0`: each person with
AF is followed from birth (or age 55) to their first stroke, death or
2026-01-01, and that time is split at their AF onset. The ratio to read is
the one adjusted for 5-year age bands (Mantel-Haenszel). Negative control:
each AF onset moved to a random day of the same person's follow-up from age
45, 50 times. Analysis seed 250.

### Results, batches 001 to 006

| Batches 001 to 006, all ages              | 10-year export       | Whole record          |
| ----------------------------------------- | -------------------- | --------------------- |
| People with AF and counted time           | 489                  | 587                   |
| Strokes before AF onset                   | 1                    | 14                    |
| Person-years before onset                 | 1,346                | 41,185                |
| Strokes after AF onset                    | 19                   | 35                    |
| Person-years after onset                  | 3,127                | 6,194                 |
| Crude ratio (exact)                       | 8.18 (1.30 to 339.9) | 16.62 (8.72 to 33.45) |
| Age-adjusted ratio                        | 6.18 (0.63 to 60.27) | 4.28 (1.75 to 10.47)  |
| Shuffled onset, age-adjusted (mean, 95%)  | 1.46 (0.26 to 2.59)  | 1.62 (0.66 to 3.28)   |
| Shuffles at or above observed (age-adj.)  | 0 of 41 (p = 0.02)   | 0 of 50 (p = 0.02)    |
| Oracle expected, age-adjusted (#294)      | 1.94                 | 2.11                  |
| Strokes before onset, observed / expected | 1 / 2.3              | 14 / 17.7             |
| Strokes after onset, observed / expected  | 19 / 14.1            | 35 / 24.8             |

From age 55 with the whole record: 10 strokes before onset in 9,401
person-years, 35 after in 5,830; age-adjusted 4.32 (1.76 to 10.58), case
series 5.76 (1.90 to 17.45; shuffled 1.65, 0.33 to 4.29, p = 0.04). The case
series over all ages does not settle with age bands from birth and gives no
estimate.

By window after onset (whole record, age-adjusted): 0 to 2 years 6.91 (2.15
to 22.21), 2 to 5 years 3.40 (0.92 to 12.52), 5 years or more 4.70 (1.70 to
12.98).

What this says:

- The whole record has 14 strokes before AF onset in 6 batches where the
  10-year export has 1. At that rate the 100 batches would have about 230
  against the 26 the 10-year export gives; that is an extrapolation from 6
  batches, not a count.
- The age-adjusted ratio on 6 batches, 4.28 (1.75 to 10.47), includes the
  committed 3.09 from 100 batches and also the oracle's expected 2.11. Six
  batches cannot tell those apart; the upper end is still six times the
  lower.
- The crude ratio is no longer worth reading: time before onset now includes
  childhood, when Synthea gives almost no strokes, so it rises to 16.6 and
  the shuffle's crude ratio to 10.7. Age adjustment brings both back (4.28
  against 1.62).
- The shift of AF onset to the wellness visit (#294) matters much less: 0.7%
  of the time before onset has AF on, against 8.7% in the 10-year cohort,
  because almost all of the before time is now years away from onset.
- After onset the observed strokes are still above the oracle (35 against
  24.8, 1.41), as in #294 Part 3; before onset they are now close to it (14
  against 17.7, 0.79). With the whole record the overshoot of the
  within-person ratio still comes from both sides, and #323's
  `blood_pressure_controlled` factor of 1.06 applies to both.
- The 10-year export also hides earlier strokes. Cut back to 2016, the whole
  records leave 29 people with AF out of counted time because their first
  stroke was before 2016. The 10-year export shows only 8 such people, since
  a stroke that ended before 2016 is not exported, and keeps the others in
  counted time (489 people against 471). On these batches that did not
  change the stroke counts inside the window (1 before onset, 19 after, in
  both).

## Part 2: the rule-change test

### The change

A copy of `modules/stroke.json` from the pinned jar (SHA-256
`9c26c970...e6ad90`) in
[`scripts/heart-brain/full-history/rule-change/modules/stroke.json`](../../scripts/heart-brain/full-history/rule-change/modules/stroke.json)
(SHA-256 `44dc56b3...50be` as run, prettier-formatted). In the released
module, `Chance_of_Stroke` waits one month and then goes to `Stroke` with
probability `stroke_risk` (the calculator's 7-day risk, set every time step
by `CardiovascularDiseaseModule`), otherwise back to itself. The copy changes
exactly this:

- `Chance_of_Stroke`: the "otherwise" branch goes to a new state
  `AF_Second_Draw_Check` instead of back to `Chance_of_Stroke`.
- `AF_Second_Draw_Check` (Simple): if the attribute `atrial_fibrillation` is
  set (`is not nil`, the attribute `atrial_fibrillation.json` sets and the
  calculator reads), go to `Second_Chance_of_Stroke`; otherwise back to
  `Chance_of_Stroke`.
- `Second_Chance_of_Stroke` (Simple): to `Stroke` with probability
  `stroke_risk`, otherwise back to `Chance_of_Stroke`.
- One remark added. Nothing else changed.

So with AF the monthly chance is 1 - (1 - p)^2 = 2p - p^2 instead of p: the
stroke hazard on AF time is multiplied by 2 - p, within 0.5% of 2 for any p
the calculator gives. Without AF, no extra random number is drawn, so a
person without AF is simulated exactly as before. Synthea keys modules by
their path, so `-d <dir>` with `stroke.json` in it replaces the built-in
module; a test copy that sent every draw to `Stroke` gave a stroke to all 5
people of a small run, so the copy is the one used.

### Runs

Two arms with the same seeds: base (released modules) and AF times 2 (the
copy, loaded with `-d`). Each arm is two runs, seeds 2951 / 2952 and 2953 /
2954, 400 living people aged 55 to 95 kept only when they have AF at the end
(`scripts/synthea/keep/s7-af.json`), whole record exported. The keep module
puts every person into the AF cohort, so a small run has enough strokes.
Base: 1,001 records (796 living); AF times 2: 1,002 (796 living). Each run
took 3.2 hours of one core (11,598 to 11,834 s), longer than planned because
the age range and the keep module throw most generated people away.

The oracle reads both arms twice: with the released calculator
(`--af-factor 1`) and with the changed rule (`--af-factor 2`).

### Results

| Comparison (whole record)              | Base: recovered     | Base: expected | AF times 2: recovered | AF times 2: expected (factor 2) |
| -------------------------------------- | ------------------- | -------------- | --------------------- | ------------------------------- |
| Within-person, all after, age-adjusted | 1.91 (1.00 to 3.65) | 2.15           | 3.95 (2.17 to 7.20)   | 3.93                            |
| Within-person from 55, age-adjusted    | 2.06 (1.07 to 3.97) | 2.24           | 3.98 (2.14 to 7.39)   | 4.07                            |
| Between-person, AF then stroke         | 2.16 (1.39 to 3.36) | 2.28           | 5.28 (3.40 to 8.19)   | 3.92                            |
| Between-person, AF from 55             | 2.79 (1.71 to 4.56) | 2.37           | 4.41 (2.79 to 6.95)   | 4.03                            |
| Case series from 55                    | 1.72 (0.66 to 4.51) | 2.18           | 3.34 (1.41 to 7.92)   | 4.01                            |
| Planted (calculator AF on over off)    |                     | 2.36           |                       | 4.72                            |

Every expected value lies inside its recovered interval, in both arms. The
case series over all ages did not settle in the AF times 2 arm.

Strokes against the released oracle (factor 1), within-person cohort:

| Arm        | Before onset, observed / expected | After onset, observed / expected | After, observed / expected |
| ---------- | --------------------------------- | -------------------------------- | -------------------------- |
| Base       | 22 / 21.2                         | 36 / 28.7                        | 1.26 (0.88 to 1.74)        |
| AF times 2 | 21 / 21.1                         | 59 / 28.5                        | 2.07 (1.58 to 2.67)        |

What this says:

- The estimate moves the right way and by about the right amount. The
  age-adjusted within-person ratio goes from 1.91 to 3.95 (2.07 times); the
  oracle with the changed rule predicts 2.15 to 3.93 (1.83 times). The ratio
  moves by less than the factor of 2 in expectation because the factor also
  falls on the little AF time before the recorded onset.
- Strokes after onset go from 36 to 59 on the same expected count, a ratio of
  1.65 (1.07 to 2.57, exact), which includes the planted 2 and excludes 1.
  Strokes before onset do not move (22 and 21), as they should not: the
  change touches only AF time.
- With the changed rule in the oracle, observed and expected agree after
  onset (59 against 57.0) and before it (21 against 22.3).
- The between-person design overshoots in the AF times 2 arm (5.28 against
  3.92) and the matched controls have fewer strokes than expected (30
  against 39.0). In this cohort every control is a person with AF later, so
  the controls carry lagged AF time; with 30 strokes this may be chance.
- In the base arm the within-person ratio (1.91) is close to the oracle
  (2.15), unlike the 10-year cohort in #294 (3.78 against 2.01). Base strokes
  after onset are still 1.26 times the oracle, as in #294 Part 3 and #323.

## Limits

- Part 1 has 6 of 100 batches: 14 strokes before onset, intervals whose
  upper end is about six times the lower. It shows the count rises and the ratio stays above the
  shuffle; it does not pin down the size.
- The rule-change runs use an age range and a keep module, not the 1M
  recipe, and 400 living people per run. The test shows the pipeline follows
  a doubling; a smaller change would need larger runs.
- Batch 004 is not an exact repeat of its 10-year run (two more deceased
  records); why is not known.
- One analysis seed, 50 shuffles (41 that gave a ratio on the 10-year export
  of 6 batches); p = 0.02 is the smallest these allow.

## What is left

- The other 94 batches with the whole record: about 100 GB each before
  compression and 1.5 to 2 hours of one core, so about 160 core-hours and
  230 GB of archives.
- The 14 against 17.7 before onset and 35 against 24.8 after onset on the
  whole record, on more batches, to see whether the after-onset excess of
  #294 and #323 stays.
- Why batch 004 gave two more records.
