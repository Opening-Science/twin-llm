import { describe, expect, test } from "bun:test";

import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  test("writes numbers as they are and leaves missing values empty", () => {
    expect(csvCell(0.125)).toBe("0.125");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });

  test("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  test("keeps a spreadsheet from running a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-0.5")).toBe("-0.5");
    expect(csvCell("-x")).toBe("'-x");
  });
});

describe("toCsv", () => {
  test("joins a header and rows with CRLF", () => {
    expect(
      toCsv(
        ["run", "rate"],
        [
          ["r1", 0.5],
          ["r,2", null],
        ],
      ),
    ).toBe('run,rate\r\nr1,0.5\r\n"r,2",\r\n');
  });
});
