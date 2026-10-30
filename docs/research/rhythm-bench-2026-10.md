# Rhythm benchmark, October 2026

How well the RR-interval irregularity metrics of `rhythm_irregularity` separate atrial fibrillation (AF) from other rhythms in 128-interval windows, on simulated recordings with the simulator's labels and on the open MIT-BIH Atrial Fibrillation Database, and how far the simulated windows are from the real ones (#249). Research use only: it describes recordings and methods, never a person, and nothing here is a statement about how the metrics would do for anyone's health.

## Run

- Command: `bun run rhythm-bench -- --out .rhythm-bench/2026-10 --afdb <afdb>/files`, with the defaults: 20 seeds per grid cell, 1000 bootstrap resamples, bootstrap seed 249.
- Run id `f5b7eb3cbd82c5a5`, git `af1fc04671a4113789487cc6382c99a21d048ed5`, benchmark version 1. The full report, `result.json` and the figure CSVs (`roc.csv`, `distributions.csv`, `windows-sim.csv`, `windows-real.csv`) are in the gitignored output directory; the same command and seeds rebuild them byte for byte apart from the timestamp.
- Database: MIT-BIH Atrial Fibrillation Database 1.0.0 from PhysioNet, 25 records, read in place and never copied into the repository. SHA-256 of its `SHA256SUMS.txt`: `8f3ab7b38bf0591235680a855d6a7f00fe8fdaf2e457fa4c00edad2c735e0d9a`. Licence: Open Data Commons Attribution License v1.0.
- Methods: `docs/rhythm-sim.md`, "Benchmark". In short: the tool's own metric functions; a window is AF when at least half its intervals are AF; 95 % intervals are percentile bootstraps over recordings (simulated) or records (database), not windows; the flag is nRMSSD above 0.1 and the turning-point ratio (TPR) in the 99.9 % band of independent values (Dash et al. 2009 without their entropy condition). AUROC is the chance that an AF window scores higher than a not-AF window. ShEn is the 16-bin Shannon entropy, SampEn sample entropy.

## Headline

|                            | Sensitivity [95 % CI]            | Specificity [95 % CI]            | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| -------------------------- | -------------------------------- | -------------------------------- | -------------------- | -------------------- | -------------------- | -------------------- |
| Simulated, whole grid      | 0.973 [0.966, 0.979] (2365/2431) | 0.536 [0.516, 0.558] (1454/2711) | 0.753 [0.738, 0.769] | 0.903 [0.895, 0.911] | 0.722 [0.707, 0.736] | 0.839 [0.826, 0.850] |
| Simulated, 300 s, no noise | 0.964 [0.944, 0.980] (401/416)   | 0.911 [0.875, 0.943] (348/382)   | 0.984 [0.976, 0.990] | 0.983 [0.974, 0.989] | 0.589 [0.544, 0.632] | 0.797 [0.752, 0.834] |
| Database, 25 records       | 0.954 [0.929, 0.973] (3890/4078) | 0.796 [0.700, 0.879] (4339/5452) | 0.897 [0.827, 0.956] | 0.879 [0.818, 0.927] | 0.828 [0.746, 0.894] | 0.803 [0.717, 0.872] |

- On clean simulated windows the flag does what its arithmetic says (300 s, no noise: sensitivity 0.96, specificity 0.91). Its specificity falls with ectopic beats, short recordings and beat-detection errors: heavy noise (5 % missed and 5 % spurious beats) takes it to 0.17 over the grid.
- On the database the flag finds 95 % of AF windows with 80 % specificity, both with wide intervals because 25 records are 25 clusters. The database was used to derive or test the Dash et al. 2009 thresholds, so this is not an independent test of them (see Limits).
- The same noise on the database's beats lowers specificity much more than on simulated beats: 0.29 at light and 0.01 at heavy, against 0.68 and 0.17 over the simulated grid (see "Beat-detection noise on database beats").
- nRMSSD separates best on the database (AUROC 0.90) and the TPR best on the simulator (0.90); Shannon entropy is the weakest on the simulator and sample entropy on the database (0.80).

## Simulated recordings

3600 recordings (180 grid cells, 20 seeds), 5142 windows, 2391 of them mixed (some AF and some other intervals).

