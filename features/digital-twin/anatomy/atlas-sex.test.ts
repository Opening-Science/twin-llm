import { describe, expect, test } from "bun:test";

import { type AtlasId } from "@/packages/anatomy/manifest";

import {
  FEMALE_ATLAS_ON_MALE,
  MALE_ATLAS_ON_FEMALE,
  NO_FEMALE_ATLAS,
} from "./anatomy-copy";
import { anatomyReducer, initialAnatomyState, type AnatomyAction } from "./anatomy-state";
import { atlasForBody, atlasSexNote, bodySexOf } from "./atlas-sex";

const ALL: Readonly<Record<AtlasId, boolean>> = {
  bodyparts3d: true,
  "hra-f": true,
  "hra-m": true,
};
const NO_FEMALE: Readonly<Record<AtlasId, boolean>> = { ...ALL, "hra-f": false };

describe("bodySexOf", () => {
  test("only female and male choose an atlas", () => {
    expect(["female", "male", "other", "unknown", null, 1].map(bodySexOf)).toEqual([
      "female",
      "male",
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("atlasForBody", () => {
  test("a female body gets the female atlas", () => {
    expect(atlasForBody("female", "bodyparts3d", ALL)).toBe("hra-f");
    expect(atlasForBody("female", "bodyparts3d", null)).toBe("hra-f");
  });

  test("a male body keeps a male atlas, or leaves the female one for the first male", () => {
    expect(atlasForBody("male", "bodyparts3d", ALL)).toBe("bodyparts3d");
    expect(atlasForBody("male", "hra-m", ALL)).toBe("hra-m");
    expect(atlasForBody("male", "hra-f", ALL)).toBe("bodyparts3d");
  });

  test("without the female atlas a female body falls back to an installed one", () => {
    expect(atlasForBody("female", "bodyparts3d", NO_FEMALE)).toBe("bodyparts3d");
    expect(
      atlasForBody("female", "hra-f", {
        bodyparts3d: false,
        "hra-f": false,
        "hra-m": true,
      }),
    ).toBe("hra-m");
  });

  test("a body of unknown sex keeps the chosen atlas while it is installed", () => {
    expect(atlasForBody(null, "hra-f", ALL)).toBe("hra-f");
    expect(atlasForBody(null, "hra-f", NO_FEMALE)).toBe("bodyparts3d");
  });
});

describe("atlasSexNote", () => {
  test("says when the donor and the body differ, and why", () => {
    expect(atlasSexNote("female", "bodyparts3d", ALL)).toBe(MALE_ATLAS_ON_FEMALE);
    expect(atlasSexNote("female", "hra-m", NO_FEMALE)).toBe(NO_FEMALE_ATLAS);
    expect(atlasSexNote("male", "hra-f", ALL)).toBe(FEMALE_ATLAS_ON_MALE);
  });

  test("silent when they match or the body's sex is unknown", () => {
    expect(atlasSexNote("female", "hra-f", ALL)).toBeNull();
    expect(atlasSexNote("male", "bodyparts3d", ALL)).toBeNull();
    expect(atlasSexNote(null, "bodyparts3d", ALL)).toBeNull();
  });

  test("the female-missing line names the cause in plain words", () => {
    expect(NO_FEMALE_ATLAS).toBe(
      "Male reference anatomy shown: the female atlas is not available here.",
    );
  });
});

describe("anatomyReducer: the atlas follows the body", () => {
  const run = (...actions: readonly AnatomyAction[]) =>
    actions.reduce(anatomyReducer, initialAnatomyState);

  test("a female body switches to HRA female, before or after the install status", () => {
    expect(run({ type: "bodySex", sex: "female" }).atlasId).toBe("hra-f");
    expect(
      run({ type: "installed", installed: ALL }, { type: "bodySex", sex: "female" })
        .atlasId,
    ).toBe("hra-f");
    expect(
      run({ type: "bodySex", sex: "female" }, { type: "installed", installed: ALL })
        .atlasId,
    ).toBe("hra-f");
  });

  test("a female body with no female atlas installed shows a male one", () => {
    const state = run(
      { type: "installed", installed: NO_FEMALE },
      { type: "bodySex", sex: "female" },
    );
    expect(state.atlasId).toBe("bodyparts3d");
    expect(atlasSexNote(state.bodySex, state.atlasId, state.installed)).toBe(
      NO_FEMALE_ATLAS,
    );
  });

  test("a hand-picked atlas stays for this body; another body follows its own sex", () => {
    const picked = run(
      { type: "installed", installed: ALL },
      { type: "bodySex", sex: "female" },
      { type: "atlas", atlasId: "bodyparts3d" },
    );
    expect([picked.atlasId, picked.atlasChosen]).toEqual(["bodyparts3d", true]);
    const male = anatomyReducer(picked, { type: "bodySex", sex: "male" });
    expect([male.atlasId, male.atlasChosen]).toEqual(["bodyparts3d", false]);
    const female = anatomyReducer(male, { type: "bodySex", sex: "female" });
    expect(female.atlasId).toBe("hra-f");
  });

  test("the same sex again changes nothing", () => {
    const state = run({ type: "bodySex", sex: "male" });
    expect(anatomyReducer(state, { type: "bodySex", sex: "male" })).toBe(state);
  });
});
