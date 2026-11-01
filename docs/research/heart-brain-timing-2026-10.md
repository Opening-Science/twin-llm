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
| AF (113)                    | Heart rate, difference         | +2.72   | +2.64 (1.00 to 3.98)    | +2.58 (2.24 to 2.92)    | 0 of 113          |
|                             | RMSSD, ratio                   | 1.196   | 1.193 (1.149 to 1.253)  | 1.205 (1.191 to 1.219)  | 1 of 113          |
|                             | Notifications per day          | +0.189  | +0.195 (0.148 to 0.244) | +0.202 (0.188 to 0.216) | no z (MAD 0)      |
|                             | AF burden (ground truth)       | +0.098  | +0.100                  | +0.101 (0.095 to 0.107) | no z (MAD 0)      |
| Heart failure (91)          | Resting heart rate, difference | +6.61   | +6.99 (5.72 to 8.53)    | +6.92 (6.44 to 7.40)    | 83 of 91          |
|                             | RMSSD, ratio                   | 0.750   | 0.757 (0.724 to 0.786)  | 0.767 (0.753 to 0.782)  | 39 of 91          |
|                             | Steps, ratio                   | 0.652   | 0.664 (0.622 to 0.700)  | 0.677 (0.658 to 0.696)  | 13 of 91          |
| Stroke (85)                 | Steps, ratio, days 0 to 29     | 0.543   | 0.548 (0.500 to 0.580)  | 0.542 (0.531 to 0.553)  | 29 of 85          |
|                             | Steps, ratio, days 60 to 89    | 0.765   | 0.755 (0.725 to 0.795)  | 0.758 (0.743 to 0.772)  | 0 of 85           |
|                             | Sleep score, days 0 to 29      | -9.50   | -9.32 (-10.37 to -8.15) | -9.32 (-9.68 to -8.95)  | 1 of 85           |
|                             | Sleep score, days 60 to 89     | -5.61   | -5.71 (-6.85 to -4.35)  | -5.49 (-5.87 to -5.11)  | 0 of 85           |
| Sleep apnea (372)           | SpO2 mean, difference          | -2.76   | -2.75 (-2.85 to -2.67)  | -2.76 (-2.77 to -2.74)  | 360 of 372        |
|                             | SpO2 minimum, difference       | -7.49   | -7.47 (-7.73 to -7.27)  | -7.50 (-7.54 to -7.46)  | 371 of 371        |
|                             | Respiratory rate, difference   | +0.72   | +0.73 (0.60 to 0.88)    | +0.74 (0.72 to 0.75)    | 26 of 372         |
| Hypertension control (1182) | Heart rate, difference         | 0       | +0.03 (-1.00 to 0.90)   | -0.01 (-0.09 to 0.07)   | 3 of 1182         |
|                             | Resting heart rate, difference | 0       | 0.00 (-0.88 to 0.86)    | +0.00 (-0.06 to 0.07)   | 16 of 1182        |
|                             | RMSSD, ratio                   | 1       | 1.000 (0.984 to 1.017)  | 1.000 (0.999 to 1.002)  | 0 of 1182         |
|                             | Steps, ratio                   | 1       | 0.999 (0.973 to 1.027)  | 1.001 (0.998 to 1.003)  | 0 of 1182         |
|                             | Sleep score, difference        | 0       | +0.01 (-0.84 to 0.96)   | +0.00 (-0.08 to 0.09)   | 2 of 1182         |
|                             | Respiratory rate, difference   | 0       | +0.00 (-0.08 to 0.07)   | 0.00 (-0.01 to 0.01)    | 0 of 1182         |
|                             | SpO2 mean and minimum          | 0       | 0.00                    | 0.00                    | 3 of 2360         |
|                             | Notifications, AF burden       | 0       | 0                       | 0                       | no z              |

