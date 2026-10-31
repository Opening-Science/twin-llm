"use client";

import { useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";

import { VAULT_COPY } from "./vault-copy";

/**
 * The lock control at the foot of the sidebar (#142). Unlocked, it locks the
 * data now and reloads, so every personal page shows the unlock screen.
 * Locked, it only says so.
 */
export const LockButton = ({ unlocked }: Readonly<{ unlocked: boolean }>) => {
  const [failed, setFailed] = useState(false);
  if (!unlocked) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <LockShape />
        {VAULT_COPY.locked}
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      title={failed ? VAULT_COPY.lockFailed : "Lock your personal data now"}
      onClick={() => {
        void fetch("/api/vault/lock", { method: "POST", credentials: "same-origin" })
          .then((response) => {
            if (!response.ok) throw new Error("lock refused");
            window.location.replace(window.location.href);
          })
          .catch(() => setFailed(true));
      }}
    >
      <LockShape />
      {failed ? VAULT_COPY.lockFailed : VAULT_COPY.lock}
    </Button>
  );
};

const LockShape = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
