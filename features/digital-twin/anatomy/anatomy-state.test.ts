import { describe, expect, test } from "bun:test";

import {
  anatomyReducer,
  initialAnatomyState,
  preferredAtlas,
  type AnatomyState,
} from "./anatomy-state";
import { parseAnatomyStatus, parseRiggedStatus } from "./use-anatomy-view";

const run = (state: AnatomyState, ...actions: Parameters<typeof anatomyReducer>[1][]) =>
  actions.reduce(anatomyReducer, state);

describe("anatomyReducer", () => {
  test("starts on the scan with nothing requested", () => {
    expect(initialAnatomyState.targetDepth).toBe(0);
    expect(initialAnatomyState.requested).toBe(false);
    expect(initialAnatomyState.atlasId).toBe("bodyparts3d");
  });

  test("sliding past the scan latches the request, sliding back keeps it", () => {
    const state = run(
      initialAnatomyState,
      { type: "depth", depth: 1.4 },
      { type: "depth", depth: 0 },
    );
    expect(state.requested).toBe(true);
    expect(state.targetDepth).toBe(0);
  });

  test("depth is clamped and release snaps to a nearby stop", () => {
    expect(run(initialAnatomyState, { type: "depth", depth: 9 }).targetDepth).toBe(3);
    expect(
      run(initialAnatomyState, { type: "depth", depth: 1.9 }, { type: "release" })
        .targetDepth,
    ).toBe(2);
    expect(
      run(initialAnatomyState, { type: "depth", depth: 1.5 }, { type: "release" })
        .targetDepth,
    ).toBe(1.5);
  });

  test("step moves between stops", () => {
    const state = run(
      initialAnatomyState,
      { type: "step", direction: 1 },
      { type: "step", direction: 1 },
    );
    expect(state.targetDepth).toBe(2);
    expect(run(state, { type: "step", direction: -1 }).targetDepth).toBe(1);
  });

  test("toggling a layer flips only that layer and does not start a load", () => {
    const state = run(initialAnatomyState, { type: "toggleLayer", layer: "muscle" });
    expect(state.requested).toBe(false);
    expect(state.layers).toEqual({ muscle: false, skeleton: true, organs: true });
  });

  test("system chips toggle in and out of the hidden list", () => {
    const hidden = run(
      initialAnatomyState,
      { type: "toggleSystem", system: "nervous" },
      { type: "toggleSystem", system: "digestive" },
      { type: "toggleSystem", system: "nervous" },
    );
    expect(hidden.hiddenSystems).toEqual(["digestive"]);
  });

  test("switching atlas resets load and system filters; same atlas is a no-op", () => {
    const loaded = run(
      initialAnatomyState,
      { type: "toggleSystem", system: "nervous" },
      { type: "highlight", highlight: { kind: "groups", ids: ["brain"] } },
      {
        type: "load",
        load: {
          kind: "ready",
          presentLayers: ["organs"],
          systems: ["nervous"],
          partSystems: ["nervous"],
          groups: [{ key: "brain", label: "Brain" }],
          parts: [{ layer: "organs", system: "nervous", group: "brain" }],
          anchor: "hips",
          fitOk: true,
        },
      },
    );
    expect(anatomyReducer(loaded, { type: "atlas", atlasId: "bodyparts3d" })).toBe(
      loaded,
    );
    const switched = anatomyReducer(loaded, { type: "atlas", atlasId: "hra-f" });
    expect(switched.atlasId).toBe("hra-f");
    expect(switched.hiddenSystems).toEqual([]);
    expect(switched.highlight).toBeNull();
    expect(switched.load).toEqual({ kind: "idle" });
  });

  test("highlight is set, replaced and cleared; depth and retry keep it", () => {
    expect(initialAnatomyState.highlight).toBeNull();
    const lit = run(
      initialAnatomyState,
      { type: "highlight", highlight: { kind: "groups", ids: ["liver"] } },
      { type: "highlight", highlight: { kind: "system", ids: ["musculoskeletal"] } },
      { type: "depth", depth: 2 },
      { type: "load", load: { kind: "error" } },
      { type: "retry" },
    );
    expect(lit.highlight).toEqual({ kind: "system", ids: ["musculoskeletal"] });
    expect(run(lit, { type: "highlight", highlight: null }).highlight).toBeNull();
  });

  test("a row's highlight remembers the row until another highlight replaces it", () => {
    const from = {
      id: "bm:BM-123",
      label: "From biomarker: Gamma-GT (GGT)",
      highlights: {
        hra: { kind: "groups", ids: ["liver", "gallbladder"] },
        bodyparts3d: { kind: "system", ids: ["metabolic"] },
      },
    } as const;
    const lit = run(initialAnatomyState, {
      type: "highlight",
      highlight: from.highlights.bodyparts3d,
      from,
    });
    expect(lit.highlightFrom).toEqual(from);
    expect(run(lit, { type: "depth", depth: 3 }).highlightFrom).toEqual(from);
    // A row that lights nothing (no single body location) still counts as selected.
    const ferritin = {
      id: "bm:BM-107",
      label: "From biomarker: Ferritin",
      highlights: { hra: null, bodyparts3d: null },
    };
    expect(
      run(lit, { type: "highlight", highlight: null, from: ferritin }),
    ).toMatchObject({
      highlight: null,
      highlightFrom: ferritin,
    });
    expect(
      run(lit, { type: "highlight", highlight: { kind: "groups", ids: ["liver"] } })
        .highlightFrom,
    ).toBeNull();
  });

  test("an atlas switch lights the same row on the new atlas; a picked highlight goes", () => {
    const from = {
      id: "bm:BM-123",
      label: "From biomarker: Gamma-GT (GGT)",
      highlights: {
        hra: { kind: "groups", ids: ["liver", "gallbladder"] },
        bodyparts3d: { kind: "system", ids: ["metabolic"] },
      },
    } as const;
    const lit = run(initialAnatomyState, {
      type: "highlight",
      highlight: from.highlights.bodyparts3d,
      from,
    });
    const onHra = run(lit, { type: "atlas", atlasId: "hra-m" });
    expect([onHra.highlight, onHra.highlightFrom]).toEqual([from.highlights.hra, from]);
    const back = run(onHra, { type: "atlas", atlasId: "bodyparts3d" });
    expect(back.highlight).toEqual(from.highlights.bodyparts3d);
    const picked = run(initialAnatomyState, {
      type: "highlight",
      highlight: { kind: "system", ids: ["metabolic"] },
    });
    const switched = run(picked, { type: "atlas", atlasId: "hra-f" });
    expect([switched.highlight, switched.highlightFrom]).toEqual([null, null]);
  });

  test("retry clears the error and bumps the counter", () => {
    const state = run(
      initialAnatomyState,
      { type: "load", load: { kind: "error" } },
      { type: "retry" },
    );
    expect(state.load).toEqual({ kind: "idle" });
    expect(state.retry).toBe(1);
  });
});

