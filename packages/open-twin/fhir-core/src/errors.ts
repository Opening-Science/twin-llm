/**
 * WHAT: ConnectorError type that carries status/operation/code without payload bodies.
 * NOT:  Must not embed API response bodies or PHI in messages or logs.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { OperationOutcome, OperationOutcomeIssue } from 'fhir/r4';

/**
 * Gap 1I: a typed error taxonomy.
 *
 * Every failure in every package was previously `throw new Error(string)` — no
 * class, no code, no status, no `retryable` flag, no cause chain. A caller could
 * not distinguish "re-authenticate" from "back off" from "this is a library bug"
 * from "there is simply no data in this window".
 *
 * This lands together with the removal of response-body interpolation from thrown
 * errors. Stripping the bodies on its own would delete the only diagnostic signal
 * the library produces; these classes replace it with something that is both
 * actionable and safe to log.
 */
export type ConnectorErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'validation'
  | 'transport'
  | 'unsupported'
  | 'server'
  | 'unknown';

export interface ConnectorErrorInit {
  code: ConnectorErrorCode;
  connector: string;
  /** HTTP status where one was actually observed. Never invented. */
  status?: number;
  /** The operation that failed, e.g. 'GET usercollection/sleep'. Never a payload. */
  operation?: string;
  retryable?: boolean;
  /** Seconds, from a `Retry-After` header. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * Carries no response body, ever.
 *
 * Raw API bodies were previously interpolated into thrown messages at fourteen
 * sites in the VITRONIC client alone, three of which leak proband (study-subject)
 * records containing name, date of birth, address and contact details. Those
 * messages land in application logs, stack traces, error-reporting services and CI
 * output. For a foundation publishing health-data infrastructure that is a
 * compliance problem, not a style problem.
 */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly connector: string;
  readonly status?: number;
  readonly operation?: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(message: string, init: ConnectorErrorInit) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'ConnectorError';
    this.code = init.code;
    this.connector = init.connector;
    this.status = init.status;
    this.operation = init.operation;
    this.retryable = init.retryable ?? DEFAULT_RETRYABLE[init.code];
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** Safe by construction: only status, code and operation — no payload. */
  override toString(): string {
    const parts = [this.code, this.operation, this.status !== undefined ? `HTTP ${this.status}` : undefined];
    return `ConnectorError(${this.connector}): ${this.message} [${parts.filter(Boolean).join(' ')}]`;
  }
}

const DEFAULT_RETRYABLE: Record<ConnectorErrorCode, boolean> = {
  auth: false,
  rate_limit: true,
  not_found: false,
  validation: false,
  transport: true,
  unsupported: false,
  server: true,
  unknown: false
};

/** Maps an HTTP status to a code and a message that never quotes the body. */
export function fromHttpStatus(
  status: number,
  init: Omit<ConnectorErrorInit, 'code' | 'status'> & { retryAfterSeconds?: number }
): ConnectorError {
  const code: ConnectorErrorCode =
    status === 401 || status === 403
      ? 'auth'
      : status === 404
        ? 'not_found'
        : status === 429
          ? 'rate_limit'
          : status >= 500
            ? 'server'
            : status >= 400
              ? 'validation'
              : 'unknown';

  const messages: Record<ConnectorErrorCode, string> = {
    auth: 'Authentication failed or the token lacks the required scope',
    not_found: 'The requested resource does not exist',
    rate_limit: 'Rate limit exceeded',
    server: 'The upstream service reported an internal error',
    validation: 'The upstream service rejected the request',
    transport: 'The request could not be completed',
    unsupported: 'Unsupported operation',
    unknown: 'Unexpected response'
  };

  return new ConnectorError(messages[code], { ...init, code, status });
}

/** Reads `Retry-After` in both forms RFC 7231 permits: delta-seconds and HTTP-date. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.round((date - now) / 1000));
}

/**
 * Decision D6: absence is not an exception and one failing data type must not
 * discard the others. Public entry points return `{ bundle, issues }`, and
 * OperationOutcome is the FHIR-native way to say "four types succeeded, one was
 * rate-limited".
 */
export function toOperationOutcome(errors: ConnectorError[]): OperationOutcome | undefined {
  if (errors.length === 0) return undefined;
  const issues: OperationOutcomeIssue[] = errors.map((error) => ({
    severity: error.code === 'rate_limit' ? 'warning' : 'error',
    code: OUTCOME_CODES[error.code],
    diagnostics: error.toString()
  }));
  return { resourceType: 'OperationOutcome', issue: issues };
}

const OUTCOME_CODES: Record<ConnectorErrorCode, OperationOutcomeIssue['code']> = {
  auth: 'security',
  rate_limit: 'throttled',
  not_found: 'not-found',
  validation: 'invalid',
  transport: 'transient',
  unsupported: 'not-supported',
  server: 'exception',
  unknown: 'exception'
};
