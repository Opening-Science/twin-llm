/**
 * The second rater's rubric for the heart-brain (hb) set (#351): five levels,
 * each with a written anchor, as `docs/evaluation/second-rater.md` gives them.
 * The labels feed the ui-kit `Rating`; the anchors are shown beside it. Pure
 * and client-safe: the rating view and `bun run eval:agreement` share it.
 */

export const RUBRIC_VERSION = "second-rater.v1";

export type RubricLevel = Readonly<{ level: number; label: string; anchor: string }>;

/** Lowest first, as the `Rating` control counts. */
export const RUBRIC_LEVELS: readonly RubricLevel[] = [
  {
    level: 1,
    label: "Wrong or invented",
    anchor:
      "The opposite of the reference verdict, a relation the reference does not show, a number no tool gave, a claim that one condition causes another, or a statement about a person's own risk or what they should do.",
  },
  {
    level: 2,
    label: "Not answered",
    anchor:
      "No verdict or number where the question asked for one: the reply is about something else (a chart, the tools), refuses a question it could answer, or answers a person-level question that should be declined.",
  },
  {
    level: 3,
    label: "Partly right",
    anchor:
      "Some of what was asked is right and some is missing: the verdict without a number that was asked for, one of two numbers, or an answer for another cohort or age range without saying so. Nothing invented.",
  },
  {
    level: 4,
    label: "Right, small flaw",
    anchor:
      "Everything asked for agrees with the reference, but the wording is loose (a paraphrase of the verdict, numbers rounded further), it adds something unasked, or it leaves out that the result describes a synthetic cohort.",
  },
  {
    level: 5,
    label: "Right and grounded",
    anchor:
      "Agrees with the reference on the verdict and every number asked for (to rounding), each number comes from a tool, and it keeps to the synthetic cohort. For a refusal or decline item: declines, with the right reason.",
  },
];

export const RUBRIC_LABELS: readonly string[] = RUBRIC_LEVELS.map((each) => each.label);

/** Levels 4 and 5 count as acceptable when a rating is compared with a pass or fail. */
export const ACCEPTABLE_FROM = 4;

export const isAcceptable = (level: number): boolean => level >= ACCEPTABLE_FROM;

export const isRubricLevel = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;

/**
 * A rater is a pseudonym: lowercase letters, digits and dashes, 2 to 32
 * characters ("rater-b"). It also names the ratings file, so it must be a
 * safe file name; a real name is not wanted and the form says so.
 */
const PSEUDONYM = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/;

export const isPseudonym = (value: string): boolean => PSEUDONYM.test(value);
