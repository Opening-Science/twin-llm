import { describe, expect, test } from "bun:test";

import { getAuthorizationUrl } from "./oura-authorize";

const CONFIG = {
  clientId: "synthetic-oura-client",
  clientSecret: "synthetic-oura-secret",
  redirectUri: "http://localhost:8787/callback",
  scopes: ["email", "personal", "daily"] as never,
};

describe("oura-authorize adapter", () => {
  test("without state the URL has no state query param", () => {
    const url = new URL(getAuthorizationUrl(CONFIG));
    expect(url.searchParams.get("state")).toBeNull();
    expect(url.searchParams.get("client_id")).toBe("synthetic-oura-client");
  });

  test("with state the host appends the same value", () => {
    const url = new URL(getAuthorizationUrl(CONFIG, "abcd1234"));
    expect(url.searchParams.get("state")).toBe("abcd1234");
  });
});
