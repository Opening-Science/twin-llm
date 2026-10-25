"use client";

import { cn } from "@/infrastructure/ui";

import type { WearableStatus } from "./use-wearable-status";

type WearableId = "oura" | "whoop" | "google-health";

type WearableSlashProps = {
  readonly open: boolean;
  readonly oura: WearableStatus | null;
  readonly whoop: WearableStatus | null;
  readonly googleHealth: WearableStatus | null;
  readonly onClose: () => void;
  readonly onConnectedAction?: (id: WearableId) => void;
};

const CheckMark = () => (
  <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden>
    <path d="M6.4 11.3 3.3 8.2l1.1-1.1 2 2 5.2-5.2 1.1 1.1z" />
  </svg>
);

const rows: readonly {
  id: WearableId;
  label: string;
  hint: string;
  authorizeHref: string;
}[] = [
  {
    id: "oura",
    label: "Oura Ring",
    hint: "Sleep, readiness, HRV, activity",
    authorizeHref: "/api/oura/authorize",
  },
  {
    id: "whoop",
    label: "Whoop",
    hint: "Recovery, strain, sleep performance",
    authorizeHref: "/api/whoop/authorize",
  },
  {
    id: "google-health",
    label: "Google Health",
    hint: "Fitbit-linked steps, sleep, HRV, activity",
    authorizeHref: "/api/google-health/authorize",
  },
];

const rowDetail = (params: {
  connected: boolean;
  configured: boolean;
  hint: string;
}): string => {
  if (params.connected) return "Linked — metrics available for this chat";
  if (!params.configured) return "Unavailable in this workspace";
  return params.hint;
};

/**
 * Slash-menu to attach wearables, same idea as `/` skills in chat UIs.
 * Connected items show a check; picking an unconnected configured item starts OAuth.
 */
export const WearableSlashMenu = ({
  open,
  oura,
  whoop,
  googleHealth,
  onClose,
  onConnectedAction,
}: WearableSlashProps) => {
  if (!open) return null;

  const statusFor = (id: WearableId) => {
    if (id === "oura") return oura;
    if (id === "whoop") return whoop;
    return googleHealth;
  };

  return (
    <div
      className="border-border bg-background absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-lg border shadow-md"
      role="listbox"
      aria-label="Add a wearable"
    >
      <div className="border-border border-b px-3 py-2">
        <p className="text-eyebrow">Connectors</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
          Link a device so answers can cite your recent metrics.
        </p>
      </div>
      <ul className="p-1.5">
        {rows.map((row) => {
          const status = statusFor(row.id);
          const connected = Boolean(status?.connected);
          const configured = Boolean(status?.configured);
          const disabled = !connected && !configured;

          return (
            <li key={row.id}>
              <button
                type="button"
                role="option"
                aria-selected={connected}
                disabled={disabled && !connected}
                onClick={() => {
                  if (connected) {
                    onConnectedAction?.(row.id);
                    onClose();
                    return;
                  }
                  if (configured) {
                    window.location.href = row.authorizeHref;
                    return;
                  }
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  disabled && !connected ? "opacity-45" : "hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
                    connected
                      ? "border-foreground bg-foreground text-background"
                      : "border-input",
                  )}
                >
                  {connected ? <CheckMark /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {row.label}
                    {connected ? (
                      <span className="text-muted-foreground text-[10px] font-normal tracking-wide uppercase">
                        linked
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
                    {rowDetail({ connected, configured, hint: row.hint })}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

type WearableChipsProps = {
  readonly oura: WearableStatus | null;
  readonly whoop: WearableStatus | null;
  readonly googleHealth: WearableStatus | null;
  readonly onDisconnectOura?: () => void;
  readonly onDisconnectWhoop?: () => void;
  readonly onDisconnectGoogleHealth?: () => void;
};

/** Skill-style chips for wearables that are already linked. */
export const WearableChips = ({
  oura,
  whoop,
  googleHealth,
  onDisconnectOura,
  onDisconnectWhoop,
  onDisconnectGoogleHealth,
}: WearableChipsProps) => {
  const chips: { id: string; label: string; onRemove?: () => void }[] = [];
  if (oura?.connected) {
    chips.push({
      id: "oura",
      label: "Oura",
      onRemove: onDisconnectOura,
    });
  }
  if (whoop?.connected) {
    chips.push({
      id: "whoop",
      label: "Whoop",
      onRemove: onDisconnectWhoop,
    });
  }
  if (googleHealth?.connected) {
    chips.push({
      id: "google-health",
      label: "Google Health",
      onRemove: onDisconnectGoogleHealth,
    });
  }
  if (chips.length === 0) return null;

  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="border-foreground/25 bg-muted/40 text-foreground inline-flex items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-2.5 text-xs font-medium"
          title={`${chip.label} linked`}
        >
          <span className="bg-foreground size-1.5 rounded-full" aria-hidden />
          {chip.label}
          {chip.onRemove ? (
            <button
              type="button"
              onClick={chip.onRemove}
              className="text-muted-foreground hover:text-foreground rounded-full p-0.5 transition-colors"
              aria-label={`Disconnect ${chip.label}`}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          ) : null}
        </span>
      ))}
    </>
  );
};
