import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ArkStatusOk,
  ArkStatusUnavailable,
} from "@/features/connectors/ark-status-view";

import { GenomeInventory } from "./genome-inventory";

const ok = (overrides?: Partial<ArkStatusOk>): ArkStatusOk => ({
  enabled: true,
  state: "ok",
  serial: "alpha-002",
  hardware: { model: "Ark I", version: "0.5.0", revision: "4035-1030" },
  firmware: "0.11.6-924f716",
  trust: "attested",
  paired: true,
  unlocked: true,
  slots: [
    {
      slot: "reference-genome",
      name: "Reference genome",
      state: "filled",
      build: "GRCh38",
      version: null,
    },
    {
      slot: "gene-annotations",
      name: "Gene annotations",
      state: "empty",
      build: null,
      version: null,
    },
    {
      slot: "snp-indel-calls",
      name: "SNP and indel calls",
      state: "filled",
      build: null,
      version: null,
    },
    {
      slot: "variant-catalog",
      name: "Variant catalog",
      state: "empty",
      build: null,
      version: "2024.03",
    },
  ],
  pathCount: 3,
  allGenome: true,
  ...overrides,
});

const html = (status: Parameters<typeof GenomeInventory>[0]["status"]) =>
  renderToStaticMarkup(createElement(GenomeInventory, { status }));

describe("GenomeInventory", () => {
  test("renders filled and empty slots with build and catalog version", () => {
    const markup = html(ok());
    expect(markup).toContain("Reference genome");
    expect(markup).toContain("Filled");
    expect(markup).toContain("Build GRCh38");
    expect(markup).toContain("Gene annotations");
    expect(markup).toContain("Empty");
    expect(markup).toContain("SNP and indel calls");
    expect(markup).toContain("Variant catalog");
    expect(markup).toContain("Catalog version 2024.03");
  });

  test("busy shows the state badge only", () => {
    const busy: ArkStatusUnavailable = {
      enabled: true,
      state: "busy",
      error: { code: "device-busy" },
    };
    const markup = html(busy);
    expect(markup).toContain("Busy");
    expect(markup).toContain("Close the Ark Hub tab");
    expect(markup).not.toContain("Filled");
    expect(markup).not.toContain("Empty");
  });

  test("hides when Ark is disabled", () => {
    expect(html({ enabled: false })).toBe("");
  });
});
