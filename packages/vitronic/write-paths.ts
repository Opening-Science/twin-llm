/**
 * CLI-only BodyLoop write allowlist. The TwinLLM app must not import this file.
 * GET allowlist stays in paths.ts and is unchanged.
 */

import { VITRONIC_API_PREFIX, viatarPath } from "./paths";

const SCAN_SUBJECT_COLLECTION = "probands";

const WRITE_VIATAR_TARGETS_RE = /^\/api\/v2\/viatars\/\d+\/targets\/$/;

export const writeScanSubjectCreatePath = (): string =>
  `${VITRONIC_API_PREFIX}/${SCAN_SUBJECT_COLLECTION}/`;

export const writeViatarCreatePath = (): string => `${VITRONIC_API_PREFIX}/viatars/`;

export const writeViatarTargetsPath = (id: number): string => `${viatarPath(id)}/targets/`;

export const isAllowedWrite = (method: string, path: string): boolean => {
  if (method !== "POST") return false;
  if (path === writeScanSubjectCreatePath()) return true;
  if (path === writeViatarCreatePath()) return true;
  return WRITE_VIATAR_TARGETS_RE.test(path);
};

export const assertAllowedWrite = (method: string, path: string): void => {
  if (!isAllowedWrite(method, path)) {
    throw new Error("vitronic-write-path-not-allowed");
  }
};
