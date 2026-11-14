/**
 * WHAT: HTTP client for a vendor API, including auth token handling in-process.
 * NOT:  Must not emit FHIR or log response bodies; mapping and ConnectorError own those duties.
GOVERNED BY: DECISIONS.md#d8
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Hosts still need durable token persistence; TokenStore interfaces are not implemented in-tree.
 */
import { health } from '@googleapis/health';
import { ConnectorError, fromHttpStatus, parseRetryAfter } from '@open-twin/fhir-core';
import { type Auth, google, type health_v4 } from 'googleapis';
import type { GoogleHealthAppConfig } from '../config/config';
import { SUPPORTED_SCOPES } from '../config/constants';
import { type AllType, type AllTypes, buildTypeFilter, type QueryWindow, resolveWindow } from './record_types';

/** Google's documented maximum for `dataPoints.list`. Exercise and sleep cap at 25. */
const MAX_PAGE_SIZE = 10_000;
const SMALL_PAGE_TYPES = new Set<AllType>(['exercise', 'sleep']);

/**
 * A ceiling, not a limit on the data. Without one, a wide window against a type such as
 * heart rate walks pages until the process runs out of memory; with one, the caller is
 * told plainly that the window is too wide instead of receiving a truncated bundle.
 */
const MAX_PAGES_PER_TYPE = 200;

export interface GetTypesResult {
  responses: health_v4.Schema$ListDataPointsResponse[];
  /** Per-type failures. Decision D6: one failing type must not discard the others. */
  errors: ConnectorError[];
  window: QueryWindow;
}

export class GoogleHealthClient {
  private client: health_v4.Health;
  private oauth2Client: Auth.OAuth2Client;
  private config: GoogleHealthAppConfig;

  constructor(config: GoogleHealthAppConfig) {
    this.config = config;
    this.client = health('v4');

    this.oauth2Client = new google.auth.OAuth2(this.config.clientId, this.config.clientSecret, this.config.redirectUri);
  }

  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      // `generateAuthUrl` wants a mutable array; SUPPORTED_SCOPES is a readonly tuple
      // so that `SupportedScope` is a real union rather than `string`.
      scope: [...(this.config.scopes ?? SUPPORTED_SCOPES)]
    });
  }

  async initialize(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);

    this.oauth2Client.setCredentials(tokens);

    const healthOptions: health_v4.Options = {
      version: 'v4',
      auth: this.oauth2Client
    };
    this.client = health(healthOptions);
    return tokens;
  }

  getClient(): health_v4.Health {
    return this.client;
  }

  async getTypes({
    types,
    start_date,
    end_date,
    timeZone
  }: {
    types: AllTypes;
    start_date?: string;
    end_date?: string;
    /** IANA zone the subject's civil dates are computed in, e.g. 'Europe/Zurich'. */
    timeZone?: string;
  }): Promise<GetTypesResult> {
    // Decision D7: the window is resolved once for the whole sync, not per data type.
    const window = resolveWindow(start_date, end_date, timeZone);
    const responses: health_v4.Schema$ListDataPointsResponse[] = [];
    const errors: ConnectorError[] = [];

    for (const type of types) {
      try {
        responses.push(...(await this.listAllPages(type, window)));
      } catch (error) {
        errors.push(toConnectorError(error, type));
      }
    }

    return { responses, errors, window };
  }

  /**
   * Follows `nextPageToken`. Without this a month of heart rate returned one page and
   * no indication that anything had been dropped — the bundle simply ended early, which
   * is indistinguishable from the wearer having stopped.
   */
  private async listAllPages(type: AllType, window: QueryWindow): Promise<health_v4.Schema$ListDataPointsResponse[]> {
    const pages: health_v4.Schema$ListDataPointsResponse[] = [];
    const filter = buildTypeFilter(type, window);
    const parent = `users/me/dataTypes/${type}`;
    const pageSize = SMALL_PAGE_TYPES.has(type) ? 25 : MAX_PAGE_SIZE;

    let pageToken: string | undefined;
    do {
      const response = await this.client.users.dataTypes.dataPoints.list({ filter, parent, pageSize, pageToken });
      pages.push(response.data);
      pageToken = response.data.nextPageToken ?? undefined;

      if (pageToken && pages.length >= MAX_PAGES_PER_TYPE) {
        throw new ConnectorError(
          `More than ${MAX_PAGES_PER_TYPE} pages of "${type}" in the requested window; narrow the window and re-run`,
          { code: 'validation', connector: 'google-health', operation: `list ${type}` }
        );
      }
    } while (pageToken);

    return pages;
  }
}

/**
 * Never carries a response body, in the message or on `cause`. A Google error payload
 * echoes the request and can carry health data; those messages end up in application
 * logs, stack traces and CI output.
 */
function toConnectorError(error: unknown, type: AllType): ConnectorError {
  if (error instanceof ConnectorError) return error;

  const status = readStatus(error);
  const retryAfterSeconds = parseRetryAfter(readRetryAfter(error), Date.now());

  if (status !== undefined) {
    return fromHttpStatus(status, { connector: 'google-health', operation: `list ${type}`, retryAfterSeconds });
  }

  return new ConnectorError('The request could not be completed', {
    code: 'transport',
    connector: 'google-health',
    operation: `list ${type}`
  });
}

function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  const status = candidate.status ?? candidate.response?.status ?? candidate.code;
  return typeof status === 'number' ? status : undefined;
}

function readRetryAfter(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const headers = (error as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  const value = headers?.['retry-after'];
  return typeof value === 'string' ? value : null;
}
