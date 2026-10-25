import { NextResponse } from "next/server";

import { VitronicDefaultScanNotFoundError } from "./connection";
import { defaultScanSchema } from "./subject-schema";

/**
 * Vitronic subject default-scan PUT, as a factory, so the Next route file can
 * export only PUT and tests can pass fakes without replacing modules for the
 * whole bun process.
 */
type DefaultScanRouteContext = { params: Promise<unknown> };

export type VitronicDefaultScanDeps = {
  readonly vitronicEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly setDefaultScanForSubject: (params: {
    readonly userId: string;
    readonly actor: string;
    readonly subjectId: string;
    readonly viatarId: number | null;
  }) => Promise<{ readonly defaultViatarId: number | null }>;
};

export const createVitronicDefaultScanPutHandler = (deps: VitronicDefaultScanDeps) => {
  return async (request: Request, context: DefaultScanRouteContext) => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json(
        { error: "Sign in to choose a default BodyLoop scan." },
        { status: 401 },
      );
    }
    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "User record missing." }, { status: 400 });
    }
    const parsed = defaultScanSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "viatarId must be a positive integer or null." },
        { status: 400 },
      );
    }
    const { subjectId } = (await context.params) as { subjectId: string };
    try {
      const result = await deps.setDefaultScanForSubject({
        userId: appUserId,
        actor: clerkId,
        subjectId,
        viatarId: parsed.data.viatarId,
      });
      return NextResponse.json({ ok: true, defaultViatarId: result.defaultViatarId });
    } catch (error) {
      if (error instanceof VitronicDefaultScanNotFoundError) {
        return NextResponse.json(
          { error: "Sync this scan before making it the default." },
          { status: 404 },
        );
      }
      console.error(
        "[vitronic] default scan failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not save the default BodyLoop scan." },
        { status: 502 },
      );
    }
  };
};
