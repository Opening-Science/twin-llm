/**
 * WHAT: Shared non-clinical utilities for the connector package.
 * NOT:  Must not choose terminology or units.
GOVERNED BY: DECISIONS.md#d8; DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError } from '@open-twin/fhir-core';
import { exchangeWhoopCode, refreshWhoopToken } from '../api/client';
import type { TokenResponse } from '../api/schemas/auth';
import type { WhoopAppConfig } from '../config/config';
import { CONNECTOR } from '../fhir/mappers/shared';

export class TokenHandler {
  private tokenContainer: TokenResponse | null = null;
  private expiresAt: number | null = null;
  private config: WhoopAppConfig;
  private authToken: string;
  private refreshInFlight: Promise<TokenResponse> | null = null;

  constructor(config: WhoopAppConfig, authorizationToken: string) {
    this.config = config;
    this.authToken = authorizationToken;
  }

  async authenticate(): Promise<void> {
    if (!this.authToken) {
      throw new ConnectorError('No authorization code provided', {
        code: 'auth',
        connector: CONNECTOR.connector,
        operation: 'authenticate'
      });
    }
    this.setTokens(await exchangeWhoopCode(this.authToken, this.config));
  }

  async getAccessToken(): Promise<string> {
    if (this.tokenContainer && this.expiresAt && Date.now() < this.expiresAt) {
      return this.tokenContainer.access_token;
    }

    const refreshToken = this.tokenContainer?.refresh_token;
    if (refreshToken) {
      if (!this.refreshInFlight) {
        this.refreshInFlight = refreshWhoopToken(refreshToken, this.config).finally(() => {
          this.refreshInFlight = null;
        });
      }
      const tokenResponse = await this.refreshInFlight;
      this.setTokens(tokenResponse);
      return tokenResponse.access_token;
    }

    throw new ConnectorError('No access token or refresh token available; authenticate first', {
      code: 'auth',
      connector: CONNECTOR.connector,
      operation: 'getAccessToken'
    });
  }

  setTokens(tokenResponse: TokenResponse, expiresAt?: number): void {
    this.tokenContainer = tokenResponse;
    this.expiresAt = expiresAt ?? Date.now() + tokenResponse.expires_in * 1000;
  }

  /** Host persistence must not alias the in-memory container. */
  getTokens(): { tokens: TokenResponse; expiresAt: number } | undefined {
    if (!this.tokenContainer || this.expiresAt == null) return undefined;
    return { tokens: { ...this.tokenContainer }, expiresAt: this.expiresAt };
  }
}
