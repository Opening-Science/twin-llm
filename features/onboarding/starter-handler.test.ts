import { describe, expect, test } from "bun:test";

import {
  createStarterQuestionsHandler,
  type StarterHandlerDeps,
} from "./starter-handler";
import { fallbackStarters } from "./starter-questions";

const post = (body: unknown) =>
  new Request("http://localhost/api/onboarding/starters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const deps = (overrides: Partial<StarterHandlerDeps> = {}): StarterHandlerDeps => ({
  resolveActorId: async () => "local",
  findAppUserId: async () => "user-1",
  loadLinkedNames: async () => [],
  generate: () => async () => "What does HRV measure on my ring?",
  timeoutMs: 1000,
  logError: () => undefined,
  ...overrides,
});

describe("POST /api/onboarding/starters", () => {
  test("cleans the body and tells the provider whether data is linked", async () => {
    const linkedFlags: boolean[] = [];
    const prompts: string[] = [];
    const handler = createStarterQuestionsHandler(
      deps({
        loadLinkedNames: async (id) => (id === "user-1" ? ["Oura", "Whoop"] : []),
        generate: (hasLinkedData) => {
          linkedFlags.push(hasLinkedData);
          return async ({ prompt }) => {
            prompts.push(prompt);
            return "What does HRV measure on my ring?";
          };
        },
      }),
    );
    const res = await handler(
      post({ roles: ["astronaut", "self-tracker"], dataChoice: "own", interest: "  " }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "model",
      questions: [
        "What does HRV measure on my ring?",
        "How has my sleep duration changed over the last two weeks?",
        "Is my HRV this week above or below my own recent baseline?",
      ],
    });
    expect(linkedFlags).toEqual([true]);
    expect(prompts[0]).toBe(
      [
        "Roles: Self-tracker",
        "Data: their own linked data",
        "Linked sources: Oura, Whoop",
        "What they want to explore: not given",
      ].join("\n"),
    );
  });

  test("a failing model still answers 200 with fixed starters", async () => {
    const logged: string[] = [];
    const handler = createStarterQuestionsHandler(
      deps({
        generate: () => async () => {
          throw new Error("401 Unauthorized: key sk-live-123");
        },
        logError: (message, name) => logged.push(`${message} ${name}`),
      }),
    );
    const res = await handler(
      post({ roles: ["student"], dataChoice: null, interest: "" }),
    );
    const body = (await res.json()) as unknown;
    expect(res.status).toBe(200);
    expect(body).toEqual({
      source: "fallback",
      questions: fallbackStarters({ roles: ["student"], dataChoice: null }),
    });
    expect(JSON.stringify(body)).not.toContain("Unauthorized");
    expect(logged).toEqual(["[onboarding] starter questions failed Error"]);
  });

  test("a linked-source read that fails counts as nothing linked", async () => {
    const linkedFlags: boolean[] = [];
    const handler = createStarterQuestionsHandler(
      deps({
        loadLinkedNames: async () => {
          throw new RangeError("db down");
        },
        generate: (hasLinkedData) => {
          linkedFlags.push(hasLinkedData);
          return async () => "What does readiness measure?";
        },
      }),
    );
    const res = await handler(post({ roles: [], dataChoice: "demo", interest: "" }));
    expect(res.status).toBe(200);
    expect(linkedFlags).toEqual([false]);
  });

  test("a malformed body is a 400 sentence; no actor is a 401", async () => {
    const handler = createStarterQuestionsHandler(deps());
    const bad = await handler(post({ roles: "researcher" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: "That request didn't look right. Try again.",
    });

    const anonymous = createStarterQuestionsHandler(
      deps({ resolveActorId: async () => null }),
    );
    const res = await anonymous(post({ roles: [], dataChoice: null, interest: "" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to get starter questions." });
  });
});

describe("POST /api/onboarding/starters guard", () => {
  test("a refused request never reaches the model", async () => {
    const calls: string[] = [];
    const handler = createStarterQuestionsHandler(
      deps({
        guard: async (_request, clerkId) => {
          calls.push(`guard ${clerkId}`);
          return Response.json({ error: "Slow down." }, { status: 429 });
        },
        generate: () => async () => {
          calls.push("generate");
          return "What does HRV measure?";
        },
      }),
    );
    const res = await handler(post({ roles: [], dataChoice: null, interest: "" }));
    expect(res.status).toBe(429);
    expect(calls).toEqual(["guard local"]);
  });
});
