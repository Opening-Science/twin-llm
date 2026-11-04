import { describe, expect, test } from "bun:test";

import { composerInsetClass, threadGridClass } from "./panel-layout";

describe("thread columns with the Outputs panel", () => {
  test("without a panel there is one column and no inset", () => {
    expect(threadGridClass(false, false)).toBe("flex-1 px-4 py-6 sm:px-6");
    expect(composerInsetClass(false, true)).toBe("");
  });

  test("the composer leaves room for the narrow panel", () => {
    expect(threadGridClass(true, false)).toBe(
      "flex-1 px-4 py-6 sm:px-6 xl:grid xl:items-start xl:gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]",
    );
    expect(composerInsetClass(true, false)).toBe("xl:pr-[calc(18rem+3rem)]");
  });

  test("and for the enlarged one", () => {
    expect(threadGridClass(true, true)).toBe(
      "flex-1 px-4 py-6 sm:px-6 xl:grid xl:items-start xl:gap-6 xl:grid-cols-[minmax(0,1fr)_30rem]",
    );
    expect(composerInsetClass(true, true)).toBe("xl:pr-[calc(30rem+3rem)]");
  });
});
