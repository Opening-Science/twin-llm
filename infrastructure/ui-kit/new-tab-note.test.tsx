import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NEW_TAB_NOTE, NewTabNote } from "./new-tab-note";

describe("NewTabNote", () => {
  test("is hidden on screen and says the link opens a new tab", () => {
    expect(renderToStaticMarkup(<NewTabNote />)).toBe(
      `<span class="sr-only">${NEW_TAB_NOTE}</span>`,
    );
    expect(NEW_TAB_NOTE).toBe(" (opens in a new tab)");
  });
});
