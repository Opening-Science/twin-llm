import { formatDate } from "@/infrastructure/format-measure";

/**
 * The dashboard's sections, in order, and the words around them. Each
 * section is a first look at one part of the app and links to the page that
 * holds the rest. Pure, so the copy is tested and `lint:claims` sees it.
 */

export type DashboardSectionId = "wearables" | "twin" | "chat";

export type DashboardSection = Readonly<{
  id: DashboardSectionId;
  title: string;
  line: string;
  href: string;
  linkLabel: string;
}>;

export const DASHBOARD_TITLE = "Dashboard";

export const DASHBOARD_INTRO =
  "A first look at the main parts of TwinLLM: your wearables, your digital twin and your conversations. Research use only, not clinical advice.";

export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  {
    id: "wearables",
    title: "Wearables",
    line: "Your linked wearables in the same cards as Connectors. Each card names the device its numbers came from.",
    href: "/customize/connectors",
    linkLabel: "Open Connectors",
  },
  {
    id: "twin",
    title: "Digital Twin",
    line: "The body twin and “Show me my day”, on synthetic people only.",
    href: "/digital-twin",
    linkLabel: "Open the Digital Twin",
  },
  {
    id: "chat",
    title: "Chat",
    line: "Your recent conversations, and a way to start a new one.",
    href: "/",
    linkLabel: "Ask a new question",
  },
];

/**
 * The spot under the twin where "Replay my day" will open once the replay
 * work lands (#860–#867). Named here so the link has one place to go; until
 * then it has no link and says so.
 */
export const REPLAY_MY_DAY = {
  id: "replay-my-day",
  title: "Replay my day",
  line: "A day played back on the twin. It opens from here once the replay is built.",
  href: null,
  status: "Coming",
} as const;

export const RECENT_CHATS = {
  shown: 5,
  label: "Recent conversations",
  empty: "No conversations yet. Ask a question and it shows here and in the sidebar.",
} as const;

/** "17 Nov 2026 · 1 model": the last activity's day and how many models answered, when any did. */
export const recentChatMeta = (updatedAt: string, modelCount: number): string => {
  const day = formatDate(new Date(updatedAt));
  return modelCount === 0
    ? day
    : `${day} · ${modelCount} ${modelCount === 1 ? "model" : "models"}`;
};
