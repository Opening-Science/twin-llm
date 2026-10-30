"use client";

import { useActionState } from "react";

import type { TwinNote } from "@/infrastructure/twin-notes";
import { Button } from "@/infrastructure/ui-kit/button";

import { permitLabel } from "./compact-state";
import { editNote, type NoteFormState, removeNote } from "./note-actions";
import { NoteFields } from "./note-fields";

/**
 * One saved note on Customize · Memory (#43): every part editable, saved
 * with Save changes, or deleted. The permit and data mode it was saved
 * under are shown and never change.
 */

const START: NoteFormState = { message: null, saved: false };

export const NoteEditor = ({
  note,
  savedOn,
}: Readonly<{ note: TwinNote; savedOn: string }>) => {
  const [state, action, pending] = useActionState(editNote, START);
  return (
    <li className="surface flex flex-col gap-3 p-4">
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={note.id} />
        <NoteFields note={note} />
        <p className="text-muted-foreground text-xs">
          Saved {savedOn}. {permitLabel(note.permit)}
        </p>
        {state.message ? (
          <p
            role={state.saved ? "status" : "alert"}
            className={state.saved ? "text-sm" : "text-destructive text-sm"}
          >
            {state.message}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button type="submit" variant="ghost" formAction={removeNote}>
            Delete note
          </Button>
        </div>
      </form>
    </li>
  );
};
