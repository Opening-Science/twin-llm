import { describe, expect, test } from "bun:test";

import { threadCrumb, threadIdOfPath } from "./thread-crumb";

describe("threadIdOfPath", () => {
  test("reads the id of a saved thread's page only", () => {
    expect(threadIdOfPath("/t/abc123")).toBe("abc123");
    expect(threadIdOfPath("/t/abc%20123/x")).toBe("abc 123");
    expect(threadIdOfPath("/t/")).toBeNull();
    expect(threadIdOfPath("/models")).toBeNull();
    expect(threadIdOfPath(null)).toBeNull();
  });
});

describe("threadCrumb", () => {
  test("a chat thread, whitespace collapsed", () => {
    expect(threadCrumb("  How did I\n sleep   last week? ")).toEqual({
      section: { label: "Chat", href: "/" },
      title: "How did I sleep last week?",
    });
  });

  test("a /twin thread belongs to Twin, without the command", () => {
    expect(threadCrumb("/TWIN show my heart")).toEqual({
      section: { label: "Twin", href: "/digital-twin" },
      title: "show my heart",
    });
    expect(threadCrumb("/twinning ideas").section.label).toBe("Chat");
    expect(threadCrumb("/twin")).toEqual({
      section: { label: "Twin", href: "/digital-twin" },
      title: "Thread",
    });
  });

  test("no title reads Thread, never the id", () => {
    expect(threadCrumb(null).title).toBe("Thread");
    expect(threadCrumb("   ").title).toBe("Thread");
  });

  test("up to 60 characters whole; longer is cut to 59 and an ellipsis", () => {
    const sixty = "a".repeat(60);
    expect(threadCrumb(sixty)).toEqual({
      section: { label: "Chat", href: "/" },
      title: sixty,
    });
    const long = `${"word ".repeat(11)}${"b".repeat(10)}`;
    expect(threadCrumb(long)).toEqual({
      section: { label: "Chat", href: "/" },
      title: `${"word ".repeat(11)}bbbb…`,
      full: long,
    });
    // A cut that ends on a space drops it before the ellipsis.
    const spaced = `${"a".repeat(58)} ${"b".repeat(10)}`;
    expect(threadCrumb(spaced).title).toBe(`${"a".repeat(58)}…`);
  });
});
