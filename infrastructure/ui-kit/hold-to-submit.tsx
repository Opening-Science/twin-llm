"use client";

import { useEffect, useRef, useState } from "react";

import { HoldToConfirm, type HoldToConfirmProps } from "./hold-to-confirm";
import { createSubmitGate } from "./hold-timer";

/**
 * HoldToConfirm as the submit control of a form, for a form whose action
 * cannot be undone. A completed hold submits the form it sits in once
 * (`requestSubmit`, so a server action or an onSubmit handler runs as for
 * any submit); letting go early submits nothing. Every other submission of
 * that form, such as Enter in one of its fields, is stopped before React
 * sees it. While `pending` it shows `pendingLabel`; when the submission
 * settles and the form is still on screen (it was refused), the button is
 * ready to hold again.
 */

export type HoldToSubmitProps = Omit<HoldToConfirmProps, "onConfirm" | "doneLabel"> &
  Readonly<{ pending: boolean; pendingLabel: string }>;

export const HoldToSubmit = ({ pending, pendingLabel, ...hold }: HoldToSubmitProps) => {
  const anchor = useRef<HTMLSpanElement>(null);
  const [gate] = useState(createSubmitGate);
  const [round, setRound] = useState(0);
  const [wasPending, setWasPending] = useState(pending);

  // A settled submission gives a fresh button (a new key, so a new hold).
  if (wasPending !== pending) {
    setWasPending(pending);
    if (!pending) setRound((value) => value + 1);
  }

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const guard = (event: SubmitEvent) => {
      if (gate.admit()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    form.addEventListener("submit", guard);
    return () => form.removeEventListener("submit", guard);
  }, [gate]);

  return (
    <span ref={anchor} className="contents">
      <HoldToConfirm
        key={round}
        {...hold}
        disabled={hold.disabled || pending}
        doneLabel={pendingLabel}
        onConfirm={() => {
          const form = anchor.current?.closest("form");
          if (!form) return;
          gate.open();
          form.requestSubmit();
        }}
      />
    </span>
  );
};
