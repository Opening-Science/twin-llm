import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ScannerUrlRejectedError } from "./base-url";
import { captureTlsFingerprint, listViatarsForProbandId } from "./client";
import {
  fingerprintSha256Hex,
  pinnedRequest,
  TlsPinMismatchError,
  VitronicRequestTimeoutError,
  VitronicResponseTooLargeError,
} from "./tls";

/**
 * Real sockets against a local TLS server with throwaway self-signed certificates,
 * generated per run (no key material in git). This is the regression for the pin
 * being skipped under Bun: the test runner is Bun.
 */

type Cert = Readonly<{ key: string; cert: string; fingerprint: string }>;

const dir = mkdtempSync(join(tmpdir(), "vitronic-tls-"));

const makeCert = (name: string): Cert => {
  const key = join(dir, `${name}.key`);
  const cert = join(dir, `${name}.crt`);
  const run = Bun.spawnSync([
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    `/CN=${name}`,
  ]);
  if (run.exitCode !== 0) throw new Error("openssl could not create a test certificate");
  const pem = readFileSync(cert, "utf8");
  return {
    key: readFileSync(key, "utf8"),
    cert: pem,
    fingerprint: fingerprintSha256Hex(new X509Certificate(pem).raw),
  };
};

const scanner = makeCert("synthetic-scanner");
const impostor = makeCert("synthetic-impostor");

type Received = { url: string | undefined; authorization: string | undefined };
const received: Received[] = [];

const listen = async (cert: Cert, handler: https.RequestListener) => {
  const server = https.createServer({ key: cert.key, cert: cert.cert }, handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
};

const record: https.RequestListener = (req, res) => {
  received.push({ url: req.url, authorization: req.headers.authorization });
  if (req.url === "/big") {
    res.end(Buffer.alloc(4096, 1));
    return;
  }
  if (req.url === "/slow") return; // never answers
  if (req.url === "/api/v2/system/tls/certificate") {
    // Both servers claim the real scanner certificate in the body.
    res.end(scanner.cert);
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end('{"viatar_id":7}');
};

let real: Awaited<ReturnType<typeof listen>>;
let fake: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  real = await listen(scanner, record);
  fake = await listen(impostor, record);
});

afterAll(() => {
  real.server.closeAllConnections();
  fake.server.closeAllConnections();
  real.server.close();
  fake.server.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  received.length = 0;
});

const pin = (fingerprintSha256: string) => ({ kind: "pin", fingerprintSha256 }) as const;
const headers = { authorization: "Bearer synthetic-token" };

describe("pinnedRequest against a local TLS server", () => {
  test("the pinned certificate is accepted and the body is returned", async () => {
    const result = await pinnedRequest(
      `https://127.0.0.1:${real.port}/api/v2/viatars/7`,
      { headers },
      pin(scanner.fingerprint),
    );
    expect(result.status).toBe(200);
    expect(result.body.toString("utf8")).toBe('{"viatar_id":7}');
    expect(received).toEqual([
      { url: "/api/v2/viatars/7", authorization: "Bearer synthetic-token" },
    ]);
  });

  test("a different certificate is refused before any request reaches it", async () => {
    const attempt = pinnedRequest(
      `https://127.0.0.1:${fake.port}/api/v2/viatars/7`,
      { headers },
      pin(scanner.fingerprint),
    );
    await expect(attempt).rejects.toBeInstanceOf(TlsPinMismatchError);
    expect(received).toEqual([]);
  });

  test("a fingerprint differing in the last digit is refused", async () => {
    const last = scanner.fingerprint.at(-1) === "0" ? "1" : "0";
    const wrong = `${scanner.fingerprint.slice(0, -1)}${last}`;
    const attempt = pinnedRequest(
      `https://127.0.0.1:${real.port}/api/v2/viatars/7`,
      { headers },
      pin(wrong),
    );
    await expect(attempt).rejects.toBeInstanceOf(TlsPinMismatchError);
    expect(received).toEqual([]);
  });

  test("first contact captures the exact handshake fingerprint", async () => {
    const captured: string[] = [];
    const result = await pinnedRequest(
      `https://127.0.0.1:${real.port}/api/v2/system/tls/certificate`,
      {},
      { kind: "tofu", onCapture: (fp) => captured.push(fp) },
    );
    expect(result.status).toBe(200);
    expect(captured).toEqual([scanner.fingerprint]);
  });

  test("a response over the byte cap is dropped", async () => {
    const attempt = pinnedRequest(
      `https://127.0.0.1:${real.port}/big`,
      { maxBytes: 1024 },
      pin(scanner.fingerprint),
    );
    await expect(attempt).rejects.toBeInstanceOf(VitronicResponseTooLargeError);
  });

  test("a scanner that never answers times out", async () => {
    const attempt = pinnedRequest(
      `https://127.0.0.1:${real.port}/slow`,
      { timeoutMs: 200 },
      pin(scanner.fingerprint),
    );
    await expect(attempt).rejects.toBeInstanceOf(VitronicRequestTimeoutError);
  });

  test("http and URLs with credentials are refused before connecting", async () => {
    await expect(
      pinnedRequest(`http://127.0.0.1:${real.port}/`, {}, pin(scanner.fingerprint)),
    ).rejects.toThrow("vitronic-tls-https-required");
    await expect(
      pinnedRequest(
        `https://user:pw@127.0.0.1:${real.port}/`,
        {},
        pin(scanner.fingerprint),
      ),
    ).rejects.toThrow("vitronic-tls-credentials-in-url");
    expect(received).toEqual([]);
  });
});

describe("BodyLoop client over pinned TLS", () => {
  const urlPolicy = { allowedHosts: ["127.0.0.1"] };

  test("first contact pins the handshake certificate and sends no API token", async () => {
    const fp = await captureTlsFingerprint({
      baseUrl: `https://127.0.0.1:${real.port}`,
      urlPolicy,
    });
    expect(fp).toBe(scanner.fingerprint);
    expect(received).toEqual([
      { url: "/api/v2/system/tls/certificate", authorization: undefined },
    ]);
  });

  test("first contact is refused when the handshake and served certificate differ", async () => {
    const attempt = captureTlsFingerprint({
      baseUrl: `https://127.0.0.1:${fake.port}`,
      urlPolicy,
    });
    await expect(attempt).rejects.toBeInstanceOf(TlsPinMismatchError);
  });

  test("a stored base URL with a path is refused before connecting", async () => {
    const attempt = listViatarsForProbandId(
      {
        baseUrl: `https://127.0.0.1:${real.port}/admin?x=1#`,
        apiToken: "synthetic-token",
        tlsFingerprintSha256: scanner.fingerprint,
        urlPolicy,
      },
      3,
    );
    await expect(attempt).rejects.toBeInstanceOf(ScannerUrlRejectedError);
    expect(received).toEqual([]);
  });

  test("a connection without a stored pin is refused before connecting", async () => {
    const attempt = listViatarsForProbandId(
      {
        baseUrl: `https://127.0.0.1:${real.port}`,
        apiToken: "synthetic-token",
        tlsFingerprintSha256: null,
        urlPolicy,
      },
      3,
    );
    await expect(attempt).rejects.toThrow("vitronic-tls-pin-required");
    expect(received).toEqual([]);
  });
});
