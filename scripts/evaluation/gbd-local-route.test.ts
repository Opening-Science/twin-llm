import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import {
  gbdProbeRefusal,
  missingEnvByScenario,
  missingEnvNotice,
  REMOTE_GBD_ENV,
  withLocalGbd,
} from "./gbd-local-route";
import { questionSetSchema } from "./question-set";
import { auditTools } from "./score/turn";
import type { AnsweredLine } from "./score/types";

describe("S4 on the local GBD store", () => {
  test("the remote GBD env counts as met only when the store holds results", () => {
    const none = () => false;
    expect(withLocalGbd(none, true)("GBD_MCP_URL")).toBe(true);
    expect(withLocalGbd(none, true)("GBD_MCP_TOKEN")).toBe(true);
    expect(withLocalGbd(none, true)("OTHER")).toBe(false);
    expect(withLocalGbd(none, false)("GBD_MCP_URL")).toBe(false);
    expect(withLocalGbd((name) => name === "GBD_MCP_URL", false)("GBD_MCP_URL")).toBe(
      true,
    );
  });

  test("gbd_estimate in the audit also stands for gbd.gbd_query", () => {
    const line = {
      audit: [
        { tool: "gbd_estimate", refusal: null },
        { tool: "gbd_estimate", refusal: null },
        { tool: "guidelines.guideline_search", refusal: null },
      ],
    } as unknown as AnsweredLine;
    expect(auditTools(line)).toEqual([
      "gbd_estimate",
      "gbd.gbd_query",
      "guidelines.guideline_search",
    ]);
  });
});

const QUESTION_FILES = [
  "evaluation/questions.v1.json",
  "evaluation/questions.v1h.v1.json",
];
const itemsOf = (path: string) =>
  questionSetSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown).items;

describe("S4's env check (#273)", () => {
  for (const path of QUESTION_FILES) {
    test(`${path}: S4 alone requires env, exactly the two GBD MCP names`, () => {
      const items = itemsOf(path);
      const s4 = items.filter((item) => item.scenario === "S4");
      expect(s4.length).toBeGreaterThan(0);
      for (const item of s4) {
        expect<readonly string[] | undefined>(item.context.requires).toEqual(
          REMOTE_GBD_ENV,
        );
      }
      const others = items.filter(
        (item) => item.scenario !== "S4" && (item.context.requires ?? []).length > 0,
      );
      expect(others.map((item) => item.id)).toEqual([]);
    });
  }

  test("with neither route, the notice names exactly GBD_MCP_URL and GBD_MCP_TOKEN", () => {
    const items = itemsOf("evaluation/questions.v1.json");
    const missing = missingEnvByScenario(items, () => false);
    expect([...missing.keys()]).toEqual(["S4"]);
    expect(missing.get("S4")?.names).toEqual(["GBD_MCP_URL", "GBD_MCP_TOKEN"]);
    expect(missing.get("S4")?.items.length).toBe(10);
    expect(missingEnvNotice(items, () => false)).toEqual([
      'S4: 10 items will be skipped as MISSING_ENV; unset: GBD_MCP_URL, GBD_MCP_TOKEN. Set them in .env.eval for the remote GBD MCP server, or import GBD 2023 estimates into the eval database for the local route (docs/evaluation/question-set.md, "Refresh").',
    ]);
  });

  test("a half-set remote names only the missing one; the local store needs none", () => {
    const items = itemsOf("evaluation/questions.v1.json");
    const urlOnly = (name: string) => name === "GBD_MCP_URL";
    expect(missingEnvByScenario(items, urlOnly).get("S4")?.names).toEqual([
      "GBD_MCP_TOKEN",
    ]);
    expect(
      missingEnvNotice(
        items,
        withLocalGbd(() => false, true),
      ),
    ).toEqual([]);
  });

  test("names outside the GBD pair get no GBD advice", () => {
    const item = { id: "Q-X-01", scenario: "SX", context: { requires: ["OTHER_KEY"] } };
    expect(missingEnvNotice([item], () => false)).toEqual([
      "SX: 1 item will be skipped as MISSING_ENV; unset: OTHER_KEY.",
    ]);
  });
});

describe("S4 probe rows on the local store (#273)", () => {
  test("a clean store has no refusal; Germany, 2015 or both name what they hold", () => {
    expect(gbdProbeRefusal({ germany: false, year2015: false })).toBeNull();
    expect(gbdProbeRefusal({ germany: true, year2015: false })).toContain(
      "holds Germany rows,",
    );
    expect(gbdProbeRefusal({ germany: false, year2015: true })).toContain(
      "holds 2015 rows,",
    );
    const both = gbdProbeRefusal({ germany: true, year2015: true }) ?? "";
    expect(both).toContain("holds Germany and 2015 rows,");
    expect(both.includes("\n")).toBe(false);
  });
});
