/**
 * The citation in the `citation.txt` that comes with a GBD Results Tool
 * download (#417), as one line. The file opens with a line naming the tool
 * and one saying what to cite; the citation is every line after them. Pure.
 */

const PREAMBLE = [/^gbd results tool:?$/i, /^use the following to cite/i];

/** The citation as one line, or null when the text holds none. */
export const parseGbdCitation = (text: string): string | null => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const body = lines.filter((line) => !PREAMBLE.some((pattern) => pattern.test(line)));
  const citation = body.join(" ").replace(/\s+/g, " ").trim();
  return citation === "" ? null : citation;
};

/** The file a download's citation is in, next to its CSV files. */
export const GBD_CITATION_FILE = "citation.txt";
