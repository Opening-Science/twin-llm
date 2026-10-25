import Link from "next/link";

import { ResearchFooter } from "@/features/shell/research-footer";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { serverEnv } from "@/infrastructure/env";

/** Focus screens (the /start onboarding) need request-time auth and DB, like the shell. */
export const dynamic = "force-dynamic";

/**
 * A screen with one job and no sidebar: the first-run card. It keeps the
 * research footer and the theme toggle, and the wordmark goes home.
 */
export default function FocusLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const env = serverEnv();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-display rounded-sm text-xl tracking-tight">
          TwinLLM
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <ResearchFooter
        residency={{ localOnly: env.LOCAL_ONLY, provider: env.LLM_PROVIDER }}
      />
    </div>
  );
}