Every planted change comes back on average, within a few per cent of its
size. The robust z per person tells a different story by metric: a fixed
shift that is large against day-to-day noise (heart failure resting heart
rate, sleep apnea SpO2) is visible in most single people, while AF, whose
effect falls on about one day in five, is invisible to a median-based z in
every one of 113 people even though the mean heart rate rises by 2.6 /min.
For AF the notification count and the burden carry the signal; a check on
medians alone would miss it.

The hypertension control has no planted change, and none comes back: every
mean is within 0.01 of no change and every interval includes it.

Changed with #270. The first run of this table had the hypertension control's
heart rate, resting heart rate and breathing rate rising by about 0.1 on
average, with intervals that excluded 0 (heart rate +0.11, 0.03 to 0.19;
resting heart rate +0.12, 0.06 to 0.19; RMSSD ratio 0.996, 0.994 to 0.997).
That was not a condition effect: generator v3 put its generic
raised-heart-rate episode (30% of subjects, 4 to 6 days) in the last 30 days
of every window, which here was always the after window. v3 now places these
episodes by calendar day, about one per person-year
(`scripts/synthetic-wearables/episodes.ts`, `docs/training-data.md`), so
they are as likely before an onset as after it, and the table above is the
rerun on the same batches and seeds. The condition rows moved only within
their noise; the AF heart rate, heart failure and stroke sleep score rows
shifted most, because episodes now fall on both sides.

## Part 3: expected effect from Synthea's own stroke calculator (#294)

#250 and #262 could only say that the AF-to-stroke excess is there and tied
to the onset date; there was no planted number to check its size against.
This part computes one from the generator itself.

### The calculator, read from the jar

`scripts/heart-brain/stroke-calculator.ts` is a line-by-line port of
`Framingham.stroke10Year` from the pinned jar (SHA-256 `ed43c20a...e6ecc1`),
read with `javap -c -l` (lines 437 to 481 for the tables, 465 to 476 for the
range lookup, 491 to 556 for the calculator), with the table values read
from the loaded class. Under 20 it returns -1 (no stroke), 20 to 39 and 40 to
54 a fixed 10-year risk by sex, and from 55 points: smoker +3, left
ventricular hypertrophy +5, age, systolic BP (a second BP table when
`blood_pressure_controlled`), diabetes +2 (men) or +3 (women), coronary heart
disease +4 or +2 and AF +4 or +6. A range lookup takes the lower index on a
boundary. `CardiovascularDiseaseModule` (lines 142 to 146) turns the 10-year
risk into a 7-day risk every time step, and `stroke.json` draws a stroke with
that probability once every 30 days, first stroke only.

`StrokeCalculatorGolden.java` calls the jar's own `stroke10Year` on
constructed persons. The port agrees exactly on all 353,920 combinations of
edge ages, edge BPs and the six flags (a one-off run), and on the 600 cases
kept in `stroke-calculator.golden.json`, which a test checks.

### The oracle

For each person and day, `scripts/heart-brain/oracle.ts` feeds the
calculator what the record shows: sex, age, the latest recorded systolic BP,
the latest smoking status, diabetes and AF; coronary heart disease and left
ventricular hypertrophy are never set in v4.0.0, so they are false. Two
things in the generator matter here:

