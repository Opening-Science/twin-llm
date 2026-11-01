import { describe, expect, test } from "bun:test";

import {
  type ConversationGeneration,
  firstGeneration,
  generationAt,
} from "./new-conversation";

/** The generations the screen goes through as the address moves along `paths`. */
const walk = (start: string, paths: readonly string[]): readonly number[] =>
  paths
    .reduce<readonly ConversationGeneration[]>(
      (seen, pathname) => [
        ...seen,
        generationAt(seen.at(-1) ?? firstGeneration(start), pathname),
      ],
      [firstGeneration(start)],
    )
    .map(({ generation }) => generation);

describe("generationAt (#377)", () => {
  test("the first send moves the address to /t/<id> without a new conversation", () => {
    expect(walk("/", ["/t/abc"])).toEqual([0, 0]);
  });

  test("New after a completed turn starts an empty conversation", () => {
    // Send, the turn completes (the address stays /t/abc), then New.
    expect(walk("/", ["/t/abc", "/t/abc", "/"])).toEqual([0, 0, 0, 1]);
  });

  test("New while the turn is still streaming starts an empty conversation", () => {
    // The address is /t/<id> as soon as the turn is confirmed, before any answer streams.
    expect(walk("/", ["/t/abc", "/"]).at(-1)).toBe(1);
  });

  test("each New after another thread starts a fresh one again", () => {
    expect(walk("/", ["/t/a", "/", "/t/b", "/"])).toEqual([0, 0, 1, 1, 2]);
  });

  test("renders at the same address keep the conversation, as the same object", () => {
    const start = firstGeneration("/t/abc");
    expect(generationAt(start, "/t/abc")).toBe(start);
    expect(walk("/", ["/", "/"])).toEqual([0, 0, 0]);
  });

  test("leaving / for another page is not a new conversation by itself", () => {
    expect(walk("/", ["/customize"])).toEqual([0, 0]);
  });
});
