import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { gzipSync, zipSync } from "fflate";

import type {
  DatasetView,
  PersonalDataStore,
} from "@/infrastructure/personal-data-store";
import type { AppendInput } from "@/packages/audit/append";
import type { SavePlan } from "@/packages/personal-data/save-plan";
import { fileSha256 } from "@/packages/personal-data/text-file";
import { parseCatalog } from "@/scripts/genome-synth/catalog";
import { genomeFor } from "@/scripts/genome-synth/generate";

import {
  deleteDatasetResponse,
  type ImportPorts,
  loadYourData,
  patchDatasetResponse,
  postReviewResponse,
  postSaveResponse,
} from "./import-routes";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/personal-import");
const LAB = new Uint8Array(readFileSync(join(FIXTURES, "lab-results.csv")));
const LAB_SHA = fileSha256(LAB);
const TABLE = new Uint8Array(readFileSync(join(FIXTURES, "research-table.tsv")));

/** An in-memory stand-in for the personal_* tables, scoped by user like the real store. */
const fakeStore = () => {
  const rows = new Map<
    string,
    Readonly<{ userId: string; sha256: string; plan: SavePlan }>
  >();
  const view = (id: string, plan: SavePlan): DatasetView => ({
    id,
    kind: plan.dataset.kind,
    name: plan.dataset.name,
    sourceFileName: plan.dataset.sourceFileName,
    rowCount: plan.dataset.rowCount,
    firstAt: plan.dataset.firstAt,
    lastAt: plan.dataset.lastAt,
    createdAt: "2026-10-27T12:00:00.000Z",
  });
  const store: PersonalDataStore = {
    list: async (userId) =>
      [...rows.entries()]
        .filter(([, row]) => row.userId === userId)
        .map(([id, row]) => view(id, row.plan)),
    findBySha: async (userId, sha256) => {
      const found = [...rows.entries()].find(
        ([, row]) => row.userId === userId && row.sha256 === sha256,
      );
      return found === undefined ? null : view(found[0], found[1].plan);
    },
    save: async (plan) => {
      const id = `ds-${rows.size + 1}`;
      rows.set(id, { userId: plan.dataset.userId, sha256: plan.dataset.sha256, plan });
      return { ok: true, dataset: view(id, plan) };
    },
    rename: async (userId, id, name) => {
      const row = rows.get(id);
      if (row === undefined || row.userId !== userId) return null;
      const plan = { ...row.plan, dataset: { ...row.plan.dataset, name } };
      rows.set(id, { ...row, plan });
      return view(id, plan);
    },
    remove: async (userId, id) => {
      const row = rows.get(id);
      if (row === undefined || row.userId !== userId) return null;
      rows.delete(id);
      return row.plan.dataset.rowCount;
    },
  };
  return { store, rows };
};

const setup = (overrides: Partial<ImportPorts> = {}) => {
  const audits: AppendInput[] = [];
  const { store, rows } = fakeStore();
  const ports: Partial<ImportPorts> = {
    resolveActorId: async () => "actor-1",
    permit: () => true,
    ensureUserId: async () => "user-1",
    findUserId: async () => "user-1",
    store,
    audit: async (input) => {
      audits.push(input);
    },
    sessionId: () => "session-1",
    assumeBuild: () => null,
    ...overrides,
  };
  return { ports, audits, rows };
};

const upload = (
  bytes: Uint8Array,
  fields: Readonly<Record<string, string>>,
  fileName = "my-labs.csv",
): Request => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("file", new File([bytes], fileName, { type: "text/csv" }));
  return new Request("http://localhost/api/personal-data", {
    method: "POST",
    body: form,
  });
};

