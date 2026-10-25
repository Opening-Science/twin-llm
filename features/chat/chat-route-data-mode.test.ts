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

const USER_ID = "user-synthetic-1";
const TURN_ID = "turn-synthetic-1";
const MODEL_ID = "synthetic-model";
const WHOOP_NARRATIVE = "Whoop wearable context for 2026-01-01 to 2026-01-04.";

const originalEnv = { ...process.env };
let streamCalls = 0;
let streamWearables: unknown = null;
let whoopReads = 0;
let appendFail = false;

mock.module("server-only", () => ({}));
mock.module("@/infrastructure/auth-actor", () => ({
  resolveActorId: async () => "local",
}));
mock.module("@/features/chat/chat-protection", () => ({
  guardChatRequest: async () => null,
}));
mock.module("@/infrastructure/current-user", () => ({
  findAppUserId: async () => USER_ID,
  ensureAppUser: async () => ({ id: USER_ID }),
}));
mock.module("@/infrastructure/database", () => ({
  database: () => ({
    modelResponse: {
      findUnique: async () => ({
        turn: { thread: { userId: USER_ID } },
      }),
    },
    ouraSnapshot: { findFirst: async () => null },
    whoopSnapshot: {
      findFirst: async () => {
        whoopReads += 1;
        return {
          summary: {
            window: { startDate: "2026-01-01", endDate: "2026-01-04" },
            metrics: [],
            narrative: WHOOP_NARRATIVE,
          },
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
          create: () => Promise<object>;
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
          create: async () => ({}),
        },
      });
    },
  }),
}));
mock.module("@/infrastructure/fetch-model-catalog", () => ({
  fetchActiveModelCatalog: async () => [
    {
      id: MODEL_ID,
      name: "Synthetic",
      provider: "OpenRouter",
      providerId: "openrouter",
      contextTokens: 8_000,
    },
  ],
}));
mock.module("@/features/chat/stream-model-response", () => ({
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
}));

let POST: (request: Request) => Promise<Response>;

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
  ({ POST } = await import("@/app/api/chat/route"));
});

afterAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

const useEnv = async (values: Record<string, string>) => {
  Object.assign(process.env, values);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
};

beforeEach(async () => {
  streamCalls = 0;
  streamWearables = null;
  whoopReads = 0;
  appendFail = false;
  await useEnv({ LLM_PROVIDER: "openrouter", DATA_MODE: "synthetic" });
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
  test("personal wearable context reaches our own Exoscale models", async () => {
    await useEnv({
      LLM_PROVIDER: "exoscale",
      DATA_MODE: "personal",
      LOCAL_ONLY: "false",
      EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1",
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
