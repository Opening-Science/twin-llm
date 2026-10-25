import { describe, expect, test } from "bun:test";

import {
  type FunnelEvent,
  trackModelAnswered,
  trackPromptSent,
  trackVoteCast,
} from "./analytics-events";

const collect = () => {
  const events: FunnelEvent[] = [];
  return { events, sink: (event: FunnelEvent) => events.push(event) };
};

describe("funnel events", () => {
  test("prompt_sent carries ids and counts only", () => {
    const { events, sink } = collect();
    trackPromptSent(
      { clerkId: "u1", threadId: "th1", turnId: "t1", modelIds: ["a", "b"] },
      sink,
    );
    expect(events).toEqual([
      {
        distinctId: "u1",
        event: "prompt_sent",
        properties: {
          threadId: "th1",
          turnId: "t1",
          modelIds: ["a", "b"],
          modelCount: 2,
        },
      },
    ]);
  });

  test("model_answered and vote_cast", () => {
    const { events, sink } = collect();
    trackModelAnswered(
      { clerkId: "u1", turnId: "t1", modelId: "a", status: "FAILED" },
      sink,
    );
    trackVoteCast({ clerkId: "u1", turnId: "t1", modelResponseId: "r1" }, sink);
    expect(events.map((event) => event.event)).toEqual(["model_answered", "vote_cast"]);
    expect(events[0]?.properties).toEqual({
      turnId: "t1",
      modelId: "a",
      status: "FAILED",
    });
    expect(events[1]?.properties).toEqual({ turnId: "t1", modelResponseId: "r1" });
  });

  test("no sink means nothing is sent and nothing throws", () => {
    expect(() =>
      trackModelAnswered(
        { clerkId: "u1", turnId: "t1", modelId: "a", status: "COMPLETE" },
        null,
      ),
    ).not.toThrow();
  });
});
