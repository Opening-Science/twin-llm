import { describe, expect, test } from "bun:test";

import { SEARCH_COPY } from "./search-copy";
import { SEARCH_TABS } from "./search-model";

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : typeof value === "object" && value !== null
      ? Object.values(value).flatMap(strings)
      : [];

describe("SEARCH_COPY", () => {
  test("English keeps the box's words, the tab names in order", () => {
    expect(SEARCH_TABS.map((tab) => SEARCH_COPY.en.tabs[tab])).toEqual([
      "All",
      "Threads",
      "Pages",
      "Docs",
      "Commands",
    ]);
    expect(SEARCH_COPY.en.placeholder).toBe("Search threads, pages, docs and commands");
  });

  test("German has every entry, none left in English", () => {
    const en = strings(SEARCH_COPY.en);
    const de = strings(SEARCH_COPY.de);
    expect(de.length).toBe(en.length);
    de.forEach((text, index) => {
      expect(text.trim()).not.toBe("");
      expect(text).not.toBe(en[index]);
    });
  });

  test("the German privacy line says no more than the English one", () => {
    // Own threads only, matched locally: the same two claims, nothing added.
    expect(SEARCH_COPY.de.privacy).toBe(
      "Nur deine eigenen Unterhaltungen. Abgeglichen auf diesem Rechner.",
    );
  });
});
