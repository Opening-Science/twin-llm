import { SyntheaGenerator } from "@/features/synthea/synthea-generator";
import { syntheaJarStatus } from "@/features/synthea/synthea-jobs";
import { SYNTHEA_VERSION } from "@/features/synthea/synthea-options";
import { syntheaEnv } from "@/infrastructure/env";

export const dynamic = "force-dynamic";

/** The generator: what it is, where it runs, the form. */
export default async function SyntheaPage() {
  const env = syntheaEnv();
  const ready = (await syntheaJarStatus()) === "ready";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <p className="text-eyebrow">Synthetic patients · Synthea {SYNTHEA_VERSION}</p>
        <h1 className="text-display">Generate synthetic patients</h1>
        <p className="text-muted-foreground max-w-prose leading-relaxed">
          Make a few made-up patient records, each a full simulated life with visits,
          conditions, medications and measurements, for research and software testing. No
          record describes a real person.
        </p>
        <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
          Synthea runs on this server, not in your browser: it is a Java program, and a
          web page cannot run Java. Your options are sent to the server, which runs one
          job at a time and offers the result as one zip. The files are deleted once you
          download them, or after 10 minutes. For larger cohorts, run Synthea from the
          repository; the docs show how.
        </p>
      </div>
      <SyntheaGenerator
        maxPeople={env.maxPeople}
        ready={ready}
        timeoutMinutes={env.jobTimeoutMs / 60_000}
      />
    </div>
  );
}
