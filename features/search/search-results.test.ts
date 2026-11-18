import { describe, expect, test } from "bun:test";

import { mergeRecentThreads, type ShellThread } from "@/infrastructure/recent-threads";

import { ACTION_ITEMS, pageItems, staticSearchItems } from "./search-items";
import {
  readServerAnswer,
  recentItems,
  resultGroups,
  SEARCH_FAILED,
  wantsServer,
} from "./search-results";

const statics = staticSearchItems({
  lab: [{ title: "Rhythm benchmark", line: "flag and metrics", path: "/lab/benchmark" }],
  commands: [{ name: "sleep", description: "Look at last week's sleep" }],
});

const thread = (id: string): ShellThread => ({
  id,
  title: `Thread ${id}`,
  updatedAt: "2026-11-14T09:00:00.000Z",
  modelCount: 1,
});

describe("static items", () => {
  test("pages in the box's order, Lab parts after the Lab", () => {
    expect(
      pageItems([{ title: "Long jobs", line: "jobs", path: "/lab/jobs" }]).map(
        ({ title }) => title,
      ),
    ).toEqual([
      "TwinLLM",
      "Customize",
      "Customize · Agents",
      "Customize · Connectors",
      "Digital Twin",
      "Customize · Data",
      "Synthetic cohort · Subjects",
      "Synthetic cohort · Training data",
      "Models",
      "Lab",
      "Lab · Long jobs",
      "Docs",
      "Get started",
    ]);
  });

  test("a command opens a new chat with itself drafted", () => {
    expect(statics.commands).toEqual([
      {
        kind: "command",
        id: "/sleep",
        title: "/sleep",
        detail: "Look at last week's sleep",
        href: "/?draft=%2Fsleep%20",
      },
    ]);
  });

  test("related words find a page", () => {
    const groups = resultGroups({
      query: "trainer",
      tab: "all",
      recents: [],
      statics,
      server: null,
    });
    expect(
      groups.map(({ title, items }) => [title, items.map((item) => item.title)]),
    ).toEqual([["Pages", ["Customize · Agents"]]]);
  });
});

describe("resultGroups", () => {
  test("an empty query lists recents and actions", () => {
    const groups = resultGroups({
      query: " ",
      tab: "all",
      recents: mergeRecentThreads([thread("a"), thread("b")], [], new Set()),
      statics,
      server: null,
    });
    expect(groups.map(({ title, items }) => [title, items.map(({ id }) => id)])).toEqual([
      ["Recents", ["a", "b"]],
      ["Actions", ["new-chat", "new-incognito-chat"]],
    ]);
  });

  test("recents leave out a thread whose delete is pending and stop at eight", () => {
    const many = Array.from({ length: 10 }, (_, index) => thread(String(index)));
    const recents = mergeRecentThreads(many, [], new Set(["0"]));
    expect(recentItems(recents).map(({ id }) => id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });

  test("a typed query keeps the fixed group order and the tab's kinds", () => {
    const server = {
      threads: [
        { kind: "thread" as const, id: "t", title: "Sleep and HRV", href: "/t/t" },
      ],
      docs: [{ kind: "doc" as const, id: "d", title: "Sleep docs", href: "/docs/d" }],
      semantic: true,
    };
    const all = resultGroups({ query: "sl", tab: "all", recents: [], statics, server });
    expect(all.map(({ title }) => title)).toEqual([
      "Threads",
      "Pages",
      "Docs",
      "Commands",
    ]);
    const commands = resultGroups({
      query: "new",
      tab: "commands",
      recents: [],
      statics,
      server,
    });
    expect(commands.map(({ title, items }) => [title, items.length])).toEqual([
      ["Actions", 2],
    ]);
  });
});

describe("server answers", () => {
  test("asked only for typed text on a tab with server kinds", () => {
    expect(wantsServer("sleep", "all")).toBe(true);
    expect(wantsServer("sleep", "docs")).toBe(true);
    expect(wantsServer("sleep", "pages")).toBe(false);
    expect(wantsServer("  ", "threads")).toBe(false);
  });

  test("the server's own sentence, or a generic one", () => {
    expect(readServerAnswer(false, { error: "Sign in to search your threads." })).toEqual(
      {
        error: "Sign in to search your threads.",
      },
    );
    expect(readServerAnswer(false, null)).toEqual({ error: SEARCH_FAILED });
    expect(readServerAnswer(true, { threads: [], docs: [], semantic: false })).toEqual({
      threads: [],
      docs: [],
      semantic: false,
    });
  });

  test("the two actions", () => {
    expect(ACTION_ITEMS.map(({ title, href }) => [title, href])).toEqual([
      ["New chat", "/"],
      ["New incognito chat", "/?incognito=1"],
    ]);
  });
});
