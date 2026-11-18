import { describe, expect, test } from "bun:test";

import { plainCipher } from "@/infrastructure/field-cipher";
import { pdfDrawnText as drawnText } from "@/tests/support/pdf-drawn-text";

import { loadOwnedThread, type StoredThread, type ThreadReads } from "./owned-thread";
import { createThreadExportHandler } from "./thread-export-handler";

/**
 * #611: the PDF of one chat holds that chat as the screen shows it, and no
 * other subject's data: not another person's thread, and not the rows a
 * cohort lookup read about other synthetic subjects (a lookup card shows
 * its question and row count, never its output). Read back from the file's
 * own text operators, through the real ownership read, in whichever fonts
 * this machine has (the brand fonts or the standard ones).
 */

const answerRow = (
  over: Partial<StoredThread["turns"][number]["responses"][number]>,
) => ({
  id: "r1",
  modelId: "qwen3:4b",
  modelName: "Qwen3 4B",
  position: 0,
  status: "COMPLETE" as const,
  text: "## Answer\nResting heart rate fell from 64 to 59 bpm in October.",
  reasoningText: null,
  attribution: JSON.stringify([
    {
      metricKey: "oura.daily_sleep.lowest_heart_rate",
      label: "Lowest heart rate",
      value: 59,
      unit: "bpm",
      source: "oura",
      day: "2026-10-30",
    },
  ]),
  responseDocument: null,
  toolParts: JSON.stringify([
    {
      seq: 1,
      tool: "cohort_compare",
      input: { subject_ref: "synthea-0001", loinc: "8867-4" },
      output: {
        subjects: [
          { subject_ref: "synthea-0077", value: 188 },
          { subject_ref: "synthea-0078", value: 177 },
        ],
      },
      argsSha256: "a",
      resultSha256: "b",
      rowCount: 2,
      at: "2026-11-01T00:00:00.000Z",
    },
  ]),
  timeToFirstTokenMs: null,
  tokensPerSecond: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: 0,
  completedAt: new Date("2026-11-01T00:00:05.000Z"),
  ...over,
});

const OWN: StoredThread = {
  id: "thread-own",
  userId: "user-1",
  title: "Resting heart rate, synthetic person 1",
  turns: [
    {
      id: "turn-own",
      prompt:
        "Using subject synthea-0001 (LOINC 8867-4), how did resting heart rate change?",
      skill: null,
      label: null,
      scheduled: false,
      responses: [answerRow({})],
    },
  ],
};

const OTHER: StoredThread = {
  id: "thread-other",
  userId: "user-2",
  title: "Someone else's glucose",
  turns: [
    {
      id: "turn-other",
      prompt: "How was glucose for synthea-0099?",
      skill: null,
      label: null,
      scheduled: false,
      responses: [
        answerRow({ id: "r9", text: "## Answer\nGlucose averaged 142 mg/dL." }),
      ],
    },
  ],
};

const reads: ThreadReads = {
  actorId: async () => "actor-1",
  appUserIdFor: async () => "user-1",
  readThread: async (id) => [OWN, OTHER].find((thread) => thread.id === id) ?? null,
  cipherFor: async () => plainCipher,
};

const exportThread = createThreadExportHandler({
  loadOwnedThread: (threadId) => loadOwnedThread(threadId, reads),
  actorId: async () => "actor-1",
  recipientIsLocal: () => true,
  appendAudit: async () => {},
  recordDisclosure: async () => ({ seq: 1n, auditSeq: 1n }),
  freeTextChecker: () => async () => ({ matches: [] }),
  dataMode: () => "synthetic",
  today: () => "2026-11-16",
});

describe("the PDF of one chat (#611)", () => {
  test("holds the chat: title, prompt, answer, cited value and its source", async () => {
    const response = await exportThread("thread-own", "pdf", "confirmed");
    const text = await drawnText(new Uint8Array(await response.arrayBuffer()));
    expect(text).toContain("Resting heart rate, synthetic person 1");
    expect(text).toContain("how did resting heart rate change?");
    expect(text).toContain("Resting heart rate fell from 64 to 59 bpm in October.");
    expect(text).toContain("Lowest heart rate 59 bpm");
    expect(text).toContain("From Oura, 30 Oct 2026");
    expect(text).toContain("2 rows");
  });

  test("holds no other subject's data: no cohort rows, no other thread", async () => {
    const response = await exportThread("thread-own", "pdf", "confirmed");
    const text = await drawnText(new Uint8Array(await response.arrayBuffer()));
    expect(text).toContain("Resting heart rate fell from 64 to 59 bpm in October.");
    for (const foreign of ["synthea-0077", "synthea-0078", "188", "177"]) {
      expect(text).not.toContain(foreign);
    }
    for (const foreign of ["synthea-0099", "glucose", "142"]) {
      expect(text.toLowerCase()).not.toContain(foreign.toLowerCase());
    }
  });

  test("another person's thread makes no PDF", async () => {
    const response = await exportThread("thread-other", "pdf", "confirmed");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toBe("application/pdf");
    const body = (await response.text()).toLowerCase();
    for (const foreign of ["synthea-0099", "glucose", "142"]) {
      expect(body).not.toContain(foreign);
    }
  });
});
