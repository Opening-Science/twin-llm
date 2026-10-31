import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, type LiveSourceId } from "./constants";
import { isAllowedUrl, type LiveRequest } from "./disclosure";

/**
 * The one place the live tools reach the network. It only sends a GET to an
 * allowlisted https origin, never follows a redirect, waits its turn per
 * service (`spacing.ts`), stops after `REQUEST_TIMEOUT_MS` and reads at most
 * `MAX_RESPONSE_BYTES`. It does not write the ledger itself: `tools.ts`
 * records each request before it calls this, and does not call it when the
 * record fails. The fetch is passed in, so tests use recorded fixtures.
 */

export type LiveResponse = Readonly<{ status: number; body: string }>;

export type LiveFetch = (request: LiveRequest) => Promise<LiveResponse>;

export class LiveFetchError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "LiveFetchError";
  }
}

const readCapped = async (response: Response, maxBytes: number): Promise<string> => {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new LiveFetchError("LIVE_RESPONSE_TOO_LARGE");
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const read = async (total: number): Promise<number> => {
    const { done, value } = await reader.read();
    if (done) return total;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel();
      throw new LiveFetchError("LIVE_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
    return read(total + value.byteLength);
  };
  await read(0);
  return Buffer.concat(chunks).toString("utf8");
};

export const createLiveFetch =
  (
    deps: Readonly<{
      fetchFn: typeof fetch;
      spacing: Readonly<Record<LiveSourceId, () => Promise<void>>>;
      timeoutMs?: number;
      maxBytes?: number;
    }>,
  ): LiveFetch =>
  async (request) => {
    if (!isAllowedUrl(request.url)) throw new LiveFetchError("LIVE_ORIGIN_NOT_ALLOWED");
    await deps.spacing[request.source]();
    const response = await deps.fetchFn(request.url, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: request.step === "efetch" ? "application/xml" : "application/json",
      },
      signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    return {
      status: response.status,
      body: await readCapped(response, deps.maxBytes ?? MAX_RESPONSE_BYTES),
    };
  };
