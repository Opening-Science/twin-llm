import { ConnectorError } from '@open-twin/fhir-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '../../api/client';
import type { OuraRingAppConfig } from '../../config/config';
import { getAuthorizationUrl } from '../../index';

describe('Oura OAuth client', () => {
  const config: OuraRingAppConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://example.com/callback'
  };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('reports an OAuth HTTP failure with its status without exposing the body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: vi.fn()
    } as unknown as Response);

    const error = await getAccessToken('authorization-code', config).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'auth', status: 401, operation: 'POST oauth/token' });
    expect((error as ConnectorError).message).not.toContain('authorization-code');
  });

  it('reports a non-JSON successful-status response as a typed transport failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 502,
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <'))
    } as unknown as Response);

    const error = await getAccessToken('authorization-code', config).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'transport', status: 502, operation: 'POST oauth/token' });
  });

  it('rejects a missing clientId as validation/authorize', () => {
    let error: unknown;
    try {
      getAuthorizationUrl({ ...config, clientId: '' });
    } catch (reason: unknown) {
      error = reason;
    }
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'validation', operation: 'authorize' });
    expect((error as ConnectorError).message).not.toContain('test-client-secret');
  });

  it('rejects a missing redirectUri as validation/authorize', () => {
    let error: unknown;
    try {
      getAuthorizationUrl({ ...config, redirectUri: '' });
    } catch (reason: unknown) {
      error = reason;
    }
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'validation', operation: 'authorize' });
  });

  it('omits state from the authorize URL when it is not passed', () => {
    const url = new URL(getAuthorizationUrl(config));
    expect(url.searchParams.has('state')).toBe(false);
  });

  it('includes a non-empty state query parameter', () => {
    const url = new URL(getAuthorizationUrl(config, 'csrf-token'));
    expect(url.searchParams.get('state')).toBe('csrf-token');
  });

  it('omits state when the value is an empty string', () => {
    const url = new URL(getAuthorizationUrl(config, ''));
    expect(url.searchParams.has('state')).toBe(false);
  });
});
