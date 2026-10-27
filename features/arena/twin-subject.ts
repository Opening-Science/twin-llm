import type { TurnState } from "./conversation";

/**
 * Which twin `/twin` shows: the thread's subject. Pure, so the rules are
 * tested apart from the 3D view.
 *
 * - Synthetic mode: the first synthetic person the thread used, as a
 *   `subject_ref` in a tool call or a subject_ref UUID in a prompt, provided
 *   that person is in the loaded synthetic cohort. Synthetic people have no
 *   scan, so they are shown on the Demo body with their lab values. With no
 *   such person, the Demo body on its own.
 * - Personal mode: Self, as the Digital Twin page shows it.
 *
 * A mode never borrows the other's subject: synthetic mode never shows Self,
 * and personal mode never looks at the thread's synthetic refs.
 */

export type TwinDataMode = "synthetic" | "personal";

/** A synthetic person the Demo body can show, as the cohort list names them. */
export type TwinCohortPerson = Readonly<{ ref: string; label: string }>;

export type TwinTarget =
  | Readonly<{ kind: "self" }>
  | Readonly<{ kind: "synthetic"; ref: string; label: string }>
  | Readonly<{ kind: "demo" }>;

/** What the viewer reports it shows in personal mode (`TwinContext.subject`). */
export type ShownSubject = "self" | "demo" | "other";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Tool arguments the card reads a subject from (`tool-cards.ts` labels them so). */
const SUBJECT_ARG = "Subject";

/**
 * Every subject ref the thread mentions, in the order it used them: per
 * turn, the prompt's UUIDs, then each answer's tool calls in order. A
 * refused or failed call never counts as having used its subject.
 */
export const threadSubjectRefs = (turns: readonly TurnState[]): readonly string[] =>
  turns.flatMap((turn) => [
    ...(turn.prompt.match(UUID) ?? []),
    ...turn.answers.flatMap((answer) =>
      (answer.tools ?? [])
        .filter((tool) => tool.state === "done" || tool.state === "running")
        .flatMap((tool) =>
          tool.args.filter((arg) => arg.label === SUBJECT_ARG).map((arg) => arg.value),
        ),
    ),
  ]);

export const twinTarget = ({
  mode,
  turns,
  cohort,
}: Readonly<{
  mode: TwinDataMode;
  turns: readonly TurnState[];
  /** The loaded synthetic cohort; empty when it is not loaded or failed. */
  cohort: readonly TwinCohortPerson[];
}>): TwinTarget => {
  if (mode === "personal") return { kind: "self" };
  const person = threadSubjectRefs(turns)
    .map((ref) => cohort.find((row) => row.ref.toLowerCase() === ref.toLowerCase()))
    .find((row) => row !== undefined);
  return person
    ? { kind: "synthetic", ref: person.ref, label: person.label }
    : { kind: "demo" };
};

const PREFIX = "Digital twin";

const PERSONAL_SHOWN: Readonly<Record<ShownSubject, string>> = {
  self: "Self",
  demo: "Demo body (no Self twin here)",
  other: "first listed subject (no Self twin here)",
};

/**
 * The card's header. In personal mode the viewer may find no Self and fall
 * back as the Digital Twin page does; the label then says what it shows.
 */
export const twinLabel = (target: TwinTarget, shown: ShownSubject | null): string => {
  if (target.kind === "synthetic") return `${PREFIX} · ${target.label}`;
  if (target.kind === "demo") return `${PREFIX} · Demo body`;
  return `${PREFIX} · ${PERSONAL_SHOWN[shown ?? "self"]}`;
};
