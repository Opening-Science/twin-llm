import { describe, expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SCREEN_ERROR_COPY, ScreenError } from "./screen-error";

describe("ScreenError", () => {
  test("says what happened in plain words and never shows the error's message", () => {
    const quiet = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const error = Object.assign(
        new Error("relation threads does not exist at 10.0.0.4"),
        {
          digest: "1234",
        },
      );
      const html = renderToStaticMarkup(
        createElement(ScreenError, { error, reset: () => undefined }),
      );
      expect(html).toContain('role="alert"');
      expect(html).toContain(SCREEN_ERROR_COPY.title.replace("'", "&#x27;"));
      expect(html).toContain(SCREEN_ERROR_COPY.line);
      expect(html).toContain(">Try again</button>");
      expect(html).not.toContain("relation threads");
      expect(html).not.toContain("1234");
    } finally {
      quiet.mockRestore();
    }
  });
});
