import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RichText } from "./rich-text";

const render = (text: string): string =>
  renderToStaticMarkup(createElement(RichText, { text }));

const wrap = (inner: string): string => `<div class="flex flex-col gap-3">${inner}</div>`;

const STRONG = (text: string) =>
  `<strong class="text-foreground font-medium">${text}</strong>`;
const P = (text: string) => `<p class="whitespace-pre-wrap">${text}</p>`;
const LIST = "flex flex-col gap-1.5 pl-5 text-[15px] leading-relaxed";
const TH = (text: string) =>
  `<th class="border-border border-b px-2 py-1.5 align-top font-medium">${text}</th>`;
const TD = (text: string) =>
  `<td class="border-border border-b px-2 py-1.5 align-top">${text}</td>`;
const TABLE = (head: string, body: string) =>
  `<div class="overflow-x-auto"><table class="w-full border-collapse text-left text-sm">` +
  `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
const HR = `<hr class="border-border"/>`;

describe("RichText blocks", () => {
  test("headings: # to h3, ## to h4, ### and #### to h5, closing hashes dropped", () => {
    expect(render("# One\n## Two **bold**\n### Three ###\n#### Four")).toBe(
      wrap(
        `<h3 class="text-foreground font-semibold text-base">One</h3>` +
          `<h4 class="text-foreground font-semibold text-[15px]">Two ${STRONG("bold")}</h4>` +
          `<h5 class="text-foreground font-semibold text-sm">Three</h5>` +
          `<h5 class="text-foreground font-semibold text-sm">Four</h5>`,
      ),
    );
  });

  test("a hash without a space, or with no text, stays a paragraph", () => {
    expect(render("#nohash\n## ")).toBe(wrap(P("#nohash\n##")));
  });

  test("table: header row, separator, body rows fitted to the header width", () => {
    expect(
      render(
        "| Metric | Value |\n|---|:---:|\n| **Steps** | 9,000 |\n| Sleep | 7 h | extra |\n| Short |",
      ),
    ).toBe(
      wrap(
        TABLE(
          TH("Metric") + TH("Value"),
          `<tr>${TD(STRONG("Steps"))}${TD("9,000")}</tr>` +
            `<tr>${TD("Sleep")}${TD("7 h")}</tr>` +
            `<tr>${TD("Short")}${TD("")}</tr>`,
        ),
      ),
    );
  });

  test("table: escaped pipe stays in the cell, outer pipes optional", () => {
    expect(render("a \\| b | c\n-|-\n1 | 2")).toBe(
      wrap(TABLE(TH("a | b") + TH("c"), `<tr>${TD("1")}${TD("2")}</tr>`)),
    );
  });

  test("a pipe line without a separator, or with a mismatched one, is a paragraph", () => {
    expect(render("a | b\nnot a table")).toBe(wrap(P("a | b\nnot a table")));
    expect(render("| a | b |\n|---|")).toBe(wrap(P("| a | b |\n|---|")));
  });

  test("horizontal rules: ---, *** and ___", () => {
    expect(render("---\n***\n___")).toBe(wrap(HR + HR + HR));
  });

  test("a rule splits paragraphs", () => {
    expect(render("Above\n---\nBelow")).toBe(wrap(P("Above") + HR + P("Below")));
  });

  test("block quote holds its own blocks", () => {
    expect(render("> Quoted line\n> - item one\n> - item two\n\nAfter")).toBe(
      wrap(
        `<blockquote class="border-border text-muted-foreground flex flex-col gap-3 border-l-2 pl-3">` +
          P("Quoted line") +
          `<ul class="${LIST} list-disc"><li>item one</li><li>item two</li></ul>` +
          `</blockquote>` +
          P("After"),
      ),
    );
  });

  test("quotes nest at most four deep; deeper > lines are plain text", () => {
    const open = `<blockquote class="border-border text-muted-foreground flex flex-col gap-3 border-l-2 pl-3">`;
    const close = "</blockquote>";
    expect(render(">".repeat(5000))).toBe(
      wrap(open.repeat(4) + P("&gt;".repeat(4996)) + close.repeat(4)),
    );
  });

  test("links stay https only; anything else is left as text", () => {
    expect(render("[bad](javascript:alert(1)) and [ok](https://example.org)")).toBe(
      wrap(
        P(
          `[bad](javascript:alert(1)) and <a href="https://example.org" target="_blank" rel="noreferrer" class="text-primary underline underline-offset-2">ok</a>`,
        ),
      ),
    );
  });

  test("underscores inside words are not italics", () => {
    expect(render("Field subject_ref, tool `latest_by_loinc`, and _this_ one.")).toBe(
      wrap(
        P(
          `Field subject_ref, tool <code class="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]">latest_by_loinc</code>, and <em>this</em> one.`,
        ),
      ),
    );
  });

  test("paragraphs and lists render as before", () => {
    expect(render("Para one\nline two\n\n- a\n- b\n\n1. x\n2. y")).toBe(
      wrap(
        P("Para one\nline two") +
          `<ul class="${LIST} list-disc"><li>a</li><li>b</li></ul>` +
          `<ol class="${LIST} list-decimal"><li>x</li><li>y</li></ol>`,
      ),
    );
  });

  test("a mixed answer keeps block order", () => {
    expect(
      render(
        "## Summary\nSynthetic intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n---\n- last",
      ),
    ).toBe(
      wrap(
        `<h4 class="text-foreground font-semibold text-[15px]">Summary</h4>` +
          P("Synthetic intro.") +
          TABLE(TH("A") + TH("B"), `<tr>${TD("1")}${TD("2")}</tr>`) +
          HR +
          `<ul class="${LIST} list-disc"><li>last</li></ul>`,
      ),
    );
  });

  test("empty text renders nothing", () => {
    expect(render("\n\n")).toBe("");
  });
});
