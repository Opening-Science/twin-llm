import { describe, expect, test } from "bun:test";

import { FITTED_ATLAS_IDS, type FittedAtlasId } from "@/packages/anatomy/fitted-atlases";
import { DEMO_STANCE } from "@/packages/anatomy/stance";

import { anatomyReducer, initialAnatomyState } from "./anatomy-state";
import {
  demoStanceFor,
  fittedAvailable,
  fittedShown,
  parseFittedDefault,
  parseFittedStatus,
  type FittedContext,
  type FittedInstalled,
} from "./fitted-option";

const only = (...ids: FittedAtlasId[]): FittedInstalled =>
  Object.fromEntries(FITTED_ATLAS_IDS.map((id) => [id, ids.includes(id)])) as Record<
    FittedAtlasId,
    boolean
  >;

const context = (overrides: Partial<FittedContext> = {}): FittedContext => ({
  bodyId: "anny-adult-f",
  rigged: true,
  atlasId: "hra-f",
  installed: only("anny-adult-f.hra-f"),
  ...overrides,
});

describe("fittedAvailable", () => {
  test("only for a rigged demo body whose fitted file for this atlas is made here", () => {
    expect(fittedAvailable(context())).toBe(true);
    expect(fittedAvailable(context({ atlasId: "hra-m" }))).toBe(false);
    expect(fittedAvailable(context({ bodyId: "anny-adult-m" }))).toBe(false);
    expect(fittedAvailable(context({ rigged: false }))).toBe(false);
    expect(fittedAvailable(context({ bodyId: null }))).toBe(false);
    expect(fittedAvailable(context({ installed: null }))).toBe(false);
    expect(fittedAvailable(context({ installed: only() }))).toBe(false);
  });
});

describe("fittedShown", () => {
  test("is off by default and on only when ticked and available", () => {
    expect(initialAnatomyState.fitAtlas).toBe(false);
    expect(fittedShown(initialAnatomyState.fitAtlas, context())).toBe(false);
    expect(fittedShown(true, context())).toBe(true);
    // Ticked, but another atlas without a fitted file: the usual fit, no error.
    expect(fittedShown(true, context({ atlasId: "bodyparts3d" }))).toBe(false);
  });
});

describe("demoStanceFor", () => {
  test("the stance is 0° while the fitted atlas shows: it was fitted unposed", () => {
    expect(demoStanceFor("anny-adult-m", "bodyparts3d", true)).toEqual({
      hipAdductionDeg: 0,
    });
    expect(demoStanceFor("anny-adult-f", "hra-m", true).hipAdductionDeg).toBe(0);
  });

  test("otherwise the #518 stance for the atlas", () => {
    expect(demoStanceFor("anny-adult-m", "bodyparts3d", false)).toBe(
      DEMO_STANCE["anny-adult-m"].bodyparts3d,
    );
    expect(demoStanceFor("anny-adult-f", "hra-m", false).hipAdductionDeg).toBe(-1.8);
  });
});

describe("the status", () => {
  test("lists the fitted files made here; anything odd counts as none", () => {
    expect(
      parseFittedStatus({
        fittedAtlases: [
          { id: "anny-adult-m.hra-m", installed: true },
          { id: "anny-adult-f.hra-f", installed: "yes" },
          { id: "../etc", installed: true },
          null,
        ],
      }),
    ).toEqual(only("anny-adult-m.hra-m"));
    expect(parseFittedStatus(null)).toEqual(only());
    expect(parseFittedStatus({ atlases: [] })).toEqual(only());
  });

  test("the toggle starts on only when the status says true", () => {
    expect(parseFittedDefault({ fittedAtlasOn: true })).toBe(true);
    expect(parseFittedDefault({ fittedAtlasOn: "true" })).toBe(false);
    expect(parseFittedDefault({})).toBe(false);
    expect(parseFittedDefault(null)).toBe(false);
  });
});

describe("the fitAtlas action", () => {
  test("ticks and unticks without touching depth, atlas or highlight", () => {
    const before = {
      ...initialAnatomyState,
      targetDepth: 2,
      atlasId: "hra-f" as const,
      highlight: { kind: "groups" as const, ids: ["liver"] },
    };
    const on = anatomyReducer(before, { type: "fitAtlas", on: true });
    expect(on).toEqual({ ...before, fitAtlas: true });
    expect(anatomyReducer(on, { type: "fitAtlas", on: true })).toBe(on);
    expect(anatomyReducer(on, { type: "fitAtlas", on: false }).fitAtlas).toBe(false);
  });
});
