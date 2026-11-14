/**
 * WHAT: HTTP client for a vendor API, including auth token handling in-process.
 * NOT:  Must not emit FHIR or log response bodies; mapping and ConnectorError own those duties.
GOVERNED BY: DECISIONS.md#d8
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Hosts still need durable token persistence; TokenStore interfaces are not implemented in-tree.
 */
import { ConnectorError } from '@open-twin/fhir-core';
import type { OuraRingAppConfig } from '../config/config';
import { CONNECTOR } from '../fhir/mappers/shared';
import { ouraHttpError } from '../utils/errorMessageHandler';
import { getOuraOauthTokenUrl } from './endpoints';
import { type TokenResponse, TokenResponseSchema } from './schemas/auth';

export function getAuthorizationUrl(config: OuraRingAppConfig, state?: string): string {
  if (!config.clientId || !config.redirectUri) {
    throw new ConnectorError('Missing required OAuth parameters (client_id, redirect_uri)', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'authorize'
    });
  }

  const baseUrl = 'https://cloud.ouraring.com/oauth/authorize';
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: (config.scopes || []).join(' ')
  });
  if (state) {
    params.set('state', state);
  }

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Posts to the token endpoint and validates the result.
 *
 * The status was previously never checked: `.then((res) => res.json())` discarded
 * the Response, so a 502 with an HTML body surfaced as a bare
 * `SyntaxError: Unexpected token '<'` with the status lost entirely, and a 401
 * surfaced as a schema-parse failure. Nothing about the response body reaches the
 * thrown error — token endpoints echo credentials in their error payloads.
 */
async function requestToken(body: URLSearchParams, operation: string): Promise<TokenResponse> {
  const response = await fetch(getOuraOauthTokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) throw ouraHttpError(response, operation);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ConnectorError('Oura token endpoint returned a non-JSON body', {
      code: 'transport',
      connector: CONNECTOR.connector,
      status: response.status,
      operation
    });
  }

  const parseResult = TokenResponseSchema.safeParse(payload);
  if (!parseResult.success) {
    throw new ConnectorError('Oura token response did not match the expected shape', {
      code: 'validation',
      connector: CONNECTOR.connector,
      status: response.status,
      operation
    });
  }

  return parseResult.data;
}

export async function getAccessToken(code: string, config: OuraRingAppConfig): Promise<TokenResponse> {
  if (!config.clientId || !config.redirectUri) {
    throw new ConnectorError('Missing required OAuth parameters (client_id, redirect_uri)', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'POST oauth/token'
    });
  }

  return await requestToken(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri
    }),
    'POST oauth/token'
  );
}

export async function refreshAccessToken(refresh_token: string, config: OuraRingAppConfig): Promise<TokenResponse> {
  if (!config.clientId) {
    throw new ConnectorError('Missing required OAuth parameter: client_id', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'POST oauth/token (refresh)'
    });
  }

  return await requestToken(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token
    }),
    'POST oauth/token (refresh)'
  );
}
