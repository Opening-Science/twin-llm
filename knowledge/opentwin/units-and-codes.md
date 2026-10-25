# Title: Units and codes

How TwinLLM names, codes and stores measurements. CC BY 4.0, Open Science
Foundation. See LICENSE.md.

# Section: What a LOINC code is

LOINC (Logical Observation Identifiers Names and Codes) is a public catalogue of codes
for lab tests and clinical measurements. Each code names one kind of observation, for
example `8867-4` heart rate, `8480-6` systolic blood pressure, `8462-4` diastolic blood
pressure, `29463-7` body weight, `39156-5` BMI, `4548-4` HbA1c, `2339-0` blood glucose,
`2093-3` total cholesterol, `18262-6` LDL cholesterol, `2085-9` HDL cholesterol and
`2571-8` triglycerides.

TwinLLM's analytics tools take LOINC codes as input, in the form digits, a hyphen and
a check digit (`\d{1,5}-\d+`). A LOINC code says what was measured, not how or by whom.

# Section: What a UCUM unit is

UCUM (the Unified Code for Units of Measure) is a standard way to write units so that
software can read them without guessing: `mm[Hg]` for millimetres of mercury, `kg` for
kilograms, `kg/m2` for BMI, `%` for percent, `/min` for beats per minute, `mg/dL` and
`mmol/L` for lab concentrations.

Every numeric observation in the TwinLLM warehouse carries a UCUM unit
(`unit_ucum`). A row with no unit is rejected at ingest; it is never stored as zero or
with a guessed unit.

# Section: How the warehouse stores observations

The warehouse holds the synthetic Synthea cohort only. Personal wearable data never
goes into these tables.

- `subjects`: an opaque `subject_ref`, `is_synthetic` (always true) and a cohort id.
- `bundles`: one row per FHIR bundle, keyed by the sha256 of its bytes, so the same
  file is never ingested twice.
- `observations`: one numeric value per row with its LOINC code, UCUM unit and time.
- `observation_non_numeric`: text, coded and yes/no values, kept as raw JSON.

Analytics tools read these tables through fixed, parameterised queries. The model
never writes SQL.

# Section: Blood pressure panels

A blood pressure reading arrives as one panel (LOINC `85354-9`) with two parts. At
ingest TwinLLM splits it into two numeric rows, systolic (`8480-6`) and diastolic
(`8462-4`), both with the panel's time. The panel itself is kept as a non-numeric row.
To look at blood pressure, query `8480-6` and `8462-4`, not the panel code.

# Section: No unit conversion

TwinLLM never converts between units. If the rows for one code use more than one unit
(for example glucose in both `mg/dL` and `mmol/L`), the analytics tools refuse with
`MIXED_UNITS` and list the units found, instead of averaging numbers that do not
belong together. Wearable values keep the unit the device sent.

# Section: Wearable metric keys and dates

Wearable values are cited by a key of the form `<stem>.<YYYY-MM-DD>`, for example
`sleep.hrv.2026-10-14` or `whoop.recovery.score.2026-10-14`. The stem names the device
and metric (see the metric glossary); the date is the calendar day the value belongs to.
Oura sleep keys can carry a sleep period between stem and date, such as
`sleep.score.long_sleep.2026-10-14`. Google keys start with `google.` and BodyLoop body
scan keys with `vitronic.`.

An answer may only cite keys that were offered to the model in that turn. A key the
model invents is listed as a hallucinated key and never counts as evidence.

# Section: How numbers and dates are shown

One shared formatter renders every number, unit and date:

- Locale `en-GB`: `,` for thousands, `.` for decimals, dates like `16 Oct 2026`.
- Rounding is half away from zero on the decimal value, so 0.15 shows as 0.2.
- Each measure kind has fixed decimals: HRV and heart rate 0, SpO2 1, percentages 0,
  scores 0, steps 0, kcal 0, Whoop strain 1, weight 1.
- Sleep minutes show as hours and minutes, e.g. `7 h 12 min`.
- Angles show as `12.3°` with no space.

# Section: Missing values

A value that is missing or not a finite number is shown as `—`, never as 0. In the
analytics tools a statistic with no data (a mean, a slope, a median) is `null`, while
counts stay 0. A gap in the data is reported as a gap, not filled in.
