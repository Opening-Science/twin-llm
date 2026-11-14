/**
 * The print page of a thread export (SPEC 9.4): a standalone, light-only
 * HTML page built from the Markdown export. Everything is escaped before
 * the few Markdown marks are turned into tags, so model text can never
 * become markup. The print dialog opens on load; "Save as PDF" there is the
 * PDF export.
 */

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** `**bold**`, `_em_` / `*em*` and `` `code` `` on already escaped text. */
const inline = (escaped: string): string =>
  escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])\*([^*]+)\*(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");

type Block =
  | Readonly<{ kind: "heading"; level: number; text: string }>
  | Readonly<{ kind: "list"; items: string[] }>
  | Readonly<{ kind: "paragraph"; lines: string[] }>;

const blocksOf = (markdown: string): Block[] => {
  const blocks: Block[] = [];
  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^-\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? "",
      });
    } else if (item !== null) {
      if (last?.kind === "list") last.items.push(item[1] ?? "");
      else blocks.push({ kind: "list", items: [item[1] ?? ""] });
    } else if (line.trim() === "") {
      blocks.push({ kind: "paragraph", lines: [] });
    } else if (last?.kind === "paragraph") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "paragraph", lines: [line] });
    }
  }
  return blocks;
};

const blockHtml = (block: Block): string => {
  if (block.kind === "heading") {
    return `<h${String(block.level)}>${inline(escapeHtml(block.text))}</h${String(block.level)}>`;
  }
  if (block.kind === "list") {
    return `<ul>${block.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join("")}</ul>`;
  }
  return block.lines.length === 0
    ? ""
    : `<p>${block.lines.map((line) => inline(escapeHtml(line))).join("<br>")}</p>`;
};

export const markdownBodyHtml = (markdown: string): string =>
  blocksOf(markdown)
    .map(blockHtml)
    .filter((html) => html !== "")
    .join("\n");

const STYLE = `
  :root { color-scheme: light; }
  @page { size: A4; margin: 18mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; background: #fff; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.2rem; margin-top: 2rem; } h3 { font-size: 1.05rem; } h4 { font-size: 1rem; }
  code { font-family: ui-monospace, monospace; font-size: 0.9em; }
  .screen-note { border: 1px solid #ccc; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.9rem; }
  @media print { .screen-note { display: none; } }
`;

export const printPage = (title: string, markdown: string): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    '<p class="screen-note">To keep a PDF, choose "Save as PDF" in the print dialog.</p>',
    markdownBodyHtml(markdown),
    "<script>window.addEventListener('load', () => window.print());</script>",
    "</body>",
    "</html>",
  ].join("\n");
