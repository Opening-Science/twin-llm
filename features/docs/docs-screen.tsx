import Link from "next/link";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { type DocPage, rewriteDocUrl } from "./docs-pages";

/**
 * The docs index and one rendered page. Markdown comes from the repository's
 * own `docs/` folder, so links between pages are rewritten to `/docs/...`
 * before the usual URL check; `.doc-prose` in `globals.css` styles the output.
 */

const FRAME = "mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6";

export const DocsIndex = ({ pages }: Readonly<{ pages: readonly DocPage[] }>) => (
  <div className={FRAME}>
    <h1 className="text-display">Docs</h1>
    <p className="text-muted-foreground max-w-prose leading-relaxed">
      The reference pages from the repository&apos;s <code>docs/</code> folder, as checked
      in.
    </p>
    <ul className="surface divide-border divide-y">
      {pages.map(({ slug, path, title }) => (
        <li key={slug}>
          <Link
            href={`/docs/${slug}`}
            className="hover:bg-muted flex items-baseline justify-between gap-4 px-4 py-3"
          >
            <span>{title}</span>
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
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
}: Readonly<{
  page: DocPage & Readonly<{ markdown: string }>;
  standalone?: boolean;
}>) => (
  <article className={`${FRAME} doc-prose`}>
    {!standalone && (
      <p className="text-muted-foreground font-mono text-xs">
        <Link href="/docs" className="hover:text-foreground">
          Docs
        </Link>{" "}
        / {page.path}
      </p>
    )}
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) =>
        defaultUrlTransform(rewriteDocUrl(url, page.path, standalone ? "github" : "app"))
      }
    >
      {page.markdown}
    </Markdown>
  </article>
);
