import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import { OFFLINE_SENTENCE, UNAVAILABLE_SENTENCE } from "./models-copy";
import { ModelsScreen, type ModelsScreenProps } from "./models-screen";
import { ModelsSkeleton } from "./models-skeleton";

const LLAMA: CatalogModel = {
  id: "llama3.2",
  name: "Llama 3.2",
  provider: "Ollama",
  providerId: "ollama",
  contextTokens: 128_000,
};

const render = (props: Partial<ModelsScreenProps>): string =>
  renderToStaticMarkup(
    createElement(ModelsScreen, {
      models: [LLAMA],
      offline: false,
      defaults: ["llama3.2"],
      provider: "ollama",
      ...props,
    }),
  );

describe("ModelsScreen", () => {
  test("lists each model with its window, the default tag and a real table", () => {
    const html = render({});
    expect(html).toContain('<h1 class="text-display">Models</h1>');
    expect(html).toContain(
      '<caption class="sr-only">Models available in TwinLLM, largest context window first.</caption>',
    );
    expect(html).toContain('<th scope="row"');
    expect(html).toContain('<span class="model-default-tag">default</span>');
    expect(html).toContain('<span class="font-mono text-sm font-bold">128K</span>');
    expect(html).toContain('style="width:100%"');
    expect(html).not.toContain("Offline");
  });

  test("marks the built-in fallback list as offline", () => {
    const html = render({ offline: true });
    expect(html).toContain(">Offline</span>");
    expect(html).toContain(OFFLINE_SENTENCE.replace("'", "&#x27;"));
  });

  test("an unknown per-call cost is a dash read as unknown", () => {
    const html = render({ provider: "exoscale" });
    expect(html).toContain(
      '<span aria-hidden="true">—</span><span class="sr-only">unknown</span>',
    );
  });

  test("no list: a sentence and a full reload, no table", () => {
    const html = render({ models: null });
    expect(html).toContain(UNAVAILABLE_SENTENCE);
    expect(html).toContain('href="/models"');
    expect(html).toContain(">Try again</a>");
    expect(html).not.toContain("<table");
  });
});

describe("ModelsSkeleton", () => {
  test("keeps the real heading and says it is loading once", () => {
    const html = renderToStaticMarkup(createElement(ModelsSkeleton));
    expect(html).toContain('<h1 class="text-display">Models</h1>');
    expect(html).toContain('<p role="status" class="sr-only">Loading the model list</p>');
    expect(html).toContain('aria-busy="true"');
  });
});
