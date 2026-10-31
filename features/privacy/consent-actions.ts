"use server";

import { revalidatePath } from "next/cache";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { dataMode } from "@/infrastructure/data-mode";
import { isLearningScope } from "@/infrastructure/learning-consent";
import {
  grantLearningConsent,
  withdrawLearningConsent,
} from "@/infrastructure/learning-consent-store";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";

import { chosenSources, PRIVACY_COPY } from "./privacy-view";

/**
 * Granting and withdrawing a learning consent on Customize · Privacy (#145).
 * Personal mode only, behind the unlock like every personal action. The
 * store writes the audit rows (`learning.consent.grant`, `.withdraw`).
 */

export type ConsentFormState = Readonly<{ message: string | null; ok: boolean }>;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

const owner = async (): Promise<Readonly<{ actor: string; userId: string }> | null> => {
  const actor = await resolveActorId();
  return actor === null ? null : { actor, userId: (await ensureAppUser(actor)).id };
};

export const grantConsent = async (
  _previous: ConsentFormState,
  form: FormData,
): Promise<ConsentFormState> => {
  const refused =
    dataMode() === "personal" ? await vaultRefusalForAction() : PRIVACY_COPY.synthetic;
  if (refused !== null) return { message: refused, ok: false };
  const who = await owner();
  if (who === null) return { message: PRIVACY_COPY.signIn, ok: false };
  const scope = String(form.get("scope") ?? "");
  if (!isLearningScope(scope)) return { message: PRIVACY_COPY.unknownScope, ok: false };
  const sources = chosenSources(
    form.getAll("sources").filter((value) => typeof value === "string"),
  );
  try {
    const outcome = await grantLearningConsent({ ...who, scope, sources });
    if (!outcome.ok) {
      return {
        message:
          outcome.problem === "no-sources"
            ? PRIVACY_COPY.noSources
            : PRIVACY_COPY.alreadyGranted,
        ok: false,
      };
    }
  } catch (error) {
    console.error("[privacy] could not grant a consent", errorName(error));
    return { message: PRIVACY_COPY.failed, ok: false };
  }
  revalidatePath("/customize/privacy");
  return { message: PRIVACY_COPY.granted, ok: true };
};

export const withdrawConsent = async (
  _previous: ConsentFormState,
  form: FormData,
): Promise<ConsentFormState> => {
  const refused =
    dataMode() === "personal" ? await vaultRefusalForAction() : PRIVACY_COPY.synthetic;
  if (refused !== null) return { message: refused, ok: false };
  const who = await owner();
  if (who === null) return { message: PRIVACY_COPY.signIn, ok: false };
  const consentId = String(form.get("consentId") ?? "");
  try {
    if (!(await withdrawLearningConsent({ ...who, consentId }))) {
      return { message: PRIVACY_COPY.notActive, ok: false };
    }
  } catch (error) {
    console.error("[privacy] could not withdraw a consent", errorName(error));
    return { message: PRIVACY_COPY.failed, ok: false };
  }
  revalidatePath("/customize/privacy");
  return { message: PRIVACY_COPY.withdrawn, ok: true };
};
