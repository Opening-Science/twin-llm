import { describe, expect, test } from "bun:test";

import {
  SYNTHETIC_HEIGHT_ROW,
  SYNTHETIC_INGEST_BODY,
  SYNTHETIC_MEASUREMENTS_JSON,
} from "@/features/vitronic/fixtures/synthetic-measurements";

import {
  buildVitronicSummary,
  PROPERTY_SI_UNITS,
  toChatVitronicSummary,
  UNIT_CM,
  UNIT_M,
  UNIT_RAD,
} from "./summary";
import { jsonHasGeometry } from "./geometry";

describe("buildVitronicSummary", () => {
  test("maps SI properties without converting or recomputing BMI", () => {
    const summary = buildVitronicSummary({
      scanId: SYNTHETIC_INGEST_BODY.scan_id,
      effectiveDateTime: SYNTHETIC_INGEST_BODY.effectiveDateTime,
      properties: SYNTHETIC_MEASUREMENTS_JSON.properties,
      height: SYNTHETIC_MEASUREMENTS_JSON.heights,
      distance: SYNTHETIC_MEASUREMENTS_JSON.distances,
      angle: SYNTHETIC_MEASUREMENTS_JSON.angles,
      cross_section: SYNTHETIC_MEASUREMENTS_JSON.crosssections,
    });

    expect(SYNTHETIC_MEASUREMENTS_JSON.heights).toEqual([]);
    expect(SYNTHETIC_MEASUREMENTS_JSON.distances).toEqual([]);
    expect(SYNTHETIC_MEASUREMENTS_JSON.angles).toEqual([]);
    expect(SYNTHETIC_MEASUREMENTS_JSON.crosssections).toEqual([]);
    expect(SYNTHETIC_MEASUREMENTS_JSON.axes).toEqual([]);
    expect(
      summary.metrics.map((metric) => `${metric.key} ${metric.value} ${metric.unit}`),
    ).toEqual([
      "vitronic.property.body.height.2026-07-10 1.7 m",
      "vitronic.property.body.surface.2026-07-10 1.85 m2",
      "vitronic.property.body.volume.2026-07-10 0.065 m3",
      "vitronic.property.body.mass.2026-07-10 68 kg",
      "vitronic.property.body.bmi.2026-07-10 21 kg/m2",
    ]);
    const computed = 68 / (1.7 * 1.7);
    expect(computed).not.toBe(21);
    expect(PROPERTY_SI_UNITS["body.bmi"]).toBe("kg/m2");
  });

  test("stores m/rad on measure lists and a unit on every key", () => {
    const summary = buildVitronicSummary({
      scanId: "1",
      effectiveDateTime: "2026-07-10T12:00:00Z",
      height: [SYNTHETIC_HEIGHT_ROW],
      distance: [{ distance_path: "arm_span", distances: { linear_distance: 1.8 } }],
      angle: [{ angle_path: "knee", angles: { primary: 1.4817 } }],
      cross_section: [
        {
          crosssection_path: "waist",
          circumferences: { convex_circumference: 0.8 },
        },
      ],
      properties: SYNTHETIC_MEASUREMENTS_JSON.properties,
    });

    for (const metric of summary.metrics) {
      expect(typeof metric.unit).toBe("string");
      expect(metric.unit?.length).toBeGreaterThan(0);
    }
    expect(summary.metrics.find((row) => row.key.startsWith("vitronic.height."))?.unit).toBe(
      UNIT_M,
    );
    expect(summary.metrics.find((row) => row.key.startsWith("vitronic.height."))?.value).toBe(
      1.75,
    );
    expect(summary.metrics.find((row) => row.key.startsWith("vitronic.angle."))?.unit).toBe(
      UNIT_RAD,
    );
    expect(summary.metrics.find((row) => row.key.includes("body.height"))?.unit).toBe(UNIT_M);

    const chat = toChatVitronicSummary(summary);
    const chatHeight = chat.metrics.find((row) => row.key.startsWith("vitronic.height."));
    expect(chatHeight?.value).toBe(175);
    expect(chatHeight?.unit).toBe(UNIT_CM);
    const chatAngle = chat.metrics.find((row) => row.key.startsWith("vitronic.angle."));
    expect(chatAngle?.value).toBe(84.9);
    const chatProperty = chat.metrics.find((row) => row.key.includes("body.height"));
    expect(chatProperty?.value).toBe(1.7);
    expect(chatProperty?.unit).toBe(UNIT_M);
    expect(toChatVitronicSummary(chat).metrics.find((row) => row.key.startsWith("vitronic.height."))?.value).toBe(
      175,
    );
  });

  test("chat summary keeps numeric keys with units and never includes positions", () => {
    const summary = buildVitronicSummary({
      scanId: "1",
      effectiveDateTime: "2026-07-10T12:00:00Z",
      height: [SYNTHETIC_HEIGHT_ROW],
      properties: SYNTHETIC_MEASUREMENTS_JSON.properties,
    });
    const chat = toChatVitronicSummary({
      ...summary,
      metrics: [
        ...summary.metrics,
        { key: "vitronic.mesh.vertices", label: "nope", value: 12, unit: "count" },
      ],
    });
    expect(chat.metrics.every((row) => row.key.startsWith("vitronic.property.") || row.key.startsWith("vitronic.height."))).toBe(
      true,
    );
    expect(chat.metrics.some((row) => row.key.startsWith("vitronic.mesh."))).toBe(false);
    expect(chat.narrative).toBe("BodyLoop numeric measurements with units.");
    expect(jsonHasGeometry(chat)).toBe(false);
    expect(JSON.stringify(chat)).not.toContain("position");
    expect(JSON.stringify(chat)).not.toContain("contour");
    expect(JSON.stringify(chat)).not.toMatch(/\bmesh\b/i);
  });
});
