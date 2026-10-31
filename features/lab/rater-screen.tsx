import Link from "next/link";
import { type ReactNode } from "react";

import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";
import { Field } from "@/infrastructure/ui-kit/field";

import { type BlindLine } from "./rater-lines";
import { SecondRater } from "./second-rater";

/**
 * `/lab/rate`: the second-rater view of the hb set (#351). Server-rendered
 * frame; the rating itself is the client `SecondRater`. Without a pseudonym
 * it asks for one; without runs it says how to make them.
 */

export type RaterScreenState =
  | Readonly<{ kind: "ask"; invalid: boolean }>
  | Readonly<{ kind: "no-runs" }>
  | Readonly<{ kind: "no-questions" }>
  | Readonly<{
      kind: "rate";
      rater: string;
      runs: number;
      lines: readonly BlindLine[];
      canSave: boolean;
    }>;

const RUN_COMMANDS = [
  "bun run eval -- --models agent:brain --set hb --scenario S7",
  "bun run eval -- --models ollama:qwen3:8b --set hb --scenario S7",
].join("\n");

const Frame = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-3">
      <Link href="/lab#second-rating" className="setup-link text-sm">
        Lab
      </Link>
      <h1 className="text-display">Second rating</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        Rate the answers to the heart-brain questions against the reference, one at a
        time, with the anchors below the stars. The model and the automatic score stay
        hidden. Ratings are saved beside each run on this machine and never sent anywhere.
        Synthetic data only; for research use, not about anyone&rsquo;s health. The rubric
        is in{" "}
        <Link href="/docs/evaluation/second-rater" className="setup-link">
          docs/evaluation/second-rater.md
        </Link>
        .
      </p>
    </header>
    {children}
  </div>
);

const AskPseudonym = ({ invalid }: Readonly<{ invalid: boolean }>) => (
  <Card padding="md" className="flex max-w-md flex-col gap-3">
    <form method="get" action="/lab/rate" className="flex flex-col gap-3">
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

export const RaterScreen = ({ state }: Readonly<{ state: RaterScreenState }>) => (
  <Frame>
    {state.kind === "ask" && <AskPseudonym invalid={state.invalid} />}
    {state.kind === "no-questions" && (
      <Card padding="md">
        <p className="text-sm leading-relaxed">
          The hb questions or their key could not be read from evaluation/. They are
          committed; check the checkout.
        </p>
      </Card>
    )}
    {state.kind === "no-runs" && (
      <Card padding="md" className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed">
          No answered hb runs on this machine. Runs are written to evaluation/runs/
          (gitignored) by:
        </p>
        <pre className="command-block" aria-label="Commands that make hb runs">
          <code>{RUN_COMMANDS}</code>
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
        <SecondRater rater={state.rater} lines={state.lines} canSave={state.canSave} />
      </>
    )}
  </Frame>
);
