import { describe, expect, test } from "bun:test";

import { GENESIS_PREV_HASH, hashEvent } from "@/packages/audit/hash";
import type { ChainRow } from "@/packages/audit/verify-chain";

import {
  AUDIT_WALK_START,
  type AuditWalkIo,
  type AuditWalkState,
  walkAuditChain,
} from "./audit-chain-walk";

const chain = (count: number): ChainRow[] =>
  Array.from({ length: count }).reduce<ChainRow[]>((rows, _, index) => {
    const prevHash = rows.at(-1)?.hash ?? GENESIS_PREV_HASH;
    const row = {
      seq: BigInt(index + 1),
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      actor: "test",
      sessionId: "s",
      subjectRef: null,
      tool: "list_subjects",
      argsSha256: "a".repeat(64),
      resultSha256: "b".repeat(64),
      rowCount: 0,
      prevHash,
    };
    const hash = hashEvent({
      actor: row.actor,
      args_sha256: row.argsSha256,
      prev_hash: prevHash,
      result_sha256: row.resultSha256,
      row_count: row.rowCount,
      seq: index + 1,
      session_id: row.sessionId,
      subject_ref: null,
      tool: row.tool,
      ts: row.ts.toISOString(),
    });
    return [...rows, { ...row, hash }];
  }, []);

/** A fake table that records how many rows each read asked for. */
const tableIo = (rows: () => readonly ChainRow[]) => {
  const reads: number[] = [];
  const yields = { count: 0 };
  const io: AuditWalkIo = {
    count: async () => rows().length,
    rowAt: async (seq) => rows().find((row) => row.seq === seq) ?? null,
    rowsAfter: async (after, take) => {
      const page = rows()
        .filter((row) => after === null || BigInt(row.seq) > after)
        .slice(0, take);
      reads.push(page.length);
      return page;
    },
    yieldNow: async () => {
      yields.count += 1;
    },
  };
  return { io, reads, yields };
};

const LIMITS = { pageSize: 10, maxRows: 30 };

describe("walkAuditChain", () => {
  test("an empty table is complete with nothing checked", async () => {
    const { io } = tableIo(() => []);
    expect(await walkAuditChain(io, AUDIT_WALK_START, LIMITS)).toEqual({
      state: AUDIT_WALK_START,
      total: 0,
      complete: true,
    });
  });

  test("reads in pages, yields between them and stops at the row budget", async () => {
    const rows = chain(45);
    const { io, reads, yields } = tableIo(() => rows);
    const first = await walkAuditChain(io, AUDIT_WALK_START, LIMITS);
    expect(first.complete).toBe(false);
    expect(first.state.checked).toBe(30);
    expect(first.total).toBe(45);
    expect(reads).toEqual([10, 10, 10]);
    expect(yields.count).toBe(2);
    expect(Math.max(...reads)).toBeLessThanOrEqual(LIMITS.pageSize);

    const second = await walkAuditChain(io, first.state, LIMITS);
    expect(second.complete).toBe(true);
    expect(second.state.checked).toBe(45);
    expect(second.state.anchor?.hash).toBe(rows[44].hash);
    expect(reads.slice(3)).toEqual([10, 5]);
  });

  test("a later load reads only new rows", async () => {
    const all = chain(25);
    const visible = { count: 20 };
    const { io, reads } = tableIo(() => all.slice(0, visible.count));
    const first = await walkAuditChain(io, AUDIT_WALK_START, LIMITS);
    expect(first.state.checked).toBe(20);
    visible.count = 25;
    const before = reads.length;
    const second = await walkAuditChain(io, first.state, LIMITS);
    expect(second).toMatchObject({ complete: true, total: 25 });
    expect(second.state.checked).toBe(25);
    expect(reads.slice(before)).toEqual([5]);
  });

  test("a tampered row is found, and the walk restarts if the saved row changed", async () => {
    const rows = chain(12);
    const tampered = rows.map((row, index) =>
      index === 4 ? { ...row, actor: "someone else" } : row,
    );
    const { io } = tableIo(() => tampered);
    const walk = await walkAuditChain(io, AUDIT_WALK_START, LIMITS);
    expect(walk.state.brokenAtSeq).toBe(5);
    expect(walk.state.checked).toBe(5);

    const saved: AuditWalkState = {
      anchor: { seq: 12n, hash: "f".repeat(64) },
      checked: 12,
      brokenAtSeq: null,
    };
    const restarted = await walkAuditChain(tableIo(() => rows).io, saved, LIMITS);
    expect(restarted.state.checked).toBe(12);
    expect(restarted.state.anchor?.hash).toBe(rows[11].hash);
  });

  test("a broken chain stays broken without reading it again", async () => {
    const rows = chain(6).map((row, index) =>
      index === 2 ? { ...row, tool: "x" } : row,
    );
    const { io, reads } = tableIo(() => rows);
    const first = await walkAuditChain(io, AUDIT_WALK_START, LIMITS);
    const count = reads.length;
    const again = await walkAuditChain(io, first.state, LIMITS);
    expect(again.state.brokenAtSeq).toBe(3);
    expect(reads.length).toBe(count);
  });
});
