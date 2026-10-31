import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  keyPrefix,
  observationLookupValue,
  observationSeriesValue,
  PERSONAL_TABLES,
  pendingRowsSql,
  personalTable,
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

  test("covers the tables of the privacy design", () => {
    expect(PERSONAL_TABLES.map((entry) => entry.table)).toEqual([
      "threads",
      "turns",
      "model_responses",
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
    const sql = pendingRowsSql(personalTable("turns"), KEY);
    expect(sql).toContain(`= $1`);
    expect(sql).toContain(`"id" > $2`);
    expect(sql).toContain("LIMIT $3");
    expect(sql).toContain(`"prompt" NOT LIKE '${keyPrefix(KEY)}%'`);
    expect(sql).toContain(`FROM "threads" t WHERE t."id" = "turns"."threadId"`);
  });

  test("a row update sets sealed then lookup columns, casts lists, keys on the id", () => {
    expect(updateRowSql(personalTable("personal_variants"))).toBe(
      `UPDATE "personal_variants" SET "chrom" = $1, "pos" = $2, "variant_id" = $3, "ref" = $4, "alt" = $5, "genotype" = $6, "filter" = $7, "site_index" = $8, "variant_id_index" = $9::text[] WHERE "id" = $10`,
    );
    expect(updateRowSql(personalTable("personal_tables"))).toBe(
      `UPDATE "personal_tables" SET "columns" = $1 WHERE "dataset_id" = $2`,
    );
    expect(rowsWithKeySql(personalTable("threads"), KEY)).toContain(
      `"title" LIKE 'tlenc1.${KEY}.%'`,
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
