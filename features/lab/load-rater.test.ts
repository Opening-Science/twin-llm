import { afterAll, describe, expect, test } from "bun:test";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadRaterLines,
  loadRaterSession,
  loadRatingFiles,
  orderSeedOf,
  saveLineRating,
} from "./load-rater";
import { parseRatingFile } from "./rating-file";

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
    const data = await loadRaterLines(root);
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
    const session = await loadRaterSession(data.lines, "rater-b", root);
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
    expect(await loadRaterLines(root)).toEqual({ kind: "no-runs" });
  });
});
