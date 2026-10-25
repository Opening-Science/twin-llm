import { describe, expect, test } from "bun:test";

import * as anatomyCopy from "./anatomy-copy";
import * as demoCopy from "./demo-copy";

/**
 * Copy the page shows never names a developer command (D6). Only the API
 * responses, which developers read, may say how to install the files.
 */
const uiStrings = (module: Readonly<Record<string, unknown>>) =>
  Object.entries(module).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && !entry[0].endsWith("_API"),
  );

describe("anatomy and demo UI copy", () => {
  test("no string shown on the page names a command", () => {
    const offenders = [...uiStrings(anatomyCopy), ...uiStrings(demoCopy)]
      .filter(([, text]) => /bun run|anatomy:fetch/.test(text))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  test("the not-installed and load-error lines read plainly", () => {
    expect(anatomyCopy.ANATOMY_NOT_INSTALLED).toBe(
      "Reference anatomy is not available here.",
    );
    expect(demoCopy.DEMO_LOAD_ERROR).toBe("Could not load the demo body.");
  });

  test("the API responses keep the install hint", () => {
    expect(anatomyCopy.ANATOMY_NOT_INSTALLED_API).toBe(
      "Anatomy atlas not installed. Run bun run anatomy:fetch.",
    );
    expect(demoCopy.DEMO_NOT_INSTALLED_API).toBe(
      "Demo body not installed. Run bun run anatomy:fetch.",
    );
  });

  test("demo body heights go through format-measure", () => {
    expect(demoCopy.DEMO_SEX_LABEL).toEqual({
      male: "Male · ANNY adult · 1.91 m",
      female: "Female · ANNY adult · 1.77 m",
    });
  });
});