| Subset   | Windows | Clusters | AF / not AF | Mixed | Sensitivity [95 % CI]            | Specificity [95 % CI]            | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| -------- | ------- | -------- | ----------- | ----- | -------------------------------- | -------------------------------- | -------------------- | -------------------- | -------------------- | -------------------- |
| sim      | 5142    | 3600     | 2431 / 2711 | 2391  | 0.973 [0.966, 0.979] (2365/2431) | 0.536 [0.516, 0.558] (1454/2711) | 0.753 [0.738, 0.769] | 0.903 [0.895, 0.911] | 0.722 [0.707, 0.736] | 0.839 [0.826, 0.850] |
| sim-pure | 2751    | 1896     | 1444 / 1307 | 0     | 1.000 [1.000, 1.000] (1444/1444) | 0.600 [0.570, 0.631] (784/1307)  | 0.797 [0.776, 0.816] | 0.950 [0.941, 0.958] | 0.670 [0.646, 0.691] | 0.953 [0.943, 0.962] |

By recording length (30 s and most 60 s recordings are one window shorter than 128 intervals; the tool itself refuses those):

| Subset        | Windows | Clusters | AF / not AF | Mixed | Sensitivity [95 % CI]            | Specificity [95 % CI]           | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| ------------- | ------- | -------- | ----------- | ----- | -------------------------------- | ------------------------------- | -------------------- | -------------------- | -------------------- | -------------------- |
| duration=30s  | 900     | 900      | 370 / 530   | 540   | 0.997 [0.991, 1.000] (369/370)   | 0.240 [0.205, 0.277] (127/530)  | 0.742 [0.710, 0.775] | 0.829 [0.803, 0.855] | 0.680 [0.642, 0.715] | 0.809 [0.777, 0.838] |
| duration=60s  | 900     | 900      | 364 / 536   | 540   | 0.981 [0.964, 0.994] (357/364)   | 0.448 [0.407, 0.491] (240/536)  | 0.738 [0.705, 0.770] | 0.883 [0.862, 0.903] | 0.727 [0.697, 0.758] | 0.810 [0.778, 0.838] |
| duration=120s | 952     | 900      | 454 / 498   | 527   | 0.936 [0.911, 0.958] (425/454)   | 0.622 [0.582, 0.665] (310/498)  | 0.741 [0.710, 0.771] | 0.889 [0.870, 0.908] | 0.759 [0.727, 0.789] | 0.823 [0.793, 0.850] |
| duration=300s | 2390    | 900      | 1243 / 1147 | 784   | 0.977 [0.967, 0.985] (1214/1243) | 0.677 [0.641, 0.710] (777/1147) | 0.765 [0.741, 0.790] | 0.941 [0.931, 0.950] | 0.679 [0.651, 0.704] | 0.864 [0.844, 0.882] |

By rhythm:

| Subset                  | Windows | Clusters | AF / not AF | Mixed | Sensitivity [95 % CI]            | Specificity [95 % CI]          | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| ----------------------- | ------- | -------- | ----------- | ----- | -------------------------------- | ------------------------------ | -------------------- | -------------------- | -------------------- | -------------------- |
| rhythm=sinus            | 310     | 240      | 0 / 310     | 0     | n/a                              | 0.723 [0.666, 0.777] (224/310) | n/a                  | n/a                  | n/a                  | n/a                  |
| rhythm=sinus+ectopy-2/1 | 311     | 240      | 0 / 311     | 0     | n/a                              | 0.563 [0.495, 0.624] (175/311) | n/a                  | n/a                  | n/a                  | n/a                  |
| rhythm=sinus+ectopy-6/3 | 312     | 240      | 0 / 312     | 0     | n/a                              | 0.292 [0.233, 0.350] (91/312)  | n/a                  | n/a                  | n/a                  | n/a                  |
| rhythm=paroxysmal-10%   | 953     | 720      | 30 / 923    | 729   | 0.767 [0.607, 0.909] (23/30)     | 0.616 [0.582, 0.650] (569/923) | 0.633 [0.574, 0.697] | 0.788 [0.721, 0.849] | 0.530 [0.474, 0.583] | 0.260 [0.188, 0.342] |
| rhythm=paroxysmal-30%   | 998     | 720      | 262 / 736   | 841   | 0.916 [0.877, 0.949] (240/262)   | 0.436 [0.398, 0.474] (321/736) | 0.692 [0.661, 0.724] | 0.850 [0.825, 0.876] | 0.702 [0.670, 0.734] | 0.708 [0.664, 0.743] |
| rhythm=paroxysmal-60%   | 1075    | 720      | 956 / 119   | 821   | 0.961 [0.949, 0.973] (919/956)   | 0.622 [0.534, 0.710] (74/119)  | 0.723 [0.666, 0.784] | 0.863 [0.825, 0.896] | 0.711 [0.651, 0.767] | 0.832 [0.794, 0.865] |
| rhythm=persistent       | 1183    | 720      | 1183 / 0    | 0     | 1.000 [1.000, 1.000] (1183/1183) | n/a                            | n/a                  | n/a                  | n/a                  | n/a                  |