describe("synthetic mode", () => {
  test("review and save are refused and audited; nothing is stored", async () => {
    const { ports, audits, rows } = setup({ permit: () => false });
    const review = await postReviewResponse(upload(LAB, { kind: "lab-csv" }), ports);
    expect(review.status).toBe(403);
    expect(await review.json()).toEqual({
      ok: false,
      error:
        "Importing your own data is off while TwinLLM runs on synthetic data (DATA_MODE=synthetic).",
    });
    const save = await postSaveResponse(
      upload(LAB, { kind: "lab-csv", sha256: LAB_SHA }),
      ports,
    );
    expect(save.status).toBe(403);
    expect(rows.size).toBe(0);
    expect(audits.map((event) => [event.tool, event.result])).toEqual([
      ["personal-data.review", { stored: false, refused: "synthetic-mode" }],
      ["personal-data.save", { stored: false, refused: "synthetic-mode" }],
    ]);
  });

  test("the page reads nothing and says imports are off", async () => {
    const { ports, audits } = setup({ permit: () => false });
    expect(await loadYourData(ports)).toEqual({ state: "synthetic" });
    expect(audits).toEqual([]);
  });

  test("rename and delete are refused too", async () => {
    const { ports } = setup({ permit: () => false });
    const rename = await patchDatasetResponse(
      new Request("http://localhost", { method: "PATCH", body: '{"name":"x"}' }),
      "ds-1",
      ports,
    );
    expect(rename.status).toBe(403);
    expect((await deleteDatasetResponse("ds-1", ports)).status).toBe(403);
  });
});

describe("review, then save", () => {
  test("review answers with the summary and stores nothing", async () => {
    const { ports, audits, rows } = setup();
    const response = await postReviewResponse(upload(LAB, { kind: "lab-csv" }), ports);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      review: { rowsToStore: number; sha256: string; fileName: string };
      duplicateOf: null;
    };
    expect([body.review.rowsToStore, body.review.sha256, body.review.fileName]).toEqual([
      9,
      LAB_SHA,
      "my-labs.csv",
    ]);
    expect(body.duplicateOf).toBeNull();
    expect(rows.size).toBe(0);
    expect(audits).toEqual([
      {
        actor: "actor-1",
        sessionId: "session-1",
        subjectRef: null,
        tool: "personal-data.review",
        args: { kind: "lab-csv", bytes: LAB.byteLength, sha256: LAB_SHA },
        result: { stored: false, rows: 9, unmapped: 4 },
        rowCount: 0,
      },
    ]);
  });

  test("save stores the reviewed file once; the same file again is a duplicate", async () => {
    const { ports, audits, rows } = setup();
    const saved = await postSaveResponse(
      upload(LAB, { kind: "lab-csv", sha256: LAB_SHA, name: "Clinic labs" }),
      ports,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      ok: true,
      dataset: {
        id: "ds-1",
        kind: "lab-csv",
        name: "Clinic labs",
        sourceFileName: "my-labs.csv",
        rowCount: 9,
        firstAt: "2024-02-10T00:00:00.000Z",
        lastAt: "2025-05-20T06:30:00.000Z",
        createdAt: "2026-10-27T12:00:00.000Z",
      },
    });
    expect(rows.get("ds-1")?.plan.observations.length).toBe(9);
    expect(audits.at(-1)).toEqual({
      actor: "actor-1",
      sessionId: "session-1",
      subjectRef: null,
      tool: "personal-data.save",
      args: { kind: "lab-csv", bytes: LAB.byteLength, sha256: LAB_SHA },
      result: { stored: true, dataset_id: "ds-1", rows: 9, unmapped: 4 },
      rowCount: 9,
    });

    const review = await postReviewResponse(upload(LAB, { kind: "lab-csv" }), ports);
    expect(
      ((await review.json()) as { duplicateOf: { id: string } }).duplicateOf.id,
    ).toBe("ds-1");
    const again = await postSaveResponse(
      upload(LAB, { kind: "lab-csv", sha256: LAB_SHA }),
      ports,
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      ok: false,
      error: "You already imported this file.",
    });
    expect(rows.size).toBe(1);
  });

  test("a file that is not the one reviewed is refused before anything is stored", async () => {
    const { ports, audits, rows } = setup();
    const response = await postSaveResponse(
      upload(TABLE, { kind: "table", sha256: LAB_SHA }),
      ports,
    );
    expect(response.status).toBe(409);
    expect(rows.size).toBe(0);
    expect(audits.at(-1)?.result).toEqual({
      stored: false,
      refused: "changed-since-review",
    });
  });

  test("a parse refusal is a 422 with its sentence", async () => {
    const { ports, audits } = setup();
    const bytes = new TextEncoder().encode("date,name\n2024-01-01,x\n");
    const response = await postReviewResponse(upload(bytes, { kind: "lab-csv" }), ports);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error:
        "The header needs the columns date, test, value and unit; missing: test, value, unit.",
    });
    expect(audits.at(-1)?.result).toEqual({ stored: false, refused: "missing-columns" });
  });

  test("no kind or no file is refused with a sentence", async () => {
    const { ports } = setup();
    const form = new FormData();
    form.set("kind", "genome-vcf");
    const response = await postReviewResponse(
      new Request("http://localhost", { method: "POST", body: form }),
      ports,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Choose what kind of file this is.",
    });
  });

  test("an audit that fails after the write undoes the write", async () => {
    const { ports, rows } = setup({
      audit: async (input) => {
        if (input.tool === "personal-data.save") throw new Error("audit down");
      },
    });
    const response = await postSaveResponse(
      upload(LAB, { kind: "lab-csv", sha256: LAB_SHA }),
      ports,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "The import could not be saved. Nothing was stored; try again.",
    });
    expect(rows.size).toBe(0);
  });

  test("nobody signed in: 401, nothing audited", async () => {
    const { ports, audits } = setup({ resolveActorId: async () => null });
    const response = await postReviewResponse(upload(LAB, { kind: "lab-csv" }), ports);
    expect(response.status).toBe(401);
    expect(audits).toEqual([]);
    expect(await loadYourData(ports)).toEqual({ state: "signed-out" });
  });
});

