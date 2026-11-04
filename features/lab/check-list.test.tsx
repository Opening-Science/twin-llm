import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CheckList } from "./check-list";
import { checkHref, STATUS_TONE } from "./lab-check";

describe("checkHref", () => {
  test("a check's page is under the list", () => {
    expect(checkHref("audit-chain")).toBe("/lab/checks/audit-chain");
  });
});

describe("STATUS_TONE", () => {
  test("Not OK warns, OK is the ok tone, Unknown stays neutral", () => {
    expect(STATUS_TONE).toEqual({ ok: "ok", "not-ok": "warn", unknown: "neutral" });
  });
});

describe("CheckList", () => {
  test("one row per check: its state in words, its title, a link to its page", () => {
    const html = renderToStaticMarkup(
      <CheckList
        checks={[
          { id: "local-only", title: "Local only", status: "ok" },
          { id: "sbom", title: "Software bill of materials", status: "not-ok" },
          { id: "provenance", title: "Provenance", status: "unknown" },
        ]}
      />,
    );
    const rows = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map((m) => [
      /href="([^"]+)"/.exec(m[1] ?? "")?.[1],
      m[2]
        ?.replace(/<[^>]+>/g, "|")
        .replace(/\|+/g, "|")
        .replace(/^\||\|$/g, ""),
    ]);
    expect(rows).toEqual([
      ["/lab/checks/local-only", "OK|Local only"],
      ["/lab/checks/sbom", "Not OK|Software bill of materials"],
      ["/lab/checks/provenance", "Unknown|Provenance"],
    ]);
    expect(html.match(/data-tone="(\w+)"/g)).toEqual([
      'data-tone="ok"',
      'data-tone="warn"',
      'data-tone="neutral"',
    ]);
  });
});
