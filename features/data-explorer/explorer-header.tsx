import Link from "next/link";

import { formatNumber } from "@/infrastructure/format-measure";
import { cn } from "@/infrastructure/ui";

import { BLOCKED_COPY, DATA_LEDE, DATA_TITLE } from "./explorer-copy";
import { type CohortCount } from "./explorer-reads";

/**
 * The Data page's title, its three sections and the cohort picker. All links,
 * not client state: each view is its own URL, so it reloads and shares as is.
 * The selected link carries `aria-current`, which the `.segmented` look keys on.
 */

export type DataSection = "overview" | "subjects" | "training";

const SECTIONS: readonly (readonly [DataSection, string, string])[] = [
  ["overview", "Overview", "/data"],
  ["subjects", "Subjects", "/data/subjects"],
  ["training", "Training data", "/data/training"],
];

const withCohort = (path: string, cohortId: string | null) =>
  cohortId ? `${path}?cohort=${encodeURIComponent(cohortId)}` : path;

export const ExplorerHeader = ({
  section,
  cohortId,
}: {
  readonly section: DataSection;
  readonly cohortId: string | null;
}) => (
  <header>
    <h1 className="text-display">{DATA_TITLE}</h1>
    <p className="text-muted-foreground mt-2 max-w-2xl text-[15px] leading-relaxed">
      {DATA_LEDE}
    </p>
    <nav aria-label="Data sections" className="segmented mt-6 max-w-full flex-wrap">
      {SECTIONS.map(([id, label, path]) => (
        <Link
          key={id}
          href={withCohort(path, id === "training" ? null : cohortId)}
          aria-current={section === id ? "page" : undefined}
          className="segmented-item"
        >
          {label}
        </Link>
      ))}
    </nav>
  </header>
);

export const CohortPicker = ({
  cohorts,
  current,
  path,
}: {
  readonly cohorts: readonly CohortCount[];
  readonly current: string;
  readonly path: string;
}) => (
  <nav aria-label="Cohort" className="mt-6 flex flex-wrap items-center gap-2">
    <span className="text-eyebrow mr-1">Cohort</span>
    {cohorts.map((cohort) => (
      <Link
        key={cohort.cohortId}
        href={withCohort(path, cohort.cohortId)}
        aria-current={cohort.cohortId === current ? "true" : undefined}
        className={cn(
          "border-input rounded-md border px-2.5 py-1 font-mono text-xs transition-colors",
          cohort.cohortId === current
            ? "border-primary text-foreground bg-muted"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        {cohort.cohortId}
        <span className="text-muted-foreground">
          {" "}
          · {formatNumber(cohort.subjects, 0)}
        </span>
      </Link>
    ))}
  </nav>
);

export type BlockedKind = keyof typeof BLOCKED_COPY;

/** A plain sentence in place of the data, never a raw error. */
export const BlockedNotice = ({ kind }: { readonly kind: BlockedKind }) => (
  <div className="surface mt-6 px-5 py-6">
    <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
      {BLOCKED_COPY[kind]}
    </p>
  </div>
);

export const PageFrame = ({ children }: { readonly children: React.ReactNode }) => (
  <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">{children}</div>
);
