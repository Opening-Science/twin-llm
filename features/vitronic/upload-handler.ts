import { NextResponse } from "next/server";

import { readUploadAuth, secretsEqual } from "@/packages/vitronic/auth";
import { MAX_GLB_BYTES } from "@/packages/vitronic/glb";
import {
  CLOUD_CONNECT_SHAPE_PENDING,
  parseCloudConnectExport,
} from "@/packages/vitronic/push";

/**
 * Vitronic cloud-connect upload POST, as a factory, so the Next route file can
 * export only POST and tests can pass fakes without replacing modules for the
 * whole bun process.
 */
type UploadRouteContext = {
  readonly params: Promise<unknown>;
};

export type VitronicUploadDeps = {
  readonly vitronicEnv: () => unknown;
  readonly findConnectionForUpload: (connectionId: string) => Promise<{
    readonly uploadSecretEnc: string;
  } | null>;
  readonly decryptVitronicSecret: (ciphertext: string) => string;
};

export const createVitronicUploadHandler = (deps: VitronicUploadDeps) => {
  return async (request: Request, context: UploadRouteContext) => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_GLB_BYTES) {
      return NextResponse.json(
        { error: "BodyLoop upload is too large." },
        { status: 413 },
      );
    }

    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.byteLength > MAX_GLB_BYTES) {
      return NextResponse.json(
        { error: "BodyLoop upload is too large." },
        { status: 413 },
      );
    }

    let body: unknown = null;
    try {
      body = JSON.parse(buf.toString("utf8")) as unknown;
    } catch {
      body = null;
    }

    const auth = readUploadAuth(body);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { connectionId } = (await context.params) as { connectionId: string };
    if (!connectionId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const connection = await deps.findConnectionForUpload(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const expected = deps.decryptVitronicSecret(connection.uploadSecretEnc);
    if (!secretsEqual(auth[1], expected)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
      parseCloudConnectExport(body);
    } catch (error) {
      if (error instanceof Error && error.message === CLOUD_CONNECT_SHAPE_PENDING) {
        return NextResponse.json({ error: CLOUD_CONNECT_SHAPE_PENDING }, { status: 501 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  };
};
