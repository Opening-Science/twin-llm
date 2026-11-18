/**
 * Runs the source-attribution study (P6, #508): every study item under every
 * context condition, for every model and repeat, and scores each answer.
 * Each record keeps the full prompt, the answer and its score, so a run can
 * be rescored and audited without the model.
 *
 * Counterfactual variants run under C1 only (P6 section 5). A failed call is
 * retried up to twice, then recorded as an error, which the report counts as
 * a failure (P6 section 3, stopping rule).
 *
 * Models are injected: `ollamaModel` talks to a local Ollama on this
 * machine only; `fakeModel` answers from the prompt by a fixed policy, for
 * tests and dry runs. Nothing here reads a person's data.
 */
import { createHash } from "node:crypto";

import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_NUM_CTX,
} from "../../../infrastructure/ollama-context";
import type { W1Item } from "../../synthetic-wearables/w1-items";
import { type Condition, CONDITIONS, type StudyPrompt, studyPrompt } from "./contexts";
import { type StudyItem, type Variant } from "./counterfactual";
import { scoreStudyAnswer, type StudyScore } from "./score";

export const STUDY_RUNNER = "twin-llm/attribution-study/1";

export type AnswerModel = Readonly<{
  id: string;
  /** `seed` fixes the model's sampling for this call, so a rerun gives the same answer. */
  answer: (prompt: StudyPrompt, seed: number) => Promise<string>;
}>;

export type StudyRecord = Readonly<{
  runner: string;
  itemId: string;
  baseItemId: string;
  personId: string;
  stratum: W1Item["stratum"];
  rule: W1Item["rule"];
  variant: Variant;
  condition: Condition;
  model: string;
  repeat: number;
  /** The sampling seed sent with the call (`callSeed`). */
  seed: number;
  systemSha256: string;
  prompt: StudyPrompt;
  answer: string | null;
  error: string | null;
  attempts: number;
  score: StudyScore | null;
  expected: W1Item["expected"];
}>;

export type StudyCell = Readonly<{ study: StudyItem; condition: Condition }>;

/** Base items under every condition asked for; variants under C1 only. */
export const studyCells = (
  items: readonly StudyItem[],
  conditions: readonly Condition[] = CONDITIONS,
): readonly StudyCell[] =>
  items.flatMap((study) =>
    study.variant === "base"
      ? conditions.map((condition) => ({ study, condition }))
      : conditions.includes("C1")
        ? [{ study, condition: "C1" as const }]
        : [],
  );

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const baseId = (study: StudyItem): string =>
  study.variant === "base"
    ? study.item.id
    : study.item.id.replace(`-${study.variant}`, "");

export const MAX_RETRIES = 2;

/**
 * The sampling seed of one call: a hash of model, item, condition and
 * repeat, so repeats differ from each other and a rerun of the same cell
 * asks the model for the same draw. Retries keep the cell's seed.
 */
export const callSeed = (
  model: string,
  itemId: string,
  condition: Condition,
  repeat: number,
): number =>
  Number.parseInt(sha256(`${model}|${itemId}|${condition}|${repeat}`).slice(0, 8), 16) &
  0x7fffffff;

/** One record per cell, model and repeat, in that order; `onRecord` sees each as it lands. */
export const runStudy = async (
  input: Readonly<{
    cells: readonly StudyCell[];
    models: readonly AnswerModel[];
    repeats: number;
    onRecord?: (record: StudyRecord) => void | Promise<void>;
  }>,
): Promise<readonly StudyRecord[]> => {
  const records: StudyRecord[] = [];
  for (const model of input.models) {
    for (const { study, condition } of input.cells) {
      const prompt = studyPrompt(study.item, condition, study.order);
      for (let repeat = 1; repeat <= input.repeats; repeat += 1) {
        let answer: string | null = null;
        let error: string | null = null;
        let attempts = 0;
        const seed = callSeed(model.id, study.item.id, condition, repeat);
        while (answer === null && attempts <= MAX_RETRIES) {
          attempts += 1;
          try {
            answer = await model.answer(prompt, seed);
            error = null;
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
          }
        }
        const record: StudyRecord = {
          runner: STUDY_RUNNER,
          itemId: study.item.id,
          baseItemId: baseId(study),
          personId: study.item.personId,
          stratum: study.item.stratum,
          rule: study.item.rule,
          variant: study.variant,
          condition,
          model: model.id,
          repeat,
          seed,
          systemSha256: sha256(prompt.system),
          prompt,
          answer,
          error,
          attempts,
          score: answer === null ? null : scoreStudyAnswer(study.item, answer),
          expected: study.item.expected,
        };
        records.push(record);
        await input.onRecord?.(record);
      }
    }
  }
  return records;
};

