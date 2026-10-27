import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";

import {
  type ModelResponseCompleteParams,
  type ModelResponseWritePort,
  writeModelResponseComplete,
  writeModelResponseFailed,
  writeModelResponseRefused,
} from "./write-model-response-complete";

/** The terminal row writes, bound to the real database. */

/** Prisma wants `JsonNull` for a null Json column; a plain null is refused. */
const completePort: ModelResponseWritePort = {
  update: ({ where, data }) =>
    database().modelResponse.update({
      where,
      data: {
        ...data,
        toolParts:
          data.toolParts === null
            ? Prisma.JsonNull
            : (data.toolParts as Prisma.InputJsonValue | undefined),
      },
    }),
};

export const markModelResponseComplete = (params: ModelResponseCompleteParams) =>
  writeModelResponseComplete(completePort, params);

export const markModelResponseFailed = (
  target: Readonly<{ turnId: string; modelId: string }>,
) => writeModelResponseFailed(database().modelResponse, target);

export const markModelResponseRefused = (
  target: Readonly<{ turnId: string; modelId: string; sentence: string }>,
) => writeModelResponseRefused(database().modelResponse, target);
