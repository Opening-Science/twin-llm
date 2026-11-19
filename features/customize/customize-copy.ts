import type { Translated } from "@/infrastructure/locale/locale";

/**
 * Customize's own words in English and German: the title, the line under
 * it and the names of its sections. The sections' pages keep their English
 * until each has a table of its own.
 */

export type CustomizeTabKey =
  | "skills"
  | "agents"
  | "memory"
  | "tasks"
  | "data"
  | "connectors"
  | "privacy"
  | "settings";

export type CustomizeCopy = Readonly<{
  title: string;
  intro: string;
  navLabel: string;
  tabs: Readonly<Record<CustomizeTabKey, string>>;
}>;

export const CUSTOMIZE_COPY: Translated<CustomizeCopy> = {
  en: {
    title: "Customize",
    intro:
      "Skills you can run in a chat, the agents built on them, your twin notes, skills you scheduled, the data TwinLLM can read for you, the devices and services you link, whether anything may learn from your data, and every keep or withhold choice in Settings. Each says what it reads before it runs.",
    navLabel: "Customize",
    tabs: {
      skills: "Skills",
      agents: "Agents",
      memory: "Memory",
      tasks: "Tasks",
      data: "Data",
      connectors: "Connectors",
      privacy: "Privacy",
      settings: "Settings",
    },
  },
  de: {
    title: "Anpassen",
    intro:
      "Skills, die du in einem Chat ausführst, die Agenten darauf, deine Notizen, geplante Skills, die Daten, die TwinLLM für dich lesen darf, die Geräte und Dienste, die du verbindest, ob etwas aus deinen Daten lernen darf, und jede Wahl zum Behalten oder Zurückhalten unter Einstellungen. Jeder Teil sagt, was er liest, bevor er läuft.",
    navLabel: "Anpassen",
    tabs: {
      skills: "Skills",
      agents: "Agenten",
      memory: "Notizen",
      tasks: "Aufgaben",
      data: "Daten",
      connectors: "Verbindungen",
      privacy: "Datenschutz",
      settings: "Einstellungen",
    },
  },
};
