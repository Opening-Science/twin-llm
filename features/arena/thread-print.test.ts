import { describe, expect, test } from "bun:test";

import { threadPrintHtml } from "./thread-print";

describe("threadPrintHtml", () => {
  test("renders the Markdown as a page and escapes the title", () => {
    const html = threadPrintHtml(
      "# A <b>title</b>\n\n- Fitted a trend · 13 rows",
      'Say "hi" & <go>',
    );
    expect(html).toContain("<title>Say &#34;hi&#34; &#38; &#60;go&#62;</title>");
    expect(html).toContain("<li>Fitted a trend · 13 rows</li>");
    expect(html).not.toContain("<b>title</b>");
  });
});
