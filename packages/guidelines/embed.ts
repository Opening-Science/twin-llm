import {
  CATEGORY,
  ledgeredFetch,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import { serverEnv } from "@/infrastructure/env";
import { isLoopbackUrl } from "@/infrastructure/loopback";

import {
  DEFAULT_OLLAMA_OPENAI_URL,
  DOCUMENT_EMBED_PREFIX,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  QUERY_EMBED_PREFIX,
} from "./constants";

export type EmbedTask = "document" | "query";

export type EmbedPorts = {
  readonly fetch: typeof fetch;
  readonly origin: string;
  readonly model: string;
  readonly dim: number;
  /** LOCAL_ONLY mode: refuse any origin that is not on this machine. */
  readonly requireLoopback?: boolean;
};

const BLOCKED_HOSTS = ["api.openai.com", "openrouter.ai", "api.infomaniak.com"];

export const ollamaNativeOrigin = (openAiBaseUrl: string): string =>
  openAiBaseUrl.replace(/\/v1\/?$/, "");

export const assertLocalEmbedOrigin = (
  origin: string,
  { requireLoopback = false }: { readonly requireLoopback?: boolean } = {},
): void => {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("GUIDELINE_EMBED_ORIGIN_INVALID");
  }
  const host = parsed.hostname;
  if (BLOCKED_HOSTS.includes(host)) {
    throw new Error("GUIDELINE_EMBED_ORIGIN_BLOCKED");
  }
  if (requireLoopback && !isLoopbackUrl(origin)) {
    throw new Error("GUIDELINE_EMBED_ORIGIN_NOT_LOCAL");
  }
};

const prefixFor = (task: EmbedTask): string =>
  task === "query" ? QUERY_EMBED_PREFIX : DOCUMENT_EMBED_PREFIX;

const asNumberVector = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) return null;
  const numbers = value.map((item) => Number(item));
  if (numbers.some((item) => !Number.isFinite(item))) return null;
  return numbers;
};

const parseEmbedBody = (body: unknown): number[] | null => {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const single = asNumberVector(record.embedding);
  if (single) return single;
  const many = record.embeddings;
  if (Array.isArray(many) && many.length > 0) {
    return asNumberVector(many[0]);
  }
  return null;
};

export const defaultEmbedPorts = (
  env: { readonly OLLAMA_BASE_URL?: string; readonly LOCAL_ONLY?: boolean } = serverEnv(),
): EmbedPorts => ({
  fetch,
  origin: ollamaNativeOrigin(env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_OPENAI_URL),
  model: EMBEDDING_MODEL,
  dim: EMBEDDING_DIM,
  requireLoopback: env.LOCAL_ONLY ?? false,
});

/**
 * Ports for embedding a search query that a chat turn wrote. On this machine
 * nothing leaves, so the ports are unchanged. An Ollama elsewhere receives
 * the query text, so each request is written to the disclosure ledger (#140)
 * first and is not sent when that fails (the search then has no vector).
 */
export const queryEmbedPorts = (
  base: EmbedPorts,
  call: Readonly<{
    actor: string;
    sessionId: string;
    synthetic: boolean;
    purpose: string;
    record: RecordDisclosure;
  }>,
): EmbedPorts =>
  isLoopbackUrl(base.origin)
    ? base
    : {
        ...base,
        fetch: ledgeredFetch(base.fetch, (payloadBytes) =>
          call.record({
            actor: call.actor,
            sessionId: call.sessionId,
            kind: "embedding",
            recipient: "ollama on another machine",
            target: base.model,
            purpose: call.purpose,
            categories: [CATEGORY.searchText],
            refs: [],
            payloadBytes,
            threadId: null,
            synthetic: call.synthetic,
          }),
        ),
      };

/**
 * Prefer POST /api/embed (current Ollama native API, `input` field).
 * Fall back to POST /api/embeddings only when /api/embed is missing: older
 * Ollama daemons expose the single-`prompt` path and nothing else. Both stay
 * on `ports.origin`. There is no cloud fallback; a down daemon returns null.
 */
const postEmbed = async (
  ports: EmbedPorts,
  path: string,
  payload: unknown,
): Promise<number[] | null> => {
  const url = `${ports.origin}${path}`;
  assertLocalEmbedOrigin(url, { requireLoopback: ports.requireLoopback });
  const response = await ports.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return null;
  return parseEmbedBody(await response.json());
};

export const embedText = async (
  text: string,
  task: EmbedTask,
  ports: EmbedPorts = defaultEmbedPorts(),
): Promise<number[] | null> => {
  assertLocalEmbedOrigin(ports.origin, { requireLoopback: ports.requireLoopback });
  const prefixed = `${prefixFor(task)}${text}`;
  try {
    const modern = await postEmbed(ports, "/api/embed", {
      model: ports.model,
      input: prefixed,
    });
    const vector =
      modern ??
      (await postEmbed(ports, "/api/embeddings", {
        model: ports.model,
        prompt: prefixed,
      }));
    if (!vector || vector.length !== ports.dim) return null;
    return vector;
  } catch {
    return null;
  }
};
