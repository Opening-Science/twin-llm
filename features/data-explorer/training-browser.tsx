import Link from "next/link";

import { formatNumber } from "@/infrastructure/format-measure";
import { cn } from "@/infrastructure/ui";
import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";
import { SetupPanel } from "@/infrastructure/ui-kit/setup-panel";

import { BarList } from "./bar-list";
import { COHORT_ROLES, EVAL_COHORT_ID } from "./explorer-copy";
import { type TrainingSet, type TrainingSetDetail } from "./training-files";
import { countBy, type Count, pageMeta } from "./training-sets";
import { COHORT_TRAINING } from "./data-paths";

/**
 * The Training tab: the conversation sets in `training-data/out/`, one set's
 * counts per family and outcome, and a paged list that opens one
 * conversation. Server-rendered links throughout, like the rest of the page.
 */

export const trainingHref = (
  set: string,
  options: Readonly<{ family?: string | null; page?: number }> = {},
): string => {
  const params = new URLSearchParams({ set });
  if (options.family) params.set("family", options.family);
  if (options.page && options.page > 1) params.set("page", String(options.page));
  return `${COHORT_TRAINING}?${params}`;
};

export const conversationHref = (set: string, index: number): string =>
  `${COHORT_TRAINING}/${encodeURIComponent(set)}/${index + 1}`;

const Code = ({ children }: { readonly children: React.ReactNode }) => (
  <code className="setup-code">{children}</code>
);

export const NoTrainingSets = () => (
  <SetupPanel
    title="No training conversations yet"
    commands={[
      "bun run setup:local   # loads the evaluation cohort and writes a sample set",
      "",
      "# or, with the evaluation cohort already loaded, the sample alone:",
      "bun run training:sample",
      "",
      "# a full set, from a synthetic-only database (docs/training-data.md):",
      "cp .env.synthetic.example .env.training",
      "bun run training:conversations -- --cohort synthea-v4-seed4242",
    ]}
  >
    <p>
      Conversation sets live in <Code>training-data/out/</Code> (gitignored). Setup writes
      a small sample there: 12 subjects of the synthetic evaluation cohort, every number
      read by the real query tools. It is for looking at, never for training. It needs{" "}
      <Code>DATA_MODE=synthetic</Code> and the evaluation cohort in the warehouse.
    </p>
  </SetupPanel>
);

