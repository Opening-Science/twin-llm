import { describe, expect, test } from "bun:test";

import { openNumber, plainCipher, sealedCipher } from "./field-cipher";
import { sealedTextKeyId } from "./field-crypto";
import {
  observationLookupValue,
  personalTable,
  type PersonalTable,
  variantSiteValue,
} from "./personal-columns";
import {
  formatPlaintextFindings,
  plaintextFindings,
  ResealCheckError,
  type ResealPorts,
  resealRow,
  resealTable,
  rowsWithKey,
  type SqlRow,
  textArrayLiteral,
} from "./reseal";

const OLD = { keyId: "1111111111111111", dataKey: Buffer.alloc(32, 1) };
const NEW = { keyId: "2222222222222222", dataKey: Buffer.alloc(32, 2) };
const OWNER = "user-synthetic-1";

/** Made-up observation rows as an existing plain install holds them. */
const plainObservations = (count: number): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `obs-${String(index).padStart(3, "0")}`,
    owner: OWNER,
    code_system: "http://loinc.org",
    code: "2345-7",
    display: "Glucose (synthetic)",
    value: String(90 + index),
    unit: "mg/dL",
    source_ref: `row ${index + 2}`,
    note: null,
    lookup_index: null,
    series_index: null,
  }));

/**
 * An in-memory table that answers the reseal walk's three statements the way
 * Postgres would for one owner: pending rows after an id, row updates, and
 * transactions that roll back when the work throws.
 */
