import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import { isIP } from "node:net";
import tls from "node:tls";

/**
 * Per-request TLS pin for the self-signed scanner certificate. Never set
 * NODE_TLS_REJECT_UNAUTHORIZED.
 *
 * Bun's https.Agent never calls createConnection, and with rejectUnauthorized: false
 * neither runtime calls checkServerIdentity for a self-signed peer, so a pin checked
 * in those hooks is silently skipped. The pin is therefore enforced in two steps that
 * both runtimes honour:
 *
 * 1. A bare TLS handshake reads the peer certificate and compares its SHA-256 with the
 *    pin. No request bytes are written on that socket.
 * 2. The request itself runs with rejectUnauthorized: true and that exact certificate
 *    as the only trust anchor (`ca`), and checkServerIdentity compares the SHA-256
 *    again. A different certificate fails the handshake before headers are sent.
 *
 * Any failure is a TlsPinMismatchError; there is no unpinned fallback.
 */

export const TLS_PIN_MISMATCH = "vitronic-tls-pin-mismatch";

export class TlsPinMismatchError extends Error {
  readonly code = TLS_PIN_MISMATCH;
  constructor() {
    super(TLS_PIN_MISMATCH);
    this.name = "TlsPinMismatchError";
  }
}

export const fingerprintSha256Hex = (der: Buffer | Uint8Array): string =>
  createHash("sha256").update(der).digest("hex");

export const fingerprintPrefix = (hex: string, length = 12): string =>
  hex.slice(0, length);

/** SHA-256 of the first certificate in a PEM or DER body, or null if it is not one. */
export const certificateBodyFingerprint = (body: Buffer): string | null => {
  try {
    return fingerprintSha256Hex(new X509Certificate(body).raw);
  } catch {
    return null;
  }
};

export const peerFingerprint = (cert: { raw?: Buffer } | undefined): string => {
  if (!cert?.raw) throw new TlsPinMismatchError();
  return fingerprintSha256Hex(cert.raw);
};

export const assertFingerprintMatch = (actual: string, expected: string): void => {
  if (actual !== expected) throw new TlsPinMismatchError();
};

export const verifyPeerCertificate = (
  cert: { raw?: Buffer } | undefined,
  expected: string,
): void => {
  assertFingerprintMatch(peerFingerprint(cert), expected);
};

export type TlsPinMode =
  | Readonly<{ kind: "pin"; fingerprintSha256: string }>
  | Readonly<{ kind: "tofu"; onCapture?: (fingerprintSha256: string) => void }>;

export type PinnedRequestInit = Readonly<{
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Uint8Array;
  /** Deadline for the probe handshake, and separately for the request and its body. */
  timeoutMs?: number;
  /** Response bodies larger than this are dropped with VitronicResponseTooLargeError. */
  maxBytes?: number;
}>;

export type PinnedRequestResult = Readonly<{
  status: number;
  headers: Headers;
  body: Buffer;
}>;

export const PINNED_REQUEST_TIMEOUT_MS = 30_000;
/** One byte over the 100 MiB mesh limit, so the mesh reader can still say "too large". */
export const PINNED_REQUEST_MAX_BYTES = 100 * 1024 * 1024 + 1;

export class VitronicResponseTooLargeError extends Error {
  constructor() {
    super("vitronic-response-too-large");
    this.name = "VitronicResponseTooLargeError";
  }
}

export class VitronicRequestTimeoutError extends Error {
  constructor() {
    super("vitronic-request-timeout");
    this.name = "VitronicRequestTimeoutError";
  }
}

export const pemFromDer = (der: Buffer): string => {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
};

type Endpoint = Readonly<{ hostname: string; port: number }>;

const endpointOf = (url: URL): Endpoint => ({
  hostname: url.hostname.replace(/^\[(.*)\]$/, "$1"),
  port: url.port ? Number(url.port) : 443,
});

/** SNI must not carry an IP literal. */
const serverName = (hostname: string): string | undefined =>
  isIP(hostname) === 0 ? hostname : undefined;

