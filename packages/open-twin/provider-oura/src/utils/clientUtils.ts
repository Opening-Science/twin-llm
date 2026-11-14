/**
 * WHAT: Shared non-clinical utilities for the connector package.
 * NOT:  Must not choose terminology or units.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError } from '@open-twin/fhir-core';
import { getOuraApiSandboxUserCollectionBaseUrl, getOuraApiUserCollectionBaseUrl } from '../api/endpoints';
import { type RequestParams, RequestParamsSchema } from '../api/schemas/client';
import type { SupportedScope } from '../config/constants';
import { CONNECTOR } from '../fhir/mappers/shared';
import { ouraHttpError, retryAfterSeconds } from './errorMessageHandler';
import type { TokenHandler } from './tokenUtils';

/** Endpoints that take `start_datetime`/`end_datetime` rather than `start_date`/`end_date`. */
const DATETIME_SCOPES = new Set<SupportedScope>(['heartrate']);
/** `latest` exists only on `heartrate`; other endpoints ignore it. */
const LATEST_SCOPES = new Set<SupportedScope>(['heartrate']);
/** `personal_info` takes no time parameters at all. */
const NO_TIME_SCOPES = new Set<SupportedScope>(['personal_info']);

export interface RequestOuraDataOptions {
  sandbox?: boolean;
  /** Attempts per type, including the first. */
  maxAttempts?: number;
  /** Injected so the 429 path is testable without a real wait. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface OuraTypeResponse {
  type: SupportedScope;
  /** The parsed JSON body, or undefined when the request for this type failed. */
  body?: unknown;
  error?: ConnectorError;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Builds the query string for one endpoint.
 *
 * `types` is deliberately excluded. It used to be forwarded to Oura on every
 * request — `heartrate?types=heartrate%2Csleep&...` — because `buildQueryString`
 * was *declared* `Omit<RequestParams, 'types'>` but *called* with the whole
 * request object, which TypeScript accepts for a variable. Oura's FastAPI layer
 * silently ignores unknown query parameters, so it never failed and never showed
 * up in a test asserting the URL with `stringContaining`.
 */
function buildQueryString(type: SupportedScope, request: RequestParams): string {
  const query = new URLSearchParams();
  const { types: _types, start_date, end_date, next_token, fields, latest, utc_offset } = request;
  const utcOffset = utc_offset ?? '+00:00';

  if (!NO_TIME_SCOPES.has(type)) {
    // `heartrate` accepts only `start_datetime`/`end_datetime`. Sent `start_date`
    // it returns 200 and silently ignores the filter, so a caller asking for one
    // day of heart rate quietly received everything Oura had.
    const useDatetime = DATETIME_SCOPES.has(type);
    if (start_date)
      query.append(
        useDatetime ? 'start_datetime' : 'start_date',
        asDatetime(start_date, useDatetime, 'start', utcOffset)
      );
    if (end_date)
      query.append(useDatetime ? 'end_datetime' : 'end_date', asDatetime(end_date, useDatetime, 'end', utcOffset));
  }

  if (next_token) query.append('next_token', next_token);
  if (fields && fields.length > 0) query.append('fields', fields.join(','));
  if (latest !== undefined && latest !== null && LATEST_SCOPES.has(type)) query.append('latest', String(latest));

  return query.toString();
}

function asDatetime(date: string, useDatetime: boolean, bound: 'start' | 'end', offset: string): string {
  if (!useDatetime) return date;
  // A bare date carries no time, so the end of a window must be widened to the end
  // of that day. Collapsing it to T00:00:00 silently dropped the final day's
  // samples — Oura returns 200 either way, so nothing surfaced the loss.
  //
  // The offset comes from the caller. Assuming +00:00 is the same mistake D7
  // forbids elsewhere in this package: it shifts a wearer at +03:00 by three hours.
  return bound === 'start' ? `${date}T00:00:00${offset}` : `${date}T23:59:59${offset}`;
}

/**
 * Fetches every requested type.
 *
 * The fan-out settles rather than rejects (D6): one type failing must not discard
 * the other four. Requests are issued sequentially with a bounded retry so a 429
 * on one type does not immediately provoke twelve more.
 */
export async function requestOuraData(
  rawRequest: RequestParams,
  tokenHandler: TokenHandler,
  options: RequestOuraDataOptions = {}
): Promise<OuraTypeResponse[]> {
  // The schema was defined, exported and never parsed, so its `.min(1)`, its scope
  // membership check and its date formats were all inert. Parsing here is the
  // behaviour change: a malformed request now fails before any network call.
  const request = RequestParamsSchema.parse(rawRequest);

  const baseUrl = options.sandbox ? getOuraApiSandboxUserCollectionBaseUrl() : getOuraApiUserCollectionBaseUrl();
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const sleep = options.sleep ?? defaultSleep;

  // One token round-trip for the whole fan-out, not one per type.
  const accessToken = await tokenHandler.getAccessToken();

  const results: OuraTypeResponse[] = [];
  for (const type of request.types) {
    try {
      results.push({ type, body: await fetchType(type) });
    } catch (error) {
      results.push({
        type,
        error:
          error instanceof ConnectorError
            ? error
            : new ConnectorError('The request could not be completed', {
                code: 'transport',
                connector: CONNECTOR.connector,
                operation: `GET usercollection/${type}`
              })
      });
    }
  }
  return results;

  async function fetchType(type: SupportedScope): Promise<unknown> {
    const query = buildQueryString(type, request);
    const url = query ? `${baseUrl}/${type}?${query}` : `${baseUrl}/${type}`;
    const operation = `GET usercollection/${type}`;

    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (response.ok) return response.json();

      // Oura publishes no numeric rate-limit ceiling; the limits are discoverable
      // only from the 429 headers, and it documents `Retry-After` as safe to feed
      // straight into backoff.
      if (response.status === 429 && attempt < maxAttempts) {
        await sleep((retryAfterSeconds(response) ?? 2) * 1000);
        continue;
      }

      // The response body is never read. It used to be interpolated into the
      // thrown message, so an Oura error payload landed in every log line and
      // error reporter that saw the exception.
      throw ouraHttpError(response, operation);
    }
  }
}
