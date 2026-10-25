import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";

import {
  CHAT_RESPONSE_DOCUMENT,
  type ChatResponseDocument,
} from "@/infrastructure/response-document/constants";

export { CHAT_RESPONSE_DOCUMENT, type ChatResponseDocument };

export const chatResponseMetadata = <Document>(
  metrics: ModelResponseMetrics,
  document?: Document,
): ModelResponseMetrics & ChatResponseDocument & { readonly document?: Document } => ({
  ...metrics,
  ...CHAT_RESPONSE_DOCUMENT,
  ...(document === undefined ? {} : { document }),
});
