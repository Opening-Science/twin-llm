import { NextResponse } from "next/server";
import { z } from "zod";

import { syncVitronicSubjectScan } from "@/features/vitronic/connection";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { GlbTooLargeError } from "@/packages/vitronic/glb";
import { withUnlocked } from "@/infrastructure/vault-runtime";

type RouteContext = { params: Promise<{ subjectId: string }> };

const bodySchema = z.object({
  viatarId: z.coerce.number().int().positive(),
});

export const POST = withUnlocked(async (request: Request, context: RouteContext) => {
  if (!vitronicEnv()) {
    return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
  }
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json({ error: "Sign in to sync BodyLoop." }, { status: 401 });
  }
  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({ error: "User record missing." }, { status: 400 });
  }
  const { subjectId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A scan number is required." }, { status: 400 });
  }
  try {
    const result = await syncVitronicSubjectScan({
      userId: appUserId,
      actor: clerkId,
      subjectId,
      viatarId: parsed.data.viatarId,
    });
    return NextResponse.json({
      ok: true,
      metricCount: result.summary.metrics.length,
      glbSha256: result.glbSha256,
      viatarId: result.viatarId,
      window: result.summary.window,
    });
  } catch (error) {
    if (error instanceof GlbTooLargeError) {
      return NextResponse.json({ error: "BodyLoop mesh is too large." }, { status: 413 });
    }
    console.error(
      "[vitronic] subject sync failed",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json(
      { error: "Could not sync BodyLoop data. Check the connection and try again." },
      { status: 502 },
    );
  }
});
