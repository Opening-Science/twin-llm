"use client";

import { useActionState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import { type ConsentFormState, grantConsent, withdrawConsent } from "./consent-actions";
import type { ScopeView, SourceChoice } from "./privacy-view";

/**
 * One use on Customize · Privacy (#145): off with a choice of data and Grant,
 * or on with what it covers, the sentence agreed to and Withdraw. Earlier
 * grants that were withdrawn are listed under it.
 */

const START: ConsentFormState = { message: null, ok: false };

const Message = ({ state }: Readonly<{ state: ConsentFormState }>) =>
  state.message ? (
    <p
      role={state.ok ? "status" : "alert"}
      className={state.ok ? "text-sm" : "text-destructive text-sm"}
    >
      {state.message}
    </p>
  ) : null;

export const ConsentCard = ({
  view,
  choices,
}: Readonly<{ view: ScopeView; choices: readonly SourceChoice[] }>) => {
  const [granted, grant, granting] = useActionState(grantConsent, START);
  const [withdrawn, withdraw, withdrawing] = useActionState(withdrawConsent, START);
  const headingId = `consent-${view.scope}`;
  return (
    <li className="surface flex flex-col gap-3 p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-base font-medium">
          {view.name}
        </h3>
        {view.active === null ? (
          <StatusBadge tone="off">Off</StatusBadge>
        ) : (
          <StatusBadge tone="ok">On since {view.active.since}</StatusBadge>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{view.purpose}.</p>
      {view.active === null ? (
        <form action={grant} className="flex flex-col gap-3">
          <input type="hidden" name="scope" value={view.scope} />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">What it may read</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {choices.map((choice) => (
                <label key={choice.value} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="sources" value={choice.value} />
                  {choice.label}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-muted-foreground text-xs">
            Granting stores today&rsquo;s date and the exact sentence you agree to, naming
            the data you ticked.
          </p>
          <Message state={granted} />
          <div>
            <Button type="submit" variant="primary" disabled={granting}>
              {granting ? "Granting…" : "Grant"}
            </Button>
          </div>
        </form>
      ) : (
        <form action={withdraw} className="flex flex-col gap-3">
          <input type="hidden" name="consentId" value={view.active.id} />
          <p className="text-sm">Covers: {view.active.sources}.</p>
          <blockquote className="text-muted-foreground border-l-2 pl-3 text-sm">
            {view.active.wording}
          </blockquote>
          <Message state={withdrawn} />
          <div>
            <Button type="submit" variant="secondary" disabled={withdrawing}>
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </Button>
          </div>
        </form>
      )}
      {view.active === null ? <Message state={withdrawn} /> : null}
      {view.past.length > 0 ? (
        <div className="text-muted-foreground text-xs">
          <p>Withdrawn earlier:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {view.past.map((past) => (
              <li key={past.id}>
                Granted {past.granted}, withdrawn {past.withdrawn}: {past.sources}.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
};
