import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  keyPrefix,
  observationLookupValue,
  observationSeriesValue,
  CHECKED_TABLES,
  PERSONAL_COPIES,
  PERSONAL_TABLES,
  pendingRowsSql,
  personalTable,
  sealContextFor,
  plaintextCountSql,
  rowsWithKeySql,
  updateRowSql,
  variantIdsOf,
  variantSiteValue,
} from "./personal-columns";

// A fixed key id, built at run time so no key-shaped literal sits in the source.
const KEY = Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(2, "0")).join(
  "",
);

/** SQL column names per table, read from prisma/schema.prisma (`@map` or the field name). */
const schemaColumns = (): ReadonlyMap<string, ReadonlySet<string>> => {
  const schema = readFileSync(
    join(import.meta.dir, "..", "prisma", "schema.prisma"),
    "utf8",
  );
  const tables = new Map<string, Set<string>>();
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const table = /@@map\("([^"]+)"\)/.exec(block)?.[1];
    if (table === undefined) continue;
    const columns = new Set<string>();
    for (const line of block.split("\n").slice(1)) {
      const field = /^\s{2}(\w+)\s+\S+/.exec(line);
      if (field?.[1] === undefined || line.trim().startsWith("//")) continue;
      columns.add(/@map\("([^"]+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    tables.set(table, columns);
  }
  return tables;
};

describe("personal columns registry (#141)", () => {
  test("every listed table and column exists in the schema", () => {
    const tables = schemaColumns();
    for (const entry of PERSONAL_TABLES) {
      const columns = tables.get(entry.table);
      expect(columns, entry.table).toBeDefined();
      for (const column of [
        entry.idColumn,
        ...entry.sealed,
        ...(entry.lookups?.columns ?? []),
        ...(entry.plainMustBeNull === undefined ? [] : [entry.plainMustBeNull]),
      ]) {
        expect(columns?.has(column), `${entry.table}.${column}`).toBe(true);
      }
    }
  });

  test("the reseal list names every sealed column of the new chat tables", () => {
    const tables = schemaColumns();
    for (const table of ["conversations", "exchanges", "answers"]) {
      const columns = [...(tables.get(table) ?? [])];
      expect(personalTable(table).sealed.slice().sort(), table).toEqual(
        columns.filter((column) => column.endsWith("_sealed")).sort(),
      );
    }
  });

  test("since the switch the old chat tables are the copies, and every listed column exists", () => {
    const tables = schemaColumns();
    expect(PERSONAL_COPIES.map((entry) => entry.table)).toEqual([
      "threads",
      "turns",
      "model_responses",
    ]);
    for (const entry of PERSONAL_COPIES) {
      for (const column of [entry.idColumn, ...entry.sealed]) {
        expect(tables.get(entry.table)?.has(column), `${entry.table}.${column}`).toBe(
          true,
        );
      }
    }
  });

  test("the new chat tables seal under the old names; every other table under its own", () => {
    expect(sealContextFor(personalTable("answers"), "body_sealed")).toEqual({
      table: "model_responses",
      column: "text",
    });
    expect(sealContextFor(personalTable("conversations"), "title_sealed")).toEqual({
      table: "threads",
      column: "title",
    });
    expect(sealContextFor(personalTable("twin_notes"), "title")).toEqual({
      table: "twin_notes",
      column: "title",
    });
  });

  test("checks cover the copies; the reseal list does not", () => {
    expect(CHECKED_TABLES.map((entry) => entry.table)).toEqual([
      ...PERSONAL_TABLES.map((entry) => entry.table),
      "threads",
      "turns",
      "model_responses",
    ]);
    for (const copy of PERSONAL_COPIES) {
      expect(PERSONAL_TABLES.map((entry) => entry.table)).not.toContain(copy.table);
    }
  });

  test("covers the tables of the privacy design", () => {
    expect(PERSONAL_TABLES.map((entry) => entry.table)).toEqual([
      "conversations",
      "exchanges",
      "answers",
      "thread_search_embeddings",
      "oura_snapshots",
      "whoop_snapshots",
      "google_health_snapshots",
      "vitronic_snapshots",
      "vitronic_subjects",
      "genome_reports",
      "personal_datasets",
      "personal_observations",
      "personal_clinical_records",
      "personal_tables",
      "personal_table_chunks",
      "personal_variants",
      "twin_notes",
      "scheduled_tasks",
      "onboarding_profiles",
      "disclosure_events",
      "oura_connections",
      "whoop_connections",
      "google_health_connections",
      "vitronic_connections",
    ]);
    expect(personalTable("vitronic_connections").sealed).toEqual([
      "apiTokenEnc",
      "uploadSecretEnc",
    ]);
    expect(personalTable("oura_connections").owner).toBe(`"userId"`);
    expect(() => personalTable("audit_events")).toThrow();
  });

  test("the plaintext count names columns and counts, never a value", () => {
    const sql = plaintextCountSql(personalTable("genome_reports"));
    expect(sql).toContain(`"rows" NOT LIKE 'tlenc1.%'`);
    expect(sql).toContain(`WHERE "isSynthetic" = false`);
    expect(sql).not.toMatch(/SELECT\s+"rows"/);
    expect(plaintextCountSql(personalTable("thread_search_embeddings"))).toContain(
      `"embedding" IS NOT NULL`,
    );
  });

  test("pending rows: one owner, after an id, not sealed with the active key", () => {
    const sql = pendingRowsSql(personalTable("exchanges"), KEY);
    expect(sql).toContain(`= $1`);
    expect(sql).toContain(`"id" > $2`);
    expect(sql).toContain("LIMIT $3");
    expect(sql).toContain(`"question_sealed" NOT LIKE '${keyPrefix(KEY)}%'`);
    expect(sql).toContain(
      `FROM "conversations" c WHERE c."id" = "exchanges"."conversation_id"`,
    );
  });

  test("a row update sets sealed then lookup columns, casts lists, keys on the id", () => {
    expect(updateRowSql(personalTable("personal_variants"))).toBe(
      `UPDATE "personal_variants" SET "chrom" = $1, "pos" = $2, "variant_id" = $3, "ref" = $4, "alt" = $5, "genotype" = $6, "filter" = $7, "site_index" = $8, "variant_id_index" = $9::text[] WHERE "id" = $10`,
    );
    expect(updateRowSql(personalTable("personal_tables"))).toBe(
      `UPDATE "personal_tables" SET "columns" = $1 WHERE "dataset_id" = $2`,
    );
    expect(rowsWithKeySql(personalTable("conversations"), KEY)).toContain(
      `"title_sealed" LIKE 'tlenc1.${KEY}.%'`,
    );
  });

  test("lookup values: code or name, series, site and each ID of a cell", () => {
    expect(observationLookupValue("http://loinc.org", "4548-4", "HbA1c")).toBe(
      "code|http://loinc.org|4548-4",
    );
    expect(observationLookupValue(null, null, "Ferritin")).toBe("name|Ferritin");
    expect(observationSeriesValue(null, null, "Ferritin", "ng/mL")).toBe(
      '[null,null,"Ferritin","ng/mL"]',
    );
    expect(variantSiteValue("chr1", 123)).toBe(variantSiteValue("chr1", "123"));
    expect(variantIdsOf("rs1;rs2;")).toEqual(["rs1", "rs2"]);
    expect(variantIdsOf(null)).toEqual([]);
  });
});
