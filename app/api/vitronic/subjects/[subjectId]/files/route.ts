import { NextResponse } from "next/server";

import {
  ingestVitronicForUser,
  requireSubjectForUser,
  VitronicSubjectNotOwnedError,
  VITRONIC_FILES_AUDIT_TOOL,
} from "@/features/vitronic/connection";
import { ingestSchema } from "@/features/vitronic/ingest-schema";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { GlbTooLargeError, MAX_GLB_BYTES } from "@/packages/vitronic/glb";
import { withUnlocked } from "@/infrastructure/vault-runtime";

type RouteContext = { params: Promise<{ subjectId: string }> };

export const POST = withUnlocked(async (request: Request, context: RouteContext) => {
  if (!vitronicEnv()) {
    return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
  }
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json(
      { error: "Sign in to ingest a BodyLoop file." },
      { status: 401 },
    );
  }
  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({ error: "User record missing." }, { status: 400 });
  }

  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > MAX_GLB_BYTES) {
    return NextResponse.json({ error: "BodyLoop file is too large." }, { status: 413 });
  }

  const { subjectId } = await context.params;
  try {
    await requireSubjectForUser(appUserId, subjectId);
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = ingestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "BodyLoop measurements were incomplete." },
      { status: 400 },
    );
  }

  let glb: Uint8Array | undefined;
  if (parsed.data.glbBase64) {
    glb = Uint8Array.from(Buffer.from(parsed.data.glbBase64, "base64"));
  }

  try {
    const result = await ingestVitronicForUser({
      userId: appUserId,
      actor: clerkId,
      tool: VITRONIC_FILES_AUDIT_TOOL,
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
    return NextResponse.json({
      ok: true,
      metricCount: result.summary.metrics.length,
      glbSha256: result.glbSha256,
      viatarId: result.viatarId,
      window: result.summary.window,
    });
  } catch (error) {
    if (error instanceof VitronicSubjectNotOwnedError) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (error instanceof GlbTooLargeError) {
      return NextResponse.json({ error: "BodyLoop mesh is too large." }, { status: 413 });
    }
    console.error(
      "[vitronic] file ingest failed",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json(
      { error: "Could not store the BodyLoop file." },
      { status: 502 },
    );
  }
});
