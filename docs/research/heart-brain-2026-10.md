# Heart and brain relations in the synthetic cohort (October 2026)

Issue #250. Research use only, synthetic data only.

Synthea encodes rules, not medicine (Chen et al. 2019, BMC Medical Informatics
and Decision Making 19:44). The question here is narrow: when an analysis
pipeline reads the exported FHIR records, does it find again the relations the
generator planted, and does it stay quiet where nothing was planted? None of
the numbers below say anything about people. CHA2DS2-VASc (Lip et al. 2010,
Chest 137:263) is used only to describe groups of synthetic people.

## How to run it

```sh
bun run heart-brain                                  # batch 001, about 2 minutes
bun run heart-brain -- --batches 001-030 --jobs 6    # this report, about 20 minutes
```

| Flag              | Default                    | Meaning                                                            |
| ----------------- | -------------------------- | ------------------------------------------------------------------ |
| `--batches`       | `001`                      | Batch ids `001` to `100`, as `001-005` or `001,004`                |
| `--archives`      | `../synthea-1m-v2/batches` | Where `batch-NNN.tar.zst` and `batch-NNN.manifest.json` are        |
| `--out`           | `research-out/heart-brain` | Output folder (gitignored)                                         |
| `--jobs`          | 2                          | Batches read in parallel, one child process each                   |
| `--seed`          | 250                        | Seed for matching and shuffles; same batches and seed, same output |
| `--controls`      | 4                          | Matched controls per exposed person                                |
| `--permutations`  | 50                         | Shuffles in the negative control                                   |
| `--history-years` | 10                         | Synthea's `exporter.years_of_history` (see below); 0 for none      |
| `--fresh`         | off                        | Read the archives again even when a batch was already read         |

The archives are only read. Each one is streamed through `zstd -dc` and read
bundle by bundle (`scripts/heart-brain/tar-entries.ts`), never unpacked, so a
batch needs about 300 MB of memory, not 41 GB of disk. One line of dated facts
per person goes to `<out>/people/batch-NNN.jsonl` and is reused on the next
run; the analysis of 30 batches then takes about 15 seconds. The run writes
`<out>/summary.json` and `<out>/report.md`. Bundles are read with the
warehouse's own condition and medication readers
(`packages/warehouse/map-clinical.ts`), and the median comes from
`packages/query-tools/stats.ts`.

## Data

Batches 001 to 030 of the 1M cohort: Synthea v4.0.0 (jar sha256
`ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1`), Massachusetts, seeds 1001 to 1030, clinician seeds 2001 to
2030, end date 2026-01-01. 345,285 bundles (300,000 living, 45,285 deceased),
none skipped. Analysis seed 250, 4 controls, 50 shuffles. The full numbers,
code lists and per-batch run times are in
[`heart-brain-2026-10.summary.json`](heart-brain-2026-10.summary.json).

| Topic                                    | People | Codes (SNOMED CT, RxNorm)                 |
| ---------------------------------------- | ------ | ----------------------------------------- |
| Atrial fibrillation (AF)                 | 2,930  | 49436004                                  |
| Stroke                                   | 1,931  | 230690007                                 |
| Heart failure                            | 9,381  | 88805009, 84114007                        |
| Hypertension                             | 79,419 | 59621000                                  |
| Diabetes                                 | 26,186 | 44054006                                  |
| Myocardial infarction (vascular disease) | 15,182 | 22298006, 401303003, 401314000, 399211009 |
| Ischaemic heart disease                  | 57,223 | 414545008                                 |
| Alzheimer's                              | 10,153 | 26929004, 230265002                       |
| Sleep apnea                              | 15,786 | 78275009, 73430006                        |
| Venous thromboembolism                   | 3,694  | 132281000119108, 706870000                |
| Oral anticoagulant order (warfarin)      | 3,912  | RxNorm 855332                             |

The code lists come from the data. A scan for any cerebrovascular display
(stroke, transient ischaemic attack, cerebral infarct, intracerebral or
subarachnoid bleeding) finds only 230690007; there is no TIA and no
peripheral artery disease code. A scan for oral anticoagulant names finds
only warfarin 855332 (in two spellings); Synthea v4.0.0 writes no apixaban,
rivaroxaban, dabigatran or edoxaban. Heparin and enoxaparin appear only as
short courses in the surgery, acute coronary syndrome and COVID-19 modules, and are not
counted. Counts are people with the code, so they are lower than counts of
every mention (batch 001: 87 people with AF, 52 with a stroke condition).

## What Synthea plants