/** A model on the local Ollama; the URL must be this machine's. */
export type OllamaOptions = Readonly<{
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Unset keeps the model's default sampling, as the chat does; 0 for the sensitivity pass. */
  temperature?: number;
}>;

export const ollamaModel = (model: string, options: OllamaOptions = {}): AnswerModel => {
  const root = new URL(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(root.hostname)) {
    throw new Error("The study runs on a local Ollama only.");
  }
  const url = new URL("/api/chat", root.origin);
  const fetchImpl = options.fetch ?? fetch;
  const { temperature } = options;
  return {
    id:
      temperature === undefined
        ? `ollama:${model}`
        : `ollama:${model}@temperature=${temperature}`,
    answer: async (prompt, seed) => {
      const response = await fetchImpl(url, {
        method: "POST",
        // A redirect could lead off this machine; Ollama never sends one.
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          // As the chat sends it (`ollama-chat-model.ts`): no thinking pass,
          // the app's context length.
          think: false,
          options: {
            num_ctx: DEFAULT_OLLAMA_NUM_CTX,
            seed,
            ...(temperature === undefined ? {} : { temperature }),
          },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
      const body = (await response.json()) as { message?: { content?: unknown } };
      const content = body.message?.content;
      if (typeof content !== "string") throw new Error("Ollama gave no message");
      return content;
    },
  };
};

/** One listed reading, read back from the prompt's Available keys. */
export type ListedReading = Readonly<{
  key: string;
  shown: string;
  source: string | null;
  day: string | null;
}>;

const LISTED = /^- \[([^\]]+)\][^:]*: ([^(]+?)(?: \(source: ([^;]+); day: ([^)]+)\))?$/;

export const listedReadings = (system: string): readonly ListedReading[] =>
  system.split("\n").flatMap((line) => {
    const match = LISTED.exec(line);
    if (match === null) return [];
    const day = /(\d{4}-\d{2}-\d{2})$/.exec(match[1] ?? "")?.[1] ?? null;
    return [
      {
        key: match[1] ?? "",
        shown: (match[2] ?? "").trim(),
        source: match[3] ?? null,
        day,
      },
    ];
  });

export const FAKE_POLICIES = ["first_listed", "cite_other"] as const;
export type FakePolicy = (typeof FAKE_POLICIES)[number];

const askedDay = (question: string): string | null => {
  const match = /on (\d{1,2} [A-Z][a-z]{2} \d{4})\?/.exec(question);
  if (match === null) return null;
  const date = new Date(`${match[1]} UTC`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const reply = (keys: readonly string[], answer: string): string =>
  [
    "## Reasoning",
    "Read the listed readings for the asked day.",
    "## Evidence Used",
    ...(keys.length === 0 ? ["- none"] : keys.map((key) => `- [${key}]`)),
    "## Answer",
    answer,
    "## Uncertainty",
    "Synthetic test data.",
  ].join("\n");

/**
 * A fake model with a fixed policy, reading only its prompt:
 * - `first_listed`: states the first listed reading for the asked day and
 *   cites it, whatever the rule says;
 * - `cite_other`: states that reading but cites another source's reading
 *   of the same day, where there is one.
 * With no reading for the asked day both say there is none.
 */
export const fakeModel = (policy: FakePolicy): AnswerModel => ({
  id: `fake:${policy}`,
  answer: async (prompt) => {
    const day = askedDay(prompt.user);
    const onDay = listedReadings(prompt.system).filter((reading) => reading.day === day);
    const [first, second] = onDay;
    if (first === undefined) return reply([], "There is no reading for that day.");
    const cited = policy === "cite_other" && second !== undefined ? second : first;
    return reply([cited.key], `It was ${first.shown}.`);
  },
});
