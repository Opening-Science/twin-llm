/**
 * The example thread `setup:local` adds to "Your threads": one heart-rate
 * chart question about a synthetic evaluation-cohort subject, answered by a
 * local model. It is built from `fixtures/example-thread.json`, the stored
 * answer of one real local run, so setup needs no model.
 *
 * The fixture may only touch the synthetic warehouse: no wearable keys, no
 * attribution, no tools that read a person's own data. `parseExampleFixture`
 * refuses anything else, and the insert refuses a subject that the warehouse
 * holds as not synthetic.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { viewsOf } from "../../infrastructure/chat-view";
import {
  type StoredToolPart,
  toStoredToolParts,
} from "../../infrastructure/model-response-tool-parts";
import { toResponseDocument } from "../../infrastructure/response-document/parse";
import { sha256Hex, toCanonicalJson } from "../../packages/audit/hash";
import { isAllowedCohort } from "../../packages/query-tools/scope";
import { readExampleThread, type SqlClient } from "./detect";
import { EXAMPLE_TITLE } from "./plan";

export const EXAMPLE_FIXTURE_PATH = join(
  "scripts",
  "setup",
  "fixtures",
  "example-thread.json",
);

/** Warehouse and chart tools that read one subject's rows by subject_ref. */
const ALLOWED_TOOLS: readonly string[] = [
  "show_view",
  "latest_by_loinc",
  "summary_stats",
  "timeseries",
];

const fixtureSchema = z.object({
  title: z.literal(EXAMPLE_TITLE),
  recorded: z.object({ date: z.string(), how: z.string() }),
  cohortId: z.string().min(1),
  subjectRef: z.string().min(1),
  prompt: z.string().min(1),
  response: z.object({
    modelId: z.string().min(1),
    modelName: z.string().min(1),
    text: z.string().min(1),
    reasoningText: z.string().nullable(),
    attribution: z.array(z.unknown()).length(0),
    responseDocument: z.unknown(),
    toolParts: z.unknown(),
    timeToFirstTokenMs: z.number().int().nullable(),
    tokensPerSecond: z.number().nullable(),
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    totalTokens: z.number().int().nullable(),
  }),
});

export type ExampleFixture = Readonly<
  z.infer<typeof fixtureSchema> & {
    response: Readonly<{ toolParts: readonly StoredToolPart[] }>;
  }
>;

/** Every subject_ref a tool part names, in its input or its output rows. */
const subjectsOf = (part: StoredToolPart): readonly string[] => {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    Object.entries(value).forEach(([key, inner]) => {
      if ((key === "subject_ref" || key === "subject") && typeof inner === "string")
        found.add(inner);
      walk(inner);
    });
  };
  walk(part.input);
  walk(part.output);
  return [...found];
};

/**
 * The fixture, or why it cannot be used. It must name one synthetic cohort
 * subject, cite no wearable keys, call only warehouse and chart tools on that
 * subject, carry its tool outputs unchanged (the stored hashes still match)
 * and show at least one chart.
 */
export const parseExampleFixture = (
  value: unknown,
):
  | Readonly<{ ok: true; fixture: ExampleFixture }>
  | Readonly<{ ok: false; why: string }> => {
  const parsed = fixtureSchema.safeParse(value);
  if (!parsed.success)
    return { ok: false, why: "the fixture does not have the expected fields" };
  const data = parsed.data;
  if (!isAllowedCohort(data.cohortId))
    return { ok: false, why: `${data.cohortId} is not a synthetic cohort` };
  const parts = toStoredToolParts(data.response.toolParts);
  if (parts === null || parts.length === 0)
    return { ok: false, why: "the answer has no stored tool parts" };
  const document = toResponseDocument(data.response.responseDocument);
  if (document === null)
    return { ok: false, why: "the response document does not parse" };
  if (document.data_basis.evidence_keys.length > 0)
    return { ok: false, why: "the answer cites wearable keys" };
  const tool = parts.find((part) => !ALLOWED_TOOLS.includes(part.tool));
  if (tool !== undefined) return { ok: false, why: `tool ${tool.tool} is not allowed` };
  const other = parts.flatMap(subjectsOf).find((ref) => ref !== data.subjectRef);
  if (other !== undefined)
    return { ok: false, why: `a tool part names subject ${other}` };
  const changed = parts.find(
    (part) =>
      sha256Hex(toCanonicalJson(part.input)) !== part.argsSha256 ||
      sha256Hex(toCanonicalJson(part.output)) !== part.resultSha256,
  );
  if (changed !== undefined)
    return { ok: false, why: `tool part ${changed.seq} does not match its hashes` };
  const charts = viewsOf(
    parts.map((part) => ({
      type: `tool-${part.tool}`,
      state: "output-available",
      output: part.output,
    })),
  );
  if (charts.length === 0) return { ok: false, why: "the answer shows no chart" };
  return {
    ok: true,
    fixture: { ...data, response: { ...data.response, toolParts: parts } },
  };
};

