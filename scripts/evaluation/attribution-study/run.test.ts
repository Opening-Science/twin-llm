import { describe, expect, test } from "bun:test";

import { DEFAULT_OLLAMA_NUM_CTX } from "../../../infrastructure/ollama-context";

import { DEV_OPTIONS, generateW1 } from "../../synthetic-wearables/w1-items";

import { studyPrompt } from "./contexts";
import { studyItems } from "./counterfactual";
import {
  type AnswerModel,
  fakeModel,
  listedReadings,
  ollamaModel,
  runStudy,
  studyCells,
} from "./run";

const items = generateW1(DEV_OPTIONS);

describe("studyCells", () => {
  test("base items under every condition, variants under C1 only", () => {
    const cells = studyCells(studyItems(items, true));
    const base = cells.filter((cell) => cell.study.variant === "base");
    expect(base).toHaveLength(items.length * 3);
    const variants = cells.filter((cell) => cell.study.variant !== "base");
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((cell) => cell.condition === "C1")).toBe(true);
    expect(
      studyCells(studyItems(items, true), ["C0"]).every(
        (cell) => cell.study.variant === "base",
      ),
    ).toBe(true);
  });
});

describe("runStudy", () => {
  test("one scored record per cell, model and repeat, with its full prompt", async () => {
    const cells = studyCells(studyItems(items.slice(0, 4), false), ["C1"]);
    const seen: string[] = [];
    const records = await runStudy({
      cells,
      models: [fakeModel("first_listed")],
      repeats: 2,
      onRecord: (record) => {
        seen.push(record.itemId);
      },
    });
    expect(records).toHaveLength(8);
    expect(seen).toHaveLength(8);
    for (const record of records) {
      expect(record.prompt.system).toContain("synthetic test person");
      expect(record.systemSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(record.score).not.toBeNull();
      expect(record.error).toBeNull();
    }
  });

  test("each call carries a seed: the same on a rerun, different between repeats", async () => {
    const cells = studyCells(studyItems(items.slice(0, 2), false), ["C0", "C1"]);
    const seeds: number[][] = [[], []];
    const run = (into: number[]) =>
      runStudy({
        cells,
        models: [
          {
            id: "fake:seeds",
            answer: async (_prompt, seed) => {
              into.push(seed);
              return "## Answer\nnone";
            },
          },
        ],
        repeats: 3,
      });
    const records = await run(seeds[0]!);
    await run(seeds[1]!);
    expect(seeds[1]).toEqual(seeds[0]!);
    expect(new Set(seeds[0]).size).toBe(seeds[0]!.length);
    expect(records.map((record) => record.seed)).toEqual(seeds[0]!);
  });

  test("a failing model is tried three times, then recorded as an error", async () => {
    let calls = 0;
    const failing: AnswerModel = {
      id: "fake:failing",
      answer: () => {
        calls += 1;
        return Promise.reject(new Error("down"));
      },
    };
    const [record] = await runStudy({
      cells: studyCells(studyItems(items.slice(0, 1), false), ["C0"]),
      models: [failing],
      repeats: 1,
    });
    expect(calls).toBe(3);
    expect(record?.error).toBe("down");
    expect(record?.score).toBeNull();
  });

  test("the first-listed fake states the first listed reading and cites it", async () => {
    const single = items.find((item) => item.stratum === "single_source")!;
    const [record] = await runStudy({
      cells: [{ study: { item: single, variant: "base", order: [] }, condition: "C1" }],
      models: [fakeModel("first_listed")],
      repeats: 1,
    });
    expect(record?.score?.attributionCorrect).toBe(true);
  });

  test("the cite-other fake is caught as a wrong source", async () => {
    const agree = items.find((item) => item.stratum === "agree")!;
    const [record] = await runStudy({
      cells: [{ study: { item: agree, variant: "base", order: [] }, condition: "C1" }],
      models: [fakeModel("cite_other")],
      repeats: 1,
    });
    expect(record?.score?.numbers[0]?.verdict).toBe("wrong_source");
  });
});

describe("listedReadings", () => {
  test("reads back every listed reading with its source and day under C1", () => {
    const item = items[0]!;
    const readings = listedReadings(studyPrompt(item, "C1", []).system);
    expect(readings.map((reading) => reading.key).sort()).toEqual(
      item.metrics.map((metric) => metric.key).sort(),
    );
    expect(readings.every((reading) => reading.source !== null)).toBe(true);
  });
});

describe("ollamaModel", () => {
  test("refuses an address that is not this machine", () => {
    expect(() => ollamaModel("qwen3:4b", { baseUrl: "http://10.0.0.5:11434" })).toThrow();
  });

  const recording = () => {
    const bodies: unknown[] = [];
    const fake = ((_url: URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        new Response(JSON.stringify({ message: { content: "## Answer\nok" } })),
      );
    }) as unknown as typeof fetch;
    return { bodies, fake };
  };

  test("posts the prompt as the chat does: no thinking, the app's context", async () => {
    const { bodies, fake } = recording();
    const model = ollamaModel("qwen3:4b", {
      baseUrl: "http://127.0.0.1:11434/v1",
      fetch: fake,
    });
    expect(model.id).toBe("ollama:qwen3:4b");
    expect(await model.answer({ system: "s", user: "u" }, 7)).toBe("## Answer\nok");
    expect(bodies[0]).toEqual({
      model: "qwen3:4b",
      stream: false,
      think: false,
      options: { num_ctx: DEFAULT_OLLAMA_NUM_CTX, seed: 7 },
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
    });
  });

  test("refuses to follow a redirect, which could lead off this machine", async () => {
    const inits: RequestInit[] = [];
    const fake = ((_url: URL, init?: RequestInit) => {
      inits.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify({ message: { content: "## Answer\nok" } })),
      );
    }) as unknown as typeof fetch;
    await ollamaModel("qwen3:4b", { fetch: fake }).answer({ system: "s", user: "u" }, 1);
    expect(inits[0]?.redirect).toBe("error");
  });

  test("a set temperature is sent and named in the model id", async () => {
    const { bodies, fake } = recording();
    const model = ollamaModel("qwen3:4b", { fetch: fake, temperature: 0 });
    expect(model.id).toBe("ollama:qwen3:4b@temperature=0");
    await model.answer({ system: "s", user: "u" }, 7);
    expect(bodies[0]).toMatchObject({
      options: { num_ctx: DEFAULT_OLLAMA_NUM_CTX, temperature: 0 },
    });
  });
});