By ventricular rate in AF (AF conditions only; their sinus parts are the not-AF windows):

| Subset     | Windows | Clusters | AF / not AF | Mixed | Sensitivity [95 % CI]            | Specificity [95 % CI]          | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| ---------- | ------- | -------- | ----------- | ----- | -------------------------------- | ------------------------------ | -------------------- | -------------------- | -------------------- | -------------------- |
| afRate=70  | 1220    | 960      | 618 / 602   | 778   | 0.972 [0.959, 0.985] (601/618)   | 0.565 [0.522, 0.612] (340/602) | 0.738 [0.706, 0.768] | 0.901 [0.882, 0.917] | 0.655 [0.623, 0.686] | 0.804 [0.778, 0.831] |
| afRate=100 | 1367    | 960      | 757 / 610   | 791   | 0.971 [0.958, 0.982] (735/757)   | 0.536 [0.491, 0.577] (327/610) | 0.763 [0.732, 0.792] | 0.909 [0.892, 0.925] | 0.790 [0.761, 0.817] | 0.881 [0.861, 0.902] |
| afRate=130 | 1622    | 960      | 1056 / 566  | 822   | 0.974 [0.964, 0.983] (1029/1056) | 0.525 [0.482, 0.571] (297/566) | 0.758 [0.728, 0.789] | 0.918 [0.901, 0.932] | 0.777 [0.749, 0.807] | 0.897 [0.878, 0.916] |

By beat-detection noise (light: 1 % missed, 1 % spurious beats, 4 ms jitter; heavy: 5 %, 5 %, 15 ms; assumptions, not measured device error rates):

| Subset      | Windows | Clusters | AF / not AF | Mixed | Sensitivity [95 % CI]          | Specificity [95 % CI]          | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| ----------- | ------- | -------- | ----------- | ----- | ------------------------------ | ------------------------------ | -------------------- | -------------------- | -------------------- | -------------------- |
| noise=none  | 1716    | 1200     | 810 / 906   | 797   | 0.958 [0.944, 0.971] (776/810) | 0.756 [0.726, 0.785] (685/906) | 0.973 [0.967, 0.979] | 0.963 [0.954, 0.971] | 0.663 [0.633, 0.691] | 0.767 [0.741, 0.794] |
| noise=light | 1718    | 1200     | 813 / 905   | 794   | 0.966 [0.952, 0.977] (785/813) | 0.683 [0.647, 0.715] (618/905) | 0.893 [0.876, 0.908] | 0.957 [0.948, 0.964] | 0.681 [0.654, 0.709] | 0.855 [0.834, 0.877] |
| noise=heavy | 1708    | 1200     | 808 / 900   | 800   | 0.995 [0.990, 0.999] (804/808) | 0.168 [0.143, 0.192] (151/900) | 0.762 [0.739, 0.782] | 0.795 [0.771, 0.818] | 0.855 [0.837, 0.872] | 0.919 [0.903, 0.934] |

Recordings of 300 s by noise:

