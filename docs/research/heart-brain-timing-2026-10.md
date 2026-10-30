# Heart and brain: onset timing and wearable recovery (October 2026)

Issue #262, a follow-up to #250 (`heart-brain-2026-10.md`). Research use only,
synthetic data only.

Synthea encodes rules, not medicine. Every number below describes what an
analysis pipeline finds in data made by those rules. None of it is evidence
about people, and nothing here transfers to people.

## The question

#250 found that people with AF have more strokes than matched people without
AF (rate ratio 2.54 on 30 batches), but shuffling each AF onset to a random
day of the same person's life gave nearly the same ratio (2.39, 2.04 to 2.78).
So that design shows who gets AF, not that the AF date matters. Synthea
v4.0.0 adds stroke points for AF from age 55 (`stroke.json` and the
Framingham stroke calculator), so a design that compares the same people
before and after their own AF onset should find a rise that a shuffled onset
does not.

## How to run it

```sh
bun run heart-brain -- --batches 001-100 --jobs 6     # extract people files (once)
bun run heart-brain:timing -- --batches 001-100       # within-person timing, seconds
bun run heart-brain:wearables -- --batches 001-003    # wearable recovery, about 6 minutes
```

Both new commands take the flags of `bun run heart-brain` (`--out`, `--seed`,
`--permutations`, `--history-years`, `--archives`). `heart-brain:timing`
reads only the people files and writes `<out>/timing.json`.
`heart-brain:wearables` streams the archives read-only, builds each series in
memory and writes only the pooled table to `<out>/wearable-recovery.json`; no
series is written anywhere. The numbers below are in
[`heart-brain-timing-2026-10.summary.json`](heart-brain-timing-2026-10.summary.json).

## Data

All 100 batches of the 1M cohort: 1,150,311 bundles (1,000,000 living, 150,311
deceased), none skipped. Synthea v4.0.0, Massachusetts, end date 2026-01-01,
analysis seed 250, 50 shuffles. Extracting the 70 batches not yet read took
56 minutes with 6 jobs; the analyses then take seconds.

As in #250, Synthea exports only the last 10 years of ended conditions, so a
stroke before 2016 can be missing. All time and all strokes are counted from
2016-01-01 only.

## Part 1: stroke before and after AF onset, in the same people

### Methods

- **Within-person cohort** (`scripts/heart-brain/within-person.ts`). Every
  person with AF is followed from 2016-01-01 (or age 55 in the second
  analysis) to their first stroke, death or 2026-01-01. That time is split at
  their AF onset into before and after, and the after time into 0 to 2, 2 to
  5 and 5 or more years. A stroke on the onset day counts before it. Rates
  have exact Poisson intervals; the crude ratio has an exact interval
  (conditional binomial, Clopper-Pearson). Time after onset is older time, and
  Synthea's stroke risk rises with age, so the ratio to read is the one
  adjusted for 5-year age bands (Mantel-Haenszel, Greenland-Robins interval).
- **Self-controlled case series** (`scripts/heart-brain/sccs.ts`). Only people
  with AF and a stroke inside counted time, each followed over all of it, with
  a conditional Poisson model: one parameter per window after onset (before is
  the reference) and one per 5-year age band (a band with no stroke is pooled
  with the next). Everything fixed about a person cancels. Wald intervals.
- **Negative control.** Each AF onset moved to a random day of the same
  person's follow-up from age 45, 50 times (`permutation.ts`, as in #250), and
  both designs run again.

### Results, 100 batches

From 2016, all ages: 8,144 people with AF have counted time (75 left out with a
stroke before it). 26 strokes in 22,564 person-years before onset, 272 in
52,124 after.

