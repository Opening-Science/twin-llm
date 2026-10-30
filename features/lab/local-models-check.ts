import { z } from "zod";

import { formatBytes } from "@/infrastructure/format-measure";
import { DEFAULT_OLLAMA_BASE_URL, ollamaApiRoot } from "@/infrastructure/ollama-context";

import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * The models Ollama holds, from `GET /api/tags`: name, digest, size and
 * family. The digest is the one Ollama reports for each model's manifest;
 * `ollama list` prints its first 12 characters as the ID, so the two can be
 * compared by eye.
 */

const tagSchema = z.object({
  name: z.string().min(1),
  digest: z.string().optional(),
  size: z.number().nonnegative().optional(),
  details: z
    .object({
      family: z.string().optional(),
      parameter_size: z.string().optional(),
      quantization_level: z.string().optional(),
    })
    .optional(),
});

export type LocalModel = Readonly<{
  name: string;
  digest: string | null;
  sizeBytes: number | null;
  family: string | null;
  parameters: string | null;
  quantization: string | null;
}>;

/** The rows of an `/api/tags` answer, or null when it is not that shape. */
export const parseOllamaModels = (payload: unknown): readonly LocalModel[] | null => {
  const parsed = z.object({ models: z.array(tagSchema) }).safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data.models
    .map((tag) => ({
      name: tag.name,
      digest: tag.digest ?? null,
      sizeBytes: tag.size ?? null,
      family: tag.details?.family ?? null,
      parameters: tag.details?.parameter_size ?? null,
      quantization: tag.details?.quantization_level ?? null,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};

/**
 * Where `/api/tags` is for a configured `OLLAMA_BASE_URL`: scheme, host, port
 * and path only, so a user name, password or query in the setting never
 * reaches the page. Null for a value that is not a URL.
 */
export const ollamaTagsUrl = (baseUrl: string): string | null => {
  try {
    const url = new URL(baseUrl);
    return `${ollamaApiRoot(`${url.origin}${url.pathname}`)}/tags`;
  } catch {
    return null;
  }
};

const DEFAULT_TAGS_URL = ollamaTagsUrl(DEFAULT_OLLAMA_BASE_URL);

/** `ollama list` and the same `/api/tags` read the page makes, for this address. */
export const localModelsHowTo = (tagsUrl: string | null): string => {
  if (tagsUrl === null) return "ollama list";
  const host = new URL(tagsUrl).origin;
  return [
    tagsUrl === DEFAULT_TAGS_URL ? "ollama list" : `OLLAMA_HOST=${host} ollama list`,
    `curl -s ${tagsUrl} | jq -r '.models[] | "\\(.digest)  \\(.name)"'`,
  ].join("\n");
};

/** What the card shows even when the check cannot run. */
export const localModelsBase = (tagsUrl: string | null) =>
  ({
    id: "local-models",
    title: "Local models",
    howTo: localModelsHowTo(tagsUrl),
  }) as const;

export type LocalModelsInput = Readonly<{
  /** False when Ollama is configured at an address that is not this machine. */
  onLoopback: boolean;
  /** From `ollamaTagsUrl(OLLAMA_BASE_URL)`. */
  tagsUrl: string | null;
  /** Null when Ollama did not answer or answered with something else. */
  models: readonly LocalModel[] | null;
}>;

const tableOf = (models: readonly LocalModel[]) => ({
  caption: "Models Ollama lists",
  columns: ["Model", "Digest", "Size", "Family"],
  rows: models.map((model) => [
    model.name,
    shortHash(model.digest),
    formatBytes(model.sizeBytes),
    [model.family, model.parameters, model.quantization]
      .filter((part) => part !== null)
      .join(" · ") || "—",
  ]),
});

export const localModelsCheck = ({
  onLoopback,
  tagsUrl,
  models,
}: LocalModelsInput): LabCheck => {
  const base = localModelsBase(tagsUrl);
  // Where Ollama is decides first: models on another machine never run here,
  // whether or not that machine answered.
  if (!onLoopback) {
    return {
      ...base,
      status: "not-ok",
      summary:
        models === null
          ? "Ollama is configured at an address that is not this machine, and it did not answer just now. Models there would not run here."
          : `Ollama is configured at an address that is not this machine. It lists ${plural(models.length, "model")}, but they do not run here.`,
      evidence: [],
      ...(models === null ? {} : { table: tableOf(models) }),
    };
  }
  if (models === null) {
    return {
      ...base,
      status: "unknown",
      summary:
        "Ollama did not answer just now, so its models could not be listed. Start it with `ollama serve` and reload this page.",
      evidence: [],
    };
  }
  if (models.length === 0) {
    return {
      ...base,
      status: "unknown",
      summary:
        "Ollama on this machine answered but holds no models. Add one with `ollama pull qwen3:8b`.",
      evidence: [],
    };
  }
  return {
    ...base,
    status: "ok",
    summary: `Ollama on this machine holds ${plural(models.length, "model")}. The digest is the start of the one \`ollama list\` shows as ID.`,
    evidence: [],
    table: tableOf(models),
  };
};
