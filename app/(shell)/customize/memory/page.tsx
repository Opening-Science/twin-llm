import { MemoryScreen } from "@/features/memory/memory-screen";
import { listNotes, notesOff } from "@/features/memory/note-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";

/** Customize · Memory (#43): the person's twin notes and whether new chats load them. */
export default async function CustomizeMemoryPage() {
  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor);
  const [notes, off] =
    userId === null
      ? [[], false]
      : await Promise.all([listNotes(userId), notesOff(userId)]);
  return <MemoryScreen signedIn={actor !== null} notes={notes} loadingOn={!off} />;
}
