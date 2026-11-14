/**
 * WHAT: Shared non-clinical utilities for the connector package.
 * NOT:  Must not choose terminology or units.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError } from '@open-twin/fhir-core';
import type { z } from 'zod';
import { PersonalSchema } from '../api/schemas/personal';
import type { SupportedScope } from '../config/constants';
import { CONNECTOR } from '../fhir/mappers/shared';
import { LIST_SCHEMAS, type OuraTypedData } from './typeUtils';

/**
 * Describes a schema mismatch without quoting the payload.
 *
 * The previous version threw `new Error(msg, { cause: { listOfSupportedSchemas,
 * params } })`, where `params` was the entire raw Oura response — a full biometric
 * record. `Error.cause` is serialised by most error reporters and by Node's own
 * uncaught-exception printer, so every parse failure wrote health data into the
 * logs. Field *names* are structural and describe the shape; field values are the
 * data, and they stay out.
 */
function schemaMismatch(type: SupportedScope, body: unknown, error: z.ZodError): ConnectorError {
  const paths = error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
    .join(', ');
  const record = Array.isArray((body as { data?: unknown })?.data)
    ? ((body as { data: unknown[] }).data[0] as Record<string, unknown> | undefined)
    : (body as Record<string, unknown> | undefined);
  const keys = record && typeof record === 'object' ? Object.keys(record).join(', ') : '(none)';

  return new ConnectorError(
    `Oura ${type} response did not match its schema. Failing paths: ${paths}. Received keys: ${keys}.`,
    { code: 'validation', connector: CONNECTOR.connector, operation: `GET usercollection/${type}` }
  );
}

/** Parses a response against the schema for the type that was requested (D5). */
export function parseOuraResponse(type: SupportedScope, body: unknown): OuraTypedData {
  if (type === 'personal_info') {
    const result = PersonalSchema.safeParse(body);
    if (!result.success) throw schemaMismatch(type, body, result.error);
    return { type, data: result.data };
  }

  const schema = LIST_SCHEMAS[type] as unknown as z.ZodType<unknown>;
  const result = schema.safeParse(body);
  if (!result.success) throw schemaMismatch(type, body, result.error);
  return { type, data: result.data } as OuraTypedData;
}
