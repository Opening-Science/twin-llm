import { describe, expect, test } from "bun:test";

import {
  frameFooterMarkdown,
  frameHeaderMarkdown,
  frameSourceLine,
  type GbdProfileFrame,
  profileFrameOf,
} from "./gbd-profile-frame";

const FRAME: GbdProfileFrame = {
  title: "Location profile: Switzerland, 2023",
  source: "IHME GBD 2023",
  importedOn: "2026-11-01",
  attribution: "Population estimate (IHME GBD 2023), not a statement about this person.",
  citation: "A made-up citation.",
};

describe("profileFrameOf (#417)", () => {
  test("reads the frame of a finished gbd_profile part", () => {
    expect(
      profileFrameOf([
        { type: "text" },
        { type: "tool-gbd_estimate", state: "output-available", output: { rows: [] } },
        {
          type: "tool-gbd_profile",
          state: "output-available",
          output: { sections: [], views: [], frame: FRAME },
        },
      ]),
    ).toEqual(FRAME);
  });

  test("none while the call runs, for a refusal, another tool or a bad frame", () => {
    expect(
      profileFrameOf([
        { type: "tool-gbd_profile", state: "input-available" },
        {
          type: "tool-gbd_profile",
          state: "output-available",
          output: { code: "GBD_UNKNOWN_LOCATION" },
        },
        { type: "tool-show_view", state: "output-available", output: { frame: FRAME } },
        {
          type: "tool-gbd_profile",
          state: "output-available",
          output: { frame: { ...FRAME, title: "" } },
        },
      ]),
    ).toBeNull();
  });
});

describe("the frame's lines", () => {
  test("say the import day, or that it is not recorded", () => {
    expect(frameSourceLine(FRAME)).toBe("Source: IHME GBD 2023, imported 2026-11-01.");
    expect(frameSourceLine({ ...FRAME, importedOn: null })).toBe(
      "Source: IHME GBD 2023, import date not recorded.",
    );
  });

  test("as Markdown: title and source above, attribution and citation below", () => {
    expect(frameHeaderMarkdown(FRAME)).toEqual([
      "**Location profile: Switzerland, 2023**",
      "",
      "_Source: IHME GBD 2023, imported 2026-11-01._",
      "",
    ]);
    expect(frameFooterMarkdown(FRAME)).toEqual([
      "",
      "_Population estimate (IHME GBD 2023), not a statement about this person._",
      "",
      "Citation: A made-up citation.",
    ]);
  });
});
