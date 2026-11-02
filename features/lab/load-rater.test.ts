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

/** Adds the v1h questions and key and one synthetic v1h run to a fixture. */
const withV1h = async (root: string): Promise<string> => {
  await mkdir(join(root, "evaluation/runs/run-v1h"), { recursive: true });
  await writeFile(
    join(root, "evaluation/questions.v1h.v1.json"),
    JSON.stringify({
      items: [
        { id: "Q-S1-H01", question: "Slope?", expect: { answer_class: "analytics" } },
        {
          id: "Q-S3-H01",
          question: "Address?",
          human: "The URL from the catalogue.",
          expect: { answer_class: "information" },
        },
        {
          id: "Q-S5-H01",
          question: "Dose?",
          expect: { answer_class: "declined_decision_support" },
        },
      ],
    }),
  );
  await writeFile(
    join(root, "evaluation/answer-key.v1h.v1.json"),
    JSON.stringify({
      entries: { "Q-S1-H01": [{ name: "n", value: 3, refusal: null }] },
    }),
  );
  await writeFile(
    join(root, "evaluation/runs/run-v1h/meta.json"),
    JSON.stringify({ question_set: "v1h", mock: false }),
  );
  const line = (item: string) =>
    JSON.stringify({ item_id: item, repeat: 1, error: null, text: `About ${item}.` });
  await writeFile(
    join(root, "evaluation/runs/run-v1h/results.jsonl"),
    ["Q-S1-H01", "Q-S3-H01", "Q-S5-H01"].map(line).join("\n"),
  );
  return root;
};

