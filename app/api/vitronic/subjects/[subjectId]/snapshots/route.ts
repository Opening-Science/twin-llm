import { NextResponse } from "next/server";

import { listSnapshotsForSubject } from "@/features/vitronic/connection";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";

type RouteContext = { params: Promise<{ subjectId: string }> };

export const GET = async (_request: Request, context: RouteContext) => {
  if (!vitronicEnv()) {
    return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
  }
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json(
      { error: "Sign in to list BodyLoop snapshots." },
      { status: 401 },
    );
  }
  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({ error: "User record missing." }, { status: 400 });
  }
  const { subjectId } = await context.params;
  try {
    const snapshots = await listSnapshotsForSubject(appUserId, subjectId);
    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error(
      "[vitronic] snapshots failed",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json(
      { error: "Could not list BodyLoop snapshots." },
      { status: 502 },
    );
  }
};
