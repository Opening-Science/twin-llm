"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/infrastructure/ui";

import { CUSTOMIZE_TABS, currentTab, useCustomizeNav } from "./customize-tabs";

/**
 * Customize's sections as a column of links on a wide screen (#457): the
 * same hrefs as the tab row, so every section keeps its address, and the
 * open one carries `aria-current`. The layout shows this column from `lg`
 * and the tab row below it, so only one of the two is ever on screen.
 */
export const CustomizeSections = ({ className }: Readonly<{ className?: string }>) => {
  const current = currentTab(usePathname());
  const { copy, lang } = useCustomizeNav();
  return (
    <nav
      lang={lang}
      aria-label={copy.navLabel}
      className={cn("customize-sections", className)}
    >
      {CUSTOMIZE_TABS.map(({ key, href }) => (
        <Link
          key={href}
          href={href}
          aria-current={href === current ? "page" : undefined}
          className="customize-section-link"
        >
          {copy.tabs[key]}
        </Link>
      ))}
    </nav>
  );
};