| Subset                    | Windows | Clusters | AF / not AF | Mixed | Sensitivity [95 % CI]          | Specificity [95 % CI]          | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| ------------------------- | ------- | -------- | ----------- | ----- | ------------------------------ | ------------------------------ | -------------------- | -------------------- | -------------------- | -------------------- |
| duration×noise=300s×none  | 798     | 300      | 416 / 382   | 261   | 0.964 [0.944, 0.980] (401/416) | 0.911 [0.875, 0.943] (348/382) | 0.984 [0.976, 0.990] | 0.983 [0.974, 0.989] | 0.589 [0.544, 0.632] | 0.797 [0.752, 0.834] |
| duration×noise=300s×light | 799     | 300      | 417 / 382   | 258   | 0.966 [0.947, 0.982] (403/417) | 0.869 [0.826, 0.910] (332/382) | 0.929 [0.909, 0.947] | 0.979 [0.970, 0.987] | 0.610 [0.562, 0.653] | 0.885 [0.854, 0.914] |
| duration×noise=300s×heavy | 793     | 300      | 410 / 383   | 265   | 1.000 [1.000, 1.000] (410/410) | 0.253 [0.210, 0.298] (97/383)  | 0.806 [0.775, 0.833] | 0.862 [0.835, 0.889] | 0.899 [0.875, 0.921] | 0.946 [0.925, 0.963] |

Sample entropy is undefined (no template match) in 44 AF and 25 not-AF simulated windows, all from 30 s and 60 s recordings; they are left out of its AUROC.

## MIT-BIH Atrial Fibrillation Database

Beats from the `.qrs` annotations, or `.qrsc` (corrected) for 05091 and 07859, the only records that have them; reference rhythm from `.atr`. Records 00735 and 03665 have no signal file (`.dat`); their RR intervals come from the beat annotations like every other record's, so all 25 are used. Every beat annotation in these files is code 1 (normal), so the beat code list does not change anything here. 9530 windows, 425 of them mixed; intervals over 3 s (gaps) split the series.

| Subset      | Windows | Clusters | AF / not AF | Mixed | Sensitivity [95 % CI]            | Specificity [95 % CI]            | AUROC nRMSSD         | AUROC TPR            | AUROC ShEn           | AUROC SampEn         |
| ----------- | ------- | -------- | ----------- | ----- | -------------------------------- | -------------------------------- | -------------------- | -------------------- | -------------------- | -------------------- |
| real        | 9530    | 25       | 4078 / 5452 | 425   | 0.954 [0.929, 0.973] (3890/4078) | 0.796 [0.700, 0.879] (4339/5452) | 0.897 [0.827, 0.956] | 0.879 [0.818, 0.927] | 0.828 [0.746, 0.894] | 0.803 [0.717, 0.872] |
| real-pure   | 9105    | 25       | 3845 / 5260 | 0     | 0.962 [0.940, 0.980] (3697/3845) | 0.807 [0.710, 0.892] (4243/5260) | 0.903 [0.822, 0.961] | 0.885 [0.827, 0.937] | 0.833 [0.753, 0.904] | 0.822 [0.740, 0.889] |
| rhythm=N    | 5154    | 23       | 0 / 5154    | 186   | n/a                              | 0.815 [0.734, 0.887] (4199/5154) | n/a                  | n/a                  | n/a                  | n/a                  |
| rhythm=AFIB | 4078    | 25       | 4078 / 0    | 233   | 0.954 [0.930, 0.973] (3890/4078) | n/a                              | n/a                  | n/a                  | n/a                  | n/a                  |
| rhythm=J    | 208     | 2        | 0 / 208     | 3     | n/a                              | 0.313 [0.309, 1.000] (65/208)    | n/a                  | n/a                  | n/a                  | n/a                  |
| rhythm=AFL  | 90      | 6        | 0 / 90      | 3     | n/a                              | 0.833 [0.667, 0.978] (75/90)     | n/a                  | n/a                  | n/a                  | n/a                  |

Windows that are mostly junctional rhythm (`J`, 208 windows in 2 records) are flagged 69 % of the time; with two records their interval means little. Sample entropy is undefined in 11 not-AF windows.

Per record:

