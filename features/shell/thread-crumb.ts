/**
 * What the breadcrumb says for a thread. A thread's title is the start of its
 * first prompt (`start-turn.ts`), so it can carry newlines and run to 80
 * characters; the bar has room for about 60. Anything longer is cut with an
 * ellipsis and the whole text goes in `full`, for the hover title.
 *
 * No title at all (an unknown thread, or one whose page has not said yet) reads
 * "Thread" rather than the id: a cuid tells nobody anything.
 */
export const THREAD_FALLBACK = "Thread";

const MAX_LENGTH = 60;

export type Crumb = Readonly<{ label: string; full?: string }>;

export const threadCrumb = (title?: string): Crumb => {
  const text = (title ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return { label: THREAD_FALLBACK };
  if (text.length <= MAX_LENGTH) return { label: text, full: text };
  return { label: `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…`, full: text };
};

/** Where a thread belongs, shown before its title: "Chat / …" or "Twin / …". */
export type ThreadSection = Readonly<{ label: "Chat" | "Twin"; href: string }>;

const TWIN_COMMAND = /^\s*\/twin(?:\s+|$)/i;

/**
 * A thread started with `/twin` belongs to the Digital Twin and drops the
 * command from its title; every other thread is a chat.
 */
export const threadSection = (
  title?: string,
): Readonly<{ section: ThreadSection; title?: string }> =>
  title !== undefined && TWIN_COMMAND.test(title)
    ? {
        section: { label: "Twin", href: "/digital-twin" },
        title: title.replace(TWIN_COMMAND, ""),
      }
    : { section: { label: "Chat", href: "/" }, title };