describe("list, rename and delete", () => {
  const saveTable = async (ports: Partial<ImportPorts>) =>
    postSaveResponse(
      upload(
        TABLE,
        { kind: "table", sha256: fileSha256(TABLE), name: "Visits" },
        "visits.tsv",
      ),
      ports,
    );

  test("the page lists datasets and audits the read with counts only", async () => {
    const { ports, audits } = setup();
    await saveTable(ports);
    const state = await loadYourData(ports);
    expect(
      state.state === "ready" ? state.datasets.map((row) => row.name) : null,
    ).toEqual(["Visits"]);
    expect(audits.at(-1)).toEqual({
      actor: "actor-1",
      sessionId: "session-1",
      subjectRef: null,
      tool: "personal-data.list",
      args: {},
      result: { datasets: 1 },
      rowCount: 1,
    });
  });

  test("rename keeps the name out of the audit", async () => {
    const { ports, audits, rows } = setup();
    await saveTable(ports);
    const response = await patchDatasetResponse(
      new Request("http://localhost", {
        method: "PATCH",
        body: '{"name":"  Cohort visits "}',
      }),
      "ds-1",
      ports,
    );
    expect(response.status).toBe(200);
    expect(rows.get("ds-1")?.plan.dataset.name).toBe("Cohort visits");
    expect(audits.at(-1)).toMatchObject({
      tool: "personal-data.rename",
      args: { dataset_id: "ds-1" },
      result: { found: true },
    });
  });

  test("delete removes the dataset and audits how many rows went", async () => {
    const { ports, audits, rows } = setup();
    await saveTable(ports);
    const response = await deleteDatasetResponse("ds-1", ports);
    expect(await response.json()).toEqual({ ok: true, rowsDeleted: 4 });
    expect(rows.size).toBe(0);
    expect(audits.at(-1)).toEqual({
      actor: "actor-1",
      sessionId: "session-1",
      subjectRef: null,
      tool: "personal-data.delete",
      args: { dataset_id: "ds-1" },
      result: { found: true, rows_deleted: 4 },
      rowCount: 4,
    });
    const again = await deleteDatasetResponse("ds-1", ports);
    expect(again.status).toBe(404);
    expect(audits.at(-1)?.result).toEqual({ found: false, rows_deleted: 0 });
  });

  test("another person's dataset cannot be renamed or deleted", async () => {
    const owner = setup();
    await saveTable(owner.ports);
    const other = { ...owner.ports, findUserId: async () => "user-2" };
    expect((await deleteDatasetResponse("ds-1", other)).status).toBe(404);
    expect(owner.rows.size).toBe(1);
  });
});

