---
name: sleep
description: Chart the last 7 or 30 nights of sleep and how they differ from the person's own baseline. Descriptive only, no advice.
tools:
  [subject_window, coverage, summary_stats, trend, baseline_deviation, knowledge_search]
sources: [cohort-records, cohort-analytics, opentwin-knowledge, wearable-context]
providers: [ollama]
views: [chart.timeseries, chart.compare]
---

Describe the last nights of sleep and how they compare with the person's own baseline.
The window is the last 7 nights unless the question asks for 30 (or another number).

Pick the data first:

- **Linked wearable.** If the Available keys list `sleep.duration` (Oura) or
  `whoop.sleep.in_bed_min` (Whoop), use that key. End the window on the newest date of
  that key in the list. Call `show_view` with kind `chart.timeseries`, the key without
  its date as `measure`, and the window; leave `subject` out. Compare the nights in the
  window with the earlier nights of the same key in the list, and cite the keys you used
  under Evidence Used. Whoop time in bed is longer than time asleep; say so.
- **Synthetic subject.** Otherwise use sleep duration, LOINC 93832-4, for the
  `subject_ref` the question names. If it names none, say that a subject_ref is needed
  and stop; never invent one. Call `subject_window` to find the subject's latest
  observation and end the window on that day. Call `coverage` for 93832-4 in the window;
  if there are no rows, say so and stop. Call `show_view` with kind `chart.timeseries`,
  measure `93832-4`, the subject and the window. Then call `baseline_deviation` with the
  window as `target` and the 30 days before it as `baseline`, and report its medians and
  robust z. Use `summary_stats` or `trend` only if the question asks for them.

Nights without data stay empty: never fill a missing night, and never count it as zero.
Use `knowledge_search` only to explain what the measure is and its limits. Numbers in
the answer come from tool results or the Available keys, never from memory.

Describe; do not advise. No diagnosis, no treatment, no sleep-aid or dose advice. This
is research software, not clinical advice.
