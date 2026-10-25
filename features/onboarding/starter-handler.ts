import { z } from "zod";

import { isDataChoiceId, isRoleId, MAX_INTEREST_LENGTH } from "./onboarding-steps";
import {
  generateStarterQuestions,
  type StarterGenerate,
  type StarterResult,
} from "./starter-questions";

/**
 * POST /api/onboarding/starters, as a factory, so the route file only wires
 * the real model call and tests pass fakes (no mock.module).
 *
 * The answer is always 200 with three questions once the request is valid:
 * a model that fails or is slow falls back to fixed starters, and the person
 * never sees a provider error.
 */

export type StarterHandlerDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  findAppUserId: (clerkId: string) => Promise<string | null>;
  /** Display names of the sources this user has linked. */
  loadLinkedNames: (appUserId: string) => Promise<readonly string[]>;
  /**
   * The model call; `hasLinkedData` lets the provider policy refuse it, and
   * `actor` is who a personal-data audit event is written for.
   */
  generate: (hasLinkedData: boolean, actor: string) => StarterGenerate;
  timeoutMs: number;
  logError: (message: string, errorName: string) => void;
  /** Rate limit and bot check, as for chat; a Response means refused. */
  guard?: (request: Request, clerkId: string) => Promise<Response | null>;
}>;

const bodySchema = z.object({
  roles: z.array(z.string()).max(10),
  dataChoice: z.string().nullable(),
  interest: z.string().max(MAX_INTEREST_LENGTH * 2),
});

export const createStarterQuestionsHandler =
  (deps: StarterHandlerDeps) =>
  async (request: Request): Promise<Response> => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "That request didn't look right. Try again." },
        { status: 400 },
      );
    }

    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return Response.json(
        { error: "Sign in to get starter questions." },
        { status: 401 },
      );
    }

    const blocked = deps.guard ? await deps.guard(request, clerkId) : null;
    if (blocked) return blocked;

    const linked = await deps
      .findAppUserId(clerkId)
      .then((appUserId) => (appUserId ? deps.loadLinkedNames(appUserId) : []))
      .catch((error: unknown) => {
        deps.logError(
          "[onboarding] could not read linked sources",
          error instanceof Error ? error.name : "unknown",
        );
        return [];
      });

    const result: StarterResult = await generateStarterQuestions(
      {
        roles: parsed.data.roles.filter(isRoleId),
        dataChoice: isDataChoiceId(parsed.data.dataChoice)
          ? parsed.data.dataChoice
          : null,
        interest: parsed.data.interest.slice(0, MAX_INTEREST_LENGTH),
        connected: linked,
      },
      {
        generate: deps.generate(linked.length > 0, clerkId),
        timeoutMs: deps.timeoutMs,
        logError: deps.logError,
      },
    );

    return Response.json(result);
  };
