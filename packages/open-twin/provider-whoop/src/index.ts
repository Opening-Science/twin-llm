/**
 * WHAT: Package public barrel: re-exports the supported API surface.
 * NOT:  Must not contain mapping or clinical logic; implementation lives in sibling modules.
GOVERNED BY: DECISIONS.md#d8; DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { fetchWhoopData, type WhoopRequestOptions } from './fhir/bundleBuilder';
import type { WhoopWindow } from './utils/fetchWhoopData';
import type { TokenHandler } from './utils/tokenUtils';

export {
  createWhoopOAuthState,
  exchangeWhoopCode,
  getWhoopAuthorizationUrl,
  refreshWhoopToken,
  WHOOP_SCOPES,
  type WhoopScope
} from './api/client';
export type { TokenResponse } from './api/schemas/auth';
export type { WhoopSyncPayload } from './api/schemas/sync';
export type { WhoopAppConfig } from './config/config';
export {
  buildWhoopBundleFromPayload,
  getFhirBundleFromWhoopData,
  type WhoopBundleResult,
  type WhoopDataResult,
  type WhoopRequestOptions
} from './fhir/bundleBuilder';
export type { WhoopWindow } from './utils/fetchWhoopData';
export { TokenHandler } from './utils/tokenUtils';

export async function getWhoopData(window: WhoopWindow, tokenHandler: TokenHandler, options: WhoopRequestOptions) {
  return await fetchWhoopData(window, tokenHandler, options);
}