Read from the module files and the Framingham calculator in the pinned jar
(`org.mitre.synthea.modules.calculators.Framingham`, called every month by
`CardiovascularDiseaseModule`):

- **AF** (`atrial_fibrillation.json`) starts month by month with Framingham's
  10-year AF probability from age 45: age, sex, BMI 30 or more, systolic BP
  160 or more, and whether BP is controlled by medication. Nothing else. At
  the next wellness visit after onset everyone with AF gets warfarin (from
  1954), plus verapamil from 1981 and digoxin.
- **Stroke** (`stroke.json`) starts with Framingham's 10-year stroke
  probability. Under 55 it depends on age and sex only. From 55 it adds points
  for systolic BP (with or without BP medication), smoking, left ventricular
  hypertrophy, diabetes, coronary heart disease and AF. The module runs once,
  and 17.5% die within 30 days.
- `coronary_heart_disease` and `left_ventricular_hypertrophy` are read by the
  stroke calculator but never set by any module or class in v4.0.0, so they
  never add points. Myocardial infarction therefore has no planted effect on
  stroke.
- Hypertension raises the systolic BP both calculators read
  (`BloodPressureValueGenerator` reads the `hypertension` attribute): an
  indirect link to AF and to stroke.
- No calculator reads a medication: warfarin cannot lower stroke in Synthea.
- **Alzheimer's** (`dementia.json`): 40% carry the gene; onset at 64 to 80,
  5 to 10 years later with high socioeconomic status. No AF, stroke or BP.
- **Sleep apnea** (`sleep_apnea.json`): a fixed share by sex (13% of men, 6%
  of women) enters the sleep disorder path. Heart failure and coronary disease
  change only the device. No link to AF either way.
- The synthetic wearable generator (`scripts/synthetic-wearables`) reads no
  condition, so no wearable change around AF onset or hypertension was
  planted.

## The 10-year export window

Synthea's FHIR export keeps only the last `exporter.years_of_history` years
(10 by default; the 1M recipe keeps the default). A condition that ended
before 2016-01-01, such as a stroke, and older medication orders are left
out, while conditions still active (AF, hypertension, diabetes) keep their
first onset. In batches 001 to 005, 257 of 317 strokes start after 2010, and
the first warfarin order jumps in 2015. So person-time and outcomes are
counted only from 2016-01-01 (or the later start) to death or the end date.
Without that window, follow-up before 2016 would look stroke-free.

## Results

### CHA2DS2-VASc at AF onset

| Score  | 0   | 1   | 2   | 3   | 4   | 5   | 6   | 7   |
| ------ | --- | --- | --- | --- | --- | --- | --- | --- |
| People | 347 | 643 | 660 | 673 | 426 | 144 | 32  | 5   |

### Stroke after AF onset

People with AF and no stroke on or before onset, inside the window. Rate per
100 person-years with an exact Poisson 95% interval.

| CHA2DS2-VASc | People | Strokes | Person-years | Rate per 100 py     |
| ------------ | ------ | ------- | ------------ | ------------------- |
| 0-1          | 990    | 17      | 5,787        | 0.29 (0.17 to 0.47) |
| 2-3          | 1,332  | 42      | 7,010        | 0.60 (0.43 to 0.81) |
| 4-5          | 565    | 29      | 2,833        | 1.02 (0.69 to 1.47) |
| 6-9          | 32     | 2       | 118          | 1.70 (0.21 to 6.13) |

The rate rises with the score, as expected from a generator whose stroke
probability rises with age, BP and diabetes. Heart failure and the vascular
point add nothing in Synthea, so the gradient comes from the other items.

**Anticoagulation.** 2,886 of 2,930 people with AF have a warfarin order on or
after onset, with a median of 0 days between them: the order is written at the
same visit. Inside the window there is no person-time before the first order
(90 strokes in 15,748 person-years, all after it), so no comparison is
possible. This matches the module and says nothing about warfarin.

**Time from AF onset to stroke** (90 strokes): median 3,134 days (8.6 years),
quartiles 1,325 to 4,777 days. Under 1 year 6, 1 to 5 years 23, 5 to 10
years 22, 10 years or more 39.

**Order.** 125 people have both: stroke first 11, same day 0, AF first 114.
Where both onsets fall in the window (37 people): stroke first 8, AF first 29.
The export window hides most strokes before 2016, so the first count leans
towards AF first; the second is the fairer one.

### Planted rule against recovered

Each exposure against age- and sex-matched people (same sex, born within a
year) who did not have it on the same day, followed inside the window. Rate
ratio with a 95% log-scale interval. "Recovered" means the interval lies
above 1.

