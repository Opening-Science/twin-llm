"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PAGE_TITLE, YOUR_DAY, YOUR_TEN_DAYS, YOUR_TWIN } from "./twin-page-copy";

const TABS = [
  { href: "/digital-twin", label: YOUR_TWIN },
  { href: "/digital-twin/your-day", label: YOUR_DAY },
  { href: "/digital-twin/your-10-days", label: YOUR_TEN_DAYS },
] as const;

export const DigitalTwinTabs = ({ pathname }: Readonly<{ pathname: string }>) => (
  <nav aria-label={PAGE_TITLE} className="mt-4 flex flex-wrap gap-1 border-b">
    {TABS.map(({ href, label }) => (
      <Link
        key={href}
        href={href}
        prefetch={false}
        aria-current={pathname === href ? "page" : undefined}
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-inset aria-[current=page]:font-semibold"
      >
        {label}
      </Link>
    ))}
  </nav>
);

export const DigitalTwinNav = () => <DigitalTwinTabs pathname={usePathname()} />;
