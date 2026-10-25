import { describe, expect, test } from "bun:test";

import { parseConnectorReturn } from "./connector-return";

const DEV = { dev: true } as const;
const PROD = { dev: false } as const;

describe("parseConnectorReturn", () => {
  test("denied and error read as a sentence with a retry", () => {
    expect(parseConnectorReturn({ oura: "denied" }, DEV)).toEqual({
      source: "oura",
      outcome: "denied",
      text: "Oura access was declined.",
      failed: false,
      retry: true,
    });
    expect(parseConnectorReturn({ whoop: "error" }, DEV)).toEqual({
      source: "whoop",
      outcome: "error",
      text: "Couldn’t finish linking Whoop.",
      failed: true,
      retry: true,
    });
  });

  test("outside development, expired says to start again from this page", () => {
    expect(parseConnectorReturn({ whoop: "expired" }, PROD)).toEqual({
      source: "whoop",
      outcome: "expired",
      text: "The sign-in return didn’t reach this browser session. Start the link again from this page.",
      failed: true,
      retry: true,
    });
  });

  test("in development, expired explains the localhost fix", () => {
    expect(parseConnectorReturn({ "google-health": "expired" }, DEV)).toEqual({
      source: "google-health",
      outcome: "expired",
      text: "The sign-in return didn’t reach this browser session. Open TwinLLM at http://localhost:3000, then link Google Health again.",
      failed: true,
      retry: true,
    });
  });

  test("connected, signin and unconfigured carry no retry", () => {
    expect(parseConnectorReturn({ oura: "connected" }, DEV)).toEqual({
      source: "oura",
      outcome: "connected",
      text: "Oura is linked.",
      failed: false,
      retry: false,
    });
    expect(parseConnectorReturn({ whoop: "signin" }, DEV)).toEqual({
      source: "whoop",
      outcome: "signin",
      text: "Sign in to link Whoop.",
      failed: false,
      retry: false,
    });
    expect(parseConnectorReturn({ "google-health": "unconfigured" }, DEV)).toEqual({
      source: "google-health",
      outcome: "unconfigured",
      text: "Google Health isn’t set up in this workspace yet. Open Setup on the card.",
      failed: false,
      retry: false,
    });
  });

  test("unknown words, other params and no params give nothing", () => {
    expect(parseConnectorReturn({}, DEV)).toBeNull();
    expect(parseConnectorReturn({ oura: "<script>" }, DEV)).toBeNull();
    expect(parseConnectorReturn({ source: "whoop" }, DEV)).toBeNull();
    expect(parseConnectorReturn({ google: "denied" }, DEV)).toBeNull();
  });

  test("a repeated param uses its first value; a valid later source still counts", () => {
    expect(parseConnectorReturn({ oura: ["error", "connected"] }, DEV)?.outcome).toBe(
      "error",
    );
    expect(parseConnectorReturn({ oura: "bogus", whoop: "denied" }, DEV)?.source).toBe(
      "whoop",
    );
  });
});
