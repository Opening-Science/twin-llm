import type { AppendInput } from "@/packages/audit/append";

import {
  PERSONAL_DATA_SENT_AUDIT_TOOL,
  type ProviderRequest,
  sendsPersonalDataToHostedModel,
} from "./data-mode-policy";

/**
 * The audit event for one personal request sent to a hosted model under the
 * consented pilot, or null when the request needs none. Pure: the caller
 * appends it before the model call, and does not call the model if that
 * append fails. Provider and model id only, never prompt or answer text.
 */
export const personalDataSentEvent = (
  request: ProviderRequest,
  call: Readonly<{ actor: string; sessionId: string; modelId: string }>,
): AppendInput | null =>
  sendsPersonalDataToHostedModel(request)
    ? {
        actor: call.actor,
        sessionId: call.sessionId,
        subjectRef: null,
        tool: PERSONAL_DATA_SENT_AUDIT_TOOL,
        args: { provider: request.provider, modelId: call.modelId },
        result: { sent: true },
        rowCount: 0,
      }
    : null;
