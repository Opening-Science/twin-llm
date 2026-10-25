import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { crumbsFor, PageHeaderView } from "./page-header";

const render = (pathname: string, title?: string) =>
  renderToStaticMarkup(
    createElement(PageHeaderView, {
      pathname,
      title,
      onOpenMenu: () => {},
      menuButtonRef: createRef<HTMLButtonElement>(),
    }),
  );

const buttonLabels = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(
    ([, attributes = "", inner = ""]) =>
      /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? inner.replace(/<[^>]+>/g, ""),
  );

describe("crumbsFor", () => {
  test("names each section, and only real sections", () => {
    expect(crumbsFor("/")).toEqual([{ label: "TwinLLM" }]);
    expect(crumbsFor("/connectors")).toEqual([{ label: "Connectors" }]);
    expect(crumbsFor("/digital-twin")).toEqual([{ label: "Digital Twin" }]);
    expect(crumbsFor("/models")).toEqual([{ label: "Models" }]);
    expect(crumbsFor("/data")).toEqual([{ label: "Data" }]);
    expect(crumbsFor("/data/subjects")).toEqual([{ label: "Data" }]);
    expect(crumbsFor("/data/training/smoke/3")).toEqual([{ label: "Data" }]);
    expect(crumbsFor("/database")).toEqual([{ label: "TwinLLM" }]);
    expect(crumbsFor("/benchmarks")).toEqual([{ label: "TwinLLM" }]);
  });

  test("a thread reads TwinLLM, then its title cut to fit", () => {
    expect(crumbsFor("/t/f3a9c1", "Sleep and HRV")).toEqual([
      { label: "TwinLLM" },
      { label: "Sleep and HRV", full: "Sleep and HRV" },
    ]);
    const long = "Synthetic demo: how does resting heart rate change with sleep timing?";
    expect(crumbsFor("/t/f3a9c1", long)[1]).toEqual({
      label: "Synthetic demo: how does resting heart rate change with sle…",
      full: long,
    });
  });

  test("a thread with no title reads Thread, never its id", () => {
    for (const title of [undefined, "", "   "]) {
      expect(crumbsFor("/t/f3a9c1", title)[1]).toEqual({ label: "Thread" });
    }
  });
});

describe("PageHeaderView", () => {
  test("a thread has the menu button and Copy link", () => {
    const html = render("/t/f3a9c1", "Sleep and HRV");
    expect(buttonLabels(html)).toEqual(["Open navigation", "Copy link"]);
    expect(html).toContain(
      '<span class="truncate" aria-current="page" title="Sleep and HRV">Sleep and HRV</span>',
    );
    expect(html).toContain(
      'title="Copy this thread&#x27;s address. Only you can open it."',
    );
    expect(html).not.toContain("f3a9c1");
  });

  test("other pages have only the menu button", () => {
    expect(buttonLabels(render("/connectors"))).toEqual(["Open navigation"]);
    expect(buttonLabels(render("/"))).toEqual(["Open navigation"]);
  });
});
