import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DocsIndex } from "./docs-screen";

const pages = [{ slug: "runbook", path: "runbook.md", title: "Runbook" }];

describe("DocsIndex", () => {
  test("English keeps its title and line", () => {
    const html = renderToStaticMarkup(<DocsIndex pages={pages} />);
    expect(html).toContain('lang="en-GB"');
    expect(html).toContain(">Docs</h1>");
    expect(html).toContain(
      "The reference pages from the repository&#x27;s <code>docs/</code> folder, as checked in.",
    );
  });

  test("German titles the index and says the pages are English; page titles stay", () => {
    const html = renderToStaticMarkup(<DocsIndex pages={pages} locale="de" />);
    expect(html).toContain('lang="de"');
    expect(html).toContain(">Doku</h1>");
    expect(html).toContain("Die Seiten selbst sind auf Englisch.");
    expect(html).toContain(">Runbook</span>");
  });
});
