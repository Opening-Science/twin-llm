/**
 * WHAT: Shared non-clinical utilities for the connector package.
 * NOT:  Must not choose terminology or units.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { type ConnectorError, fromHttpStatus } from '@open-twin/fhir-core';
import { CONNECTOR } from '../fhir/mappers/shared';

export function whoopHttpError(response: Response, operation: string): ConnectorError {
  return fromHttpStatus(response.status, {
    connector: CONNECTOR.connector,
    operation
  });
}
