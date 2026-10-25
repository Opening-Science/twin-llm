import "server-only";

import { auth } from "@clerk/nextjs/server";

import { isAuthDisabled, serverEnv } from "./env";

/**
 * Resolves the durable actor id used as `User.clerkId`.
 * When auth is disabled for local MVP, returns LOCAL_USER_ID (default "local").
 */
export const resolveActorId = async (): Promise<string | null> => {
  if (isAuthDisabled()) {
    return serverEnv().LOCAL_USER_ID;
  }

  const { userId } = await auth();
  return userId;
};
