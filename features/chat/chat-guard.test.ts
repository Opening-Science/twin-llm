import { describe, expect, test } from "bun:test";

import type { ProtectionVerdict } from "@/infrastructure/protection-verdict";

import { chatResponseFor, retryAfterSeconds, runChatGuard } from "./chat-guard";

const call = new Request("http://localhost/api/chat", { method: "POST" });

describe("runChatGuard", () => {
  test("lets the call through when nothing is configured", async () => {
    expect(await runChatGuard(null, call, "user_1")).toBeNull();
  });

  test("passes the person to the check and allows an allowed verdict", async () => {
    const seen: string[] = [];
    const response = await runChatGuard(
      async (_request, userId) => {
        seen.push(userId);
        return { kind: "allowed" };
      },
      call,
      "user_1",
    );
    expect(response).toBeNull();
    expect(seen).toEqual(["user_1"]);
  });

  test("fails open when the check is unavailable", async () => {
    const verdict: ProtectionVerdict = { kind: "unavailable", detail: "timeout" };
    expect(await runChatGuard(async () => verdict, call, "user_1")).toBeNull();
  });
});

describe("chatResponseFor", () => {
  test("rate limit gives 429 with a retry-after in whole seconds", async () => {
    const now = Date.parse("2026-10-25T10:00:00Z");
    const response = chatResponseFor(
      { kind: "rate-limited", resetAt: new Date(now + 4_200) },
      now,
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("5");
    expect(await response?.json()).toEqual({
      error: "You've sent a lot of prompts in a short time. Try again in 5 seconds.",
    });
  });

  test("a block gives 403 with a plain sentence", async () => {
    const response = chatResponseFor({ kind: "blocked" });
    expect(response?.status).toBe(403);
    const body = (await response?.json()) as { error: string };
    expect(body.error).toBe(
      "This request was blocked. If you think that's wrong, try again.",
    );
  });

  test("retryAfterSeconds falls back to the bucket interval and never drops below 1", () => {
    expect(retryAfterSeconds(null, 0)).toBe(60);
    expect(retryAfterSeconds(new Date(500), 1_000)).toBe(1);
  });
});
