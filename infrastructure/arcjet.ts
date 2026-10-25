import "server-only";

import arcjet, { shield } from "@arcjet/next";

import { serverEnv } from "./env";

/**
 * The base Arcjet client, built on first use.
 *
 * Only Shield lives here: it is free, needs no configuration, and every route
 * wants it. Anything route-specific is layered on with `withRule()` at the
 * route, so one endpoint's rate limit never silently applies to another.
 *
 * Lazy for the same reason the Prisma and OpenRouter clients are: `next build`
 * evaluates route modules to collect page data, and a build should not demand
 * a real ARCJET_KEY.
 *
 * Returns null when ARCJET_KEY is unset (LOCAL_MVP). Callers must no-op.
 */
type ArcjetClient = ReturnType<typeof createArcjetClient>;

let cached: ArcjetClient | null | undefined;

const createArcjetClient = () => {
  const key = serverEnv().ARCJET_KEY;
  if (!key) return null;
  return arcjet({
    key,
    rules: [shield({ mode: "LIVE" })],
  });
};

export const arcjetClient = (): ArcjetClient => {
  if (cached !== undefined) return cached;
  return (cached = createArcjetClient());
};
