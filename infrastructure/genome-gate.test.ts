import { afterEach, describe, expect, test } from "bun:test";

import { resetServerEnvCacheForTests } from "./env";
import {
  chatModelIsLocal,
  chatOnLoopback,
  genomeChatPermit,
  genomeRunPermit,
  vcfVariantsChatPermit,
} from "./genome-gate";

/**
 * The gates read this server's settings on every call. These tests set a
 * made-up environment, the way an operator would, and check that each gate
 * passes the right parts of it to the policy: the data mode, the genome
 * source and whether the chat model is Ollama on this machine.
 */

const ORIGINAL = { ...process.env };

/** A local MVP with Ollama on this machine. */
const LOCAL: Readonly<Record<string, string>> = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LOCAL_USER_ID: "local",
  DATABASE_URL: "postgresql://synthetic@127.0.0.1:5432/none",
  TWINLLM_STATE_DIR: "/nonexistent/twin-llm-test-state",
  LOCAL_ONLY: "true",
  LLM_PROVIDER: "ollama",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
};

/** Ollama on another host; LOCAL_ONLY must be off for the server to start that way. */
const OLLAMA_ELSEWHERE: Readonly<Record<string, string>> = {
  LOCAL_ONLY: "false",
  OLLAMA_BASE_URL: "http://gpu.example.org:11434/v1",
};

const replaceEnv = (values: Readonly<Record<string, string | undefined>>) => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, values);
  resetServerEnvCacheForTests();
};

const useEnv = (values: Readonly<Record<string, string>>) =>
  replaceEnv({ ...ORIGINAL, ...LOCAL, ...values });

afterEach(() => replaceEnv(ORIGINAL));

const refusal = (reason: string) => expect.objectContaining({ ok: false, reason });

describe("chatOnLoopback and chatModelIsLocal", () => {
  test("Ollama on this machine is local", () => {
    useEnv({ DATA_MODE: "personal" });
    expect(chatOnLoopback()).toBe(true);
    expect(chatModelIsLocal()).toBe(true);
  });

  test("Ollama on another host is not", () => {
    useEnv({ DATA_MODE: "personal", ...OLLAMA_ELSEWHERE });
    expect(chatOnLoopback()).toBe(false);
    expect(chatModelIsLocal()).toBe(false);
  });
});

describe("vcfVariantsChatPermit", () => {
  test("allows personal mode with Ollama on this machine, without Ark", () => {
    useEnv({ DATA_MODE: "personal" });
    expect(vcfVariantsChatPermit()).toEqual({ ok: true });
  });

  test("refuses synthetic mode, and Ollama on another host", () => {
    useEnv({ DATA_MODE: "synthetic" });
    expect(vcfVariantsChatPermit()).toEqual(refusal("data-mode-not-personal"));
    useEnv({ DATA_MODE: "personal", ...OLLAMA_ELSEWHERE });
    expect(vcfVariantsChatPermit()).toEqual(refusal("chat-model-not-local"));
  });
});

describe("genomeChatPermit and genomeRunPermit", () => {
  test("a run needs personal mode and Ark; a chat also needs Ollama local", () => {
    useEnv({ DATA_MODE: "personal", GENOME_SOURCE: "ark" });
    expect(genomeRunPermit()).toEqual({ ok: true });
    expect(genomeChatPermit()).toEqual({ ok: true });
  });

  test("without Ark neither may touch a genotype", () => {
    useEnv({ DATA_MODE: "personal" });
    expect(genomeRunPermit()).toEqual(refusal("genome-source-not-ark"));
    expect(genomeChatPermit()).toEqual(refusal("genome-source-not-ark"));
  });

  test("with Ollama elsewhere the run is fine but the chat is refused", () => {
    useEnv({ DATA_MODE: "personal", GENOME_SOURCE: "ark", ...OLLAMA_ELSEWHERE });
    expect(genomeRunPermit()).toEqual({ ok: true });
    expect(genomeChatPermit()).toEqual(refusal("chat-model-not-local"));
  });
});
