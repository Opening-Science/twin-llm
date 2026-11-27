import {
  type Box3,
  MathUtils,
  type OrthographicCamera,
  Quaternion,
  Vector3,
} from "three";

import { type MEASURES } from "@/packages/personal-data/wearable-measure-codes";
import { LOINC_SYSTEM } from "@/packages/query-tools/imported-ports";

import { measureKeyFor, type YourDayChartId } from "./charts/your-day-charts";

// The standalone BodyParts3D atlas merges meshes by system. Frame each region
// using fractions of its body bounds (left to right, feet to head, back to front).
const BODY_REGIONS = {
  heart: { center: [0.53, 0.76, 0.63], zoom: 4 },
  pancreas: { center: [0.53, 0.69, 0.54], zoom: 4 },
} as const;

export type YourDayRegion = keyof typeof BODY_REGIONS;
export type YourDayCameraRequest = Readonly<{
  chartId: YourDayChartId;
  region: YourDayRegion;
}>;

const CHART_REGIONS: Partial<Record<YourDayChartId, YourDayRegion>> = {
  heart_rate: "heart",
  resting_heart_rate: "heart",
  hrv_rmssd: "heart",
  glucose: "pancreas",
  blood_glucose: "pancreas",
};

const MEASURE_REGIONS: Partial<Record<keyof typeof MEASURES, YourDayRegion>> = {
  heartRate: "heart",
  restingHeartRate: "heart",
  hrvRmssd: "heart",
  hrvSdnn: "heart",
};

const GLUCOSE_LOINC = ["99504-3", "2339-0", "2345-7"];

export function yourDayChartFocus({
  id,
  observations,
}: Readonly<{
  id: YourDayChartId;
  observations?: readonly Parameters<typeof measureKeyFor>[0][];
}>): YourDayRegion | undefined {
  const configured = CHART_REGIONS[id];
  if (configured) return configured;
  const row = observations?.[0];
  if (!row) return undefined;
  if (
    row.codeSystem === LOINC_SYSTEM &&
    row.code &&
    GLUCOSE_LOINC.includes(row.code) &&
    (row.unit === "mg/dL" || row.unit === "g/L")
  ) {
    return "pancreas";
  }
  const measure = measureKeyFor(row);
  return measure ? MEASURE_REGIONS[measure] : undefined;
}

type CameraPose = Readonly<{ target: Vector3; offset: Vector3; zoomScale: number }>;

export function yourDayCameraPose(
  camera: OrthographicCamera,
  orbitTarget: Vector3,
  fittedZoom: number,
): CameraPose {
  return {
    target: orbitTarget.clone(),
    offset: camera.position.clone().sub(orbitTarget),
    zoomScale: camera.zoom / fittedZoom,
  };
}

export function yourDayRegionPose(
  current: CameraPose,
  body: Box3,
  region?: YourDayRegion,
): CameraPose {
  const size = body.getSize(new Vector3());
  const frame = region ? BODY_REGIONS[region] : undefined;
  if (frame)
    return {
      target: new Vector3(...frame.center).multiply(size).add(body.min),
      offset: current.offset.clone(),
      zoomScale: frame.zoom,
    };
  const target = body.getCenter(new Vector3());
  return {
    target,
    offset: new Vector3(0, 0, body.max.z + size.y - target.z),
    zoomScale: 1,
  };
}

export function applyYourDayCameraPose(
  camera: OrthographicCamera,
  orbitTarget: Vector3,
  fittedZoom: number,
  from: CameraPose,
  to: CameraPose,
  progress: number,
) {
  const t = MathUtils.smoothstep(progress, 0, 1);
  orbitTarget.lerpVectors(from.target, to.target, t);
  if (t === 1) {
    camera.position.copy(orbitTarget).add(to.offset);
  } else {
    // Orbit around the model when returning from behind it, not through it.
    const direction = from.offset.clone().normalize();
    const rotation = new Quaternion().setFromUnitVectors(
      direction,
      to.offset.clone().normalize(),
    );
    direction.applyQuaternion(new Quaternion().slerp(rotation, t));
    const distance = MathUtils.lerp(from.offset.length(), to.offset.length(), t);
    camera.position.copy(orbitTarget).addScaledVector(direction, distance);
  }
  Object.assign(camera, {
    zoom: fittedZoom * MathUtils.lerp(from.zoomScale, to.zoomScale, t),
  });
  camera.updateProjectionMatrix();
}
