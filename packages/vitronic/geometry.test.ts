import { describe, expect, test } from "bun:test";

import {
  buildStoredGeometry,
  groupFromPath,
  jsonHasGeometry,
  markerSourceFromType,
} from "./geometry";
import { UNIT_M, UNIT_RAD } from "./summary";

/** BodyLoop-shaped fixture. Invented numbers; not a person's scan. */
const BODYLOOP_SHAPED = {
  marker: [
    {
      marker_type: "AutoMarker",
      marker_path: "head.vertex",
      label: "Vertex",
      position: [0, 0.02, 1.57],
    },
    {
      marker_type: "PalpationMarker",
      marker_path: "torso.acromion_r",
      label: "Acromion R",
      position: [0.18, 0.04, 1.32],
    },
    {
      marker_type: "CustomMarker",
      marker_path: "leg.malleolus_r",
      label: "Malleolus R",
      position: [0.08, 0.03, 0.08],
    },
  ],
  height: [
    {
      height_path: "head.vertex",
      at_marker: "head.vertex",
      height: 1.57,
      label: "Stature",
      details: {
        at_marker: {
          marker_type: "AutoMarker",
          marker_path: "head.vertex",
          position: [0, 0.02, 1.57],
        },
      },
    },
  ],
  distance: [
    {
      distance_path: "arm.span",
      from_marker: "torso.acromion_r",
      to_marker: "leg.malleolus_r",
      distances: { linear_distance: 0.425 },
      label: "Span",
      details: {
        from_marker: {
          marker_type: "PalpationMarker",
          marker_path: "torso.acromion_r",
          position: [0.18, 0.04, 1.32],
        },
        to_marker: {
          marker_type: "CustomMarker",
          marker_path: "leg.malleolus_r",
          position: [0.08, 0.03, 0.08],
        },
      },
    },
  ],
  cross_section: [
    {
      crosssection_path: "torso.waist",
      at_marker: "torso.acromion_r",
      circumferences: { convex_circumference: 0.742 },
      label: "Waist",
      contours: { convex: [[0.1, 0, 0.9], [0, 0.1, 0.9], [-0.1, 0, 0.9]] },
    },
  ],
  angle: [
    {
      angle_path: "leg.knee",
      at_marker: "torso.acromion_r",
      from_marker: "head.vertex",
      to_marker: "leg.malleolus_r",
      angles: { primary: 0.218 },
      label: "Knee",
    },
  ],
} as const;

describe("BodyLoop geometry mapper", () => {
  test("stores markers and measures with m/rad units from a BodyLoop-shaped payload", () => {
    const geometry = buildStoredGeometry(BODYLOOP_SHAPED);
    expect(geometry.markers).toHaveLength(3);
    expect(geometry.markers[0]).toEqual({
      path: "head.vertex",
      label: "Vertex",
      group: "head",
      source: "auto",
      position: [0, 0.02, 1.57],
    });
    expect(markerSourceFromType("PalpationMarker")).toBe("palpation");
    expect(groupFromPath("arm.wrist")).toBe("arm");

    const height = geometry.measures.find((row) => row.kind === "height");
    expect(height?.value).toBe(1.57);
    expect(height?.unit).toBe(UNIT_M);
    expect(height?.positions).toEqual([[0, 0.02, 1.57]]);
    expect(height?.markerRefs).toEqual(["head.vertex"]);

    const distance = geometry.measures.find((row) => row.kind === "distance");
    expect(distance?.value).toBe(0.425);
    expect(distance?.unit).toBe(UNIT_M);
    expect(distance?.positions).toHaveLength(2);

    const ring = geometry.measures.find((row) => row.kind === "crosssection");
    expect(ring?.unit).toBe(UNIT_M);
    expect(ring?.contours).toBeDefined();

    const angle = geometry.measures.find((row) => row.kind === "angle");
    expect(angle?.value).toBe(0.218);
    expect(angle?.unit).toBe(UNIT_RAD);
  });

  test("jsonHasGeometry detects positions and contours", () => {
    expect(jsonHasGeometry({ markers: [{ position: [0, 0, 1] }] })).toBe(true);
    expect(
      jsonHasGeometry({
        metrics: [{ citation: "vitronic.height.a.2026-01-01", value: 1.57, unit: "m" }],
      }),
    ).toBe(false);
  });
});
