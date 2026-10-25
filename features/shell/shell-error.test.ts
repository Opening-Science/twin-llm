import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ShellError from "@/app/(shell)/error";

describe("ShellError", () => {
  test("Try again is the UI-kit secondary button", () => {
    const html = renderToStaticMarkup(
      createElement(ShellError, { error: new Error("synthetic"), reset: () => {} }),
    );
    expect(html).toContain(
      '<button type="button" class="inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 rounded-lg px-3 py-1.5 text-sm border-input hover:bg-muted border mt-3">Try again</button>',
    );
    expect(html).not.toContain("synthetic");
  });
});
