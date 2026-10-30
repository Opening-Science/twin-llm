import { describe, expect, test } from "bun:test";

import { AGENTS } from "@/infrastructure/agents";

import {
  isSpecialtyId,
  literatureSource,
  literatureSourcesForAgent,
  SPECIALTY_IDS,
  specialtyForAgent,
  specialtySearchTerm,
} from "./specialties";

describe("specialties", () => {
  test("lists the eight agent specialties", () => {
    expect(SPECIALTY_IDS).toEqual([
      "gp",
      "diet",
      "anatomy",
      "sleep",
      "trainer",
      "genetics",
      "cardiology",
      "neurology",
    ]);
  });

  test("isSpecialtyId accepts known ids only", () => {
    expect(isSpecialtyId("diet")).toBe(true);
    expect(isSpecialtyId("Diet")).toBe(false);
    expect(isSpecialtyId("cardiology")).toBe(true);
    expect(isSpecialtyId("oncology")).toBe(false);
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

  test("specialtyForAgent: the rhythm and brain agents read cardiology and neurology", () => {
    expect(specialtyForAgent("rhythm")).toBe("cardiology");
    expect(specialtyForAgent("brain")).toBe("neurology");
    expect(specialtyForAgent("sleep")).toBe("sleep");
    expect(specialtyForAgent("auto")).toBeNull();
    expect(specialtyForAgent("constructor")).toBeNull();
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
      "literature:cardiology",
      "literature:neurology",
    ]);
    expect(literatureSourcesForAgent("rhythm")).toEqual(["literature:cardiology"]);
    expect(literatureSourcesForAgent("brain")).toEqual(["literature:neurology"]);
    expect(literatureSourcesForAgent("auto")).toEqual([]);
    expect(literatureSourcesForAgent("oncology")).toEqual([]);
    expect(literatureSourcesForAgent(null)).toEqual([]);
    expect(literatureSourcesForAgent(undefined)).toEqual([]);
  });

  test("every agent in the roster has a specialty of its own", () => {
    expect(AGENTS.map(({ id }) => literatureSourcesForAgent(id).length)).toEqual([
      8, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });
});
