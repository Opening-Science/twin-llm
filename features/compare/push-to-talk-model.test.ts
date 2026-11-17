import { describe, expect, test } from "bun:test";

import {
  defaultVoiceLanguage,
  heardLine,
  pushToTalkLabel,
  transcribeOutcome,
} from "./push-to-talk-model";

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
});
