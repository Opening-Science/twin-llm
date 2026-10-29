import { type Metadata } from "next";
import { headers } from "next/headers";
import { type ReactNode } from "react";

import { ResearchFooter } from "@/features/shell/research-footer";
import { SYNTHEA_HOST_HEADER, syntheaPaths } from "@/features/synthea/synthea-paths";
import { ThemeToggle } from "@/features/theme/theme-toggle";

/** Reads the request's headers, so it renders per request. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Synthea generator · TwinLLM",
  description:
    "Generate a few synthetic patient records with Synthea, for research and software testing.",
};

/**
 * The generator's own frame: a header with its two pages, the theme toggle,
 * and a footer that credits Synthea. No sidebar and no link into the rest of
 * TwinLLM, because on its own host (synthea.opening.science) nothing else is
 * served.
 */
export default async function SyntheaLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const paths = syntheaPaths((await headers()).get(SYNTHEA_HOST_HEADER) === "1");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <a href={paths.home} className="flex flex-col rounded-sm leading-tight">
          <span className="font-display text-xl tracking-tight">Synthea generator</span>
          <span className="text-muted-foreground text-xs">
            Open Science Foundation · part of TwinLLM
          </span>
        </a>
        <nav aria-label="Generator" className="flex items-center gap-4 text-sm">
          <a href={paths.home} className="hover:text-foreground text-muted-foreground">
            Generate
          </a>
          <a href={paths.docs} className="hover:text-foreground text-muted-foreground">
            Docs
          </a>
          <ThemeToggle />
        </nav>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-border text-muted-foreground border-t px-4 py-3 text-center text-xs leading-relaxed">
        <p>
          Synthetic data only: every person here is made up by a simulation. Made with{" "}
          <a
            href="https://github.com/synthetichealth/synthea"
            className="underline underline-offset-2"
          >
            Synthea
          </a>{" "}
          {"("}© The MITRE Corporation, Apache License 2.0{")"}.
        </p>
      </footer>
      <ResearchFooter />
    </div>
  );
}
