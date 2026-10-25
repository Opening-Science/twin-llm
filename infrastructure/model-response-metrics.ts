import type { UIMessage } from "ai";

/** A measured quantity, or null when the provider gave nothing to measure. */
type Measured = number | null;

type Usd = number;

type TokenCounts<Value> = Readonly<
  Record<"inputTokens" | "outputTokens" | "totalTokens", Value>
>;

/**
 * Measured numbers for one model's answer.
 *
 * They travel to the browser inside the stream (as message metadata) and the
 * very same object is written to the database, so what a card shows and what
 * is stored are one measurement, not two estimates.
 */
export type ModelResponseMetrics = TokenCounts<Measured> &
  Readonly<{
    modelId: string;
    /** Milliseconds from the start of the request to the first text token. */
    timeToFirstTokenMs: Measured;
    /** Output tokens over the whole call's wall-clock time. */
    tokensPerSecond: Measured;
    /** Always 0: every model this app runs costs nothing per call. A real zero. */
    costUsd: Usd;
  }>;

/**
 * The streamed message type, with metrics as its metadata. It lives here
 * because both `features/chat` (writes it) and `features/arena` (reads it)
 * need it, and features may not import each other.
 */
export type ChatUIMessage = UIMessage<ModelResponseMetrics>;

/** Token usage as the AI SDK reports it; any count may be missing. */
type Usage = TokenCounts<number | undefined>;

export type ResponseTimer = Readonly<{
  /** Call on every text delta; only the first call is recorded. */
  markFirstToken: VoidFunction;
  /** Stops the clock and returns the metrics for this call. */
  read: (usage: Usage) => ModelResponseMetrics;
}>;

const orNull = (count: number | undefined): Measured => count ?? null;

/**
 * Speed is measured over the whole call, not just the generating window.
 * Some providers buffer a complete answer and flush it at once; measured over
 * the flush alone that reads as tens of thousands of tokens per second. The
 * wall-clock figure is comparable across streaming and buffering providers,
 * and the initial wait is reported separately as time to first token.
 */
const tokensPerSecondOver = (
  outputTokens: number | undefined,
  ms: number,
): number | null =>
  outputTokens === undefined || ms <= 0
    ? null
    : Math.round((outputTokens * 1000 * 100) / ms) / 100;

/** A stopwatch for one model call; the clock is injectable for tests. */
export function createResponseTimer(
  modelId: ModelResponseMetrics["modelId"],
  clock: () => number = () => performance.now(),
): ResponseTimer {
  const marks: { start: number; firstToken: number | null } = {
    start: clock(),
    firstToken: null,
  };

  const markFirstToken = (): void => {
    if (marks.firstToken === null) marks.firstToken = clock();
  };

  const read = (usage: Usage): ModelResponseMetrics => {
    const elapsed = clock() - marks.start;
    const metrics: ModelResponseMetrics = {
      modelId,
      timeToFirstTokenMs:
        marks.firstToken === null ? null : Math.round(marks.firstToken - marks.start),
      tokensPerSecond: tokensPerSecondOver(usage.outputTokens, elapsed),
      inputTokens: orNull(usage.inputTokens),
      outputTokens: orNull(usage.outputTokens),
      totalTokens: orNull(usage.totalTokens),
      costUsd: 0,
    };
    return Object.freeze(metrics);
  };

  const timer: ResponseTimer = { markFirstToken, read };
  return Object.freeze(timer);
}