| Relation                       | Planted  | Rate ratio          | Found               | Verdict                 |
| ------------------------------ | -------- | ------------------- | ------------------- | ----------------------- |
| AF then stroke                 | direct   | 2.54 (1.95 to 3.31) | raised              | recovered               |
| AF from age 55 then stroke     | direct   | 2.94 (2.22 to 3.88) | raised              | recovered               |
| Diabetes then stroke           | direct   | 1.42 (1.23 to 1.64) | raised              | recovered               |
| Hypertension then stroke       | indirect | 1.12 (1.02 to 1.23) | raised              | recovered (weakly)      |
| Hypertension then AF           | indirect | 1.38 (1.26 to 1.50) | raised              | recovered               |
| Myocardial infarction, stroke  | none     | 1.13 (0.95 to 1.34) | no clear difference | consistent with no rule |
| Heart failure then stroke      | none     | 0.66 (0.34 to 1.27) | no clear difference | consistent with no rule |
| Stroke then AF                 | none     | 0.67 (0.34 to 1.33) | no clear difference | consistent with no rule |
| AF then Alzheimer's            | none     | 1.01 (0.83 to 1.23) | no clear difference | consistent with no rule |
| Sleep apnea then AF            | none     | 1.13 (0.94 to 1.35) | no clear difference | consistent with no rule |
| Warfarin after AF, then stroke | none     | n/a                 | no time before it   | undecided               |

AF then Alzheimer's is the exploratory dementia comparison: 2,717 people with
AF against 10,868 matched people without, 0.87 against 0.86 per 100
person-years.

On batches 001 to 005 alone (57,543 bundles) the same pipeline found AF then
stroke (5.84, 2.79 to 12.24) and hypertension then AF (1.59, 1.27 to 1.98),
but not yet diabetes then stroke (1.32, 0.92 to 1.89) or hypertension then
stroke (1.00, 0.79 to 1.28). Small planted effects need many batches.

### Negative controls

**Shuffled AF onsets.** Each AF onset moved to a random day in the same
person's follow-up from age 45, 50 times; everything else unchanged.

| Measure                                 | Observed | Shuffled mean (2.5% to 97.5%) |
| --------------------------------------- | -------- | ----------------------------- |
| Share of AF-and-stroke people, AF first | 0.91     | 0.91 (0.86 to 0.96)           |
| AF then stroke, matched rate ratio      | 2.54     | 2.39 (2.04 to 2.78)           |

The shuffle barely moves either number. The matched excess is mostly about
who gets AF in Synthea (people whose BP, BMI and age push both calculators),
and a shuffled onset still leaves each person's real AF years inside their
follow-up. So this design recovers "people with AF have more strokes", but
cannot show from the onset date alone that AF itself adds stroke points. The
share with AF first is set by when strokes and AF happen in life, not by
their link.

**No planted link.** Myocardial infarction, heart failure, stroke then AF,
AF then Alzheimer's and sleep apnea then AF have no rule, and none shows a
difference. Sleep apnea and AF co-occur more than chance overall (329 people
with both; crude odds ratio 2.68) but not within sex and age band
(Mantel-Haenszel 1.13): both are more common in older men.

## Limits

- Synthetic people from a rule set, not a population. A recovered relation
  shows the pipeline works on these rules; it is no evidence about medicine,
  and nothing here transfers to people.
- Only the last 10 years of ended conditions are exported. Earlier strokes are
  missing, which undercounts prior stroke in the score and in the order table.
- Matching is on sex and birth year only. Anything else the calculators read
  (BP, BMI, smoking, diabetes) is left as it falls.
- Warfarin is given to almost everyone with AF on the day of onset, so its
  effect cannot be studied in these data, and Synthea gives it none.
- One code each for stroke and AF; no TIA, no peripheral artery disease and
  no direct oral anticoagulant exist in Synthea v4.0.0.
- 30 of 100 batches. Strokes after AF number 90; the higher score groups stay
  wide.

## What is left

#262 followed up the first two items: see
[`heart-brain-timing-2026-10.md`](heart-brain-timing-2026-10.md) for the
within-person design, wearable recovery with generator v3 and all 100 batches.

- Wearable changes around AF onset (#250's last item): nothing was planted,
  because the wearable generator reads no condition. A test would only
  measure noise until the generator links to conditions.
- A within-person design (stroke rate before and after AF onset, by age)
  that could separate the AF date from who gets AF.
- New batches with `exporter.years_of_history = 0` would keep the whole
  record and remove the window.
