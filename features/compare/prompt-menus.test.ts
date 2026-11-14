import { describe, expect, test } from "bun:test";

import {
  IMPORT_FILE,
  matchSources,
  mentionQuery,
  slashQuery,
  sourceKey,
  sourceOptions,
  withCommand,
  withMention,
} from "./prompt-menus";

describe("the `/` palette opens only on a whole-box `/word` (SPEC 3.3)", () => {
  test("queries", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/sle")).toBe("sle");
    expect(slashQuery("/sleep last week")).toBeNull();
    expect(slashQuery("how /sleep")).toBeNull();
  });

  test("picking a skill writes it with a space", () => {
    expect(withCommand("sleep")).toBe("/sleep ");
  });
});

describe("the `@` sources list", () => {
  const facts = { imported: true, genome: false, live: ["pubmed" as const] };

  test("opens on an `@word` at the end", () => {
    expect(mentionQuery("Compare with @")).toBe("");
    expect(mentionQuery("Compare with @Ou")).toBe("Ou");
    expect(mentionQuery("mail@example")).toBeNull();
    expect(mentionQuery("@Oura and more")).toBeNull();
  });

  test("lists linked wearables, imported data, live sources, then Import a file", () => {
    expect(
      sourceOptions(facts, { oura: true, whoop: false, googleHealth: true }).map(
        ({ name }) => name,
      ),
    ).toEqual(["Oura", "Google Health", "Imported data", "PubMed", "Import a file"]);
  });

  test("matches names with spaces removed and writes the mention", () => {
    const options = sourceOptions(facts, {
      oura: false,
      whoop: false,
      googleHealth: true,
    });
    const [google] = matchSources("googleh", options);
    expect(google?.name).toBe("Google Health");
    expect(withMention("Steps from @googleh", google ?? IMPORT_FILE)).toBe(
      "Steps from @GoogleHealth ",
    );
  });

  test("keys: arrows move, Enter and Tab pick, Escape closes", () => {
    expect(sourceKey("ArrowDown", 2, 3)).toEqual({ kind: "move", index: 0 });
    expect(sourceKey("ArrowUp", 0, 3)).toEqual({ kind: "move", index: 2 });
    expect(sourceKey("Tab", 0, 3)).toBe("pick");
    expect(sourceKey("Enter", 0, 3)).toBe("pick");
    expect(sourceKey("Escape", 0, 0)).toBe("close");
    expect(sourceKey("Enter", 0, 0)).toBeNull();
  });
});