| Window after AF onset | Strokes | Rate per 100 py | Crude ratio (exact) | Age-adjusted ratio  | Case series ratio   |
| --------------------- | ------- | --------------- | ------------------- | ------------------- | ------------------- |
| Before (reference)    | 26      | 0.12            | 1                   | 1                   | 1                   |
| All after             | 272     | 0.52            | 4.53 (3.02 to 7.06) | 3.09 (2.07 to 4.63) | 2.82 (1.58 to 5.04) |
| 0 to 2 years          | 40      | 0.51            | 4.39 (2.62 to 7.50) | 3.81 (2.34 to 6.18) | 3.14 (1.77 to 5.58) |
| 2 to 5 years          | 34      | 0.34            | 2.95 (1.72 to 5.12) | 2.39 (1.44 to 3.97) | 1.95 (0.96 to 3.95) |
| 5 years or more       | 198     | 0.58            | 5.02 (3.33 to 7.88) | 3.05 (2.01 to 4.62) | 2.37 (1.05 to 5.32) |

From 2016 and age 55: 7,868 people, 25 strokes before and 271 after.
Age-adjusted 3.15 (2.10 to 4.74), case series 2.79 (1.55 to 5.01); the
windows are within 0.1 of the all-ages ones. Almost no stroke happens before
55 in Synthea, so the two analyses share nearly every event.

**Against the shuffled onsets:**

| Measure (all after against before) | Observed | Shuffled mean (2.5% to 97.5%) | Shuffles at or above observed |
| ---------------------------------- | -------- | ----------------------------- | ----------------------------- |
| Within-person, crude               | 4.53     | 2.42 (1.58 to 3.71)           |                               |
| Within-person, age-adjusted        | 3.09     | 1.40 (0.91 to 2.19)           | 0 of 50 (p = 0.02)            |
| Case series                        | 2.82     | 1.33 (0.56 to 2.46)           | 0 of 50 (p = 0.02)            |
| From 55, age-adjusted              | 3.15     | 1.41 (0.91 to 2.14)           | 0 of 50 (p = 0.02)            |
| From 55, case series               | 2.79     | 1.32 (0.55 to 2.37)           | 0 of 50 (p = 0.02)            |

p is (1 + shuffles at or above) / (1 + shuffles); with 50 shuffles 0.02 is the
smallest it can be.

So the within-person designs separate from the shuffle where the
between-person one did not: a shuffled onset gives a crude ratio of about 2.4
(older time after a random day) that falls to about 1.4 with age adjustment,
while the real onset keeps a ratio near 3. The planted AF points show up as a
step at onset that stays, which is what the calculator does: the AF points
apply for as long as AF is recorded.

The shuffled age-adjusted ratio is about 1.4, not 1. Some age effect is left
inside 5-year bands, and calendar time is not adjusted. Read the observed
ratios against the shuffled ones, not against 1.

**On 30 batches** (the #250 set) the same designs gave age-adjusted 4.06
(1.89 to 8.73) and case series 4.67 (1.68 to 12.96) from only 8 strokes before
onset; shuffled 1.40 (0.69 to 2.50) and 1.54 (0.26 to 5.00). The direction was
already there (p = 0.04 and 0.06), the size was not: 100 batches pull it down
to about 3 and narrow the intervals by about half.

### Between-person comparisons on 100 batches

The #250 matched design, rerun on all 100 batches (age- and sex-matched, 4
controls, 50 shuffles). Intervals that changed:

| Relation                      | 30 batches          | 100 batches         |
| ----------------------------- | ------------------- | ------------------- |
| AF then stroke                | 2.54 (1.95 to 3.31) | 2.70 (2.32 to 3.15) |
| AF from age 55 then stroke    | 2.94 (2.22 to 3.88) | 2.58 (2.20 to 3.02) |
| Diabetes then stroke          | 1.42 (1.23 to 1.64) | 1.43 (1.32 to 1.55) |
| Hypertension then stroke      | 1.12 (1.02 to 1.23) | 1.20 (1.14 to 1.27) |
| Hypertension then AF          | 1.38 (1.26 to 1.50) | 1.40 (1.33 to 1.47) |
| Myocardial infarction, stroke | 1.13 (0.95 to 1.34) | 1.10 (1.00 to 1.21) |
| Heart failure then stroke     | 0.66 (0.34 to 1.27) | 0.76 (0.55 to 1.07) |
| Stroke then AF                | 0.67 (0.34 to 1.33) | 0.84 (0.57 to 1.25) |
| AF then Alzheimer's           | 1.01 (0.83 to 1.23) | 0.97 (0.88 to 1.08) |
| Sleep apnea then AF           | 1.13 (0.94 to 1.35) | 1.03 (0.93 to 1.15) |

