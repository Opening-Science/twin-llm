import { resolveActorId } from "@/infrastructure/auth-actor";
import { NextResponse } from "next/server";

import { getWhoopConnectionStatus } from "@/features/whoop/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { whoopEnv } from "@/infrastructure/env";

export const GET = async () => {
  const clerkId = await resolveActorId();
  if (!clerkId) {
    return NextResponse.json({
      configured: whoopEnv() !== null,
      connected: false,
      linkedAt: null,
      lastSyncAt: null,
      signedIn: false,
    });
  }

  const appUserId = await findAppUserId(clerkId);
  if (!appUserId) {
    return NextResponse.json({
      configured: whoopEnv() !== null,
      connected: false,
      linkedAt: null,
      lastSyncAt: null,
      signedIn: true,
    });
  }

  const status = await getWhoopConnectionStatus(appUserId);
  return NextResponse.json({ ...status, signedIn: true });
};
