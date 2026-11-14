/**
 * WHAT: HTTP client for a vendor API, including auth token handling in-process.
 * NOT:  Must not emit FHIR or log response bodies; mapping and ConnectorError own those duties.
GOVERNED BY: DECISIONS.md#d8
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError } from '@open-twin/fhir-core';
import type { WhoopAppConfig } from '../config/config';
import { CONNECTOR } from '../fhir/mappers/shared';
import { whoopHttpError } from '../utils/errorMessageHandler';
import { type TokenResponse, TokenResponseSchema } from './schemas/auth';

export const WHOOP_SCOPES = [
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:workout',
  'read:profile',
  'offline'
] as const;

export type WhoopScope = (typeof WHOOP_SCOPES)[number];

export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

/** Whoop requires OAuth `state` to be exactly 8 characters. */
export function createWhoopOAuthState(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

export function getWhoopAuthorizationUrl(config: WhoopAppConfig, state: string): string {
  if (!config.clientId || !config.redirectUri) {
    throw new ConnectorError('Missing required OAuth parameters (client_id, redirect_uri)', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'authorize'
    });
  }
  if (state.length !== 8) {
    throw new ConnectorError('Whoop OAuth state must be exactly 8 characters', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'authorize'
    });
  }

  const scopes = config.scopes ?? [...WHOOP_SCOPES];
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state
  });
  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}

async function requestToken(body: URLSearchParams, operation: string): Promise<TokenResponse> {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) throw whoopHttpError(response, operation);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ConnectorError('Whoop token endpoint returned a non-JSON body', {
      code: 'transport',
      connector: CONNECTOR.connector,
      status: response.status,
      operation
    });
  }

  const parseResult = TokenResponseSchema.safeParse(payload);
  if (!parseResult.success) {
    throw new ConnectorError('Whoop token response did not match the expected shape', {
      code: 'validation',
      connector: CONNECTOR.connector,
      status: response.status,
      operation
    });
  }

  return parseResult.data;
}

export async function exchangeWhoopCode(code: string, config: WhoopAppConfig): Promise<TokenResponse> {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new ConnectorError('Missing required OAuth parameters', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'POST oauth/token'
    });
  }

  return await requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    }),
    'POST oauth/token'
  );
}

export async function refreshWhoopToken(refreshToken: string, config: WhoopAppConfig): Promise<TokenResponse> {
  if (!config.clientId || !config.clientSecret) {
    throw new ConnectorError('Missing required OAuth parameters', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'POST oauth/token (refresh)'
    });
  }

  return await requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: 'offline'
    }),
    'POST oauth/token (refresh)'
  );
}
