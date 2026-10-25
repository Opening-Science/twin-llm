import "server-only";

import type { DataMode } from "./data-mode-policy";
import { serverEnv } from "./env";

export type { DataMode, ExoscalePersonalData, LlmProvider } from "./data-mode-policy";
export {
  assertProviderAllowedForDataMode,
  PERSONAL_DATA_SENT_AUDIT_TOOL,
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  sendsPersonalDataToHostedModel,
} from "./data-mode-policy";

export const dataMode = (): DataMode => serverEnv().DATA_MODE;

export const isRealDataMode = (): boolean => dataMode() === "personal";
