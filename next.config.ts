import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

/**
 * The open-twin provider packages ship TypeScript sources, so Next compiles
 * them along with the app.
 *
 * There is deliberately no analytics proxy route here: when browser analytics
 * are enabled the PostHog client talks to its own host, so requests to it
 * never carry this app's cookies.
 */
const OPEN_TWIN_SOURCE_PACKAGES = [
  "@open-twin/fhir-core",
  "@open-twin/provider-google-health",
  "@open-twin/provider-oura",
  "@open-twin/provider-whoop",
];

/** Output of a git command, or null outside a checkout or without git. */
const git = (...args: string[]): string | null => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * The version and commit the Lab page shows (`buildInfo()` in
 * infrastructure/env.ts). Written in at build time, so a running server
 * reports what it was built from, not what the checkout holds now.
 */
const BUILD_ENV = {
  TWINLLM_APP_VERSION: String(
    (JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown }).version ??
      "",
  ),
  TWINLLM_BUILD_COMMIT: git("rev-parse", "HEAD") ?? "",
  TWINLLM_BUILD_DIRTY: String((git("status", "--porcelain") ?? "") !== ""),
};

const config: NextConfig = {
  transpilePackages: OPEN_TWIN_SOURCE_PACKAGES,
  env: BUILD_ENV,
  experimental: {
    // proxy.ts runs on every API route, and Next buffers a request body for it
    // only up to this size, then passes the route a silently cut body. Imports
    // on Customize · Data take files up to 50 MB plus the multipart envelope
    // (docs/personal-data.md); the route refuses anything larger itself.
    proxyClientMaxBodySize: "52mb",
  },
};

export default config;
