import { resolveActorId } from "@/infrastructure/auth-actor";
import { NextResponse } from "next/server";

import { disconnectGoogleHealth } from "@/features/google-health/connection";
import { findAppUserId } from "@/infrastructure/current-user";

export const DELETE = async () => {
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json(
      { error: "Sign in to disconnect Google Health." },
      { status: 401 },
    );
  }

  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({ error: "User record missing." }, { status: 400 });
  }

  await disconnectGoogleHealth(appUserId);
  return NextResponse.json({ ok: true });
};
