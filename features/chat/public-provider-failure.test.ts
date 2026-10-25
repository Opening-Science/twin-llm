import { APICallError } from "ai";
import { describe, expect, test } from "bun:test";

import { publicProviderFailure } from "./public-provider-failure";

const apiError = (data: unknown, statusCode?: number) =>
  new APICallError({
    message: "Bearer abc",
    url: "https://example.invalid/sk-test-123",
    requestBodyValues: { prompt: "Tell me about my recovery." },
    responseBody: "sk-test-123",
    statusCode,
    data,
  });

const allowedData = { error: { code: "insufficient_quota" } };

describe("publicProviderFailure", () => {
  test("keeps only an allowed code and valid status", () => {
    expect(publicProviderFailure(apiError(allowedData, 429))).toEqual({
      status: 429,
      code: "insufficient_quota",
    });
  });

  test("omits an absent status", () => {
    expect(publicProviderFailure(apiError(allowedData))).toEqual({
      code: "insufficient_quota",
    });
  });

  test.each([100, 599])("keeps HTTP boundary %s", (status) => {
    expect(publicProviderFailure(apiError(allowedData, status))).toEqual({
      status,
      code: "insufficient_quota",
    });
  });

  test.each([99, 600, 401.5, NaN, Infinity, "401", null])(
    "omits invalid status %s",
    (status) => {
      const error = apiError(allowedData);
      Object.defineProperty(error, "statusCode", { value: status });
      expect(publicProviderFailure(error)).toEqual({ code: "insufficient_quota" });
    },
  );

  test.each(["sk-test-123", "Bearer abc", "Tell me about my recovery."])(
    "rejects secret-looking fields: %s",
    (secret) => {
      for (const status of [undefined, 401]) {
        const error = apiError(
          { error: { code: secret, type: secret, message: secret } },
          status,
        );
        error.name = secret;
        error.message = secret;
        expect(publicProviderFailure(error)).toEqual(
          status === undefined ? { code: "other" } : { status: 401, code: "other" },
        );
      }
    },
  );

  test("does not infer a code from type, name, message, or body", () => {
    const error = apiError({ error: { type: "insufficient_quota" } }, 429);
    error.name = "insufficient_quota";
    error.message = "insufficient_quota";
    Object.defineProperty(error, "responseBody", { value: JSON.stringify(allowedData) });
    expect(publicProviderFailure(error)).toEqual({ status: 429, code: "other" });
  });

  test.each([
    undefined,
    null,
    "sk-test-123",
    {},
    { error: null },
    { error: { code: 429 } },
    { error: { code: "" } },
    { error: { code: "model_not_found" } },
    { error: { code: "INSUFFICIENT_QUOTA" } },
    { error: { code: " insufficient_quota " } },
    { error: { code: "sk-test-123", type: "insufficient_quota" } },
  ])("rejects unsupported data %#", (data) => {
    expect(publicProviderFailure(apiError(data))).toEqual({ code: "other" });
  });

  test.each([
    undefined,
    null,
    "Bearer abc",
    401,
    {},
    { statusCode: 401, data: allowedData },
    new Error("sk-test-123"),
    new Error(
      "INFOMANIAK_PRODUCT_ID and INFOMANIAK_API_TOKEN are required when LLM_PROVIDER=infomaniak",
    ),
    new Error("OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter"),
  ])("summarizes non-API errors as other %#", (error) => {
    expect(publicProviderFailure(error)).toEqual({ code: "other" });
  });

  test("reads one API error cause without copying wrapper fields", () => {
    const wrapper = new Error("Bearer abc", { cause: apiError(allowedData, 429) });
    wrapper.name = "sk-test-123";
    expect(publicProviderFailure(wrapper)).toEqual({
      status: 429,
      code: "insufficient_quota",
    });
  });
});
