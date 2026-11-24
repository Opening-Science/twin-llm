import { describe, expect, test } from "bun:test";
import { Group } from "three";

import { LiveConditioning } from "../live/live-conditioning";
import { REGULAR_PATTERN } from "../live/heart-cycle";
import { NO_LIVE_VITALS } from "../live/live-rates";
import {
  AtlasVisualizationEffect,
  resolveAtlasVisualization,
  type AtlasVisualization,
} from "./atlas-visualization";
import { GlucoseParticles } from "./glucose-particles";

const HR = {
  kind: "hr",
  model: {
    enabled: true,
    vitals: NO_LIVE_VITALS,
    heartBpm: 70,
    chambers: { on: false, pattern: REGULAR_PATTERN },
    onStatus: () => undefined,
  },
} satisfies AtlasVisualization;

const GLUCOSE = {
  kind: "glucose",
  model: {
    density: 0.5,
    retry: 0,
    status: "idle",
    onStatus: () => undefined,
  },
} satisfies AtlasVisualization;

const CONTEXT = { atlasId: "bodyparts3d", fitted: false, moving: false } as const;

describe("atlas visualization", () => {
  test("no selection restores the default anatomy presentation", () => {
    expect(resolveAtlasVisualization(null, CONTEXT)).toBeNull();
  });

  test("HR remains available across atlas, fit and pose changes", () => {
    for (const atlasId of ["bodyparts3d", "hra-f", "hra-m"] as const) {
      for (const fitted of [false, true]) {
        for (const moving of [false, true]) {
          expect(resolveAtlasVisualization(HR, { atlasId, fitted, moving })).toEqual({
            effect: HR,
            focus: "heart",
          });
        }
      }
    }
  });

  test("glucose focus and renderer are enabled only on the original standing atlas", () => {
    expect(resolveAtlasVisualization(GLUCOSE, CONTEXT)).toEqual({
      effect: GLUCOSE,
      focus: "heart",
    });
    for (const context of [
      { ...CONTEXT, fitted: true },
      { ...CONTEXT, moving: true },
      { ...CONTEXT, atlasId: "hra-f" as const },
      { ...CONTEXT, atlasId: "hra-m" as const },
    ]) {
      expect(resolveAtlasVisualization(GLUCOSE, context)).toBeNull();
    }
  });

  test("dispatches HR with its original readings, animation rate and status callback", () => {
    const root = new Group();
    const context = {
      atlasId: "bodyparts3d",
      atlas: { root, parts: [] },
      reducedMotion: false,
      vesselsVisible: () => true,
    } satisfies Omit<Parameters<typeof AtlasVisualizationEffect>[0], "visualization">;
    const effect = AtlasVisualizationEffect({
      ...context,
      visualization: HR,
    });
    expect(effect.type).toBe(LiveConditioning);
    expect(effect.props).toMatchObject({
      ...HR.model,
      scheme: "bodyparts3d",
      root,
      parts: context.atlas.parts,
    });
  });

  test("dispatches particles with their model, reduced motion and visibility inputs", () => {
    const vesselsVisible = () => false;
    const effect = AtlasVisualizationEffect({
      visualization: GLUCOSE,
      atlasId: "bodyparts3d",
      atlas: { root: new Group(), parts: [] },
      reducedMotion: true,
      vesselsVisible,
    });
    expect(effect.type).toBe(GlucoseParticles);
    expect(effect.props).toEqual({
      model: GLUCOSE.model,
      reducedMotion: true,
      vesselsVisible,
    });
  });
});
