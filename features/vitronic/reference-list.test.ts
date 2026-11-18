import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import type { FieldCipher } from "@/infrastructure/field-cipher";

import {
  listReferenceScans,
  missingMeshes,
  REFERENCE_COLUMNS,
  referenceCsv,
  referenceRows,
  VITRONIC_REFERENCE_LIST_AUDIT_TOOL,
  type ReferenceListPorts,
} from "./reference-list";

const at = (iso: string) => new Date(iso);

const SUBJECTS = [
  {
    id: "sub-b",
    label: "R-B",
    consentRecordedAt: at("2026-11-20T09:00:00Z"),
    consentBy: "operator",
    createdAt: at("2026-11-20T09:00:00Z"),
  },
  {
    id: "sub-a",
    label: "R-A",
    consentRecordedAt: at("2026-11-19T09:00:00Z"),
    consentBy: "operator",
    createdAt: at("2026-11-19T09:00:00Z"),
  },
];

const scan = (subjectId: string, viatarId: number, complete = true) => ({
  subjectId,
  viatarId,
  presetName: "standard",
  glbSha256: complete ? `${"a".repeat(63)}${viatarId % 10}` : null,
  hasMarkers: complete,
  syncedAt: at("2026-11-21T10:00:00Z"),
});

describe("referenceRows", () => {
  test("subjects in the order they were created, scans by number, repeats counted per subject", () => {
    const rows = referenceRows(SUBJECTS, [
      scan("sub-b", 9),
      scan("sub-a", 5),
      scan("sub-a", 3),
      scan("sub-b", 8, false),
    ]);
    expect(
      rows.map((row) => [row.reference, row.subjectLabel, row.viatarId, row.repeat]),
    ).toEqual([
      ["R01", "R-A", 3, 1],
      ["R02", "R-A", 5, 2],
      ["R03", "R-B", 8, 1],
      ["R04", "R-B", 9, 2],
    ]);
    expect(rows.map((row) => row.complete)).toEqual([true, true, false, true]);
  });

  test("a scan of a subject not asked for is left out", () => {
    expect(referenceRows(SUBJECTS, [scan("someone-else", 1)])).toEqual([]);
  });
});

describe("referenceCsv", () => {
  test("has the documented columns and quotes what needs quoting", () => {
    const rows = referenceRows(
      [{ ...SUBJECTS[1]!, label: 'R "A", left' }],
      [scan("sub-a", 3)],
    );
    const [header, line, end] = referenceCsv(rows).split("\n");
    expect(header).toBe(REFERENCE_COLUMNS.join(","));
    expect(line).toBe(
      `R01,"R ""A"", left",2026-11-19T09:00:00.000Z,operator,3,2026-11-21T10:00:00.000Z,standard,1,${"a".repeat(63)}3,true,`,
    );
    expect(end).toBe("");
  });
});

describe("listReferenceScans", () => {
  const ports = (calls: {
    where: unknown[];
    audit: AppendInput[];
  }): ReferenceListPorts => ({
    database: () => ({
      vitronicSubject: {
        findMany: async (args: unknown) => {
          calls.where.push((args as { where: unknown }).where);
          return SUBJECTS.map((row) => ({ ...row, label: `sealed:${row.label}` }));
        },
      },
      vitronicSnapshot: {
        findMany: async (args: unknown) => {
          calls.where.push((args as { where: unknown }).where);
          return [
            { ...scan("sub-a", 3), markers: "sealed-markers" },
            { ...scan("sub-b", 4, false), markers: null },
          ].map(({ hasMarkers: _drop, ...row }) => row);
        },
      },
    }),
    cipher: async () =>
      ({
        openText: (_table: string, _column: string, _id: string, value: string) =>
          value.replace(/^sealed:/, ""),
      }) as unknown as FieldCipher,
    append: async (input) => {
      calls.audit.push(input);
      return {} as Awaited<ReturnType<ReferenceListPorts["append"]>>;
    },
  });

  test("reads this user's subjects but Self, opens labels, and writes one audit row with counts only", async () => {
    const calls = { where: [] as unknown[], audit: [] as AppendInput[] };
    const rows = await listReferenceScans({
      userId: "user-1",
      actor: "local",
      ports: ports(calls),
    });
    expect(calls.where[0]).toEqual({ userId: "user-1", isSelf: false });
    expect(calls.where[1]).toEqual({
      userId: "user-1",
      subjectId: { in: ["sub-b", "sub-a"] },
    });
    expect(rows.map((row) => [row.subjectLabel, row.complete])).toEqual([
      ["R-A", true],
      ["R-B", false],
    ]);
    expect(calls.audit).toHaveLength(1);
    expect(calls.audit[0]).toMatchObject({
      tool: VITRONIC_REFERENCE_LIST_AUDIT_TOOL,
      subjectRef: null,
      args: { subjects: 2 },
      result: { scans: 2 },
      rowCount: 2,
    });
    expect(JSON.stringify(calls.audit[0])).not.toContain("R-A");
  });
});

describe("missingMeshes", () => {
  const rows = referenceRows(SUBJECTS, [
    scan("sub-a", 3),
    scan("sub-a", 4),
    scan("sub-b", 8, false),
  ]);
  const sha = (viatarId: number) => `${"a".repeat(63)}${viatarId % 10}`;

  test("a plain or a sealed mesh counts; a row without a mesh hash is not checked", async () => {
    const onDisk = new Set([`/v/user-1/${sha(3)}.glb`, `/v/user-1/${sha(4)}.glb.enc`]);
    const asked: string[] = [];
    const missing = await missingMeshes(rows, "/v/user-1", async (path) => {
      asked.push(path);
      return onDisk.has(path);
    });
    expect(missing).toEqual([]);
    expect(asked.some((path) => path.includes(sha(8)))).toBe(false);
  });

  test("names the references whose mesh is gone", async () => {
    expect(await missingMeshes(rows, "/v/user-1", async () => false)).toEqual([
      "R01",
      "R02",
    ]);
  });
});
