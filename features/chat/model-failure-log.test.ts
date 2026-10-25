import { APICallError, RetryError } from "ai";
import { describe, expect, test } from "bun:test";

import { errorNameOf, modelFailureLog } from "./model-failure-log";

const SECRETS = [
  "test-token-not-a-secret",
  "gpu1.internal.example",
  "My HRV was 31 ms",
  "x-request-secret",
];

const providerFailure = (statusCode: number) =>
  new APICallError({
    message: `upstream said: My HRV was 31 ms, key test-token-not-a-secret`,
    url: "https://gpu1.internal.example/v1/chat/completions?key=test-token-not-a-secret",
    requestBodyValues: { messages: [{ role: "user", content: "My HRV was 31 ms" }] },
    responseHeaders: { "x-request-secret": "abc" },
    responseBody: '{"detail":"My HRV was 31 ms is not valid"}',
    statusCode,
    data: { detail: "My HRV was 31 ms" },
  });

const expectNothingSecret = (logged: unknown) => {
  const text = JSON.stringify(logged);
  SECRETS.forEach((secret) => expect(text).not.toContain(secret));
};

describe("modelFailureLog", () => {
  test("keeps name and status of a provider error, drops URL, headers and bodies", () => {
    const logged = modelFailureLog(providerFailure(400));
    expect(logged).toEqual({ name: "AI_APICallError", status: 400, code: "other" });
    expectNothingSecret(logged);
  });

  test("unwraps a retry wrapper to the last attempt", () => {
    const wrapped = new RetryError({
      message: "Failed after 3 attempts. Last error: My HRV was 31 ms",
      reason: "maxRetriesExceeded",
      errors: [providerFailure(500), providerFailure(503)],
    });
    const logged = modelFailureLog(wrapped);
    expect(logged).toEqual({ name: "AI_APICallError", status: 503, code: "other" });
    expectNothingSecret(logged);
  });

  test("a plain error is reduced to its class name", () => {
    const logged = modelFailureLog(
      new TypeError("fetch failed for test-token-not-a-secret"),
    );
    expect(logged).toEqual({ name: "TypeError", code: "other" });
    expectNothingSecret(logged);
  });

  test("a non-error value is named by its type", () => {
    expect(modelFailureLog("My HRV was 31 ms")).toEqual({
      name: "string",
      code: "other",
    });
  });
});

describe("errorNameOf", () => {
  test("returns only the class name", () => {
    expect(errorNameOf(new RangeError("row value 31"))).toBe("RangeError");
    expect(errorNameOf({ message: "row value 31" })).toBe("object");
  });
});