| Record | Beats from | Signal file | Windows | AF windows (flagged) | Not-AF windows (flagged) | Intervals by rhythm               |
| ------ | ---------- | ----------- | ------- | -------------------- | ------------------------ | --------------------------------- |
| 00735  | qrs        | no          | 314     | 3 (3)                | 311 (18)                 | AFIB 332, N 39860                 |
| 03665  | qrs        | no          | 412     | 87 (87)              | 325 (244)                | AFIB 11057, J 26490, N 15189      |
| 04015  | qrs        | yes         | 342     | 3 (3)                | 339 (78)                 | AFIB 525, N 43251                 |
| 04043  | qrs        | yes         | 483     | 117 (94)             | 366 (27)                 | AFIB 14634, AFL 25, N 47165       |
| 04048  | qrs        | yes         | 311     | 6 (5)                | 305 (3)                  | AFIB 813, N 38995                 |
| 04126  | qrs        | yes         | 334     | 25 (24)              | 309 (118)                | AFIB 3293, N 39459                |
| 04746  | qrs        | yes         | 374     | 241 (240)            | 133 (16)                 | AFIB 30873, N 16999               |
| 04908  | qrs        | yes         | 482     | 44 (43)              | 438 (6)                  | AFIB 5810, AFL 631, N 55255       |
| 04936  | qrs        | yes         | 419     | 312 (277)            | 107 (30)                 | AFIB 39681, AFL 6310, N 7641      |
| 05091  | qrsc       | yes         | 287     | 1 (1)                | 286 (5)                  | AFIB 139, N 36597                 |
| 05121  | qrs        | yes         | 389     | 266 (257)            | 123 (12)                 | AFIB 33759, J 196, N 15837        |
| 05261  | qrs        | yes         | 355     | 6 (6)                | 349 (82)                 | AFIB 934, N 44506                 |
| 06426  | qrs        | yes         | 430     | 419 (414)            | 11 (9)                   | AFIB 53021, AFL 237, J 98, N 1684 |
| 06453  | qrs        | yes         | 272     | 4 (4)                | 268 (58)                 | AFIB 445, N 34371                 |
| 06995  | qrs        | yes         | 431     | 214 (197)            | 217 (99)                 | AFIB 27505, AFL 26, N 27637       |
| 07162  | qrs        | yes         | 305     | 305 (283)            | 0 (0)                    | AFIB 39040                        |
| 07859  | qrsc       | yes         | 483     | 483 (478)            | 0 (0)                    | AFIB 61824                        |
| 07879  | qrs        | yes         | 433     | 311 (281)            | 122 (10)                 | AFIB 39759, J 7, N 15658          |
| 07910  | qrs        | yes         | 285     | 52 (52)              | 233 (94)                 | AFIB 6680, AFL 848, N 28952       |
| 08215  | qrs        | yes         | 338     | 258 (256)            | 80 (0)                   | AFIB 33039, AFL 77, N 10148       |
| 08219  | qrs        | yes         | 463     | 116 (106)            | 347 (133)                | AFIB 14194, N 45070               |
| 08378  | qrs        | yes         | 355     | 91 (85)              | 264 (5)                  | AFIB 11478, AFL 3544, N 30418     |
| 08405  | qrs        | yes         | 459     | 351 (339)            | 108 (6)                  | AFIB 44992, N 13760               |
| 08434  | qrs        | yes         | 310     | 18 (18)              | 292 (60)                 | AFIB 2284, N 37396                |
| 08455  | qrs        | yes         | 464     | 345 (337)            | 119 (0)                  | AFIB 44105, N 15287               |

## Beat-detection noise on database beats

