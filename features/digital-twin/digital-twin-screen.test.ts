import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ArkStatusOk,
  ArkStatusUnavailable,
} from "@/features/connectors/ark-status-view";
import type { BodyTwinPreview } from "./bodyloop-avatar";

import { BODY_TWIN_LOADING, BODYLOOP_NO_SCANS } from "./bodyloop-avatar";
import { DigitalTwinScreen } from "./digital-twin-screen";
import { type TwinContext } from "./page-sections";
import {
  BODY_TWIN,
  BODY_TWIN_NOTE,
  GENOME_EMPTY,
  GENOME_TWIN,
  SOURCES_TITLE,
} from "./twin-page-copy";

/** The line that used to stand above a Demo-only picker (removed in D6). */
const NO_SUBJECTS_LINE = "No BodyLoop subjects";

const ok: ArkStatusOk = {
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
  ],
  pathCount: 3,
  allGenome: true,
};

const bodyEmpty: BodyTwinPreview = { subjects: [] };

const bodyNoScans: BodyTwinPreview = {
  subjects: [{ id: "sub-self", label: "Self", isSelf: true }],
  scans: [],
  snapshots: [],
  selectedSubjectId: "sub-self",
};

const bodyFilled: BodyTwinPreview = {
  subjects: [{ id: "sub-self", label: "Self", isSelf: true }],
  scans: [{ viatarId: 1, crtime: "2026-07-10T12:00:00.000Z" }],
  snapshots: [
    {
      id: "snap-1",
      viatarId: 1,
      hasAvatar: true,
      properties: [
        { path: "body.height", value: 1.7, unit: "m" },
        { path: "body.surface", value: 1.85, unit: "m2" },
        { path: "body.volume", value: 0.065, unit: "m3" },
        { path: "body.mass", value: 68, unit: "kg" },
        { path: "body.bmi", value: 21, unit: "kg/m2" },
      ],
    },
  ],
  selectedSubjectId: "sub-self",
  selectedViatarId: 1,
};

const html = (
  preview?: Parameters<typeof DigitalTwinScreen>[0]["preview"],
  bodyPreview?: BodyTwinPreview,
  contextPreview?: TwinContext,
) =>
  renderToStaticMarkup(
    createElement(DigitalTwinScreen, { preview, bodyPreview, contextPreview }),
  );

const demoContext: TwinContext = {
  subject: "demo",
  scans: 0,
  biomarkerValues: 0,
  biomarkersStatus: "ok",
  liveVitals: false,
};

/** One row of the body panel's Properties list. */
const property = (label: string, value: string) =>
  `<span class="min-w-0 truncate font-mono">${label}</span>` +
  `<span class="shrink-0 tabular-nums">${value}</span>`;

