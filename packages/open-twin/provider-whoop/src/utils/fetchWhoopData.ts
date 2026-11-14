/**
 * WHAT: Paginated WHOOP v2 collection fetch.
 * NOT:  Must not map to FHIR.
GOVERNED BY: DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError } from '@open-twin/fhir-core';
import type { z } from 'zod';
import { WHOOP_API_BASE, WHOOP_PATHS } from '../api/paths';
import type { WhoopCycle } from '../api/schemas/cycle';
import { WhoopCycleSchema } from '../api/schemas/cycle';
import type { WhoopRecovery } from '../api/schemas/recovery';
import { WhoopRecoverySchema } from '../api/schemas/recovery';
import type { WhoopSleep } from '../api/schemas/sleep';
import { WhoopSleepSchema } from '../api/schemas/sleep';
import type { WhoopSyncPayload } from '../api/schemas/sync';
import { WhoopCollectionSchema } from '../api/schemas/sync';
import { CONNECTOR } from '../fhir/mappers/shared';
import { whoopHttpError } from './errorMessageHandler';
import type { TokenHandler } from './tokenUtils';

/** Hard cap so a stuck next_token cannot loop forever. */
export const WHOOP_MAX_PAGES = 100;

async function fetchCollection<T>(
  path: string,
  accessToken: string,
  query: Record<string, string>,
  recordSchema: z.ZodType<T>,
  operation: string
): Promise<T[]> {
  const collectionSchema = WhoopCollectionSchema(recordSchema);
  const records: T[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < WHOOP_MAX_PAGES; page++) {
    const url = new URL(`${WHOOP_API_BASE}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('limit', '25');
    if (nextToken) url.searchParams.set('nextToken', nextToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw whoopHttpError(response, operation);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ConnectorError('Whoop API returned a non-JSON body', {
        code: 'transport',
        connector: CONNECTOR.connector,
        status: response.status,
        operation
      });
    }

    const parsed = collectionSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ConnectorError('Whoop collection response did not match the expected shape', {
        code: 'validation',
        connector: CONNECTOR.connector,
        status: response.status,
        operation
      });
    }

    records.push(...parsed.data.records);
    const token = parsed.data.next_token;
    if (!token) return records;
    nextToken = token;
  }

  return records;
}

export interface WhoopWindow {
  start: string;
  end: string;
}

export async function fetchWhoopSyncPayload(
  window: WhoopWindow,
  tokenHandler: TokenHandler
): Promise<{ data: WhoopSyncPayload; errors: ConnectorError[] }> {
  const accessToken = await tokenHandler.getAccessToken();
  const query = { start: window.start, end: window.end };
  const errors: ConnectorError[] = [];

  const fetchOne = async <T>(path: string, schema: z.ZodType<T>, label: string): Promise<T[]> => {
    try {
      return await fetchCollection(path, accessToken, query, schema, `GET ${path}`);
    } catch (error) {
      errors.push(
        error instanceof ConnectorError
          ? error
          : new ConnectorError(`Failed to fetch ${label}`, {
              code: 'transport',
              connector: CONNECTOR.connector,
              operation: `GET ${path}`
            })
      );
      return [];
    }
  };

  const [recovery, cycles, sleep] = await Promise.all([
    fetchOne<WhoopRecovery>(WHOOP_PATHS.recovery, WhoopRecoverySchema, 'recovery'),
    fetchOne<WhoopCycle>(WHOOP_PATHS.cycle, WhoopCycleSchema, 'cycles'),
    fetchOne<WhoopSleep>(WHOOP_PATHS.sleep, WhoopSleepSchema, 'sleep')
  ]);

  return { data: { recovery, cycles, sleep }, errors };
}
