/**
 * True when a URL points at this machine: `localhost`, `127.0.0.0/8` or `[::1]`.
 * Used by LOCAL_ONLY mode to refuse any model or embedding endpoint elsewhere.
 * A hostname that merely resolves to loopback (a DNS trick) does not count.
 */
const LOOPBACK_NAMES = new Set(["localhost", "[::1]"]);
const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const isLoopbackUrl = (value: string): boolean => {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOOPBACK_NAMES.has(host)) return true;
  const ipv4 = IPV4_LOOPBACK.exec(host);
  return ipv4 !== null && ipv4.slice(1).every((octet) => Number(octet) <= 255);
};
