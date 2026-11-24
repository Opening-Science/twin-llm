import { NextResponse } from "next/server";
import { z } from "zod";

import { GlbTooLargeError } from "@/packages/vitronic/glb";

import { VitronicSubjectNotOwnedError, type VitronicIngestInput } from "./connection";
import { ingestSchema } from "./ingest-schema";
import { scannerSyncErrorResponse } from "./scanner-sync-error-response";

/**
 * Vitronic sync POST, as a factory, so the Next route file can export only POST and
 * tests can pass fakes without replacing modules for the whole bun process. The
 * measurements branch names a subject in the body; ownership of that subject is
 * enforced (and a refusal audited) by ingestVitronicForUser itself.
 */
type SyncResult = Readonly<{
  summary: Readonly<{ metrics: readonly unknown[]; window: unknown }>;
  glbSha256: string | null;
}>;

export type VitronicSyncDeps = {
  readonly vitronicEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly ingestVitronicForUser: (params: {
    readonly userId: string;
    readonly actor: string;
    readonly input: VitronicIngestInput;
  }) => Promise<SyncResult>;
  readonly syncVitronicForUser: (params: {
    readonly userId: string;
    readonly actor: string;
    readonly probandId?: number;
  }) => Promise<SyncResult>;
};

const MEASUREMENT_FIELDS = ["height", "viatar", "glbBase64", "scan_id", "properties"];
const scanKeySchema = z.number().int().min(1).max(2_147_483_647).optional();

const ok = (result: SyncResult) =>
  NextResponse.json({
    ok: true,
    metricCount: result.summary.metrics.length,
    glbSha256: result.glbSha256,
    window: result.summary.window,
  });

export const createVitronicSyncHandler = (deps: VitronicSyncDeps) => {
  return async (request: Request) => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json({ error: "Sign in to sync BodyLoop." }, { status: 401 });
    }
    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "User record missing." }, { status: 400 });
    }

    const raw: unknown = await request.json().catch(() => ({}));
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const hasMeasurements = MEASUREMENT_FIELDS.some((field) => field in body);

    try {
      if (!hasMeasurements) {
        const key = scanKeySchema.safeParse(body.probandId);
        if (!key.success) {
          return NextResponse.json(
            { error: "Enter a valid positive whole number for the BodyLoop scan key." },
            { status: 400 },
          );
        }
        return ok(
          await deps.syncVitronicForUser({
            userId: appUserId,
            actor: clerkId,
            ...(key.data === undefined ? {} : { probandId: key.data }),
          }),
        );
      }
      const parsed = ingestSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "BodyLoop measurements were incomplete." },
          { status: 400 },
        );
      }
      const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
      if (!subjectId) {
        return NextResponse.json(
          { error: "A BodyLoop subject is required." },
          { status: 400 },
        );
      }
      const glb = parsed.data.glbBase64
        ? Uint8Array.from(Buffer.from(parsed.data.glbBase64, "base64"))
        : undefined;
      const result = await deps.ingestVitronicForUser({
        userId: appUserId,
        actor: clerkId,
        input: {
          subjectId,
          scan_id: parsed.data.scan_id,
          viatar: parsed.data.viatar,
          effectiveDateTime: parsed.data.effectiveDateTime,
          height: parsed.data.height,
          distance: parsed.data.distance as never,
          angle: parsed.data.angle as never,
          axis: parsed.data.axis,
          cross_section: parsed.data.cross_section,
          marker: parsed.data.marker,
          properties: parsed.data.properties as never,
          glb,
        },
      });
      return ok(result);
    } catch (error) {
      if (error instanceof VitronicSubjectNotOwnedError) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      if (error instanceof GlbTooLargeError) {
        return NextResponse.json(
          { error: "BodyLoop mesh is too large." },
          { status: 413 },
        );
      }
      return scannerSyncErrorResponse(error, "[vitronic] sync failed");
    }
  };
};
