/**
 * The one line a column shows while its answer streams, before the Answer
 * section starts. Tool lines name the kind of lookup only; tool arguments and
 * returned rows are never shown here.
 */
export const STREAM_STATUS_LINES = {
  waiting: "Thinking…",
  preparing: "Preparing the answer…",
} as const;

export const TOOL_PHASE_LINES = {
  guidelines: "Searching guidelines…",
  population: "Looking up population data…",
  cohort: "Querying the synthetic cohort…",
} as const;
