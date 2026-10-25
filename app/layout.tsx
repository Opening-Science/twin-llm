import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PostHogProvider } from "@/features/analytics/posthog-provider";
import { ThemeProvider } from "@/features/theme/theme-provider";
import { isClerkEnabled } from "@/infrastructure/public-env";

import "./globals.css";

export const metadata: Metadata = {
  title: "TwinLLM",
  description:
    "Research software: ask a question with optional wearable context and compare open models side by side, with each answer's reasoning and evidence.",
};

/** Clerk wraps the app only when it is configured; local runs have no sign-in. */
const WithAuth = ({ children }: Readonly<{ children: ReactNode }>) =>
  isClerkEnabled() ? <ClerkProvider>{children}</ClerkProvider> : children;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // The theme script sets the class on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <WithAuth>
            <PostHogProvider>{children}</PostHogProvider>
          </WithAuth>
        </ThemeProvider>
      </body>
    </html>
  );
}