In the simulated grid, heavy noise took specificity to 0.17, but the noise was applied only to simulated recordings (#296). Here the same `perturbBeats` levels are applied to the annotated beats of all 25 records, seeded per record, and the same windows, flag and record-level bootstrap are used. Simulated columns are the "By beat-detection noise" rows above (whole grid) and the 300 s recordings, whose windows are full 128-interval windows like the database's.

- Command: `bun run rhythm-bench -- --out .rhythm-bench/2026-10-real-noise --afdb <afdb>/files --real-noise`, defaults otherwise. Run id `b7202d327e21a2b8`, on this change before it was committed (git recorded as `cc7e198-dirty`). Simulated numbers are the same as in the run above, and level none has the same point estimates as the database section (its intervals differ in the third decimal because the bootstrap draws are keyed by subset); the figure CSVs are `real-noise.csv` (sensitivity and specificity with intervals per source and level) and `windows-real-noise.csv`, in the gitignored output directory.

| Noise | Missed / spurious beats (of 1,223,168) | Real sensitivity [95 % CI] | Real specificity [95 % CI] | Sim specificity, grid | Sim specificity, 300 s |
| ----- | -------------------------------------- | -------------------------- | -------------------------- | --------------------- | ---------------------- |
| none  | 0 / 0                                  | 0.954 [0.930, 0.974]       | 0.796 [0.699, 0.879]       | 0.756 [0.726, 0.785]  | 0.911 [0.875, 0.943]   |
| light | 1.00 % / 0.99 %                        | 0.980 [0.969, 0.990]       | 0.289 [0.177, 0.418]       | 0.683 [0.647, 0.715]  | 0.869 [0.826, 0.910]   |
| heavy | 5.03 % / 4.78 %                        | 0.986 [0.980, 0.991]       | 0.008 [0.004, 0.012]       | 0.168 [0.143, 0.192]  | 0.253 [0.210, 0.298]   |

Simulated sensitivity is 0.958, 0.966 and 0.995 at the three levels (grid). Spurious beats come out slightly under 5 % at heavy because they go into the intervals left after the missed beats are removed.

Plain reading: yes, real specificity falls with noise as the simulated one does, but much faster. Light noise (about one missed and one spurious beat per 100) already takes it from 0.80 to 0.29 on real beats, where the simulator kept 0.68 over the grid and 0.87 at 300 s; heavy noise leaves almost no not-AF window unflagged (0.008). Sensitivity rises a little, because noise makes every window look more irregular. The difference is in the turning-point condition. Noise pushes nRMSSD above 0.1 in about the same share of not-AF windows in both sources (about 90 % at light), but real not-AF windows already have their turning-point ratio in the random band more often without noise (about 29 % against 9 % in simulated 300 s windows) and move into it quickly with noise (about 75 % at light against 12 %). A likely reason is that the smooth, breathing-driven sinus rhythm of the simulator keeps its turning points away from the band, and real sinus rhythm, with ectopic beats and 4 ms resolution, does so less. So the simulated grid understates how much beat-detection errors cost the flag: on these records it lost most of its specificity at 1 % missed and 1 % spurious beats. (Shares of windows by condition are from `windows-real-noise.csv` and `windows-sim.csv`.) The noise levels are still assumptions, not measured device error rates, and they are added on top of the database's own annotation errors.

## Simulated against real

Simulated windows of a full 128 intervals, all intervals AF or none AF, against database windows whose intervals are all `AFIB` or all `N`. No added noise. W1 is the Wasserstein-1 distance (also divided by the SD of the real values, to compare across quantities), KS the two-sample Kolmogorov-Smirnov statistic. `_norm` quantities are divided by the window's mean RR.

| Sim class | Real class | Quantity            | Sim median | Real median | W1     | W1 / real SD | KS   |
| --------- | ---------- | ------------------- | ---------- | ----------- | ------ | ------------ | ---- |
| af        | AFIB       | nrmssd              | 0.298      | 0.299       | 0.012  | 0.17         | 0.11 |
| af        | AFIB       | turning_point_ratio | 0.656      | 0.625       | 0.031  | 0.61         | 0.29 |
| af        | AFIB       | shannon_entropy     | 0.956      | 0.945       | 0.020  | 0.48         | 0.28 |
| af        | AFIB       | sample_entropy      | 2.159      | 1.938       | 0.284  | 0.66         | 0.33 |
| af        | AFIB       | mean_rr_ms          | 474.895    | 618.281     | 85.076 | 0.65         | 0.46 |
| af        | AFIB       | rr_ms               | 527.000    | 612.000     | 74.550 | 0.38         | 0.20 |
| af        | AFIB       | drr_ms              | -1.000     | -4.000      | 17.595 | 0.09         | 0.04 |
| af        | AFIB       | rr_norm             | 0.978      | 0.975       | 0.009  | 0.04         | 0.03 |
| af        | AFIB       | drr_norm            | -0.001     | -0.007      | 0.013  | 0.04         | 0.03 |
| not-af    | N          | nrmssd              | 0.060      | 0.065       | 0.035  | 0.33         | 0.34 |
| not-af    | N          | turning_point_ratio | 0.414      | 0.477       | 0.063  | 0.51         | 0.26 |
| not-af    | N          | shannon_entropy     | 0.956      | 0.841       | 0.114  | 0.82         | 0.53 |
| not-af    | N          | sample_entropy      | 1.434      | 1.108       | 0.345  | 0.50         | 0.37 |
| not-af    | N          | mean_rr_ms          | 830.063    | 825.672     | 48.448 | 0.32         | 0.26 |
| not-af    | N          | rr_ms               | 838.500    | 824.000     | 47.966 | 0.28         | 0.20 |
| not-af    | N          | drr_ms              | 0.000      | 0.000       | 22.263 | 0.19         | 0.19 |
| not-af    | N          | rr_norm             | 1.004      | 1.003       | 0.018  | 0.18         | 0.11 |
| not-af    | N          | drr_norm            | 0.000      | 0.000       | 0.029  | 0.20         | 0.17 |

Where the simulator is least like the database (largest KS):

| Class  | Quantity            | KS         | What differs                                                                                                                                                                                                                                   |
| ------ | ------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not AF | Shannon entropy     | 0.53       | Simulated sinus windows fill the 16 bins evenly (median 0.956); real sinus windows less so (0.841). This is the gap that kept entropy out of the flag (`docs/query-layer.md`).                                                                 |
| AF     | Window mean RR      | 0.46       | Simulated AF is faster (median 475 ms against 618 ms), because the grid's rates of 70, 100 and 130 /min give more windows at 130. A grid choice, not a property of the AF model.                                                               |
| Not AF | Sample entropy      | 0.37       | Simulated sinus is less regular in the SampEn sense (median 1.43 against 1.11).                                                                                                                                                                |
| Not AF | nRMSSD              | 0.34       | Similar medians (0.060 against 0.065) but a different spread: the simulator's sinus beat-to-beat variability comes from a fixed noise term and a profile range, while real windows include ectopy and detection errors the labels do not mark. |
| AF     | Sample entropy, TPR | 0.33, 0.29 | Simulated AF is more random than real AF (SampEn 2.16 against 1.94, TPR 0.656 against 0.625, where independent values give 0.667). The simulator draws AF intervals independently; real AF has short-range structure.                          |

RR and ΔRR distributions divided by the window mean are close for AF (KS 0.03), as expected when the coefficient of variation the profiles draw is in the range of real AF. Adding beat-detection noise moves nRMSSD further from the database (AF KS 0.11 without noise, 0.86 with heavy noise) and the TPR and sample entropy of AF windows closer; the full table by noise level is in the run's report.

## Limits

- **Circular simulated AF.** Simulated AF intervals are independent log-normal draws, which is exactly the null hypothesis the turning-point test is built on. Simulated sensitivity checks the arithmetic of the flag more than it tests the method. The database shows real AF has structure the simulator lacks.
- **Noise on database beats.** The noise section reuses the same database, which helped derive or test the Dash et al. 2009 thresholds (#264), so its level-none row is not independent of the thresholds either; the drop with noise is a statement about these records and these assumed error rates, not about any device. Perturbed beats start from annotations that have errors of their own (`.qrs` unaudited in most records).
- **Thresholds and database overlap.** The MIT-BIH Atrial Fibrillation Database was used to derive or test the Dash et al. 2009 thresholds, so the database numbers here are not an independent test of those thresholds. An independent test needs another annotated database.
- **Few clusters.** 25 records; the intervals are wide, and per-rhythm rows with 2 to 6 records (J, AFL) are hardly informative.
- **Labels.** Database windows are labelled by the reference rhythm annotations at each beat; `.qrs` beat annotations are unaudited except in two records. Atrial flutter and junctional rhythm count as not AF.
- **Grid choices.** Ectopy rates, AF burdens, rates and noise levels are assumptions chosen to span the simulator, not population estimates; pooled numbers over the grid depend on them. Short recordings are evaluated as one window, which the tool does not do.
- **Method gaps.** No ectopic-beat filter (Dash et al. use one), no entropy condition in the flag, RR resolution of 4 ms in the database (250 Hz) against 1 ms in the simulator.

## Sources

- Moody GB, Mark RG. A new method for detecting atrial fibrillation using R-R intervals. Computers in Cardiology. 1983;10:227-230.
- Goldberger AL, Amaral LAN, Glass L, et al. PhysioBank, PhysioToolkit, and PhysioNet: components of a new research resource for complex physiologic signals. Circulation. 2000;101(23):e215-e220.
- Dash S, Chon KH, Lu S, Raeder EA. Automatic real time detection of atrial fibrillation. Annals of Biomedical Engineering. 2009;37(9):1701-1709.
- Richman JS, Moorman JR. Physiological time-series analysis using approximate entropy and sample entropy. American Journal of Physiology, Heart and Circulatory Physiology. 2000;278(6):H2039-H2049.
