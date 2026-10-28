import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { isThreadPath, ThreadBarView } from "./thread-bar";

const render = (pathname: string, title?: string) =>
  renderToStaticMarkup(createElement(ThreadBarView, { pathname, title }));

describe("ThreadBarView", () => {
  test("a thread shows its title, Download and Copy link, never its id as text", () => {
    const html = render("/t/f3a9c1", "Sleep and HRV");
    expect(html).toContain('title="Sleep and HRV">Sleep and HRV</p>');
    expect(html).toContain("Copy link");
    expect(html).toContain(
      'title="Copy this thread&#x27;s address. Only you can open it."',
    );
    expect(html).toContain('href="/api/threads/f3a9c1/export" download=""');
    expect(html).toContain(
      'href="/api/threads/f3a9c1/export?format=print" target="_blank"',
    );
    expect(html).toContain(
      '<a class="text-muted-foreground hover:text-foreground shrink-0" href="/">Chat</a>',
    );
    // The id is only ever in the download address, never in what is shown.
    expect(html.replace(/href="[^"]*"/g, "")).not.toContain("f3a9c1");
  });

  test("a long title is cut to fit, with the whole text on hover", () => {
    const long = "Synthetic demo: how does resting heart rate change with sleep timing?";
    const html = render("/t/f3a9c1", long);
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain("sle…</p>");
  });

  test("a thread with no title reads Thread", () => {
    expect(render("/t/f3a9c1")).toContain(">Thread</p>");
  });

  test("every other page has no bar: its own heading leads", () => {
    for (const path of [
      "/",
      "/customize/connectors",
      "/data",
      "/data/subjects",
      "/docs",
      "/models",
    ]) {
      expect(render(path)).toBe("");
    }
  });
});

describe("isThreadPath", () => {
  test("only /t/<id> is a thread", () => {
    expect(isThreadPath("/t/abc")).toBe(true);
    expect(isThreadPath("/")).toBe(false);
    expect(isThreadPath("/data")).toBe(false);
  });
});
