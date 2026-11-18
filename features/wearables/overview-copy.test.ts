import { describe, expect, test } from "bun:test";

import {
  OVERVIEW_LINK,
  OVERVIEW_PERIOD_LABEL,
  overviewEmptyText,
  overviewNoSnapshotText,
} from "./overview-copy";

describe("wearables overview copy", () => {
  test("with no wearable linked, it says how to link one", () => {
    expect(overviewEmptyText({ anyConfigured: true })).toBe(
      "No wearable is linked yet. Link Oura, WHOOP or Google Health under Customize · Connectors, and its daily, weekly and monthly cards show here.",
    );
  });

  test("with no app keys on this server, it says the keys come first", () => {
    expect(overviewEmptyText({ anyConfigured: false })).toBe(
      "No wearable is linked yet. Each one needs its app keys on this server first; Customize · Connectors lists which are missing, then links Oura, WHOOP or Google Health.",
    );
  });

  test("a linked wearable with nothing synced says so, by name", () => {
    expect(overviewNoSnapshotText("whoop")).toBe(
      "Whoop is linked, but nothing is synced yet. Refresh it under Customize · Connectors.",
    );
  });

  test("the link and the period switch", () => {
    expect(OVERVIEW_LINK).toEqual({
      href: "/customize/connectors",
      label: "Link a wearable",
    });
    expect(OVERVIEW_PERIOD_LABEL).toBe("Period");
  });
});
