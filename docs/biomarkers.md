# Biomarkers in the Body twin

Track G puts the 67 Anchor biomarkers into the Body twin. This page says what is
shown, where every piece comes from, and which parts TwinLLM wrote itself.
Code: `packages/biomarkers/`.

## What is shown

- **Values with their published reference interval and a neutral position**:
  below, within or above. The position appears only where Anchor publishes a
  reference interval for the subject's population and the value's unit is the
  interval's UCUM code exactly. Nothing converts units.
- Wording is factual ("Above the published range", "Published range 44–150 mg/dL ·
  Anchor v3"). There are no warning colours and no advice.
- **No position** when the marker is BLOCKING in Anchor (open-twin D11: LOINC
  property and unit disagree for Bor, Kupfer and Vitamin K), when no interval fits,
  or when several do.
- A marker lights the body regions it maps to. Markers with no single body
  location light nothing and say so.

G0 provides the data and the two mapping tables, G1 the highlighting, G2 the
tab below.

## The Biomarkers tab

The fourth tab of the body panel (Properties · Markers · Measurements ·
Biomarkers). The Demo body shows only this tab, since it has no scan.

- One row per Anchor marker (`bm:BM-107`), under Anchor's own system, then a
  **Vitals** group (`vital:heartRate`). Search also matches the Anchor id, the
  LOINC code and the English name.
- A row shows the German name, the LOINC display up to its first bracket as the
  English name when it differs, the value and unit, the published range
  ("Published range 44–150 mg/dL · Anchor v3", or "No published range in Anchor v3",
  or "Published range depends on sex, age or timing" when no single interval fits),
  and with a value its position and the day it was measured. A unit that differs
  from the range's says so instead of a position.
- **Where values come from:** the Demo borrows a synthetic cohort person's labs
  (below), Synthetic person 1 by default. Self has no lab source yet, so it lists
  the catalogue and adds Vitals from its own wearable summaries: per vital, the
  first source in the vitals table that has data, newest day. Other BodyLoop
  subjects list the catalogue only. The panel shows for every subject, scans or
  not, since the catalogue always has rows.
- **A failed read says so:** when the cohort list or a person's values cannot be
  loaded, the tab says "Could not load synthetic lab values." and lists the
  catalogue without values, rather than looking like a person with no labs.
- **Selecting a row** lights its regions on the loaded atlas; selecting it again
  clears it. HRA lights the row's organ groups, BodyParts3D the systems they belong
  to. Glands and skeletal muscle light nothing on HRA ("Not in this atlas"); on
  BodyParts3D they light the whole system with their note. A vital lights its HRA
  groups, or its whole system where it has none (strain, steps) and on BodyParts3D.
- The selected row says why nothing lights ("No single body location", "Not in this
  atlas.") and, before anyone has moved past the scan, "Move Depth past the scan to
  see it." The highlight never moves the depth (G1).
- Rows light on select only, not on hover.

## Lab values for the Demo body

The Demo body has no labs of its own, so in synthetic mode it borrows them from a
person in the synthetic B1 cohort (`docs/warehouse.md`).

- `GET /api/biomarkers/cohort` lists the cohort as "Synthetic person 1…N", in
  `subject_ref` order, so the same seed gives the same numbering.
- `GET /api/biomarkers/cohort/:subjectRef` returns the newest numeric row for each
  Anchor LOINC: `{ loinc, value, unitUcum, effectiveAt }`. Synthea writes rows with
  the same timestamp, so a tie goes to the lower row id and a reload shows the same
  value.
- Scope is the synthetic display scope (`packages/query-tools/synthetic-display.ts`):
  `is_synthetic` rows of a Demo cohort, in any `DATA_MODE`, labelled "Synthetic data".
  The chat's query tools keep their stricter rule (`docs/warehouse.md`).
- Every read writes an audit row (`biomarkers.cohort.list`, `biomarkers.cohort.values`),
  refusals and failed reads included, with the row count.
- Matching is by exact LOINC; units are never converted. In the `synthea-v4-seed42`
  cohort 20 of the 67 markers have values. Ferritin (`ug/L`) and total protein
  (`g/dL`) arrive in a different unit from Anchor's, so they show without a position.
- The warehouse stores no sex or age, so a cohort person matches only intervals with
  no sex or age constraint (`general_adult`: HbA1c, sodium, potassium,
  triglycerides …). The Demo body's sex is not used: the labs belong to someone else.
- The same values read also returns `vitals`: the newest heart rate (`8867-4`, in
  open-twin fhir-core `LOINC_CODINGS`) and respiratory rate (`9279-1`, what Synthea
  writes and open-twin's Google Health daily mapper uses), for the live twin (G4). One
  read, one audit row with both lists. The cohort has no HRV.

## Live vitals (G4)

What drives the live twin, and the one rule that is a judgement (`features/digital-twin/live/live-rates.ts`):

- **Heartbeat:** the newest heart rate. Demo: the chosen synthetic person's `8867-4`.
  Self: the first `heartRate` source with data (`vitals.ts`), else resting heart rate.
- **Breathing:** the newest respiratory rate. Demo: `9279-1`. Self: Google Health's
  daily respiratory rate, the only wearable that reports one. No rate, no breathing.
- A reading counts only with a real calendar day (Whoop's `unknown` day is skipped),
  a unit from a closed list matched exactly and never converted, and a positive,
  plausible value: heart rate `bpm`, `/min` or `per minute` (25–230), breathing
  `/min` or `per minute` (3–60), HRV `ms` or `millisecond` (1–300). Oura and Whoop
  store `bpm` and `ms`; Google Health stores the FHIR display unit of the UCUM code
  (`per minute`, `millisecond`). Anything else gives no motion, never a guessed rate.
- One value per day: a day can hold Oura's night (`long_sleep`) and a nap; the night
  wins, else the day's mean, and the metric key breaks a remaining tie, so the API's
  order never matters.
- An old reading still animates. Every line says it is the last
  reading and how old it is, from the reading's day and the viewer's own day:
  "Pulse at 61 bpm · last reading 14 Mar 2025 (1 year ago) · Synthetic person 1
  heart rate".
- **HRV below this person's usual level**: the newest day's HRV is
  at least 20% below the median of the same person's previous 28 days (day 28
  included), and those days hold at least 14 readings. The check is
  `latest × 5 ≤ usual × 4`, so no rounding decides the edge. It compares a person
  only with themself, never with a population, and the viewer never calls it
  stress. The line names both numbers, the reading's date and age, and the source.
  The Demo never shows it: the cohort has no HRV, and none is made up. The rule is
  tested on synthetic series only.

## From Anchor, unchanged

From `@open-twin/anchor-layer` at the pin in `docs/open-twin-pins.md`
(`data/anchor-layer.v1.json`, compiled by open-twin from
`2026_07_28_OpenTwin_AnchorLayer_v3_Consolidated.xlsx`):

- 67 biomarkers: id, German name, LOINC code and display, tier, UCUM unit, source unit.
- `system_id`: one of the nine open-twin systems. TwinLLM never assigns or changes
  a marker's system (D12, D14).
- `region_ids`: 20 regions from Anchor's curated organ mapping.
- Flags: BLOCKING, NOTE ("region assigned by override, confirm") and OPEN.
- 44 reference intervals for 30 markers: issuer, assay, source URL, retrieval
  date, population, low, high, UCUM unit, the range text as printed.

Interpretive bands (LDL: optimal / gut / grenzwertig …) are never read as a reference
interval (open-twin D-c). LDL therefore shows its value without a position.

## Written by TwinLLM

Everything below is TwinLLM's, visual only, and reviewed by Peter in G0.

### Population matching (`population.ts`, `catalogue.ts`)

Anchor names each interval's population with a key such as `age_>18J_male`,
`female_Follikelphase`, `time_vor_10h` or `fasting_adult`.

- **Parsing:** the key becomes constraints for sex, age, cycle phase, time of day
  and fasting. An unknown token makes the key match nobody.
- **Missing facts:** a constraint the subject's context says nothing about is not
  met. Without an age there is no `age_>18J` interval, and a glucose not known to
  be fasting gets no fasting range.
- **One match only:** an interval is used only when exactly one fits. DHEA-S at 34
  sits in two age bands and gets none.
- **Adults:** `adult` adds no constraint, because TwinLLM subjects are adults.

### Unrenderable markers (`unrenderable.ts`)

open-twin D12 names 14 markers with no single body location:

- the blood count (BM-423 to BM-430);
- IgA, IgG and IgM (BM-431 to BM-433);
- Kreatinin (BM-436), Harnsäure (BM-136) and hsCRP (BM-079).

The list exists upstream only as prose, so it is copied here. These markers light
nothing, even where a region has a mesh (Kreatinin lists `kidney`), and are never
moved to a neighbouring system.

### Anchor region → twin atlas (`region-anatomy.ts`)

- **HRA groups:** organ-group keys from `packages/anatomy/hra-groups.ts`, so single
  organs light on the two HRA atlases.
- **BodyParts3D:** one merged mesh per system, so it can only show the whole system
  those organs belong to in the atlas's own classification. This can differ from
  the marker's Anchor system: Anchor files liver under digestive, the atlas under
  metabolic. The highlight follows the atlas; grouping in the UI follows Anchor.

| Region                                    | HRA groups                                      | BodyParts3D     | Why                                                                                                    |
| ----------------------------------------- | ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| liver                                     | liver, liverducts, ductsliver                   | metabolic       | In both HRA atlases                                                                                    |
| biliary                                   | gallbladder, gallbladderducts, ductsgallbladder | metabolic       | In both HRA atlases                                                                                    |
| gut                                       | smallintestine, largeintestine, colon           | digestive       | Calprotectin is a stool marker for the intestine                                                       |
| vasculature                               | bloodvasculature                                | cardiovascular  | In both HRA atlases                                                                                    |
| kidney                                    | kidney, renalpelvis                             | endocrine       | The upstream HRA table files kidney under endocrine                                                    |
| gonads                                    | ovary, testis                                   | reproductive    | Ovary in HRA female; HRA male has no testis mesh, so nothing lights there                              |
| prostate                                  | prostate                                        | reproductive    | HRA male only                                                                                          |
| bone                                      | vertebrae, pelvis, sternum, manubrium, knee     | musculoskeletal | The only bone groups HRA has                                                                           |
| skeletal_muscle                           | –                                               | musculoskeletal | HRA has only knee, eye and larynx muscles. Note: "Muscles not modelled one by one; whole system shown" |
| thyroid, parathyroid, pituitary, adrenal  | –                                               | endocrine       | No HRA atlas has these glands. Note: "Gland not modelled; whole system shown"                          |
| lipid_transport                           | none                                            | none            | Carried in blood; these markers also list vasculature and liver                                        |
| micronutrient_status, electrolyte_balance | none                                            | none            | Whole-body states, not places                                                                          |
| metabolic_glycemic                        | none                                            | none            | Not pinned to the pancreas; Anchor marks the region an override to confirm                             |
| systemic_inflammation                     | none                                            | none            | hsCRP, D12 unrenderable                                                                                |
| immune                                    | none                                            | none            | Lymph nodes are deliberately unmapped; immune is not one of the nine systems                           |
| bone_marrow_blood                         | none                                            | none            | Marrow is not modelled; the blood count is D12 unrenderable                                            |

Pituitary is not moved to `brain` and adrenal is not moved to `kidney`. A marker
whose regions all map to none gets "No single body location". 32 of the 67
markers light something.

### Biomarker → organ (`organ-map.ts`): a reviewed research-use mapping

A second, smaller table for reading values organ by organ. Unlike the region
table it names one organ per marker, as an HRA organ-group key, and only where
the marker clearly belongs to that organ. `organStatus(values)` returns, per
organ, the marker furthest from its published range (above or below beats
within; the first marker in the table keeps a tie) and that marker's name. A
value with no position sets nothing. In the environment, an organ's info card
shows that line ("Range position: Gamma-GT (GGT) · Above the published range");
nothing is coloured, since the twin has no position colours.

| Organ         | HRA group        | Markers                                                                                                                   | Note                                                                                                                                                            |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liver         | liver            | GPT (ALAT) 1742-6, GOT (ASAT) 1920-8, Gamma-GT (GGT) 2324-2                                                               | Anchor region liver. Bilirubin and albumin are not in Anchor v3.                                                                                                |
| Kidney        | kidney           | Kreatinin 2160-0                                                                                                          | Anchor region kidney. D12 keeps its row from lighting; the card line is text only. No eGFR or urea in Anchor v3.                                                |
| Pancreas      | pancreas         | HbA1c 4548-4, Glukose 1558-6                                                                                              | Anchor region metabolic_glycemic, flagged "region assigned by override, confirm"; Anchor's organ wording for HbA1c says pancreatic, for glucose only metabolic. |
| Blood vessels | bloodvasculature | Cholesterin (gesamt) 2093-3, HDL-Cholesterin 2085-9, LDL-Cholesterin 2089-1, Triglyceride 2571-8, Lipoprotein (a) 10835-7 | Anchor region vasculature. LDL and Lp(a) have no reference interval, so they never set a position.                                                              |

Left unmapped, on purpose: the thyroid (TSH, free T4: no atlas has the gland),
the blood count and ferritin (no blood or marrow mesh; D12), bone (calcium,
vitamin D: HRA has five bone groups and no single bone id), and lungs, heart and
blood pressure (SpO2, resting heart rate and blood pressure are not Anchor
markers). Every code in the table must exist in the catalogue and every organ
in `hra-groups.ts`; `organ-map.test.ts` checks both.

### Wearable vitals → body system (`vitals.ts`)

Vitals are not Anchor biomarkers, so Anchor has no system for them. The sources
are the stored metric stems from `infrastructure/format-measure.ts`.

| Vital              | Sources                                                                       | System          | HRA groups                            |
| ------------------ | ----------------------------------------------------------------------------- | --------------- | ------------------------------------- |
| heart rate         | sleep.hr, whoop.cycle.avg_hr, google.heart-rate                               | cardiovascular  | heart                                 |
| resting heart rate | whoop.recovery.rhr, google.daily-resting-heart-rate                           | cardiovascular  | heart                                 |
| HRV                | sleep.hrv, whoop.recovery.hrv, google.daily-heart-rate-variability            | nervous         | brain, with heart as a secondary link |
| SpO2               | whoop.recovery.spo2, google.oxygen-saturation, google.daily-oxygen-saturation | respiratory     | lung                                  |
| respiration        | google.daily-respiratory-rate                                                 | respiratory     | lung, trachea                         |
| sleep              | sleep.score, sleep.duration, sleep.efficiency, whoop.sleep.*                  | nervous         | brain                                 |
| strain             | whoop.cycle.strain                                                            | cardiovascular  | whole system                          |
| steps              | activity.steps, google.steps                                                  | musculoskeletal | whole system                          |

Decisions and open points:

- **HRV:** reflects autonomic regulation, hence nervous. It is measured from
  beat-to-beat timing at the heart, hence the secondary link.
- **Strain:** cardiovascular, because Whoop computes it from heart rate.
- **Sleep:** nervous, matching open-twin's own region contract
  (`sleep_recovery → nervous`).
- **Stress:** no wearable here reports it, so there is no row.
- **Composite scores** (readiness, recovery, activity) get no system.

## open-twin decisions this follows

- **D11:** BLOCKING unit mismatches are not fixed or converted here; such
  markers get no position.
- **D12:** a marker's region key is its Anchor `system_id`, one of nine
  systems. Unrenderable markers are never moved to a neighbouring system.
- **D14:** TwinLLM is the geometry and UI layer. It does not score, map
  terminology or assign systems; the two tables above only say which meshes to
  light.
- **D-c:** reference intervals and interpretive bands stay separate.

## Credits and licences

- **Anchor catalogue:** `@open-twin/anchor-layer`, the Open Science Foundation's open-twin, MIT.
  Cite open-twin as in its `CITATION.cff`. Compiled from the Anchor workbook v3
  (original marker list by Robin Wilkening).
- **LOINC:** codes and names are © Regenstrief Institute, Inc., used under the
  LOINC licence, https://loinc.org/license/.
- **Reference intervals:** credited per row to their issuer and source URL as
  published in Anchor.
- **Atlases:** HuBMAP Human Reference Atlas, CC BY 4.0, and BodyParts3D © DBCLS,
  CC BY 4.0. See `NOTICE` and `docs/anatomy.md`.
