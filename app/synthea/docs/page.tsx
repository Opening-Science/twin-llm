import { notFound } from "next/navigation";

import { docsFiles, readDocPage } from "@/features/docs/docs-pages";
import { DocScreen } from "@/features/docs/docs-screen";

export const dynamic = "force-dynamic";

/** `docs/synthea-generator.md`, inside the generator's own frame. */
export default async function SyntheaDocsPage() {
  const page = await readDocPage(docsFiles, ["synthea-generator"]);
  if (page === null) notFound();
  // Wide tables scroll inside this box, as they do inside the app's main area.
  return (
    <div className="min-w-0 overflow-x-auto">
      <DocScreen page={page} standalone />
    </div>
  );
}