describe("audit rows carry no values", () => {
  test("no value, unit, code, name or file name reaches any audit row", async () => {
    const { ports, audits } = setup();
    await postReviewResponse(upload(LAB, { kind: "lab-csv" }), ports);
    await postSaveResponse(
      upload(LAB, { kind: "lab-csv", sha256: LAB_SHA, name: "Clinic labs" }),
      ports,
    );
    await patchDatasetResponse(
      new Request("http://localhost", {
        method: "PATCH",
        body: '{"name":"Renamed labs"}',
      }),
      "ds-1",
      ports,
    );
    await loadYourData(ports);
    await deleteDatasetResponse("ds-1", ports);

    expect(audits.map((event) => event.tool)).toEqual([
      "personal-data.review",
      "personal-data.save",
      "personal-data.rename",
      "personal-data.list",
      "personal-data.delete",
    ]);
    const written = JSON.stringify(audits);
    for (const value of [
      "5.4",
      "4.7",
      "1.25",
      "HbA1c",
      "cholesterol",
      "Ferritin",
      "mg/dL",
      "mmol/L",
      "4548-4",
      "2093-3",
      "made-up",
      "my-labs",
      "Clinic labs",
      "Renamed labs",
      "2024-02-10",
    ]) {
      expect({ value, found: written.includes(value) }).toEqual({ value, found: false });
    }
    const keys = new Set(
      audits.flatMap((event) => [
        ...Object.keys(event.args as object),
        ...Object.keys(event.result as object),
      ]),
    );
    expect([...keys].sort()).toEqual([
      "bytes",
      "dataset_id",
      "datasets",
      "found",
      "kind",
      "rows",
      "rows_deleted",
      "sha256",
      "stored",
      "unmapped",
    ]);
  });
});

describe("Apple Health and wearable exports", () => {
  const APPLE = new Uint8Array(readFileSync(join(FIXTURES, "apple-health-export.xml")));
  const APPLE_ZIP = zipSync({ "apple_health_export/export.xml": APPLE });
  const APPLE_ZIP_SHA = fileSha256(APPLE_ZIP);
  const WHOOP = new Uint8Array(
    readFileSync(join(FIXTURES, "wearables/my_whoop_data/sleeps.csv")),
  );

  test("an export zip is reviewed and saved like any import, audited by counts", async () => {
    const { ports, audits, rows } = setup();
    const review = await postReviewResponse(
      upload(APPLE_ZIP, { kind: "apple-health" }, "export.zip"),
      ports,
    );
    expect(review.status).toBe(200);
    const body = (await review.json()) as {
      review: { rowsToStore: number; counts: { unmapped: number } };
    };
    expect([body.review.rowsToStore, body.review.counts.unmapped]).toEqual([10, 11]);
    const saved = await postSaveResponse(
      upload(APPLE_ZIP, { kind: "apple-health", sha256: APPLE_ZIP_SHA }, "export.zip"),
      ports,
    );
    expect(saved.status).toBe(200);
    expect(rows.get("ds-1")?.plan.dataset.kind).toBe("apple-health");
    expect(audits.map((event) => [event.tool, event.result])).toEqual([
      ["personal-data.review", { stored: false, rows: 10, unmapped: 11 }],
      [
        "personal-data.save",
        { stored: true, dataset_id: "ds-1", rows: 10, unmapped: 11 },
      ],
    ]);
    const written = JSON.stringify(audits);
    for (const value of ["8867-4", "HKQuantityType", "Demo Watch", "export.zip", "445"]) {
      expect({ value, found: written.includes(value) }).toEqual({ value, found: false });
    }
  });

  test("a wearable file is read by its own name", async () => {
    const { ports } = setup();
    const review = await postReviewResponse(
      upload(WHOOP, { kind: "wearable" }, "sleeps.csv"),
      ports,
    );
    const body = (await review.json()) as {
      review: { kind: string; rowsToStore: number; notes: readonly string[] };
    };
    expect([body.review.kind, body.review.rowsToStore, body.review.notes[0]]).toEqual([
      "wearable",
      2,
      "Read sleeps.csv as Whoop sleeps.",
    ]);
  });
});

