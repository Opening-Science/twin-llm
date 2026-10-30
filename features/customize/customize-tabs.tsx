"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Customize's parts: the skills you can run, the agents built on them
 * (#221), your twin notes (#43), the data you bring, and the services you link. Links, not buttons, so each part has its own address
 * and the browser's back button works.
 */
export const CUSTOMIZE_TABS = [
  { href: "/customize", label: "Skills" },
  { href: "/customize/agents", label: "Agents" },
  { href: "/customize/memory", label: "Memory" },
  { href: "/customize/data", label: "Data" },
  { href: "/customize/connectors", label: "Connectors" },
] as const;

export const currentTab = (path: string): string =>
  CUSTOMIZE_TABS.find(({ href }) => href !== "/customize" && path.startsWith(href))
    ?.href ?? "/customize";

export const CustomizeTabs = () => {
  const current = currentTab(usePathname());
  return (
    <nav aria-label="Customize" className="segmented mt-6">
      {CUSTOMIZE_TABS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={href === current ? "page" : undefined}
          className="segmented-item"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
};
