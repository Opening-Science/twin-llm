import { readsLine } from "@/features/commands/registry";

/**
 * The one centred line under the composer (SPEC 3.3, item 3): the first rule
 * that applies wins. Pure; the prompt bar reads it into a polite live region.
 */

export type HintInput = Readonly<{
  /** The skill the draft starts with, if any. */
  skill: Readonly<{ name: string; reads: readonly string[] }> | null;
  incognito: boolean;
  /** Some model runs on this machine. */
  anyLocal: boolean;
  /** The thread's last rows: how many dropped from the catalog, how many remain. */
  dropped: Readonly<{ dropped: number; remaining: number }> | null;
  /** What the mode is missing. */
  problem: string | null;
  /** The mode's one-line description. */
  modeLine: string;
}>;

export const INCOGNITO_HINT = "Incognito: local models only, and nothing is saved.";
export const INCOGNITO_NOWHERE =
  "Incognito has nowhere to go: no model runs on this machine.";

const droppedLine = ({
  dropped,
  remaining,
}: Readonly<{ dropped: number; remaining: number }>): string =>
  remaining === 0
    ? "None of this thread's models are offered any more. Choose one."
    : dropped === 1
      ? "One of this thread's models is no longer offered, so the prompt goes to the rest."
      : `${String(dropped)} of this thread's models are no longer offered, so the prompt goes to the rest.`;

export const promptHint = (input: HintInput): string => {
  if (input.skill !== null) {
    return `Sends with /${input.skill.name}, which ${readsLine(input.skill.reads)}.`;
  }
  if (input.incognito) return input.anyLocal ? INCOGNITO_HINT : INCOGNITO_NOWHERE;
  if (input.dropped !== null && input.dropped.dropped > 0)
    return droppedLine(input.dropped);
  return input.problem ?? input.modeLine;
};
