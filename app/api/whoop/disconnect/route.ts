import { resolveActorId } from "@/infrastructure/auth-actor";
import { NextResponse } from "next/server";

import { disconnectWhoop } from "@/features/whoop/connection";
import { findAppUserId } from "@/infrastructure/current-user";

export const DELETE = async () => {
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json({ error: "Sign in to disconnect Whoop." }, { status: 401 });
  }

  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({ error: "User record missing." }, { status: 400 });
  }

  await disconnectWhoop(appUserId);
  return NextResponse.json({ ok: true });
};
