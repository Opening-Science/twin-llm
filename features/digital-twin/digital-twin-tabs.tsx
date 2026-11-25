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
  <nav aria-label={PAGE_TITLE} className="segmented">
    {TABS.map(({ href, label }) => (
      <Link
        key={href}
        href={href}
        prefetch={false}
        aria-current={pathname === href ? "page" : undefined}
        className="segmented-item"
      >
        {label}
      </Link>
    ))}
  </nav>
);

export const DigitalTwinNav = () => <DigitalTwinTabs pathname={usePathname()} />;