describe("genome VCF (synthetic, from genome-synth)", () => {
  const catalog = parseCatalog(
    readFileSync(
      join(import.meta.dir, "../../scripts/genome-synth/variants.tsv"),
      "utf8",
    ),
  );
  if (typeof catalog === "string") throw new Error(catalog);
  const SYNTH = genomeFor("080b069b-5108-46b6-ecef-6aacd3b9ef3f", catalog);
  const VCF_GZ = gzipSync(new TextEncoder().encode(SYNTH.vcf));
  const VCF_GZ_SHA = fileSha256(VCF_GZ);
  const SITES = SYNTH.calls.length;

  test("reviewed and saved like any import; the audit holds counts, no hash", async () => {
    const { ports, audits, rows } = setup();
    const review = await postReviewResponse(
      upload(VCF_GZ, { kind: "vcf" }, "synthetic.vcf.gz"),
      ports,
    );
    expect(review.status).toBe(200);
    const body = (await review.json()) as {
      review: { rowsToStore: number; sha256: string; genome: { build: string } };
    };
    expect([
      body.review.rowsToStore,
      body.review.sha256,
      body.review.genome.build,
    ]).toEqual([SITES, VCF_GZ_SHA, "GRCh38"]);
    const saved = await postSaveResponse(
      upload(VCF_GZ, { kind: "vcf", sha256: VCF_GZ_SHA }, "synthetic.vcf.gz"),
      ports,
    );
    expect(saved.status).toBe(200);
    const plan = rows.get("ds-1")?.plan;
    expect([
      plan?.dataset.kind,
      plan?.dataset.genomeBuild,
      plan?.variants.length,
    ]).toEqual(["vcf", "GRCh38", SITES]);
    expect(audits).toEqual([
      {
        actor: "actor-1",
        sessionId: "session-1",
        subjectRef: null,
        tool: "personal-data.review",
        args: { kind: "vcf", bytes: VCF_GZ.byteLength, sha256: null },
        result: { stored: false, rows: SITES, unmapped: 0 },
        rowCount: 0,
      },
      {
        actor: "actor-1",
        sessionId: "session-1",
        subjectRef: null,
        tool: "personal-data.save",
        args: { kind: "vcf", bytes: VCF_GZ.byteLength, sha256: null },
        result: { stored: true, dataset_id: "ds-1", rows: SITES, unmapped: 0 },
        rowCount: SITES,
      },
    ]);
    const written = JSON.stringify(audits);
    const first = SYNTH.calls[0]!;
    for (const value of [
      VCF_GZ_SHA,
      "0/1",
      "1/1",
      first.variant.rsid,
      String(first.variant.pos),
      "chr",
      "synthetic.vcf.gz",
    ]) {
      expect({ value, found: written.includes(value) }).toEqual({ value, found: false });
    }
  });

  test("a GRCh37 VCF is refused with the genome track's code, audited without a hash", async () => {
    const { ports, audits } = setup();
    const grch37 = new TextEncoder().encode(
      SYNTH.vcf.replace("##reference=GRCh38", "##reference=GRCh37"),
    );
    const review = await postReviewResponse(
      upload(grch37, { kind: "vcf" }, "x.vcf"),
      ports,
    );
    expect(review.status).toBe(422);
    expect(await review.json()).toEqual({
      ok: false,
      error:
        "This VCF is on GRCh37 (hg19). Only GRCh38 files are imported, because GRCh37 positions point at different bases.",
    });
    expect(audits.at(-1)?.args).toEqual({
      kind: "vcf",
      bytes: grch37.byteLength,
      sha256: null,
    });
    expect(audits.at(-1)?.result).toEqual({ stored: false, refused: "BUILD_MISMATCH" });
  });

  test("GENOME_ASSUME_BUILD lets a VCF that names no build through", async () => {
    const unnamed = new TextEncoder().encode(
      SYNTH.vcf.replace("##reference=GRCh38\n", "").replaceAll(",assembly=GRCh38", ""),
    );
    const refused = await postReviewResponse(
      upload(unnamed, { kind: "vcf" }, "x.vcf"),
      setup().ports,
    );
    expect(refused.status).toBe(422);
    const assumed = await postReviewResponse(
      upload(unnamed, { kind: "vcf" }, "x.vcf"),
      setup({ assumeBuild: () => "GRCh38" }).ports,
    );
    expect(assumed.status).toBe(200);
  });
});
