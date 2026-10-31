import "server-only";

import { database } from "@/infrastructure/database";
import { newRowId, openNullable, sealNullable } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import {
  type KnowledgeSourceId,
  normaliseDisabledSources,
} from "@/infrastructure/knowledge-sources";
import { GUIDELINE_SOURCE } from "@/packages/guidelines/constants";
import { KNOWLEDGE_SOURCE } from "@/packages/knowledge/constants";

import {
  clampStep,
  EMPTY_ANSWERS,
  normaliseAnswers,
  type OnboardingAnswers,
} from "./onboarding-steps";

/**
 * The one place the `onboarding_profiles` table is read and written. Every
 * read is cleaned through the same rules the client uses, so a stale role or
 * source id in the database never reaches a screen or the chat tools. The
 * free-text interest is sealed with the person's keys in personal mode (#141).
 */

const TABLE = "onboarding_profiles";

export type StoredOnboarding = Readonly<{
  answers: OnboardingAnswers;
  step: number;
  completed: boolean;
}>;

export const loadOnboarding = async (userId: string): Promise<StoredOnboarding> => {
  const row = await database().onboardingProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      roles: true,
      dataChoice: true,
      interest: true,
      disabledSources: true,
      liveSources: true,
      step: true,
      completedAt: true,
    },
  });
  if (!row) return { answers: EMPTY_ANSWERS, step: 0, completed: false };
  const cipher = await cipherForUser(userId);
  return {
    answers: normaliseAnswers({
      ...row,
      interest: openNullable(cipher, TABLE, "interest", row.id, row.interest),
    }),
    step: clampStep(row.step),
    completed: row.completedAt !== null,
  };
};

export const saveOnboarding = async (
  userId: string,
  input: Readonly<{ answers: OnboardingAnswers; step: number; complete: boolean }>,
): Promise<void> => {
  const answers = normaliseAnswers(input.answers);
  const cipher = await cipherForUser(userId);
  // The row id is part of the sealed interest's context, so it is fixed first.
  const id =
    (
      await database().onboardingProfile.findUnique({
        where: { userId },
        select: { id: true },
      })
    )?.id ?? newRowId();
  const data = {
    roles: [...answers.roles],
    dataChoice: answers.dataChoice,
    interest: sealNullable(
      cipher,
      TABLE,
      "interest",
      id,
      answers.interest.trim() || null,
    ),
    disabledSources: [...answers.disabledSources],
    liveSources: [...answers.liveSources],
    step: clampStep(input.step),
    ...(input.complete ? { completedAt: new Date() } : {}),
  };
  await database().onboardingProfile.upsert({
    where: { userId },
    create: { id, userId, ...data },
    update: data,
  });
};

/** Marks the flow done without touching the answers (Skip setup, or a starter picked). */
export const completeOnboarding = async (userId: string): Promise<void> => {
  await database().onboardingProfile.upsert({
    where: { userId },
    create: { userId, completedAt: new Date() },
    update: { completedAt: new Date() },
  });
};

/** What the home page needs to know about one actor, or `null` for no user row. */
export type OnboardingUserState = Readonly<{ completed: boolean; hasThread: boolean }>;

export type NeedsOnboardingPorts = Readonly<{
  findUserState: (clerkId: string) => Promise<OnboardingUserState | null>;
  logError: (message: string, errorName: string) => void;
}>;

const defaultNeedsPorts = (): NeedsOnboardingPorts => ({
  findUserState: async (clerkId) => {
    const user = await database().user.findUnique({
      where: { clerkId },
      select: {
        onboardingProfile: { select: { completedAt: true } },
        threads: { select: { id: true }, take: 1 },
      },
    });
    return user
      ? {
          completed: Boolean(user.onboardingProfile?.completedAt),
          hasThread: user.threads.length > 0,
        }
      : null;
  },
  logError: console.error,
});

/**
 * True when this actor has never finished or skipped the flow and has never
 * started a thread. Someone with a thread already uses the app, so a deploy
 * does not send them through setup. A database error reads as "no", so a
 * broken read never traps anyone on /start.
 */
export const needsOnboarding = async (
  clerkId: string,
  ports: Partial<NeedsOnboardingPorts> = {},
): Promise<boolean> => {
  const { findUserState, logError } = { ...defaultNeedsPorts(), ...ports };
  try {
    const state = await findUserState(clerkId);
    return state === null || (!state.completed && !state.hasThread);
  } catch (error) {
    logError(
      "[onboarding] could not read completion",
      error instanceof Error ? error.name : "unknown",
    );
    return false;
  }
};

export const EMPTY_ONBOARDING: StoredOnboarding = {
  answers: EMPTY_ANSWERS,
  step: 0,
  completed: false,
};

/**
 * The saved answers for /start, or a fresh start when they cannot be read
 * (missing table, database down), so Get started never fails to open.
 */
export const loadOnboardingOrEmpty = async (
  userId: string | null,
  ports: Partial<
    Readonly<{
      load: (userId: string) => Promise<StoredOnboarding>;
      logError: (message: string, errorName: string) => void;
    }>
  > = {},
): Promise<StoredOnboarding> => {
  const { load, logError } = { load: loadOnboarding, logError: console.error, ...ports };
  if (!userId) return EMPTY_ONBOARDING;
  try {
    return await load(userId);
  } catch (error) {
    logError(
      "[onboarding] could not read saved answers",
      error instanceof Error ? error.name : "unknown",
    );
    return EMPTY_ONBOARDING;
  }
};

/**
 * The knowledge sources a user turned off; none when they never chose. A read
 * that fails sends every tool, as chat did before the choice existed.
 */
export const loadDisabledSources = async (
  userId: string,
): Promise<readonly KnowledgeSourceId[]> => {
  try {
    const row = await database().onboardingProfile.findUnique({
      where: { userId },
      select: { disabledSources: true },
    });
    return normaliseDisabledSources(row?.disabledSources ?? []);
  } catch (error) {
    console.error(
      "[onboarding] could not read source choices",
      error instanceof Error ? error.name : "unknown",
    );
    return [];
  }
};

/** How many guideline and OpenTwin knowledge documents are indexed locally. */
export const countIndexedDocuments = async (): Promise<
  Readonly<{ guidelines: number; knowledge: number }>
> => {
  try {
    const rows = await database().guidelineDocument.groupBy({
      by: ["source"],
      where: { source: { in: [GUIDELINE_SOURCE, KNOWLEDGE_SOURCE] } },
      _count: { _all: true },
    });
    const count = (source: string) =>
      rows.find((row) => row.source === source)?._count._all ?? 0;
    return { guidelines: count(GUIDELINE_SOURCE), knowledge: count(KNOWLEDGE_SOURCE) };
  } catch (error) {
    console.error(
      "[onboarding] could not count indexed documents",
      error instanceof Error ? error.name : "unknown",
    );
    return { guidelines: 0, knowledge: 0 };
  }
};