describe("load-rater", () => {
  test("the order seed names the set's rubric and the rater", () => {
    expect(orderSeedOf("rater-b")).toBe("second-rater.v1:rater-b");
    expect(orderSeedOf("rater-b", "hb")).toBe("second-rater.v1:rater-b");
    expect(orderSeedOf("rater-b", "v1h")).toBe("second-rater.v1h.v1:rater-b");
  });

  test("v1h reads only v1h runs, with its own salt file, rubric and reference kinds", async () => {
    const root = await withV1h(await fixture());
    const hbSalt = await loadRaterSalt("hb", "rater-b", true, root);
    const salt = await loadRaterSalt("v1h", "rater-b", true, root);
    expect(salt).not.toBe(hbSalt);
    const set = parseRaterSet(
      await readFile(join(root, "evaluation/rater-sets/v1h/rater-b.json"), "utf8"),
    );
    expect([set?.rubric, set?.salt]).toEqual(["second-rater.v1h.v1", salt]);
    expect(
      parseRaterSet(
        await readFile(join(root, "evaluation/rater-sets/rater-b.json"), "utf8"),
      )?.rubric,
    ).toBe("second-rater.v1");
    const data = await loadRaterLines("v1h", salt, root);
    if (data.kind !== "ready") throw new Error(data.kind);
    expect(
      data.lines.map((line) => [line.runId, line.itemId, line.referenceKind]),
    ).toEqual([
      ["run-v1h", "Q-S1-H01", "keyed"],
      ["run-v1h", "Q-S3-H01", "unkeyed"],
      ["run-v1h", "Q-S5-H01", "decline"],
    ]);
    const hb = await loadRaterLines("hb", hbSalt, root);
    if (hb.kind !== "ready") throw new Error(hb.kind);
    expect(new Set(hb.lines.map((line) => line.runId))).toEqual(new Set(["run-a"]));
    await saveLineRating(
      "v1h",
      data.lines[0]!,
      "rater-b",
      5,
      "",
      "2026-11-02T10:00:00.000Z",
      root,
    );
    const file = parseRatingFile(
      await readFile(join(root, "evaluation/runs/run-v1h/ratings/rater-b.json"), "utf8"),
    );
    expect([file?.rubric, file?.order_seed]).toEqual([
      "second-rater.v1h.v1",
      "second-rater.v1h.v1:rater-b",
    ]);
    const session = await loadRaterSession("v1h", data.lines, "rater-b", salt, root);
    expect(session.filter((line) => line.level === 5).length).toBe(1);
    expect(JSON.stringify(session)).not.toContain("run-v1h");
  });

  test("reads hb runs, skips mock runs, saves beside the run and resumes", async () => {
    const root = await fixture();
    const salt = await loadRaterSalt("hb", "rater-b", true, root);
    const data = await loadRaterLines("hb", salt, root);
    if (data.kind !== "ready") throw new Error(data.kind);
    expect([data.runs, data.lines.map((line) => `${line.runId}/${line.itemId}`)]).toEqual(
      [1, ["run-a/Q-1", "run-a/Q-2"]],
    );
    const first = data.lines[0]!;
    await saveLineRating(
      "hb",
      first,
      "rater-b",
      5,
      "fine",
      "2026-10-31T10:00:00.000Z",
      root,
    );
    await saveLineRating("hb", first, "rater-b", 4, "", "2026-10-31T10:01:00.000Z", root);
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
    const again = await loadRaterLines(
      "hb",
      await loadRaterSalt("hb", "rater-b", true, root),
      root,
    );
    if (again.kind !== "ready") throw new Error(again.kind);
    expect(again.lines.map((line) => line.token)).toEqual(
      data.lines.map((line) => line.token),
    );
    const session = await loadRaterSession("hb", data.lines, "rater-b", salt, root);
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
    expect(await loadRaterLines("hb", "a".repeat(64), root)).toEqual({ kind: "no-runs" });
  });

  test("a rater set starts with a random salt kept on the server", async () => {
    const root = await fixture();
    const salt = await loadRaterSalt(
      "hb",
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
    expect(await loadRaterSalt("hb", "rater-b", true, root)).toBe(salt);
    const other = await loadRaterSalt("hb", "rater-c", true, root);
    expect(other).not.toBe(salt);
    const [a, b] = await Promise.all([
      loadRaterSalt("hb", "rater-d", true, root),
      loadRaterSalt("hb", "rater-d", true, root),
    ]);
    expect(a).toBe(b);
  });

  test("the same answers get other ids for another rater", async () => {
    const root = await fixture();
    const b = await loadRaterLines(
      "hb",
      await loadRaterSalt("hb", "rater-b", true, root),
      root,
    );
    const c = await loadRaterLines(
      "hb",
      await loadRaterSalt("hb", "rater-c", true, root),
      root,
    );
    if (b.kind !== "ready" || c.kind !== "ready") throw new Error("not ready");
    const tokensOf = (lines: typeof b.lines) => new Set(lines.map((line) => line.token));
    const shared = [...tokensOf(b.lines)].filter((token) => tokensOf(c.lines).has(token));
    expect(shared).toEqual([]);
  });

  test("a view that cannot save writes no salt", async () => {
    const root = await fixture();
    const first = await loadRaterSalt("hb", "rater-b", false, root);
    expect(first).toMatch(SALT_PATTERN);
    expect(await loadRaterSalt("hb", "rater-b", false, root)).not.toBe(first);
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
    await expect(loadRaterSalt("hb", "rater-b", true, root)).rejects.toThrow();
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
    const salt = await loadRaterSalt("hb", "rater-b", true, root);
    const data = await loadRaterLines("hb", salt, root);
    if (data.kind !== "ready") throw new Error(data.kind);
    const session = await loadRaterSession("hb", data.lines, "rater-b", salt, root);
    const q2 = data.lines.find((line) => line.itemId === "Q-2");
    expect(session.find((line) => line.token === q2?.token)?.level).toBe(2);
  });

  test("the browser payload and the export never carry the salt", async () => {
    const root = await fixture();
    const salt = await loadRaterSalt("hb", "rater-b", true, root);
    const data = await loadRaterLines("hb", salt, root);
    if (data.kind !== "ready") throw new Error(data.kind);
    for (const line of data.lines) {
      await saveLineRating(
        "hb",
        line,
        "rater-b",
        5,
        "",
        "2026-10-31T10:00:00.000Z",
        root,
      );
    }
    const session = await loadRaterSession("hb", data.lines, "rater-b", salt, root);
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
