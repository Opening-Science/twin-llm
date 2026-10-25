/**
 * Request checks for auth-off mode (LOCAL_MVP / AUTH_DISABLED).
 *
 * With auth off, whoever reaches the server is treated as the data owner, so
 * the server must only be reachable as "this machine, from this app":
 *
 * - The Host header must name a loopback address. A LAN client uses the
 *   machine's network address, and a DNS-rebinding page uses its own name,
 *   so both are refused.
 * - Forwarded client addresses, when present, must all be loopback.
 * - A state-changing request coming from a browser must come from this app:
 *   `Sec-Fetch-Site` must be same-origin (or none), and `Origin` must be a
 *   loopback origin. A request with neither header is a non-browser client
 *   on this machine (curl, a script) and is allowed.
 *
 * Binding the server to 127.0.0.1 (`bun run dev`, `bun run start`) is still
 * the first line of defence; these checks cover the cases it cannot.
 * Pure, so it is tested with plain `Request` objects.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const IPV4_LOOPBACK = /^127(\.(25[0-5]|2[0-4]\d|1\d\d|\d?\d)){3}$/;

/** True for `localhost`, `127.0.0.0/8` and `::1`, with or without brackets. */
export const isLoopbackHostname = (hostname: string): boolean => {
  const name = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    name === "localhost" ||
    name === "::1" ||
    name === "::ffff:127.0.0.1" ||
    IPV4_LOOPBACK.test(name)
  );
};

/** The host name of a `Host` header value (`name:port`, `[v6]:port`). */
const hostnameOfHostHeader = (value: string): string | null => {
  const parsed = URL.canParse(`http://${value}`) ? new URL(`http://${value}`) : null;
  return parsed === null || parsed.host !== value.toLowerCase() ? null : parsed.hostname;
};

const loopbackOrigin = (origin: string): boolean => {
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    isLoopbackHostname(url.hostname)
  );
};

export type AuthOffRefusal = Readonly<{
  status: 403 | 421;
  /** Short reason for the server log; never shown with request details. */
  reason: "host" | "forwarded" | "origin" | "fetch-site";
}>;

/** Null when the request may proceed in auth-off mode. */
export const checkAuthOffRequest = (request: Request): AuthOffRefusal | null => {
  const { headers } = request;

  const host = headers.get("host");
  const hostname = host === null ? null : hostnameOfHostHeader(host);
  if (hostname === null || !isLoopbackHostname(hostname)) {
    return { status: 421, reason: "host" };
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const hops = forwarded.split(",").map((hop) => hop.trim());
    if (!hops.every(isLoopbackHostname)) return { status: 403, reason: "forwarded" };
  }

  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { status: 403, reason: "fetch-site" };
  }
  const origin = headers.get("origin");
  if (origin !== null && !loopbackOrigin(origin)) {
    return { status: 403, reason: "origin" };
  }
  return null;
};

/** The plain response sent for a refusal; it names no header or value. */
export const authOffRefusalResponse = (refusal: AuthOffRefusal): Response =>
  new Response(
    "This TwinLLM server runs without sign-in and only answers requests from this machine.",
    { status: refusal.status, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
