import { describe, expect, test } from "bun:test";

import { checkGbdUploadRequest } from "./gbd-upload-gate";

/** The proxy's checks, made by the upload route itself (#434). */

const SETUP = { authDisabled: true, onSyntheaHost: false } as const;

const post = (headers: Readonly<Record<string, string>>) =>
  new Request("http://localhost:3000/api/gbd/imports", { method: "POST", headers });

describe("checkGbdUploadRequest (#434)", () => {
  test("a same-site request from this machine goes on", () => {
    expect(
      checkGbdUploadRequest(
        post({
          host: "localhost:3000",
          "sec-fetch-site": "same-origin",
          origin: "http://localhost:3000",
        }),
        SETUP,
      ),
    ).toBeNull();
  });

  test("another site, another host or a forwarded client is refused", () => {
    const refused = (headers: Readonly<Record<string, string>>) =>
      checkGbdUploadRequest(post(headers), SETUP);
    expect(refused({ host: "localhost:3000", "sec-fetch-site": "cross-site" })).toEqual({
      kind: "auth-off",
      refusal: { status: 403, reason: "fetch-site" },
    });
    expect(
      refused({ host: "localhost:3000", origin: "https://elsewhere.example.test" }),
    ).toEqual({ kind: "auth-off", refusal: { status: 403, reason: "origin" } });
    expect(refused({ host: "192.168.1.20:3000" })).toEqual({
      kind: "auth-off",
      refusal: { status: 421, reason: "host" },
    });
    expect(refused({ host: "localhost:3000", "x-forwarded-for": "10.0.0.2" })).toEqual({
      kind: "auth-off",
      refusal: { status: 403, reason: "forwarded" },
    });
  });

  test("a signed-in server refuses, since GBD files are imported on a local install only", () => {
    expect(
      checkGbdUploadRequest(post({ host: "localhost:3000" }), {
        ...SETUP,
        authDisabled: false,
      }),
    ).toEqual({ kind: "signed-in" });
  });

  test("the generator's host does not reach the route", () => {
    expect(
      checkGbdUploadRequest(post({ host: "localhost:3000" }), {
        ...SETUP,
        onSyntheaHost: true,
      }),
    ).toEqual({ kind: "synthea-host" });
  });
});
