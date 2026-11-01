import { describe, expect, test } from "bun:test";

import { promptToken, withMention } from "./prompt-tokens";

describe("promptToken (#366)", () => {
  test("a slash opens commands only while the whole prompt is one /word", () => {
    expect(promptToken("/")).toEqual({ kind: "slash", query: "", start: 0 });
    expect(promptToken("/Sle")).toEqual({ kind: "slash", query: "sle", start: 0 });
    expect(promptToken("/sleep last")).toBeNull();
    expect(promptToken("how /sleep")).toBeNull();
  });

  test("an at sign opens sources at the start of the last word", () => {
    expect(promptToken("@")).toEqual({ kind: "at", query: "", start: 0 });
    expect(promptToken("How did my @Oura")).toEqual({
      kind: "at",
      query: "oura",
      start: 11,
    });
    expect(promptToken("First line\n@who")).toEqual({
      kind: "at",
      query: "who",
      start: 11,
    });
    expect(promptToken("mail@example")).toBeNull();
    expect(promptToken("@oura!")).toBeNull();
    expect(promptToken("@oura and more")).toBeNull();
  });
});

describe("withMention", () => {
  test("replaces the word being typed with the source's name, joined", () => {
    const draft = "How did my @go";
    const token = promptToken(draft);
    if (token === null) throw new Error("no token");
    expect(withMention(draft, token, "Google Health")).toBe("How did my @GoogleHealth ");
  });
});
