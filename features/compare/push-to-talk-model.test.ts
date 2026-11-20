import { describe, expect, test } from "bun:test";

import {
  defaultVoiceLanguage,
  firstWordsLine,
  heardLine,
  pushToTalkLabel,
  startHold,
  transcribeOutcome,
} from "./push-to-talk-model";
import type { Recording } from "@/infrastructure/speech/recorder";

describe("push to talk", () => {
  test("the button says what holding it does, in the picked language", () => {
    expect(pushToTalkLabel("idle", "en")).toBe("Hold to speak in English");
    expect(pushToTalkLabel("idle", "de")).toBe("Hold to speak in German");
    expect(pushToTalkLabel("listening", "de")).toBe("Listening… let go to send");
    expect(pushToTalkLabel("writing", "en")).toBe("Writing down what you said…");
  });

  test("German for a German browser, English otherwise", () => {
    expect(defaultVoiceLanguage(["de-CH", "en"])).toBe("de");
    expect(defaultVoiceLanguage(["en-GB", "de"])).toBe("en");
    expect(defaultVoiceLanguage([])).toBe("en");
  });

  test("a transcript comes through with its timings", () => {
    const body = {
      text: "Zeig mir mein Herz.",
      language: "de" as const,
      timings: { audioMs: 1800, sttMs: 640, totalMs: 702 },
    };
    expect(transcribeOutcome(200, body)).toEqual({ ok: true, heard: body });
    expect(heardLine(body)).toBe(
      "Heard 1.8s of German, written down in 0.6s (0.7s in all).",
    );
  });

  test("a failure is the route's sentence for its code, never its text", () => {
    expect(
      transcribeOutcome(422, { code: "SPEECH_NOTHING_HEARD", error: "anything" }),
    ).toEqual({
      ok: false,
      message: "Nothing was heard. Hold the button while you speak.",
    });
    expect(transcribeOutcome(500, { code: "Error: ECONNRESET at socket" })).toEqual({
      ok: false,
      message: "The voice service could not handle that. Try again.",
    });
    expect(transcribeOutcome(0, null)).toEqual({
      ok: false,
      message: "The voice service could not handle that. Try again.",
    });
  });

  test("an empty transcript is not sent", () => {
    expect(
      transcribeOutcome(200, {
        text: "",
        language: "en",
        timings: { audioMs: 1, sttMs: 1, totalMs: 1 },
      }).ok,
    ).toBe(false);
  });

  test("an answer read aloud says how long until it was heard", () => {
    expect(firstWordsLine(420)).toBe("First words after 0.4s");
    expect(firstWordsLine(1250)).toBe("First words after 1.2s");
  });

  const fakeRecording = (log: string[]): Recording => ({
    stop: () => Promise.resolve(null),
    cancel: () => log.push("cancelled"),
  });

  test("a hold finishes on its own at the limit", async () => {
    const log: string[] = [];
    startHold(
      () => Promise.resolve(fakeRecording(log)),
      () => log.push("limit"),
      10,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual(["limit"]);
  });

  test("letting go in time stops the limit", async () => {
    const log: string[] = [];
    const hold = startHold(
      () => Promise.resolve(fakeRecording(log)),
      () => log.push("limit"),
      10,
    );
    hold.clearLimit();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual([]);
  });

  test("a cancelled hold lets go of the microphone and never fires", async () => {
    const log: string[] = [];
    const hold = startHold(
      () => Promise.resolve(fakeRecording(log)),
      () => log.push("limit"),
      10,
    );
    hold.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual(["cancelled"]);
  });
});
