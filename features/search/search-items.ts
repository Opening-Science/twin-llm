import { draftHref, INCOGNITO_HREF } from "@/infrastructure/shell-links";

import type { SearchItem } from "./search-model";

/**
 * What the search box can list without asking the server: the pages, the
 * `/` commands and the two actions. Built once per request by the shell
 * layout from the Lab's parts and the viewer's runnable commands, then
 * matched in the browser by `matchItems`. Pure.
 */

export type LabPage = Readonly<{ title: string; line: string; path: string }>;
export type CommandEntry = Readonly<{ name: string; description: string }>;

type Page = Readonly<{ title: string; href: string; keywords: string }>;

const page = ({ title, href, keywords }: Page): SearchItem => ({
  kind: "page",
  id: href,
  title,
  detail: href,
  href,
  keywords,
});

const BEFORE_LAB: readonly Page[] = [
  { title: "TwinLLM", href: "/", keywords: "new chat, compare models" },
  {
    title: "Customize",
    href: "/customize",
    keywords: "skills, agents, your data, import, connectors",
  },
  {
    title: "Customize · Agents",
    href: "/customize/agents",
    keywords: "roster, agent, auto, router, general, diet, sleep, trainer",
  },
  {
    title: "Customize · Connectors",
    href: "/customize/connectors",
    keywords: "wearables, Oura, Whoop, Google Health, Ark, genome",
  },
  { title: "Digital Twin", href: "/digital-twin", keywords: "body, anatomy, organs, 3D" },
  {
    title: "Customize · Data",
    href: "/customize/data",
    keywords: "your imports, synthetic cohort",
  },
  {
    title: "Synthetic cohort · Subjects",
    href: "/customize/data/cohort/subjects",
    keywords: "synthetic people list",
  },
  {
    title: "Synthetic cohort · Training data",
    href: "/customize/data/cohort/training",
    keywords: "training conversations",
  },
  { title: "Models", href: "/models", keywords: "catalogue, Ollama" },
  {
    title: "Lab",
    href: "/lab",
    keywords:
      "verify local only, audit chain, model digests, checksums, SBOM, heart rhythm simulations, evaluation runs, benchmark, second rating",
  },
];

const AFTER_LAB: readonly Page[] = [
  { title: "Docs", href: "/docs", keywords: "documentation" },
  { title: "Get started", href: "/start", keywords: "setup, onboarding" },
];

export const pageItems = (lab: readonly LabPage[]): readonly SearchItem[] => [
  ...BEFORE_LAB.map(page),
  ...lab.map(({ title, line, path }) =>
    page({ title: `Lab · ${title}`, href: path, keywords: line }),
  ),
  ...AFTER_LAB.map(page),
];

/** Each opens a new chat with the command typed in; nothing is sent. */
export const commandItems = (commands: readonly CommandEntry[]): readonly SearchItem[] =>
  commands.map(({ name, description }) => ({
    kind: "command",
    id: `/${name}`,
    title: `/${name}`,
    detail: description,
    href: draftHref(name),
  }));

export const ACTION_ITEMS: readonly SearchItem[] = [
  { kind: "action", id: "new-chat", title: "New chat", href: "/" },
  {
    kind: "action",
    id: "new-incognito-chat",
    title: "New incognito chat",
    detail: "not saved, local models only",
    href: INCOGNITO_HREF,
  },
];

export type StaticSearchItems = Readonly<{
  pages: readonly SearchItem[];
  commands: readonly SearchItem[];
  actions: readonly SearchItem[];
}>;

export const staticSearchItems = (
  input: Readonly<{ lab: readonly LabPage[]; commands: readonly CommandEntry[] }>,
): StaticSearchItems => ({
  pages: pageItems(input.lab),
  commands: commandItems(input.commands),
  actions: ACTION_ITEMS,
});
