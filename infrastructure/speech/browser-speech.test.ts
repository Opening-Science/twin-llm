import { afterEach, describe, expect, test } from "bun:test";

import { localVoice, sayAll, type Synth } from "./browser-speech";

/**
 * Reading aloud with the browser's own voices, against stand-ins for
 * `speechSynthesis` and its utterances: no browser and no sound needed.
 */

const voice = (lang: string, localService: boolean, name = lang) => ({
  name,
  lang,
  localService,
});

describe("localVoice", () => {
  const voices = [
    voice("en-GB", false, "Google UK English Female"),
    voice("en-US", true, "Samantha"),
    voice("en-GB", true, "Daniel"),
    voice("de-DE", false, "Google Deutsch"),
  ];

  test("picks a voice on this machine in the exact locale first", () => {
    expect(localVoice(voices, "en")?.name).toBe("Daniel");
  });

  test("falls back to another voice of the language on this machine", () => {
    expect(localVoice([voices[1], voice("de_DE", true, "Anna")], "de")?.name).toBe(
      "Anna",
    );
    expect(localVoice([voices[0], voices[1]], "en")?.name).toBe("Samantha");
  });

  test("never a voice the browser speaks through a server", () => {
    expect(localVoice(voices, "de")).toBeNull();
    expect(localVoice([voices[0]], "en")).toBeNull();
    expect(localVoice([], "en")).toBeNull();
  });
});

type Listener = (event: { error?: string }) => void;

/** An utterance that only starts, ends or fails when the test says so. */
class StubUtterance {
  lang = "";
  voice: unknown = null;
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly text: string) {}
  addEventListener(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  fire(name: string, event: { error?: string } = {}) {
    (this.listeners.get(name) ?? []).forEach((listener) => listener(event));
  }
}

const realUtterance = globalThis.SpeechSynthesisUtterance;
afterEach(() => {
  globalThis.SpeechSynthesisUtterance = realUtterance;
});

const stubSynth = () => {
  const queued: StubUtterance[] = [];
  let cancelled = 0;
  globalThis.SpeechSynthesisUtterance =
    StubUtterance as unknown as typeof SpeechSynthesisUtterance;
  const synth: Synth = {
    speak: (utterance) => queued.push(utterance as unknown as StubUtterance),
    cancel: () => {
      cancelled += 1;
    },
  };
  return { synth, queued, cancelled: () => cancelled };
};

const DANIEL = voice("en-GB", true, "Daniel") as unknown as SpeechSynthesisVoice;

describe("sayAll", () => {
  test("queues each piece in the language's locale and voice; done when the last ends", async () => {
    const { synth, queued } = stubSynth();
    let done = false;
    const saying = sayAll(
      synth,
      ["Your heart is fine.", "Sleep was short."],
      DANIEL,
      "en",
      new AbortController().signal,
    ).then(() => {
      done = true;
    });
    expect(queued.map((utterance) => [utterance.text, utterance.lang])).toEqual([
      ["Your heart is fine.", "en-GB"],
      ["Sleep was short.", "en-GB"],
    ]);
    expect(queued.every((utterance) => utterance.voice === DANIEL)).toBe(true);
    queued[0]?.fire("end");
    await Promise.resolve();
    expect(done).toBe(false);
    queued[1]?.fire("end");
    await saying;
    expect(done).toBe(true);
  });

  test("marks the first words when the browser starts speaking, not when they are queued", async () => {
    const { synth, queued } = stubSynth();
    const marks: string[] = [];
    const saying = sayAll(
      synth,
      ["One.", "Two."],
      DANIEL,
      "en",
      new AbortController().signal,
      () => marks.push("first words"),
    );
    expect(marks).toEqual([]);
    queued[0]?.fire("start");
    queued[1]?.fire("start");
    expect(marks).toEqual(["first words"]);
    queued[1]?.fire("end");
    await saying;
  });

  test("an answer stopped before it is heard marks nothing", async () => {
    const { synth, queued } = stubSynth();
    const marks: string[] = [];
    const controller = new AbortController();
    const saying = sayAll(synth, ["One."], DANIEL, "en", controller.signal, () =>
      marks.push("first words"),
    );
    controller.abort();
    queued[0]?.fire("start");
    await saying;
    expect(marks).toEqual([]);
  });

  test("stopping cancels the browser's speech and is not a failure", async () => {
    const { synth, queued, cancelled } = stubSynth();
    const controller = new AbortController();
    const saying = sayAll(synth, ["One.", "Two."], DANIEL, "en", controller.signal);
    controller.abort();
    queued[0]?.fire("error", { error: "interrupted" });
    await saying;
    expect(cancelled()).toBe(1);
  });

  test("a voice that fails stops the rest and rejects", async () => {
    const { synth, queued, cancelled } = stubSynth();
    const saying = sayAll(
      synth,
      ["One.", "Two."],
      DANIEL,
      "en",
      new AbortController().signal,
    );
    queued[0]?.fire("error", { error: "synthesis-failed" });
    expect(saying).rejects.toThrow("synthesis-failed");
    await saying.catch(() => undefined);
    expect(cancelled()).toBe(1);
  });
});
