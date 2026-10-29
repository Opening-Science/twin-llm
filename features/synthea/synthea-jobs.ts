import "server-only";

import { randomUUID } from "node:crypto";

import { syntheaEnv } from "@/infrastructure/env";
import { processSingleton } from "@/infrastructure/process-singleton";

import { createRateLimiter, type RateLimiter } from "./synthea-limits";
import { createJobQueue, type JobQueue } from "./synthea-queue";
import { createSyntheaRoutes } from "./synthea-routes";
import {
  checkJar,
  jarPathOf,
  makeJobDir,
  readJobZip,
  removeJobDir,
  runSyntheaJob,
  type JarStatus,
} from "./synthea-runner";

/**
 * The one queue and rate limiter of this server process, built on first use
 * from `syntheaEnv()`. A finished zip waits 10 minutes for its download.
 */

export const RESULT_TTL_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const syntheaQueue = processSingleton<JobQueue>("twinllm.synthea.queue", () => {
  const env = syntheaEnv();
  return createJobQueue({
    run: runSyntheaJob(env),
    makeDir: makeJobDir,
    removeDir: removeJobDir,
    readZip: readJobZip,
    logError: (message, error) => console.error(message, error),
    now: Date.now,
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
    newId: randomUUID,
    random: Math.random,
    timeoutMs: env.jobTimeoutMs,
    resultTtlMs: RESULT_TTL_MS,
    maxQueued: env.queueMax,
  });
});

export const syntheaRateLimiter = processSingleton<RateLimiter>(
  "twinllm.synthea.rate",
  () =>
    createRateLimiter({
      limit: syntheaEnv().jobsPerHour,
      windowMs: HOUR_MS,
      now: Date.now,
    }),
);

export const syntheaJarStatus = (): Promise<JarStatus> =>
  checkJar(jarPathOf(syntheaEnv()));

/** The job API handlers wired to this process's queue, limiter and JAR. */
export const syntheaRoutes = createSyntheaRoutes({
  queue: syntheaQueue,
  limiter: syntheaRateLimiter,
  maxPeople: () => syntheaEnv().maxPeople,
  jarReady: async () => (await syntheaJarStatus()) === "ready",
});
