import Link from "next/link";
import { type ReactNode } from "react";

import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";
import { Field } from "@/infrastructure/ui-kit/field";

import { RATED_SET_COPY, ratePath } from "./rated-set-copy";
import { type BlindLine } from "./rater-lines";
import { RATED_SETS, type RatedSet } from "./rater-rubric";
import { type RaterScope } from "./rater-sample";
import { SecondRater } from "./second-rater";

/**
 * `/lab/rate`: the second-rater view (#351) of one rated set, hb or v1h
 * (`?set=v1h`, #304). Server-rendered frame; the rating itself is the client
 * `SecondRater`. Without a pseudonym it asks for one; without runs it says
 * how to make them.
 */

export type RaterScreenState =
  | Readonly<{ kind: "ask"; invalid: boolean }>
  | Readonly<{ kind: "no-runs" }>
  | Readonly<{ kind: "no-questions" }>
  | Readonly<{ kind: "unknown-set" }>
  | Readonly<{
      kind: "rate";
      rater: string;
      runs: number;
      /** The protocol's sample, or every answered line (#413). */
      scope: RaterScope;
      /** Every answered line of the set on this machine, sampled or not. */
      answered: number;
      lines: readonly BlindLine[];
      canSave: boolean;
    }>;

const SetTabs = ({ set, rater }: Readonly<{ set: RatedSet; rater?: string }>) => (
  <nav aria-label="Question set" className="segmented self-start">
    {RATED_SETS.map((each) => (
      <Link
        key={each}
        href={ratePath(each, rater)}
        aria-current={each === set ? "page" : undefined}
        className="segmented-item"
      >
        {RATED_SET_COPY[each].label}
      </Link>
    ))}
  </nav>
);

/** Which lines are shown, and the way to the other scope. v1h only: hb has no sample. */
const ScopeNote = ({
  set,
  rater,
  scope,
  shown,
  answered,
}: Readonly<{
  set: RatedSet;
  rater: string;
  scope: RaterScope;
  shown: number;
  answered: number;
}>) =>
  set === "hb" ? null : (
    <p className="text-muted-foreground text-sm leading-relaxed">
      {scope === "sample"
        ? `The review sample: ${shown} of the ${answered} answered lines, drawn as the protocol in docs/evaluation/question-set.md says, in your own order. `
        : `Every answered line (${answered}), for a second pass after the sample. `}
      <Link
        href={ratePath(set, rater, scope === "sample" ? "all" : "sample")}
        className="setup-link"
      >
        {scope === "sample" ? "Rate every line" : "Back to the sample"}
      </Link>
    </p>
  );

const Frame = ({
  set,
  rater,
  children,
}: Readonly<{ set: RatedSet; rater?: string; children: ReactNode }>) => (
  <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-3">
      <Link href="/lab#second-rating" className="setup-link text-sm">
        Lab
      </Link>
      <h1 className="text-display">Second rating</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        Rate the answers to {RATED_SET_COPY[set].questions} against the reference, one at
        a time, with the anchors below the stars. The model and the automatic score stay
        hidden. Ratings are saved beside each run on this machine and never sent anywhere.
        Synthetic data only; for research use, not about anyone&rsquo;s health. The rubric
        is in{" "}
        <Link href="/docs/evaluation/second-rater" className="setup-link">
          docs/evaluation/second-rater.md
        </Link>
        .
      </p>
      <SetTabs set={set} rater={rater} />
    </header>
    {children}
  </div>
);

const AskPseudonym = ({
  set,
  invalid,
}: Readonly<{ set: RatedSet; invalid: boolean }>) => (
  <Card padding="md" className="flex max-w-md flex-col gap-3">
    <form method="get" action="/lab/rate" className="flex flex-col gap-3">
      {set !== "hb" && <input type="hidden" name="set" value={set} />}
      <Field
        label="Pseudonym"
        name="rater"
        autoComplete="off"
        required
        hint="Lowercase letters, digits and dashes, such as rater-b. Not your name: it names the ratings file and the order you see the answers in."
        error={
          invalid
            ? "Use 2 to 32 lowercase letters, digits or dashes, starting and ending with a letter or digit."
            : undefined
        }
      />
      <button type="submit" className={buttonClassName({ variant: "primary" })}>
        Start or resume
      </button>
    </form>
  </Card>
);

export const RaterScreen = ({
  set,
  state,
}: Readonly<{ set: RatedSet; state: RaterScreenState }>) => (
  <Frame set={set} rater={state.kind === "rate" ? state.rater : undefined}>
    {state.kind === "ask" && <AskPseudonym set={set} invalid={state.invalid} />}
    {state.kind === "unknown-set" && (
      <Card padding="md">
        <p className="text-sm leading-relaxed">
          This view rates the hb and v1h sets only. Pick one above.
        </p>
      </Card>
    )}
    {state.kind === "no-questions" && (
      <Card padding="md">
        <p className="text-sm leading-relaxed">
          The {set} questions or their key could not be read from evaluation/. They are
          committed; check the checkout.
        </p>
      </Card>
    )}
    {state.kind === "no-runs" && (
      <Card padding="md" className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed">
          No answered {set} runs on this machine. Runs are written to evaluation/runs/
          (gitignored) by:
        </p>
        <pre className="command-block" aria-label={`Commands that make ${set} runs`}>
          <code>{RATED_SET_COPY[set].runCommands.join("\n")}</code>
        </pre>
      </Card>
    )}
    {state.kind === "rate" && (
      <>
        {!state.canSave && (
          <Card padding="md">
            <p className="text-sm leading-relaxed">
              Ratings are saved on a local install only (LOCAL_MVP or AUTH_DISABLED), so
              this view is read-only here.
            </p>
          </Card>
        )}
        <ScopeNote
          set={set}
          rater={state.rater}
          scope={state.scope}
          shown={state.lines.length}
          answered={state.answered}
        />
        <SecondRater
          set={set}
          rater={state.rater}
          scope={state.scope}
          lines={state.lines}
          canSave={state.canSave}
        />
      </>
    )}
  </Frame>
);
