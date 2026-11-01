import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import { moduleMocker } from "@/tests/support/mock-module";

const USER_ID = "user-synthetic-1";
const TURN_ID = "turn-synthetic-1";
const MODEL_ID = "synthetic-model";
const WHOOP_NARRATIVE = "Whoop wearable context for 2026-01-01 to 2026-01-04.";

const originalEnv = { ...process.env };
let streamCalls = 0;
let streamWearables: unknown = null;
let whoopReads = 0;
let appendFail = false;
let auditedTools: string[] = [];
let refusedRows: string[] = [];
/** The stored tool parts of the thread's earlier turn (synthetic). */
let earlierToolParts: unknown = null;

const { plainCipher, sealedCipher, sealJson } =
  await import("@/infrastructure/field-cipher");
/** DATA_MODE as `useEnv` last set it. */
let dataMode = "synthetic";
/** Stored values are sealed with the open vault's key in personal mode (#141). */
const storeCipher = () =>
  dataMode === "personal"
    ? sealedCipher({ keyId: "0123456789abcdef", dataKey: Buffer.alloc(32, 7) })
    : plainCipher;

const mockModuleForFile = moduleMocker({ mock, afterAll });
mock.module("server-only", () => ({}));
await mockModuleForFile("@/infrastructure/auth-actor", {
  resolveActorId: async () => "local",
});
await mockModuleForFile("@/features/chat/chat-protection", {
  guardChatRequest: async () => null,
});
await mockModuleForFile("@/infrastructure/current-user", {
  findAppUserId: async () => USER_ID,
  ensureAppUser: async () => ({ id: USER_ID }),
});
await mockModuleForFile("@/infrastructure/database", {
  database: () => ({
    user: { findUnique: async () => ({ clerkId: "local" }) },
    modelResponse: {
      findUnique: async () => ({
        id: "response-synthetic-1",
        modelName: "Synthetic",
        turn: { thread: { userId: USER_ID } },
      }),
      update: async (args: { data: { status: string; text: string } }) => {
        const text = storeCipher().openText(
          "model_responses",
          "text",
          "response-synthetic-1",
          args.data.text,
        );
        refusedRows.push(`${args.data.status} ${text}`);
        return {};
      },
    },
    turn: {
      findUnique: async () => ({
        threadId: "thread-synthetic-1",
        thread: {
          userId: USER_ID,
          turns: [
            {
              id: "turn-synthetic-0",
              responses: [
                {
                  id: "response-synthetic-0",
                  toolParts:
                    earlierToolParts === null
                      ? null
                      : sealJson(
                          storeCipher(),
                          "model_responses",
                          "toolParts",
                          "response-synthetic-0",
                          earlierToolParts,
                        ),
                },
              ],
            },
            { id: TURN_ID, responses: [{ id: "response-synthetic-1", toolParts: null }] },
          ],
        },
      }),
    },
    auditEvent: { findFirst: async () => null },
    ouraSnapshot: { findFirst: async () => null },
    whoopSnapshot: {
      findFirst: async () => {
        whoopReads += 1;
        return {
          id: "whoop-synthetic-1",
          summary: sealJson(
            storeCipher(),
            "whoop_snapshots",
            "summary",
            "whoop-synthetic-1",
            {
              window: { startDate: "2026-01-01", endDate: "2026-01-04" },
              metrics: [],
              narrative: WHOOP_NARRATIVE,
            },
          ),
        };
      },
    },
    googleHealthSnapshot: { findFirst: async () => null },
    vitronicSnapshot: { findFirst: async () => null },
    $transaction: async (
      fn: (tx: {
        $executeRaw: () => Promise<number>;
        auditEvent: {
          findFirst: () => Promise<null>;
          create: (args: { data: { tool: string } }) => Promise<object>;
        };
      }) => Promise<unknown>,
    ) => {
      if (appendFail) {
        throw new Error("audit-down");
      }
      return fn({
        $executeRaw: async () => 0,
        auditEvent: {
          findFirst: async () => null,
          create: async (args: { data: { tool: string } }) => {
            auditedTools.push(args.data.tool);
            return {};
          },
        },
      });
    },
  }),
});
// Bun's module mocks last for the whole test process, so every mock here keeps
// the module's other exports (#152) and the real module is put back after this
// file (#336, #359): later files such as fetch-model-catalog.test.ts get the
// real one in any order.
await mockModuleForFile("@/infrastructure/fetch-model-catalog", {
  fetchActiveModelCatalog: async () => [
    {
      id: MODEL_ID,
      name: "Synthetic",
      provider: "OpenRouter",
      providerId: "openrouter",
      contextTokens: 8_000,
    },
  ],
});
await mockModuleForFile("@/features/chat/stream-model-response", {
  streamModelResponse: async (_request: unknown, context: Record<string, unknown>) => {
    streamCalls += 1;
    streamWearables = {
      ouraSummary: context.ouraSummary,
      whoopSummary: context.whoopSummary,
      googleHealthSummary: context.googleHealthSummary,
      vitronicSummary: context.vitronicSummary,
    };
    return new Response("streamed");
  },
});

let POST: (request: Request) => Promise<Response>;

/** Personal mode needs an unlocked vault (#142); these tests run with it open. */
const UNLOCK_TOKEN = "synthetic-unlock-token";

beforeAll(async () => {
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "openrouter",
    DATA_MODE: "synthetic",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    OPENROUTER_API_KEY: "synthetic-openrouter-key",
  });
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
  const route = await import("@/app/api/chat/route");
  const { vaultSessions } = await import("@/infrastructure/vault-session");
  vaultSessions().open("local", "0123456789abcdef", Buffer.alloc(32, 7), UNLOCK_TOKEN);
  POST = (request) => {
    const headers = new Headers(request.headers);
    headers.set("cookie", `twinllm_unlock=${UNLOCK_TOKEN}`);
    return route.POST(new Request(request, { headers }));
  };
});

