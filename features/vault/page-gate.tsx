import "server-only";

import { type ReactNode } from "react";

import { vaultDecisionForPage } from "@/infrastructure/vault-runtime";

import { VaultScreen } from "./vault-screen";
import { firstStep } from "./vault-screen-model";

/**
 * The gate for a personal page (#142): the unlock (or first-run setup)
 * screen while the data is locked, or null when the page may read. Call it
 * before any read: `const locked = await lockedScreen(); if (locked) return locked;`
 * A sign-in refusal is left to the page, which already says so.
 */
export const lockedScreen = async (): Promise<ReactNode | null> => {
  const decision = await vaultDecisionForPage();
  if (decision.ok || decision.status === 401) return null;
  return <VaultScreen initialStep={firstStep(decision.code)} />;
};
