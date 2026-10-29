/**
 * What `proxy.ts` does with a request for the generator's own host name
 * (`SYNTHEA_HOST`, synthea.opening.science by default). On that host the
 * generator is the whole site: `/` is the generator, `/docs` its docs page,
 * and the job API answers. Every other path is not found, so no other part of
 * TwinLLM can be reached through that name. Requests for any other host are
 * left alone.
 */

export type HostRoute =
  | Readonly<{ kind: "other-host" }>
  | Readonly<{ kind: "rewrite"; pathname: string }>
  | Readonly<{ kind: "pass" }>
  | Readonly<{ kind: "not-found" }>;

const REWRITES: Readonly<Record<string, string>> = {
  "/": "/synthea",
  "/docs": "/synthea/docs",
};

const PASS = new Set(["/synthea", "/synthea/docs"]);
const API_PREFIX = "/api/synthea/";

/** The host name of a Host header, lower case and without a port. */
export const hostnameOf = (host: string | null): string | null => {
  if (host === null) return null;
  const value = `http://${host.trim()}`;
  return URL.canParse(value) ? new URL(value).hostname.toLowerCase() : null;
};

export const syntheaHostRoute = (
  host: string | null,
  pathname: string,
  syntheaHost: string,
): HostRoute => {
  if (hostnameOf(host) !== syntheaHost.toLowerCase()) return { kind: "other-host" };
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const rewrite = REWRITES[path];
  if (rewrite !== undefined) return { kind: "rewrite", pathname: rewrite };
  if (PASS.has(path) || path.startsWith(API_PREFIX)) return { kind: "pass" };
  return { kind: "not-found" };
};
