// Upstream omits ./api/client from package exports + tsup entries; import source
// from the synced checkout (sync must not patch upstream *.ts). No server-only
// so smoke tests can import this symbol.
import { getAuthorizationUrl as upstreamGetAuthorizationUrl } from "../../.open-twin/packages/provider-oura/src/api/client";

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
