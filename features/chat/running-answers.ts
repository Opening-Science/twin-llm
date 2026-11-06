import { processSingleton } from "@/infrastructure/process-singleton";

/**
 * The answers this server process is writing and can still end (#373), by turn
 * and model. Only `POST /api/chat` adds to the list, so a scheduled run (#54) is
 * never on it. The list lives in memory: on a deployment with several server
 * processes, a Stop only reaches an answer running in the process that gets it.
 *
 * A reloaded tab opens a second stream for a row still STREAMING, so one key can
 * hold more than one answer; Stop ends them all.
 *
 * A Stop can reach the server before the answer's own request has got through
 * its checks. Then there is nothing to end yet, so the stop is held for a short
 * while and the answer is ended as soon as it starts. The next start for the
 * key takes the held stop: if the original request was refused before it got
 * here and the person retries within the hold, that retry is ended on arrival.
 * It is rare, and the retry after it runs.
 */

export type AnswerKey = Readonly<{ turnId: string; modelId: string }>;

export type RunningAnswer = Readonly<{
  signal: AbortSignal;
  /** Takes the answer off the list; safe to call more than once. */
  release: () => void;
}>;

export const EARLY_STOP_MS = 30_000;

const keyOf = ({ turnId, modelId }: AnswerKey): string =>
  JSON.stringify([turnId, modelId]);

export const createRunningAnswers = (now: () => number = Date.now) => {
  const running = new Map<string, Set<AbortController>>();
  const earlyStops = new Map<string, number>();

  const dropExpired = () => {
    const time = now();
    earlyStops.forEach((until, key) => {
      if (until <= time) earlyStops.delete(key);
    });
  };

  return {
    start: (answer: AnswerKey): RunningAnswer => {
      dropExpired();
      const key = keyOf(answer);
      const controller = new AbortController();
      const controllers = running.get(key) ?? new Set<AbortController>();
      controllers.add(controller);
      running.set(key, controllers);
      if (earlyStops.delete(key)) controller.abort();
      return {
        signal: controller.signal,
        release: () => {
          controllers.delete(controller);
          if (controllers.size === 0 && running.get(key) === controllers) {
            running.delete(key);
          }
        },
      };
    },
    /**
     * Ends the answers under this key and returns how many. `mayStillStart`
     * (the row is STREAMING) holds the stop for an answer not started yet.
     */
    stop: (answer: AnswerKey, mayStillStart: boolean): number => {
      dropExpired();
      const key = keyOf(answer);
      const controllers = [...(running.get(key) ?? [])];
      controllers.forEach((controller) => controller.abort());
      if (controllers.length === 0 && mayStillStart) {
        earlyStops.set(key, now() + EARLY_STOP_MS);
      }
      return controllers.length;
    },
  };
};

export type RunningAnswers = ReturnType<typeof createRunningAnswers>;

/** Next.js may load a module once per route, so the list hangs off the process. */
export const runningAnswers: () => RunningAnswers = processSingleton(
  "twinllm.runningAnswers",
  () => createRunningAnswers(),
);
