import { DatasetList } from "./dataset-list";
import { IMPORT_MESSAGES } from "./import-messages";
import { ImportPanel } from "./import-panel";
import type { YourDataState } from "./import-routes";

/**
 * Customize · Data, "Yours": import your own files and manage what you
 * imported. Off in synthetic mode and when nobody is signed in; the section
 * then says which.
 */

export const YourDataSection = ({ data }: Readonly<{ data: YourDataState }>) => (
  <section aria-labelledby="your-data">
    <h2 id="your-data" className="text-lg">
      Yours
    </h2>
    <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
      Bring your own records and research files: FHIR records, lab results as CSV, health
      and wearable exports, a genome VCF, or any table you want to explore. You see what
      will be stored before anything is saved, and you can delete an import at any time.
    </p>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed">
      Stored on this machine in TwinLLM&apos;s database. Not encrypted at rest yet (#141).
      Imported data is never sent to a hosted model. A genome VCF is read only by models
      on this machine.
    </p>
    {data.state === "synthetic" ? (
      <p className="surface text-muted-foreground mt-4 p-4 text-sm">
        {IMPORT_MESSAGES.syntheticMode} Your own data is imported only with
        DATA_MODE=personal.
      </p>
    ) : data.state === "signed-out" ? (
      <p className="surface text-muted-foreground mt-4 p-4 text-sm">
        {IMPORT_MESSAGES.signIn}
      </p>
    ) : (
      <>
        <ImportPanel />
        <DatasetList datasets={data.datasets} />
      </>
    )}
  </section>
);
