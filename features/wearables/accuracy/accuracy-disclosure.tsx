"use client";

import { useId, useState } from "react";

import { formatDate } from "@/infrastructure/format-measure";

import { VERIFIED_ON } from "./accuracy-notes";
import {
  EVIDENCE_WORD,
  type CardAccuracy,
  type CardAccuracyEntry,
  type CitedSource,
} from "./card-accuracy";

/**
 * "How accurate is this?" under a dashboard card: what published validation
 * studies found for the measure on this device, the evidence level as a word,
 * any vendor funding, and the papers. Closed by default, so the card keeps
 * its height; the body stays mounted while hidden.
 *
 * It sits under the card, not inside it: the kit card hides a picture
 * chart's body from screen readers, and this text must stay readable.
 */

const Citation = ({ source }: { readonly source: CitedSource }) => (
  <li>
    {source.authors}. {source.title}. {source.journal}{" "}
    <a
      href={source.href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground break-all underline underline-offset-2"
    >
      {source.doi ? `doi:${source.doi}` : "Article"}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  </li>
);

const Entry = ({ entry }: { readonly entry: CardAccuracyEntry }) => (
  <div className="space-y-1.5">
    <p className="text-foreground font-medium">
      {entry.part ? `${entry.part}: ` : ""}
      {EVIDENCE_WORD[entry.evidence]}
    </p>
    <p className="text-foreground">{entry.note}</p>
    {entry.remark ? <p>{entry.remark}</p> : null}
    {entry.funding ? <p>Funding and interests: {entry.funding}</p> : null}
    {entry.sources.length > 0 ? (
      <ul className="space-y-1" aria-label="Studies">
        {entry.sources.map((source) => (
          <Citation key={source.id} source={source} />
        ))}
      </ul>
    ) : null}
  </div>
);

export const AccuracyDetails = ({ accuracy }: { readonly accuracy: CardAccuracy }) => (
  <div className="text-muted-foreground space-y-3 px-3 pt-1 pb-3 text-xs leading-relaxed">
    {accuracy.deviceRemark ? <p>{accuracy.deviceRemark}</p> : null}
    {accuracy.entries.map((entry) => (
      <Entry key={`${entry.part ?? ""}${entry.measure}`} entry={entry} />
    ))}
    <p>
      From a review of published validation studies, each checked against the paper on{" "}
      {formatDate(VERIFIED_ON)}. For research; it says how well the device measured in
      those studies, not how well it measures you.
    </p>
  </div>
);

export const AccuracyDisclosure = ({
  accuracy,
  label,
}: {
  readonly accuracy: CardAccuracy;
  /** The card's label, so each toggle has its own name for a screen reader. */
  readonly label: string;
}) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="collapsible-panel mt-1" data-open={open ? "" : undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((was) => !was)}
        className="collapsible-panel-toggle text-muted-foreground hover:text-foreground"
      >
        <span>
          How accurate is this?<span className="sr-only"> {label}</span>
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={bodyId} hidden={!open}>
        <AccuracyDetails accuracy={accuracy} />
      </div>
    </div>
  );
};
