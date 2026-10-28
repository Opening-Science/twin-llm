import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EVAL_COHORT } from "./cohort-pins";
import { EVAL_COHORT_SUBJECTS } from "./eval-cohort-subjects";
import type { SqlQuery } from "./detect";
import {
  type ExampleFixture,
  insertExampleThread,
  parseExampleFixture,
  readExampleFixture,
} from "./example-thread";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const loadRaw = async (): Promise<Record<string, unknown>> =>
  (await readExampleFixture(ROOT)) as Record<string, unknown>;

const loadFixture = async (): Promise<ExampleFixture> => {
  const parsed = parseExampleFixture(await loadRaw());
  if (!parsed.ok) throw new Error(parsed.why);
  return parsed.fixture;
};

describe("the committed fixture", () => {
  test("is one synthetic eval-cohort question with a chart and its tool cards", async () => {
    const fixture = await loadFixture();
    expect(fixture.title).toBe("Example (synthetic)");
    expect(fixture.cohortId).toBe(EVAL_COHORT.cohortId);
    expect(fixture.subjectRef).toBe("ba419d35-0dfe-8af7-347c-eebf02485a56");
    // One of the pinned 37, so the chart matches what setup:local loads (#214).
    expect(EVAL_COHORT_SUBJECTS).toContain(fixture.subjectRef);
    expect(fixture.response.modelId).toBe("qwen3:4b");
    expect(fixture.response.attribution).toEqual([]);
    expect(fixture.response.toolParts.map((part) => [part.seq, part.tool])).toEqual([
      [1, "show_view"],
      [2, "latest_by_loinc"],
      [3, "summary_stats"],
    ]);
    const chart = fixture.response.toolParts[0]?.output as {
      kind: string;
      spec: { points: readonly unknown[]; unit: string };
    };
    expect(chart.kind).toBe("chart.timeseries");
    expect(chart.spec.unit).toBe("/min");
    expect(chart.spec.points.length).toBe(25);
  });

  test("refuses wearable attribution, cited keys, other subjects and edited outputs", async () => {
    const raw = await loadRaw();
    const response = raw.response as Record<string, unknown>;
    const parts = response.toolParts as Record<string, unknown>[];
    const document = response.responseDocument as Record<string, unknown>;
    const basis = document.data_basis as Record<string, unknown>;
    const withResponse = (patch: Record<string, unknown>) => ({
      ...raw,
      response: { ...response, ...patch },
    });

    expect(
      parseExampleFixture(
        withResponse({ attribution: [{ metricKey: "oura.sleep.score.2026-10-01" }] }),
      ),
    ).toEqual({ ok: false, why: "the fixture does not have the expected fields" });
    expect(
      parseExampleFixture(
        withResponse({
          responseDocument: {
            ...document,
            data_basis: { ...basis, evidence_keys: ["oura.sleep.score"] },
          },
        }),
      ),
    ).toEqual({ ok: false, why: "the answer cites wearable keys" });
    expect(
      parseExampleFixture(
        withResponse({
          toolParts: parts.map((part, index) =>
            index === 1 ? { ...part, tool: "wearables_summary" } : part,
          ),
        }),
      ),
    ).toEqual({ ok: false, why: "tool wearables_summary is not allowed" });
    expect(
      parseExampleFixture(
        withResponse({
          toolParts: parts.map((part, index) =>
            index === 2
              ? { ...part, input: { ...(part.input as object), subject_ref: "other" } }
              : part,
          ),
        }),
      ),
    ).toEqual({ ok: false, why: "a tool part names subject other" });
    expect(
      parseExampleFixture(
        withResponse({
          toolParts: parts.map((part, index) =>
            index === 2
              ? { ...part, output: { ...(part.output as object), mean: 70 } }
              : part,
          ),
        }),
      ),
    ).toEqual({ ok: false, why: "tool part 3 does not match its hashes" });
    expect(parseExampleFixture({ ...raw, cohortId: "self" })).toEqual({
      ok: false,
      why: "self is not a synthetic cohort",
    });
  });
});

