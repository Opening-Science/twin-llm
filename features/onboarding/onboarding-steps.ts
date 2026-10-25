import {
  type KnowledgeSourceId,
  normaliseDisabledSources,
} from "@/infrastructure/knowledge-sources";

/**
 * The first-run flow as data: its steps, its answers, and every way a click
 * moves between them. Pure, so the order and the rules are tested without a
 * browser, and the client component only renders what this says.
 *
 * Answers are saved as the person goes, so a trip to a vendor's sign-in page
 * from the "Connect your data" step comes back to the same step.
 */

export const ONBOARDING_STEPS = [
  "purpose",
  "connect",
  "sources",
  "residency",
  "explore",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export const ROLES = [
  { id: "researcher", label: "Researcher", hint: "Questions over cohorts and methods" },
  {
    id: "clinician-researcher",
    label: "Clinician-researcher",
    hint: "Guideline context beside the numbers",
  },
  { id: "self-tracker", label: "Self-tracker", hint: "My own wearables" },
  { id: "student", label: "Student or learning", hint: "What metrics mean and how" },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];

export const DATA_CHOICES = [
  {
    id: "demo",
    label: "Explore the synthetic demo cohort",
    hint: "Synthea records that describe no real person",
  },
  {
    id: "own",
    label: "Use my own data",
    hint: "Wearables and body scans you link",
  },
] as const;

export type DataChoiceId = (typeof DATA_CHOICES)[number]["id"];

export type OnboardingAnswers = Readonly<{
  roles: readonly RoleId[];
  dataChoice: DataChoiceId | null;
  interest: string;
  disabledSources: readonly KnowledgeSourceId[];
}>;

export type OnboardingState = Readonly<{
  step: number;
  answers: OnboardingAnswers;
}>;

export const MAX_INTEREST_LENGTH = 500;

export const EMPTY_ANSWERS: OnboardingAnswers = {
  roles: [],
  dataChoice: null,
  interest: "",
  disabledSources: [],
};

export const isRoleId = (value: unknown): value is RoleId =>
  ROLES.some((role) => role.id === value);

export const isDataChoiceId = (value: unknown): value is DataChoiceId =>
  DATA_CHOICES.some((choice) => choice.id === value);

const LAST_STEP = ONBOARDING_STEPS.length - 1;

export const clampStep = (step: number): number =>
  Number.isInteger(step) ? Math.min(Math.max(step, 0), LAST_STEP) : 0;

/** Stored values, cleaned: unknown roles go, order follows `ROLES`. */
export const normaliseAnswers = (raw: {
  readonly roles?: unknown;
  readonly dataChoice?: unknown;
  readonly interest?: unknown;
  readonly disabledSources?: unknown;
}): OnboardingAnswers => {
  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  return {
    roles: ROLES.map((role) => role.id).filter((id) => roles.includes(id)),
    dataChoice: isDataChoiceId(raw.dataChoice) ? raw.dataChoice : null,
    interest:
      typeof raw.interest === "string" ? raw.interest.slice(0, MAX_INTEREST_LENGTH) : "",
    disabledSources: normaliseDisabledSources(raw.disabledSources),
  };
};

export type OnboardingAction =
  | Readonly<{ type: "toggle-role"; role: RoleId }>
  | Readonly<{ type: "set-data-choice"; choice: DataChoiceId }>
  | Readonly<{ type: "set-interest"; interest: string }>
  | Readonly<{ type: "set-disabled-sources"; disabled: readonly KnowledgeSourceId[] }>
  | Readonly<{ type: "next" }>
  | Readonly<{ type: "back" }>;

export const onboardingReducer = (
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState => {
  const { answers } = state;
  switch (action.type) {
    case "toggle-role":
      return {
        ...state,
        answers: normaliseAnswers({
          ...answers,
          roles: answers.roles.includes(action.role)
            ? answers.roles.filter((role) => role !== action.role)
            : [...answers.roles, action.role],
        }),
      };
    case "set-data-choice":
      return { ...state, answers: { ...answers, dataChoice: action.choice } };
    case "set-interest":
      return {
        ...state,
        answers: { ...answers, interest: action.interest.slice(0, MAX_INTEREST_LENGTH) },
      };
    case "set-disabled-sources":
      return {
        ...state,
        answers: {
          ...answers,
          disabledSources: normaliseDisabledSources(action.disabled),
        },
      };
    case "next":
      return { ...state, step: clampStep(state.step + 1) };
    case "back":
      return { ...state, step: clampStep(state.step - 1) };
  }
};

/**
 * Whether Continue is enabled. Only the first step asks for an answer: one
 * role and one data choice. Every step can still be skipped.
 */
export const canContinue = (state: OnboardingState): boolean =>
  ONBOARDING_STEPS[clampStep(state.step)] === "purpose"
    ? state.answers.roles.length > 0 && state.answers.dataChoice !== null
    : true;

export const isLastStep = (step: number): boolean => clampStep(step) === LAST_STEP;

/** "Step 2 of 5", for the progress dots' label. */
export const stepLabel = (step: number): string =>
  `Step ${String(clampStep(step) + 1)} of ${String(ONBOARDING_STEPS.length)}`;
