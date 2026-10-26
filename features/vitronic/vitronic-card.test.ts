import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { emptySetup } from "@/features/connectors/fixtures/setup-fixture";

import { VitronicCard } from "./vitronic-card";
import type { VitronicStatusPayload } from "./vitronic-status-view";

const html = (preview: VitronicStatusPayload | "failed") =>
  renderToStaticMarkup(
    createElement(VitronicCard, { preview, setup: emptySetup("bodyloop") }),
  );

describe("VitronicCard", () => {
  test("renders not configured", () => {
    const markup = html({
      configured: false,
      connected: false,
      lastSyncAt: null,
      hasAvatar: false,
    });
    expect(markup).toContain("BodyLoop");
    expect(markup).toContain("Not configured");
    expect(markup).toContain("Not a statement about a person.");
    expect(markup).toContain(
      '<code class="setup-code">VITRONIC_TOKEN_ENCRYPTION_KEY</code>',
    );
  });

  test("renders connected with last sync", () => {
    const markup = html({
      configured: true,
      connected: true,
      lastSyncAt: "2026-07-10T12:00:00.000Z",
      hasAvatar: true,
      tlsFingerprintPrefix: "a1b2c3d4e5f6",
    });
    expect(markup).toContain("Connected");
    expect(markup).toMatch(/Synced \d+ d ago · TLS pin a1b2c3d4e5f6/);
    expect(markup).not.toContain("2026-07-10T12:00:00.000Z");
    expect(markup).not.toContain('name="apiToken"');
  });
});

describe("VitronicCard connection form", () => {
  const form = html({
    configured: true,
    connected: false,
    lastSyncAt: null,
    hasAvatar: false,
    signedIn: true,
  });

  test("every input has a visible label bound by for/id", () => {
    const labels = [...form.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>/g)];
    expect(labels.map((m) => m[2])).toEqual([
      "Scanner URL",
      "API token",
      "Scan key",
      "Token name",
      "Upload secret",
    ]);
    for (const [, id] of labels) expect(form).toContain(`id="${id}"`);
  });

  test("shows Not connected as a neutral badge and keeps a native submit button", () => {
    expect(form).toContain('data-tone="neutral"');
    expect(form).toContain("Not connected");
    expect(form).toMatch(/<button type="submit"[^>]*>Save connection<\/button>/);
  });
});

describe("VitronicCard status request failure", () => {
  test("shows the Error badge and a plain sentence, not a skeleton", () => {
    const markup = html("failed");
    expect(markup).toContain('data-tone="warn"');
    expect(markup).toContain(">Error<");
    expect(markup).toContain(
      "Couldn’t read the BodyLoop status. Reload the page to try again.",
    );
    expect(markup).not.toContain("Loading BodyLoop status");
    expect(markup).not.toContain('name="apiToken"');
  });
});
