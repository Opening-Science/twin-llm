/**
 * WHAT: Shared non-clinical utilities for the connector package.
 * NOT:  Must not choose terminology or units.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { type ConnectorError, fromHttpStatus, parseRetryAfter } from '@open-twin/fhir-core';
import { CONNECTOR } from '../fhir/mappers/shared';

/**
 * Turns an HTTP response into a typed error that carries no response body.
 *
 * This replaces a `switch (response.status)` returning prose. That function was
 * declared `(response: Response)` but was called with the *parsed JSON body* at
 * both token endpoints, so `response.status` was always `undefined`, every call
 * fell to the default branch, and the whole status table — including the 429 case
 * this connector needs — was unreachable. It type-checked only because
 * `res.json()` returns `any`.
 */
export function ouraHttpError(response: Response, operation: string): ConnectorError {
  return fromHttpStatus(response.status, {
    connector: CONNECTOR.connector,
    operation,
    retryAfterSeconds: retryAfterSeconds(response)
  });
}

/** Oura documents `Retry-After` on 429 as RFC 7231 delta-seconds, safe to use directly. */
export function retryAfterSeconds(response: Response): number | undefined {
  const header = typeof response.headers?.get === 'function' ? response.headers.get('retry-after') : null;
  return parseRetryAfter(header, Date.now());
}
