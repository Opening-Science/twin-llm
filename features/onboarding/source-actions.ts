"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { normaliseDisabledSources } from "@/infrastructure/knowledge-sources";
import {
  SETTING_NOT_SAVED,
  saveAuditedSetting,
  type SettingSave,
} from "@/infrastructure/setting-save";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

import { saveDisabledSources } from "./onboarding-store";

/**
 * The knowledge source switches on Settings (#507): the same column the first
 * run writes, saved alone and audited first (`settings.set`, the ids that are
 * off). A source the data mode does not allow stays refused by its own gate
 * at every call, whatever is stored here.
 */

const inputSchema = z.object({ disabled: z.array(z.string()).max(20) }).strict();

export const saveKnowledgeSourceChoice = async (input: unknown): Promise<SettingSave> => {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: SETTING_NOT_SAVED };
  const locked = await vaultRefusalForAction();
  if (locked !== null) return { ok: false, code: "LOCKED", error: locked };
  const actor = await resolveActorId();
  if (actor === null) {
    return { ok: false, code: "SIGNED_OUT", error: "Sign in to keep your choice." };
  }
  const result = await saveAuditedSetting(
    {
      audit: (event) => append(database(), event),
      store: async (value) => saveDisabledSources((await ensureAppUser(actor)).id, value),
      logError: console.error,
    },
    {
      actor,
      setting: "knowledge-sources",
      value: normaliseDisabledSources(parsed.data.disabled),
    },
  );
  if (result.ok) revalidatePath("/customize/settings");
  return result;
};
