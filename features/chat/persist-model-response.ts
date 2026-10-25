import "server-only";

import { database } from "@/infrastructure/database";

import {
  type ModelResponseCompleteParams,
  writeModelResponseComplete,
  writeModelResponseFailed,
} from "./write-model-response-complete";

/** The terminal row writes, bound to the real database. */

export const markModelResponseComplete = (params: ModelResponseCompleteParams) =>
  writeModelResponseComplete(database().modelResponse, params);

export const markModelResponseFailed = (
  target: Readonly<{ turnId: string; modelId: string }>,
) => writeModelResponseFailed(database().modelResponse, target);
