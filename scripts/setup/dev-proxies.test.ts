import { describe, expect, test } from "bun:test";

import {
  type DevEnv,
  planDevProxies,
  portBusyLine,
  probeHosts,
  redirectsTo,
  tagLine,
} from "./dev-proxies";

const ROOT = "/repo";
const CERT = "/repo/certificates/localhost.pem";
const KEY = "/repo/certificates/localhost-key.pem";

const OURA = { OURA_REDIRECT_URI: "http://localhost:8787/callback" } as const;
const WHOOP = {
  WHOOP_REDIRECT_URI: "https://localhost:8788/api/whoop/callback",
} as const;

const withFiles =
  (...files: readonly string[]) =>
  (path: string): boolean =>
    files.includes(path);

const plan = (env: DevEnv, exists = withFiles(CERT, KEY)) =>
  planDevProxies(env, exists, ROOT).map((entry) =>
    entry.kind === "start" ? [entry.id, "start"] : [entry.id, "skip"],
  );

describe("planDevProxies", () => {
  test("no redirect env starts nothing", () => {
    expect(plan({})).toEqual([]);
  });

  test("Oura's redirect at the proxy starts the Oura proxy on its host and port", () => {
    expect(planDevProxies(OURA, withFiles(), ROOT)).toEqual([
      {
        kind: "start",
        id: "oura",
        tag: "[oura-proxy]",
        script: "scripts/oura-oauth-proxy.mjs",
        host: "localhost",
        port: 8787,
      },
    ]);
  });

  test("an Oura redirect straight to Next needs no proxy", () => {
    expect(
      plan({ OURA_REDIRECT_URI: "http://localhost:3000/api/oura/callback" }),
    ).toEqual([]);
  });

  test("an Oura redirect on another host, scheme or a bad URL starts nothing", () => {
    expect(plan({ OURA_REDIRECT_URI: "http://127.0.0.1:8787/callback" })).toEqual([]);
    expect(plan({ OURA_REDIRECT_URI: "https://localhost:8787/callback" })).toEqual([]);
    expect(plan({ OURA_REDIRECT_URI: "not a url" })).toEqual([]);
    expect(plan({ OURA_REDIRECT_URI: "  " })).toEqual([]);
  });

  test("the proxy's own host and port overrides decide the match", () => {
    expect(
      plan({
        OURA_REDIRECT_URI: "http://127.0.0.1:9000/callback",
        OURA_PROXY_HOST: "127.0.0.1",
        OURA_PROXY_PORT: "9000",
      }),
    ).toEqual([["oura", "start"]]);
    expect(plan({ ...OURA, OURA_PROXY_PORT: "9000" })).toEqual([]);
  });

  test("WHOOP's redirect at the proxy with both TLS files starts the WHOOP proxy", () => {
    expect(planDevProxies(WHOOP, withFiles(CERT, KEY), ROOT)).toEqual([
      {
        kind: "start",
        id: "whoop",
        tag: "[whoop-proxy]",
        script: "scripts/whoop-oauth-proxy.mjs",
        host: undefined,
        port: 8788,
      },
    ]);
  });

  test("WHOOP without a certificate or key is skipped with the mkcert line", () => {
    const missing =
      "[whoop-proxy] Not started: the TLS certificate is missing. Make it once with: mkcert -cert-file certificates/localhost.pem -key-file certificates/localhost-key.pem localhost";
    expect(planDevProxies(WHOOP, withFiles(), ROOT)).toEqual([
      { kind: "skip", id: "whoop", tag: "[whoop-proxy]", message: missing },
    ]);
    expect(plan(WHOOP, withFiles(CERT))).toEqual([["whoop", "skip"]]);
    expect(plan(WHOOP, withFiles(KEY))).toEqual([["whoop", "skip"]]);
  });

  test("WHOOP's file overrides are the files checked and named", () => {
    const env = {
      ...WHOOP,
      WHOOP_PROXY_CERT: "tls/c.pem",
      WHOOP_PROXY_KEY: "tls/k.pem",
    };
    expect(plan(env, withFiles("/repo/tls/c.pem", "/repo/tls/k.pem"))).toEqual([
      ["whoop", "start"],
    ]);
    const [skipped] = planDevProxies(env, withFiles(CERT, KEY), ROOT);
    expect(skipped?.kind === "skip" ? skipped.message : "").toContain(
      "mkcert -cert-file tls/c.pem -key-file tls/k.pem localhost",
    );
  });

  test("a WHOOP redirect that is plain http or straight to Next starts nothing", () => {
    expect(
      plan({ WHOOP_REDIRECT_URI: "http://localhost:8788/api/whoop/callback" }),
    ).toEqual([]);
    expect(
      plan({ WHOOP_REDIRECT_URI: "https://localhost:3000/api/whoop/callback" }),
    ).toEqual([]);
  });

  test("both redirects start both proxies, Oura first", () => {
    expect(plan({ ...OURA, ...WHOOP })).toEqual([
      ["oura", "start"],
      ["whoop", "start"],
    ]);
    expect(plan({ ...OURA, ...WHOOP }, withFiles())).toEqual([
      ["oura", "start"],
      ["whoop", "skip"],
    ]);
  });
});

describe("redirectsTo", () => {
  test("a URL without a port uses its scheme's default", () => {
    expect(redirectsTo("https://localhost/cb", "https:", "localhost", 443)).toBe(true);
    expect(redirectsTo("http://LOCALHOST:80/cb", "http:", "localhost", 80)).toBe(true);
  });
});

describe("probeHosts", () => {
  test("localhost is tried on both loopbacks, every interface on all three", () => {
    expect(probeHosts("localhost")).toEqual(["127.0.0.1", "::1"]);
    expect(probeHosts(undefined)).toEqual([undefined, "127.0.0.1", "::1"]);
    expect(probeHosts("127.0.0.1")).toEqual(["127.0.0.1"]);
  });
});

describe("output lines", () => {
  test("a busy port is one line that names where", () => {
    expect(portBusyLine("[oura-proxy]", "localhost", 8787, "EADDRINUSE")).toBe(
      "[oura-proxy] Not started: localhost:8787 is already in use (a proxy you started yourself keeps working).",
    );
    expect(portBusyLine("[whoop-proxy]", undefined, 8788, "EACCES")).toBe(
      "[whoop-proxy] Not started: cannot listen on port 8788 (EACCES).",
    );
  });

  test("child lines get the tag once", () => {
    expect(tagLine("[oura-proxy]", "listening")).toBe("[oura-proxy] listening");
    expect(tagLine("[oura-proxy]", "[oura-proxy] listening")).toBe(
      "[oura-proxy] listening",
    );
  });
});
