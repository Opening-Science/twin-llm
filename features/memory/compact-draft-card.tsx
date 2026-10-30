"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import type { NotePermit, TwinNoteFields } from "@/infrastructure/twin-notes";
import { Button } from "@/infrastructure/ui-kit/button";

import { errorSentence, permitLabel } from "./compact-state";
import { NoteFields } from "./note-fields";
import { noteFromForm } from "./note-form";

/**
 * The `/compact` draft under the conversation (#43). Nothing is stored until
 * the person presses Save note; Discard drops it. Every line is editable, so
 * what is saved is what the person confirmed.
 */

export type CompactCardState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{
      kind: "draft";
      threadId: string;
      draft: TwinNoteFields;
      permit: NotePermit;
      notice?: string;
    }>
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "message"; message: string }>;

const FAILED = "The note wasn't saved. Try again.";

const errorOf = async (response: Response): Promise<string> =>
  errorSentence(await response.json().catch(() => null), FAILED);

export const CompactDraftCard = ({
  state,
  onSaved,
  onClose,
}: Readonly<{
  state: CompactCardState;
  onSaved: () => void;
  onClose: () => void;
}>) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "draft") return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/memory/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: state.threadId,
          note: noteFromForm(new FormData(event.currentTarget)),
        }),
      });
      if (response.ok) onSaved();
      else setError(await errorOf(response));
    } catch {
      setError(FAILED);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="compact-heading"
      className="surface flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="compact-heading" className="text-base">
          Twin note
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {state.kind === "draft" ? "Discard" : "Close"}
        </Button>
      </div>
      {state.kind === "loading" ? (
        <p role="status" className="text-muted-foreground text-sm">
          Drafting a note of this thread with its model…
        </p>
      ) : state.kind === "message" ? (
        <p role="alert" className="text-sm">
          {state.message}
        </p>
      ) : state.kind === "saved" ? (
        <p role="status" className="text-sm">
          Saved to your memory. New chats load it; read, edit or delete it on{" "}
          <Link href="/customize/memory" className="underline">
            Customize · Memory
          </Link>
          .
        </p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            A draft for your memory. Nothing is saved until you press Save note. Edit or
            remove anything first; values from the thread&rsquo;s readings are left out
            unless you type them in.
          </p>
          {state.notice ? <p className="text-sm">{state.notice}</p> : null}
          <NoteFields note={state.draft} />
          <p className="text-muted-foreground text-xs">{permitLabel(state.permit)}</p>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save note"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
};
