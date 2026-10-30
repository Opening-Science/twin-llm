import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

import {
  dirtyFlag,
  parseCommit,
  parseOpenTwinPin,
  parseOpenTwinShaFile,
} from "./infrastructure/build-stamp";

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

const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const provenanceText = readOrNull("PROVENANCE.md");
const openTwinShaText = readOrNull(".open-twin/OPEN_TWIN_SHA");

/**
 * What the Lab page's Provenance card reports (`buildInfo()` in
 * infrastructure/env.ts): the version, the commit, whether the tree was clean
 * (or unknown when git could not say), and the open-twin pin and checkout as
 * they were when this build was made. Written in at build time, so a running
 * server reports what it was built from; the card compares it with the
 * checkout on disk now to say when a rebuild is needed.
 */
const BUILD_ENV = {
  TWINLLM_APP_VERSION: String(
    (JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown }).version ??
      "",
  ),
  TWINLLM_BUILD_COMMIT: parseCommit(git("rev-parse", "HEAD")) ?? "",
  TWINLLM_BUILD_DIRTY: dirtyFlag(git("status", "--porcelain")),
  TWINLLM_BUILD_OPEN_TWIN_PIN:
    (provenanceText === null ? null : parseOpenTwinPin(provenanceText)) ?? "",
  TWINLLM_BUILD_OPEN_TWIN_CHECKOUT:
    (openTwinShaText === null ? null : parseOpenTwinShaFile(openTwinShaText)) ?? "",
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
