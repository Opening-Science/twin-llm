"use client";

import { useId } from "react";

import { NOTE_LIMITS, type TwinNoteFields } from "@/infrastructure/twin-notes";
import { Field } from "@/infrastructure/ui-kit/field";

/**
 * The four parts of a twin note as form controls, one item per line. The
 * `/compact` draft and Customize · Memory both use it, so a note is edited
 * the same way wherever it is.
 */

const LINES = [
  {
    name: "topics",
    label: "Topics asked",
    max: NOTE_LIMITS.topics,
    hint: "What you asked about.",
  },
  {
    name: "measures",
    label: "Measures discussed",
    max: NOTE_LIMITS.measures,
    hint: "Measure · tool · date range, from the thread's tool calls. No readings.",
  },
  {
    name: "openQuestions",
    label: "Open questions",
    max: NOTE_LIMITS.openQuestions,
    hint: "What the thread left open.",
  },
] as const;

const NoteLines = ({
  name,
  label,
  hint,
  max,
  value,
}: Readonly<{
  name: string;
  label: string;
  hint: string;
  max: number;
  value: readonly string[];
}>) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        defaultValue={value.join("\n")}
        rows={Math.min(Math.max(value.length, 2), 6)}
        aria-describedby={`${id}-hint`}
        className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {hint} One per line, at most {max} lines of {NOTE_LIMITS.line} characters.
      </p>
    </div>
  );
};

export const NoteFields = ({ note }: Readonly<{ note: TwinNoteFields }>) => (
  <div className="flex flex-col gap-3">
    <Field
      label="Title"
      name="title"
      defaultValue={note.title}
      maxLength={NOTE_LIMITS.title}
      required
    />
    {LINES.map((part) => (
      <NoteLines key={part.name} {...part} value={note[part.name]} />
    ))}
  </div>
);
