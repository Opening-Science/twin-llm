/**
 * How much context a chat turn asks Ollama for, and how big a turn's request
 * is allowed to be. Pure, so the chat route, the doctor script and the budget
 * test read the same numbers.
 *
 * Ollama loads a model with a 4096-token context unless the request says
 * otherwise, and silently drops the start of a longer prompt: the tool
 * definitions go first, and the model then writes tool calls as text. Its
 * OpenAI-compatible endpoint (`/v1`) ignores `num_ctx`, so chat goes to the
 * native `/api/chat` with `options.num_ctx` instead (`OLLAMA_NUM_CTX`).
 */

/**
 * Where Ollama listens when `OLLAMA_BASE_URL` is not set: its OpenAI-compatible
 * root on this machine. The one copy of this address; chat, the setup doctor,
 * embeddings, the Lab page and the scripts all read it from here, and
 * `infrastructure/pinned-constants.test.ts` fails on any other copy.
 */
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

/**
 * 16k fits qwen3:4b and the fine-tuned 4B wholly on an 11 GB card next to a
 * desktop (about 4.8 GiB with its KV cache) and leaves room for the system
 * prompt, every tool, the history and the answer. See docs/providers.md.
 */
export const DEFAULT_OLLAMA_NUM_CTX = 16_384;

/** Below this the system prompt and tools alone do not fit. */
export const MIN_OLLAMA_NUM_CTX = 8_192;

/**
 * Tokens kept free for everything after the system prompt and tool list: the
 * conversation so far, the tool results of the turn's steps, and the answer
 * (a twin answer with its four sections runs 500 to 1,500 tokens).
 */
export const TURN_RESERVE_TOKENS = 4_096;

/**
 * Characters per Qwen3 token for everything but digits, used to estimate a
 * request's size without the tokenizer. Prose and dotted wearable keys measure
 * near 3 and tool JSON near 4.6 (Ollama prompt_eval_count, qwen3:4b); both
 * figures below sit under those, so the estimate errs high.
 */
export const PROSE_CHARS_PER_TOKEN = 2.5;
export const JSON_CHARS_PER_TOKEN = 4;

/** The chat template's own wrapping around the system prompt and tool list. */
export const TEMPLATE_OVERHEAD_TOKENS = 256;

const DIGIT = /\d/g;

/**
 * A conservative token count for text going to a Qwen3-family model: one
 * token per digit (Qwen3 splits numbers into digits, which is what makes
 * wearable keys and dates expensive) and one per `charsPerToken` other
 * characters. Checked against Ollama's own `prompt_eval_count` with
 * `bun run prompt:size --ollama <model>`.
 */
export const estimateTokens = (
  text: string,
  charsPerToken: number = PROSE_CHARS_PER_TOKEN,
): number => {
  const digits = text.match(DIGIT)?.length ?? 0;
  return digits + Math.ceil((text.length - digits) / charsPerToken);
};

/** What the prompt and tools may use at a given context size. */
export const promptBudgetTokens = (numCtx: number): number =>
  numCtx - TURN_RESERVE_TOKENS;

/**
 * Ollama's native API root from `OLLAMA_BASE_URL`, which names the
 * OpenAI-compatible root (`…/v1`) for the catalog and embeddings.
 */
export const ollamaApiRoot = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/api`;
