/**
 * The one line a column shows while its answer streams, before the Answer
 * section starts. Tool calls show as their own cards above it
 * (`features/arena/tool-call-cards.tsx`), so this line only says what the
 * model itself is doing.
 */
export const STREAM_STATUS_LINES = {
  waiting: "Thinking…",
  preparing: "Preparing the answer…",
} as const;
