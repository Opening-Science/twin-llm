import { describe, expect, test } from "bun:test";

import { unstable_doesMiddlewareMatch } from "next/dist/experimental/testing/server/middleware-testing-utils.js";

import nextConfig from "./next.config";
import { config } from "./proxy";

/**
 * Which requests run through proxy.ts, and so have their body buffered and
 * cut at `proxyClientMaxBodySize` (#434). Only the GBD upload is left out.
 */

const runsProxy = (url: string): boolean => unstable_doesMiddlewareMatch({ config, url });

describe("proxy matcher (#434)", () => {
  test("the GBD upload is the one route the proxy leaves out", () => {
    expect(["/api/gbd/imports", "/api/gbd/imports/"].map(runsProxy)).toEqual([
      false,
      false,
    ]);
  });

  test("every other route still runs through the proxy and its body limit", () => {
    const routes = [
      `/api/gbd/imports/${"a".repeat(64)}`,
      "/api/gbd/importsx",
      "/api/gbd/status",
      "/api/personal-data/review",
      "/api/chat",
      "/api/synthea/jobs",
      "/customize/data",
      "/t/made-up",
      "/",
    ];
    expect(routes.filter((url) => !runsProxy(url))).toEqual([]);
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("52mb");
  });

  test("Next internals and static files stay out, as before", () => {
    expect(["/_next/static/a.js", "/favicon.ico"].map(runsProxy)).toEqual([false, false]);
  });
});
