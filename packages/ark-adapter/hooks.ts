import "server-only";

import { serverEnv } from "@/infrastructure/env";

import type { ArkAuditContext, ArkAuditTool } from "./audit";

/**
 * Test-only overrides. Production always reads serverEnv() and appends
 * through packages/audit. Do not mock those modules from this package —
 * bun mock.module leaks across the repo test glob.
 */

export type ArkEnvView = {
  readonly GENOME_SOURCE: "none" | "ark";
  readonly ARK_DEVICE?: string;
};

export type ArkAuditFn = (
  ctx: ArkAuditContext,
  tool: ArkAuditTool,
  args: unknown,
  result: unknown,
) => Promise<void>;

let envOverride: ArkEnvView | null = null;
let auditOverride: ArkAuditFn | null = null;

export const arkEnv = (): ArkEnvView => {
  if (envOverride) return envOverride;
  const env = serverEnv();
  return { GENOME_SOURCE: env.GENOME_SOURCE, ARK_DEVICE: env.ARK_DEVICE };
};

export const arkAuditOverride = (): ArkAuditFn | null => auditOverride;

export const setArkAdapterTestHooks = (hooks: {
  readonly env?: ArkEnvView | null;
  readonly audit?: ArkAuditFn | null;
}): void => {
  if ("env" in hooks) envOverride = hooks.env ?? null;
  if ("audit" in hooks) auditOverride = hooks.audit ?? null;
};
