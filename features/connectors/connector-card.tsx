import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";
import { Card } from "@/infrastructure/ui-kit/card";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import type { ConnectorBadge } from "./connector-status";

/**
 * One card shape for every connector: name, one-line purpose, status badge,
 * an optional detail and notice, the primary action, then the Setup
 * disclosure. Each connector fills the slots; none draws its own frame, so the
 * grid lines up and every card reads the same way.
 */

export type ConnectorNotice = Readonly<{ text: string; tone: "info" | "warn" }>;

type ConnectorCardProps = Readonly<{
  name: string;
  purpose: string;
  badge: ConnectorBadge;
  /** Small line under the purpose, e.g. "Synced 3 h ago". */
  detail?: string | null;
  notice?: ConnectorNotice | null;
  /** Extra state such as "Viewing", shown beside the badge. */
  aside?: ReactNode;
  /** Highlights the card whose data the dashboard below is showing. */
  selected?: boolean;
  actions?: ReactNode;
  setup?: ReactNode;
  children?: ReactNode;
}>;

export const ConnectorCard = ({
  name,
  purpose,
  badge,
  detail,
  notice,
  aside,
  selected = false,
  actions,
  setup,
  children,
}: ConnectorCardProps) => {
  return (
    <Card
      as="article"
      className={cn(
        "flex flex-col transition-colors",
        selected && "bg-muted/50 border-foreground/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium">{name}</h3>
        <span className="flex shrink-0 items-center gap-2">
          {aside}
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </span>
      </div>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{purpose}</p>
      {detail && <p className="text-muted-foreground mt-1 text-xs">{detail}</p>}
      {notice && (
        <p
          role="status"
          className={cn(
            "mt-3 text-sm leading-relaxed",
            notice.tone === "warn" ? "text-destructive" : "text-foreground",
          )}
        >
          {notice.text}
        </p>
      )}
      {children}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      {setup && <div className="border-border mt-4 border-t pt-3">{setup}</div>}
    </Card>
  );
};

/** Same frame and height as a card, shown while a client-fetched status loads. */
export const ConnectorCardSkeleton = ({ name }: { readonly name: string }) => (
  <Card as="article" className="flex min-h-36 flex-col">
    <div className="flex items-start justify-between gap-3">
      <h3 className="text-sm font-medium">{name}</h3>
      <span className="bg-muted h-4 w-20 animate-pulse rounded" />
    </div>
    <span className="bg-muted mt-2 h-4 w-full animate-pulse rounded" />
    <span className="bg-muted mt-1.5 h-4 w-2/3 animate-pulse rounded" />
    <span className="sr-only">Loading {name} status</span>
  </Card>
);

/** The status request failed: say so instead of leaving a skeleton up. */
export const ConnectorCardUnavailable = ({
  name,
  purpose,
  setup,
}: Readonly<{ name: string; purpose: string; setup?: ReactNode }>) => (
  <ConnectorCard
    name={name}
    purpose={purpose}
    badge={{ label: "Error", tone: "warn" }}
    notice={{
      text: `Couldn’t read the ${name} status. Reload the page to try again.`,
      tone: "warn",
    }}
    setup={setup}
  />
);
