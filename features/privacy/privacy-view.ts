import { formatDate } from "@/infrastructure/format-measure";
import {
  isActiveAt,
  type LearningConsent,
  LEARNING_SCOPES,
  LEARNING_SOURCES,
  type LearningScope,
  type LearningSource,
  SCOPE_LABELS,
  SOURCE_LABELS,
} from "@/infrastructure/learning-consent";

/**
 * What Customize · Privacy shows per scope (#145): whether it is on, since
 * when, what it covers and the sentence agreed to, and earlier grants that
 * were withdrawn. Pure; the page reads the rows and the card renders this.
 */

export type ConsentEntry = LearningConsent & Readonly<{ wording: string }>;

export type SourceChoice = Readonly<{ value: LearningSource; label: string }>;

export type ScopeView = Readonly<{
  scope: LearningScope;
  name: string;
  purpose: string;
  active: Readonly<{
    id: string;
    since: string;
    sources: string;
    wording: string;
  }> | null;
  past: readonly Readonly<{
    id: string;
    granted: string;
    withdrawn: string;
    sources: string;
  }>[];
}>;

const day = (date: Date): string => formatDate(date.toISOString().slice(0, 10));

const sourceList = (sources: readonly LearningSource[]): string =>
  sources.map((source) => SOURCE_LABELS[source]).join(", ");

const capitalised = (text: string): string =>
  text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;

export const SOURCE_CHOICES: readonly SourceChoice[] = LEARNING_SOURCES.map((value) => ({
  value,
  label: capitalised(SOURCE_LABELS[value]),
}));

export const privacyView = (
  consents: readonly ConsentEntry[],
  at: Date,
): readonly ScopeView[] =>
  LEARNING_SCOPES.map((scope) => {
    const own = consents.filter((consent) => consent.scope === scope);
    const active = own.find((consent) => isActiveAt(consent, at)) ?? null;
    return {
      scope,
      name: SCOPE_LABELS[scope].name,
      purpose: capitalised(SCOPE_LABELS[scope].purpose),
      active:
        active === null
          ? null
          : {
              id: active.id,
              since: day(active.grantedAt),
              sources: capitalised(sourceList(active.sources)),
              wording: active.wording,
            },
      past: own
        .filter((consent) => consent.withdrawnAt !== null && !isActiveAt(consent, at))
        .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())
        .map((consent) => ({
          id: consent.id,
          granted: day(consent.grantedAt),
          withdrawn: consent.withdrawnAt === null ? "" : day(consent.withdrawnAt),
          sources: capitalised(sourceList(consent.sources)),
        })),
    };
  });

/** The sources ticked in a grant form, in the fixed order; unknown values are ignored. */
export const chosenSources = (values: readonly string[]): readonly LearningSource[] =>
  LEARNING_SOURCES.filter((source) => values.includes(source));

export const PRIVACY_COPY = {
  synthetic:
    "This install holds synthetic data only, so there is nothing to consent to. Synthetic cohorts never need consent.",
  signIn: "Sign in to manage consent.",
  noSources: "Choose at least one kind of data first.",
  alreadyGranted: "This use is already on. Withdraw it first to change what it covers.",
  unknownScope: "That use does not exist. Reload the page.",
  granted: "Granted. Pipelines may now use the data you chose for this.",
  withdrawn: "Withdrawn. No future run may use your data for this.",
  notActive: "This consent was already withdrawn.",
  failed: "The change was not saved. Try again.",
  withdrawHold: "Hold to withdraw consent",
  withdrawing: "Withdrawing…",
} as const;
