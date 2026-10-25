/**
 * A `fetch` for a cloud model that gives up when the answer has not started
 * after `timeoutMs`: no response headers, or headers but no first body byte.
 *
 * vLLM can send headers at once and then stall before the first token, so the
 * timer runs until the first body chunk, not just until the headers. The abort
 * reason is a `TimeoutError`, which the AI SDK treats as an abort and does not
 * retry, so a silent stall fails once instead of three times. Once the
 * first byte is in, or the caller aborts, the timer is cleared and a slow
 * answer is left to stream for as long as it needs.
 *
 * Pure: `fetch` and the timer are passed in, so tests need no network, no
 * real waiting and no `server-only`.
 */

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The two timer calls this needs; `setTimeout` / `clearTimeout` outside tests. */
export type TimerPort = Readonly<{
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}>;

const SYSTEM_TIMER: TimerPort = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const FIRST_BYTE_TIMEOUT_MESSAGE = "The model sent nothing before the time limit";

const firstByteTimeoutError = (): DOMException =>
  new DOMException(FIRST_BYTE_TIMEOUT_MESSAGE, "TimeoutError");

export const withFirstByteTimeout =
  (deps: Readonly<{ fetch: Fetch; timeoutMs: number; timer?: TimerPort }>): Fetch =>
  async (input, init) => {
    const timer = deps.timer ?? SYSTEM_TIMER;
    const timeout = new AbortController();
    const caller = init?.signal ?? null;
    let onBodyTimeout: (() => void) | null = null;

    const handle = timer.set(
      () => timeout.abort(firstByteTimeoutError()),
      deps.timeoutMs,
    );
    const stopTimer = (): void => {
      timer.clear(handle);
      caller?.removeEventListener("abort", stopTimer);
      if (onBodyTimeout) timeout.signal.removeEventListener("abort", onBodyTimeout);
    };
    caller?.addEventListener("abort", stopTimer, { once: true });

    const signal = caller ? AbortSignal.any([caller, timeout.signal]) : timeout.signal;

    let response: Response;
    try {
      response = await deps.fetch(input, { ...init, signal });
    } catch (error) {
      stopTimer();
      // A fetch that ignores the signal's reason still fails as a timeout.
      throw timeout.signal.aborted ? timeout.signal.reason : error;
    }

    if (!response.body) {
      stopTimer();
      return response;
    }

    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const fail = () => {
          controller.error(timeout.signal.reason);
          reader.cancel(timeout.signal.reason).catch(() => undefined);
        };
        onBodyTimeout = fail;
        if (timeout.signal.aborted) fail();
        else timeout.signal.addEventListener("abort", fail, { once: true });
      },
      pull: async (controller) => {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } finally {
          stopTimer();
        }
        if (timeout.signal.aborted) return;
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      },
      cancel: (reason) => {
        stopTimer();
        return reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
