import {
  type DataMode,
  type ExoscalePersonalData,
  type LlmProvider,
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_SENTENCE,
} from "@/infrastructure/data-mode-policy";
import { genomeThreadRefusedEvent } from "@/infrastructure/genome-thread-audit";
import {
  GENOME_THREAD_SENTENCE,
  historyShowsGenome,
  permitGenomeThreadTurn,
  requestsGenomeTools,
} from "@/infrastructure/genome-thread-policy";
import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import type { CatalogAgent } from "@/infrastructure/model-catalog";
import { personalDataSentEvent } from "@/infrastructure/personal-data-audit";
import {
  agentSkillUnavailable,
  permitSkillRequest,
  SKILL_NOT_OFFERED,
  skillNotOffered,
  skillRunEvent,
  type TurnSkill,
} from "@/infrastructure/skill-gate";
import { uiContextEvent } from "@/infrastructure/ui-context";
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
 * runs without the genome tools (`genome-tool-deps.ts`). The genome rule per
 * thread does (#151): a thread where a genome tool ran, a history that shows
 * one, or a skill that asks for one runs only on a local chat model. Any other
 * model is refused after the skill refusals and before the data-mode policy,
 * so before any history is sent. The refusal is audited (provider and a hash
 * of the thread id); if that write fails the turn is still refused.
 *
 * A turn's UI context (#47) is written to the audit chain as `ui.context`
 * before the model is called, like a skill run; if that write fails, the
 * model is not called.
 *
 * An agent (`agent:<id>`, #218) runs on its base model with its skill when the
 * prompt names none; a `/skill` in the prompt wins. Its skill goes through
 * every check above, as if typed; a refusal of the agent's own skill names
 * the agent. The answer row stays keyed by `agent:<id>`;
 * the audit rows name the base model, which is what saw the data, and the
 * skill row names the agent too. An agent Auto picked (#219) runs exactly the
 * same way; its skill row adds `via: "auto"`.
 */

export type ChatProviderSettings = Readonly<{
  dataMode: DataMode;
  provider: LlmProvider;
  exoscalePersonalData: ExoscalePersonalData;
}>;

/** Whether a turn's thread already used a genome tool (`load-genome-thread.ts`). */
export type GenomeThread = Readonly<{ threadId: string; usedGenome: boolean }>;

export type StartAnswerDeps = Readonly<{
  settings: () => ChatProviderSettings;
  /** True when the chat model runs on this machine (Ollama on loopback). */
  chatIsLocal: () => boolean;
  loadGenomeThread: (turnId: string) => Promise<GenomeThread>;
  loadWearables: (mode: DataMode, appUserId: string) => Promise<WearableContext>;
  loadDisabledSources: (appUserId: string) => Promise<readonly KnowledgeSourceId[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  /** A runnable skill by name, shipped or the person's own (#174), or null. */
  findSkill: (name: string, appUserId: string) => Promise<TurnSkill | null>;
  stream: (call: ChatRequest, context: StreamContext) => Promise<Response>;
  /** Stores the refusal sentence on the turn's row for this model. */
  markRefused: (
    target: Readonly<{ turnId: string; modelId: string; sentence: string }>,
  ) => Promise<void>;
}>;

type Refusal = Readonly<{ code: string; error: string }>;

export const createStartAnswer =
  (deps: StartAnswerDeps) =>
  async (
    actorId: string,
    appUserId: string,
    call: ChatRequest,
    agent: CatalogAgent | null = null,
  ): Promise<Response> => {
    const refuse = async (
      refusal: Refusal,
      sentence: string = refusal.error,
    ): Promise<Response> => {
      await deps.markRefused({ turnId: call.turnId, modelId: call.modelId, sentence });
      return Response.json({ code: refusal.code, error: refusal.error }, { status: 400 });
    };

    const settings = deps.settings();
    const agentSkill = call.skill === undefined ? (agent?.skill ?? null) : null;
    const skillName = call.skill ?? agentSkill;
    const skill = skillName === null ? null : await deps.findSkill(skillName, appUserId);
    if (skillName !== null && skill === null) {
      return refuse(
        agentSkill !== null && agent !== null
          ? agentSkillUnavailable(
              agent.name,
              { name: agentSkill, providers: null },
              SKILL_NOT_OFFERED,
            )
          : skillNotOffered(skillName),
      );
    }
    const modelId = agent?.baseModelId ?? call.modelId;
    const thread = await deps.loadGenomeThread(call.turnId);
    const genomeThread =
      thread.usedGenome ||
      historyShowsGenome(call.messages) ||
      (skill !== null && requestsGenomeTools(skill.tools));
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
      if (!skillPermit.ok) {
        return refuse(
          agentSkill !== null &&
            agent !== null &&
            skillPermit.code === "provider-not-allowed-by-skill"
            ? agentSkillUnavailable(agent.name, skill, skillPermit.code)
            : skillPermit,
        );
      }
    }
    const genomePermit = permitGenomeThreadTurn({
      genomeThread,
      chatIsLocal: deps.chatIsLocal(),
    });
    if (!genomePermit.ok) {
      await deps
        .appendAudit(
          genomeThreadRefusedEvent({
            actor: actorId,
            sessionId: call.turnId,
            threadId: thread.threadId,
            provider: request.provider,
          }),
        )
        .catch((error: unknown) => {
          console.error(
            "[chat] could not audit the genome thread refusal",
            error instanceof Error ? error.name : "unknown",
          );
        });
      return refuse(genomePermit, GENOME_THREAD_SENTENCE);
    }
    const permit = permitProviderForRequest(request);
    if (!permit.ok) return refuse(permit, PROVIDER_NOT_PERMITTED_SENTENCE);

    const event = personalDataSentEvent(request, {
      actor: actorId,
      sessionId: call.turnId,
      modelId,
    });
    if (event !== null) await deps.appendAudit(event);
    if (skill !== null) {
      await deps.appendAudit(
        skillRunEvent(skill, {
          actor: actorId,
          sessionId: call.turnId,
          modelId,
          provider: request.provider,
          ...(agentSkill === null || agent === null
            ? {}
            : {
                agent: agent.id,
                ...(agent.via === undefined ? {} : { via: agent.via }),
              }),
        }),
      );
    }

    if (call.uiContext !== undefined) {
      await deps.appendAudit(
        uiContextEvent(call.uiContext, {
          actor: actorId,
          sessionId: call.turnId,
          modelId,
        }),
      );
    }

    return deps.stream(call, {
      clerkId: actorId,
      genomeThread,
      disabledSources: await deps.loadDisabledSources(appUserId),
      ...(skill === null ? {} : { skill }),
      ...(agent === null ? {} : { agent }),
      ...wearables,
    });
  };
