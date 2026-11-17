/**
 * The sidebar's section links, in order, and which one is current. Pure.
 */

export type SectionKey =
  "home" | "twin" | "customize" | "models" | "lab" | "docs" | "start";

export type Section = Readonly<{ key: SectionKey; label: string; href: string }>;

export const SECTIONS: readonly Section[] = [
  { key: "home", label: "TwinLLM", href: "/" },
  { key: "twin", label: "Digital Twin", href: "/digital-twin" },
  { key: "customize", label: "Customize", href: "/customize" },
  { key: "models", label: "Models", href: "/models" },
  { key: "lab", label: "Lab", href: "/lab" },
  { key: "docs", label: "Docs", href: "/docs" },
  { key: "start", label: "Get started", href: "/start" },
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

/** "1 model", "3 models", "1,204 models". */
export const modelCountText = (
  count: number,
  format: (value: number) => string,
): string => `${format(count)} ${count === 1 ? "model" : "models"}`;
