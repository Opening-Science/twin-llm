/**
 * WHAT: Package public barrel: re-exports the supported API surface.
 * NOT:  Must not contain mapping or clinical logic; implementation lives in sibling modules.
GOVERNED BY: DECISIONS.md#d8; DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { RequestParams } from './api/schemas/client';
import {
  buildOuraBundle,
  collectIssues,
  fetchOuraTypedData,
  type OuraBundleResult,
  type OuraDataResult,
  type OuraRequestOptions
} from './fhir/bundleBuilder';
import type { TokenHandler } from './utils/tokenUtils';

export { getAuthorizationUrl } from './api/client';
export type { TokenResponse } from './api/schemas/auth';
export { OuraRingAppConfig } from './config/config';
export type { SupportedScope } from './config/constants';
export type { OuraBundleResult, OuraDataResult, OuraRequestOptions } from './fhir/bundleBuilder';
export type { OuraMapperContext } from './fhir/mappers/shared';
export { TokenHandler } from './utils/tokenUtils';
export type { ListScope, OuraTypedData } from './utils/typeUtils';

/**
 * Fetches the requested types and returns them parsed, each tagged with the type
 * it came from.
 *
 * The return used to be an untagged array, and the type was re-derived by sniffing
 * `data[0]` for a marker field — most of them fields the schema marks optional.
 * The caller already knew the type; now so does the result (D5).
 *
 * Types that failed or came back empty appear in `issues` instead of rejecting the
 * whole call (D6).
 */
export async function getOuraData(
  request: RequestParams,
  tokenHandler: TokenHandler,
  options: OuraRequestOptions = {}
): Promise<OuraDataResult> {
  const { data, errors, emptyTypes } = await fetchOuraTypedData(request, tokenHandler, options);
  return { data, issues: collectIssues(errors, emptyTypes) };
}

/**
 * As `getOuraData`, against Oura's sandbox.
 *
 * The sandbox has no `personal_info` route — it 404s — so requesting that type
 * here yields a `not-found` issue rather than data.
 */
export async function getSandboxOuraData(
  request: RequestParams,
  tokenHandler: TokenHandler,
  options: OuraRequestOptions = {}
): Promise<OuraDataResult> {
  return await getOuraData(request, tokenHandler, { ...options, sandbox: true });
}

export async function getFhirBundleFromOuraData(
  request: RequestParams,
  tokenHandler: TokenHandler,
  options: OuraRequestOptions = {}
): Promise<OuraBundleResult> {
  const { data, errors, emptyTypes } = await fetchOuraTypedData(request, tokenHandler, options);
  return { bundle: buildOuraBundle(data, request, options), issues: collectIssues(errors, emptyTypes) };
}
