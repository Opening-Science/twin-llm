import { NextResponse } from "next/server";

import { type VitronicStatusPayload } from "./vitronic-status-view";

/**
 * Vitronic connection-status GET, as a factory, so the Next route file can
 * export only GET and tests can pass fakes without replacing modules for the
 * whole bun process.
 */
export type VitronicStatusDeps = {
  readonly vitronicEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly getVitronicConnectionStatus: (
    userId: string,
  ) => Promise<VitronicStatusPayload>;
};

export const createVitronicStatusGetHandler = (deps: VitronicStatusDeps) => {
  return async () => {
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json({
        configured: deps.vitronicEnv() !== null,
        connected: false,
        lastSyncAt: null,
        hasAvatar: false,
        signedIn: false,
        scanDate: null,
        properties: [],
      });
    }

    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({
        configured: deps.vitronicEnv() !== null,
        connected: false,
        lastSyncAt: null,
        hasAvatar: false,
        signedIn: true,
        scanDate: null,
        properties: [],
      });
    }

    try {
      const status = await deps.getVitronicConnectionStatus(appUserId);
      return NextResponse.json({ ...status, signedIn: true });
    } catch (error) {
      console.error(
        "[vitronic] status failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not load BodyLoop status." },
        { status: 502 },
      );
    }
  };
};
