"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { isLocalOnly } from "@/infrastructure/env";
import { saveLiveSources } from "@/infrastructure/live-source-store";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

import {
  decideLiveSourceSave,
  type LiveSourceSave,
  liveSourceAuditEvent,
} from "./live-source-save";

/**
 * The live source switches on Customize · Connectors (#6). The audit row
 * (`live.sources.set`, the ids that are on) is written first: if it cannot
 * be, nothing changes. A failure is a sentence, never a database message.
 */

const inputSchema = z.object({ enabled: z.array(z.string()).max(10) }).strict();

const NOT_SAVED = "Your choice wasn't saved. Try again in a moment.";

export const saveLiveSourceChoice = async (input: unknown): Promise<LiveSourceSave> => {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", error: NOT_SAVED };
  const locked = await vaultRefusalForAction();
  if (locked !== null) return { ok: false, code: "LOCKED", error: locked };
  const decision = decideLiveSourceSave(parsed.data.enabled, isLocalOnly());
  if (!decision.ok) return decision;
  try {
    const actor = await resolveActorId();
    if (!actor)
      return { ok: false, code: "SIGNED_OUT", error: "Sign in to keep your choice." };
    const userId = (await ensureAppUser(actor)).id;
    await append(database(), liveSourceAuditEvent(actor, decision.enabled));
    await saveLiveSources(userId, decision.enabled);
    revalidatePath("/customize/connectors");
    return decision;
  } catch (error) {
    console.error(
      "[live-sources] save failed",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, code: "NOT_SAVED", error: NOT_SAVED };
  }
};
