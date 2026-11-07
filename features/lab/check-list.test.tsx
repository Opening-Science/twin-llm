import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CheckDetail, CommandBlock } from "./check-detail";
import { CheckList } from "./check-list";
import { checkHref, type LabCheck } from "./lab-check";

/** The visible text of an element, its parts joined by `|`. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|")
    .replace(/^\||\|$/g, "");

describe("checkHref", () => {
  test("a check's page is under the list", () => {
    expect(checkHref("audit-chain")).toBe("/lab/checks/audit-chain");
  });
});

describe("CheckList", () => {
  test("one row per check: its state in words, its title, a link to its page", () => {
    const html = renderToStaticMarkup(
      <CheckList
        checks={[
          { id: "local-only", title: "Local only", status: "ok" },
          { id: "sbom", title: "Software bill of materials", status: "not-ok" },
          {
            id: "provenance",
            title: "Provenance",
            status: "unknown",
            reason: "This build has no git commit recorded.",
          },
        ]}
      />,
    );
    const rows = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map((m) => [
      /href="([^"]+)"/.exec(m[1] ?? "")?.[1],
      textOf(m[2] ?? ""),
    ]);
    expect(rows).toEqual([
      ["/lab/checks/local-only", "OK|Local only"],
      ["/lab/checks/sbom", "Not OK|Software bill of materials"],
      [
        "/lab/checks/provenance",
        "Unknown|Provenance|This build has no git commit recorded.",
      ],
    ]);
    expect(html.match(/data-tone="(\w+)"/g)).toEqual([
      'data-tone="ok"',
      'data-tone="warn"',
      'data-tone="neutral"',
    ]);
  });
});

const CHECK: LabCheck = {
  id: "local-storage",
  title: "Local storage",
  status: "unknown",
  reason: "Could not check: Database role.",
  summary: "Synthetic mode.",
  evidence: [],
  table: {
    caption: "Storage checks",
    columns: ["Item", "Found", "Fix"],
    rows: [[".env.local", "mode 644", "chmod 600 .env.local"]],
  },
  howTo: "bun run lab:storage\n\nstat -c '%a' .env.local",
};

describe("CheckDetail (#483)", () => {
  test("an Unknown says why beside its badge", () => {
    const html = renderToStaticMarkup(<CheckDetail check={CHECK} />);
    const head = /<p\b[^>]*>(.*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(textOf(head)).toBe("Unknown|Could not check: Database role.");
  });

  test("an OK check has no reason line", () => {
    const { reason: _reason, ...rest } = CHECK;
    const html = renderToStaticMarkup(<CheckDetail check={{ ...rest, status: "ok" }} />);
    const head = /<p\b[^>]*>(.*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(textOf(head)).toBe("OK");
  });

  test("each table cell carries its column, so a phone can label it", () => {
    const html = renderToStaticMarkup(<CheckDetail check={CHECK} />);
    const cells = [...html.matchAll(/<td data-label="([^"]+)">([^<]*)<\/td>/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(cells).toEqual([
      ["Found", "mode 644"],
      ["Fix", "chmod 600 .env.local"],
    ]);
  });
});

describe("CommandBlock", () => {
  test("one element per shell line, blank lines kept, text unchanged", () => {
    const html = renderToStaticMarkup(
      <CommandBlock label="Command" text={CHECK.howTo} />,
    );
    const lines = [...html.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(lines).toEqual([
      "bun run lab:storage",
      "",
      "stat -c &#x27;%a&#x27; .env.local",
    ]);
  });
});
