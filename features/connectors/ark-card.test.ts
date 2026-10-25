import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ARK_CARD_HREF,
  ArkCard,
  type ArkStatusOk,
  type ArkStatusUnavailable,
} from "./ark-card";
import { emptySetup } from "./setup-fixture";

const ok = (overrides?: Partial<ArkStatusOk>): ArkStatusOk => ({
  enabled: true,
  state: "ok",
  serial: "alpha-002",
  hardware: { model: "Ark I", version: "0.5.0", revision: "4035-1030" },
  firmware: "0.11.6-924f716",
  trust: "attested",
  paired: true,
  unlocked: true,
  slots: [
    {
      slot: "reference-genome",
      name: "Reference genome",
      state: "filled",
      build: null,
      version: null,
    },
    {
      slot: "gene-annotations",
      name: "Gene annotations",
      state: "empty",
      build: null,
      version: null,
    },
    {
      slot: "snp-indel-calls",
      name: "SNP and indel calls",
      state: "empty",
      build: null,
      version: null,
    },
    {
      slot: "variant-catalog",
      name: "Variant catalog",
      state: "empty",
      build: null,
      version: null,
    },
  ],
  pathCount: 3,
  allGenome: true,
  ...overrides,
});

const unavailable = (
  state: ArkStatusUnavailable["state"],
  code: string,
): ArkStatusUnavailable => ({
  enabled: true,
  state,
  error: { code },
});

const html = (preview: Parameters<typeof ArkCard>[0]["preview"]) =>
  renderToStaticMarkup(createElement(ArkCard, { preview, setup: emptySetup("ark") }));

describe("ArkCard", () => {
  test("shows Not configured with the GENOME_SOURCE setup when disabled", () => {
    const markup = html({ enabled: false });
    expect(markup).toContain(">Not configured<");
    expect(markup).toContain('data-tone="off"');
    expect(markup).toContain('<code class="setup-code">GENOME_SOURCE</code>');
    expect(markup).toContain('<code class="setup-code">ARK_DEVICE</code>');
  });

  test("renders the ready inventory", () => {
    const markup = html(ok());
    expect(markup).toContain("Ready");
    expect(markup).toContain("Ark I");
    expect(markup).toContain("0.5.0");
    expect(markup).toContain("0.11.6-924f716");
    expect(markup).toContain("attested");
    expect(markup).toContain("Paired");
    expect(markup).toContain("Unlocked");
    expect(markup).toContain("Reference genome");
    expect(markup).toContain("Filled");
    expect(markup).toContain("Gene annotations");
    expect(markup).toContain("Empty");
    expect(markup).toContain("SNP and indel calls");
    expect(markup).toContain("Variant catalog");
    expect(markup).toContain("3 readable paths, all under v1/genome");
  });

  test("renders busy with the Hub hint", () => {
    const markup = html(unavailable("busy", "device-busy"));
    expect(markup).toContain("Busy");
    expect(markup).toContain("Close the Ark Hub tab");
    expect(markup).not.toContain("readable paths");
  });

  test("renders locked", () => {
    expect(html(unavailable("locked", "locked"))).toContain("Locked");
  });

  test("renders unpaired", () => {
    expect(html(unavailable("unpaired", "not-paired"))).toContain("Not paired");
  });

  test("renders awaiting approval", () => {
    expect(html(unavailable("awaiting_approval", "approval-timeout"))).toContain(
      "Waiting for approval",
    );
  });

  test("renders refused", () => {
    expect(html(unavailable("refused", "approval-denied"))).toContain("Declined");
  });

  test("renders error", () => {
    expect(html(unavailable("error", "unknown-exit"))).toContain("Unavailable");
  });

  test("links to /digital-twin in every visible state", () => {
    const visible = [
      html(ok()),
      html(unavailable("busy", "device-busy")),
      html(unavailable("locked", "locked")),
      html(unavailable("unpaired", "not-paired")),
      html(unavailable("awaiting_approval", "approval-timeout")),
      html(unavailable("refused", "approval-denied")),
      html(unavailable("error", "unknown-exit")),
    ];
    for (const markup of visible) {
      expect(markup).toContain(`href="${ARK_CARD_HREF}"`);
    }
    expect(html({ enabled: false })).not.toContain(`href="${ARK_CARD_HREF}"`);
    expect(ARK_CARD_HREF).toBe("/digital-twin");
  });
});

describe("ArkCard status badge", () => {
  test("ready is Connected, locked Not connected, declined and errors are Error", () => {
    expect(html(ok())).toContain(">Connected<");
    expect(html(unavailable("locked", "locked"))).toContain(">Not connected<");
    expect(html(unavailable("refused", "refused"))).toContain(">Error<");
    expect(html(ok())).toContain('data-tone="ok"');
    expect(html(unavailable("locked", "locked"))).toContain('data-tone="neutral"');
    expect(html(unavailable("refused", "refused"))).toContain('data-tone="warn"');
    expect(html(unavailable("error", "unreachable"))).toContain('data-tone="warn"');
  });
});

describe("ArkCard status request failure", () => {
  test("shows the Error badge and a plain sentence, not a skeleton", () => {
    const markup = html("failed");
    expect(markup).toContain('data-tone="warn"');
    expect(markup).toContain(">Error<");
    expect(markup).toContain(
      "Couldn’t read the Ark status. Reload the page to try again.",
    );
    expect(markup).not.toContain("Loading Ark status");
  });
});
