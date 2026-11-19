"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useCopy, useLocale } from "@/infrastructure/locale/locale-provider";
import { htmlLang } from "@/infrastructure/locale/locale";

import { CUSTOMIZE_COPY, type CustomizeTabKey } from "./customize-copy";
import { centredScrollLeft, type RowOverflow, rowOverflow } from "./row-overflow";

/**
 * Customize's parts: the skills you can run, the agents built on them
 * (#221), your twin notes (#43), scheduled skill runs (#54), the data you bring, the services you link, consent to learn from your data (#145), and every keep or withhold choice in one list (#507). Links, not buttons, so each part has its own address
 * and the browser's back button works. Their names are in `customize-copy.ts`.
 */
export const CUSTOMIZE_TABS: readonly Readonly<{ key: CustomizeTabKey; href: string }>[] =
  [
    { key: "skills", href: "/customize" },
    { key: "agents", href: "/customize/agents" },
    { key: "memory", href: "/customize/memory" },
    { key: "tasks", href: "/customize/tasks" },
    { key: "data", href: "/customize/data" },
    { key: "connectors", href: "/customize/connectors" },
    { key: "privacy", href: "/customize/privacy" },
    { key: "settings", href: "/customize/settings" },
  ];

/** The words and `lang` of Customize's section links, in the viewer's language. */
export const useCustomizeNav = () => {
  const copy = useCopy(CUSTOMIZE_COPY);
  return { copy, lang: htmlLang(useLocale()) };
};

export const currentTab = (path: string): string =>
  CUSTOMIZE_TABS.find(({ href }) => href !== "/customize" && path.startsWith(href))
    ?.href ?? "/customize";

export const CustomizeTabs = () => {
  const current = currentTab(usePathname());
  const { copy, lang } = useCustomizeNav();
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
    // The language changes the tabs' widths, so the row is centred again.
  }, [current, lang]);

  return (
    <nav
      ref={nav}
      lang={lang}
      aria-label={copy.navLabel}
      className="segmented mt-6"
      data-more-start={more.start || undefined}
      data-more-end={more.end || undefined}
    >
      {CUSTOMIZE_TABS.map(({ key, href }) => (
        <Link
          key={href}
          href={href}
          aria-current={href === current ? "page" : undefined}
          className="segmented-item"
        >
          {copy.tabs[key]}
        </Link>
      ))}
    </nav>
  );
};
