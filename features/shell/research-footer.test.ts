import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LOCAL_ONLY_TEXT,
  RESEARCH_FOOTER_TEXT,
  ResearchFooter,
  residencyText,
} from "./research-footer";

const FOOTER_CLASS =
  "border-border text-muted-foreground border-t px-4 py-1.5 text-center text-xs leading-snug";

describe("ResearchFooter", () => {
  test("exports the exact research-use sentence", () => {
    expect(RESEARCH_FOOTER_TEXT).toBe(
      "Research-use visualisation only. This tool presents supplied data and model output and does not provide medical advice.",
    );
  });

  test("renders the exact sentence", () => {
    const html = renderToStaticMarkup(createElement(ResearchFooter));
    expect(html).toContain(RESEARCH_FOOTER_TEXT);
    expect(html).toContain("<footer");
  });

  test("renders only the sentence, with no separator, when no residency is passed", () => {
    const html = renderToStaticMarkup(createElement(ResearchFooter));
    expect(html).toBe(
      `<footer class="${FOOTER_CLASS}"><span class="inline-block">${RESEARCH_FOOTER_TEXT}</span></footer>`,
    );
  });

  test("local-only mode names what stays here and what syncs from vendor clouds", () => {
    expect(LOCAL_ONLY_TEXT).toBe(
      "Local only: models and storage run on this machine. Wearable syncs download from each vendor's cloud.",
    );
  });

  test("renders sentence · residency on one line", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchFooter, {
        residency: { localOnly: true, provider: "ollama" },
      }),
    );
    expect(html).toBe(
      `<footer class="${FOOTER_CLASS}">` +
        `<span class="inline-block">${RESEARCH_FOOTER_TEXT}</span> ` +
        '<span class="mr-1.5 hidden min-[1600px]:inline" aria-hidden="true">·</span>' +
        `<span class="inline-block">${LOCAL_ONLY_TEXT.replace("'", "&#x27;")}</span>` +
        "</footer>",
    );
  });

  test("names the provider when local-only mode is off", () => {
    expect(residencyText({ localOnly: false, provider: "exoscale" })).toBe(
      "Cloud model in use: our own open models on Exoscale (Switzerland), personal data only in a consented pilot.",
    );
    expect(residencyText({ localOnly: false, provider: "infomaniak" })).toBe(
      "Cloud model in use: Infomaniak (Switzerland).",
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
