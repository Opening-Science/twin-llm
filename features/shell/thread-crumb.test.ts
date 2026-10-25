import { describe, expect, test } from "bun:test";

import { threadCrumb } from "./thread-crumb";

describe("threadCrumb", () => {
  test("no title, or a blank one, falls back to Thread", () => {
    expect(threadCrumb(undefined)).toEqual({ label: "Thread" });
    expect(threadCrumb("")).toEqual({ label: "Thread" });
    expect(threadCrumb("  \n\t ")).toEqual({ label: "Thread" });
  });

  test("whitespace and newlines collapse to single spaces", () => {
    expect(threadCrumb("  Sleep\n\nand   HRV ")).toEqual({
      label: "Sleep and HRV",
      full: "Sleep and HRV",
    });
  });

  test("exactly 60 characters is kept whole", () => {
    const sixty = "a".repeat(60);
    expect(threadCrumb(sixty)).toEqual({ label: sixty, full: sixty });
  });

  test("61 characters is cut to 59 plus an ellipsis", () => {
    const sixtyOne = "a".repeat(61);
    expect(threadCrumb(sixtyOne)).toEqual({
      label: `${"a".repeat(59)}…`,
      full: sixtyOne,
    });
  });

  test("a cut that lands after a space does not leave the space before the ellipsis", () => {
    const title = `${"a".repeat(58)} bcdef`;
    expect(threadCrumb(title)).toEqual({ label: `${"a".repeat(58)}…`, full: title });
  });
});