/** Step 1: handshake only, then hang up. Returns the leaf certificate as DER. */
export const probePeerCertificate = (
  endpoint: Endpoint,
  timeoutMs: number = PINNED_REQUEST_TIMEOUT_MS,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      outcome();
    };
    const socket = tls.connect({
      host: endpoint.hostname,
      port: endpoint.port,
      servername: serverName(endpoint.hostname),
      // Read-only probe: the certificate is judged by its fingerprint, not by a CA.
      rejectUnauthorized: false,
    });
    const deadline = setTimeout(() => {
      settle(() => reject(new VitronicRequestTimeoutError()));
    }, timeoutMs);
    socket.once("secureConnect", () => {
      const raw = socket.getPeerCertificate(true)?.raw;
      settle(() =>
        raw && raw.length > 0
          ? resolve(Buffer.from(raw))
          : reject(new TlsPinMismatchError()),
      );
    });
    socket.once("error", (error) => settle(() => reject(error)));
    socket.once("close", () => settle(() => reject(new TlsPinMismatchError())));
  });

const CERT_VERIFY_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const asTlsError = (error: unknown): Error => {
  if (error instanceof TlsPinMismatchError) return error;
  if (error instanceof VitronicResponseTooLargeError) return error;
  if (error instanceof VitronicRequestTimeoutError) return error;
  if (error instanceof Error) {
    if (error.name === "TlsPinMismatchError" || error.message === TLS_PIN_MISMATCH) {
      return new TlsPinMismatchError();
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && CERT_VERIFY_CODES.has(code)) {
      return new TlsPinMismatchError();
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof TlsPinMismatchError) return cause;
    return error;
  }
  return new Error(String(error));
};

/** Step 2: the request, trusting only the certificate that passed step 1. */
const requestTrusting = (
  url: URL,
  endpoint: Endpoint,
  certificate: Buffer,
  fingerprintSha256: string,
  init: PinnedRequestInit,
): Promise<PinnedRequestResult> => {
  const timeoutMs = init.timeoutMs ?? PINNED_REQUEST_TIMEOUT_MS;
  const maxBytes = init.maxBytes ?? PINNED_REQUEST_MAX_BYTES;
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      clearTimeout(deadline);
      reject(asTlsError(error));
    };
    const req = https.request(
      {
        protocol: "https:",
        hostname: endpoint.hostname,
        port: endpoint.port,
        servername: serverName(endpoint.hostname),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: init.headers,
        agent: false,
        ca: pemFromDer(certificate),
        rejectUnauthorized: true,
        // Replaces the hostname check: scanners present a self-signed certificate
        // for an IP or a local name, and the pin is the identity.
        checkServerIdentity: (_host, cert) => {
          try {
            verifyPeerCertificate(cert, fingerprintSha256);
            return undefined;
          } catch {
            return new TlsPinMismatchError();
          }
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy(new VitronicResponseTooLargeError());
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", fail);
        res.on("end", () => {
          if (received > maxBytes) return;
          clearTimeout(deadline);
          resolve({
            status: res.statusCode ?? 0,
            headers: new Headers(res.headers as Record<string, string>),
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    const deadline = setTimeout(() => {
      req.destroy(new VitronicRequestTimeoutError());
    }, timeoutMs);
    req.on("error", fail);
    if (init.body) req.write(init.body);
    req.end();
  });
};

export const pinnedRequest = async (
  url: string,
  init: PinnedRequestInit,
  mode: TlsPinMode,
): Promise<PinnedRequestResult> => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("vitronic-tls-https-required");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("vitronic-tls-credentials-in-url");
  }
  const endpoint = endpointOf(parsed);
  let certificate: Buffer;
  try {
    certificate = await probePeerCertificate(endpoint, init.timeoutMs);
  } catch (error) {
    throw asTlsError(error);
  }
  const fingerprint = fingerprintSha256Hex(certificate);
  if (mode.kind === "pin") {
    assertFingerprintMatch(fingerprint, mode.fingerprintSha256.toLowerCase());
  } else {
    mode.onCapture?.(fingerprint);
  }
  return requestTrusting(parsed, endpoint, certificate, fingerprint, init);
};
