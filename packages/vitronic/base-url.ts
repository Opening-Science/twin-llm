import { isIP } from "node:net";

/**
 * The scanner base URL is operator input that the server later dials with a bearer
 * token, so it is reduced to a bare https origin before it is stored or used. Every
 * request path is then resolved against that origin and checked again, so nothing in
 * the stored value can steer a request off the GET allowlist.
 *
 * http is never accepted: every request is pinned to the scanner's TLS certificate.
 * Scanners sit on the local network, so private ranges are allowed. Loopback,
 * link-local, unspecified, multicast and broadcast addresses are refused unless the
 * operator lists the host in `VITRONIC_SCANNER_HOSTS`; when that list is set, it is
 * the only set of hosts accepted.
 */

export type ScannerUrlPolicy = Readonly<{
  /** Lower-case hostnames or IP literals. Empty means "no operator allowlist". */
  allowedHosts?: readonly string[];
}>;

export type ScannerUrlRejection =
  | "unparseable"
  | "not-https"
  | "credentials"
  | "path"
  | "query"
  | "fragment"
  | "port"
  | "host-not-allowed";

export class ScannerUrlRejectedError extends Error {
  readonly reason: ScannerUrlRejection;
  constructor(reason: ScannerUrlRejection) {
    super(`vitronic-base-url-${reason}`);
    this.name = "ScannerUrlRejectedError";
    this.reason = reason;
  }
}

const MIN_EXPLICIT_PORT = 1024;

const ipv4Octets = (host: string): readonly number[] | null =>
  isIP(host) === 4 ? host.split(".").map(Number) : null;

const reservedIpv4 = (octets: readonly number[]): boolean => {
  const [a = 0, b = 0] = octets;
  if (a === 0) return true; // unspecified / "this network"
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
};

const embeddedIpv4 = (host: string): readonly number[] | null => {
  // WHATWG URL writes ::ffff:127.0.0.1 as ::ffff:7f00:1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!mapped) return null;
  const high = Number.parseInt(mapped[1] ?? "", 16);
  const low = Number.parseInt(mapped[2] ?? "", 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
};

const reservedIpv6 = (host: string): boolean => {
  if (host === "::" || host === "::1") return true;
  const mapped = embeddedIpv4(host);
  if (mapped) return reservedIpv4(mapped);
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
  if (host.startsWith("ff")) return true; // multicast
  return false;
};

/** Host as compared against the allowlist: lower case, IPv6 without brackets. */
export const scannerHostKey = (hostname: string): string =>
  hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");

export const isReservedScannerHost = (hostname: string): boolean => {
  const host = scannerHostKey(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = ipv4Octets(host);
  if (v4) return reservedIpv4(v4);
  if (isIP(host) === 6) return reservedIpv6(host);
  return false;
};

const portAllowed = (port: string): boolean => {
  if (port === "") return true; // 443 by scheme default
  const value = Number(port);
  return value === 443 || (value >= MIN_EXPLICIT_PORT && value <= 65535);
};

/** Returns the bare origin (`https://host[:port]`) or throws ScannerUrlRejectedError. */
export const scannerOrigin = (raw: string, policy: ScannerUrlPolicy = {}): string => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ScannerUrlRejectedError("unparseable");
  }
  if (url.protocol !== "https:") throw new ScannerUrlRejectedError("not-https");
  if (url.username !== "" || url.password !== "") {
    throw new ScannerUrlRejectedError("credentials");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ScannerUrlRejectedError("path");
  }
  if (url.search !== "" || raw.includes("?")) throw new ScannerUrlRejectedError("query");
  if (url.hash !== "" || raw.includes("#")) throw new ScannerUrlRejectedError("fragment");
  if (!portAllowed(url.port)) throw new ScannerUrlRejectedError("port");

  const host = scannerHostKey(url.hostname);
  const allowed = policy.allowedHosts ?? [];
  if (allowed.length > 0) {
    if (!allowed.includes(host)) throw new ScannerUrlRejectedError("host-not-allowed");
  } else if (isReservedScannerHost(host)) {
    throw new ScannerUrlRejectedError("host-not-allowed");
  }
  return url.origin;
};

/** Parses `VITRONIC_SCANNER_HOSTS` (comma separated) into allowlist keys. */
export const parseScannerHosts = (value: string | undefined): readonly string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => scannerHostKey(entry.trim()))
    .filter((entry) => entry.length > 0);

/**
 * Resolves an allowlisted path against a validated origin and confirms the result
 * stayed on that origin with exactly that path, so a stored value cannot add a
 * prefix, query or fragment to the request.
 */
export const scannerRequestUrl = (origin: string, path: string): string => {
  const url = new URL(path, `${origin}/`);
  if (
    url.origin !== origin ||
    url.pathname !== path ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("vitronic-path-not-allowed");
  }
  return url.toString();
};
