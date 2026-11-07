"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { centredScrollLeft, type RowOverflow, rowOverflow } from "./row-overflow";

/**
 * Customize's parts: the skills you can run, the agents built on them
 * (#221), your twin notes (#43), scheduled skill runs (#54), the data you bring, the services you link, and consent to learn from your data (#145). Links, not buttons, so each part has its own address
 * and the browser's back button works.
 */
export const CUSTOMIZE_TABS = [
  { href: "/customize", label: "Skills" },
  { href: "/customize/agents", label: "Agents" },
  { href: "/customize/memory", label: "Memory" },
  { href: "/customize/tasks", label: "Tasks" },
  { href: "/customize/data", label: "Data" },
  { href: "/customize/connectors", label: "Connectors" },
  { href: "/customize/privacy", label: "Privacy" },
] as const;

export const currentTab = (path: string): string =>
  CUSTOMIZE_TABS.find(({ href }) => href !== "/customize" && path.startsWith(href))
    ?.href ?? "/customize";

export const CustomizeTabs = () => {
  const current = currentTab(usePathname());
  const nav = useRef<HTMLElement>(null);
  const [more, setMore] = useState<RowOverflow>({ start: false, end: false });

  // On a phone the row scrolls sideways (#485): the side with more tabs fades
  // out, and the open tab, or the one reached by keyboard, sits in the
  // middle, clear of the fades. Only the row moves, never the page around it.
  useEffect(() => {
    const row = nav.current;
    if (!row) return;
    const measure = () => setMore(rowOverflow(row));
    const centre = (tab: HTMLElement) => {
      row.scrollLeft = centredScrollLeft(
        tab.offsetLeft - row.offsetLeft,
        tab.offsetWidth,
        row.clientWidth,
      );
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) centre(event.target);
    };
    const open = row.querySelector<HTMLElement>('[aria-current="page"]');
    if (open) centre(open);
    measure();
    row.addEventListener("scroll", measure, { passive: true });
    row.addEventListener("focusin", onFocus);
    const resize = new ResizeObserver(measure);
    resize.observe(row);
    return () => {
      row.removeEventListener("scroll", measure);
      row.removeEventListener("focusin", onFocus);
      resize.disconnect();
    };
  }, [current]);

  return (
    <nav
      ref={nav}
      aria-label="Customize"
      className="segmented mt-6"
      data-more-start={more.start || undefined}
      data-more-end={more.end || undefined}
    >
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
