/** The call shape every fetch wrapper here implements. */
export type FetchCall = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Turns a wrapper around `base` into a value of `typeof fetch`. Some runtimes
 * hang extra members on the global fetch (Bun adds `fetch.preconnect`), and
 * the AI SDK takes `typeof fetch`, so the wrapper carries `base`'s members.
 * Requests still go through `call`; `call` itself is left as it was.
 */
export const asFetch = (call: FetchCall, base: typeof fetch): typeof fetch =>
  Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => call(input, init),
    base,
  );
