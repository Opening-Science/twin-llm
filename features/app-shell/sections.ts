/**
 * The sidebar's section links, in order, and which one is current. Pure.
 * Their names are in `shell-copy.ts`, one per language.
 */

export type SectionKey =
  "home" | "twin" | "customize" | "models" | "lab" | "docs" | "start";

export type Section = Readonly<{ key: SectionKey; href: string }>;

export const SECTIONS: readonly Section[] = [
  { key: "home", href: "/" },
  { key: "twin", href: "/digital-twin" },
  { key: "customize", href: "/customize" },
  { key: "models", href: "/models" },
  { key: "lab", href: "/lab" },
  { key: "docs", href: "/docs" },
  { key: "start", href: "/start" },
];

/**
 * Home is current on `/` and on any saved thread (the compare screen is
 * both); every other section on its path and anything under it after a
 * slash (`/models/x`, never `/modelsx`).
 */
export const isCurrentSection = (href: string, path: string | null): boolean => {
  if (path === null) return false;
  if (href === "/") return path === "/" || path.startsWith("/t/");
  return path === href || path.startsWith(`${href}/`);
};
