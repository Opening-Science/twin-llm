import { resolveActorId } from "@/infrastructure/auth-actor";
import { NextResponse } from "next/server";

import { disconnectOura } from "@/features/oura/connection";
import { findAppUserId } from "@/infrastructure/current-user";

export const DELETE = async () => {
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({ ok: true });
  }

  await disconnectOura(appUserId);
  return NextResponse.json({ ok: true });
};
