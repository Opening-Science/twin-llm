import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import {
  auditPersonalRead,
  personalReadEvent,
  personalReadTool,
} from "./personal-read-audit";

describe("personalReadEvent", () => {
  test("purpose and row count only, session defaults to the actor", () => {
    expect(
      personalReadEvent({ actor: "local", purpose: "wearables-summary", rowCount: 2 }),
    ).toEqual({
      actor: "local",
      sessionId: "local",
      subjectRef: null,
      tool: "personal.read.wearables-summary",
      args: { purpose: "wearables-summary" },
      result: { rowCount: 2 },
      rowCount: 2,
    });
  });

  test("keeps a given session and subject", () => {
    expect(
      personalReadEvent({
        actor: "user_synthetic_1",
        purpose: "genome-report",
        rowCount: 0,
        sessionId: "session-1",
        subjectRef: "subj-synthetic-1",
      }),
    ).toEqual({
      actor: "user_synthetic_1",
      sessionId: "session-1",
      subjectRef: "subj-synthetic-1",
      tool: "personal.read.genome-report",
      args: { purpose: "genome-report" },
      result: { rowCount: 0 },
      rowCount: 0,
    });
  });

  test("the tool name is personal.read.<purpose>", () => {
    expect(personalReadTool("genome-report")).toBe("personal.read.genome-report");
  });
});

describe("auditPersonalRead", () => {
  test("appends exactly the event, once", async () => {
    const appended: AppendInput[] = [];
    const audit = auditPersonalRead(async (input) => {
      appended.push(input);
      return undefined;
    });
    await audit({ actor: "local", purpose: "genome-report", rowCount: 3 });
    expect(appended).toEqual([
      personalReadEvent({ actor: "local", purpose: "genome-report", rowCount: 3 }),
    ]);
  });

  test("a failed append reaches the caller", async () => {
    const audit = auditPersonalRead(async () => {
      throw new Error("audit-down");
    });
    const error = await audit({
      actor: "local",
      purpose: "wearables-summary",
      rowCount: 1,
    }).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect((error as Error).message).toBe("audit-down");
  });
});