const SetPicker = ({
  sets,
  current,
}: {
  readonly sets: readonly TrainingSet[];
  readonly current: string;
}) => (
  <nav aria-label="Conversation set" className="mt-6 flex flex-wrap items-center gap-2">
    <span className="text-eyebrow mr-1">Set</span>
    {sets.map((set) => (
      <Link
        key={set.name}
        href={trainingHref(set.name)}
        aria-current={set.name === current ? "true" : undefined}
        className={cn(
          "border-input rounded-md border px-2.5 py-1 font-mono text-xs transition-colors",
          set.name === current
            ? "border-primary text-foreground bg-muted"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        {set.name}
        {set.manifest && (
          <span className="text-muted-foreground">
            {" "}
            · {formatNumber(set.manifest.conversations, 0)}
          </span>
        )}
      </Link>
    ))}
  </nav>
);

const countsBars = (counts: readonly Count[], total: number, noun: string) =>
  counts.map((count) => ({
    id: count.key,
    label: count.key,
    fraction: total > 0 ? count.count / Math.max(...counts.map((c) => c.count)) : 0,
    valueText: formatNumber(count.count, 0),
    detail: [
      [noun, count.key],
      ["Conversations", formatNumber(count.count, 0)],
    ] as const,
  }));

export const TrainingBrowser = ({
  sets,
  set,
  family,
  page,
}: {
  readonly sets: readonly TrainingSet[];
  readonly set: TrainingSetDetail;
  readonly family: string | null;
  readonly page: number;
}) => {
  const rows = set.meta?.rows ?? [];
  const families = countBy(rows, (row) => row.family);
  const outcomes = countBy(rows, (row) => row.outcome);
  const listed = pageMeta(rows, family, page);
  const cohortId = set.manifest?.cohort_id ?? rows[0]?.cohort_id ?? null;

  return (
    <>
      <SetPicker sets={sets} current={set.name} />

      <Card as="section" padding="lg" className="mt-6">
        <h2 className="font-display text-xl">{set.name}</h2>
        {set.manifest ? (
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            {formatNumber(set.manifest.conversations, 0)} conversations from{" "}
            {formatNumber(set.manifest.subjects, 0)} subjects of{" "}
            <span className="font-mono">{set.manifest.cohort_id}</span>, seed{" "}
            {set.manifest.seed}
            {set.manifest.anchor_day ? `, anchored on ${set.manifest.anchor_day}` : ""}.
          </p>
        ) : (
          <p className="text-muted-foreground mt-1 text-sm">
            No manifest beside this file, so only the meta lines are counted.
          </p>
        )}
        {cohortId === EVAL_COHORT_ID && (
          <p className="mt-2 text-sm font-medium">
            Made from the evaluation cohort: a smoke set to look at, never to train on.
          </p>
        )}
        {cohortId && COHORT_ROLES[cohortId] && cohortId !== EVAL_COHORT_ID && (
          <p className="text-muted-foreground mt-2 text-sm">{COHORT_ROLES[cohortId]}</p>
        )}
        {set.meta === null && (
          <p className="text-muted-foreground mt-2 text-sm">
            No meta file beside this set, so conversations cannot be listed by family.
          </p>
        )}
        {set.meta && set.meta.skipped > 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            {formatNumber(set.meta.skipped, 0)} meta lines did not parse and are left out.
          </p>
        )}
        {rows.length > 0 && (
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">By family</h3>
              <div className="mt-2">
                <BarList
                  label="Conversations per family"
                  items={countsBars(families, rows.length, "Family")}
                />
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium">By outcome</h3>
              <div className="mt-2">
                <BarList
                  label="Conversations per outcome"
                  items={countsBars(outcomes, rows.length, "Outcome")}
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {rows.length > 0 && (
        <section className="mt-6">
          <nav aria-label="Filter by family" className="flex flex-wrap gap-2">
            {[null, ...families.map((f) => f.key)].map((name) => (
              <Link
                key={name ?? "all"}
                href={trainingHref(set.name, { family: name })}
                aria-current={name === family ? "true" : undefined}
                className={cn(
                  "border-input rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                  name === family
                    ? "border-primary text-foreground bg-muted"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {name ?? "all"}
              </Link>
            ))}
          </nav>

          <div className="surface relative mt-3 overflow-x-auto">
            <table className="w-full min-w-xl border-collapse text-sm">
              <caption className="sr-only">Conversations in {set.name}</caption>
              <thead>
                <tr className="border-border border-b">
                  {["#", "Family", "Outcome", "Tools", "Subject"].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="text-eyebrow px-3 py-2.5 text-left"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listed.rows.map((row) => (
                  <tr
                    key={row.index}
                    className="border-border hover:bg-muted/50 border-b last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={conversationHref(set.name, row.index)}
                        className="underline-offset-2 hover:underline"
                      >
                        {row.index + 1}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.family}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.outcome}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.tool_calls.length > 0 ? row.tool_calls.join(", ") : "none"}
                    </td>
                    <td
                      className="max-w-[8rem] truncate px-3 py-2 font-mono text-xs"
                      title={row.subject_ref ?? undefined}
                    >
                      {row.subject_ref ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label="Pages" className="mt-3 flex items-center justify-end gap-2">
            {listed.page > 1 && (
              <Link
                href={trainingHref(set.name, { family, page: listed.page - 1 })}
                className={buttonClassName({ size: "sm" })}
              >
                Previous
              </Link>
            )}
            <span className="text-muted-foreground font-mono text-xs">
              {formatNumber(listed.matching, 0)} conversations · page {listed.page} of{" "}
              {listed.pages}
            </span>
            {listed.page < listed.pages && (
              <Link
                href={trainingHref(set.name, { family, page: listed.page + 1 })}
                className={buttonClassName({ size: "sm" })}
              >
                Next
              </Link>
            )}
          </nav>
        </section>
      )}
    </>
  );
};
