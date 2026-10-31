import type { ReactNode } from "react";

import { CustomizeTabs } from "@/features/customize/customize-tabs";

/** Customize: skills to run, agents built on them, twin notes, scheduled tasks, data to bring, services to link, consent. */
export default function CustomizeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-display">Customize</h1>
      <p className="text-muted-foreground mt-3 max-w-xl text-[15px] leading-relaxed">
        Skills you can run in a chat, the agents built on them, your twin notes, skills
        you scheduled, the data TwinLLM can read for you, the devices and services you
        link, and whether anything may learn from your data. Each says what it reads
        before it runs.
      </p>
      <CustomizeTabs />
      <div className="mt-8">{children}</div>
    </div>
  );
}
