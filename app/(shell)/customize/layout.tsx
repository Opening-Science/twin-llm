import type { ReactNode } from "react";

import { CUSTOMIZE_COPY } from "@/features/customize/customize-copy";
import { CustomizeSections } from "@/features/customize/customize-sections";
import { CustomizeTabs } from "@/features/customize/customize-tabs";
import { htmlLang } from "@/infrastructure/locale/locale";
import { serverLocale } from "@/infrastructure/locale/server-locale";

/**
 * Customize: skills to run, agents built on them, twin notes, scheduled
 * tasks, data to bring, services to link, consent. One section shows at a
 * time: on a wide screen the sections are a column on the left (#457), on a
 * phone the tab row above. The title, the line under it and the section
 * names follow the interface language; the sections themselves are English.
 */
export default async function CustomizeLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale = await serverLocale();
  const copy = CUSTOMIZE_COPY[locale];
  return (
    <div className="page-wide">
      <div lang={htmlLang(locale)}>
        <h1 className="text-display">{copy.title}</h1>
        <p className="text-muted-foreground mt-3 max-w-xl text-[15px] leading-relaxed">
          {copy.intro}
        </p>
      </div>
      <div className="lg:hidden">
        <CustomizeTabs />
      </div>
      <div className="customize-body">
        <CustomizeSections className="hidden lg:flex" />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
