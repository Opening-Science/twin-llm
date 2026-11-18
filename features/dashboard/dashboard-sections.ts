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
