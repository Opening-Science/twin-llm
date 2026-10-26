"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";

import {
  advanceBeat,
  type BeatClock,
  beatInterval,
  cardiacStateAt,
  type CardiacState,
  cardiacTiming,
} from "./cardiac-cycle";
import {
  HEART_CAVEAT,
  HEART_FLOW_TOGGLE,
  HEART_PHASE,
  HEART_STEADY,
  HEART_TITLE,
  heartHrvLine,
  heartRateLine,
} from "./live-copy";
import { type HrvBelowUsual, type LiveRate } from "./live-rates";

/**
 * A schematic four-chamber heart beside the 3D view. The atlas hearts are one
 * mesh each (HRA `#VHFHeartV1.1` / `#VHMHeart`, BodyParts3D inside the whole
 * cardiovascular system), so their chambers cannot move on their own; this
 * drawing can. It is plain SVG, redrawn once per animation frame, and runs
 * only while mounted (Live vitals on, which is never with reduced motion).
 * The viewer's left is the subject's right, as in every anatomy figure.
 */

type Frame = Readonly<{ clock: BeatClock; travel: readonly number[] }>;

/** Relaxed in mid-diastole: where the drawing starts, and what reduced motion shows. */
const STILL_CLOCK: BeatClock = { beat: 0, phase: 0.8 };
/** Chamber shrink at full contraction. */
const SQUEEZE = { atria: 0.2, ventricles: 0.16 } as const;
/** Valve lengths of travel per second when fully open. */
const FLOW_SPEED = 1.6;
const DOTS = 5;

type Valve = Readonly<{
  key: string;
  x: number;
  y: number;
  /** Flow direction: +1 down (atrium → ventricle), -1 up (ventricle → artery). */
  dir: 1 | -1;
  kind: "av" | "semilunar";
  side: "right" | "left";
  from: readonly [number, number];
  to: readonly [number, number];
}>;

const VALVES: readonly Valve[] = [
  {
    key: "tricuspid",
    x: 52,
    y: 96,
    dir: 1,
    kind: "av",
    side: "right",
    from: [50, 64],
    to: [56, 140],
  },
  {
    key: "mitral",
    x: 148,
    y: 96,
    dir: 1,
    kind: "av",
    side: "left",
    from: [150, 64],
    to: [144, 140],
  },
  {
    key: "pulmonary",
    x: 88,
    y: 100,
    dir: -1,
    kind: "semilunar",
    side: "right",
    from: [88, 130],
    to: [88, 12],
  },
  {
    key: "aortic",
    x: 112,
    y: 100,
    dir: -1,
    kind: "semilunar",
    side: "left",
    from: [112, 130],
    to: [112, 12],
  },
];

const LEAF = 9;

/** Two leaflets hinged at the valve ring, swinging up to 75° in the flow direction. */
const leaflets = (valve: Valve, open: number): string => {
  const angle = (open * 75 * Math.PI) / 180;
  const dx = LEAF * Math.cos(angle);
  const dy = LEAF * Math.sin(angle) * valve.dir;
  const left = valve.x - LEAF;
  const right = valve.x + LEAF;
  return `M${left},${valve.y} l${dx},${dy} M${right},${valve.y} l${-dx},${dy}`;
};

const opening = (state: CardiacState, valve: Valve): number =>
  valve.kind === "av" ? state.av : state.semilunar;

/** A chamber scaled about its own centre by its contraction. */
const chamber = (cx: number, cy: number, squeeze: number): string =>
  `translate(${cx} ${cy}) scale(${1 - squeeze}) translate(${-cx} ${-cy})`;

const TRAVEL_START: readonly number[] = VALVES.map(() => 0);

