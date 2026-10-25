/**
 * Allowlisted BodyLoop GET paths. Host HTTP is read-only on viatars.
 */

export const VITRONIC_API_PREFIX = "/api/v2";

export const MEASUREMENT_COLLECTIONS = [
  "heights",
  "distances",
  "angles",
  "crosssections",
  "markers",
  "axes",
  "properties",
] as const;

export type MeasurementCollection = (typeof MEASUREMENT_COLLECTIONS)[number];

const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VIATAR_ID_RE = /^\d+$/;

export const DEFAULT_AVATAR_MODEL = "avatar_3d.glb";

export const viatarListPath = (): string => `${VITRONIC_API_PREFIX}/viatars/`;

export const viatarPath = (id: number): string => {
  assertViatarId(id);
  return `${VITRONIC_API_PREFIX}/viatars/${id}`;
};

export const measurementPath = (id: number, collection: MeasurementCollection): string => {
  assertViatarId(id);
  return `${VITRONIC_API_PREFIX}/viatars/${id}/${collection}/`;
};

export const modelsPath = (id: number): string => {
  assertViatarId(id);
  return `${VITRONIC_API_PREFIX}/viatars/${id}/models`;
};

export const modelPath = (id: number, modelName: string): string => {
  assertViatarId(id);
  if (!MODEL_NAME_RE.test(modelName) || modelName.includes("..")) {
    throw new Error("vitronic-model-name-rejected");
  }
  return `${VITRONIC_API_PREFIX}/viatars/${id}/models/${modelName}`;
};

export const tlsCertificatePath = (): string => `${VITRONIC_API_PREFIX}/system/tls/certificate`;

const ALLOWED_GET_RE =
  /^\/api\/v2\/viatars\/(?:\d+(?:\/(?:heights|distances|angles|crosssections|markers|axes|properties)\/|\/models(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?)?)?$/;

export const isAllowedGetPath = (path: string): boolean => {
  if (path === viatarListPath()) return true;
  if (path === tlsCertificatePath()) return true;
  return ALLOWED_GET_RE.test(path);
};

export const assertAllowedGetPath = (path: string): void => {
  if (!isAllowedGetPath(path)) {
    throw new Error("vitronic-path-not-allowed");
  }
};

const assertViatarId = (id: number): void => {
  if (!Number.isInteger(id) || id < 0 || !VIATAR_ID_RE.test(String(id))) {
    throw new Error("vitronic-viatar-id-rejected");
  }
};
