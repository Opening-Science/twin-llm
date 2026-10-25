"use client";

import { Field } from "@/infrastructure/ui-kit/field";

import { LAB_SOURCE_LABEL, LAB_SOURCE_NONE } from "./biomarker-copy";
import { type BiomarkerRow } from "./biomarker-rows";
import { type BiomarkerTabModel } from "./use-biomarker-tab";

/** The lines under a biomarker row's name: English name, range, position, notes. */
export const BiomarkerDetail = ({
  row,
  notes,
}: Readonly<{ row: BiomarkerRow; notes: readonly string[] }>) => (
  <span className="text-muted-foreground flex flex-col text-[11px] leading-snug font-normal">
    {row.english ? <span>{row.english}</span> : null}
    {row.details.map((line) => (
      <span key={line}>{line}</span>
    ))}
    {notes.map((note) => (
      <span key={note} className="text-foreground">
        {note}
      </span>
    ))}
  </span>
);

/** Where the values come from, and for the Demo which synthetic person. */
export const BiomarkerSource = ({ model }: Readonly<{ model: BiomarkerTabModel }>) => (
  <div className="mb-2 space-y-2 px-2.5">
    {model.people.length > 0 ? (
      <Field
        as="select"
        label={LAB_SOURCE_LABEL}
        value={model.personRef}
        onChange={(event) => model.onPerson(event.target.value)}
      >
        <option value="">{LAB_SOURCE_NONE}</option>
        {model.people.map((person) => (
          <option key={person.ref} value={person.ref}>
            {person.label}
          </option>
        ))}
      </Field>
    ) : null}
    <p className="text-muted-foreground text-xs">{model.intro}</p>
  </div>
);
