import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { getArkAuditResponse } = await import("./ark-audit");

type ArkAuditRow = {
  readonly seq: bigint | number;
  readonly tool: string;
  readonly ts: Date;
  readonly hash: string;
};

const HASH = "abcdef0123456789aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".slice(
  0,
  64,
);

const row = (overrides?: Partial<ArkAuditRow>): ArkAuditRow => ({
  seq: BigInt(41),
  tool: "ark.status",
  ts: new Date("2026-09-27T12:00:00.000Z"),
  hash: HASH,
  ...overrides,
});

describe("GET /api/ark/audit", () => {
  test("401 without an actor", async () => {
    const response = await getArkAuditResponse({
      resolveActorId: async () => null,
      findEvents: async () => {
        throw new Error("findEvents not expected");
      },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to view Ark audit." });
  });

  test("returns at most 20 events with exactly seq, tool, ts, hash8", async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      row({
        seq: BigInt(100 + index),
        tool: index % 2 === 0 ? "ark.status" : "ark.data.list",
        ts: new Date(`2026-09-27T12:00:${String(index).padStart(2, "0")}.000Z`),
        hash: `${HASH.slice(0, 8)}${String(index).padStart(2, "0")}${HASH.slice(10)}`,
      }),
    );

    const response = await getArkAuditResponse({
      resolveActorId: async () => "user-ark-1",
      findEvents: async (actor) => {
        expect(actor).toBe("user-ark-1");
        return rows;
      },
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({
      events: rows.slice(0, 20).map((entry) => ({
        seq: String(entry.seq),
        tool: entry.tool,
        ts: entry.ts.toISOString(),
        hash8: entry.hash.slice(0, 8),
      })),
    });

    const payload = body as { events: Record<string, unknown>[] };
    expect(payload.events).toHaveLength(20);
    for (const event of payload.events) {
      expect(Object.keys(event).sort()).toEqual(["hash8", "seq", "tool", "ts"]);
    }

    const text = JSON.stringify(body);
    expect(text).not.toContain("args");
    expect(text).not.toContain("result");
    expect(text).not.toContain("subject");
    expect(text).not.toContain("args_sha256");
    expect(text).not.toContain("result_sha256");
    expect(text).not.toContain("subject_ref");
    expect(text).not.toContain("sessionId");
    expect(text).not.toContain("actor");
    expect(text).not.toContain(HASH);
  });
});
