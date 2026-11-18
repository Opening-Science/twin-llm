import { notFound } from "next/navigation";

import { docsFiles, listDocPages, readDocPage } from "@/features/docs/docs-pages";
import { DocScreen, DocsIndex } from "@/features/docs/docs-screen";
import { serverLocale } from "@/infrastructure/locale/server-locale";

export default async function DocsPage({
  params,
}: Readonly<{ params: Promise<{ slug?: string[] }> }>) {
  const { slug } = await params;
  const locale = await serverLocale();
  if (!slug) return <DocsIndex pages={await listDocPages(docsFiles)} locale={locale} />;
  const page = await readDocPage(docsFiles, slug);
  if (page === null) notFound();
  return <DocScreen page={page} locale={locale} />;
}
