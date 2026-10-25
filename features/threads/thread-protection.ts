import "server-only";

import { detectBot, slidingWindow } from "@arcjet/next";

import { arcjetClient } from "@/infrastructure/arcjet";
import { toProtectionVerdict } from "@/infrastructure/protection-verdict";

import { runThreadGuard, type ThreadCheck } from "./thread-guard";

/**
 * Abuse protection for `/t/[threadId]` pages.
 *
 * There may be no signed-in user on these requests, so the rate limit is per
 * client address. It is set high enough that a real person following a link
 * never meets it; it only stops one address hammering the route. Automated
 * clients are refused outright: nothing legitimate crawls these pages.
 *
 * Without ARCJET_KEY (auth-off demos) there is no check at all.
 */
const LIMIT = { interval: "60s", max: 60 } as const;

const buildThreadCheck = (): ThreadCheck | null => {
  const base = arcjetClient();
  if (base === null) return null;
  const rules = base
    .withRule(detectBot({ mode: "LIVE", allow: [] }))
    .withRule(slidingWindow({ mode: "LIVE", ...LIMIT }));
  return async (request) => toProtectionVerdict(await rules.protect(request));
};

const memo: { check?: ThreadCheck | null } = {};

/** Null when the request may proceed; otherwise the plain response to send. */
export const guardThreadRequest = async (request: Request): Promise<Response | null> => {
  if (memo.check === undefined) memo.check = buildThreadCheck();
  return runThreadGuard(memo.check, request);
};
