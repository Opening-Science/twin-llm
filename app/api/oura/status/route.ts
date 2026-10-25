import { resolveActorId } from "@/infrastructure/auth-actor";
import { NextResponse } from "next/server";

import { getOuraConnectionStatus } from "@/features/oura/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { ouraEnv } from "@/infrastructure/env";

export const GET = async () => {
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json({
      configured: ouraEnv() !== null,
      connected: false,
      linkedAt: null,
      lastSyncAt: null,
      signedIn: false,
    });
  }

  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({
      configured: ouraEnv() !== null,
      connected: false,
      linkedAt: null,
      lastSyncAt: null,
      signedIn: true,
    });
  }

  const status = await getOuraConnectionStatus(appUserId);
  return NextResponse.json({ ...status, signedIn: true });
};
