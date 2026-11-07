import type { ReactNode } from "react";

import { Card } from "./card";

/**
 * What a screen shows when this machine has not been set up for it yet: a
 * heading that says what is missing and a sentence on who can fill it. It
 * names no command (#480): the person reading it may not be the one who runs
 * TwinLLM, and the commands live in docs/runbook.md.
 */

export type SetupPanelProps = Readonly<{
  title: string;
  children: ReactNode;
  className?: string;
}>;

export const SetupPanel = ({ title, children, className }: SetupPanelProps) => (
  <Card as="section" padding="lg" className={className ?? "mt-6"}>
    <h2 className="font-display text-xl">{title}</h2>
    <div className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
      {children}
    </div>
  </Card>
);
