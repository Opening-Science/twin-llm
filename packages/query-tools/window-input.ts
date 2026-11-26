import { type Clock, resolvePeriod, type ResolvedWindow } from "./relative-window";
import type { SessionScope } from "./scope";

/**
 * The tools' side of #901: a window is `start` and `end`, or `period`. A
 * period is turned into `start` and `end` here, before the tool runs, so the
 * tool reads, and its audit entry records, the dates it was resolved to; the
 * result then says them back (`resolved_window`, or `resolved_windows` for a
 * tool with two windows) for the answer to state.
 */

export type WindowFields = Readonly<{ start?: string; end?: string; period?: string }>;

/** A window once its period is dates. */
export type Dated<W> = Omit<W, "start" | "end"> &
  Readonly<{ start: string; end: string }>;

/** The session's clock: the pinned reference now, in the subject's zone. */
export const clockOf = (scope: SessionScope): Clock => ({
  now: scope.now ?? new Date(),
  timeZone: scope.timeZone ?? "UTC",
});

type Settled<W> = Readonly<{ window: Dated<W>; resolved: ResolvedWindow | null }>;

const settle = <W extends WindowFields>(scope: SessionScope, window: W): Settled<W> => {
  const resolved =
    window.period === undefined ? null : resolvePeriod(window.period, clockOf(scope));
  const start = resolved?.start ?? window.start;
  const end = resolved?.end ?? window.end;
  // The schemas ask for start and end, or period; only a caller that skipped them gets here.
  if (start === undefined || end === undefined) {
    throw new Error("a window needs start and end, or period");
  }
  return { window: { ...window, start, end }, resolved };
};

const echo = <R>(result: R, key: string, value: unknown): R =>
  typeof result !== "object" || result === null ? result : { ...result, [key]: value };

/** Runs a one-window tool with its period resolved to dates. */
export const withWindow = async <I extends WindowFields, R>(
  scope: SessionScope,
  input: I,
  run: (input: Dated<I>) => Promise<R>,
): Promise<R> => {
  const { window, resolved } = settle(scope, input);
  const result = await run(window);
  return resolved === null ? result : echo(result, "resolved_window", resolved);
};

/** Runs a two-window tool (`baseline`/`target`, `window_a`/`window_b`) the same way. */
export const withTwoWindows = async <
  A extends string,
  B extends string,
  I extends Readonly<Record<A | B, WindowFields>>,
  R,
>(
  scope: SessionScope,
  input: I,
  names: readonly [A, B],
  run: (
    input: Omit<I, A | B> & Readonly<Record<A | B, Dated<WindowFields>>>,
  ) => Promise<R>,
): Promise<R> => {
  const [a, b] = names;
  const first = settle(scope, input[a]);
  const second = settle(scope, input[b]);
  const result = await run({ ...input, [a]: first.window, [b]: second.window });
  const resolved = Object.fromEntries(
    [
      [a, first.resolved],
      [b, second.resolved],
    ].filter(([, value]) => value !== null),
  );
  return Object.keys(resolved).length === 0
    ? result
    : echo(result, "resolved_windows", resolved);
};
