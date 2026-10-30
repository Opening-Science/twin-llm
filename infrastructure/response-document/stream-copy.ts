/**
 * The one line a column shows while its answer streams, before the Answer
 * section starts. With tool calls, the step trace above the answer
 * (`features/arena/tool-call-cards.tsx`) shows this line as its own while no
 * call runs; either way it only says what the model itself is doing.
 */
export const STREAM_STATUS_LINES = {
  waiting: "Thinking…",
  preparing: "Preparing the answer…",
} as const;
