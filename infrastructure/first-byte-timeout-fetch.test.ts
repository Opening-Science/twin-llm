import { describe, expect, test } from "bun:test";

import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import {
  FIRST_BYTE_TIMEOUT_MESSAGE,
  type TimerPort,
  withFirstByteTimeout,
} from "./first-byte-timeout-fetch";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Never answers; rejects with the signal's reason once it is aborted. */
const silentFetch = (): Readonly<{ fetch: Fetch; calls: () => number }> => {
  let count = 0;
  const fetch: Fetch = async (_input, init) => {
    count += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
        once: true,
      });
    });
  };
  return { fetch, calls: () => count };
};

/** A timer the test fires by hand; it remembers what was set and cleared. */
const fakeTimer = () => {
  const pending = new Map<number, () => void>();
  const cleared: number[] = [];
  let next = 0;
  const timer: TimerPort = {
    set: (run) => {
      next += 1;
      pending.set(next, run);
      return next;
    },
    clear: (handle) => {
      cleared.push(handle as number);
      pending.delete(handle as number);
    },
  };
  return {
    timer,
    cleared: () => [...cleared],
    /** Runs every timer that is still pending, as if its time had come. */
    fire: () => {
      const due = [...pending.values()];
      pending.clear();
      due.forEach((run) => run());
    },
  };
};

/** Sends headers at once; the test pushes body chunks and ends it by hand. */
const pushFetch = () => {
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
  let seenSignal: AbortSignal | null = null;
  const fetch: Fetch = async (_input, init) => {
    seenSignal = init?.signal ?? null;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        stream = controller;
      },
    });
    return new Response(body, { status: 200, statusText: "OK" });
  };
  return {
    fetch,
    push: (text: string) => stream?.enqueue(encoder.encode(text)),
    end: () => stream?.close(),
    signal: () => seenSignal,
  };
};

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );

describe("withFirstByteTimeout", () => {
  test("no headers before the limit rejects with a TimeoutError", async () => {
    const silent = silentFetch();
    const clock = fakeTimer();
    const fetch = withFirstByteTimeout({
      fetch: silent.fetch,
      timeoutMs: 120_000,
      timer: clock.timer,
    });

    const pending = rejection(fetch("https://gpu1.example.invalid/v1/chat"));
    clock.fire();
    const error = await pending;

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("TimeoutError");
    expect((error as DOMException).message).toBe(FIRST_BYTE_TIMEOUT_MESSAGE);
    expect(silent.calls()).toBe(1);
  });

  test("headers but no body byte before the limit fails the body read", async () => {
    const body = pushFetch();
    const clock = fakeTimer();
    const fetch = withFirstByteTimeout({
      fetch: body.fetch,
      timeoutMs: 120_000,
      timer: clock.timer,
    });

    const response = await fetch("https://gpu1.example.invalid/v1/chat");
    expect(response.status).toBe(200);
    const pending = rejection(response.text());
    clock.fire();

    expect(((await pending) as DOMException).name).toBe("TimeoutError");
  });

  test("the first byte clears the timer, so a slow rest of the answer is not cut off", async () => {
    const body = pushFetch();
    const clock = fakeTimer();
    const fetch = withFirstByteTimeout({
      fetch: body.fetch,
      timeoutMs: 120_000,
      timer: clock.timer,
    });

    const response = await fetch("https://gpu1.example.invalid/v1/chat");
    const text = response.text();
    body.push("data: first\n");
    await Bun.sleep(0);
    expect(clock.cleared()).toEqual([1]);
    clock.fire();
    body.push("data: second\n");
    body.end();

    expect(await text).toBe("data: first\ndata: second\n");
  });

  test("a caller abort after the headers clears the timer", async () => {
    const body = pushFetch();
    const clock = fakeTimer();
    const fetch = withFirstByteTimeout({
      fetch: body.fetch,
      timeoutMs: 120_000,
      timer: clock.timer,
    });
    const caller = new AbortController();

    const response = await fetch("https://gpu1.example.invalid/v1/chat", {
      signal: caller.signal,
    });
    expect(response.status).toBe(200);
    expect(clock.cleared()).toEqual([]);
    caller.abort(new Error("user left"));

    expect(clock.cleared()).toEqual([1]);
    expect(body.signal()?.aborted).toBe(true);
  });

  test("the caller's own abort before the headers passes through with its reason", async () => {
    const silent = silentFetch();
    const clock = fakeTimer();
    const fetch = withFirstByteTimeout({
      fetch: silent.fetch,
      timeoutMs: 120_000,
      timer: clock.timer,
    });
    const caller = new AbortController();

    const pending = rejection(
      fetch("https://gpu1.example.invalid/v1/chat", { signal: caller.signal }),
    );
    caller.abort(new Error("user left"));

    expect(((await pending) as Error).message).toBe("user left");
    expect(clock.cleared()).toEqual([1, 1]);
  });

  test("the AI SDK does not retry a silent stall: one call, then a TimeoutError", async () => {
    const silent = silentFetch();
    const provider = createOpenAI({
      baseURL: "https://gpu1.example.invalid/v1",
      apiKey: "synthetic-key",
      fetch: withFirstByteTimeout({ fetch: silent.fetch, timeoutMs: 20 }),
    });
    const errors: unknown[] = [];

    const result = streamText({
      model: provider.chat("synthetic/model"),
      prompt: "synthetic prompt",
      onError: ({ error }) => {
        errors.push(error);
      },
    });
    await result.consumeStream();

    expect(silent.calls()).toBe(1);
    expect(errors.map((error) => (error as Error).name)).toEqual(["TimeoutError"]);
  });
});
