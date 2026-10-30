import { DEFAULT_OLLAMA_BASE_URL, type ServerEnv } from "@/infrastructure/env";
import { isLoopbackUrl } from "@/infrastructure/loopback";

import { type LabCheck, plural } from "./lab-check";

/**
 * Whether LOCAL_ONLY is on, and where each configured service runs. Reads
 * which settings are present, never their values: a key is reported as
 * "set", a URL only as on or off this machine.
 */

export type LocalOnlyEnv = Pick<
  ServerEnv,
  | "LOCAL_ONLY"
  | "LLM_PROVIDER"
  | "OLLAMA_BASE_URL"
  | "GENOME_SOURCE"
  | "GBD_MCP_URL"
  | "NEXT_PUBLIC_POSTHOG_KEY"
  | "CLERK_SECRET_KEY"
  | "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  | "ARCJET_KEY"
>;

export type Endpoint = Readonly<{ name: string; local: boolean }>;

const PROVIDER_NAMES: Readonly<Record<ServerEnv["LLM_PROVIDER"], string>> = {
  ollama: "Ollama",
  exoscale: "Exoscale",
  openrouter: "OpenRouter",
  "remote-gpu": "Remote GPU (SSH tunnel)",
  infomaniak: "Infomaniak",
};

/** Every service this configuration talks to, and whether it runs on this machine. */
export const configuredEndpoints = (env: LocalOnlyEnv): readonly Endpoint[] => [
  {
    name: `Chat models: ${PROVIDER_NAMES[env.LLM_PROVIDER]}`,
    // A remote GPU tunnel listens on loopback, but the model runs elsewhere.
    local:
      env.LLM_PROVIDER === "ollama" &&
      isLoopbackUrl(env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL),
  },
  // Startup refuses a Carbon-X URL that is not on this machine.
  ...(env.GENOME_SOURCE === "ark"
    ? [{ name: "Genome sidecar (Carbon-X)", local: true }]
    : []),
  ...(env.GBD_MCP_URL === undefined ? [] : [{ name: "GBD server", local: false }]),
  ...(env.NEXT_PUBLIC_POSTHOG_KEY === undefined
    ? []
    : [{ name: "Analytics (PostHog)", local: false }]),
  ...(env.CLERK_SECRET_KEY === undefined &&
  env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === undefined
    ? []
    : [{ name: "Sign-in (Clerk)", local: false }]),
  ...(env.ARCJET_KEY === undefined
    ? []
    : [{ name: "Request protection (Arcjet)", local: false }]),
];

const HOW_TO = [
  "# Names and switches only; no keys are printed",
  "grep -E '^(LOCAL_ONLY|LLM_PROVIDER|DATA_MODE)=' .env.local",
  "bun run doctor",
].join("\n");

const summaryOf = (env: LocalOnlyEnv, remote: readonly Endpoint[]): string => {
  if (env.LOCAL_ONLY) {
    return "LOCAL_ONLY is on. At startup the app refused any model, analytics or sign-in setting that is not on this machine.";
  }
  if (remote.length === 0) {
    return "LOCAL_ONLY is off. Everything configured runs on this machine, but nothing stops a cloud setting being added.";
  }
  return `LOCAL_ONLY is off, and ${plural(remote.length, "service")} run off this machine: ${remote.map((endpoint) => endpoint.name).join(", ")}.`;
};

export const localOnlyCheck = (env: LocalOnlyEnv): LabCheck => {
  const endpoints = configuredEndpoints(env);
  const remote = endpoints.filter((endpoint) => !endpoint.local);
  return {
    id: "local-only",
    title: "Local only",
    status: env.LOCAL_ONLY ? "ok" : remote.length === 0 ? "unknown" : "not-ok",
    summary: summaryOf(env, remote),
    evidence: [
      { label: "LOCAL_ONLY", value: env.LOCAL_ONLY ? "on" : "off", mono: true },
      { label: "LLM_PROVIDER", value: env.LLM_PROVIDER, mono: true },
      ...endpoints.map((endpoint) => ({
        label: endpoint.name,
        value: endpoint.local ? "on this machine" : "off this machine",
      })),
    ],
    howTo: HOW_TO,
    links: [
      {
        label: "What local-only mode covers",
        href: "/docs/providers#local-only-mode",
      },
    ],
  };
};
