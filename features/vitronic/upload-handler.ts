import { NextResponse } from "next/server";

import { LOCKED_MESSAGE } from "@/infrastructure/vault-gate";
import { lockedSkipEvent } from "@/infrastructure/vault-audit";
import type { AppendInput } from "@/packages/audit/append";
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
 *
 * The scanner calls this with no browser and no unlock cookie. The upload
 * secret is sealed with the owner's vault key (#341), so while their vault is
 * locked it is not opened: the upload is refused with 423 and a
 * `vault.locked.skip.bodyloop-upload` row says why, as a scheduled task skips
 * (#54). Checking the vault does not count as use.
 */
type UploadRouteContext = {
  readonly params: Promise<unknown>;
};

export type VitronicUploadDeps = {
  readonly vitronicEnv: () => unknown;
  readonly findConnectionForUpload: (
    connectionId: string,
  ) => Promise<UploadConnection | null>;
  /** True when the owner's vault is open now; must not count as use. */
  readonly vaultOpen: (actorId: string) => boolean;
  /** The upload secret, opened with the owner's keys; throws while locked. */
  readonly openUploadSecret: (connection: UploadConnection) => Promise<string>;
  readonly appendAudit: (input: AppendInput) => Promise<unknown>;
  /** Receives the error name only, never the error object. */
  readonly logError: (message: string, errorName: string) => void;
};

export type UploadConnection = Readonly<{
  id: string;
  userId: string;
  /** The owner's `User.clerkId`. */
  actorId: string;
  uploadSecretEnc: string;
}>;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

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

    const skipLocked = async () => {
      await deps
        .appendAudit(lockedSkipEvent(connection.actorId, "bodyloop-upload"))
        .catch((error: unknown) => {
          deps.logError("[vitronic] locked skip not audited", errorName(error));
        });
      return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 423 });
    };
    if (!deps.vaultOpen(connection.actorId)) return skipLocked();

    // The vault may lock between the check and the read.
    const expected = await deps.openUploadSecret(connection).catch(() => null);
    if (expected === null) return skipLocked();
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
