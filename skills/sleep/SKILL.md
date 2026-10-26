---
name: sleep
description: Describe a subject's sleep duration against their own recent baseline. Descriptive only, no advice.
tools:
  [subject_window, coverage, summary_stats, trend, baseline_deviation, knowledge_search]
sources: [cohort-records, cohort-analytics, opentwin-knowledge, wearable-context]
providers: [ollama]
views: [chart.timeseries, chart.compare]
---

Describe sleep for the subject in the turn, using sleep duration (LOINC 93832-4).

1. Check how much sleep data there is with `coverage` first. If there is none in the
   window, say so and stop; a missing night stays missing.
2. Report the window's nights with `summary_stats`, the direction with `trend`, and the
   last week against the previous 30 days with `baseline_deviation`.
3. Use `knowledge_search` only to explain what the measure is and its limits.
4. Ask for a `chart.timeseries` view of the nights, or `chart.compare` for the two
   windows. Numbers in the answer come from tool results, never from memory.

Describe; do not advise. No diagnosis, no treatment, no sleep-aid or dose advice. This
is research software, not clinical advice.
