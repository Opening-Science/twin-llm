import type { Translated } from "@/infrastructure/locale/locale";

import type { DayGroupLabel } from "./day-groups";
import type { SectionKey } from "./sections";

/**
 * The sidebar's own words in English and German. TwinLLM is a name and stays
 * as it is. The keys of `days` are the groups `groupByDay` returns, so a
 * group is translated where it is shown and never stored translated.
 */

export type ShellCopy = Readonly<{
  sectionsLabel: string;
  sections: Readonly<Record<SectionKey, string>>;
  yourThreads: string;
  newThread: string;
  untitledThread: string;
  locked: string;
  empty: string;
  signIn: string;
  days: Readonly<Record<DayGroupLabel, string>>;
  hideSidebar: string;
  keepSidebarOpen: string;
  openNavigation: string;
  closeNavigation: string;
  navigation: string;
  skipToContent: string;
  /** `count` already formatted; `one` says whether it is exactly one. */
  models: (count: string, one: boolean) => string;
}>;

export const SHELL_COPY: Translated<ShellCopy> = {
  en: {
    sectionsLabel: "Sections",
    sections: {
      home: "TwinLLM",
      twin: "Digital Twin",
      customize: "Customize",
      models: "Models",
      lab: "Lab",
      docs: "Docs",
      start: "Get started",
    },
    yourThreads: "Your threads",
    newThread: "New",
    untitledThread: "Thread",
    locked: "Locked. Unlock to see your threads.",
    empty: "No threads yet. Your first prompt starts one.",
    signIn: "Sign in to keep your threads and come back to them.",
    days: { Today: "Today", "This week": "This week", Earlier: "Earlier" },
    hideSidebar: "Hide sidebar",
    keepSidebarOpen: "Keep sidebar open",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    navigation: "Navigation",
    skipToContent: "Skip to content",
    models: (count, one) => `${count} ${one ? "model" : "models"}`,
  },
  de: {
    sectionsLabel: "Bereiche",
    sections: {
      home: "TwinLLM",
      twin: "Digitaler Zwilling",
      customize: "Anpassen",
      models: "Modelle",
      lab: "Labor",
      docs: "Doku",
      start: "Erste Schritte",
    },
    yourThreads: "Unterhaltungen",
    newThread: "Neu",
    untitledThread: "Unterhaltung",
    locked: "Gesperrt. Entsperre, um deine Unterhaltungen zu sehen.",
    empty: "Noch keine Unterhaltungen. Deine erste Frage beginnt eine.",
    signIn: "Melde dich an, um deine Unterhaltungen zu behalten und später fortzusetzen.",
    days: { Today: "Heute", "This week": "Diese Woche", Earlier: "Früher" },
    hideSidebar: "Seitenleiste ausblenden",
    keepSidebarOpen: "Seitenleiste offen lassen",
    openNavigation: "Navigation öffnen",
    closeNavigation: "Navigation schließen",
    navigation: "Navigation",
    skipToContent: "Zum Inhalt springen",
    models: (count, one) => `${count} ${one ? "Modell" : "Modelle"}`,
  },
};
