import { describe, expect, test } from "bun:test";

import { hostnameOf, syntheaHostRoute } from "./synthea-host-route";
import { syntheaPaths } from "./synthea-paths";

const HOST = "synthea.opening.science";

describe("syntheaHostRoute", () => {
  test("serves the generator at the root of its own host", () => {
    expect(syntheaHostRoute(HOST, "/", HOST)).toEqual({
      kind: "rewrite",
      pathname: "/synthea",
    });
    expect(syntheaHostRoute("Synthea.Opening.Science:443", "/docs/", HOST)).toEqual({
      kind: "rewrite",
      pathname: "/synthea/docs",
    });
    expect(syntheaHostRoute(HOST, "/api/synthea/jobs", HOST)).toEqual({ kind: "pass" });
    expect(syntheaHostRoute(HOST, "/synthea", HOST)).toEqual({ kind: "pass" });
  });

  test("serves nothing else of the app on that host", () => {
    const paths = [
      "/start",
      "/docs/providers",
      "/api/chat",
      "/api/threads/x",
      "/api/syntheafake",
      "/t/abc",
      "/customize/data",
      "/synthea/other",
    ];
    expect(paths.map((path) => syntheaHostRoute(HOST, path, HOST).kind)).toEqual(
      paths.map(() => "not-found"),
    );
  });

  test("leaves every other host alone", () => {
    expect(syntheaHostRoute("127.0.0.1:3000", "/", HOST)).toEqual({ kind: "other-host" });
    expect(syntheaHostRoute("synthea.opening.science.evil.test", "/", HOST)).toEqual({
      kind: "other-host",
    });
    expect(syntheaHostRoute(null, "/", HOST)).toEqual({ kind: "other-host" });
  });

  test("follows a configured host", () => {
    expect(syntheaHostRoute("synthea.test", "/", "synthea.test")).toEqual({
      kind: "rewrite",
      pathname: "/synthea",
    });
  });
});

describe("hostnameOf and syntheaPaths", () => {
  test("drops the port and case", () => {
    expect(hostnameOf("Example.ORG:8443")).toBe("example.org");
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
    expect(hostnameOf(null)).toBe(null);
  });

  test("links to / on the generator host and /synthea inside the app", () => {
    expect(syntheaPaths(true)).toEqual({ home: "/", docs: "/docs" });
    expect(syntheaPaths(false)).toEqual({
      home: "/synthea",
      docs: "/synthea/docs",
    });
  });
});