Every verdict stays the same. Myocardial infarction then stroke now touches 1
(no planted rule; MI and stroke share age and BP). The AF then stroke shuffle
gives 2.32 (2.12 to 2.56) against 2.70 observed: with 100 batches the observed
ratio sits just above the shuffled range, but the gap is small next to the
within-person one.

## Part 2: do the planted wearable changes come back?

### Methods

Wearable generator v3 (`scripts/synthetic-wearables`, #245) changes the series
from a condition's onset (`docs/training-data.md`, "Condition effects"). Its
CLI has one window for all subjects (`--end`, `--days`, at most 730 days), so
the study calls the generator's own `generateSeries` per subject with a
180-day window: 90 days before the onset and 90 from it, with the batch seed.

Subjects from batches 001 to 003: alive at the end, onset from 2016-04-01 to
2025-10-02, and no other condition with an effect starting or ending within 90
days of the onset (a stroke uses its latest onset, as the generator does).
Hypertension is the control: hypertension onset in the same range and none of
the four conditions at any time, at most 400 per batch.

For each subject and metric, the **planted** change is the generator's own
effect (`conditionEffects`) averaged over every day of each window; the
**recovered** change is from the worn days of the noisy series, as a
difference of window means (`summariseWindow`) or their ratio, plus the
robust z of after against before (`robustZ`), both from
`packages/query-tools/stats.ts`. Subjects need 10 worn days on each side.
The table gives the median over subjects and, for recovered, the mean with a
95% interval.

### Results

| Group (subjects)            | Metric, window                 | Planted | Recovered median (IQR)  | Recovered mean (95% CI) | Robust z beyond 2 |
| --------------------------- | ------------------------------ | ------- | ----------------------- | ----------------------- | ----------------- |
| AF (113)                    | Heart rate, difference         | +2.72   | +2.64 (1.17 to 4.08)    | +2.71 (2.37 to 3.05)    | 0 of 113          |
|                             | RMSSD, ratio                   | 1.196   | 1.193 (1.144 to 1.241)  | 1.199 (1.185 to 1.212)  | 1 of 113          |
|                             | Notifications per day          | +0.189  | +0.195 (0.148 to 0.244) | +0.202 (0.188 to 0.216) | no z (MAD 0)      |
|                             | AF burden (ground truth)       | +0.098  | +0.100                  | +0.101 (0.095 to 0.107) | no z (MAD 0)      |
| Heart failure (91)          | Resting heart rate, difference | +6.61   | +7.24 (5.86 to 8.63)    | +7.05 (6.57 to 7.54)    | 83 of 91          |
|                             | RMSSD, ratio                   | 0.750   | 0.756 (0.718 to 0.779)  | 0.763 (0.749 to 0.778)  | 42 of 91          |
|                             | Steps, ratio                   | 0.652   | 0.664 (0.622 to 0.700)  | 0.677 (0.658 to 0.696)  | 13 of 91          |
| Stroke (85)                 | Steps, ratio, days 0 to 29     | 0.543   | 0.548 (0.500 to 0.580)  | 0.542 (0.531 to 0.553)  | 29 of 85          |
|                             | Steps, ratio, days 60 to 89    | 0.765   | 0.755 (0.725 to 0.795)  | 0.758 (0.743 to 0.772)  | 0 of 85           |
|                             | Sleep score, days 0 to 29      | -9.50   | -9.31 (-10.52 to -8.20) | -9.29 (-9.65 to -8.92)  | 1 of 85           |
|                             | Sleep score, days 60 to 89     | -5.61   | -6.17 (-7.13 to -4.57)  | -5.81 (-6.20 to -5.42)  | 0 of 85           |
| Sleep apnea (372)           | SpO2 mean, difference          | -2.76   | -2.75 (-2.85 to -2.67)  | -2.76 (-2.77 to -2.74)  | 360 of 372        |
|                             | SpO2 minimum, difference       | -7.49   | -7.47 (-7.73 to -7.27)  | -7.50 (-7.54 to -7.46)  | 371 of 371        |
|                             | Respiratory rate, difference   | +0.72   | +0.76 (0.62 to 0.90)    | +0.76 (0.74 to 0.78)    | 30 of 372         |
| Hypertension control (1182) | Heart rate, difference         | 0       | +0.16 (-0.88 to 1.06)   | +0.11 (0.03 to 0.19)    | 3 of 1182         |
|                             | Resting heart rate, difference | 0       | +0.11 (-0.76 to 1.06)   | +0.12 (0.06 to 0.19)    | 14 of 1182        |
|                             | RMSSD, ratio                   | 1       | 0.996 (0.980 to 1.011)  | 0.996 (0.994 to 0.997)  | 0 of 1182         |
|                             | Steps, ratio                   | 1       | 0.999 (0.973 to 1.027)  | 1.001 (0.998 to 1.003)  | 0 of 1182         |
|                             | Sleep score, difference        | 0       | -0.10 (-0.99 to 0.88)   | -0.09 (-0.18 to 0.00)   | 2 of 1182         |
|                             | Respiratory rate, difference   | 0       | +0.02 (-0.05 to 0.10)   | +0.02 (0.02 to 0.03)    | 0 of 1182         |
|                             | SpO2 mean and minimum          | 0       | 0.00                    | 0.00                    | 3 of 2360         |
|                             | Notifications, AF burden       | 0       | 0                       | 0                       | no z              |

Every planted change comes back on average, within a few per cent of its
size. The robust z per person tells a different story by metric: a fixed
shift that is large against day-to-day noise (heart failure resting heart
rate, sleep apnea SpO2) is visible in most single people, while AF, whose
effect falls on about one day in five, is invisible to a median-based z in
every one of 113 people even though the mean heart rate rises by 2.7 /min.
For AF the notification count and the burden carry the signal; a check on
medians alone would miss it.

The hypertension control has no planted change, and none of size comes back.
Heart rate, resting heart rate and breathing rate rise by about 0.1 on
average, with intervals that exclude 0. This is not a condition effect: the
generator puts its generic raised-heart-rate episode (30% of subjects, 4 to
6 days) in the last 30 days of every window, which here is always the after
window. A study that centres windows on an event should know that the series
end is not neutral.

## Limits

- Synthea rules, not medicine. The stroke rise at AF onset is the calculator's
  AF points; finding it shows the designs can see a planted step, not that AF
  causes stroke in people. Nothing here transfers to people.
- Few strokes before onset: 26 in 100 batches, because counted time starts in
  2016 and most AF onsets in the export are older. The before rate drives every
  ratio, and its interval is wide (0.08 to 0.17 per 100 person-years).
- The case series assumes that a stroke does not change later AF onset or
  follow-up. In Synthea 17.5% die within 30 days of a stroke, and a person who
  dies cannot get AF later, so that assumption is broken; the shuffle keeps the
  same people and shows the size of what such biases leave (about 1.3 to 1.4).
- Age is adjusted in 5-year bands only; calendar time is not adjusted.
- Wearable effect sizes are the generator's assumptions, not fitted to any
  device or person, and recovering them shows the statistics work on the
  generator, not that a real device would show the same. Three batches; a
  stroke's effect is checked only on steps and sleep score.

## What is left

- New batches with `exporter.years_of_history = 0` would give the whole record,
  many more strokes before AF onset, and tighter before rates.
- The generic heart-rate episode in the last 30 days of each wearable window
  could be placed by a seeded day instead, so windows near an event stay
  neutral.
