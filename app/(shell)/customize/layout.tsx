import type { ReactNode } from "react";

import { CustomizeTabs } from "@/features/customize/customize-tabs";

/** Customize: skills to run, data to bring, services to link. */
export default function CustomizeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-display">Customize</h1>
      <p className="text-muted-foreground mt-3 max-w-xl text-[15px] leading-relaxed">
        Skills you can run in a chat, the data TwinLLM can read for you, and the devices
        and services you link. Each says what it reads before it runs.
      </p>
      <CustomizeTabs />
      <div className="mt-8">{children}</div>
    </div>
  );
}
