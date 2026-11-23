import { type ReactNode } from "react";

import { DigitalTwinNav } from "./digital-twin-tabs";
import { PAGE_TITLE } from "./twin-page-copy";

export const DigitalTwinFrame = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="page-wide">
    <h1 className="text-display">{PAGE_TITLE}</h1>
    <DigitalTwinNav />
    {children}
  </div>
);

export const DigitalTwinPlaceholder = ({ title }: Readonly<{ title: string }>) => (
  <section className="surface mt-6 px-4 py-5">
    <h2 className="font-display text-2xl tracking-tight">{title}</h2>
    <p className="text-muted-foreground mt-2 text-sm">This view is not yet available.</p>
  </section>
);
