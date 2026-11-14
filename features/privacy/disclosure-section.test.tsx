import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import type { LedgerEntry } from "@/infrastructure/disclosure-ledger";

import { DisclosureSection } from "./disclosure-section";
import { ledgerView } from "./disclosure-view";

const ENTRY: LedgerEntry = {
  seq: 1n,
  ts: new Date(Date.UTC(2026, 9, 31, 14, 0)),
  kind: "hosted-model",
  direction: "sent",
  recipient: "remote-gpu (vLLM over SSH tunnel)",
  target: "synthetic-model",
  purpose: "chat answer",
  categories: ["question text"],
  refCount: 0,
  payloadBytes: 4200,
  threadId: null,
  synthetic: true,
  freeTextChecked: true,
  freeTextMatches: [],
};

const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");

describe("the totals per recipient fit the page (Customize · Privacy)", () => {
  const out = renderToStaticMarkup(
    <DisclosureSection view={ledgerView([ENTRY], [{ ...ENTRY, refs: [] }])} />,
  );

  test("every column is kept", () => {
    const headings = [...out.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headings).toEqual([
      "Recipient",
      "Direction",
      "Events",
      "Values",
      "Size",
      "Stored values in text",
      "First (UTC)",
      "Last (UTC)",
    ]);
  });

  test("the zone is in the heading, and a date cell stays on one line", () => {
    const dates = [...out.matchAll(/<td class="whitespace-nowrap">([^<]*)<\/td>/g)].map(
      (m) => m[1],
    );
    expect(dates).toEqual(["31 Oct 2026 14:00", "31 Oct 2026 14:00"]);
    // The table drops the zone; the event list below keeps its full timestamp.
    const table = out.slice(out.indexOf("<table"), out.indexOf("</table>"));
    expect(table).not.toContain("UTC</td>");
  });

  test("the recipient takes the wrapping, at the dots of a host name", () => {
    const host = renderToStaticMarkup(
      <DisclosureSection
        view={ledgerView(
          [{ ...ENTRY, recipient: "api.ouraring.com" }],
          [{ ...ENTRY, recipient: "api.ouraring.com", refs: [] }],
        )}
      />,
    );
    expect(host).toContain('<th scope="row">api.<wbr/>ouraring.<wbr/>com</th>');
  });

  test("the table wraps between words instead of scrolling sideways", () => {
    expect(out).toContain('class="lab-table-wrap lab-table-fit mt-4"');
    expect(css).toMatch(
      /\.lab-table-fit \.lab-table th,\s*\.lab-table-fit \.lab-table td \{\s*@apply px-2 whitespace-normal;/,
    );
    // Wrapping inside a word would let the columns shrink to a letter each.
    const rule = css.slice(css.indexOf(".lab-table-fit"));
    expect(rule.slice(0, rule.indexOf("}"))).not.toContain("anywhere");
  });
});