export const HeartInset = ({
  rate,
  hrv,
  reducedMotion,
}: Readonly<{
  rate: LiveRate;
  hrv: HrvBelowUsual | null;
  reducedMotion: boolean;
}>) => {
  const [frame, setFrame] = useState<Frame>({ clock: STILL_CLOCK, travel: TRAVEL_START });
  const [flow, setFlow] = useState(true);
  const inputs = useRef({ bpm: rate.perMinute, rmssd: hrv?.latest ?? null });
  useEffect(() => {
    inputs.current = { bpm: rate.perMinute, rmssd: hrv?.latest ?? null };
  });

  useEffect(() => {
    if (reducedMotion) return;
    let last = performance.now();
    let handle = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { bpm, rmssd } = inputs.current;
      setFrame((before) => {
        const clock = advanceBeat(before.clock, dt, bpm, rmssd);
        const state = cardiacStateAt(
          clock.phase,
          cardiacTiming(beatInterval(clock.beat, bpm, rmssd)),
        );
        const travel = VALVES.map(
          (valve, i) =>
            ((before.travel[i] ?? 0) +
              opening(state, valve) * FLOW_SPEED * Math.min(dt, 0.1)) %
            1,
        );
        return { clock, travel };
      });
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [reducedMotion]);

  const clock = reducedMotion ? STILL_CLOCK : frame.clock;
  const state = cardiacStateAt(
    clock.phase,
    cardiacTiming(beatInterval(clock.beat, rate.perMinute, hrv?.latest ?? null)),
  );
  const atria = state.atria * SQUEEZE.atria;
  const ventricles = state.ventricles * SQUEEZE.ventricles;

  return (
    <section className="twin-heart" aria-label={HEART_TITLE}>
      <div className="twin-heart-head">
        <h3>{HEART_TITLE}</h3>
        {reducedMotion ? null : (
          <Button
            variant="pill"
            size="sm"
            aria-pressed={flow}
            onClick={() => setFlow((on) => !on)}
          >
            {HEART_FLOW_TOGGLE}
          </Button>
        )}
      </div>
      <svg viewBox="0 0 200 180" role="img" aria-label={HEART_PHASE[state.phase]}>
        {/* Great arteries: pulmonary trunk from the right ventricle, aorta from the left. */}
        <rect
          className="twin-heart-right twin-heart-vessel"
          x="81"
          y="6"
          width="14"
          height="94"
          rx="6"
        />
        <rect
          className="twin-heart-left twin-heart-vessel"
          x="105"
          y="6"
          width="14"
          height="94"
          rx="6"
        />
        <g transform={chamber(50, 62, atria)}>
          <rect
            className="twin-heart-right"
            x="18"
            y="34"
            width="64"
            height="58"
            rx="22"
          />
          <text x="50" y="66">
            RA
          </text>
        </g>
        <g transform={chamber(150, 62, atria)}>
          <rect
            className="twin-heart-left"
            x="118"
            y="34"
            width="64"
            height="58"
            rx="22"
          />
          <text x="150" y="66">
            LA
          </text>
        </g>
        <g transform={chamber(60, 136, ventricles)}>
          <path
            className="twin-heart-right"
            d="M18,104 H98 V150 Q84,176 56,174 Q24,170 18,140 Z"
          />
          <text x="56" y="142">
            RV
          </text>
        </g>
        <g transform={chamber(140, 136, ventricles)}>
          <path
            className="twin-heart-left"
            d="M102,104 H182 V140 Q176,170 144,174 Q116,176 102,150 Z"
          />
          <text x="144" y="142">
            LV
          </text>
        </g>
        {VALVES.map((valve) => (
          <path
            key={valve.key}
            className="twin-heart-valve"
            d={leaflets(valve, opening(state, valve))}
          />
        ))}
        {flow && !reducedMotion
          ? VALVES.flatMap((valve, i) => {
              const open = opening(state, valve);
              if (open === 0) return [];
              return Array.from({ length: DOTS }, (_, k) => {
                const along = (k / DOTS + (frame.travel[i] ?? 0)) % 1;
                return (
                  <circle
                    key={`${valve.key}-${k}`}
                    className={`twin-heart-dot twin-heart-dot-${valve.side}`}
                    cx={valve.from[0] + (valve.to[0] - valve.from[0]) * along}
                    cy={valve.from[1] + (valve.to[1] - valve.from[1]) * along}
                    r="2.4"
                    opacity={open}
                  />
                );
              });
            })
          : null}
      </svg>
      <p className="twin-heart-phase">{HEART_PHASE[state.phase]}</p>
      <p>{heartRateLine(rate)}</p>
      <p>{hrv ? heartHrvLine(hrv) : HEART_STEADY}</p>
      <p>{HEART_CAVEAT}</p>
    </section>
  );
};
