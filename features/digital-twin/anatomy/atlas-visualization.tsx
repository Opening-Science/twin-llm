"use client";

import { type ComponentProps } from "react";

import { type AtlasId, ATLASES } from "@/packages/anatomy/manifest";

import { LiveConditioning } from "../live/live-conditioning";
import { glucoseUnavailable } from "./glucose-flow";
import { GlucoseParticles, type GlucoseParticlesModel } from "./glucose-particles";
import { type PreparedAtlas } from "./prepare-atlas";

type HeartRateModel = Pick<
  ComponentProps<typeof LiveConditioning>,
  "enabled" | "vitals" | "heartBpm" | "chambers" | "onStatus"
>;

export type AtlasVisualization =
  | Readonly<{ kind: "hr"; model: HeartRateModel }>
  | Readonly<{ kind: "glucose"; model: GlucoseParticlesModel }>;

export const resolveAtlasVisualization = (
  visualization: AtlasVisualization | null,
  context: Readonly<{ atlasId: AtlasId; fitted: boolean; moving: boolean }>,
): Readonly<{
  effect: AtlasVisualization;
  focus: "heart" | null;
}> | null => {
  if (visualization === null) return null;
  switch (visualization.kind) {
    case "hr":
      return { effect: visualization, focus: "heart" };
    case "glucose":
      return glucoseUnavailable(context.atlasId, context.fitted, context.moving) === null
        ? { effect: visualization, focus: "heart" }
        : null;
  }
};

/** Rendered inside the atlas placement group so effects share its coordinates. */
export const AtlasVisualizationEffect = ({
  visualization,
  atlasId,
  atlas,
  reducedMotion,
  vesselsVisible,
}: Readonly<{
  visualization: AtlasVisualization;
  atlasId: AtlasId;
  atlas: Pick<PreparedAtlas, "parts" | "root">;
  reducedMotion: boolean;
  vesselsVisible: () => boolean;
}>) => {
  switch (visualization.kind) {
    case "hr":
      return (
        <LiveConditioning
          {...visualization.model}
          scheme={ATLASES[atlasId].scheme}
          parts={atlas.parts}
          root={atlas.root}
        />
      );
    case "glucose":
      return (
        <GlucoseParticles
          model={visualization.model}
          reducedMotion={reducedMotion}
          vesselsVisible={vesselsVisible}
        />
      );
  }
};
