import { describe, expect, test } from "bun:test";

import {
  parseScannerHosts,
  ScannerUrlRejectedError,
  scannerOrigin,
  scannerRequestUrl,
  type ScannerUrlRejection,
} from "./base-url";

const rejection = (
  raw: string,
  allowedHosts?: readonly string[],
): ScannerUrlRejection => {
  try {
    scannerOrigin(raw, { allowedHosts });
  } catch (error) {
    if (error instanceof ScannerUrlRejectedError) return error.reason;
    throw error;
  }
  throw new Error(`accepted ${raw}`);
};

describe("scannerOrigin", () => {
  test("keeps only the https origin of a LAN or named scanner", () => {
    expect(scannerOrigin("https://192.168.1.20")).toBe("https://192.168.1.20");
    expect(scannerOrigin("https://192.168.1.20/")).toBe("https://192.168.1.20");
    expect(scannerOrigin(" https://10.0.0.12:8443 ")).toBe("https://10.0.0.12:8443");
    expect(scannerOrigin("https://172.16.4.2:443")).toBe("https://172.16.4.2");
    expect(scannerOrigin("https://Scanner.Example")).toBe("https://scanner.example");
    expect(scannerOrigin("https://[fd00::20]:9443")).toBe("https://[fd00::20]:9443");
  });

  test("refuses anything but https", () => {
    expect(rejection("http://192.168.1.20")).toBe("not-https");
    expect(rejection("ftp://192.168.1.20")).toBe("not-https");
    expect(rejection("file:///etc/hosts")).toBe("not-https");
    expect(rejection("not a url")).toBe("unparseable");
  });

  test("refuses credentials, paths, queries and fragments", () => {
    expect(rejection("https://op:pw@192.168.1.20")).toBe("credentials");
    expect(rejection("https://op@192.168.1.20")).toBe("credentials");
    expect(rejection("https://192.168.1.20/admin")).toBe("path");
    expect(rejection("https://192.168.1.20/api/v2/")).toBe("path");
    expect(rejection("https://192.168.1.20?x=1")).toBe("query");
    expect(rejection("https://192.168.1.20/?")).toBe("query");
    expect(rejection("https://192.168.1.20#")).toBe("fragment");
    expect(rejection("https://192.168.1.20/#x")).toBe("fragment");
  });

  test("allows 443 and 1024-65535, refuses other ports", () => {
    expect(scannerOrigin("https://192.168.1.20:1024")).toBe("https://192.168.1.20:1024");
    expect(scannerOrigin("https://192.168.1.20:65535")).toBe(
      "https://192.168.1.20:65535",
    );
    expect(rejection("https://192.168.1.20:22")).toBe("port");
    expect(rejection("https://192.168.1.20:80")).toBe("port");
    expect(rejection("https://192.168.1.20:1023")).toBe("port");
  });

  test("refuses loopback, link-local, unspecified and multicast hosts by default", () => {
    for (const raw of [
      "https://127.0.0.1",
      "https://127.1.2.3:8443",
      "https://2130706433",
      "https://localhost",
      "https://scanner.localhost",
      "https://169.254.169.254",
      "https://0.0.0.0",
      "https://224.0.0.1",
      "https://255.255.255.255",
      "https://[::1]",
      "https://[::]",
      "https://[::ffff:127.0.0.1]",
      "https://[fe80::1]",
      "https://[ff02::1]",
    ]) {
      expect(rejection(raw)).toBe("host-not-allowed");
    }
  });

  test("an operator allowlist is the only set of hosts accepted", () => {
    const allowed = parseScannerHosts(" Scanner.Lab , 127.0.0.1,[::1] ,");
    expect(allowed).toEqual(["scanner.lab", "127.0.0.1", "::1"]);
    expect(scannerOrigin("https://scanner.lab:8443", { allowedHosts: allowed })).toBe(
      "https://scanner.lab:8443",
    );
    expect(scannerOrigin("https://127.0.0.1", { allowedHosts: allowed })).toBe(
      "https://127.0.0.1",
    );
    expect(scannerOrigin("https://[::1]", { allowedHosts: allowed })).toBe(
      "https://[::1]",
    );
    expect(rejection("https://192.168.1.20", allowed)).toBe("host-not-allowed");
    expect(rejection("http://scanner.lab", allowed)).toBe("not-https");
    expect(parseScannerHosts(undefined)).toEqual([]);
  });
});

describe("scannerRequestUrl", () => {
  test("appends an allowlisted path to the origin", () => {
    expect(scannerRequestUrl("https://192.168.1.20:8443", "/api/v2/viatars/7")).toBe(
      "https://192.168.1.20:8443/api/v2/viatars/7",
    );
  });

  test("refuses a path that would change origin, path, query or fragment", () => {
    const origin = "https://192.168.1.20";
    for (const path of [
      "//10.0.0.1/api/v2/viatars/",
      "/api/v2/viatars/../../admin",
      "/api/v2/viatars/?x=1",
      "/api/v2/viatars/#",
    ]) {
      expect(() => scannerRequestUrl(origin, path)).toThrow("vitronic-path-not-allowed");
    }
  });
});
