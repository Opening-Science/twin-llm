/**
 * The thread bar's breadcrumb, as values: which section a saved thread
 * belongs to and the title as shown. Pure.
 */

export type ThreadCrumb = Readonly<{
  section: Readonly<{ label: "Chat" | "Twin"; href: "/" | "/digital-twin" }>;
  /** What the bar shows. */
  title: string;
  /** The whole title, as a hover title, when `title` was cut. */
  full?: string;
}>;

export const CRUMB_MAX = 60;
const TWIN = /^\/twin(?:\s+|$)/i;

/** The id in `/t/<id>`, or null on any other page. */
export const threadIdOfPath = (path: string | null): string | null => {
  if (path === null || !path.startsWith("/t/")) return null;
  const id = path.slice(3).split("/")[0] ?? "";
  if (id === "") return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

export const threadCrumb = (title: string | null): ThreadCrumb => {
  const flat = (title ?? "").replace(/\s+/g, " ").trim();
  const twin = TWIN.test(flat);
  const text = twin ? flat.replace(TWIN, "").trim() : flat;
  const section = twin
    ? ({ label: "Twin", href: "/digital-twin" } as const)
    : ({ label: "Chat", href: "/" } as const);
  if (text === "") return { section, title: "Thread" };
  if (text.length <= CRUMB_MAX) return { section, title: text };
  return { section, title: `${text.slice(0, CRUMB_MAX - 1).trimEnd()}…`, full: text };
};
