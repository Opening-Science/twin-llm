import { afterAll, describe, expect, test } from "bun:test";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadRaterLines,
  loadRaterSalt,
  loadRaterSession,
  loadRatingFiles,
  orderSeedOf,
  saveLineRating,
} from "./load-rater";
import { parseRatingFile, ratingsExport, renderRatingFile } from "./rating-file";
import { SALT_PATTERN } from "./rater-lines";
import { parseRaterSet } from "./rater-set";

const scratch = join(tmpdir(), "twin-llm-rater-test-");
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A checkout with the hb questions and key and two synthetic runs, one of them mock. */
const fixture = async (): Promise<string> => {
  const root = await mkdtemp(scratch);
  roots.push(root);
  await mkdir(join(root, "evaluation/runs/run-a"), { recursive: true });
  await mkdir(join(root, "evaluation/runs/run-mock"), { recursive: true });
  await writeFile(
    join(root, "evaluation/questions.hb.v1.json"),
    JSON.stringify({
      items: [
        { id: "Q-1", question: "First?" },
        { id: "Q-2", question: "Second?" },
      ],
    }),
  );
  await writeFile(
    join(root, "evaluation/answer-key.hb.v1.json"),
    JSON.stringify({
      entries: { "Q-1": [{ name: "verdict", value: "raised", refusal: null }] },
    }),
  );
  const line = (item: string, text: string) =>
    JSON.stringify({ item_id: item, repeat: 1, error: null, text });
  await writeFile(
    join(root, "evaluation/runs/run-a/meta.json"),
    JSON.stringify({ question_set: "hb", mock: false }),
  );
  await writeFile(
    join(root, "evaluation/runs/run-a/results.jsonl"),
    `${line("Q-1", "Raised.")}\n${line("Q-2", "No.")}\n`,
  );
  await writeFile(
    join(root, "evaluation/runs/run-mock/meta.json"),
    JSON.stringify({ question_set: "hb", mock: true }),
  );
  await writeFile(
    join(root, "evaluation/runs/run-mock/results.jsonl"),
    `${line("Q-1", "x")}\n`,
  );
  return root;
};

