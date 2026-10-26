import { notFound } from "next/navigation";

import { docsFiles, listDocPages, readDocPage } from "@/features/docs/docs-pages";
import { DocScreen, DocsIndex } from "@/features/docs/docs-screen";

export default async function DocsPage({
  params,
}: Readonly<{ params: Promise<{ slug?: string[] }> }>) {
  const { slug } = await params;
  if (!slug) return <DocsIndex pages={await listDocPages(docsFiles)} />;
  const page = await readDocPage(docsFiles, slug);
  if (page === null) notFound();
  return <DocScreen page={page} />;
}
