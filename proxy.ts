import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, NextResponse, type NextRequest } from "next/server";

import { guardThreadRequest } from "@/features/threads/thread-protection";
import {
  authOffRefusalResponse,
  checkAuthOffRequest,
} from "@/infrastructure/auth-off-request-guard";
import { isAuthDisabled } from "@/infrastructure/env";

/**
 * Next 16's request hook (formerly `middleware.ts`).
 *
 * Signed-in deployments run through Clerk. With auth off there is no Clerk at
 * all, so the request is first held to "this machine, this app" by
 * `checkAuthOffRequest`. Thread pages get the Arcjet thread rules either way.
 */
const applyThreadRules = async (request: NextRequest): Promise<Response> => {
  const isThreadPage = request.nextUrl.pathname.startsWith("/t/");
  const refused = isThreadPage ? await guardThreadRequest(request) : null;
  return refused ?? NextResponse.next();
};

const signedInProxy = clerkMiddleware((_auth, request) => applyThreadRules(request));

const proxy = async (request: NextRequest, event: NextFetchEvent): Promise<Response> => {
  if (!isAuthDisabled())
    return (await signedInProxy(request, event)) ?? NextResponse.next();

  const refusal = checkAuthOffRequest(request);
  if (refusal !== null) {
    console.warn(`[proxy] auth-off request refused (${refusal.reason})`);
    return authOffRefusalResponse(refusal);
  }
  return applyThreadRules(request);
};

export default proxy;

export const config = {
  // Everything except Next internals and static files, plus every API route.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest))(?:.*)|api|trpc)(.*)",
  ],
};