describe("DigitalTwinScreen", () => {
  test("first paint shows the genome empty state and a neutral body loading line", () => {
    const markup = html();
    expect(markup).toContain(GENOME_TWIN);
    expect(markup).toContain(BODY_TWIN);
    expect(markup).toContain(GENOME_EMPTY);
    expect(markup).toContain(BODY_TWIN_LOADING);
    expect(markup).not.toContain(NO_SUBJECTS_LINE);
  });

  test("two sections render independent empty states", () => {
    const markup = html({ enabled: false }, bodyEmpty);
    expect(markup).toContain(GENOME_TWIN);
    expect(markup).toContain(BODY_TWIN);
    expect(markup).toContain(GENOME_EMPTY);
    expect(markup).not.toContain(NO_SUBJECTS_LINE);
    expect(markup).not.toContain("Inventory");
    expect(markup).not.toContain("rsid-genotypes");
    expect(markup).not.toContain("body.height");
  });

  test("genome filled does not hide a body empty state", () => {
    const markup = html(ok, bodyEmpty);
    expect(markup).toContain("Inventory");
    expect(markup).toContain("Reference genome");
    expect(markup).toContain(BODY_TWIN);
    expect(markup).not.toContain(NO_SUBJECTS_LINE);
    expect(markup).not.toContain("Coming soon");
  });

  test("no scans empty state is independent of genome", () => {
    const markup = html({ enabled: false }, bodyNoScans);
    expect(markup).toContain(BODYLOOP_NO_SCANS);
    expect(markup).toContain(GENOME_EMPTY);
  });

  test("body filled does not hide a genome empty state", () => {
    const markup = html({ enabled: false }, bodyFilled);
    expect(markup).toContain(GENOME_EMPTY);
    expect(markup).toContain("2026-07-10 · scan 1");
    expect(markup).toContain(property("body.height", "1.70 m"));
    expect(markup).toContain(property("body.surface", "1.85 m2"));
    expect(markup).toContain(property("body.volume", "0.07 m3"));
    expect(markup).toContain(property("body.mass", "68.0 kg"));
    expect(markup).toContain(property("body.bmi", "21.0 kg/m2"));
    // Server render has no WebGL, so the mesh slot shows its fallback, not the toolbar.
    expect(markup).toContain("Scan mesh needs WebGL.");
    expect(markup).not.toContain("Reset view");
    expect(markup).not.toContain("Inventory");
  });

  test("both sections can be filled at once", () => {
    const markup = html(ok, bodyFilled);
    expect(markup).toContain("Inventory");
    expect(markup).toContain(property("body.height", "1.70 m"));
    expect(markup).not.toContain(GENOME_EMPTY);
    expect(markup).not.toContain(NO_SUBJECTS_LINE);
  });

  test("enabled status shows the genome dashboard", () => {
    const markup = html(ok, bodyEmpty);
    expect(markup).toContain("Inventory");
    expect(markup).toContain("Filled");
    expect(markup).toContain("Empty");
    expect(markup).toContain("Build GRCh38");
    expect(markup).toContain("Audit trail");
  });

  test("busy still shows the dashboard with a state badge", () => {
    const busy: ArkStatusUnavailable = {
      enabled: true,
      state: "busy",
      error: { code: "device-busy" },
    };
    const markup = html(busy, bodyEmpty);
    expect(markup).toContain("Busy");
    expect(markup).toContain("Inventory");
  });

  test("the body twin comes first, then Sources, then the genome twin", () => {
    const markup = html({ enabled: false }, bodyEmpty, demoContext);
    const body = markup.indexOf(`>${BODY_TWIN}</h2>`);
    const sources = markup.indexOf(`>${SOURCES_TITLE}</h2>`);
    const genome = markup.indexOf(`>${GENOME_TWIN}</h2>`);
    expect(body).toBeGreaterThan(-1);
    expect(sources).toBeGreaterThan(body);
    expect(genome).toBeGreaterThan(sources);
    expect(markup).toContain(BODY_TWIN_NOTE);
    expect(BODY_TWIN_NOTE).toBe(
      "A 3D body with reference anatomy and biomarkers. Not a statement about a person.",
    );
  });

  test("Sources says what is missing in one sentence each, never a blank box", () => {
    const markup = html({ enabled: false }, bodyEmpty, demoContext);
    expect(markup).toContain('<dt class="text-muted-foreground">Body</dt>');
    expect(markup).toContain("<dd>Synthetic ANNY body, not a person.</dd>");
    expect(markup).toContain("<dd>No biomarker values for this subject.</dd>");
    expect(markup).toContain("<dd>No vitals for this subject.</dd>");
  });

  test("no Sources section before the viewer reports its subject", () => {
    expect(html({ enabled: false }, bodyEmpty)).not.toContain(`>${SOURCES_TITLE}</h2>`);
  });

  test("no placeholder card or developer command on the page", () => {
    const markup = html(ok, bodyEmpty, demoContext);
    expect(markup).not.toContain("rsid-genotypes");
    expect(markup).not.toContain("Run on the Ark");
    expect(markup).not.toContain("bun run");
  });
});
