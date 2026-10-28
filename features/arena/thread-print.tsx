import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * A thread's Markdown export as one standalone page laid out for paper, which
 * opens the browser's print dialog: "Save as PDF" there is the PDF export
 * (#213). Nothing leaves the machine and no PDF library is needed. Same
 * content as the Markdown and FHIR exports.
 */

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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

export const threadPrintHtml = (markdown: string, title: string): string => {
  const body = renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<p class="screen-only">Choose "Save as PDF" in the print dialog to keep this thread as a PDF.</p>
${body}
<script>window.addEventListener("load", () => window.print());</script>
</body>
</html>
`;
};
