/**
 * Synthetic BodyLoop measurements.json shape: properties in SI plus five empty
 * lists. Values are invented; they are not a person's scan.
 */

export const SYNTHETIC_EFFECTIVE = "2026-07-10T12:00:00Z";
export const SYNTHETIC_SCAN_ID = "1";
export const SYNTHETIC_KEY_EXTERNAL = "twin-synthetic-1";

export const SYNTHETIC_PROPERTY_ROWS = [
  {
    property_path: "body.height",
    value: 1.7,
    label: null,
    note: null,
    style: null,
    key_external: null,
    hidden: null,
  },
  {
    property_path: "body.surface",
    value: 1.85,
    label: null,
    note: null,
    style: null,
    key_external: null,
    hidden: null,
  },
  {
    property_path: "body.volume",
    value: 0.065,
    label: null,
    note: null,
    style: null,
    key_external: null,
    hidden: null,
  },
  {
    property_path: "body.mass",
    value: 68,
    label: null,
    note: null,
    style: null,
    key_external: null,
    hidden: null,
  },
  {
    property_path: "body.bmi",
    value: 21,
    label: null,
    note: null,
    style: null,
    key_external: null,
    hidden: null,
  },
] as const;

/**
 * Exact export shape: properties + five empty lists.
 * body.bmi is 21 with height 1.7 and mass 68 so tests prove BMI is not recomputed.
 */
export const SYNTHETIC_MEASUREMENTS_JSON = {
  properties: [...SYNTHETIC_PROPERTY_ROWS],
  heights: [] as const,
  distances: [] as const,
  angles: [] as const,
  crosssections: [] as const,
  axes: [] as const,
};

export const SYNTHETIC_INGEST_BODY = {
  scan_id: SYNTHETIC_SCAN_ID,
  viatar: {
    viatar_id: 1,
    proband_id: 1,
    key_external: SYNTHETIC_KEY_EXTERNAL,
    meta: { crtime: SYNTHETIC_EFFECTIVE },
  },
  effectiveDateTime: SYNTHETIC_EFFECTIVE,
  height: [] as const,
  distance: [] as const,
  angle: [] as const,
  cross_section: [] as const,
  properties: SYNTHETIC_MEASUREMENTS_JSON.properties,
};

export const SYNTHETIC_HEIGHT_ROW = {
  height_path: "stature",
  at_marker: "vertex",
  height: 1.75,
  details: {
    at_marker: {
      marker_type: "anatomical",
      marker_path: "vertex",
      position: [0, 1.75, 0] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
    },
  },
};

const syntheticMarker = (marker_path: string, position: [number, number, number]) => ({
  marker_type: "anatomical",
  marker_path,
  position,
  normal: null,
});

/** Invented, in the API's SI units: metres. */
export const SYNTHETIC_DISTANCE_ROW = {
  distance_path: "torso.shoulder.M",
  from_marker: "arm.acromion.R",
  to_marker: "arm.acromion.L",
  distances: {
    linear_distance: 0.4,
    linear_distance_x: 0.4,
    linear_distance_y: 0,
    linear_distance_z: 0,
  },
  preference: null,
  details: {
    from_marker: syntheticMarker("arm.acromion.R", [-0.2, 0, 1.45]),
    to_marker: syntheticMarker("arm.acromion.L", [0.2, 0, 1.45]),
  },
};

/** Invented, in the API's SI units: radians (π/2 is a right angle). */
export const SYNTHETIC_ANGLE_ROW = {
  angle_path: "arm.shoulder.R",
  at_marker: "arm.shoulder.R",
  from_marker: "arm.arm.R",
  to_marker: "torso.spine1.M",
  angles: {
    primary: Math.PI / 2,
    supplementary: Math.PI / 2,
    conjugate: (3 * Math.PI) / 2,
  },
  preference: "primary",
  details: {
    at_marker: syntheticMarker("arm.shoulder.R", [-0.18, 0, 1.42]),
    from_marker: syntheticMarker("arm.arm.R", [-0.2, 0, 1.2]),
    to_marker: syntheticMarker("torso.spine1.M", [0, 0, 1.2]),
  },
};
