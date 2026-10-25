import { describe, expect, test } from "bun:test";

import { envValueLooksEmpty } from "./env";

// Synthetic values only; none of these is a real credential.
const SOURCE = {
  OURA_CLIENT_ID: "",
  OURA_CLIENT_SECRET: "   ",
  WHOOP_CLIENT_ID: "# paste the client id here",
  WHOOP_CLIENT_SECRET: "fixture-secret",
  GOOGLE_HEALTH_CLIENT_ID: "fixture#with-hash-inside",
} as const;

describe("envValueLooksEmpty", () => {
  test("a present but blank or commented value looks empty", () => {
    expect(envValueLooksEmpty(SOURCE, "OURA_CLIENT_ID")).toBe(true);
    expect(envValueLooksEmpty(SOURCE, "OURA_CLIENT_SECRET")).toBe(true);
    expect(envValueLooksEmpty(SOURCE, "WHOOP_CLIENT_ID")).toBe(true);
  });

  test("a real value, a missing key or a # later in the value does not", () => {
    expect(envValueLooksEmpty(SOURCE, "WHOOP_CLIENT_SECRET")).toBe(false);
    expect(envValueLooksEmpty(SOURCE, "OURA_REDIRECT_URI")).toBe(false);
    expect(envValueLooksEmpty(SOURCE, "GOOGLE_HEALTH_CLIENT_ID")).toBe(false);
  });
});
