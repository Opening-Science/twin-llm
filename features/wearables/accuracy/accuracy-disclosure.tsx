"use client";

import { Dialog } from "radix-ui";
import { useState, useSyncExternalStore } from "react";

import { formatDate } from "@/infrastructure/format-measure";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";

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
 * any vendor funding, and the papers.
 *
 * The toggle sits under the card, not inside it: the kit card hides a
 * picture chart's body from screen readers, and this text must stay
 * readable. The note opens over the page, never in the grid, so no card
 * moves: a popover anchored to the toggle from `md` up, a bottom sheet on a
 * phone. Both are Radix: the toggle stays a button with `aria-expanded`,
 * Escape closes, and focus goes back to the toggle.
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
  <div className="text-muted-foreground space-y-3 text-xs leading-relaxed">
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

/** Below `md`, where the dashboard is one column and the note opens as a sheet. */
const PHONE = "(max-width: 47.99rem)";

const subscribe = (listener: () => void) => {
  const media = window.matchMedia(PHONE);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

const usePhone = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

const TITLE = "How accurate is this?";

const Toggle = ({ label }: { readonly label: string }) => (
  <>
    {TITLE}
    <span className="sr-only"> {label}</span>
  </>
);

const TOGGLE_CLASS =
  "text-muted-foreground hover:text-foreground hover:bg-muted/60 mt-1 rounded-md px-3 py-1.5 text-left text-xs font-medium";

export const AccuracyDisclosure = ({
  accuracy,
  label,
}: {
  readonly accuracy: CardAccuracy;
  /** The card's label, so each toggle has its own name for a screen reader. */
  readonly label: string;
}) => {
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  if (phone) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger type="button" className={TOGGLE_CLASS}>
          <Toggle label={label} />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="bg-background/70 fixed inset-0 z-50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="border-border bg-popover text-popover-foreground fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-xl border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-hidden"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <Dialog.Title className="font-sans text-sm font-medium">
                {TITLE} <span className="text-muted-foreground font-normal">{label}</span>
              </Dialog.Title>
              <Dialog.Close
                type="button"
                className="text-muted-foreground hover:text-foreground -mt-1 rounded-md px-2 py-1 text-xs font-medium"
              >
                Close
              </Dialog.Close>
            </div>
            <AccuracyDetails accuracy={accuracy} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger type="button" className={TOGGLE_CLASS}>
        <Toggle label={label} />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        collisionPadding={16}
        aria-label={`${TITLE} ${label}`}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-4"
      >
        <AccuracyDetails accuracy={accuracy} />
      </PopoverContent>
    </Popover>
  );
};
