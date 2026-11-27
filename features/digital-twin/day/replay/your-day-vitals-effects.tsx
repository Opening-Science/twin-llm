"use client";

import { useCallback } from "react";

import { type StandaloneAtlasEffects } from "../../anatomy/anatomy-layers";
import {
  GlucoseParticles,
  type GlucoseParticlesModel,
} from "../../anatomy/glucose-particles";
import { REGULAR_PATTERN } from "../../live/heart-cycle";
import { LiveConditioning } from "../../live/live-conditioning";
import { NO_LIVE_VITALS } from "../../live/live-rates";

const CHAMBERS = { on: true, pattern: REGULAR_PATTERN };
const ignoreStatus = () => undefined;

export function YourDayVitalsEffects({
  atlas,
  playing,
  reducedMotion,
  bpm,
  glucose,
}: StandaloneAtlasEffects &
  Readonly<{
    playing: boolean;
    reducedMotion: boolean;
    bpm: number | null;
    glucose: GlucoseParticlesModel | null;
  }>) {
  const activeBpm = playing && !reducedMotion ? bpm : null;
  const vesselsVisible = useCallback(
    () =>
      atlas.parts.some(({ system, mesh }) => system === "cardiovascular" && mesh.visible),
    [atlas],
  );
  return (
    <>
      <LiveConditioning
        enabled={activeBpm !== null}
        vitals={NO_LIVE_VITALS}
        heartBpm={activeBpm}
        scheme="bodyparts3d"
        parts={atlas.parts}
        root={atlas.root}
        chambers={CHAMBERS}
        onStatus={ignoreStatus}
      />
      {glucose && (
        <GlucoseParticles
          model={glucose}
          playing={playing}
          presentation="replay-markers"
          reducedMotion={reducedMotion}
          vesselsVisible={vesselsVisible}
        />
      )}
    </>
  );
}
