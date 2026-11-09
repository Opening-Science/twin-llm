import { describe, expect, test } from "bun:test";

import { exportNoticeLine, exportStep, parseExportNotice } from "./export-notice";

describe("export notice (#531)", () => {
  test("a request is a check, a confirmed export, or neither", () => {
    expect(exportStep(new URLSearchParams("check=1"))).toBe("check");
    expect(exportStep(new URLSearchParams("format=print&confirm=1"))).toBe("confirmed");
    expect(exportStep(new URLSearchParams("format=fhir"))).toBe("unconfirmed");
    expect(exportStep(new URLSearchParams("confirm=yes"))).toBe("unconfirmed");
  });

  test("the line names kinds and counts only", () => {
    expect(
      exportNoticeLine({
        matches: [
          { kind: "lab value", count: 2 },
          { kind: "twin note line", count: 1 },
        ],
      }),
    ).toBe("This export contains: 2 lab values, 1 twin note line. Download anyway?");
    expect(exportNoticeLine({ matches: [] })).toBe(
      "No stored values were found in this export. Download it?",
    );
    expect(exportNoticeLine(undefined)).toBe(
      "This export could not be checked for stored values. Download anyway?",
    );
  });

  test("only a known status with a line is read back", () => {
    expect(parseExportNotice({ status: "ready", line: "x" })).toEqual({
      status: "ready",
      line: "x",
    });
    expect(parseExportNotice({ status: "sent", line: "x" })).toBe(null);
    expect(parseExportNotice(null)).toBe(null);
  });
});
