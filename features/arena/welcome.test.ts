import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { INCOGNITO_BANNER } from "@/infrastructure/incognito";

import { Welcome } from "./welcome";

const render = (incognito: boolean, withToggle = true): string =>
  renderToStaticMarkup(
    createElement(Welcome, {
      incognito,
      onToggleIncognito: withToggle ? () => undefined : undefined,
    }),
  );

const toggleOf = (markup: string): string =>
  /<button[^>]*aria-label="Incognito chat"[^>]*>/.exec(markup)?.[0] ?? "";

describe("the empty new chat", () => {
  test("in incognito mode the banner shows and the toggle is pressed", () => {
    const markup = render(true);
    expect(markup).toContain(`<p class="incognito-banner">`);
    expect(markup).toContain(`<span>${INCOGNITO_BANNER}</span>`);
    expect(toggleOf(markup)).toContain('aria-pressed="true"');
    expect(toggleOf(markup)).toContain('title="Turn incognito off"');
  });

  test("a normal new chat has no banner and the toggle is not pressed", () => {
    const markup = render(false);
    expect(markup.includes("incognito-banner")).toBe(false);
    expect(toggleOf(markup)).toContain('aria-pressed="false"');
    expect(toggleOf(markup)).toContain('title="Start an incognito chat"');
  });

  test("without a toggle handler there is no switch", () => {
    expect(toggleOf(render(false, false))).toBe("");
  });

  test("the banner text is the agreed sentence", () => {
    expect(INCOGNITO_BANNER).toBe(
      "Incognito chat. Not saved, not in your threads or search, local models only.",
    );
  });
});
