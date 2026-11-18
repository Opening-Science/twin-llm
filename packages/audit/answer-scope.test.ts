import { describe, expect, test } from "bun:test";

import {
  answerKey,
  collectorKey,
  drainAnswerAudit,
  withinAnswer,
} from "./answer-scope";
import { type AuditTransaction, appendInTransaction } from "./append";

/** An in-memory audit chain: enough of a transaction for `appendInTransaction`. */
const memoryChain = () => {
  const rows: { seq: bigint; hash: string; sessionId: string }[] = [];
  const tx = {
    $executeRaw: async () => 0,
    auditEvent: {
      findFirst: async () => rows.at(-1) ?? null,
      create: async ({ data }: { data: (typeof rows)[number] }) => {
        rows.push(data);
        return data;
      },
    },
  } as unknown as AuditTransaction;
  const write = (sessionId: string, tool: string) =>
    appendInTransaction(tx, {
      actor: "test",
      sessionId,
      subjectRef: null,
      tool,
      args: { tool },
      result: [],
      rowCount: 0,
    });
  return { rows, write };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("the answers of one turn (#856)", () => {
  test("each answer drains the audit rows its own calls wrote, interleaved", async () => {
    const chain = memoryChain();
    const answer = (answerId: string, tools: readonly string[]) =>
      withinAnswer("turn-1", answerId, async () => {
        for (const tool of tools) {
          await tick();
          await chain.write("turn-1", tool);
        }
      });
    await Promise.all([answer("a", ["trend", "latest"]), answer("b", ["window"])]);
    // A row of the turn written outside any answer belongs to neither.
    await chain.write("turn-1", "skill-run");

    const seqOf = (tool: string) =>
      Number(chain.rows.find((row) => (row as { tool?: string }).tool === tool)?.seq);
    expect([...drainAnswerAudit("turn-1", "a")].sort()).toEqual(
      [seqOf("trend"), seqOf("latest")].sort(),
    );
    expect([...drainAnswerAudit("turn-1", "b")]).toEqual([seqOf("window")]);
    expect(drainAnswerAudit("turn-1", "a").size).toBe(0);
  });

  test("a row for another session is not the answer's", async () => {
    const chain = memoryChain();
    await withinAnswer("turn-1", "a", () => chain.write("turn-2", "trend"));
    expect(drainAnswerAudit("turn-1", "a").size).toBe(0);
  });

  test("collectors key by the answer inside one, by the session outside", () => {
    expect(collectorKey("turn-1")).toBe("turn-1");
    expect(withinAnswer("turn-1", "qwen3:4b", () => collectorKey("turn-1"))).toBe(
      answerKey("turn-1", "qwen3:4b"),
    );
    expect(withinAnswer("turn-1", "qwen3:4b", () => collectorKey("turn-2"))).toBe(
      "turn-2",
    );
    expect(answerKey("turn-1", null)).toBe("turn-1");
  });
});
