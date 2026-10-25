import {
  type DataMode,
  type ExoscalePersonalData,
  type LlmProvider,
  permitProviderForRequest,
} from "@/infrastructure/data-mode-policy";
import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import { personalDataSentEvent } from "@/infrastructure/personal-data-audit";
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
  stream: (call: ChatRequest, context: StreamContext) => Promise<Response>;
}>;

export const createStartAnswer =
  (deps: StartAnswerDeps) =>
  async (actorId: string, appUserId: string, call: ChatRequest): Promise<Response> => {
    const settings = deps.settings();
    const wearables = await deps.loadWearables(settings.dataMode, appUserId);
    const request = {
      mode: settings.dataMode,
      provider: settings.provider,
      hasWearableNarrative: Object.values(wearables).some((summary) => summary !== null),
      exoscalePersonalData: settings.exoscalePersonalData,
    };
    const permit = permitProviderForRequest(request);
    if (!permit.ok) {
      return Response.json({ code: permit.code, error: permit.error }, { status: 400 });
    }

    const event = personalDataSentEvent(request, {
      actor: actorId,
      sessionId: call.turnId,
      modelId: call.modelId,
    });
    if (event !== null) await deps.appendAudit(event);

    return deps.stream(call, {
      clerkId: actorId,
      disabledSources: await deps.loadDisabledSources(appUserId),
      ...wearables,
    });
  };