describe("load-rater", () => {
  test("the order seed names the rubric and the rater", () => {
    expect(orderSeedOf("rater-b")).toBe("second-rater.v1:rater-b");
  });

  test("reads hb runs, skips mock runs, saves beside the run and resumes", async () => {
    const root = await fixture();
    const salt = await loadRaterSalt("rater-b", true, root);
    const data = await loadRaterLines(salt, root);
    if (data.kind !== "ready") throw new Error(data.kind);
    expect([data.runs, data.lines.map((line) => `${line.runId}/${line.itemId}`)]).toEqual(
      [1, ["run-a/Q-1", "run-a/Q-2"]],
    );
    const first = data.lines[0]!;
    await saveLineRating(first, "rater-b", 5, "fine", "2026-10-31T10:00:00.000Z", root);
    await saveLineRating(first, "rater-b", 4, "", "2026-10-31T10:01:00.000Z", root);
    const file = parseRatingFile(
      await readFile(join(root, "evaluation/runs/run-a/ratings/rater-b.json"), "utf8"),
    );
    expect(file?.ratings).toEqual([
      {
        item_id: "Q-1",
        repeat: 1,
        level: 4,
        comment: "",
        rated_at: "2026-10-31T10:01:00.000Z",
      },
    ]);
    const again = await loadRaterLines(await loadRaterSalt("rater-b", true, root), root);
    if (again.kind !== "ready") throw new Error(again.kind);
    expect(again.lines.map((line) => line.token)).toEqual(
      data.lines.map((line) => line.token),
    );
    const session = await loadRaterSession(data.lines, "rater-b", salt, root);
    expect(session.find((line) => line.token === first.token)?.level).toBe(4);
    expect(session.filter((line) => line.level === null).length).toBe(1);
    expect(
      (await loadRatingFiles(data.lines, "rater-b", root)).map((each) => each.run_id),
    ).toEqual(["run-a"]);
    expect(await loadRatingFiles(data.lines, "rater-c", root)).toEqual([]);
  });

  test("says when there are no runs", async () => {
    const root = await fixture();
    await rm(join(root, "evaluation/runs/run-a"), { recursive: true });
    expect(await loadRaterLines("a".repeat(64), root)).toEqual({ kind: "no-runs" });
  });

  test("a rater set starts with a random salt kept on the server", async () => {
    const root = await fixture();
    const salt = await loadRaterSalt(
      "rater-b",
      true,
      root,
      () => "2026-10-31T09:00:00.000Z",
    );
    expect(salt).toMatch(SALT_PATTERN);
    const set = parseRaterSet(
      await readFile(join(root, "evaluation/rater-sets/rater-b.json"), "utf8"),
    );
    expect([set?.rater, set?.salt, set?.created]).toEqual([
      "rater-b",
      salt,
      "2026-10-31T09:00:00.000Z",
    ]);
    expect(await loadRaterSalt("rater-b", true, root)).toBe(salt);
    const other = await loadRaterSalt("rater-c", true, root);
    expect(other).not.toBe(salt);
    const [a, b] = await Promise.all([
      loadRaterSalt("rater-d", true, root),
      loadRaterSalt("rater-d", true, root),
    ]);
    expect(a).toBe(b);
  });

  test("the same answers get other ids for another rater", async () => {
    const root = await fixture();
    const b = await loadRaterLines(await loadRaterSalt("rater-b", true, root), root);
    const c = await loadRaterLines(await loadRaterSalt("rater-c", true, root), root);
    if (b.kind !== "ready" || c.kind !== "ready") throw new Error("not ready");
    const tokensOf = (lines: typeof b.lines) => new Set(lines.map((line) => line.token));
    const shared = [...tokensOf(b.lines)].filter((token) => tokensOf(c.lines).has(token));
    expect(shared).toEqual([]);
  });

  test("a view that cannot save writes no salt", async () => {
    const root = await fixture();
    const first = await loadRaterSalt("rater-b", false, root);
    expect(first).toMatch(SALT_PATTERN);
    expect(await loadRaterSalt("rater-b", false, root)).not.toBe(first);
    expect(
      await readFile(join(root, "evaluation/rater-sets/rater-b.json"), "utf8").catch(
        () => null,
      ),
    ).toBeNull();
  });

  test("a set file that does not parse is left alone", async () => {
    const root = await fixture();
    await mkdir(join(root, "evaluation/rater-sets"), { recursive: true });
    await writeFile(join(root, "evaluation/rater-sets/rater-b.json"), "{");
    await expect(loadRaterSalt("rater-b", true, root)).rejects.toThrow();
    expect(await readFile(join(root, "evaluation/rater-sets/rater-b.json"), "utf8")).toBe(
      "{",
    );
  });

  test("ratings saved before salts existed resume under a new salt", async () => {
    const root = await fixture();
    await mkdir(join(root, "evaluation/runs/run-a/ratings"), { recursive: true });
    await writeFile(
      join(root, "evaluation/runs/run-a/ratings/rater-b.json"),
      renderRatingFile({
        schema_version: "twin-llm.eval.ratings.v1",
        rubric: "second-rater.v1",
        run_id: "run-a",
        rater: "rater-b",
        order_seed: "second-rater.v1:rater-b",
        updated: "2026-10-31T08:00:00.000Z",
        ratings: [
          {
            item_id: "Q-2",
            repeat: 1,
            level: 2,
            comment: "",
            rated_at: "2026-10-31T08:00:00.000Z",
          },
        ],
      }),
    );
    const salt = await loadRaterSalt("rater-b", true, root);
    const data = await loadRaterLines(salt, root);
    if (data.kind !== "ready") throw new Error(data.kind);
    const session = await loadRaterSession(data.lines, "rater-b", salt, root);
    const q2 = data.lines.find((line) => line.itemId === "Q-2");
    expect(session.find((line) => line.token === q2?.token)?.level).toBe(2);
  });

  test("the browser payload and the export never carry the salt", async () => {
    const root = await fixture();
    const salt = await loadRaterSalt("rater-b", true, root);
    const data = await loadRaterLines(salt, root);
    if (data.kind !== "ready") throw new Error(data.kind);
    for (const line of data.lines) {
      await saveLineRating(line, "rater-b", 5, "", "2026-10-31T10:00:00.000Z", root);
    }
    const session = await loadRaterSession(data.lines, "rater-b", salt, root);
    expect(session.every((line) => line.level === 5)).toBe(true);
    const payload = JSON.stringify(session);
    expect(payload).not.toContain(salt);
    expect(payload).not.toContain("run-a");
    const exported = JSON.stringify(
      ratingsExport("rater-b", await loadRatingFiles(data.lines, "rater-b", root)),
    );
    expect(exported).not.toContain(salt);
  });
});
