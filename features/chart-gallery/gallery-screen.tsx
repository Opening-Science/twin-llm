"use client";

import { type ReactNode, useState } from "react";

import {
  type Category,
  type ChartRange,
  type ChartState,
  type DeviceRow,
  ComparisonPair,
  DeviceList,
  Consistency,
  CumulativeDay,
  Hypnogram,
  InsightCard,
  LabResultCard,
  MonthComparison,
  Radar,
  RangeBars,
  ResearchFigure,
  ScoreRing,
  StreakGrid,
  VENDOR_LOGOS,
  WeeklyBars,
} from "@/infrastructure/charts/kit";

import {
  BEDTIME_TARGET,
  BEDTIME_READOUTS,
  BEDTIMES,
  DAY_AVERAGE,
  DAY_NOW,
  DAY_TODAY_READ,
  HEART_RANGES_READ,
  NIGHT_READ,
  NULL_DRAWS,
  NULL_OBSERVED,
  P2_GROUPS_READ,
  P3_ESTIMATES_READ,
  RADAR_HEART_READ,
  RADAR_READINESS_READ,
  RADAR_SLEEP,
  RADAR_SLEEP_READ,
  SLEEP_PARTS_READ,
  STREAK_READ,
  STREAK_TODAY,
  WEEK_STEPS,
  WEEK_STEPS_AVERAGE,
  WEEK_STEPS_READOUTS,
  RANGE_DEMO,
} from "./sample-data";

const STATES: readonly ChartState[] = ["default", "loading", "empty"];

const STATE_WORD: Readonly<Record<ChartState, string>> = {
  default: "Default",
  loading: "Loading",
  empty: "Empty",
};

/** One hue per row of the colour check, with the categories it carries. */
const HUES: readonly Readonly<{ category: Category; label: string; token: string }>[] = [
  { category: "readiness", label: "Readiness, recovery, vitals", token: "chart-1 teal" },
  { category: "steps", label: "Activity and steps", token: "chart-2 ochre" },
  { category: "heart", label: "Heart and HRV", token: "chart-3 plum" },
  { category: "sleep", label: "Sleep", token: "chart-4 violet" },
];

const fmt = (value: number): string => value.toLocaleString("en-US");

