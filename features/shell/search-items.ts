import type { Command } from "@/features/commands/registry";
import type { SearchItem } from "@/features/search/search-model";
import { draftHref, INCOGNITO_HREF } from "@/infrastructure/shell-links";

/**
 * What the search box finds without asking the server: the app's pages, the
 * `/` commands and a few actions. Pages carry a few extra words so "wearable"
 * finds Connectors and "cohort" finds Data.
 */

const PAGES: readonly (SearchItem & { kind: "page" })[] = [
  {
    kind: "page",
    id: "home",
    title: "TwinLLM",
    detail: "new chat, compare models",
    href: "/",
  },
  {
    kind: "page",
    id: "customize",
    title: "Customize",
    detail: "skills, your data, import, connectors",
    href: "/customize",
  },
  {
    kind: "page",
    id: "connectors",
    title: "Customize · Connectors",
    detail: "wearables Oura Whoop Google Health Ark genome",
    href: "/customize/connectors",
  },
  {
    kind: "page",
    id: "digital-twin",
    title: "Digital Twin",
    detail: "body anatomy organs 3D",
    href: "/digital-twin",
  },
  {
    kind: "page",
    id: "data",
    title: "Data",
    detail: "synthetic cohort warehouse",
    href: "/data",
  },
  {
    kind: "page",
    id: "data-subjects",
    title: "Data · Subjects",
    detail: "synthetic people list",
    href: "/data/subjects",
  },
  {
    kind: "page",
    id: "data-training",
    title: "Data · Training data",
    detail: "training conversations",
    href: "/data/training",
  },
  {
    kind: "page",
    id: "models",
    title: "Models",
    detail: "catalogue Ollama",
    href: "/models",
  },
  { kind: "page", id: "docs", title: "Docs", detail: "documentation", href: "/docs" },
  {
    kind: "page",
    id: "start",
    title: "Get started",
    detail: "setup onboarding",
    href: "/start",
  },
];

export const ACTIONS: readonly SearchItem[] = [
  { kind: "action", id: "new-chat", title: "New chat", href: "/" },
  {
    kind: "action",
    id: "new-incognito",
    title: "New incognito chat",
    detail: "not saved, local models only",
    href: INCOGNITO_HREF,
  },
];

export const staticItems = (commands: readonly Command[]): readonly SearchItem[] => [
  ...PAGES,
  ...commands.map((command): SearchItem => ({
    kind: "command",
    id: command.name,
    title: `/${command.name}`,
    detail: command.description,
    href: draftHref(command.name),
  })),
  ...ACTIONS,
];
