import "server-only";

import { TokenHandler, type OuraRingAppConfig } from "@open-twin/provider-oura";
import type { TokenResponse } from "@open-twin/provider-oura/api/schemas/auth";

export { getAuthorizationUrl } from "./oura-authorize";

/**
 * Capture the last pair via setTokens so the host can persist after OAuth /
 * refresh without patching open-twin. Upstream now has its own getTokens()
 * (open-twin#169, returns the pair plus an absolute expiresAt); this keeps the
 * host's expires_in flow under its own name until the switch is done.
 */
export class HostOuraTokenHandler extends TokenHandler {
  #lastTokens: TokenResponse | null = null;

  constructor(config: OuraRingAppConfig, authorizationToken: string) {
    super(config, authorizationToken);
  }

  override setTokens(tokenResponse: TokenResponse, expiresAt?: number): void {
    this.#lastTokens = tokenResponse;
    super.setTokens(tokenResponse, expiresAt);
  }

  lastTokens(): TokenResponse | null {
    return this.#lastTokens;
  }
}
