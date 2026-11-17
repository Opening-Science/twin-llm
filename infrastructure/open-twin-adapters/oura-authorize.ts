// Adds the OAuth state parameter, which upstream's URL builder leaves out. No
// server-only so smoke tests can import this symbol.
import { getAuthorizationUrl as upstreamGetAuthorizationUrl } from "@open-twin/provider-oura";

export const getAuthorizationUrl = (
  config: Parameters<typeof upstreamGetAuthorizationUrl>[0],
  state?: string,
): string => {
  const raw = upstreamGetAuthorizationUrl(config);
  if (!state) return raw;
  const url = new URL(raw);
  url.searchParams.set("state", state);
  return url.toString();
};
