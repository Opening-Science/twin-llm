import Link from "next/link";

import { loadYourData } from "@/features/personal-data/import-routes";
import { YourDataSection } from "@/features/personal-data/your-data-section";
import { lockedScreen } from "@/features/vault/page-gate";

/**
 * Customize · Data: what you bring (your own imports, docs/personal-data.md)
 * and the open datasets TwinLLM already holds to explore.
 */

// Reads the person's imports on every visit (and audits it); never prerendered.
export const dynamic = "force-dynamic";

const DATASETS = [
  {
    href: "/customize/data/cohort",
    title: "Synthetic cohort",
    detail:
      "Synthea people with labs, vitals, conditions and medications. The evaluation set and the training conversations read it.",
  },
  {
    href: "/customize/data/cohort/training",
    title: "Training conversations",
    detail:
      "Conversations made from the synthetic cohort, with their tools and outcomes.",
  },
  {
    href: "/docs/genome-synthetic",
    title: "Synthetic genomes",
    detail: "Made-up VCFs for trying the genome track without anyone's DNA.",
  },
] as const;

export default async function CustomizeDataPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  const yours = await loadYourData();
  return (
    <>
      <YourDataSection data={yours} />
      <section aria-labelledby="open-data" className="mt-10">
        <h2 id="open-data" className="text-lg">
          Discover
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {DATASETS.map((dataset) => (
            <li key={dataset.href}>
              <Link href={dataset.href} className="surface hover:bg-muted/40 block p-4">
                <span className="block text-sm">{dataset.title}</span>
                <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">
                  {dataset.detail}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
