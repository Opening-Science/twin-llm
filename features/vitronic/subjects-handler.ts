import { NextResponse } from "next/server";

import { VitronicConsentRequiredError, VitronicSelfExistsError } from "./connection";
import { createSubjectSchema, type CreateSubjectInput } from "./subject-schema";

/**
 * Vitronic subjects GET/POST, as factories, so the Next route file can export
 * only handlers and tests can pass fakes without replacing modules for the
 * whole bun process.
 */
export type VitronicSubjectsDeps = {
  readonly vitronicEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly listVitronicSubjects: (userId: string) => Promise<readonly unknown[]>;
  readonly createVitronicSubject: (params: {
    readonly userId: string;
    readonly actor: string;
    readonly input: CreateSubjectInput;
  }) => Promise<unknown>;
};

export const createVitronicSubjectsGetHandler = (deps: VitronicSubjectsDeps) => {
  return async () => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json(
        { error: "Sign in to list BodyLoop subjects." },
        { status: 401 },
      );
    }
    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "User record missing." }, { status: 400 });
    }
    try {
      const subjects = await deps.listVitronicSubjects(appUserId);
      return NextResponse.json({ subjects });
    } catch (error) {
      console.error(
        "[vitronic] subjects failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not list BodyLoop subjects." },
        { status: 502 },
      );
    }
  };
};

export const createVitronicSubjectsPostHandler = (deps: VitronicSubjectsDeps) => {
  return async (request: Request) => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json(
        { error: "Sign in to add a BodyLoop subject." },
        { status: 401 },
      );
    }
    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "User record missing." }, { status: 400 });
    }
    const parsed = createSubjectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Consent and label are required." },
        { status: 400 },
      );
    }
    try {
      const subject = await deps.createVitronicSubject({
        userId: appUserId,
        actor: clerkId,
        input: parsed.data,
      });
      return NextResponse.json({ ok: true, subject });
    } catch (error) {
      if (
        error instanceof VitronicConsentRequiredError ||
        error instanceof VitronicSelfExistsError
      ) {
        return NextResponse.json(
          { error: "Consent and label are required." },
          { status: 400 },
        );
      }
      console.error(
        "[vitronic] subject create failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not store the BodyLoop subject." },
        { status: 502 },
      );
    }
  };
};
