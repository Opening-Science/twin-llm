import { RetryError } from "ai";

import { publicProviderFailure } from "./public-provider-failure";

/**
 * What the server log may say about a failed model call.
 *
 * Provider errors carry the request URL, request body, response headers and
 * response body, any of which can hold a key, a host name or an echo of the
 * user's prompt. The log gets the error class name, the HTTP status and an
 * allowlisted provider code, nothing else. A retry wrapper is unwrapped so
 * the status of the last attempt is still visible.
 */
export type ModelFailureLog = Readonly<{
  name: string;
  status?: number;
  code: string;
}>;

const innermost = (error: unknown): unknown =>
  RetryError.isInstance(error) && error.lastError !== undefined ? error.lastError : error;

export const modelFailureLog = (error: unknown): ModelFailureLog => {
  const cause = innermost(error);
  const name = cause instanceof Error ? cause.name : typeof cause;
  return { name, ...publicProviderFailure(cause) };
};

/** Name only, for storage and analytics failures whose messages can echo row values. */
export const errorNameOf = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;
