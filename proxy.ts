import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, NextResponse, type NextRequest } from "next/server";

import { syntheaHostRoute } from "@/features/synthea/synthea-host-route";
import { SYNTHEA_HOST_HEADER } from "@/features/synthea/synthea-paths";
import { guardThreadRequest } from "@/features/threads/thread-protection";
import {
  authOffRefusalResponse,
  checkAuthOffRequest,
} from "@/infrastructure/auth-off-request-guard";
import { isAuthDisabled, syntheaEnv } from "@/infrastructure/env";

/**
 * Next 16's request hook (formerly `middleware.ts`).
 *
 * Signed-in deployments run through Clerk. With auth off there is no Clerk at
 * all, so the request is first held to "this machine, this app" by
 * `checkAuthOffRequest`. Thread pages get the Arcjet thread rules either way.
 *
 * Requests for the generator's host (`SYNTHEA_HOST`) are answered first and
 * never reach the rest of the app: that host serves the public Synthea
 * generator only, which needs no sign-in and holds no personal data
 * (`features/synthea/synthea-host-route.ts`).
 */
const applyThreadRules = async (request: NextRequest): Promise<Response> => {
  const isThreadPage = request.nextUrl.pathname.startsWith("/t/");
  const refused = isThreadPage ? await guardThreadRequest(request) : null;
  return refused ?? NextResponse.next();
};

const signedInProxy = clerkMiddleware((_auth, request) => applyThreadRules(request));

const notFound = (): Response =>
  new Response("Not found.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

/** The generator host's answer, or null for a request to any other host. */
const syntheaHostResponse = (request: NextRequest): Response | null => {
  const route = syntheaHostRoute(
    request.headers.get("host"),
    request.nextUrl.pathname,
    syntheaEnv().host,
  );
  if (route.kind === "other-host") return null;
  if (route.kind === "not-found") return notFound();
  const headers = new Headers(request.headers);
  headers.set(SYNTHEA_HOST_HEADER, "1");
  if (route.kind === "pass") return NextResponse.next({ request: { headers } });
  const url = request.nextUrl.clone();
  url.pathname = route.pathname;
  return NextResponse.rewrite(url, { request: { headers } });
};

const proxy = async (request: NextRequest, event: NextFetchEvent): Promise<Response> => {
  const synthea = syntheaHostResponse(request);
  if (synthea !== null) return synthea;
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
