import { resolveActorId } from "@/infrastructure/auth-actor";
import { NextResponse } from "next/server";

import { getGoogleHealthConnectionStatus } from "@/features/google-health/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { googleHealthEnv } from "@/infrastructure/env";

export const GET = async () => {
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json({
      configured: googleHealthEnv() !== null,
      connected: false,
      linkedAt: null,
      lastSyncAt: null,
      signedIn: false,
    });
  }

  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({
      configured: googleHealthEnv() !== null,
      connected: false,
      linkedAt: null,
      lastSyncAt: null,
      signedIn: true,
    });
  }

  const status = await getGoogleHealthConnectionStatus(appUserId);
  return NextResponse.json({ ...status, signedIn: true });
};
