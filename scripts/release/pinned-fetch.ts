/**
 * Downloading a pinned file: follow redirects only to allowed hosts, and read
 * no more bytes than the pin says. Used by `anatomy:fetch` and by `setup:local`
 * for the evaluation cohort. The caller checks the SHA-256.
 */

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 3;

export class RedirectRefusedError extends Error {}

export class TooLargeError extends Error {}

/**
 * Fetches `url`, following at most MAX_REDIRECTS redirects and only to an
 * https URL on one of `hosts`. Without hosts, any redirect is an error.
 */
export const fetchPinned = async (
  fetchFn: FetchFn,
  url: string,
  hosts: readonly string[] | undefined,
): Promise<Response> => {
  if (!hosts) return fetchFn(url, { redirect: "error" });
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchFn(current, { redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    // Release the redirect's own body, or the connection stays busy.
    await response.body?.cancel().catch(() => undefined);
    const location = response.headers.get("location");
    const next = location === null ? null : new URL(location, current);
    if (next === null || next.protocol !== "https:" || !hosts.includes(next.hostname)) {
      throw new RedirectRefusedError();
    }
    current = next.toString();
  }
  throw new RedirectRefusedError();
};

/** Reads at most `max` bytes; throws TooLargeError past that. */
export const readBounded = async (
  response: Response,
  max: number,
): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new TooLargeError();
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.byteLength > max) throw new TooLargeError();
    return whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new TooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};
