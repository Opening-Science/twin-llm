import "server-only";

import { z } from "zod";

import { isLoopbackUrl } from "@/infrastructure/loopback";

import { CARBON_X_MODEL } from "./constants";
import type { CarbonXMessage } from "./prompt";

/**
 * Talks to the local Carbon-X sidecar over its OpenAI-compatible contract:
 * `GET <root>/health` and `POST <root>/v1/chat/completions` with model
 * `carbon-x`. `baseUrl` is the `/v1` root. A URL off this machine is refused
 * here as well as at startup, because the messages carry a genotype.
 *
 * The sidecar's own error text never leaves this module; callers get a code.
 */

export type CarbonXConfig = Readonly<{
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}>;

export type CarbonXFailure = Readonly<{
  ok: false;
  code:
    | "CARBON_X_NOT_LOCAL"
    | "CARBON_X_UNREACHABLE"
    | "CARBON_X_FAILED"
    | "CARBON_X_TIMEOUT";
}>;

export type CarbonXAnswer = Readonly<{ ok: true; text: string }> | CarbonXFailure;

const completionSchema = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        message: z.looseObject({ content: z.string().nullable() }),
      }),
    )
    .min(1),
});

/** `http://127.0.0.1:8090/v1` → `http://127.0.0.1:8090`. */
const rootOf = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

const withTimeout = async <T>(
  config: CarbonXConfig,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

export const carbonXHealth = async (config: CarbonXConfig): Promise<boolean> => {
  if (!isLoopbackUrl(config.baseUrl)) return false;
  const doFetch = config.fetch ?? fetch;
  try {
    const response = await withTimeout({ ...config, timeoutMs: 3000 }, (signal) =>
      doFetch(`${rootOf(config.baseUrl)}/health`, { signal }),
    );
    return response.ok;
  } catch {
    return false;
  }
};

export const askCarbonX = async (
  config: CarbonXConfig,
  messages: readonly CarbonXMessage[],
): Promise<CarbonXAnswer> => {
  if (!isLoopbackUrl(config.baseUrl)) return { ok: false, code: "CARBON_X_NOT_LOCAL" };
  const doFetch = config.fetch ?? fetch;
  try {
    const response = await withTimeout(config, (signal) =>
      doFetch(`${rootOf(config.baseUrl)}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: CARBON_X_MODEL,
          messages,
          temperature: 0,
          max_tokens: 512,
          stream: false,
        }),
        signal,
      }),
    );
    if (!response.ok) {
      console.error("[carbon-x] sidecar answered", response.status);
      return { ok: false, code: "CARBON_X_FAILED" };
    }
    const parsed = completionSchema.safeParse(await response.json());
    const text = parsed.success ? parsed.data.choices[0]?.message.content?.trim() : "";
    if (!text) {
      console.error("[carbon-x] sidecar answer had no text");
      return { ok: false, code: "CARBON_X_FAILED" };
    }
    return { ok: true, text };
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.error("[carbon-x] request failed", name);
    return {
      ok: false,
      code: name === "AbortError" ? "CARBON_X_TIMEOUT" : "CARBON_X_UNREACHABLE",
    };
  }
};
