import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ShellThread } from "@/infrastructure/recent-threads";

import { RecentChats } from "./recent-chats";

const thread = (n: number): ShellThread => ({
  id: `thread-synthetic-${n}`,
  title: `Synthetic question ${n}`,
  updatedAt: `2026-11-1${n}T09:00:00.000Z`,
  modelCount: n,
});

const links = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*><span[^>]*>([^<]+)<\/span>/g)].map(
    (match) => `${match[2]} → ${match[1]}`,
  );

describe("RecentChats", () => {
  test("the newest five, each a link to its thread", () => {
    const html = renderToStaticMarkup(
      createElement(RecentChats, { threads: [1, 2, 3, 4, 5, 6].map(thread) }),
    );
    expect(links(html)).toEqual([
      "Synthetic question 1 → /t/thread-synthetic-1",
      "Synthetic question 2 → /t/thread-synthetic-2",
      "Synthetic question 3 → /t/thread-synthetic-3",
      "Synthetic question 4 → /t/thread-synthetic-4",
      "Synthetic question 5 → /t/thread-synthetic-5",
    ]);
    expect(html).toContain("11 Nov 2026 · 1 model");
  });

  test("with no threads it says how one starts", () => {
    expect(renderToStaticMarkup(createElement(RecentChats, { threads: [] }))).toBe(
      '<p class="text-muted-foreground text-sm">No conversations yet. Ask a question and it shows here and in the sidebar.</p>',
    );
  });
});
