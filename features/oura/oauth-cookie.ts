/** Shared cookie name for the Oura OAuth CSRF state (the state value is exactly 8 chars). */
export const OURA_OAUTH_STATE_COOKIE = "oura_oauth_state";

/** Host-side CSRF nonce. Same 4-byte hex as Whoop; Oura does not require 8 chars. */
export const createOuraOAuthState = (): string => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
};
