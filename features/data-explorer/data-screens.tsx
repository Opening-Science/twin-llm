import Link from "next/link";

import { buttonClassName } from "@/infrastructure/ui-kit/button";

import { CohortOverview } from "./cohort-overview";
import { conversationHref } from "./training-browser";
import { ConversationView } from "./conversation-view";
import { TRAINING_FAILED } from "./explorer-copy";
import {
  BlockedNotice,
  CohortPicker,
  ExplorerHeader,
  PageFrame,
} from "./explorer-header";
import { explorerDeps } from "./explorer-ports";
import {
  type Blocked,
  type ExplorerDeps,
  loadCohorts,
  loadOverview,
  loadSubject,
  loadSubjects,
  pickCohort,
} from "./explorer-reads";
import { SubjectCharts } from "./subject-charts";
import { subjectOverview } from "./subject-series";
import { subjectStory } from "./subject-story";
import { parseSubjectQuery } from "./subject-table";
import { SubjectsTable } from "./subjects-table";
import { trainingFileDeps } from "./training-file-ports";
import {
  loadConversation,
  loadTrainingSet,
  loadTrainingSets,
  type TrainingFileDeps,
} from "./training-files";
import { NoTrainingSets, TrainingBrowser } from "./training-browser";

/**
 * The Data page's screens, one per route under `app/(shell)/data`. Each reads
 * through `explorer-reads.ts` or `training-files.ts`, which apply the
 * synthetic-only scope and the audit, and renders a plain notice for anything
 * it may not or could not read.
 */

type Params = Readonly<Record<string, string | string[] | undefined>>;

/** A route segment as text; a malformed escape stays as typed and simply matches nothing. */
const decoded = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const BlockedView = ({ blocked }: { readonly blocked: Blocked }) => (
  <BlockedNotice kind={blocked.kind} />
);

/** Header, cohort picker and a body for one of the two cohort sections. */
const CohortScreen = async ({
  section,
  path,
  params,
  deps,
  body,
}: {
  readonly section: "overview" | "subjects";
  readonly path: string;
  readonly params: Params;
  readonly deps: ExplorerDeps;
  readonly body: (cohortId: string) => Promise<React.ReactNode>;
}) => {
  const listed = await loadCohorts(deps);
  const cohort =
    listed.kind === "ok" ? pickCohort(listed.cohorts, single(params.cohort)) : null;
  return (
    <PageFrame>
      <ExplorerHeader section={section} cohortId={cohort?.cohortId ?? null} />
      {listed.kind !== "ok" ? (
        <BlockedView blocked={listed} />
      ) : cohort === null ? (
        <BlockedNotice kind="no-cohorts" />
      ) : (
        <>
          <CohortPicker cohorts={listed.cohorts} current={cohort.cohortId} path={path} />
          {await body(cohort.cohortId)}
        </>
      )}
    </PageFrame>
  );
};

export const OverviewScreen = ({
  params,
  deps = explorerDeps,
}: {
  readonly params: Params;
  readonly deps?: ExplorerDeps;
}) => (
  <CohortScreen
    section="overview"
    path="/data"
    params={params}
    deps={deps}
    body={async (cohortId) => {
      const result = await loadOverview(deps, cohortId);
      return result.kind === "ok" ? (
        <CohortOverview cohortId={cohortId} overview={result.overview} />
      ) : (
        <BlockedView blocked={result} />
      );
    }}
  />
);

export const SubjectsScreen = ({
  params,
  deps = explorerDeps,
}: {
  readonly params: Params;
  readonly deps?: ExplorerDeps;
}) => (
  <CohortScreen
    section="subjects"
    path="/data/subjects"
    params={params}
    deps={deps}
    body={async (cohortId) => {
      const result = await loadSubjects(deps, cohortId);
      return result.kind === "ok" ? (
        <SubjectsTable
          cohortId={cohortId}
          subjects={result.subjects}
          query={parseSubjectQuery(params)}
        />
      ) : (
        <BlockedView blocked={result} />
      );
    }}
  />
);

