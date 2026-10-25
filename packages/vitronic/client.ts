import "server-only";

import {
  assertAllowedGetPath,
  DEFAULT_AVATAR_MODEL,
  MEASUREMENT_COLLECTIONS,
  measurementPath,
  modelPath,
  modelsPath,
  tlsCertificatePath,
  viatarListPath,
  viatarPath,
  type MeasurementCollection,
} from "./paths";
import { scannerOrigin, scannerRequestUrl, type ScannerUrlPolicy } from "./base-url";
import {
  certificateBodyFingerprint,
  pinnedRequest,
  TlsPinMismatchError,
  type TlsPinMode,
} from "./tls";
import { modelNamesFromMap, parseModelsResponse, pickGlbModel } from "./models";
import { viatarsForProbandId, type VitronicViatar } from "./viatars";
import { GlbTooLargeError, readBoundedBytes } from "./glb";

export type { VitronicScanRef, VitronicViatar } from "./viatars";

export type VitronicBearerConfig = Readonly<{
  baseUrl: string;
  apiToken: string;
  tlsFingerprintSha256?: string | null;
  onRequestPath?: (path: string) => void;
  /** Operator host allowlist; see base-url.ts. */
  urlPolicy?: ScannerUrlPolicy;
}>;

export type VitronicMeasurementSets = Readonly<{
  height?: unknown;
  distance?: unknown;
  angle?: unknown;
  axis?: unknown;
  cross_section?: unknown;
  marker?: unknown;
  properties?: unknown;
}>;

const COLLECTION_TO_SCOPE: Record<MeasurementCollection, keyof VitronicMeasurementSets> =
  {
    heights: "height",
    distances: "distance",
    angles: "angle",
    axes: "axis",
    crosssections: "cross_section",
    markers: "marker",
    properties: "properties",
  };

const jsonHeaders = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
});

const pinMode = (config: VitronicBearerConfig): TlsPinMode => {
  const fp = config.tlsFingerprintSha256;
  if (!fp) throw new Error("vitronic-tls-pin-required");
  return { kind: "pin", fingerprintSha256: fp };
};

/** Every request URL is the validated origin plus an allowlisted path, nothing else. */
const requestUrl = (
  config: Pick<VitronicBearerConfig, "baseUrl" | "urlPolicy">,
  path: string,
): string => {
  assertAllowedGetPath(path);
  return scannerRequestUrl(scannerOrigin(config.baseUrl, config.urlPolicy), path);
};

const get = async (
  config: VitronicBearerConfig,
  path: string,
  accept: string,
): Promise<Response> => {
  const url = requestUrl(config, path);
  const mode = pinMode(config);
  config.onRequestPath?.(path);
  const headers = {
    Authorization: `Bearer ${config.apiToken}`,
    Accept: accept,
  };
  const result = await pinnedRequest(url, { method: "GET", headers }, mode);
  return new Response(new Uint8Array(result.body), {
    status: result.status,
    headers: result.headers,
  });
};

const getJson = async (config: VitronicBearerConfig, path: string): Promise<unknown> => {
  const response = await get(config, path, "application/json");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("vitronic-http-error");
  return response.json() as Promise<unknown>;
};

const isViatarRow = (row: unknown): row is VitronicViatar => {
  if (!row || typeof row !== "object") return false;
  return Number.isInteger((row as VitronicViatar).viatar_id);
};

const listViatars = async (
  config: VitronicBearerConfig,
): Promise<readonly VitronicViatar[]> => {
  const body = await getJson(config, viatarListPath());
  if (!Array.isArray(body)) return [];
  return body.filter(isViatarRow);
};

/** GET /viatars/ then keep rows whose proband_id equals the listed integer scan key. */
export const listViatarsForProbandId = async (
  config: VitronicBearerConfig,
  probandId: number,
): Promise<readonly VitronicViatar[]> => {
  const listed = await listViatars(config);
  return viatarsForProbandId(listed, probandId);
};

export const getViatar = async (
  config: VitronicBearerConfig,
  viatarId: number,
): Promise<VitronicViatar | null> => {
  const body = await getJson(config, viatarPath(viatarId));
  if (!isViatarRow(body)) return null;
  return body;
};

export const getMeasurementSets = async (
  config: VitronicBearerConfig,
  viatarId: number,
): Promise<VitronicMeasurementSets> => {
  const out: Record<string, unknown> = {};
  for (const collection of MEASUREMENT_COLLECTIONS) {
    const body = await getJson(config, measurementPath(viatarId, collection));
    if (body == null) continue;
    out[COLLECTION_TO_SCOPE[collection]] = body;
  }
  return out as VitronicMeasurementSets;
};

export const getAvatarGlb = async (
  config: VitronicBearerConfig,
  viatarId: number,
  modelName: string = DEFAULT_AVATAR_MODEL,
): Promise<Uint8Array | null> => {
  const response = await get(config, modelPath(viatarId, modelName), "model/gltf-binary");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("vitronic-http-error");
  try {
    return await readBoundedBytes(response);
  } catch (error) {
    if (error instanceof GlbTooLargeError) throw error;
    throw error;
  }
};

export const listModelNames = async (
  config: VitronicBearerConfig,
  viatarId: number,
): Promise<readonly string[]> => {
  const body = await getJson(config, modelsPath(viatarId));
  return modelNamesFromMap(parseModelsResponse(body));
};

export const fetchAvatarGlb = async (
  config: VitronicBearerConfig,
  viatarId: number,
): Promise<{ readonly chosen: string | null; readonly bytes: Uint8Array | null }> => {
  const body = await getJson(config, modelsPath(viatarId));
  const chosen = pickGlbModel(modelNamesFromMap(parseModelsResponse(body)));
  if (!chosen) return { chosen: null, bytes: null };
  const bytes = await getAvatarGlb(config, viatarId, chosen);
  return { chosen, bytes };
};

/**
 * First contact (trust on first use). The pin is the certificate seen in the
 * handshake; the certificate endpoint is read on a connection pinned to it, without
 * the API token, and a different certificate there refuses the connection.
 */
export const captureTlsFingerprint = async (
  config: Pick<VitronicBearerConfig, "baseUrl" | "onRequestPath" | "urlPolicy">,
): Promise<string> => {
  const path = tlsCertificatePath();
  const url = requestUrl(config, path);
  config.onRequestPath?.(path);
  let handshakeFp: string | undefined;
  const result = await pinnedRequest(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    {
      kind: "tofu",
      onCapture: (fp) => {
        handshakeFp = fp;
      },
    },
  );
  if (!handshakeFp) throw new Error("vitronic-tls-pin-unavailable");
  if (result.status >= 200 && result.status < 300 && result.body.length > 0) {
    // A body that is not a PEM/DER certificate leaves the handshake pin standing.
    const served = certificateBodyFingerprint(result.body);
    if (served !== null && served !== handshakeFp) throw new TlsPinMismatchError();
  }
  return handshakeFp;
};

/** Exported for tests that assert the wrapper never mints JSON headers for writes. */
export const bearerJsonHeaders = jsonHeaders;
