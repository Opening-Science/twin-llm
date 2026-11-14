import { ConnectorError } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import { GoogleHealthClient, getDataTypes } from '../../index';

function unauthenticatedClient(): GoogleHealthClient {
  return new GoogleHealthClient({
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://example.invalid/callback'
  });
}

describe('getDataTypes authentication guard', () => {
  it('refuses a client that was never initialized', async () => {
    // `getAccessToken()` returns a Promise, and a Promise object is always truthy, so
    // the previous `if (!auth.getAccessToken())` guard could never fire: an
    // unauthenticated client sailed past it and failed later inside the Google client.
    await expect(getDataTypes({ client: unauthenticatedClient(), types: ['heart-rate'] })).rejects.toThrow(
      ConnectorError
    );
  });

  it('names the remedy without quoting anything from the wire', async () => {
    let error: ConnectorError | undefined;
    try {
      await getDataTypes({ client: unauthenticatedClient(), types: ['heart-rate'] });
    } catch (thrown) {
      error = thrown as ConnectorError;
    }

    expect(error).toBeInstanceOf(ConnectorError);
    if (!error) throw new Error('expected getDataTypes to throw');
    expect(error.code).toBe('auth');
    expect(error.connector).toBe('google-health');
    expect(error.retryable).toBe(false);
    expect(error.cause).toBeUndefined();
  });
});
