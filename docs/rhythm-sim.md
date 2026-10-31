# Heart rhythm simulator

`packages/rhythm-sim` makes beat-level heart rhythm recordings for synthetic people (#244). The synthetic wearable series are one value per day, so nothing in them can show rhythm; this package adds RR intervals (the time between beats) for in-silico research.

It is a statistical model of RR intervals, not a physiological heart model. It has no cells, no conduction system, no ECG waves and no haemodynamics. It does not know what a real person's rhythm looks like, and nothing it produces describes a person. The simulator knows the truth about every beat it makes, which is what makes it useful for testing methods: a method's output can be compared with the label the simulator wrote.

## What it makes

`simulateRecording(config)` (`simulate-recording.ts`) returns:

- `beatTimesMs`: beat times from the first beat (at 0), whole ms; the last beat is within the duration.
- `rrMs`: the intervals between them, whole ms.
- `labels`: for each interval, the simulator's label of the beat that ends it: `sinus`, `af`, `pac` or `pvc`. Simulator metadata, never shown as a finding.
- `meanHr`: 60000 / mean RR.
- `pulseWave`: a pulse-wave (PPG-like) proxy at 25 Hz, and the span of the motion artefact if there is one.
- `config` (with defaults filled) and `afEpisodes` (the AF spans used).

The config is a closed zod schema (`recording-config.ts`): an unknown or out-of-range parameter throws. `seed` (unsigned 32 bit), `durationSec` (30 to 600) and `rhythm` are required:

- `sinus`: sinus rhythm all through.
- `af`: atrial fibrillation all through (persistent AF within the recording).
- `paroxysmal_af`: sinus with AF episodes, by default one over the middle third; `afEpisodes` sets up to ten (start and end in seconds, inside the recording, not overlapping). Switches are instant.

`pacCount` and `pvcCount` place that many premature atrial and ventricular beats in sinus rhythm, never in AF, never in the first or last two intervals, at least three intervals apart. Asking for more than the recording has room for throws.

`recordingObservation(recording, { subjectReference, start, id? })` (`recording-observation.ts`) turns a recording into one FHIR R4 Observation:

| Part                          | Code                                        | Value                                                                                            |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Observation.code`, the value | `urn:twinllm:rhythm-sim#rr-tachogram`       | `valueSampledData`: RR interval in progress every 250 ms (4 Hz), origin 0 ms, 1 dimension        |
| `component[0]`                | LOINC `8867-4` Heart rate                   | `valueQuantity`: mean heart rate, `/min`, one decimal                                            |
| `component[1]`                | `urn:twinllm:rhythm-sim#pulse-wave-proxy`   | `valueSampledData`: the pulse-wave proxy, period 40 ms, factor 0.001, unit `1`                   |
| `component[2]`                | `urn:twinllm:rhythm-sim#ground-truth-label` | `valueSampledData`: the simulator's label in progress every 250 ms (0 sinus, 1 AF, 2 PAC, 3 PVC) |

SampledData needs a fixed sampling period and beats are not evenly spaced, so the tachogram in FHIR is the interval in progress at each 250 ms step (no interpolation); the beat-exact intervals are in `rrMs`. The ground-truth component's display says it is simulator metadata and not a finding. The Observation is tagged `HTEST` (test health data) and `urn:twinllm:generator#twinllm-rhythm-sim`, carries a note that it is simulated, and validates with `validateFhir` from `@open-twin/fhir-r4` (the only issue is the informational one for a subject reference outside a bundle). The simulator has no clock: the caller gives the start time.

## How each part is made

**Sinus rhythm.** Spectral synthesis in the manner of the RR process of ECGSYN (McSharry et al. 2003): the modulation's power spectrum is two Gaussians, a low-frequency peak (Mayer waves, `lfHz`) and a high-frequency peak at the respiratory rate (respiratory sinus arrhythmia, `respRateHz`), with LF/HF power `lfHfRatio`. It is realised as 250 sinusoids from 0.002 to 0.5 Hz with seeded random phases and amplitudes from the spectrum, scaled so the modulation's variance is `rrSdMs² − noiseSdMs²`. Each sinus interval is the mean RR plus the modulation at the beat's time plus Gaussian noise (`noiseSdMs`), rounded to whole ms. ECGSYN builds its tachogram by an inverse FFT and resamples it; reading the sum of sinusoids at each beat time is the same spectrum without the resampling.

**Atrial fibrillation.** Each interval is an independent draw from a log-normal with the AF mean interval (60000 / `afMeanHr`) and coefficient of variation `afCv`, redrawn when it falls outside 250 to 2000 ms. Independence is what makes the series "irregularly irregular": there is no memory from one interval to the next. Real AF RR series have structure this ignores (rate dependence of the spread, AV node refractoriness and concealed conduction; Tateno and Glass 2001 describe how RR and ΔRR histograms in AF change with the mean RR).

**Ectopic beats.** A PAC comes `pacPrematurity` early (0.25 = an interval 25 % shorter) and resets the sinus node, so the next interval is an ordinary sinus interval and the pause is less than compensatory. A PVC comes `pvcPrematurity` early and leaves the sinus node alone, so the next interval is lengthened by what the PVC took: coupling interval plus pause equal the two sinus intervals (a full compensatory pause). Both are the usual textbook description; the exact behaviour (no interpolated PVCs, no non-conducted PACs, no runs) is a simplification.

**Pulse-wave proxy.** One fixed shape per beat, a systolic Gaussian (peak 0.1 s after the pulse starts, width 0.05 s) and a diastolic one (0.32 s, width 0.08 s, 0.35 of the height), starting 0.2 s after the beat, scaled by the interval before it divided by the mean sinus interval (clamped to 0.4 to 1.3), so a premature beat gives a smaller pulse. Gaussian noise (`pulseNoise`) is added to every sample and, with `motionArtefact`, a 1.7 Hz sinusoid of height 0.6 over one seeded 5 s span. It is a shape for testing pulse-based methods, not a model of the circulation.

**Determinism.** Randomness is `mulberry32` seeded through `randomFor(seed, key)` (`infrastructure/seeded-random.ts`, shared with the synthetic wearable and genome generators). Sinus phases, sinus noise, AF draws, ectopic placement and the pulse wave each have their own key, so adding ectopic beats does not move the sinus intervals and a paroxysmal recording matches the sinus one before its first episode. Same config, same output; the tests pin intervals and a hash for three configs.

## Parameters

| Parameter                  | Default             | Bounds        | Source                                                                                                                                                         |
| -------------------------- | ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meanHr`                   | 65 /min             | 40 to 150     | Assumption: a resting adult rate.                                                                                                                              |
| `rrSdMs`                   | 40 ms               | 5 to 150      | Assumption, of the order of the short-term SDNN values summarised by Nunan et al. 2010.                                                                        |
| `lfHz`                     | 0.1 Hz              | 0.04 to 0.15  | McSharry et al. 2003 (LF peak at 0.1 Hz); bounds are the LF band of the Task Force 1996.                                                                       |
| `respRateHz` (HF peak)     | 0.25 Hz             | 0.15 to 0.4   | McSharry et al. 2003 (HF peak at 0.25 Hz); bounds are the HF band of the Task Force 1996.                                                                      |
| `peakWidthHz`              | 0.01 Hz             | 0.002 to 0.05 | McSharry et al. 2003 (standard deviation of both spectral peaks 0.01 Hz).                                                                                      |
| `lfHfRatio`                | 0.5                 | 0.1 to 5      | McSharry et al. 2003 (LF/HF ratio 0.5).                                                                                                                        |
| `noiseSdMs`                | 5 ms                | 0 to 30       | Assumption: beat-to-beat scatter not in either peak.                                                                                                           |
| `afMeanHr`                 | 100 /min            | 50 to 180     | Assumption: a ventricular rate in AF without rate control.                                                                                                     |
| `afCv`                     | 0.2                 | 0.05 to 0.4   | Assumption, in the 0.15 to 0.25 range we expect for AF; Tateno and Glass 2001 use the RR coefficient of variation to separate AF, values not copied from them. |
| AF interval floor, ceiling | 250 ms, 2000 ms     | fixed         | Assumption: the shortest interval the AV node conducts and a cap on long pauses.                                                                               |
| AF interval distribution   | log-normal          | fixed         | Assumption: positive, right-skewed, independent draws.                                                                                                         |
| `pacPrematurity`           | 0.25                | 0.1 to 0.4    | Assumption: 20 to 30 % shorter coupling.                                                                                                                       |
| `pvcPrematurity`           | 0.25                | 0.1 to 0.4    | Assumption.                                                                                                                                                    |
| PAC and PVC pauses         | reset, compensatory | fixed         | Textbook description (sinus reset after a PAC, full compensatory pause after a PVC).                                                                           |
| Sinus interval floor       | 300 ms              | fixed         | Assumption: a guard against extreme settings.                                                                                                                  |
| Pulse arrival delay        | 0.2 s               | fixed         | Assumption.                                                                                                                                                    |
| Pulse shape                | two Gaussians       | fixed         | Assumption.                                                                                                                                                    |
| `pulseNoise`               | 0.02                | 0 to 0.5      | Assumption.                                                                                                                                                    |
| Motion artefact            | 1.7 Hz, 0.6, 5 s    | fixed         | Assumption: arm movement at a walking cadence.                                                                                                                 |

## Benchmark

`bun run rhythm-bench -- --out .rhythm-bench/<run> [--seeds N] [--afdb <dir> | --ltafdb <dir>] [--real-noise]` (#249, `scripts/rhythm-bench/`) measures how the irregularity metrics of `rhythm_irregularity` separate rhythms, on simulator output with the simulator's labels and on an open annotated database (the MIT-BIH Atrial Fibrillation Database, or the Long-Term AF Database, #264), and how far simulated windows are from real ones. It imports the tool's metric functions (`irregularityWindow`, `beatWindows`); nothing is reimplemented. It describes recordings and methods, never a person.

- **Simulated grid.** Recording length 30, 60, 120 and 300 s; sinus rhythm with 0, 2 PAC and 1 PVC, or 6 PAC and 3 PVC per minute; paroxysmal AF with one episode of 10, 30 or 60 % of the recording at a seeded start; persistent AF; ventricular rate in AF 70, 100 or 130 /min; and beat-detection noise none, light (1 % missed beats, 1 % spurious beats, 4 ms jitter) or heavy (5 %, 5 %, 15 ms). The simulator makes clean beats, so the noise is added by `perturbBeats` (`perturb.ts`). Sinus rate and variability come from `subjectRhythmSettings` for a benchmark id per seed. `--seeds` recordings per cell (default 20).
- **Windows and labels.** Consecutive 128-interval windows; a window is AF when at least half its intervals are AF, and windows with both are counted as mixed and also left out in a "pure" row. A simulated recording with fewer than 128 intervals (30 s, and 60 s below about 128 /min) is one window of all its intervals with the turning-point band for that n; the tool itself refuses such recordings.
- **Database.** Read from the directory given (`--afdb`, never copied into the repository): headers (`wfdb-header.ts`), MIT-format rhythm (`.atr`) and beat (`.qrs`, or `.qrsc` where the database has corrected beats: 05091 and 07859) annotations (`mit-annotations.ts`, after annot(5)). RR intervals come from the beat annotations, so the two records without signal files (00735, 03665) are used too. Each interval takes the reference rhythm at its ending beat; intervals before the first rhythm annotation are left out, and an interval over 3 s splits the series. AF is `(AFIB`; `(AFL`, `(J` and `(N` are not AF.
- **Long-Term AF Database.** `--ltafdb <dir>` (#264) reads the 84 records of the Long-Term AF Database 1.0.0 with the same readers, windows and statistics (`databases.ts` holds what differs). Records are about 24 h at 128 Hz, so an RR interval is a whole number of 7.8125 ms samples. Its `.atr` files hold manually reviewed beat annotations labelled by type (normal, PVC, APC, unknown) as well as the rhythm, so beats come from `.atr`, and `.qrs` (unaudited detector output) only for a record whose `.atr` has no beats (none in 1.0.0); NOTE annotations (such as `MISSB`) are not beats. AF is `(AFIB`; every other rhythm (`(N`, `(SBR`, `(AB`, `(B`, `(T`, `(SVTA`, `(VT`, `(IVR`) is not AF. Records are read one after another and only beat samples and rhythm changes are kept; the signal files are never opened. One database per run.
- **Statistics.** Sensitivity and specificity of the flag, and AUROC of nRMSSD, turning-point ratio, Shannon entropy and sample entropy, with 95 % percentile bootstrap intervals that resample recordings (simulated) or records (database), seeded (`--bootstrap-seed`, default 249; `--resamples`, default 1000). By length, rhythm, AF rate, noise, and length by noise.
- **Simulated against real.** Wasserstein-1 distance and Kolmogorov-Smirnov statistic of each metric, the window mean RR, the RR intervals and their successive differences (raw and divided by the window mean), between simulated windows that are all AF or all not AF and database windows that are all `AFIB` or all `N`.
- **Noise on database beats.** With `--real-noise` (needs `--afdb` or `--ltafdb`, #296) the grid's noise levels are also applied to the annotated beats of every record with the same `perturbBeats`, seeded per record, level and segment (`real-noise.ts`), and the same windows, flag and record-level bootstrap give sensitivity and specificity per level, next to the simulated ones. Level none is the database result unchanged. The report counts the beats removed and inserted; the CSVs are `real-noise.csv` (one row per source and level) and `windows-real-noise.csv`.
- **Output.** `result.json` (seeds, options, git sha, run id, record list, SHA-256 of the database's `SHA256SUMS.txt`), `report.md`, and CSVs for figures (`windows-sim.csv`, `windows-real.csv`, `roc.csv`, `distributions.csv`). `.rhythm-bench/` is gitignored; write runs there (`--out .rhythm-bench/<run>`), since the Lab's Results section shows the newest `result.json` in it (`docs/lab.md`, "Results"). Same seeds, same output apart from the timestamp (`benchmark.test.ts`).

The summary of a full run is `docs/research/rhythm-bench-2026-10.md`.

## Beats to daily summaries

`bun run rhythm-bench:resolution -- --out .rhythm-bench/resolution-<run> [--subjects N] [--afdb <dir>] [--ltafdb <dir>]` (#290, `scripts/rhythm-bench/resolution/`) asks how much AF signal survives as beats are aggregated to what wearables export: 30 s and 5 min epochs, hours and the daily values of the v3 synthetic wearables. It reads the simulator and changes nothing in it. It describes methods on simulated days and database records, never a person.

- **Simulated days.** A day is 144 ten-minute recordings joined end to end (each one's first beat is the previous one's last), with each subject's rates from `subjectRhythmSettings`. The simulator has no time of day, so the day layer sets each recording's sinus rate and AF ventricular rate from a circadian swing of ±7 /min (lowest at 03:00), a day offset (SD 2 /min), a per-recording offset (SD 5 /min from 07:00 to 23:00, 1.5 /min at night) and, in 10 % of daytime recordings, an activity bout of +15 to +45 /min. Sinus recordings carry 0 to 3 PACs and 0 to 2 PVCs, as `rhythm_irregularity` plans them. All of these are assumptions (`day-sim.ts`). An AF day has one episode of a fixed burden (2, 10, 30 or 60 % of 24 h) at a seeded start.
- **Design.** Each subject (default 40) has 3 baseline sinus days, 4 sinus days and one AF day per burden. Beat-detection noise none and light (`perturbBeats`, as in the benchmark). No artefact correction is applied, which is pessimistic for the RMSSD-based scores under noise.
- **Ladder** (`aggregate.ts`, pure). An interval belongs to the epoch of its ending beat; epochs with fewer than 10 intervals have no summary; differences never cross a gap. One score per level, higher meaning more AF-like: beats, the share of 128-interval windows the tool's flag marks; 30 s, 5 min and hourly, the share of epochs with nRMSSD (epoch RMSSD over mean RR) above 0.1, and the RMS change in epoch mean heart rate (an HR-only export); daily, nRMSSD of all the day's beats, and the v3 values computed from the beats: daily heart rate (mean of 5 min epochs), resting heart rate (mean of the 5 min epochs from midnight to 06:00) and RMSSD (mean of those epochs' RMSSD).
- **Statistics.** AUROC of AF days of each burden against the evaluation sinus days, on each score as it is and as its change from the subject's baseline median, with 95 % percentile bootstrap intervals over subjects (seed 290, 1000 resamples). The same scores on hours: AF hours by their AF share against AF-free hours, on simulated days and on the MIT-BIH AF Database and the Long-Term AF Database (`--afdb`, `--ltafdb`, read in place, hours with at least half their span covered), bootstrapped over records. Neither database has AF-free days, so the daily level is simulated only.
- **Output.** `summary.json` and `report.md` in `--out` (no `result.json`, so the Lab's rhythm benchmark card is not affected). The summary of a full run is `docs/research/af-resolution-2026-10.md`.

## Sources

- McSharry PE, Clifford GD, Tarassenko L, Smith LA. A dynamical model for generating synthetic electrocardiogram signals. IEEE Transactions on Biomedical Engineering. 2003;50(3):289-294.
- Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology. Heart rate variability: standards of measurement, physiological interpretation and clinical use. Circulation. 1996;93(5):1043-1065.
- Nunan D, Sandercock GRH, Brodie DA. A quantitative systematic review of normal values for short-term heart rate variability in healthy adults. Pacing and Clinical Electrophysiology. 2010;33(11):1407-1417.
- Tateno K, Glass L. Automatic detection of atrial fibrillation using the coefficient of variation and density histograms of RR and ΔRR intervals. Medical and Biological Engineering and Computing. 2001;39(6):664-671.

## Limits

- A statistical model of RR intervals, not a physiological heart model. Rates, spreads and spectra are set by parameters, not produced by physiology; nothing changes with posture, activity, sleep or age.
- AF intervals are independent draws. No rate dependence, no AV node model, no atrial flutter or other irregular rhythms.
- Ectopy is single beats only: no couplets, runs, bigeminy, interpolated PVCs or non-conducted PACs.
- No ECG. The pulse-wave proxy is a fixed shape, not a photoplethysmogram model; its timing and amplitude rules are assumptions.
- Recordings are 30 to 600 s. Episodes over a day would need many recordings; nothing here models when episodes happen.
- Nothing is stored in the warehouse yet. `rhythm_irregularity` makes its recordings on the fly, paroxysmal AF on days the subject's Synthea record has atrial fibrillation and sinus rhythm otherwise (`docs/query-layer.md`, "Rhythm irregularity").
