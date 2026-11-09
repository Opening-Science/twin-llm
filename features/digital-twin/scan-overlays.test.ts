import { describe, expect, test } from "bun:test";

import {
  collectLabels,
  DEFAULT_OVERLAYS,
  groupedMarkerRows,
  groupedMeasureRows,
  MEASURE_TOKENS,
  measureLabel,
  OVERLAY_OPTIONS,
  overlayLegendItems,
  shouldProjectLabels,
  SOURCE_TOKENS,
  visibleMarkers,
  visibleMeasures,
} from "./scan-overlays";
import type { StoredMarker, StoredMeasure } from "@/packages/vitronic/geometry";

const MARKERS: readonly StoredMarker[] = [
  {
    path: "head.vertex",
    label: "Vertex",
    group: "head",
    source: "auto",
    position: [0, 0, 1.57],
  },
  {
    path: "torso.acromion_r",
    label: "Acromion R",
    group: "torso",
    source: "palpation",
    position: [0.18, 0, 1.32],
  },
];

const MEASURES: readonly StoredMeasure[] = [
  {
    kind: "height",
    path: "head.vertex",
    label: "Stature",
    value: 1.57,
    unit: "m",
    markerRefs: ["head.vertex"],
    positions: [[0, 0, 1.57]],
  },
  {
    kind: "distance",
    path: "arm.span",
    label: "Span",
    value: 0.425,
    unit: "m",
    markerRefs: [],
    positions: [
      [0, 0, 1],
      [0.4, 0, 1],
    ],
  },
];

describe("scan overlays", () => {
  test("toggles hide sources and kinds independently", () => {
    expect(visibleMarkers(MARKERS, { ...DEFAULT_OVERLAYS, auto: false })).toHaveLength(1);
    expect(
      visibleMeasures(MEASURES, { ...DEFAULT_OVERLAYS, heights: false }),
    ).toHaveLength(1);
  });

  test("groups markers and measures like BodyLoop (head / torso / arm)", () => {
    expect(groupedMarkerRows(MARKERS).map((row) => row.group)).toEqual(["head", "torso"]);
    expect(groupedMeasureRows(MEASURES).map((row) => row.group)).toEqual(["head", "arm"]);
  });

  test("height labels convert stored metres to cm", () => {
    expect(measureLabel(MEASURES[0]!)).toBe("H=157.0 cm");
  });

  test("nothing hovered or selected means no labels, measurements included", () => {
    expect(collectLabels(MARKERS, MEASURES, null)).toEqual([]);
    expect(collectLabels(MARKERS, MEASURES, "leg.knee_l")).toEqual([]);
  });

  test("only the hovered or selected marker or measurement is labelled", () => {
    expect(collectLabels(MARKERS, MEASURES, "torso.acromion_r")).toEqual([
      { id: "torso.acromion_r", text: "Acromion R", position: [0.18, 0, 1.32] },
    ]);
    expect(collectLabels(MARKERS, MEASURES, "arm.span")).toEqual([
      { id: "arm.span", text: "42.5 cm", position: [0.2, 0, 1] },
    ]);
  });

  test("a height on its marker's path reads as one label at the marker", () => {
    expect(collectLabels(MARKERS, MEASURES, "head.vertex")).toEqual([
      { id: "head.vertex", text: "Vertex · H=157.0 cm", position: [0, 0, 1.57] },
    ]);
  });

  test("a measurement with no positions has nowhere to put a label", () => {
    const unplaced: StoredMeasure = { ...MEASURES[1]!, path: "arm.loose", positions: [] };
    expect(collectLabels(MARKERS, [unplaced], "arm.loose")).toEqual([]);
  });

  test("labels project only when landmarks show and something is labelled", () => {
    const one = collectLabels(MARKERS, MEASURES, "arm.span");
    expect(shouldProjectLabels(true, one)).toBe(true);
    expect(shouldProjectLabels(false, one)).toBe(false);
    expect(shouldProjectLabels(true, [])).toBe(false);
    expect(shouldProjectLabels(false, [])).toBe(false);
  });

  test("overlays draw in chart tokens, not fixed colours", () => {
    expect(SOURCE_TOKENS).toEqual({
      auto: "chart-1",
      palpation: "chart-2",
      custom: "chart-3",
    });
    expect(MEASURE_TOKENS).toEqual({
      height: "chart-5",
      distance: "chart-4",
      crosssection: "chart-2",
      angle: "chart-3",
    });
  });

  test("each legend swatch draws the token its overlay draws, beside its word", () => {
    const items = overlayLegendItems();
    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["auto", "Markers · Auto"],
      ["palpation", "Markers · Palpation"],
      ["custom", "Markers · Custom"],
      ["heights", "Heights"],
      ["distances", "Distances"],
      ["crosssections", "Crosssections"],
      ["angles", "Angles"],
    ]);
    expect(items.map((item) => item.swatchColor)).toEqual(items.map(() => undefined));
    expect(
      items.map((item, index) =>
        item.swatchClassName?.endsWith(OVERLAY_OPTIONS[index]!.token),
      ),
    ).toEqual(items.map(() => true));
  });
});
