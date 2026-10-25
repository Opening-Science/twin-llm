import { describe, expect, test } from "bun:test";

import {
  authOffRefusalResponse,
  checkAuthOffRequest,
  isLoopbackHostname,
} from "./auth-off-request-guard";

const request = (
  method: string,
  headers: Record<string, string>,
  path = "/api/oura/sync",
): Request => new Request(`http://127.0.0.1:3000${path}`, { method, headers });

describe("isLoopbackHostname", () => {
  test("accepts this machine's names", () => {
    ["localhost", "LOCALHOST", "127.0.0.1", "127.8.9.10", "::1", "[::1]"].forEach(
      (name) => expect(isLoopbackHostname(name)).toBe(true),
    );
  });

  test("refuses everything else", () => {
    [
      "192.168.1.20",
      "10.0.0.12",
      "evil.example",
      "localhost.evil.example",
      "128.0.0.1",
      "127.0.0.256",
      "",
    ].forEach((name) => expect(isLoopbackHostname(name)).toBe(false));
  });
});

describe("checkAuthOffRequest", () => {
  test("lets a same-origin browser POST from this machine through", () => {
    const refusal = checkAuthOffRequest(
      request("POST", {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(refusal).toBeNull();
  });

  test("lets a local script with no browser headers through", () => {
    expect(checkAuthOffRequest(request("POST", { host: "127.0.0.1:3000" }))).toBeNull();
    expect(checkAuthOffRequest(request("GET", { host: "[::1]:3000" }))).toBeNull();
  });

  test("refuses a LAN client addressing the machine by network address", () => {
    expect(checkAuthOffRequest(request("GET", { host: "192.168.1.20:3000" }))).toEqual({
      status: 421,
      reason: "host",
    });
  });

  test("refuses a rebinding page that reaches loopback under its own name", () => {
    expect(
      checkAuthOffRequest(request("GET", { host: "rebind.evil.example:3000" }))?.reason,
    ).toBe("host");
  });

  test("refuses a request with no Host or a malformed one", () => {
    expect(checkAuthOffRequest(request("GET", {}))?.reason).toBe("host");
    expect(
      checkAuthOffRequest(request("GET", { host: "localhost:3000@evil" }))?.reason,
    ).toBe("host");
  });

  test("refuses a forwarded non-loopback client", () => {
    expect(
      checkAuthOffRequest(
        request("GET", {
          host: "localhost:3000",
          "x-forwarded-for": "203.0.113.7, 127.0.0.1",
        }),
      )?.reason,
    ).toBe("forwarded");
    expect(
      checkAuthOffRequest(
        request("GET", { host: "localhost:3000", "x-forwarded-for": "::1" }),
      ),
    ).toBeNull();
  });

  test("refuses a cross-site simple POST", () => {
    const refusal = checkAuthOffRequest(
      request("POST", {
        host: "127.0.0.1:3000",
        "content-type": "text/plain",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
    );
    expect(refusal).toEqual({ status: 403, reason: "fetch-site" });
  });

  test("refuses a POST from another site on this machine", () => {
    expect(
      checkAuthOffRequest(
        request("POST", {
          host: "localhost:3000",
          origin: "http://localhost:5173",
          "sec-fetch-site": "same-site",
        }),
      )?.reason,
    ).toBe("fetch-site");
  });

  test("refuses a foreign or opaque Origin when Sec-Fetch-Site is absent", () => {
    ["https://evil.example", "null"].forEach((origin) =>
      expect(
        checkAuthOffRequest(request("DELETE", { host: "localhost:3000", origin }))
          ?.reason,
      ).toBe("origin"),
    );
  });

  test("does not apply the cross-site rule to safe methods", () => {
    expect(
      checkAuthOffRequest(
        request("GET", { host: "localhost:3000", "sec-fetch-site": "cross-site" }),
      ),
    ).toBeNull();
  });

  test("the refusal response names no request detail", async () => {
    const response = authOffRefusalResponse({ status: 403, reason: "origin" });
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).not.toContain("origin");
    expect(body).toContain("only answers requests from this machine");
  });
});
