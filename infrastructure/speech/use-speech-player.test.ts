import { afterEach, describe, expect, test } from "bun:test";

import { playBlob } from "./use-speech-player";

/** An Audio element that plays only when the test says so. */
class StubAudio {
  static last: StubAudio | null = null;
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor(readonly src: string) {
    StubAudio.last = this;
  }
  addEventListener(name: string, listener: () => void, options?: { once?: boolean }) {
    const wrapped = () => {
      if (options?.once === true) {
        this.listeners.set(
          name,
          (this.listeners.get(name) ?? []).filter((kept) => kept !== wrapped),
        );
      }
      listener();
    };
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), wrapped]);
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
  fire(name: string) {
    (this.listeners.get(name) ?? []).forEach((listener) => listener());
  }
}

const realAudio = globalThis.Audio;
afterEach(() => {
  globalThis.Audio = realAudio;
  StubAudio.last = null;
});

describe("playBlob", () => {
  test("marks the first words when the audio starts playing, not when it arrives", async () => {
    globalThis.Audio = StubAudio as unknown as typeof Audio;
    const marks: string[] = [];
    const done = playBlob(new Blob(["wav"]), new AbortController().signal, () =>
      marks.push("playing"),
    );
    await Promise.resolve();
    expect(marks).toEqual([]);
    StubAudio.last?.fire("playing");
    StubAudio.last?.fire("playing");
    expect(marks).toEqual(["playing"]);
    StubAudio.last?.fire("ended");
    await done;
  });

  test("an answer stopped before it plays marks nothing", async () => {
    globalThis.Audio = StubAudio as unknown as typeof Audio;
    const marks: string[] = [];
    const controller = new AbortController();
    const done = playBlob(new Blob(["wav"]), controller.signal, () =>
      marks.push("playing"),
    );
    controller.abort();
    await done;
    expect(marks).toEqual([]);
  });
});