type Row = Readonly<Record<string, unknown>>;

/** Just enough of Postgres for the insert: users, threads, turns, responses and one subject. */
const fakeDatabase = (subject: Row | null) => {
  const tables: Record<"users" | "threads" | "turns" | "model_responses", Row[]> = {
    users: [],
    threads: [],
    turns: [],
    model_responses: [],
  };
  const query: SqlQuery = {
    unsafe: async (text, params = []) => {
      if (text.includes("to_regclass")) return [{ present: true }];
      if (text.startsWith("select is_synthetic"))
        return subject === null ? [] : [subject];
      if (text.startsWith("select exists(select 1 from threads")) {
        const users = tables.users.filter((u) => u.clerkId === params[0]);
        const present = tables.threads.some(
          (t) => t.title === params[1] && users.some((u) => u.id === t.userId),
        );
        return [{ present }];
      }
      if (text.startsWith("insert into users")) {
        const found = tables.users.find((u) => u.clerkId === params[1]);
        if (found !== undefined) return [{ id: found.id }];
        tables.users.push({ id: params[0], clerkId: params[1] });
        return [{ id: params[0] }];
      }
      if (text.startsWith("insert into threads")) {
        tables.threads.push({ id: params[0], userId: params[1], title: params[2] });
        return [];
      }
      if (text.startsWith("insert into turns")) {
        tables.turns.push({ id: params[0], threadId: params[1], prompt: params[2] });
        return [];
      }
      if (text.startsWith("insert into model_responses")) {
        tables.model_responses.push({
          turnId: params[1],
          modelId: params[2],
          toolParts: JSON.parse(String(params[8])),
        });
        return [];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return {
    tables,
    sql: { begin: <T>(work: (tx: SqlQuery) => Promise<T>) => work(query) },
  };
};

const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("insertExampleThread", () => {
  test("adds the thread once; a second run leaves everything as it was", async () => {
    const fixture = await loadFixture();
    const db = fakeDatabase({ is_synthetic: true });
    const now = new Date("2026-10-27T12:00:00Z");

    expect(await insertExampleThread(db.sql, "local", fixture, counter(), now)).toEqual({
      kind: "inserted",
      threadId: "id-2",
    });
    expect(await insertExampleThread(db.sql, "local", fixture, counter(), now)).toEqual({
      kind: "exists",
    });
    expect(db.tables.users).toEqual([{ id: "id-1", clerkId: "local" }]);
    expect(db.tables.threads).toEqual([
      { id: "id-2", userId: "id-1", title: "Example (synthetic)" },
    ]);
    expect(db.tables.turns).toEqual([
      { id: "id-3", threadId: "id-2", prompt: fixture.prompt },
    ]);
    expect(db.tables.model_responses).toEqual([
      { turnId: "id-3", modelId: "qwen3:4b", toolParts: fixture.response.toolParts },
    ]);
  });

  test("reuses an existing local user and adds a thread for another one", async () => {
    const fixture = await loadFixture();
    const db = fakeDatabase(null);
    db.tables.users.push({ id: "user-local", clerkId: "local" });

    await insertExampleThread(db.sql, "local", fixture, counter());
    await insertExampleThread(db.sql, "second", fixture, counter());

    expect(db.tables.users).toEqual([
      { id: "user-local", clerkId: "local" },
      { id: "id-1", clerkId: "second" },
    ]);
    expect(db.tables.threads.map((t) => t.userId)).toEqual(["user-local", "id-1"]);
  });

  test("refuses a subject the warehouse holds as not synthetic", async () => {
    const fixture = await loadFixture();
    const db = fakeDatabase({ is_synthetic: false });
    expect(await insertExampleThread(db.sql, "local", fixture, counter())).toEqual({
      kind: "refused",
      why: "ba419d35-0dfe-8af7-347c-eebf02485a56 is in the warehouse but not marked synthetic",
    });
    expect(db.tables.threads).toEqual([]);
  });
});
