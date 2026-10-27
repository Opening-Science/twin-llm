# Title: System limits

What TwinLLM is, what its tools can and cannot compute, and why an answer may be
withheld or declined. CC BY 4.0, Open Science Foundation. See LICENSE.md.

# Section: A research tool, not clinical advice

TwinLLM is a research prototype of the Open Science Foundation. It shows supplied
data and model output side by side so that researchers can compare open-source models.
It is not a medical device and gives no clinical advice. It does not make health
decisions, does not name conditions and does not suggest doses or medicines. A wearable
number or a model's sentence is never a finding about a person's health; anything that
matters should be discussed with a clinician.

# Section: What the analytics tools compute

The model cannot compute statistics itself; closed tools do the maths over the
synthetic warehouse and return the result:

- `summary_stats`: n, min, max, mean and unit for one code in a window.
- `trend`: least-squares slope per day, with fitted first and last values. It needs at
  least 3 rows spanning at least 2 days, otherwise the slope is `null`.
- `baseline_deviation`: robust z, the difference of medians divided by 1.4826 times the
  baseline MAD. `null` when the MAD is 0 or a window is empty.
- `coverage`: days with data, coverage ratio and the longest gap in days.
- `compare_windows`: n, mean, median, min and max for two windows, and B minus A.
- `range_position`: one reading against its Anchor v3 published range: below, within or
  above it. When the range depends on sex, age or timing, which the warehouse does not
  hold, the position is `null` and `depends_on` names the facts.

A slope or z value describes the rows, not the cause behind them.

# Section: What the tools refuse

- `MIXED_UNITS`: rows for one code use more than one unit. Nothing is converted.
- `ROW_CAP_EXCEEDED`: a window holds more than 5000 rows. The tool refuses instead of
  fitting a cut-off series.
- `SUBJECT_SCOPE_VIOLATION`: the subject is not in this session's scope (in personal
  mode the warehouse scope is empty).
- Guideline and knowledge search return at most 8 passages per call.
- `range_position` also refuses `NO_ROWS` (no reading), `NO_PUBLISHED_RANGE` (Anchor v3
  has no range for the code) and `UNIT_MISMATCH` (the reading's unit is not the range's).

A refused call is still written to the audit log, with 0 rows.

# Section: Why an answer abstains

An answer abstains, and its text is withheld, when it rests on nothing: no wearable key
was cited, no analytics tool returned rows, and no guideline passage, population figure
or OpenTwin knowledge note was used. The panel then shows "Not enough data". This is
deliberate: TwinLLM would rather show nothing than an answer without a source. Connecting
a wearable, widening the date window or asking about a metric that exists usually helps.

# Section: Why an answer is declined

A request for a health decision, such as starting, stopping or changing a medicine or a
dose, or naming what condition someone has, is declined. The model replies with a
refusal and the answer class is `declined_decision_support`. TwinLLM can describe data
and published material; deciding what to do with it is for a person and their clinician.

# Section: Answer classes and uncertainty

Every answer has an answer class:

- `analytics`: the answer used data about a person (cited wearable keys or warehouse
  rows from an analytics tool).
- `information`: the answer used only reference material (guideline passages, population
  figures, OpenTwin knowledge) or no data. A question such as "what does HRV measure?"
  is `information`.
- `declined_decision_support`: the request asked for a health decision.

Uncertainty is `low`, `moderate` or `high`, with reasons such as `no_personal_data`,
`guideline_only`, `population_only`, `knowledge_only`, `hallucinated_keys` and
`tool_returned_no_rows`.

# Section: What wearable numbers cannot show

Consumer wearables estimate heart rate, HRV, SpO2, sleep and activity from optical and
motion sensors. Scores such as sleep, readiness, recovery and strain are each vendor's
own formulas. None of them is a clinical measurement, values from different devices are
not comparable, and a short window says little. TwinLLM reports what was recorded and
how it changed; it does not say what a change means for a person's health.
