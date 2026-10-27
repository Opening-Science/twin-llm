import {
  type DataMode,
  type ExoscalePersonalData,
  type LlmProvider,
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_SENTENCE,
} from "@/infrastructure/data-mode-policy";
import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import { personalDataSentEvent } from "@/infrastructure/personal-data-audit";
import {
  permitSkillRequest,
  skillNotOffered,
  skillRunEvent,
  type TurnSkill,
} from "@/infrastructure/skill-gate";
import type { AppendInput } from "@/packages/audit/append";

import type { ChatRequest } from "./chat-request";
import type { StreamContext } from "./stream-model-response";
import type { WearableContext } from "./wearable-context";

/**
 * The provider check and model start for one chat request, as a factory so
 * the route only wires the real reads and tests pass fakes (no mock.module).
 *
 * A refused provider gets the typed 400 with the rule sentence. A personal
 * request sent to Exoscale under the consented pilot is written to the audit
 * chain (provider and model id, no content) before the model is called; if
 * that write fails, the model is not called.
 *
 * A turn sent with a skill (`/sleep`) runs only if the server offers that
 * skill, the active provider is one it lists, and it reads wearable context
 * when the turn carries some. Those refusals come first, with a sentence that
 * names the skill; the data-mode policy still applies after them. The run is
 * written to the audit chain before the model is called, and the stream gets
 * the skill so tools, views and the system prompt follow it.
 *
 * Every refusal is also stored on the answer's row (`markRefused`) before the
 * 400 goes out, so a reload shows the refusal instead of asking again. Only
 * fixed sentences TwinLLM writes are stored: the skill gate's own, and for
 * the data-mode policy its person-facing sentence (the 400's `error` names
 * settings, which is for the operator).
 *
 * The genome gate never refuses a whole turn here: a turn it does not permit
 * runs without the genome tools (`genome-tool-deps.ts`).
 */

export type ChatProviderSettings = Readonly<{
  dataMode: DataMode;
  provider: LlmProvider;
  exoscalePersonalData: ExoscalePersonalData;
}>;

export type StartAnswerDeps = Readonly<{
  settings: () => ChatProviderSettings;
  loadWearables: (mode: DataMode, appUserId: string) => Promise<WearableContext>;
  loadDisabledSources: (appUserId: string) => Promise<readonly KnowledgeSourceId[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  /** A runnable skill by name (`features/skills`), or null when there is none. */
  findSkill: (name: string) => TurnSkill | null;
  stream: (call: ChatRequest, context: StreamContext) => Promise<Response>;
  /** Stores the refusal sentence on the turn's row for this model. */
  markRefused: (
    target: Readonly<{ turnId: string; modelId: string; sentence: string }>,
  ) => Promise<void>;
}>;

type Refusal = Readonly<{ code: string; error: string }>;

export const createStartAnswer =
  (deps: StartAnswerDeps) =>
  async (actorId: string, appUserId: string, call: ChatRequest): Promise<Response> => {
    const refuse = async (
      refusal: Refusal,
      sentence: string = refusal.error,
    ): Promise<Response> => {
      await deps.markRefused({ turnId: call.turnId, modelId: call.modelId, sentence });
      return Response.json({ code: refusal.code, error: refusal.error }, { status: 400 });
    };

    const settings = deps.settings();
    const skill = call.skill === undefined ? null : deps.findSkill(call.skill);
    if (call.skill !== undefined && skill === null) {
      return refuse(skillNotOffered(call.skill));
    }
    const wearables = await deps.loadWearables(settings.dataMode, appUserId);
    const request = {
      mode: settings.dataMode,
      provider: settings.provider,
      hasWearableNarrative: Object.values(wearables).some((summary) => summary !== null),
      exoscalePersonalData: settings.exoscalePersonalData,
    };
    if (skill !== null) {
      const skillPermit = permitSkillRequest(skill, {
        provider: request.provider,
        hasWearableContext: request.hasWearableNarrative,
      });
      if (!skillPermit.ok) return refuse(skillPermit);
    }
    const permit = permitProviderForRequest(request);
    if (!permit.ok) return refuse(permit, PROVIDER_NOT_PERMITTED_SENTENCE);

    const event = personalDataSentEvent(request, {
      actor: actorId,
      sessionId: call.turnId,
      modelId: call.modelId,
    });
    if (event !== null) await deps.appendAudit(event);
    if (skill !== null) {
      await deps.appendAudit(
        skillRunEvent(skill, {
          actor: actorId,
          sessionId: call.turnId,
          modelId: call.modelId,
          provider: request.provider,
        }),
      );
    }

    return deps.stream(call, {
      clerkId: actorId,
      disabledSources: await deps.loadDisabledSources(appUserId),
      ...(skill === null ? {} : { skill }),
      ...wearables,
    });
  };
