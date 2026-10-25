import "server-only";

import { health } from "@googleapis/health";
import type { GoogleHealthClient } from "@open-twin/provider-google-health";
import type { Auth, health_v4 } from "googleapis";

/**
 * Upstream GoogleHealthClient keeps oauth2Client private and has no
 * setCredentials / getCredentials. TwinLLM restores DB tokens through these
 * host helpers without modifying the synced package sources.
 */
type GoogleHealthClientInternals = {
  oauth2Client: Auth.OAuth2Client;
  client: health_v4.Health;
};

const internals = (client: GoogleHealthClient): GoogleHealthClientInternals =>
  client as unknown as GoogleHealthClientInternals;

export const setGoogleHealthCredentials = (
  client: GoogleHealthClient,
  tokens: Auth.Credentials,
): void => {
  const inner = internals(client);
  inner.oauth2Client.setCredentials(tokens);
  // Bun can resolve two google-auth-library copies; shapes match at runtime.
  inner.client = health({
    version: "v4",
    auth: inner.oauth2Client as never,
  });
};

export const getGoogleHealthCredentials = (
  client: GoogleHealthClient,
): Auth.Credentials => internals(client).oauth2Client.credentials;

export const ensureGoogleHealthAccessToken = async (
  client: GoogleHealthClient,
): Promise<string> => {
  const result = await internals(client).oauth2Client.getAccessToken();
  const token = typeof result === "string" ? result : result?.token;
  if (!token) {
    throw new Error(
      "Access token is required. Authenticate the client first using initializeGoogleHealthClient.",
    );
  }
  return token;
};
