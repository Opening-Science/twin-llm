import { useEffect, useState } from "react";

/**
 * Client-fetched connector status (Ark, GBD, BodyLoop) as three explicit
 * states. "loading" draws a skeleton; "failed" (network error, non-2xx or an
 * unexpected body) draws the Error badge, so a card never stays a skeleton.
 */

export type FetchedStatus<T> =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "ok"; payload: T }>
  | Readonly<{ state: "failed" }>;

export const statusFromBody = <T>(
  ok: boolean,
  body: unknown,
  isPayload: (value: unknown) => value is T,
): FetchedStatus<T> =>
  ok && isPayload(body) ? { state: "ok", payload: body } : { state: "failed" };

/** A fixed status for tests and previews; undefined means fetch it. */
export type StatusPreview<T> = T | "failed";

const initialStatus = <T>(preview: StatusPreview<T> | undefined): FetchedStatus<T> => {
  if (preview === undefined) return { state: "loading" };
  return preview === "failed" ? { state: "failed" } : { state: "ok", payload: preview };
};

export const useConnectorStatus = <T>(
  url: string,
  isPayload: (value: unknown) => value is T,
  preview: StatusPreview<T> | undefined,
) => {
  const [status, setStatus] = useState<FetchedStatus<T>>(() => initialStatus(preview));

  useEffect(() => {
    if (preview !== undefined) return;
    let cancelled = false;
    void fetch(url)
      .then(async (response) => {
        const body: unknown = response.ok ? await response.json() : null;
        if (!cancelled) setStatus(statusFromBody(response.ok, body, isPayload));
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [url, isPayload, preview]);

  const setPayload = (payload: T) => setStatus({ state: "ok", payload });
  return [status, setPayload] as const;
};