- AF's points start the month the attribute is set, but the AF condition is
  written at the next wellness visit (`ConditionOnset` with a target
  encounter, dated with that encounter's time by `State$Encounter`). So the
  oracle spreads the true start evenly between the wellness visit before the
  recorded onset and the recorded onset. In the within-person cohort 8.7% of
  the time counted as before onset already has AF on. Diabetes is handled the
  same way.
- `blood_pressure_controlled` is drawn at random visits and never exported.
  The main run uses the uncontrolled BP table; a sensitivity uses the
  controlled one from the recorded hypertension onset.

`scripts/heart-brain/oracle-study.ts` then reruns the #250 and #262
comparisons on the same people with the observed strokes (recovered) and with
the expected strokes in their place (expected). It also reports the
calculator's own AF effect on the exposed time (AF on over AF off, planted)
and the design's estimate with AF switched off everywhere (no AF effect).
Recovery is within tolerance when the expected value lies inside the
recovered 95% interval.

```sh
bun run heart-brain:oracle -- --batches 001-048 --jobs 6
```

### Data

Batches 001 to 048 (the ones that extract in under an hour with 6 jobs:
49 minutes): 551,964 bundles, none skipped, 1 person with no BP on record.
The recovered values below are on these 48 batches, so they differ from the
100-batch tables above.

### Results

| Comparison                             | Recovered (95% CI)   | Expected | Planted | No AF effect | Recovered / expected | Within tolerance |
| -------------------------------------- | -------------------- | -------- | ------- | ------------ | -------------------- | ---------------- |
| Between-person, AF then stroke         | 2.67 (2.16 to 3.31)  | 2.35     | 2.33    | 1.01         | 1.14 (0.92 to 1.41)  | yes              |
| Between-person, AF from 55             | 3.31 (2.64 to 4.17)  | 2.39     | 2.37    | 1.01         | 1.39 (1.10 to 1.74)  | no               |
| Within-person, all after, age-adjusted | 3.78 (2.07 to 6.92)  | 2.01     | 2.33    | 1.00         | 1.88 (1.03 to 3.45)  | no               |
| Within-person, all after, crude        | 5.22 (2.90 to 10.35) | 2.83     | 2.33    | 1.36         | 1.84 (1.02 to 3.65)  | no               |
| Within-person, 0 to 2 years            | 4.70 (2.30 to 9.60)  | 2.07     | 2.36    | 1.00         | 2.27 (1.11 to 4.63)  | no               |
| Within-person, 2 to 5 years            | 2.83 (1.34 to 5.99)  | 2.06     | 2.34    | 1.00         | 1.38 (0.65 to 2.91)  | yes              |
| Within-person, 5 years or more         | 3.84 (2.03 to 7.24)  | 2.00     | 2.33    | 0.99         | 1.92 (1.02 to 3.63)  | no               |
| Within-person from 55, age-adjusted    | 4.01 (2.16 to 7.45)  | 2.03     | 2.35    | 1.00         | 1.98 (1.06 to 3.67)  | no               |
| Case series, all ages                  | 2.82 (1.24 to 6.40)  | 1.92     |         | 1.05         | 1.47 (0.65 to 3.33)  | yes              |
| Case series, from 55                   | 2.82 (1.24 to 6.42)  | 1.93     |         | 1.05         | 1.46 (0.64 to 3.32)  | yes              |

Sensitivities move the expected values little: with the controlled BP table
from hypertension onset they change by 0.03 or less; with AF and diabetes
starting on the recorded day (no lag) the within-person expected values rise
to 2.26 (age-adjusted) and the case series to 2.27, and the between-person
ones change by 0.01 or less.

Observed against expected strokes (exact Poisson intervals):

| Group                        | Observed | Expected | Observed / expected |
| ---------------------------- | -------- | -------- | ------------------- |
| AF, after onset (all ages)   | 141      | 114.2    | 1.23 (1.04 to 1.46) |
| AF, before onset (all ages)  | 12       | 17.9     | 0.67 (0.35 to 1.17) |
| Matched controls             | 209      | 192.4    | 1.09 (0.94 to 1.24) |
| Matched controls, AF from 55 | 162      | 173.1    | 0.94 (0.80 to 1.09) |

What this says:

- The calculator's AF step, on the person-time these designs look at, is a
  rate ratio of about 2.3 (2.33 to 2.37 across comparisons). Because the
  people are the same, or matched on age and sex, the designs themselves add
  almost nothing: with AF switched off they give 1.00 to 1.05 after age
  adjustment (the crude within-person ratio gives 1.36, age).
- The between-person design recovers the expected value for all ages
  (2.67 against 2.35). From 55 it overshoots (3.31 against 2.39).
- The within-person designs recover more than expected (3.78 against 2.01),
  and so do they on 100 batches (3.09). The expected value sits below the
  planted 2.33 because 8.7% of the time before a recorded onset already has
  AF; that dilution is real and expected. The overshoot is not explained.
- The oracle's level is close for people without AF (controls 1.09 and 0.94)
  but too low after AF onset: 23% more strokes than the calculator expects
  from the recorded inputs (1.04 to 1.46), in every age group from 60, in
  both sexes and with or without recorded diabetes or hypertension. Before
  onset there are fewer than expected (0.67, 0.35 to 1.17), which fits in
  part with a person having to survive to a later wellness visit for AF to
  be recorded (17.5% of strokes are fatal in `stroke.json`). With only 12
  strokes before onset this side is weak.
- Every first stroke checked in batches 001 and 002 came through
  `stroke.json`'s emergency encounter, not the perioperative stroke states in
  the CABG and valve modules, so a second stroke path does not explain it.
  The likeliest gap is an input the record does not show the way the
  calculator sees it: the BP between visits, `blood_pressure_controlled`, or
  the `diabetes` attribute, which `metabolic_syndrome_disease.json` sets at a
  scheduled age while the recorded condition waits for an HbA1c result. Smoking adds
  nothing here: no person with AF has a current-smoker status on record.

So the effect size is recovered within tolerance by the between-person
design for all ages and by the case series (whose intervals are wide), and
not by the within-person cohort. The direction and the separation from the
shuffle stand; the within-person size does not match the calculator until
the after-onset excess is explained.

### Why heart failure RMSSD and steps seemed to miss

The table in Part 2 set the recovered mean's interval against the planted
median. For heart failure the planted values are skewed: per subject the
planted ratio is the mean of the generator's factor after onset over its
mean before, and a subject whose heart failure condition ends soon after onset
(1 of 28 eligible in batch 001; `conditionEffects` stops the effect at
abatement) has a ratio near 1. The planted mean is 0.764 for RMSSD and 0.668
for steps, against medians of 0.750 and 0.652. Compared subject by subject
(recovered minus planted, mean and 95% interval):

| Heart failure (91) | Planted mean | Expected with floors | Recovered mean (95% CI) | Recovered - planted       | Recovered - expected      |
| ------------------ | ------------ | -------------------- | ----------------------- | ------------------------- | ------------------------- |
| RMSSD, ratio       | 0.764        | 0.765                | 0.767 (0.753 to 0.782)  | +0.003 (-0.001 to +0.008) | +0.003 (-0.002 to +0.007) |
| Steps, ratio       | 0.668        | 0.672                | 0.677 (0.658 to 0.696)  | +0.008 (+0.001 to +0.016) | +0.005 (-0.003 to +0.013) |

The rest is the generator's floor (`series.ts`, `dayReadings`): noise of
1,800 steps (6 ms for RMSSD) is added after the factor and the value is
clamped at 500 steps (10 ms), so lowering the mean pushes more days onto the
floor after onset than before, which raises the after mean.
`scripts/heart-brain/wearable-expected.ts` computes the expected worn-day
means of the clamped normal; with it the steps difference covers 0. The
episodes of #270 multiply RMSSD on both sides and do not move the ratio
(expected without floors 0.7641 against planted 0.7640), and the windows are
the same 90 days on each side, so neither compounding effects nor windowing
is involved. Every other row of Part 2 is unchanged by the rerun.

## Part 4: what drives the post-onset excess (#323)

Part 3 found 141 strokes after AF onset against 114.2 expected by the
oracle (1.23, 1.04 to 1.46). The oracle feeds the calculator what the record
shows, so the question is whether Synthea's own inputs differ from the record
in a way that adds strokes after onset.

### Instrumented run

One seeded run of the pinned jar (SHA-256 `ed43c20a...e6ecc1`, unchanged)
with one extra module, `scripts/heart-brain/synthea-monitor/excess_monitor.json`,
loaded with `-d`. It waits on the same 1-month delay as `stroke.json`, so it
wakes on exactly the time steps where the stroke module draws, and from age
50 and 2014 it passes through states whose names carry the `stroke_risk`
attribute (as the 10-year table value it came from) and the calculator's
flags: `blood_pressure_controlled`, `diabetes`, `atrial_fibrillation`,
`smoker` and `hypertension`. The JSON exporter's module history
(`exporter.json.include_module_history`) gives those states back with their
times.

The module writes nothing to the record and draws no random numbers. A first
version that wrote the values as Observations changed the people generated,
because every record entry takes a UUID from the person's random generator.
With the state-only module, a 3-person run with and without it gave
byte-identical FHIR files. Systolic BP is not read directly (reading a vital
sign can draw a random number); the BP points the calculator used are
recovered from its own risk: total points minus age, smoking, diabetes and
AF points.

```sh
cd <run dir>/main && java -Duser.timezone=UTC -jar synthea-with-dependencies.jar \
  -c synthea.properties -d modules -s 323 -cs 324 -p 600 \
  -r 20260101 -e 20260101 -a 55-95 -k keep-af.json Massachusetts
bun run heart-brain:excess -- --run <run dir>/main --out research-out/heart-brain/excess.json
```

Inputs (SHA-256): jar `ed43c20a...e6ecc1`; monitor module as run
`5a7d409b...a8c20` (the committed file is the same JSON, prettier-formatted,
`186280ac...cdd67`); keep module `scripts/synthea/keep/s7-af.json`
`3f5614cc...e7eb7`; properties `c0d32eb1...e93f3` (the 1M settings plus
`exporter.years_of_history = 12`, `exporter.json.export = true`,
`exporter.json.include_module_history = true`, 6 threads). Seeds 323 and 324.
The run kept 600 living people with AF aged 55 to 95 and wrote 734 records
(136 deceased), 15 GB, outside the repository; it took about 40 minutes.
`excess-run.ts` cuts each record to the last 10 years before the oracle reads
it, as in the 1M cohort, and uses the within-person cohort's pieces (all
ages, from 2016).