describe("parseAnatomyStatus", () => {
  test("maps the status body and ignores unknown or malformed rows", () => {
    expect(
      parseAnatomyStatus({
        atlases: [
          { id: "bodyparts3d", installed: true },
          { id: "hra-f", installed: false },
          { id: "z-anatomy", installed: true },
          "junk",
        ],
      }),
    ).toEqual({ bodyparts3d: true, "hra-f": false, "hra-m": false });
  });

  test("returns null for a body that is not a status", () => {
    expect(parseAnatomyStatus(null)).toBeNull();
    expect(parseAnatomyStatus({ error: "nope" })).toBeNull();
  });
});

describe("parseRiggedStatus", () => {
  test("maps installed rigged bodies and treats anything else as not baked", () => {
    expect(
      parseRiggedStatus({
        riggedBodies: [
          { id: "anny-adult-f", installed: true },
          { id: "anny-child", installed: true },
          "junk",
        ],
      }),
    ).toEqual({ "anny-adult-m": false, "anny-adult-f": true });
    expect(parseRiggedStatus({ atlases: [] })).toEqual({
      "anny-adult-m": false,
      "anny-adult-f": false,
    });
    expect(parseRiggedStatus(null)).toEqual({
      "anny-adult-m": false,
      "anny-adult-f": false,
    });
  });
});

describe("preferredAtlas", () => {
  test("keeps an installed atlas and falls back to the first installed one", () => {
    expect(
      preferredAtlas("bodyparts3d", { bodyparts3d: true, "hra-f": true, "hra-m": true }),
    ).toBe("bodyparts3d");
    expect(
      preferredAtlas("bodyparts3d", {
        bodyparts3d: false,
        "hra-f": false,
        "hra-m": true,
      }),
    ).toBe("hra-m");
    expect(
      preferredAtlas("bodyparts3d", {
        bodyparts3d: false,
        "hra-f": false,
        "hra-m": false,
      }),
    ).toBe("bodyparts3d");
    expect(preferredAtlas("hra-f", null)).toBe("hra-f");
  });
});

describe("installed status", () => {
  const ALL = { bodyparts3d: true, "hra-f": true, "hra-m": true } as const;

  test("keeps a choice made before the status arrived", () => {
    const picked = run(initialAnatomyState, { type: "atlas", atlasId: "hra-f" });
    expect(run(picked, { type: "installed", installed: ALL }).atlasId).toBe("hra-f");
  });

  test("moves to an installed atlas when the current one is missing", () => {
    const state = run(initialAnatomyState, {
      type: "installed",
      installed: { bodyparts3d: false, "hra-f": false, "hra-m": true },
    });
    expect(state.atlasId).toBe("hra-m");
    expect(state.load).toEqual({ kind: "idle" });
  });

  test("an unknown status changes nothing", () => {
    expect(run(initialAnatomyState, { type: "installed", installed: null })).toBe(
      initialAnatomyState,
    );
  });
});
