"use client";

import { useAuth } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { isClerkEnabled } from "@/infrastructure/public-env";

export type AppAuthState = {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean;
};

/** Client auth is off whenever Clerk is not enabled. */
export const isClientAuthDisabled = (): boolean => !isClerkEnabled();

function ClerkAuthBridge({
  children,
}: {
  readonly children: (auth: AppAuthState) => ReactNode;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  return <>{children({ isLoaded, isSignedIn: Boolean(isSignedIn) })}</>;
}

/**
 * Provides auth state without calling useAuth when ClerkProvider is absent.
 */
export function AppAuth({
  children,
}: {
  readonly children: (auth: AppAuthState) => ReactNode;
}) {
  if (!isClerkEnabled()) {
    return <>{children({ isLoaded: true, isSignedIn: true })}</>;
  }
  return <ClerkAuthBridge>{children}</ClerkAuthBridge>;
}
