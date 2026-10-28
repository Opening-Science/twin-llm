import "server-only";

import type { DataMode } from "./data-mode-policy";
import { serverEnv } from "./env";

export type { DataMode, LlmProvider } from "./data-mode-policy";
export {
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
} from "./data-mode-policy";

export const dataMode = (): DataMode => serverEnv().DATA_MODE;
