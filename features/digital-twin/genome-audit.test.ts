import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GenomeAudit, type GenomeAuditEvent } from "./genome-audit";

const events: readonly GenomeAuditEvent[] = [
  {
    seq: "41",
    tool: "ark.status",
    ts: "2026-09-27T12:00:00.000Z",
    hash8: "abcdef01",
  },
  {
    seq: "40",
    tool: "ark.data.list",
    ts: "2026-09-27T11:59:00.000Z",
    hash8: "12345678",
  },
];

describe("GenomeAudit", () => {
  test("renders preview events", () => {
    const markup = renderToStaticMarkup(createElement(GenomeAudit, { preview: events }));
    expect(markup).toContain("ark.status");
    expect(markup).toContain("ark.data.list");
    expect(markup).toContain("abcdef01");
    expect(markup).toContain("12345678");
    expect(markup).toContain("41");
    expect(markup).not.toContain("No recent Ark reads");
  });

  test("times read as en-GB UTC timestamps, a bad one as a dash", () => {
    const markup = renderToStaticMarkup(
      createElement(GenomeAudit, {
        preview: [...events, { seq: "39", tool: "ark.status", ts: "soon", hash8: "0" }],
      }),
    );
    expect(markup).toContain("27 Sep 2026, 12:00 UTC");
    expect(markup).toContain("27 Sep 2026, 11:59 UTC");
    expect(markup).not.toContain("2026-09-27");
    expect(markup).not.toContain("soon");
    expect(markup).toContain("—");
  });

  test("renders the empty state", () => {
    const markup = renderToStaticMarkup(createElement(GenomeAudit, { preview: [] }));
    expect(markup).toContain("No recent Ark reads");
  });
});