/** A component shown in all three states, side by side on a wide screen. */
const Row = ({
  name,
  note,
  render,
}: {
  readonly name: string;
  readonly note: string;
  readonly render: (state: ChartState) => ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <header>
      <h2 className="text-foreground font-sans text-lg">{name}</h2>
      <p className="text-muted-foreground text-sm">{note}</p>
    </header>
    <div className="grid gap-4 lg:grid-cols-3">
      {STATES.map((state) => (
        <div key={state} className="flex min-w-0 flex-col gap-1.5">
          <p className="text-muted-foreground font-mono text-xs">{STATE_WORD[state]}</p>
          {render(state)}
        </div>
      ))}
    </div>
  </section>
);

/** The range switch: the card only reports the choice; this page swaps the data. */
const RangeDemo = () => {
  const [range, setRange] = useState<ChartRange>("day");
  const data = RANGE_DEMO[range];
  const words: Readonly<Record<ChartRange, string>> = {
    day: "today, by hour",
    week: "this week, by day",
    month: "this month, by day",
  };
  return (
    <InsightCard
      category="heart"
      label="Heart rate"
      interactive
      sentence={`Your heart rate range ${words[range]}.`}
      ranges={{ value: range, onChange: setRange }}
    >
      <RangeBars
        category="heart"
        buckets={data.buckets}
        axis={data.axis}
        label="Heart rate"
      />
    </InsightCard>
  );
};

/** Made-up sources with the vendors' own logos, where the rules allow one. */
const SOURCES: readonly DeviceRow[] = [
  {
    // Oura's only official mark is its wordmark, not in the repository yet.
    name: "Oura",
    detail: "Made-up: synced 4 min ago",
    status: { word: "Linked", tone: "ok" },
  },
  {
    name: "WHOOP",
    detail: "Made-up: synced 2 hours ago",
    status: { word: "Linked", tone: "ok" },
    logo: VENDOR_LOGOS.whoop,
  },
  {
    name: "Google Health",
    detail: "Connected to Google Health · made-up: synced 12 minutes ago",
    status: { word: "Linked", tone: "ok" },
    logo: VENDOR_LOGOS.googleHealth,
  },
];

/**
 * The chart kit, every component in every state, on made-up data. A page
 * for judging the kit, not a product screen.
 */
export const GalleryScreen = () => (
  <div className="page-wide page-stack">
    <header className="flex flex-col gap-2">
      <h1 className="text-display">Chart kit</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        The chart kit for TwinLLM in the Open Science Foundation brand. Every component in
        its default, loading and empty states. All data on this page is made up.
      </p>
    </header>

    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-foreground font-sans text-lg">Category colours</h2>
        <p className="text-muted-foreground text-sm">
          Four hues, and the reference grey under each. The word always names the
          category.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {HUES.map((hue) => (
          <InsightCard
            key={hue.category}
            category={hue.category}
            label={hue.label}
            sentence={hue.token}
          >
            <WeeklyBars
              category={hue.category}
              values={WEEK_STEPS}
              average={WEEK_STEPS_AVERAGE}
              caption="Average"
              hero={fmt(WEEK_STEPS_AVERAGE)}
            />
          </InsightCard>
        ))}
      </div>
    </section>

    <Row
      name="C03 Insight card"
      note="Label, one sentence, a hairline, one body. The sentence is what a screen reader reads."
      render={(state) => (
        <InsightCard
          category="sleep"
          state={state}
          label="Sleep: Stages"
          sentence={
            state === "empty"
              ? "Your sleep compared with your average appears after 7 nights."
              : "You slept 7 hr 19 min, 37 minutes more than your average over 7 nights."
          }
          emptyNote="7 nights needed"
        />
      )}
    />

    <Row
      name="C04 Comparison pair and C05 cumulative day"
      note="Today in colour, the usual day in grey; after now the usual day is faded. Try: hover or drag, tap, arrow keys."
      render={(state) => (
        <InsightCard
          category="steps"
          state={state}
          label="Steps"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Today's steps appear here once your device syncs."
              : "4,310 steps so far today, fewer than usual by now."
          }
          emptyNote="No steps recorded yet today"
        >
          <div className="flex flex-col gap-4">
            <ComparisonPair
              category="steps"
              state={state}
              today={{ label: "Today", value: "4,310", unit: "steps" }}
              reference={{ label: "Average", value: "5,020", unit: "steps" }}
            />
            <CumulativeDay
              category="steps"
              state={state}
              today={DAY_TODAY_READ}
              average={DAY_AVERAGE}
              now={DAY_NOW}
              label="Steps"
              defaultFocus={12}
            />
          </div>
        </InsightCard>
      )}
    />

    <Row
      name="C06 Weekly bars"
      note="The average line spans the whole width, as a baseline. Try: hover or drag, tap, arrow keys."
      render={(state) => (
        <InsightCard
          category="steps"
          state={state}
          label="Steps: Weekly"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Your weekly average appears after 7 days of steps."
              : "You averaged 8,426 steps a day in the last 7 days."
          }
          emptyNote="7 days needed"
        >
          <WeeklyBars
            category="steps"
            state={state}
            values={WEEK_STEPS}
            readouts={WEEK_STEPS_READOUTS}
            average={WEEK_STEPS_AVERAGE}
            caption="Average steps"
            hero={fmt(WEEK_STEPS_AVERAGE)}
            label="Steps: Weekly"
            defaultFocus={3}
          />
        </InsightCard>
      )}
    />

    <Row
      name="C07 Streak grid"
      note="Done days filled, other days on the track, today outlined. Try: click or tap a mark (again to clear), arrow keys, Escape."
      render={(state) => (
        <InsightCard
          category="activity"
          state={state}
          label="Activity: Streak"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Your active days fill in here as they are recorded."
              : "You were active on 22 of the last 28 days."
          }
          emptyNote="Days fill in as they are recorded"
        >
          <StreakGrid
            category="activity"
            state={state}
            days={STREAK_READ}
            today={STREAK_TODAY}
            label="Activity: Streak"
            defaultFocus={27}
          />
        </InsightCard>
      )}
    />

    <Row
      name="C08 Range bars"
      note="Minimum to maximum per hour; MIN and MAX are written, not hovered. Try: hover or drag, tap, arrow keys."
      render={(state) => (
        <InsightCard
          category="heart"
          state={state}
          label="Heart rate"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Today's heart rate range appears once your device syncs."
              : "Your heart rate ranged from 56 to 114 beats per minute today."
          }
          emptyNote="No heart rate recorded yet today"
        >
          <RangeBars
            category="heart"
            state={state}
            buckets={HEART_RANGES_READ}
            axis={["8 AM", "5 PM"]}
            label="Heart rate"
            defaultFocus={4}
          />
        </InsightCard>
      )}
    />

    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-foreground font-sans text-lg">Range switch</h2>
        <p className="text-muted-foreground text-sm">
          Day, Week or Month in the card&apos;s header. The card only reports the choice;
          the screen swaps the data. Try: switch, then hover or use the arrow keys.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <RangeDemo />
      </div>
    </section>

    <Row
      name="C09 Hypnogram"
      note="Lightness steps of the sleep violet; every lane carries its word. Try: click or tap a mark (again to clear), arrow keys, Escape."
      render={(state) => (
        <InsightCard
          category="sleep"
          state={state}
          label="Sleep: Stages"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Your sleep stages appear after a night with your device on."
              : "You spent 1 hr 10 min in deep sleep last night."
          }
          emptyNote="A night of sleep needed"
        >
          <Hypnogram
            category="sleep"
            state={state}
            spans={NIGHT_READ}
            label="Sleep: Stages"
            defaultFocus={2}
            axis={["11:04 PM", "6:23 AM"]}
          />
        </InsightCard>
      )}
    />

    <Row
      name="C10 Score ring"
      note="Each part's arc is its share of the score, filled to its value. Try: click or tap a mark (again to clear), arrow keys, Escape."
      render={(state) => (
        <InsightCard
          category="sleep"
          state={state}
          label="Sleep: Score"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Your sleep score appears after a night with your device on."
              : "Your sleep score was 84, from duration, bedtime and interruptions."
          }
          emptyNote="A night of sleep needed"
        >
          <ScoreRing
            category="sleep"
            state={state}
            title="Sleep score"
            band="High"
            parts={SLEEP_PARTS_READ}
            label="Sleep: Score"
            defaultFocus={1}
          />
        </InsightCard>
      )}
    />

    <Row
      name="C12 Month comparison"
      note="This month in colour, last month on the track."
      render={(state) => (
        <InsightCard
          category="sleep"
          state={state}
          label="Sleep: Monthly"
          sentence={
            state === "empty"
              ? "The monthly comparison appears after two months of sleep."
              : "You slept 37 minutes more a night this month than last month."
          }
          emptyNote="Two months needed"
        >
          <MonthComparison
            category="sleep"
            state={state}
            current={{ month: "November", value: 439, display: "7 hr 19 min" }}
            previous={{ month: "October", value: 402, display: "6 hr 42 min" }}
          />
        </InsightCard>
      )}
    />

    <Row
      name="C13 Consistency"
      note="Nights in grey, the last one in colour, the target dashed. Try: hover or drag, tap, arrow keys."
      render={(state) => (
        <InsightCard
          category="sleep"
          state={state}
          label="Sleep: Bedtime"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Your bedtime pattern appears after 14 nights."
              : "Your bedtime was 48 minutes later than your target last night."
          }
          emptyNote="14 nights needed"
        >
          <Consistency
            category="sleep"
            state={state}
            values={BEDTIMES}
            readouts={BEDTIME_READOUTS}
            label="Sleep: Bedtime"
            defaultFocus={13}
            target={BEDTIME_TARGET}
            reference={{ label: "Average bedtime", value: "11:04 PM" }}
            last={{ label: "Last night", value: "11:48 PM" }}
            axis={["25 Oct", "7 Nov"]}
          />
        </InsightCard>
      )}
    />

    <Row
      name="C15 Device rows"
      note="One row per source, with a status word; a row can link on. A logo, when given, is the vendor's own file, unmodified and sized by height. This example has none."
      render={(state) => (
        <DeviceList
          category="vitals"
          state={state}
          title="Sources"
          emptyNote="No source linked yet"
          rows={[
            {
              name: "Oura",
              detail: "Made-up: synced 4 minutes ago",
              status: { word: "Linked", tone: "ok" },
              href: "/lab/design",
            },
            {
              name: "WHOOP",
              detail: "Made-up: last sync 3 days ago",
              status: { word: "Stale", tone: "warn" },
              href: "/lab/design",
            },
            { name: "Google Health", status: { word: "Not linked", tone: "neutral" } },
          ]}
        />
      )}
    />

    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-foreground font-sans text-lg">C15 Device rows with logos</h2>
        <p className="text-muted-foreground text-sm">
          Each row leads with a tile holding the vendor&apos;s own file, unchanged:
          WHOOP&apos;s outline circle at 30px, black on the light tile and white on the
          dark one, with &ldquo;Data by WHOOP&rdquo; in its detail line; Google
          Health&apos;s colour heart on both. Oura&apos;s tile stays empty until its
          wordmark is in. Switch the theme to see the other WHOOP file.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <DeviceList category="vitals" title="Sources" rows={SOURCES} />
      </div>
    </section>

    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-foreground font-sans text-lg">C18 Radar</h2>
        <p className="text-muted-foreground text-sm">
          How each part compares with the others, each on its own scale. Today in colour,
          the usual in a grey outline; every vertex carries its word and value. Try: click
          or tap a mark (again to clear), arrow keys, Escape.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <InsightCard
          category="sleep"
          label="Sleep: Stages"
          interactive
          sentence="Last night you had more REM and deep sleep than your usual over 7 nights."
        >
          <Radar
            category="sleep"
            axes={RADAR_SLEEP_READ}
            label="Sleep: Stages"
            defaultFocus={0}
          />
        </InsightCard>
        <InsightCard
          category="heart"
          label="Heart rate"
          interactive
          sentence="Your resting and sleeping heart rates were a little below usual today."
        >
          <Radar category="heart" axes={RADAR_HEART_READ} label="Heart rate" />
        </InsightCard>
        {/* The odd one out spans the row rather than leaving half of it empty. */}
        <div className="lg:col-span-2">
          <InsightCard
            category="readiness"
            label="Readiness"
            interactive
            sentence="Sleep was above usual and recovery a little below; HRV is not in yet."
          >
            <Radar category="readiness" axes={RADAR_READINESS_READ} label="Readiness" />
          </InsightCard>
        </div>
      </div>
    </section>

    <Row
      name="C18 Radar: states"
      note="Loading draws the rings as shapes; empty draws the rings and dotted spokes."
      render={(state) => (
        <InsightCard
          category="sleep"
          state={state}
          label="Sleep: Stages"
          sentence={
            state === "empty"
              ? "Your sleep stages compared with your usual appear after a night with your device on."
              : "Last night you had more REM and deep sleep than your usual over 7 nights."
          }
          emptyNote="A night of sleep needed"
        >
          <Radar category="sleep" state={state} axes={RADAR_SLEEP} />
        </InsightCard>
      )}
    />

    <Row
      name="R1 Research figure: estimates"
      note="Point estimates with intervals against a reference. Try: hover or drag, tap, arrow keys."
      render={(state) => (
        <InsightCard
          category="vitals"
          state={state}
          label="Within-person effect"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "The estimates appear here once the run has finished."
              : "The within-person estimate is 3.09 (2.07 to 4.63); 1 means no effect."
          }
          emptyNote="No run yet"
        >
          <ResearchFigure
            kind="estimates"
            category="vitals"
            state={state}
            estimates={P3_ESTIMATES_READ}
            reference={{ value: 1, label: "No effect" }}
            label="Within-person effect"
            defaultFocus={0}
          />
        </InsightCard>
      )}
    />

    <Row
      name="R1 Research figure: pairs"
      note="Sensitivity and specificity per dataset, on a 0 to 1 axis. Try: hover or drag, tap, arrow keys."
      render={(state) => (
        <InsightCard
          category="heart"
          state={state}
          label="AF detection"
          interactive={state === "default"}
          sentence={
            state === "empty"
              ? "Sensitivity and specificity appear once the run has finished."
              : "Sensitivity is above 0.94 on both databases; specificity is lower."
          }
          emptyNote="No run yet"
        >
          <ResearchFigure
            kind="pairs"
            category="heart"
            state={state}
            groups={P2_GROUPS_READ}
            label="AF detection"
          />
        </InsightCard>
      )}
    />

    <Row
      name="R1 Research figure: null"
      note="An observed value against its null distribution."
      render={(state) => (
        <InsightCard
          category="vitals"
          state={state}
          label="Observed against a null"
          sentence={
            state === "empty"
              ? "The observed value and its null appear once the run has finished."
              : "A made-up AUC of 0.58 sits above most of its made-up null draws."
          }
          emptyNote="No run yet"
        >
          <ResearchFigure
            kind="null"
            category="vitals"
            state={state}
            draws={NULL_DRAWS}
            observed={NULL_OBSERVED}
            observedLabel="AUC"
          />
        </InsightCard>
      )}
    />

    <Row
      name="R2 Lab result card"
      note="The outcome is a word; colour only follows it."
      render={(state) => (
        <LabResultCard
          category="vitals"
          state={state}
          title="Audit chain"
          outcome={{ word: "Intact", tone: "pass" }}
          sentence={
            state === "empty"
              ? "The audit chain is checked when the Lab runs its checks."
              : "All 1,204 audit rows link to the row before them."
          }
          rows={[
            { label: "Rows", value: "1,204" },
            { label: "First row", value: "2 Nov 2026" },
            { label: "Checked in", value: "38 ms" },
          ]}
        />
      )}
    />

    <Row
      name="R2 Lab result card: failing"
      note="A failing check says so in a word, in the error colour."
      render={(state) => (
        <LabResultCard
          category="vitals"
          state={state}
          title="Audit chain"
          outcome={{ word: "Broken", tone: "fail" }}
          sentence={
            state === "empty"
              ? "The audit chain is checked when the Lab runs its checks."
              : "Row 812 does not link to the row before it."
          }
          rows={[
            { label: "Rows", value: "1,204" },
            { label: "First break", value: "Row 812" },
            { label: "Checked in", value: "41 ms" },
          ]}
        />
      )}
    />
  </div>
);
