import { describe, expect, test } from "bun:test";

import { firstLinkedSource, linkedSources } from "./linked-source";

const none = { oura: false, whoop: false, "google-health": false } as const;

describe("linkedSources", () => {
  test("lists the linked wearables in the connector order", () => {
    expect(linkedSources({ oura: true, whoop: false, "google-health": true })).toEqual([
      "oura",
      "google-health",
    ]);
    expect(linkedSources(none)).toEqual([]);
  });
});

describe("firstLinkedSource", () => {
  test("the asked-for source when it is linked", () => {
    expect(firstLinkedSource({ ...none, oura: true, whoop: true }, "whoop")).toBe(
      "whoop",
    );
    expect(
      firstLinkedSource({ ...none, oura: true, "google-health": true }, "google-health"),
    ).toBe("google-health");
  });

  test("otherwise the first linked one, Oura before WHOOP before Google Health", () => {
    expect(firstLinkedSource({ ...none, whoop: true }, "oura")).toBe("whoop");
    expect(firstLinkedSource({ ...none, "google-health": true }, "whoop")).toBe(
      "google-health",
    );
    expect(firstLinkedSource({ ...none, oura: true, whoop: true }, "google-health")).toBe(
      "oura",
    );
  });

  test("Oura when nothing is linked", () => {
    expect(firstLinkedSource(none, "whoop")).toBe("oura");
  });
});
