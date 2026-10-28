/**
 * A thread's Markdown export as one standalone page laid out for paper, which
 * opens the browser's print dialog: "Save as PDF" there is the PDF export
 * (#213). Nothing leaves the machine and no PDF library is needed. Same
 * content as the Markdown and FHIR exports.
 *
 * The Markdown is the export's own (`thread-markdown.ts`): headings, bullet
 * lists, paragraphs and simple emphasis, plus model text inside answers. A
 * small converter covers that; everything is escaped first, so model text can
 * never become markup. (`react-dom/server` is not allowed in a route.)
 */

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Escaped text with **bold**, _em_ or *em*, and `code`. */
const inline = (text: string): string =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])[_*]([^_*]+)[_*](?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");

/** Pure: the export's Markdown as HTML body content. */
export const markdownToHtml = (markdown: string): string => {
  const out: string[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    if (list.length > 0)
      out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    paragraph = [];
    list = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item?.[1] !== undefined) {
      if (paragraph.length > 0) flush();
      list.push(item[1]);
    } else if (line.trim() === "") {
      flush();
    } else {
      if (list.length > 0) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return out.join("\n");
};

const PRINT_CSS = `
  @page { size: A4; margin: 16mm 15mm; }
  html { color-scheme: light; }
  body { margin: 0 auto; max-width: 46rem; padding: 24px; color: #1d1d1d; background: #fff;
    font: 11pt/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 8pt; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; padding-top: 6pt; border-top: 1px solid #1d1d1d; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
  p, li { margin: 0 0 5pt; }
  ul { padding-left: 16pt; }
  em { color: #5d5c57; }
  code { font: 9.5pt ui-monospace, Menlo, monospace; }
  @media print { .screen-only { display: none; } }
  .screen-only { margin: 0 0 16pt; padding: 8pt 10pt; border-radius: 6px; background: #f4f3ee; font-size: 10pt; }
`;

export const threadPrintHtml = (
  markdown: string,
  title: string,
): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<p class="screen-only">Choose "Save as PDF" in the print dialog to keep this thread as a PDF.</p>
${markdownToHtml(markdown)}
<script>window.addEventListener("load", () => window.print());</script>
</body>
</html>
`;
