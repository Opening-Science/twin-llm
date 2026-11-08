/**
 * The chart kit: one component per board number, plus two research pieces
 * of our own, their prop and data types, the category colours and the pure
 * geometry. Screens import from here.
 */

export * from "./types";
export {
  CATEGORY_TOKEN,
  REFERENCE_TEXT_CLASS,
  categoryTextClass,
  conditionToken,
  tokenTextClass,
  type SeriesToken,
} from "../category-token";
export * from "./kit-geometry";
export {
  ChartFocusFrame,
  ChartReadout,
  dimmed,
  mutedUnlessFocused,
  useChartFocus,
  type ChartFocus,
  type Pick,
} from "./chart-focus";

export { InsightCard } from "./c03-insight-card";
export { ComparisonPair } from "./c04-comparison-pair";
export { CumulativeDay } from "./c05-cumulative-day";
export { WeeklyBars } from "./c06-weekly-bars";
export { StreakGrid } from "./c07-streak-grid";
export { RangeBars } from "./c08-range-bars";
export { Hypnogram, hoursMinutes } from "./c09-hypnogram";
export { ScoreRing } from "./c10-score-ring";
export { MonthComparison } from "./c12-month-comparison";
export { Consistency } from "./c13-consistency";
export { Radar, radarHeight } from "./c18-radar";
export { ResearchFigure } from "./r1-research-figure";
export { LabResultCard } from "./r2-lab-result-card";
