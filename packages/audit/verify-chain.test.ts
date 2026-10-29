import { beforeEach, describe, expect, test } from "bun:test";

type AuditRow = {
  seq: bigint;
  ts: Date;
  actor: string;
  sessionId: string;
  subjectRef: string | null;
  tool: string;
  argsSha256: string;
  resultSha256: string;
  rowCount: number;
  prevHash: string;
  hash: string;
};

const events: AuditRow[] = [];

const mockDb = () => ({
  auditEvent: {
    findFirst: async ({ orderBy }: { orderBy: { seq: "desc" } }) => {
      if (orderBy.seq !== "desc" || events.length === 0) return null;
      return events[events.length - 1];
    },
    findMany: async ({ orderBy }: { orderBy: { seq: "asc" } }) => {
      if (orderBy.seq !== "asc") return [...events];
      return [...events].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
    },
    create: async ({ data }: { data: AuditRow }) => {
      events.push({ ...data });
      return data;
    },
  },
  $executeRaw: async () => 0,
  $transaction: async (fn: (tx: ReturnType<typeof mockDb>) => Promise<unknown>) =>
    fn(mockDb()),
});

beforeEach(() => {
  events.length = 0;
});

describe("verifyChain", () => {
  test("passes on 20 events and fails after one tampered row", async () => {
    const { append } = await import("./append");
    const { verifyChain } = await import("./verify-chain");
    const client = mockDb();

    for (let i = 0; i < 20; i += 1) {
      await append(client as never, {
        actor: "local",
        sessionId: "turn-chain",
        subjectRef: i % 2 === 0 ? null : `subj-${i}`,
        tool: "list_subjects",
        args: { cohort_id: `c-${i}` },
        result: { subjects: [] },
        rowCount: 0,
      });
    }

    expect(events).toHaveLength(20);
    expect(await verifyChain(client as never)).toEqual({
      ok: true,
      brokenAtSeq: null,
      checked: 20,
      total: 20,
      latestHash: events[19].hash,
    });

    events[3].rowCount = events[3].rowCount + 1;
    expect(await verifyChain(client as never)).toEqual({
      ok: false,
      brokenAtSeq: 4,
      checked: 4,
      total: 20,
      latestHash: events[19].hash,
    });
  });
});

describe("checkChain", () => {
  test("an empty table holds, with nothing checked and no latest hash", async () => {
    const { checkChain } = await import("./verify-chain");
    expect(checkChain([])).toEqual({
      ok: true,
      brokenAtSeq: null,
      checked: 0,
      total: 0,
      latestHash: null,
    });
  });

  test("a row pointing at the wrong previous hash breaks the chain there", async () => {
    const { append } = await import("./append");
    const { checkChain } = await import("./verify-chain");
    const client = mockDb();
    for (let i = 0; i < 3; i += 1) {
      await append(client as never, {
        actor: "local",
        sessionId: "turn-link",
        subjectRef: null,
        tool: "list_subjects",
        args: { cohort_id: `l-${i}` },
        result: { subjects: [] },
        rowCount: 0,
      });
    }
    const rows = events.map((row, index) =>
      index === 1 ? { ...row, prevHash: "f".repeat(64) } : row,
    );
    expect(checkChain(rows)).toEqual({
      ok: false,
      brokenAtSeq: 2,
      checked: 2,
      total: 3,
      latestHash: events[2].hash,
    });
  });
});