afterAll(async () => {
  const { vaultSessions } = await import("@/infrastructure/vault-session");
  vaultSessions().lock("local");
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

const useEnv = async (values: Record<string, string>) => {
  Object.assign(process.env, values);
  dataMode = values.DATA_MODE ?? dataMode;
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
};

beforeEach(async () => {
  streamCalls = 0;
  streamWearables = null;
  whoopReads = 0;
  appendFail = false;
  auditedTools = [];
  refusedRows = [];
  earlierToolParts = null;
  await useEnv({
    LLM_PROVIDER: "openrouter",
    DATA_MODE: "synthetic",
    EXOSCALE_PERSONAL_DATA: "off",
  });
});

describe("POST /api/chat DATA_MODE=synthetic", () => {
  test("a stored wearable snapshot is never read, so its narrative cannot reach the model", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: MODEL_ID,
          turnId: TURN_ID,
          messages: [{ role: "user", content: "What changed in recovery this week?" }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(whoopReads).toBe(0);
    expect(streamCalls).toBe(1);
    expect(streamWearables).toEqual({
      ouraSummary: null,
      whoopSummary: null,
      googleHealthSummary: null,
      vitronicSummary: null,
    });
    expect(JSON.stringify(streamWearables)).not.toContain(WHOOP_NARRATIVE);
  });
});

describe("POST /api/chat with LLM_PROVIDER=exoscale", () => {
  test("personal wearable context reaches our own Exoscale models in a consented pilot", async () => {
    await useEnv({
      LLM_PROVIDER: "exoscale",
      DATA_MODE: "personal",
      LOCAL_ONLY: "false",
      EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1",
      EXOSCALE_PERSONAL_DATA: "consented-pilot",
    });
    const res = await POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: MODEL_ID,
          turnId: TURN_ID,
          messages: [{ role: "user", content: "What changed in recovery this week?" }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(whoopReads).toBe(1);
    expect(streamCalls).toBe(1);
    expect(JSON.stringify(streamWearables)).toContain(WHOOP_NARRATIVE);
  });
});

describe("POST /api/chat in a thread that used genome tools (#151)", () => {
  const PILOT = {
    LLM_PROVIDER: "exoscale",
    DATA_MODE: "personal",
    LOCAL_ONLY: "false",
    EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1",
    EXOSCALE_PERSONAL_DATA: "consented-pilot",
  };
  const GENOME_PART = {
    seq: 1,
    tool: "dna_ask",
    input: { rsid: "rs0000001" },
    output: { answer: "synthetic" },
    argsSha256: "a".repeat(64),
    resultSha256: "b".repeat(64),
    rowCount: null,
    at: "2026-10-27T00:00:00.000Z",
  };
  const ask = () =>
    POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: MODEL_ID,
          turnId: TURN_ID,
          messages: [{ role: "user", content: "And how did I sleep?" }],
        }),
      }),
    );

  test("the consented Exoscale pilot is refused before anything is streamed", async () => {
    await useEnv(PILOT);
    earlierToolParts = [GENOME_PART];
    const res = await ask();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "GENOME_THREAD_LOCAL_ONLY",
      error:
        "This thread used your genome report or imported data, so it only runs on local models.",
    });
    expect(streamCalls).toBe(0);
    // The wearable read is audited first; nothing says the pilot got data.
    expect(auditedTools).toEqual(["vitronic.chat.summary", "genome.thread.refused"]);
    expect(refusedRows).toEqual([
      "REFUSED This thread used your genome report or imported data, so it only runs on local models.",
    ]);
  });

  test("the same thread on local Ollama streams", async () => {
    await useEnv({ LLM_PROVIDER: "ollama", DATA_MODE: "personal" });
    earlierToolParts = [GENOME_PART];
    const res = await ask();
    expect(res.status).toBe(200);
    expect(streamCalls).toBe(1);
    expect(refusedRows).toEqual([]);
  });

  test("a thread without genome parts on the pilot is unchanged", async () => {
    await useEnv(PILOT);
    earlierToolParts = [{ ...GENOME_PART, tool: "coverage" }];
    const res = await ask();
    expect(res.status).toBe(200);
    expect(streamCalls).toBe(1);
    expect(auditedTools).toEqual([
      "vitronic.chat.summary",
      "provider.personal_data_sent",
      // Every answer records its effort (#366); Balanced when none was sent.
      "chat.effort",
    ]);
  });
});

describe("POST /api/chat audit failure log", () => {
  test("catch logs only an allowlisted failure summary", async () => {
    // Personal mode reads the snapshots, and the audited read is what fails here.
    await useEnv({ LLM_PROVIDER: "ollama", DATA_MODE: "personal" });
    appendFail = true;
    const logged: unknown[][] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });

    try {
      const res = await POST(
        new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: MODEL_ID,
            turnId: TURN_ID,
            messages: [{ role: "user", content: "What changed in recovery this week?" }],
          }),
        }),
      );

      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body).toEqual({
        error: "We couldn't reach that model just now. Give it another try.",
      });
      const blob = JSON.stringify(body);
      expect(blob).not.toContain("audit-down");
      expect(blob.toLowerCase()).not.toContain("prisma");
      expect(streamCalls).toBe(0);

      const chatLogs = logged.filter(
        (args) => args[0] === "[chat] failed to start the model stream",
      );
      expect(chatLogs).toHaveLength(1);
      expect(chatLogs[0]).toEqual([
        "[chat] failed to start the model stream",
        { code: "other" },
      ]);
      expect(JSON.stringify(logged)).not.toContain("audit-down");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
