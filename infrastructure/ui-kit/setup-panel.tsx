import type { ReactNode } from "react";

import { Card } from "./card";

/**
 * What a screen shows when this machine has not been set up for it yet: a
 * heading that says what is missing, a sentence on why, and the commands that
 * fill it. Used by every page that would otherwise go blank without local data.
 */

export type SetupPanelProps = Readonly<{
  title: string;
  children: ReactNode;
  commands: readonly string[];
  className?: string;
}>;

export const SetupPanel = ({ title, children, commands, className }: SetupPanelProps) => (
  <Card as="section" padding="lg" className={className ?? "mt-6"}>
    <h2 className="font-display text-xl">{title}</h2>
    <div className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
      {children}
    </div>
    <pre className="bg-muted mt-4 overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed">
      {commands.join("\n")}
    </pre>
  </Card>
);
