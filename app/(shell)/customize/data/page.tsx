import Link from "next/link";

/**
 * Customize · Data: what you bring (imports come in the next change) and the
 * open datasets TwinLLM already holds to explore.
 */

const DATASETS = [
  {
    href: "/data",
    title: "Synthetic cohort",
    detail:
      "Synthea people with labs, vitals, conditions and medications. The evaluation set and the training conversations read it.",
  },
  {
    href: "/data/training",
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

export default function CustomizeDataPage() {
  return (
    <>
      <section aria-labelledby="your-data">
        <h2 id="your-data" className="text-lg">
          Yours
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
          Bring your own records and files: FHIR bundles, lab results as CSV, an Apple
          Health export, wearable exports, a genome VCF, or any research table you want to
          explore. They stay on this machine. Coming in the next change; until then, link
          a wearable under Connectors.
        </p>
      </section>
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
