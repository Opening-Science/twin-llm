import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardScreen } from "./dashboard-screen";

const headings = (html: string): string[] =>
  [...html.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/g)].map((match) => match[1]!);

const links = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
    (match) => `${match[2]} → ${match[1]}`,
  );

describe("DashboardScreen", () => {
  test("a title, then one section per part, each with its link", () => {
    const html = renderToStaticMarkup(createElement(DashboardScreen, { slots: {} }));
    expect(headings(html)).toEqual(["Dashboard", "Wearables", "Digital Twin", "Chat"]);
    expect(links(html)).toEqual([
      "Open Connectors → /customize/connectors",
      "Open the Digital Twin → /digital-twin",
      "Ask a new question → /",
    ]);
  });

  test("a slot shows inside its own section", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardScreen, {
        slots: { twin: createElement("p", { id: "twin-slot" }, "Twin preview") },
      }),
    );
    const twin = html.slice(
      html.indexOf('aria-labelledby="dashboard-twin"'),
      html.indexOf('aria-labelledby="dashboard-chat"'),
    );
    expect(twin).toContain('<p id="twin-slot">Twin preview</p>');
  });
});