export const readExampleFixture = async (root: string): Promise<unknown> =>
  JSON.parse(await readFile(join(root, EXAMPLE_FIXTURE_PATH), "utf8")) as unknown;

export type ExampleOutcome =
  | Readonly<{ kind: "inserted"; threadId: string }>
  | Readonly<{ kind: "exists" }>
  | Readonly<{ kind: "refused"; why: string }>;

/**
 * Adds the example thread for `clerkId` in one transaction, creating the
 * local user row when it is missing. Does nothing when the thread exists.
 * `newId` and `now` are passed in so the test can fix them.
 */
export const insertExampleThread = async (
  sql: Pick<SqlClient, "begin">,
  clerkId: string,
  fixture: ExampleFixture,
  newId: () => string = randomUUID,
  now: Date = new Date(),
): Promise<ExampleOutcome> =>
  sql.begin(async (tx) => {
    const [subject] = await tx.unsafe(
      "select is_synthetic from subjects where subject_ref = $1",
      [fixture.subjectRef],
    );
    if (subject !== undefined && subject.is_synthetic !== true)
      return {
        kind: "refused",
        why: `${fixture.subjectRef} is in the warehouse but not marked synthetic`,
      };
    if (await readExampleThread(tx, clerkId)) return { kind: "exists" };
    const at = now.toISOString();
    const [user] = await tx.unsafe(
      'insert into users (id, "clerkId", "createdAt", "updatedAt") values ($1, $2, $3, $3) on conflict ("clerkId") do update set "clerkId" = excluded."clerkId" returning id',
      [newId(), clerkId, at],
    );
    const threadId = newId();
    const turnId = newId();
    const response = fixture.response;
    await tx.unsafe(
      'insert into threads (id, "userId", title, "createdAt", "updatedAt") values ($1, $2, $3, $4, $4)',
      [threadId, String(user?.id), fixture.title, at],
    );
    await tx.unsafe(
      'insert into turns (id, "threadId", prompt, "createdAt") values ($1, $2, $3, $4)',
      [turnId, threadId, fixture.prompt, at],
    );
    await tx.unsafe(
      `insert into model_responses (id, "turnId", "modelId", "modelName", status, text, position,
         "reasoningText", attribution, "responseDocument", "toolParts",
         "timeToFirstTokenMs", "tokensPerSecond", "inputTokens", "outputTokens", "totalTokens",
         "costUsd", "createdAt", "completedAt")
       values ($1, $2, $3, $4, 'COMPLETE', $5, 0, $6, $7::text::jsonb, $8::text::jsonb, $9::text::jsonb,
         $10, $11, $12, $13, $14, 0, $15, $15)`,
      [
        newId(),
        turnId,
        response.modelId,
        response.modelName,
        response.text,
        response.reasoningText,
        JSON.stringify(response.attribution),
        JSON.stringify(response.responseDocument),
        JSON.stringify(response.toolParts),
        response.timeToFirstTokenMs,
        response.tokensPerSecond,
        response.inputTokens,
        response.outputTokens,
        response.totalTokens,
        at,
      ],
    );
    return { kind: "inserted", threadId };
  });
