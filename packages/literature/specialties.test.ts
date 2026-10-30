import { describe, expect, test } from "bun:test";

import { AGENTS } from "@/infrastructure/agents";

import {
  isSpecialtyId,
  literatureSource,
  literatureSourcesForAgent,
  SPECIALTY_IDS,
  specialtySearchTerm,
} from "./specialties";

describe("specialties", () => {
  test("lists the six agent specialties", () => {
    expect(SPECIALTY_IDS).toEqual([
      "gp",
      "diet",
      "anatomy",
      "sleep",
      "trainer",
      "genetics",
    ]);
  });

  test("isSpecialtyId accepts known ids only", () => {
    expect(isSpecialtyId("diet")).toBe(true);
    expect(isSpecialtyId("Diet")).toBe(false);
    expect(isSpecialtyId("cardiology")).toBe(false);
  });

  test("literatureSource tags the guideline source", () => {
    expect(literatureSource("sleep")).toBe("literature:sleep");
  });

  test("specialtySearchTerm limits to open access", () => {
    expect(specialtySearchTerm("anatomy")).toBe(
      '("anatomy"[mesh]) AND "open access"[filter]',
    );
    expect(specialtySearchTerm("diet", '"fibre"[tiab]')).toBe(
      '("fibre"[tiab]) AND "open access"[filter]',
    );
  });

  test("literatureSourcesForAgent: own specialty, every one for the General agent, none otherwise", () => {
    expect(literatureSourcesForAgent("diet")).toEqual(["literature:diet"]);
    expect(literatureSourcesForAgent("genetics")).toEqual(["literature:genetics"]);
    expect(literatureSourcesForAgent("gp")).toEqual([
      "literature:gp",
      "literature:diet",
      "literature:anatomy",
      "literature:sleep",
      "literature:trainer",
      "literature:genetics",
    ]);
    expect(literatureSourcesForAgent("auto")).toEqual([]);
    expect(literatureSourcesForAgent("cardiology")).toEqual([]);
    expect(literatureSourcesForAgent(null)).toEqual([]);
    expect(literatureSourcesForAgent(undefined)).toEqual([]);
  });

  test("every agent in the roster has a specialty of its own", () => {
    expect(AGENTS.map(({ id }) => literatureSourcesForAgent(id).length)).toEqual([
      6, 1, 1, 1, 1, 1,
    ]);
  });
});
