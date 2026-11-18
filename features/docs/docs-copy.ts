import type { Translated } from "@/infrastructure/locale/locale";

/**
 * The docs section's own words in English and German: the index's title and
 * line, and the breadcrumb. The pages are the repository's Markdown and stay
 * English; the German line says so.
 */

export type DocsCopy = Readonly<{
  title: string;
  /** The line under the title, around the `docs/` folder name. */
  introBefore: string;
  introAfter: string;
  crumb: string;
}>;

export const DOCS_COPY: Translated<DocsCopy> = {
  en: {
    title: "Docs",
    introBefore: "The reference pages from the repository's ",
    introAfter: " folder, as checked in.",
    crumb: "Docs",
  },
  de: {
    title: "Doku",
    introBefore: "Die Referenzseiten aus dem Ordner ",
    introAfter:
      " des Repositorys, so wie sie eingecheckt sind. Die Seiten selbst sind auf Englisch.",
    crumb: "Doku",
  },
};
