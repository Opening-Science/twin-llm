import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RESEARCH_FOOTER_SHORT,
  RESEARCH_FOOTER_TEXT,
  ResearchFooter,
  residencySentence,
} from "./research-footer";

describe("research footer (binding text)", () => {
  test("the research sentence and the phone line", () => {
    expect(RESEARCH_FOOTER_TEXT).toBe(
      "Research-use visualisation only. This tool presents supplied data and model output and does not provide medical advice.",
    );
    expect(RESEARCH_FOOTER_SHORT).toBe("Research use only, not clinical advice.");
  });

  test("the residency sentence follows the server's settings", () => {
    const sentence = (provider: string, localOnly = false) =>
      residencySentence({ localOnly, provider });
    expect(sentence("ollama", true)).toBe(
      "Local only: models and storage run on this machine. Wearable syncs download from each vendor's cloud.",
    );
    expect(sentence("exoscale")).toBe(
      "Cloud model in use: our own open models on Exoscale (Switzerland), personal data only in a consented pilot.",
    );
    expect(sentence("ollama")).toBe("Model served by Ollama at the configured address.");
    expect(sentence("infomaniak")).toBe(
      "Cloud model in use: Infomaniak (Switzerland, synthetic data only).",
    );
    expect(sentence("openrouter")).toBe(
      "Cloud model in use: OpenRouter (synthetic data only).",
    );
    expect(sentence("remote-gpu")).toBe(
      "Model served on a remote GPU through an SSH tunnel (synthetic data only).",
    );
  });

  test("without residency the research sentence stands alone", () => {
    const html = renderToStaticMarkup(createElement(ResearchFooter));
    expect(html).toBe(
      `<footer class="research-footer"><p class="hidden sm:block"><span class="research-footer-half">${RESEARCH_FOOTER_TEXT}</span></p><details class="research-footer-phone sm:hidden"><summary>${RESEARCH_FOOTER_SHORT} <span class="research-footer-more">More</span><span class="research-footer-less">Less</span></summary><p class="mt-1">${RESEARCH_FOOTER_TEXT}</p></details></footer>`,
    );
  });

  test("with residency both halves show, the dot hidden from screen readers", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchFooter, {
        residency: { localOnly: false, provider: "openrouter" },
      }),
    );
    expect(html).toContain(
      `<span class="research-footer-half">${RESEARCH_FOOTER_TEXT}</span><span aria-hidden="true" class="research-footer-dot"> · </span> <span class="research-footer-half">Cloud model in use: OpenRouter (synthetic data only).</span>`,
    );
    expect(html).toContain(
      `<p class="mt-1">${RESEARCH_FOOTER_TEXT} Cloud model in use: OpenRouter (synthetic data only).</p>`,
    );
  });
});
