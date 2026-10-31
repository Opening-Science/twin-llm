# AF signal from beats to daily summaries, October 2026

How much of the difference between an atrial fibrillation (AF) day and a sinus day survives as beats are aggregated to what wearables export: 30 s and 5 min epochs, hours, and the daily values of the v3 synthetic wearables (#290). Simulated days from `packages/rhythm-sim` with the simulator's labels, and AF hours against AF-free hours on two open annotated databases. Research use only: it describes methods on simulated days and database records, never a person, and nothing here is a statement about how a device or a metric would do for anyone's health.

## Run

- Command: `bun run rhythm-bench:resolution -- --out .rhythm-bench/resolution-2026-10 --afdb <afdb>/files --ltafdb <ltafdb>/files`, with the defaults: 40 simulated subjects, 1000 bootstrap resamples, bootstrap seed 290. 925 s on one core.
- Git `61c647f` (the study code; the working tree differed only in docs and the learning-consent test list), study version 1. The full report and `summary.json` are in the gitignored output directory; `af-resolution-2026-10.summary.json` next to this file is that `summary.json`. The same command and seeds rebuild it apart from the timestamp.
- Simulated: 440 days (40 subjects × 3 baseline, 4 sinus and 4 AF days at 2, 10, 30 and 60 % burden), each at beat-detection noise none and light (1 % missed beats, 1 % spurious beats, 4 ms jitter; no artefact correction). 7680 simulated hours from the evaluation days.
- Databases, read in place and never copied into the repository: MIT-BIH Atrial Fibrillation Database 1.0.0 (25 records, 249 hours with at least half their span covered; SHA-256 of `SHA256SUMS.txt` `8f3ab7b38bf0591235680a855d6a7f00fe8fdaf2e457fa4c00edad2c735e0d9a`) and Long-Term AF Database 1.0.0 (84 records, 1889 hours; `9ad85f6b46d896b7a5579c70fd05bef1e39b8e2b1aeb2b2bdfde465c4aec3ad1`), both PhysioNet, Open Data Commons Attribution License v1.0. Nothing was downloaded for this study.
- Methods: `docs/rhythm-sim.md`, "Beats to daily summaries". In short: a day is 144 ten-minute simulator recordings with an assumed circadian swing, activity bouts and ectopy; one score per level of the ladder; AUROC of AF days against sinus days of the same subjects, on each score as it is and as its change from the subject's own baseline median; 95 % percentile bootstrap intervals over subjects or records, not days or hours.

## Headline

AUROC [95 % CI], change from the subject's own baseline, AF days against sinus days. "All" pools the four burdens.

| Level: score                              | Noise | 2 %                          | 10 %                 | 30 %                 | 60 %                 | All                  |
| ----------------------------------------- | ----- | ---------------------------- | -------------------- | -------------------- | -------------------- | -------------------- |
| Beats: share of 128-beat windows flagged  | none  | 1.000 [1.000, 1.000]         | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
|                                           | light | 0.820 [0.738, 0.901]         | 0.938 [0.880, 0.987] | 1.000 [0.998, 1.000] | 1.000 [1.000, 1.000] | 0.939 [0.910, 0.964] |
| 30 s: share of epochs with nRMSSD > 0.1   | none  | 0.981 [0.959, 0.997]         | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.995 [0.989, 0.999] |
|                                           | light | 0.680 [0.592, 0.758]         | 0.992 [0.984, 0.998] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.918 [0.897, 0.939] |
| 30 s: HR change between epochs (HR only)  | none  | 0.664 [0.594, 0.741]         | 0.826 [0.772, 0.886] | 0.961 [0.936, 0.982] | 0.999 [0.996, 1.000] | 0.862 [0.832, 0.895] |
| 5 min: share of epochs with nRMSSD > 0.1  | none  | 1.000 [1.000, 1.000]         | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
|                                           | light | 0.545 [0.460, 0.627]         | 0.566 [0.478, 0.657] | 0.647 [0.553, 0.725] | 0.799 [0.733, 0.863] | 0.639 [0.581, 0.694] |
| Hourly: share of hours with nRMSSD > 0.1  | none  | 1.000 [1.000, 1.000]         | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
|                                           | light | 0.500 (every hour above 0.1) | 0.500                | 0.500                | 0.500                | 0.500                |
| Hourly: HR change between hours (HR only) | none  | 0.718 [0.630, 0.798]         | 0.927 [0.868, 0.975] | 0.907 [0.855, 0.953] | 0.965 [0.935, 0.988] | 0.879 [0.830, 0.923] |
| Daily: heart rate (v3 value)              | none  | 0.620 [0.540, 0.706]         | 0.806 [0.730, 0.880] | 0.938 [0.882, 0.981] | 0.985 [0.965, 1.000] | 0.837 [0.801, 0.874] |
| Daily: resting heart rate (v3 value)      | none  | 0.575 [0.485, 0.670]         | 0.671 [0.584, 0.764] | 0.654 [0.560, 0.749] | 0.764 [0.671, 0.854] | 0.666 [0.617, 0.719] |
| Daily: RMSSD, night (v3 value)            | none  | 0.509 [0.409, 0.601]         | 0.637 [0.524, 0.741] | 0.697 [0.598, 0.796] | 0.788 [0.680, 0.882] | 0.658 [0.599, 0.714] |
|                                           | light | 0.462 [0.379, 0.547]         | 0.552 [0.455, 0.658] | 0.611 [0.509, 0.703] | 0.654 [0.552, 0.752] | 0.570 [0.521, 0.623] |

- **The signal is lost at the daily export, not on the way to it.** Any level that still sees beat-to-beat irregularity (128-beat windows, 30 s, 5 min or hourly epochs with their RMSSD, or nRMSSD over the whole day) separates AF days from sinus days almost perfectly on clean beats, down to 2 % burden (about 30 minutes). The three daily values the v3 wearables report do not: night RMSSD is at chance for 2 % burden (0.51) and reaches 0.79 only at 60 %, resting heart rate 0.58 to 0.76, and daily heart rate needs 30 % burden to pass 0.9. The night values miss an episode that does not overlap midnight to 06:00, and daily heart rate moves only with the rate in AF.
- **Beat-detection noise moves the loss earlier.** With 1 % missed and 1 % spurious beats and no artefact correction, a long epoch's RMSSD is dominated by the artefacts: every simulated hour has nRMSSD above 0.1 (AUROC 0.5) and 5 min epochs fall to 0.55 to 0.80. The beat-level flag and 30 s epochs hold up from 10 % burden. Real devices reject artefacts, which would also remove some AF intervals; that trade-off is not modelled.
- **HR-only exports keep some signal,** through the faster and jumpier rate in AF (30 s: 0.86 over all burdens; hourly: 0.88). How much depends on the assumed activity model: the 5 min HR score is the weakest (0.66) because the activity offsets change every ten minutes, a step that dominates 5 min differences. These rows measure the day model as much as AF.
- **The own-baseline change helps the coarse levels.** Absolute daily heart rate gives 0.72 over all burdens against 0.84 as a change from the subject's baseline, because subjects differ more than AF moves the rate.

## Daily summaries on AF days against v3's assumptions

Median over 40 subjects of the change from the subject's baseline median, computed from the simulated beats, next to the effect the v3 generator assumes (`scripts/synthetic-wearables/conditions.ts`). Noise none.

| Day     | AF share of intervals (median) | Daily HR change, /min | v3 assumes | Resting HR change, /min | v3 assumes | Night RMSSD ratio | v3 assumes |
| ------- | ------------------------------ | --------------------- | ---------- | ----------------------- | ---------- | ----------------- | ---------- |
| sinus   | 0.000                          | -0.1                  | 0          | 0.0                     | 0          | 1.00              | 1          |
| AF 2 %  | 0.030                          | 1.5                   | +10 to +20 | 0.8                     | 0          | 1.00              | 1.04       |
| AF 10 % | 0.137                          | 5.0                   | +10 to +20 | 1.7                     | 0          | 1.02              | 1.20       |
| AF 30 % | 0.400                          | 10.8                  | +10 to +20 | 1.3                     | 0          | 1.05              | 1.60       |
| AF 60 % | 0.712                          | 20.9                  | +10 to +20 | 4.3                     | 0          | 1.36              | 2.20       |

AF beats come faster than sinus beats, so the share of intervals in AF is above the share of time. The v3 effects are assumptions written for a day with AF, not derived from beats. Against the beats they are too strong at low burden (heart rate +10 to +20 /min whatever the burden; measured +1.5 at 2 %) and the RMSSD inflation is much larger than a night average shows (×1.6 assumed at 30 %, ×1.05 measured, median), while the resting heart rate, which v3 leaves unchanged on AF days, rises a little. This is a reason to revisit the v3 AF effects (they would then follow the simulator's own assumptions about the rate in AF), not a measurement of any device.

Followed up in #365: wearable generator 3.1 takes its daily heart rate, resting heart rate and night RMSSD effects on AF days from the noise none rows of this table, read from the summary JSON and interpolated by burden (`scripts/synthetic-wearables/af-calibration.ts`, `docs/training-data.md`, "Daily AF effects"). The "v3 assumes" columns above are generator 3, as compared in this run.

## AF hour against AF-free hour

Hours are the largest unit both databases offer: neither has AF-free days. Positives are hours by their share of intervals in AF; negatives are hours with no AF interval (on the databases these include atrial flutter and other rhythms). Simulated hours come from the evaluation days; database hours are AUROC on the annotated beats, no noise added.

AUROC of the hourly nRMSSD of all beats, by AF share of the hour:

| Source                 | AF 0-5 %             | 5-30 %               | 30-70 %              | 70-100 %             | Any                  |
| ---------------------- | -------------------- | -------------------- | -------------------- | -------------------- | -------------------- |
| Simulated, noise none  | 0.674 [0.527, 0.821] | 0.966 [0.934, 0.990] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.996 [0.994, 0.998] |
| Simulated, noise light | 0.609 [0.462, 0.742] | 0.892 [0.830, 0.948] | 0.995 [0.985, 1.000] | 1.000 [1.000, 1.000] | 0.991 [0.988, 0.994] |
| MIT-BIH AF Database    | 0.604 [0.430, 0.749] | 0.718 [0.571, 0.866] | 0.877 [0.744, 0.967] | 0.936 [0.835, 0.997] | 0.841 [0.735, 0.928] |
| Long-Term AF Database  | 0.758 [0.689, 0.825] | 0.847 [0.776, 0.907] | 0.880 [0.814, 0.936] | 0.907 [0.835, 0.956] | 0.888 [0.830, 0.937] |

- The irregularity scores (flag share, epochs above 0.1, hourly nRMSSD) separate less on real hours than on clean simulated ones over all AF hours and in every bin from 5 % up (below 5 % there are only 10 simulated AF hours), and the gap does not close at the hourly level: hourly nRMSSD gives 0.84 and 0.89 on the databases against 0.99 to 1.00 simulated. The simulated not-AF hours are cleaner than real ones (sinus with at most a few single ectopic beats per ten minutes), which the rhythm benchmark found at window level too (`rhythm-bench-2026-10.md`).
- On the Long-Term AF Database the beat-level flag share stays the best score at every AF share (0.95 over all AF hours); 30 s epochs come next (0.92), then 5 min (0.90) and the hourly value (0.89). On the MIT-BIH AF Database, with 25 records, the intervals overlap widely.
- HR-only scores behave differently on real data: the 30 s HR change is the best score on the MIT-BIH AF Database (0.91) and the hourly mean rate is weak on both (0.73 and 0.69).

The full hour tables (every score, every bin, counts) are in the run's `report.md` and in the summary JSON.

## For the P2 paper

Draft text for the "how much rhythm survives aggregation" section (P2, in-silico arrhythmia).

> **Methods.** We built 24 h RR series from 144 ten-minute recordings of the TwinLLM rhythm simulator, with per-subject rates and variability, an assumed circadian swing, activity bouts and single ectopic beats, for 40 simulated subjects with three baseline days, four sinus days and one day each with a single AF episode of 2, 10, 30 or 60 % of the day. We aggregated each day to 30 s, 5 min and hourly epochs (mean heart rate and RMSSD) and to the three daily values a consumer wearable exports (mean heart rate, night resting heart rate, night RMSSD), and scored each level with one prespecified statistic. We report AUROC for AF days against sinus days of the same subjects, on the raw score and on its change from each subject's baseline median, with 95 % percentile bootstrap intervals over subjects, without and with beat-detection noise. On the MIT-BIH AF Database (25 records) and the Long-Term AF Database (84 records) we compared AF hours with AF-free hours, with bootstrap over records.
>
> **Results.** On clean simulated beats and as a change from each subject's baseline, every level that keeps beat-to-beat irregularity separated AF days from sinus days almost perfectly down to 2 % burden (AUROC 0.98 to 1.00). The daily exported values did not: night RMSSD was at chance at 2 % burden (0.51, 0.41 to 0.60) and reached 0.79 (0.68 to 0.88) at 60 %; daily mean heart rate reached 0.94 only at 30 % burden. With 1 % missed and 1 % spurious beats, RMSSD over 5 min and longer epochs lost most of its value (5 min, all burdens: 0.64). On real hours the irregularity scores separated less than on simulated hours (hourly nRMSSD 0.84 and 0.89 against 0.99), and on the Long-Term AF Database it fell steadily from beat level (0.95) to hourly (0.89).
>
> **Interpretation.** In this simulation the AF signal is not lost gradually with temporal resolution; it is lost when the export keeps only averages of rate and of night-time RMSSD. Daily wearable summaries as modelled here are a weak basis for telling AF days below about a third of a day from sinus days (no daily value above 0.81 at 10 % burden); the night values are near chance only at the lowest burden, so the plan's hypothesis H1 holds for the night values at 2 % but not as a general threshold. The study measures methods on simulated recordings and on records, not people.

## Limits

- The day layer (circadian swing, activity bouts, ectopy rates, night from midnight to 06:00) is assumed, not fitted to any device or population; the HR-only scores depend on it directly. The simulator itself has no sleep, posture or autonomic change with activity (`docs/rhythm-sim.md`, "Limits"), and AF intervals are independent draws.
- Full wear and beat detection all day, one episode per AF day, and daily values computed from every beat at night. Real devices sample heart rate intermittently, measure HRV only in selected windows, reject irregular or noisy windows and may report nothing on an AF night; each of these would lower the daily-level results further or make them missing.
- One prespecified score per level, no fitted combination. A logistic regression across a level's summaries (P5 plan) and AUPRC, sensitivity at fixed specificity and paired AUROC differences are not done.
- The databases have no AF-free days, so the daily level is simulated only, and their AF-free hours come from people who have AF.
- Not done from #290: a real check on open photoplethysmography with AF labels and the optional PaPaGei embedding baseline. The issue names no specific dataset; the candidate in the P5 assessment (MIMIC PERform AF, ODbL 1.0) is PPG and needs beat detection from the pulse wave and a new importer, and overlaps PaPaGei's pretraining data. Nothing was downloaded.