const memoryTable = (entry: PersonalTable, rows: Record<string, unknown>[]) => {
  const columns = [...entry.sealed, ...(entry.lookups?.columns ?? [])];
  let failAfterUpdates = Number.POSITIVE_INFINITY;
  let updates = 0;
  const activeOf = (sql: string): string | null =>
    /tlenc1\.([0-9a-f]{16})\./.exec(sql)?.[1] ?? null;
  const run =
    (target: Record<string, unknown>[]) =>
    async (sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]> => {
      // Every other personal table is empty here.
      if (!sql.includes(`FROM "${entry.table}"`) && !sql.startsWith("UPDATE")) {
        return sql.startsWith("SELECT count(*)::int AS n") ? [{ n: 0 }] : [];
      }
      if (sql.startsWith("SELECT count(*)::int AS n")) {
        const key = activeOf(sql);
        return [
          {
            n: target.filter((row) =>
              entry.sealed.some((column) => {
                const value = row[column];
                return typeof value === "string" && sealedTextKeyId(value) === key;
              }),
            ).length,
          },
        ];
      }
      if (sql.startsWith("SELECT count(*)")) {
        return [
          Object.fromEntries(
            entry.sealed.map((column) => [
              column,
              target.filter(
                (row) =>
                  typeof row[column] === "string" &&
                  !String(row[column]).startsWith("tlenc1."),
              ).length,
            ]),
          ),
        ];
      }
      if (sql.startsWith("SELECT")) {
        const active = activeOf(sql);
        const [owner, after, limit] = params;
        return target
          .filter((row) => row.owner === owner && String(row.id) > String(after))
          .filter((row) =>
            entry.sealed.some((column) => {
              const value = row[column];
              return typeof value === "string" && sealedTextKeyId(value) !== active;
            }),
          )
          .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
          .slice(0, Number(limit))
          .map((row) => ({ ...row }));
      }
      if (sql.startsWith("UPDATE")) {
        updates += 1;
        if (updates > failAfterUpdates) throw new Error("synthetic stop");
        const row = target.find((each) => each.id === params[columns.length]);
        if (row === undefined) throw new Error("no such row");
        columns.forEach((column, index) => {
          row[column] = params[index];
        });
        return [];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    };
  const ports: ResealPorts = {
    query: run(rows),
    transaction: async (work) => {
      const copy = rows.map((row) => ({ ...row }));
      try {
        const result = await work(run(copy));
        rows.splice(0, rows.length, ...copy);
        return result;
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
  return {
    rows,
    ports,
    stopAfter: (count: number) => {
      updates = 0;
      failAfterUpdates = count;
    },
  };
};

const OBSERVATIONS = personalTable("personal_observations");

describe("resealing one row (#141)", () => {
  test("a plain row is sealed, checked, and its lookup hashes computed", () => {
    const cipher = sealedCipher(OLD);
    const [row] = plainObservations(1);
    const params = resealRow(cipher, OBSERVATIONS, row ?? {});
    expect(params.at(-1)).toBe("obs-000");
    const display = String(params[2]);
    expect(display.startsWith(`tlenc1.${OLD.keyId}.`)).toBe(true);
    expect(cipher.openText("personal_observations", "display", "obs-000", display)).toBe(
      "Glucose (synthetic)",
    );
    expect(
      openNumber(cipher, "personal_observations", "value", "obs-000", String(params[3])),
    ).toBe(90);
    expect(params[6]).toBeNull();
    expect(params[7]).toBe(
      cipher.index(
        "personal_observations",
        "lookup",
        observationLookupValue("http://loinc.org", "2345-7", "Glucose (synthetic)"),
      ),
    );
  });

  test("a value under the active key is kept as it is", () => {
    const cipher = sealedCipher(OLD);
    const first = resealRow(cipher, OBSERVATIONS, plainObservations(1)[0] ?? {});
    const sealedRow = Object.fromEntries(
      [...OBSERVATIONS.sealed, "id"].map((column, index) => [
        column,
        column === "id" ? "obs-000" : first[index],
      ]),
    );
    expect(resealRow(cipher, OBSERVATIONS, sealedRow).slice(0, 7)).toEqual(
      first.slice(0, 7),
    );
  });

  test("a variant row gets a site hash and a text[] of ID hashes", () => {
    const cipher = sealedCipher(OLD);
    const params = resealRow(cipher, personalTable("personal_variants"), {
      id: "var-1",
      chrom: "chr1",
      pos: "12345",
      variant_id: "rs1;rs2",
      ref: "A",
      alt: "G",
      genotype: "0/1",
      filter: null,
    });
    expect(params[7]).toBe(
      cipher.index("personal_variants", "site", variantSiteValue("chr1", 12345)),
    );
    expect(params[8]).toBe(
      textArrayLiteral([
        cipher.index("personal_variants", "variant_id", "rs1"),
        cipher.index("personal_variants", "variant_id", "rs2"),
      ]),
    );
  });

  test("a value that does not open stops the walk; the plain cipher cannot reseal", () => {
    const cipher = sealedCipher(OLD);
    const params = resealRow(cipher, OBSERVATIONS, plainObservations(1)[0] ?? {});
    const moved = Object.fromEntries(
      [...OBSERVATIONS.sealed, "id"].map((column, index) => [
        column,
        column === "id" ? "obs-999" : params[index],
      ]),
    );
    expect(() => resealRow(sealedCipher(NEW, [OLD]), OBSERVATIONS, moved)).toThrow();
    expect(() => resealRow(plainCipher, OBSERVATIONS, moved)).toThrow();
    expect(new ResealCheckError("t", "c").message).not.toContain("Glucose");
  });
});

describe("resealing a table: migration, resumption and rotation (#141)", () => {
  test("migrates in batches, resumes after a stop, and a second run changes nothing", async () => {
    const table = memoryTable(OBSERVATIONS, plainObservations(7));
    const cipher = sealedCipher(OLD);
    table.stopAfter(5);
    await expect(
      resealTable(table.ports, cipher, OBSERVATIONS, OWNER, 3),
    ).rejects.toThrow("synthetic stop");
    // The first batch of 3 committed; the second rolled back as a whole.
    expect(
      table.rows.filter((row) => String(row.display).startsWith("tlenc1.")).length,
    ).toBe(3);
    table.stopAfter(Number.POSITIVE_INFINITY);
    expect(await resealTable(table.ports, cipher, OBSERVATIONS, OWNER, 3)).toBe(4);
    expect(await resealTable(table.ports, cipher, OBSERVATIONS, OWNER, 3)).toBe(0);
    expect(JSON.stringify(table.rows)).not.toContain("Glucose");
    expect(await plaintextFindings(table.ports.query)).toEqual([]);
  });

  test("rotation reseals under the new key, rows of other owners untouched", async () => {
    const rows = [
      ...plainObservations(4),
      { ...plainObservations(1)[0], id: "obs-other", owner: "user-synthetic-2" },
    ];
    const table = memoryTable(OBSERVATIONS, rows);
    await resealTable(table.ports, sealedCipher(OLD), OBSERVATIONS, OWNER, 2);
    expect(await rowsWithKey(table.ports.query, OWNER, OLD.keyId)).toBe(4);
    const rotating = sealedCipher(NEW, [OLD]);
    expect(await resealTable(table.ports, rotating, OBSERVATIONS, OWNER, 2)).toBe(4);
    expect(await rowsWithKey(table.ports.query, OWNER, OLD.keyId)).toBe(0);
    const row = table.rows.find((each) => each.id === "obs-002");
    expect(sealedTextKeyId(String(row?.display))).toBe(NEW.keyId);
    expect(row?.lookup_index).toBe(
      rotating.index(
        "personal_observations",
        "lookup",
        observationLookupValue("http://loinc.org", "2345-7", "Glucose (synthetic)"),
      ),
    );
    expect(
      sealedCipher(NEW).openText(
        "personal_observations",
        "display",
        "obs-002",
        String(row?.display),
      ),
    ).toBe("Glucose (synthetic)");
    expect(table.rows.find((each) => each.id === "obs-other")?.display).toBe(
      "Glucose (synthetic)",
    );
  });

  test("the doctor's lines name tables, columns and counts only", async () => {
    const table = memoryTable(OBSERVATIONS, plainObservations(2));
    const findings = (await plaintextFindings(table.ports.query)).filter(
      (finding) => finding.column === "display",
    );
    expect(findings).toEqual([
      { table: "personal_observations", column: "display", rows: 2 },
    ]);
    const lines = formatPlaintextFindings([
      { table: "personal_observations", column: "display", rows: 2 },
    ]);
    expect(lines.join("\n")).toContain("personal_observations.display: 2 row(s)");
    expect(lines.join("\n")).not.toContain("Glucose");
    expect(formatPlaintextFindings([])[0]).toContain("[ok]");
  });
});
