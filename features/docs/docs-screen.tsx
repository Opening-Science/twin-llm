import Link from "next/link";
import type { ReactElement } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { htmlLang, type Locale } from "@/infrastructure/locale/locale";

import { rehypeDocTables } from "./doc-tables";
import { DOCS_COPY } from "./docs-copy";
import { renderedByText } from "./docs-cache";
import { type DocPage, rewriteDocUrl } from "./docs-pages";
import { rehypeHeadingIds } from "./heading-ids";

/**
 * The docs index and one rendered page. Markdown comes from the repository's
 * own `docs/` folder, so links between pages are rewritten to `/docs/...`
 * before the usual URL check, headings get GitHub's anchors as ids, and
 * `.doc-prose` in `globals.css` styles the output.
 */

const FRAME = "page-reading page-stack";

/**
 * Rendered Markdown per page and link style, kept for the life of the module:
 * one process in production, and until the next hot reload in development, so
 * an edit to this file still shows.
 */
const rendered = renderedByText<ReactElement>();

const renderMarkdown =
  (path: string, pages: "app" | "github") =>
  (markdown: string): ReactElement =>
    Markdown({
      children: markdown,
      remarkPlugins: [remarkGfm],
      rehypePlugins: [rehypeHeadingIds, rehypeDocTables],
      urlTransform: (url) => defaultUrlTransform(rewriteDocUrl(url, path, pages)),
    });

const pageMarkdown = (
  page: DocPage & Readonly<{ markdown: string }>,
  standalone: boolean,
) => {
  const pages = standalone ? "github" : "app";
  return rendered(
    `${pages}:${page.path}`,
    page.markdown,
    renderMarkdown(page.path, pages),
  );
};

/** The index: its title and line follow the interface language; page titles stay English. */
export const DocsIndex = ({
  pages,
  locale = "en",
}: Readonly<{ pages: readonly DocPage[]; locale?: Locale }>) => (
  <div className={FRAME}>
    <div lang={htmlLang(locale)} className="page-stack">
      <h1 className="text-display">{DOCS_COPY[locale].title}</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        {DOCS_COPY[locale].introBefore}
        <code>docs/</code>
        {DOCS_COPY[locale].introAfter}
      </p>
    </div>
    <ul className="surface divide-border divide-y">
      {pages.map(({ slug, path, title }) => (
        <li key={slug}>
          <Link
            href={`/docs/${slug}`}
            className="hover:bg-muted flex items-baseline justify-between gap-4 px-4 py-3"
          >
            <span className="min-w-0">{title}</span>
            <span className="text-muted-foreground hidden max-w-[50%] min-w-0 text-right font-mono text-xs wrap-anywhere sm:block">
              {path}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  </div>
);

/**
 * `standalone` is for a page shown outside the docs section (the Synthea
 * generator): no breadcrumb back to `/docs`, and links to other pages go to
 * GitHub.
 */
export const DocScreen = ({
  page,
  standalone = false,
  locale = "en",
}: Readonly<{
  page: DocPage & Readonly<{ markdown: string }>;
  standalone?: boolean;
  locale?: Locale;
}>) => (
  <article className={`${FRAME} doc-prose`}>
    {!standalone && (
      <p className="text-muted-foreground font-mono text-xs">
        <Link href="/docs" lang={htmlLang(locale)} className="hover:text-foreground">
          {DOCS_COPY[locale].crumb}
        </Link>{" "}
        / {page.path}
      </p>
    )}
    {pageMarkdown(page, standalone)}
  </article>
);
