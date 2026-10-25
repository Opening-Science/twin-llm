import { describe, expect, test } from "bun:test";

import { statusFromBody } from "./use-connector-status";

const isName = (value: unknown): value is { name: string } =>
  typeof value === "object" && value !== null && "name" in value;

describe("statusFromBody", () => {
  test("an ok response with the expected body is ok", () => {
    expect(statusFromBody(true, { name: "fixture" }, isName)).toEqual({
      state: "ok",
      payload: { name: "fixture" },
    });
  });

  test("a non-2xx response or an unexpected body fails", () => {
    expect(statusFromBody(false, { name: "fixture" }, isName)).toEqual({
      state: "failed",
    });
    expect(statusFromBody(true, null, isName)).toEqual({ state: "failed" });
    expect(statusFromBody(true, { other: 1 }, isName)).toEqual({ state: "failed" });
  });
});
