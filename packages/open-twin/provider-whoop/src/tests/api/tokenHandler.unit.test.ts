/**
 * WHAT: Regression tests for token snapshots and restored expiry.
 * NOT: Must not call the live WHOOP API or use real credentials.
 * GOVERNED BY: DECISIONS.md#d8; DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError } from '@open-twin/fhir-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenResponse } from '../../api/schemas/auth';
import type { WhoopAppConfig } from '../../config/config';
import { TokenHandler } from '../../utils/tokenUtils';

const config: WhoopAppConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://example.com/callback'
};

const t0 = Date.parse('2026-01-01T00:00:00.000Z');

const storedPair: TokenResponse = {
  access_token: 'whoop_access',
  token_type: 'bearer',
  expires_in: 60,
  refresh_token: 'whoop_refresh',
  scope: 'offline read:recovery'
};

const exchangedPair: TokenResponse = {
  access_token: 'whoop_exchanged',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'whoop_refresh_1',
  scope: 'offline read:recovery'
};

const refreshedPair: TokenResponse = {
  access_token: 'whoop_refreshed',
  token_type: 'bearer',
  expires_in: 7200,
  refresh_token: 'whoop_refresh_new',
  scope: 'offline read:recovery'
};

function jsonResponse(body: TokenResponse): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response;
}

describe('TokenHandler token persistence', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(t0);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('refreshes a 60s token restored 120s later with its stored expiresAt', async () => {
    const stored = { tokens: storedPair, expiresAt: t0 + 60_000 };
    vi.setSystemTime(t0 + 120_000);
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(refreshedPair));
    const restored = new TokenHandler(config, 'authorization-code');
    restored.setTokens(stored.tokens, stored.expiresAt);

    expect(await restored.getAccessToken()).toBe('whoop_refreshed');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(restored.getTokens()).toEqual({
      tokens: {
        access_token: 'whoop_refreshed',
        token_type: 'bearer',
        expires_in: 7200,
        refresh_token: 'whoop_refresh_new',
        scope: 'offline read:recovery'
      },
      expiresAt: t0 + 120_000 + 7200 * 1000
    });
  });

  it('one-argument setTokens treats expires_in as seconds from now', async () => {
    vi.setSystemTime(t0 + 120_000);
    const handler = new TokenHandler(config, 'authorization-code');
    handler.setTokens(storedPair);

    expect(await handler.getAccessToken()).toBe('whoop_access');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(handler.getTokens()).toEqual({
      tokens: {
        access_token: 'whoop_access',
        token_type: 'bearer',
        expires_in: 60,
        refresh_token: 'whoop_refresh',
        scope: 'offline read:recovery'
      },
      expiresAt: t0 + 180_000
    });
  });

  it('returns undefined before authenticate or setTokens', () => {
    expect(new TokenHandler(config, 'authorization-code').getTokens()).toBeUndefined();
  });

  it('returns a detached envelope and tokens so host mutation cannot change live state', () => {
    const handler = new TokenHandler(config, 'authorization-code');
    handler.setTokens(storedPair);
    const snapshot = handler.getTokens();
    if (!snapshot) throw new Error('expected tokens after setTokens');
    snapshot.tokens.access_token = 'mutated';
    snapshot.tokens.refresh_token = 'mutated-refresh';
    snapshot.tokens.scope = 'mutated-scope';
    snapshot.tokens.expires_in = 0;
    snapshot.tokens.token_type = 'mutated-type';
    snapshot.expiresAt = 0;
    snapshot.tokens = exchangedPair;

    expect(handler.getTokens()).toEqual({
      tokens: {
        access_token: 'whoop_access',
        token_type: 'bearer',
        expires_in: 60,
        refresh_token: 'whoop_refresh',
        scope: 'offline read:recovery'
      },
      expiresAt: t0 + 60_000
    });
  });

  it('returns the pair setTokens stored and its computed expiry', () => {
    const handler = new TokenHandler(config, 'authorization-code');
    handler.setTokens(storedPair);
    expect(handler.getTokens()).toEqual({
      tokens: {
        access_token: 'whoop_access',
        token_type: 'bearer',
        expires_in: 60,
        refresh_token: 'whoop_refresh',
        scope: 'offline read:recovery'
      },
      expiresAt: t0 + 60_000
    });
  });

  it('returns the pair authenticate stored', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(exchangedPair));
    const handler = new TokenHandler(config, 'authorization-code');
    await handler.authenticate();
    expect(handler.getTokens()).toEqual({
      tokens: {
        access_token: 'whoop_exchanged',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'whoop_refresh_1',
        scope: 'offline read:recovery'
      },
      expiresAt: t0 + 3600 * 1000
    });
  });

  it('returns the rotated pair after refresh', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(refreshedPair));
    const handler = new TokenHandler(config, 'authorization-code');
    handler.setTokens({ ...storedPair, expires_in: 0 });
    expect(await handler.getAccessToken()).toBe('whoop_refreshed');
    expect(handler.getTokens()).toEqual({
      tokens: {
        access_token: 'whoop_refreshed',
        token_type: 'bearer',
        expires_in: 7200,
        refresh_token: 'whoop_refresh_new',
        scope: 'offline read:recovery'
      },
      expiresAt: t0 + 7200 * 1000
    });
  });

  it('preserves an explicit zero expiry and refreshes before access', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(refreshedPair));
    const handler = new TokenHandler(config, 'authorization-code');
    handler.setTokens(storedPair, 0);
    expect(handler.getTokens()?.expiresAt).toBe(0);
    expect(await handler.getAccessToken()).toBe('whoop_refreshed');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a failed token HTTP without quoting tokens, credentials or the authorization code', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: vi.fn()
    } as unknown as Response);

    const error = await new TokenHandler(config, 'authorization-code')
      .authenticate()
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'auth', status: 401, operation: 'POST oauth/token' });
    expect((error as ConnectorError).message).toBe('Authentication failed or the token lacks the required scope');
    expect((error as ConnectorError).message).not.toContain('whoop_access');
    expect((error as ConnectorError).message).not.toContain('whoop_refresh');
    expect((error as ConnectorError).message).not.toContain('test-client-secret');
    expect((error as ConnectorError).message).not.toContain('authorization-code');
  });
});