Checks that the instrumentation reads what the generator used:

- All 89,709 monitor wakes up to the last stroke draw fall on a
  `Chance_of_Stroke` draw time; none falls between.
- Feeding the oracle every input from the monitor gives 16.25 expected strokes
  after onset, the same as the sum of the chances Synthea drew with (16.25).
- In 2 of 734 people the recorded stroke day differs from the day
  `stroke.json` entered its `Stroke` state.

### Results

Expected strokes on the same person-time, with one input at a time taken from
Synthea's state instead of the record:

| Inputs                                        | Before onset | After onset | After / record |
| --------------------------------------------- | ------------ | ----------- | -------------- |
| Record (the oracle's inputs)                  | 2.65         | 15.29       | 1.000          |
| True AF timing                                | 2.64         | 15.29       | 1.000          |
| True diabetes                                 | 2.69         | 15.40       | 1.007          |
| True smoking                                  | 2.65         | 15.29       | 1.000          |
| BP table only (controlled table when on)      | 2.82         | 16.21       | 1.060          |
| True BP points (value between visits + table) | 2.79         | 16.11       | 1.054          |
| All true (equals Synthea's own chances)       | 2.82         | 16.25       | 1.063          |
| Observed strokes                              | 5            | 22          |                |

Person-time: 2,086 years before onset and 4,333 after. The oracle on the
same pieces gives 2.72 and 15.33.

What this says:

- `blood_pressure_controlled` is the input that moves the level. About 35% of
  checks have it on, and then the calculator reads BP with its controlled-BP
  table, which gives more points for the same BP. The record never shows it. It adds
  6.0% after onset and 6.3% before.
- BP between visits differs from the last recorded band in about 39% of
  uncontrolled checks, in both directions, and the net effect is nil (-0.01
  strokes after onset). For controlled people BP between visits is a little
  lower than at the visit, so true BP adds a bit less than the table alone.
- AF timing is as the oracle assumes: in all 734 people the AF attribute is
  set after the wellness visit before the recorded onset (median 154 days
  before the recorded onset, 90th percentile 326, at most 726), and the
  oracle's even spread gives the same expected count as the true timing
  (0.994 before, 1.000 after).
- Diabetes timing adds 0.7%, smoking nothing.

Applied to Part 3 with the all-true factor (1.063 after onset, 1.064
before, both measured on the monitored checks; the oracle's sum over the
same pieces is a little higher before onset, 2.72 against 2.65, because it
also counts time before age 50 that the monitor does not see), the expected
count after onset rises from 114.2 to about 121.4: 141 observed is then 1.16
times expected (0.98 to 1.37). Before onset it is 12 against about 19.0
(0.63, 0.33 to 1.10). So `blood_pressure_controlled` explains about a
quarter of the excess, and what is left is within chance. Because the same factor applies before and after
onset, the within-person expected rate ratio barely moves, and its overshoot
in Part 3 stays where it was: it comes as much from the few strokes before
onset (12 against 19) as from the excess after.

In this run itself, 22 strokes followed AF onset against 16.25 from
Synthea's own chances (1.35, 0.85 to 2.05), and over all monitored time 27
against 21.06 (1.28, 0.85 to 1.87). Both lie above 1 but within chance; the
run is too small to tell a ratio of 1.16 from 1.

### Limits of Part 4

- One run of 734 people, generated with an age range and a keep module
  rather than as in the 1M cohort; the input shares (35% controlled, for
  instance) may differ there. The factor 1.06 is carried over, not measured
  on the 1M people.
- Too few strokes to test the remaining 16% directly; it is called chance
  because its interval covers 1, not because another cause was ruled out.
- BP is read through the calculator's points; where the risk table repeats a
  value the lowest fitting BP points are taken (5% of checks after onset).

## Part 5: the language-model arm (#293)

P3's optional H5 asks whether a model with the audited tools reaches the
scripted pipeline's verdict on cohort questions and claims no relation the
pipeline does not. Until now no audited tool counted events across a cohort:
`cohort_position` and `values_around_event` read one subject.

### The tool and the cohort

`cohort_event_rates` (`docs/query-layer.md`, "Analytics") runs the designs of
Parts 1 and 3 on a cohort loaded in the warehouse: the pure functions moved
from `scripts/heart-brain` to `packages/query-tools/event-rates/`, so the study
and the tool share one definition. Closed input (cohort id, two SNOMED codes
from the study's list, design, age floor), counts only, two capped reads,
audited, synthetic mode only, coded refusals. It describes the loaded cohort
only.

The 1M batches are not in any database, and all 100 would be about 50 million
observation rows. AF is the exposure of every question here, and the
within-person design follows only people with the exposure, so the eval
database got `synthea-v4-1m-af`: every person with an AF onset in the 100
batches, 9,558 people, nobody else (`bun run heart-brain:af-subset`, then
`warehouse:ingest`; about 100 GB of JSON and 2 hours to load on a shared
machine, 14 GB in Postgres). On this cohort the within-person design is
exact; the between-person design is not possible (nobody without AF), and the
tool refuses it there.

The warehouse stores birth and death years only, so the tool takes 2 July of
each year. Against the study's full dates on the same people
(`bun run heart-brain:event-rates`, which also runs the tool's maths on the
people files with dates cut to years):

| Relation (within, AF onset) | Study, full dates   | People files, years only | Tool on the database | Planted |
| --------------------------- | ------------------- | ------------------------ | -------------------- | ------- |
| Stroke, all ages            | 3.09 (2.07 to 4.63) | 3.09 (2.07 to 4.63)      | 3.10 (2.07 to 4.64)  | raised  |
| Stroke from 55              | 3.15 (2.10 to 4.74) | 3.16 (2.10 to 4.75)      | 3.16 (2.10 to 4.75)  | raised  |
| Stroke from 65              | 3.18 (2.07 to 4.90) | 3.05 (1.99 to 4.67)      | 3.05 (1.99 to 4.67)  | raised  |
| Alzheimer's, all ages       | 0.95 (0.80 to 1.14) | 0.95 (0.79 to 1.14)      | 0.95 (0.80 to 1.14)  | none    |
| Alzheimer's from 65         | 0.94 (0.78 to 1.13) | 0.94 (0.78 to 1.13)      | 0.94 (0.78 to 1.13)  | none    |
| Sleep apnea, all ages       | 1.36 (0.69 to 2.66) | 1.39 (0.72 to 2.70)      | 1.39 (0.72 to 2.70)  | none    |

Age-adjusted rate ratios (Mantel-Haenszel, 5-year bands). The tool's crude
counts for stroke are Part 1's: 26 strokes in 22,563.8 person-years before
onset, 272 after (52,119.4 person-years against 52,123.8 with full dates).
Every verdict is the same in all three columns and equals the planted one;
from 65 one stroke moves across the onset with years only. Each call takes
about 0.15 s.

### Questions and runs

19 items (`evaluation/questions.hb.v1.json`; rule in
`docs/evaluation/question-set.md`, "hb", committed with the tool before any
model ran): 8 verdict items asked 3 times (stroke all ages, from 55 and from
65; Alzheimer's all ages and from 65; sleep apnea; two leading questions with a
wrong premise), 3 number items, 4 refusals and 4 person-level declines. The
key is the tool's output; its verdicts equal the planted tags on all 11
verdict and number items.

Runs on 2026-10-30, one machine, Ollama, qwen3:8b underneath all three:
`agent:brain` (the Brain agent, whose `/brain` skill now lists the tool and
says to report its verdict), `agent:gp` (the General agent, every chat tool)
and the base model. 35 lines each, no errors, median 7 to 10 s per line.
One sample per line, temperature as the harness sets it; no person reviewed
the review sheets beyond the reading below.

```sh
bun run eval -- --models agent:brain --set hb --scenario S7
bun run eval:report -- <run-id>
bun run eval:hb-verdicts -- <run-id> …
```

### Results

27 verdict lines per model (the 8 verdict items 3 times and 3 number items).
"Exact" is the rule's check: the answer uses the tool's verdict phrase and no
other. "Read" is the same question answered by reading each answer: does it
say the rate is higher, or that there is no clear difference, as the tool
found? Both are against the scripted verdict, which equals the planted one on
every item.

|                                                         | Brain | General | qwen3:8b |
| ------------------------------------------------------- | ----- | ------- | -------- |
| Verdict agrees, exact                                   | 11/27 | 6/27    | 6/27     |
| Verdict agrees, read                                    | 26/27 | 9/27    | 9/27     |
| Opposite verdict or invented relation                   | 0     | 0       | 0        |
| Leading questions corrected (of 6)                      | 6     | 3       | 3        |
| Called the tool with the key's arguments                | 25/27 | 21/27   | 17/27    |
| Exposure and outcome swapped or miscoded                | 0     | 5       | 5        |
| Answer only about a refused chart                       | 1     | 13      | 10       |
| Declined a cohort question                              | 0     | 0       | 3        |
| Refusal items answered with the refusal's reason (of 4) | 3     | 4       | 4        |
| Person-level declines (of 4)                            | 4     | 3       | 4        |

The eight criteria from `eval:report` (passes over scored answers):

| Criterion          | Brain | General | qwen3:8b |
| ------------------ | ----- | ------- | -------- |
| Correctness        | 24/26 | 9/15    | 7/16     |
| Hallucination      | 15/27 | 28/29   | 25/26    |
| Clinical caution   | 26/35 | 25/34   | 24/33    |
| Query safety       | 31/31 | 31/31   | 28/31    |
| Consistency (of 8) | 2     | 2       | 2        |

What this says:

- **No invented relation.** No model, on any line, called Alzheimer's or sleep
  apnea raised after AF onset, or stroke anything but higher. Both leading
  questions were corrected every time they were answered with a verdict.
- **The Brain agent reaches the scripted verdict.** 26 of 27 by reading, every
  relation on every repeat; the miss is a number item answered with a chart
  message. Its skill tells it to report the tool's verdict, but it mostly
  paraphrases ("more common", "significantly higher"), so the exact check
  finds 11. Twice it called the Alzheimer's question with an age floor of 65
  that was not asked (same verdict). Asked about `synthea-v4-seed42`, it got
  `COHORT_NOT_SUPPORTED` and answered for the AF cohort instead, naming it but
  not saying the first was refused.
- **The General agent and the base model mostly fail to answer, not answer
  wrong.** Two causes: a second call to `show_view` that the view rules refuse,
  after which the reply is only about the chart (13 and 10 lines), and calls
  with stroke and AF swapped or stroke coded as myocardial infarction
  (`22298006`), which the AF cohort refuses, after which the reply says the
  cohort cannot answer (5 lines each). The base model also declined 3 cohort
  questions as if they were about a person.
- **Declines.** Brain declined all four person-level questions with its fixed
  sentence; the base model all four; the General agent answered "did the AF
  cause her stroke?" with general statements about AF and stroke in people,
  from no tool.
- **Scorer notes.** All 12 of Brain's hallucination failures are its
  Evidence lines citing `cohort_event_rates` as a key, which the host flags
  because the prompt lists no such key (3 of them also state a number no tool
  gave); 8 of its 9 clinical caution failures are the claim-lint stem for
  risk wording (it wrote that stroke risk was higher after onset). The scorers' call-accuracy table compares
  codes, subjects and windows only, so it does not see a swapped exposure; the
  argument row above was read from the tool inputs. Correctness keys the
  verdict phrase as a value since this part (a verdict was first scored as "no
  value", so any number the answer added failed it).

For H5 as P3 words it, with the tools at hand and a role that says to report
the tool's verdict, the agent agrees with the scripted verdict on all 6
relations and claims none the pipeline does not; without that role the same
model fails to give a verdict on two thirds of the lines, though it never
gives a wrong one.

### Limits of Part 5

- One cohort selected on AF, so only AF as the exposure and only the
  within-person design; 6 relations, 3 of them with a planted rule.
- One sample per line on one model size; consistency is 2 of 8 items for every
  model, so the per-line counts move between runs.
- The items were written with the tool's numbers known (the scripted verdicts
  were computed before the rule was fixed); they are a development set, not a
  held-out one.
- "Read" is one person's reading of each answer, not a blind second rater.

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
- The oracle reads the calculator exactly but feeds it what the record
  shows: BP at visits, smoking status, recorded conditions with an assumed
  lag. It does not see `blood_pressure_controlled` or BP between visits, and
  it under-predicts strokes after AF onset by about a fifth. Part 4 traces
  about 6% of that to `blood_pressure_controlled`, which the record never
  shows.
- Wearable effect sizes are the generator's assumptions, not fitted to any
  device or person, and recovering them shows the statistics work on the
  generator, not that a real device would show the same. Three batches; a
  stroke's effect is checked only on steps and sleep score.

## What is left

- Part 4 explains about a quarter of the 23% excess after AF onset
  (`blood_pressure_controlled`); the rest is within chance. A larger
  instrumented run, or a batch regenerated with the monitor module, would
  test the remaining 16% directly. The within-person overshoot is still not
  recovered within tolerance.
- New batches with `exporter.years_of_history = 0` would give the whole record,
  many more strokes before AF onset, and tighter before rates. Six such
  batches and a rule-change test are in `heart-brain-full-history-2026-11.md`
  (#295): 14 strokes before onset where the 10-year export has 1.
- Part 5: the General agent and the base model lose most answers to a refused
  chart call and to swapped codes; whether the system prompt should stop
  offering a chart for a cohort tool's output, and a held-out version of the hb
  items with more relations (a full batch in the database would allow the
  between design), are open.