export const SubjectScreen = async ({
  subjectRef,
  deps = explorerDeps,
}: {
  readonly subjectRef: string;
  readonly deps?: ExplorerDeps;
}) => {
  const result = await loadSubject(deps, decoded(subjectRef));
  const cohortId = result.kind === "ok" ? result.subject.cohortId : null;
  return (
    <PageFrame>
      <ExplorerHeader section="subjects" cohortId={cohortId} />
      {result.kind !== "ok" ? (
        <BlockedView blocked={result} />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/data/subjects?cohort=${encodeURIComponent(result.subject.cohortId)}`}
              className={buttonClassName({ size: "sm" })}
            >
              All subjects
            </Link>
            <span className="text-muted-foreground font-mono text-xs">
              {result.subject.cohortId}
            </span>
          </div>
          <h2 className="mt-4 font-mono text-base break-all">{result.subject.ref}</h2>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed">
            {subjectStory(
              subjectOverview(result.subject.series),
              result.subject.series,
              result.subject.nonNumeric,
            )}
          </p>
          <SubjectCharts series={result.subject.series} />
        </>
      )}
    </PageFrame>
  );
};

export const TrainingScreen = async ({
  params,
  deps = trainingFileDeps,
}: {
  readonly params: Params;
  readonly deps?: TrainingFileDeps;
}) => {
  const listed = await loadTrainingSets(deps);
  const content = async () => {
    if (listed.kind === "personal" || listed.kind === "sign-in")
      return <BlockedNotice kind={listed.kind} />;
    if (listed.kind === "failed")
      return <p className="text-muted-foreground mt-6 text-sm">{TRAINING_FAILED}</p>;
    if (listed.sets.length === 0) return <NoTrainingSets />;
    const requested = single(params.set);
    const name = listed.sets.some((set) => set.name === requested)
      ? requested!
      : listed.sets[0]!.name;
    const detail = await loadTrainingSet(deps, name);
    if (detail.kind !== "ok")
      return <p className="text-muted-foreground mt-6 text-sm">{TRAINING_FAILED}</p>;
    const page = Number(single(params.page));
    return (
      <TrainingBrowser
        sets={listed.sets}
        set={detail.set}
        family={single(params.family) ?? null}
        page={Number.isInteger(page) ? page : 1}
      />
    );
  };
  return (
    <PageFrame>
      <ExplorerHeader section="training" cohortId={null} />
      {await content()}
    </PageFrame>
  );
};

export const ConversationScreen = async ({
  set: rawSet,
  number,
  deps = trainingFileDeps,
}: {
  readonly set: string;
  /** 1-based, as in the URL. */
  readonly number: string;
  readonly deps?: TrainingFileDeps;
}) => {
  const index = Number(number) - 1;
  const set = decoded(rawSet);
  // The manifest's count is enough for Next; the meta file can be large.
  const [result, listed] = await Promise.all([
    loadConversation(deps, set, index),
    loadTrainingSets(deps),
  ]);
  const known =
    listed.kind === "ok" ? listed.sets.find((s) => s.name === set) : undefined;
  const total = known?.manifest?.conversations ?? null;
  return (
    <PageFrame>
      <ExplorerHeader section="training" cohortId={null} />
      {result.kind === "ok" ? (
        <ConversationView
          set={set}
          index={index}
          conversation={result.conversation}
          total={total}
        />
      ) : result.kind === "personal" || result.kind === "sign-in" ? (
        <BlockedNotice kind={result.kind} />
      ) : result.kind === "failed" ? (
        <p className="text-muted-foreground mt-6 text-sm">{TRAINING_FAILED}</p>
      ) : (
        <div className="mt-6">
          <p className="text-muted-foreground text-sm">
            No conversation with that number.
          </p>
          {known && (
            <Link
              href={conversationHref(set, 0)}
              className={buttonClassName({ size: "sm", className: "mt-3" })}
            >
              First conversation
            </Link>
          )}
        </div>
      )}
    </PageFrame>
  );
};
