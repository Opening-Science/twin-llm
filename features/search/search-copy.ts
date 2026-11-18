import type { Translated } from "@/infrastructure/locale/locale";

import { type SearchTab, TAB_LABELS } from "./search-model";
import {
  type GroupTitle,
  NOTHING_MATCHES,
  SEARCH_PRIVACY,
  WORDS_ONLY,
} from "./search-results";

/**
 * The search box's own words in English and German: the field, the type
 * tabs, the group headings and the lines around the results. What is found
 * (page names, commands, thread titles) keeps its own words.
 */

export type SearchCopy = Readonly<{
  dialog: string;
  placeholder: string;
  close: string;
  resultTypes: string;
  results: string;
  tabs: Readonly<Record<SearchTab, string>>;
  groups: Readonly<Record<GroupTitle, string>>;
  similar: string;
  nothingMatches: string;
  wordsOnly: string;
  privacy: string;
  hintClose: string;
  hintChangeType: string;
  hintOpen: string;
}>;

export const SEARCH_COPY: Translated<SearchCopy> = {
  en: {
    dialog: "Search",
    placeholder: "Search threads, pages, docs and commands",
    close: "Close search",
    resultTypes: "Result types",
    results: "Results",
    tabs: TAB_LABELS,
    groups: {
      Recents: "Recents",
      Actions: "Actions",
      Threads: "Threads",
      Pages: "Pages",
      Docs: "Docs",
      Commands: "Commands",
    },
    similar: "similar",
    nothingMatches: NOTHING_MATCHES,
    wordsOnly: WORDS_ONLY,
    privacy: SEARCH_PRIVACY,
    hintClose: "Close",
    hintChangeType: "Change type",
    hintOpen: "Open",
  },
  de: {
    dialog: "Suche",
    placeholder: "Unterhaltungen, Seiten, Doku und Befehle durchsuchen",
    close: "Suche schließen",
    resultTypes: "Ergebnisarten",
    results: "Ergebnisse",
    tabs: {
      all: "Alle",
      threads: "Unterhaltungen",
      pages: "Seiten",
      docs: "Doku",
      commands: "Befehle",
    },
    groups: {
      Recents: "Zuletzt",
      Actions: "Aktionen",
      Threads: "Unterhaltungen",
      Pages: "Seiten",
      Docs: "Doku",
      Commands: "Befehle",
    },
    similar: "ähnlich",
    nothingMatches: "Noch passt nichts dazu.",
    wordsOnly:
      "Nur nach Wörtern gesucht. Starte Ollama mit dem Embedding-Modell, um auch nach Bedeutung zu suchen.",
    privacy: "Nur deine eigenen Unterhaltungen. Abgeglichen auf diesem Rechner.",
    hintClose: "Schließen",
    hintChangeType: "Art wechseln",
    hintOpen: "Öffnen",
  },
};
