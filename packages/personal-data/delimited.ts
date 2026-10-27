/**
 * CSV and TSV text to rows of fields (RFC 4180: quoted fields, `""` inside
 * quotes, CRLF or LF). Pure. Blank lines are dropped. A quote left open at
 * the end of the file is an error rather than a guess at where it closes.
 */

export type Delimiter = "," | "\t" | ";";

export type DelimitedResult =
  | Readonly<{ ok: true; rows: readonly (readonly string[])[] }>
  | Readonly<{ ok: false; line: number }>;

/** Tab when the header line has a tab, else semicolon when it has more of those than commas, else comma. */
export const detectDelimiter = (text: string): Delimiter => {
  const end = text.indexOf("\n");
  const header = end === -1 ? text : text.slice(0, end);
  if (header.includes("\t")) return "\t";
  const count = (char: string) => header.split(char).length - 1;
  return count(";") > count(",") ? ";" : ",";
};

const isBlank = (row: readonly string[]): boolean =>
  row.length === 1 && row[0]!.trim() === "";

export const parseDelimited = (text: string, delimiter: Delimiter): DelimitedResult => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let quoteLine = 1;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (!isBlank(row)) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      quoteLine = line;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n") {
      endRow();
      line += 1;
    } else if (char === "\r") {
      if (text[index + 1] !== "\n") {
        endRow();
        line += 1;
      }
    } else {
      field += char;
    }
  }
  if (quoted) return { ok: false, line: quoteLine };
  if (field !== "" || row.length > 0) endRow();
  return { ok: true, rows };
};
