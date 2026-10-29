import { describe, expect, test } from "bun:test";

import {
  configuredEndpoints,
  type LocalOnlyEnv,
  localOnlyCheck,
} from "./local-only-check";

const LOCAL: LocalOnlyEnv = {
  LOCAL_ONLY: true,
  LLM_PROVIDER: "ollama",
  OLLAMA_BASE_URL: undefined,
  GENOME_SOURCE: "none",
  GBD_MCP_URL: undefined,
  NEXT_PUBLIC_POSTHOG_KEY: undefined,
  CLERK_SECRET_KEY: undefined,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined,
  ARCJET_KEY: undefined,
};

describe("configuredEndpoints", () => {
  test("default Ollama is on this machine", () => {
    expect(configuredEndpoints(LOCAL)).toEqual([
      { name: "Chat models: Ollama", local: true },
    ]);
  });

  test("a remote GPU tunnel on loopback still runs elsewhere", () => {
    expect(
      configuredEndpoints({ ...LOCAL, LOCAL_ONLY: false, LLM_PROVIDER: "remote-gpu" }),
    ).toEqual([{ name: "Chat models: Remote GPU (SSH tunnel)", local: false }]);
  });

  test("lists set keys by name only", () => {
    expect(
      configuredEndpoints({
        ...LOCAL,
        LOCAL_ONLY: false,
        OLLAMA_BASE_URL: "http://gpu.example.org:11434/v1",
        GENOME_SOURCE: "ark",
        GBD_MCP_URL: "https://gbd.example.org/mcp",
        NEXT_PUBLIC_POSTHOG_KEY: "phc_secret",
        CLERK_SECRET_KEY: "sk_secret",
        ARCJET_KEY: "ajkey_secret",
      }),
    ).toEqual([
      { name: "Chat models: Ollama", local: false },
      { name: "Genome sidecar (Carbon-X)", local: true },
      { name: "GBD server", local: false },
      { name: "Analytics (PostHog)", local: false },
      { name: "Sign-in (Clerk)", local: false },
      { name: "Request protection (Arcjet)", local: false },
    ]);
  });
});

describe("localOnlyCheck", () => {
  test("LOCAL_ONLY on is ok", () => {
    const check = localOnlyCheck(LOCAL);
    expect(check.status).toBe("ok");
    expect(check.evidence).toEqual([
      { label: "LOCAL_ONLY", value: "on", mono: true },
      { label: "LLM_PROVIDER", value: "ollama", mono: true },
      { label: "Chat models: Ollama", value: "on this machine" },
    ]);
  });

  test("off but all local is unknown", () => {
    const check = localOnlyCheck({ ...LOCAL, LOCAL_ONLY: false });
    expect(check.status).toBe("unknown");
    expect(check.summary).toBe(
      "LOCAL_ONLY is off. Everything configured runs on this machine, but nothing stops a cloud setting being added.",
    );
  });

  test("off with a cloud service is not ok and names it", () => {
    const check = localOnlyCheck({
      ...LOCAL,
      LOCAL_ONLY: false,
      LLM_PROVIDER: "exoscale",
      NEXT_PUBLIC_POSTHOG_KEY: "phc_secret",
    });
    expect(check.status).toBe("not-ok");
    expect(check.summary).toBe(
      "LOCAL_ONLY is off, and 2 services run off this machine: Chat models: Exoscale, Analytics (PostHog).",
    );
  });

  test("never shows a key or URL value", () => {
    const text = JSON.stringify(
      localOnlyCheck({
        ...LOCAL,
        LOCAL_ONLY: false,
        OLLAMA_BASE_URL: "http://gpu.example.org:11434/v1",
        CLERK_SECRET_KEY: "sk_secret",
      }),
    );
    expect(text.includes("sk_secret")).toBe(false);
    expect(text.includes("gpu.example.org")).toBe(false);
  });
});
