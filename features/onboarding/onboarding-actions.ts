"use server";

import { z } from "zod";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { isLocalOnly } from "@/infrastructure/env";
import { loadLiveSources } from "@/infrastructure/live-source-store";
import { changedLists, saveAuditedSettings } from "@/infrastructure/setting-save";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

import {
  completeOnboarding,
  loadDisabledSources,
  saveOnboarding,
} from "./onboarding-store";
import { MAX_INTEREST_LENGTH, normaliseAnswers } from "./onboarding-steps";

/**
 * The writes the /start flow makes. Each one resolves the actor itself, so a
 * caller cannot save answers for someone else. Values are cleaned by the same
 * rules as every read; a failure is a sentence, never a database message.
 */

export type OnboardingSaveResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>;

const saveInputSchema = z.object({
  answers: z.object({
    roles: z.array(z.string()).max(10),
    dataChoice: z.string().nullable(),
    interest: z.string().max(MAX_INTEREST_LENGTH * 2),
    disabledSources: z.array(z.string()).max(20),
    liveSources: z.array(z.string()).max(10).default([]),
  }),
  step: z.number().int(),
  complete: z.boolean(),
});

const NOT_SAVED = "Your choices weren't saved. Try again in a moment.";

const actorUserId = async (): Promise<string | null> => {
  const clerkId = await resolveActorId();
  return clerkId ? (await ensureAppUser(clerkId)).id : null;
};

export const saveOnboardingAnswers = async (
  input: unknown,
): Promise<OnboardingSaveResult> => {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_SAVED };
  const locked = await vaultRefusalForAction();
  if (locked !== null) return { ok: false, error: locked };
  try {
    const actor = await resolveActorId();
    if (!actor) return { ok: false, error: "Sign in to keep your choices." };
    const userId = (await ensureAppUser(actor)).id;
    const cleaned = normaliseAnswers(parsed.data.answers);
    // Local-only mode sends nothing to public databases (#6): no live source is kept on.
    const answers = isLocalOnly() ? { ...cleaned, liveSources: [] } : cleaned;
    const [disabledBefore, liveBefore] = await Promise.all([
      loadDisabledSources(userId),
      loadLiveSources(userId),
    ]);
    // Sources and live lookups are audited first, as on Settings (#507).
    const result = await saveAuditedSettings(
      {
        audit: (event) => append(database(), event),
        store: () =>
          saveOnboarding(userId, {
            answers,
            step: parsed.data.step,
            complete: parsed.data.complete,
          }),
        logError: console.error,
      },
      {
        actor,
        changes: changedLists([
          {
            setting: "knowledge-sources",
            before: disabledBefore,
            after: answers.disabledSources,
          },
          { setting: "live-sources", before: liveBefore, after: answers.liveSources },
        ]),
      },
    );
    return result.ok ? { ok: true } : { ok: false, error: NOT_SAVED };
  } catch (error) {
    console.error(
      "[onboarding] save failed",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, error: NOT_SAVED };
  }
};

/** Skip setup: the flow is done and the app opens as usual. */
export const skipOnboarding = async (): Promise<OnboardingSaveResult> => {
  const locked = await vaultRefusalForAction();
  if (locked !== null) return { ok: false, error: locked };
  try {
    const userId = await actorUserId();
    if (!userId) return { ok: false, error: "Sign in to keep your choices." };
    await completeOnboarding(userId);
    return { ok: true };
  } catch (error) {
    console.error(
      "[onboarding] skip failed",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, error: NOT_SAVED };
  }
};
