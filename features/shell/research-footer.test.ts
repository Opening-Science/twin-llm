import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LOCAL_ONLY_TEXT,
  RESEARCH_FOOTER_SHORT_TEXT,
  RESEARCH_FOOTER_TEXT,
  ResearchFooter,
  residencyText,
} from "./research-footer";

/** The footer's text as a reader gets it, tags dropped and spaces collapsed. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

/** The markup of the first element with this tag name, closing tag included. */
const element = (html: string, tag: string): string => {
  const start = html.indexOf(`<${tag}`);
  const end = html.indexOf(`</${tag}>`, start);
  return start === -1 || end === -1 ? "" : html.slice(start, end + tag.length + 3);
};

const render = (residency?: Parameters<typeof ResearchFooter>[0]["residency"]) =>
  renderToStaticMarkup(createElement(ResearchFooter, residency ? { residency } : {}));

const LOCAL = { localOnly: true, provider: "ollama" } as const;

describe("ResearchFooter", () => {
  test("exports the exact research-use sentence", () => {
    expect(RESEARCH_FOOTER_TEXT).toBe(
      "Research-use visualisation only. This tool presents supplied data and model output and does not provide medical advice.",
    );
  });

  test("exports the exact phone line", () => {
    expect(RESEARCH_FOOTER_SHORT_TEXT).toBe("Research use only, not clinical advice.");
  });

  describe("on a phone", () => {
    test("the line that shows is the short note and More", () => {
      const summary = element(render(LOCAL), "summary");
      expect(textOf(summary)).toBe(`${RESEARCH_FOOTER_SHORT_TEXT} More Less`);
    });

    test("More opens the full sentence and where models run", () => {
      const details = element(render(LOCAL), "details");
      const body = details.slice(details.indexOf("</summary>"));
      expect(textOf(body)).toBe(`${RESEARCH_FOOTER_TEXT} · ${LOCAL_ONLY_TEXT}`);
    });

    test("without a residency, More opens the sentence alone", () => {
      const details = element(render(), "details");
      const body = details.slice(details.indexOf("</summary>"));
      expect(textOf(body)).toBe(RESEARCH_FOOTER_TEXT);
    });
  });

  describe("from 640 px", () => {
    test("the full sentence and where models run, outside the phone disclosure", () => {
      const html = render(LOCAL);
      const wide = html.slice(html.indexOf("</details>") + "</details>".length);
      expect(textOf(wide)).toBe(`${RESEARCH_FOOTER_TEXT} · ${LOCAL_ONLY_TEXT}`);
    });

    test("the sentence alone when no residency is passed", () => {
      const html = render();
      const wide = html.slice(html.indexOf("</details>") + "</details>".length);
      expect(textOf(wide)).toBe(RESEARCH_FOOTER_TEXT);
    });
  });

  test("local-only mode names what stays here and what syncs from vendor clouds", () => {
    expect(LOCAL_ONLY_TEXT).toBe(
      "Local only: models and storage run on this machine. Wearable syncs download from each vendor's cloud.",
    );
  });

  test("names the provider when local-only mode is off", () => {
    expect(residencyText({ localOnly: false, provider: "exoscale" })).toBe(
      "Cloud model in use: our own open models on Exoscale (Switzerland), personal data only in a consented pilot.",
    );
    expect(residencyText({ localOnly: false, provider: "infomaniak" })).toBe(
      "Cloud model in use: Infomaniak (Switzerland, synthetic data only).",
    );
    expect(residencyText({ localOnly: false, provider: "openrouter" })).toBe(
      "Cloud model in use: OpenRouter (synthetic data only).",
    );
    expect(residencyText({ localOnly: false, provider: "ollama" })).toBe(
      "Model served by Ollama at the configured address.",
    );
    expect(residencyText({ localOnly: false, provider: "remote-gpu" })).toBe(
      "Model served on a remote GPU through an SSH tunnel (synthetic data only).",
    );
  });
});
