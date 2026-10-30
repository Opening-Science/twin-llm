import { formatDate } from "@/infrastructure/format-measure";
import type { TwinNote } from "@/infrastructure/twin-notes";
import { Button } from "@/infrastructure/ui-kit/button";

import { setNotesLoading } from "./note-actions";
import { NoteEditor } from "./note-editor";

/**
 * Customize · Memory (#43, docs/twin-notes.md): the person's twin notes, each
 * editable and deletable, and the switch that decides whether new chats load
 * them.
 */
export const MemoryScreen = ({
  signedIn,
  notes,
  loadingOn,
}: Readonly<{ signedIn: boolean; notes: readonly TwinNote[]; loadingOn: boolean }>) => {
  if (!signedIn) {
    return <p className="text-muted-foreground text-sm">Sign in to keep twin notes.</p>;
  }
  return (
    <>
      <section aria-labelledby="memory-heading">
        <h2 id="memory-heading" className="text-lg">
          Memory
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Twin notes you saved with <span className="font-mono">/compact</span>. Each is
          your own summary of a thread: what you asked, which measures a tool read and
          over which dates, and what was left open. Readings are not kept unless you typed
          them in. New chats load your notes into the model&rsquo;s instructions, newest
          first, as far as they fit.
        </p>
        <form action={setNotesLoading} className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="load" defaultChecked={loadingOn} />
            Load notes into new chats
          </label>
          <Button type="submit" size="sm">
            Save setting
          </Button>
          <span className="text-muted-foreground text-xs">
            Now {loadingOn ? "on" : "off"}. Incognito chats never load notes.
          </span>
        </form>
      </section>
      <section aria-labelledby="notes-heading" className="mt-8">
        <h2 id="notes-heading" className="text-lg">
          Your notes
        </h2>
        {notes.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">
            None yet. Type /compact in a saved chat to draft one.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {notes.map((note) => (
              <NoteEditor
                key={note.id}
                note={note}
                savedOn={formatDate(note.createdAt.slice(0, 10))}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
};
