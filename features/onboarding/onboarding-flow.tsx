"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useReducer, useRef, useState } from "react";

import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import { Button } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";

import type { ConnectGroup, SourceAvailability } from "./connect-rows";
import { dataModeSentence, interestHint, type ResidencyConfig } from "./data-residency";
import { saveOnboardingAnswers, skipOnboarding } from "./onboarding-actions";
import { ProgressDots } from "./onboarding-parts";
import {
  ConnectStep,
  PurposeStep,
  ResidencyStep,
  LiveSourcesList,
  SourcesStep,
} from "./onboarding-step-views";
import {
  canContinue,
  isLastStep,
  MAX_INTEREST_LENGTH,
  ONBOARDING_STEPS,
  type OnboardingAnswers,
  onboardingReducer,
  type OnboardingStepId,
  stepLabel,
} from "./onboarding-steps";
import { fallbackStarters, type StarterResult } from "./starter-questions";

/**
 * The first-run card at /start: one question per step, dots for progress,
 * Back / Skip / Continue at the bottom.
 *
 * Answers are saved on every move, so leaving for a vendor sign-in and coming
 * back resumes on the same step. Finishing, skipping the whole setup, or
 * picking a starter question marks the flow done, and the home page stops
 * sending this person here.
 *
 * Opening the thread is the route's to wire (`onStartThread`): it needs the
 * arena's turn creation, which this feature may not import.
 */

export type StartThreadResult =
  Readonly<{ ok: true; threadId: string }> | Readonly<{ ok: false; error: string }>;

type Copy = Readonly<{ heading: string; subtitle: string }>;

const STEP_COPY: Readonly<Record<OnboardingStepId, Copy>> = {
  purpose: {
    heading: "What brings you here?",
    subtitle: "Pick any that fit. TwinLLM is a research tool, not a clinic.",
  },
  connect: {
    heading: "Connect your data",
    subtitle: "Link the sources you want answers to draw on. All of it is optional.",
  },
  sources: {
    heading: "Knowledge sources",
    subtitle: "Choose what chat may search and query when it answers.",
  },
  residency: {
    heading: "Where your data goes",
    subtitle: "What stays on this machine and what leaves it, as this server is set up.",
  },
  explore: {
    heading: "What do you want to explore?",
    subtitle: "A sentence is enough. We'll suggest a first question.",
  },
};

const PICK_COPY: Readonly<Record<StarterResult["source"], Copy>> = {
  model: {
    heading: "Pick a first question",
    subtitle: "Suggested by the configured model from your answers.",
  },
  fallback: {
    heading: "Pick a first question",
    subtitle: "A few places to start, chosen for your role.",
  },
};

type ExplorePhase =
  | Readonly<{ phase: "ask" }>
  | Readonly<{ phase: "thinking" }>
  | Readonly<{ phase: "pick"; result: StarterResult }>;

const fetchStarters = async (
  answers: OnboardingAnswers,
): Promise<StarterResult | null> => {
  try {
    const res = await fetch("/api/onboarding/starters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roles: answers.roles,
        dataChoice: answers.dataChoice,
        interest: answers.interest,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as StarterResult;
    return Array.isArray(data.questions) ? data : null;
  } catch {
    return null;
  }
};

export const OnboardingFlow = ({
  initialAnswers,
  initialStep,
  connectGroups,
  sourceAvailability,
  residency,
  onStartThread,
}: {
  readonly initialAnswers: OnboardingAnswers;
  readonly initialStep: number;
  readonly connectGroups: readonly ConnectGroup[];
  readonly sourceAvailability: Readonly<Record<KnowledgeSourceId, SourceAvailability>>;
  readonly residency: ResidencyConfig;
  readonly onStartThread: (question: string) => Promise<StartThreadResult>;
}) => {
  const router = useRouter();
  const [state, dispatch] = useReducer(onboardingReducer, {
    step: initialStep,
    answers: initialAnswers,
  });
  const [explore, setExplore] = useState<ExplorePhase>({ phase: "ask" });
  const [ownQuestion, setOwnQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const interestId = useId();
  const interestHintId = useId();
  const ownId = useId();

  const stepId = ONBOARDING_STEPS[state.step];
  const copy =
    stepId === "explore" && explore.phase === "pick"
      ? PICK_COPY[explore.result.source]
      : STEP_COPY[stepId];

  // A new step moves focus to its heading, so a screen reader hears the question.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [state.step, explore.phase]);

  const persist = async (step: number, complete: boolean): Promise<boolean> => {
    const result = await saveOnboardingAnswers({
      answers: state.answers,
      step,
      complete,
    });
    if (!result.ok) setError(result.error);
    return result.ok;
  };

  const move = (direction: "next" | "back") => {
    setError(null);
    const target = Math.max(0, state.step + (direction === "next" ? 1 : -1));
    dispatch({ type: direction });
    void persist(target, false);
  };

  const finishHome = async () => {
    setBusy(true);
    setError(null);
    const saved = await persist(state.step, true);
    if (!saved) {
      setBusy(false);
      return;
    }
    router.push("/");
  };

  const skipSetup = async () => {
    setBusy(true);
    setError(null);
    const result = await skipOnboarding();
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push("/");
  };

  const askForStarters = async () => {
    setError(null);
    setExplore({ phase: "thinking" });
    void persist(state.step, false);
    // The route already falls back on any model trouble; this covers the
    // request itself failing, with the same fixed starters.
    const result = (await fetchStarters(state.answers)) ?? {
      questions: fallbackStarters(state.answers),
      source: "fallback" as const,
    };
    setExplore({ phase: "pick", result });
  };

  const startThread = async (question: string) => {
    const prompt = question.trim();
    if (!prompt) return;
    setBusy(true);
    setError(null);
    await persist(state.step, false);
    const result = await onStartThread(prompt);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(`/t/${result.threadId}`);
  };

  const onContinue = () => {
    if (stepId === "explore") {
      void askForStarters();
      return;
    }
    move("next");
  };

  const onBack = () => {
    if (stepId === "explore" && explore.phase !== "ask") {
      setError(null);
      setExplore({ phase: "ask" });
      return;
    }
    move("back");
  };

  const onSkip = () => {
    if (isLastStep(state.step)) {
      void finishHome();
      return;
    }
    move("next");
  };

  const thinking = stepId === "explore" && explore.phase === "thinking";
  const picking = stepId === "explore" && explore.phase === "pick";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col px-4 py-8 sm:py-14">
      <Card as="section" padding="lg" className="flex flex-col">
        <ProgressDots
          step={state.step}
          total={ONBOARDING_STEPS.length}
          label={stepLabel(state.step)}
        />
        {/* Focused by script on each step so the question is read out. It is
            not a control and is never reached by Tab, so it shows no ring. */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display mt-6 text-3xl leading-tight tracking-tight focus:outline-none"
        >
          {copy.heading}
        </h1>
        <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
          {copy.subtitle}
        </p>

        <div className="mt-6">
          {stepId === "purpose" && (
            <PurposeStep
              answers={state.answers}
              dataModeNote={dataModeSentence(residency.dataMode)}
              onToggleRole={(role) => dispatch({ type: "toggle-role", role })}
              onDataChoice={(choice) => dispatch({ type: "set-data-choice", choice })}
            />
          )}
          {stepId === "connect" && <ConnectStep groups={connectGroups} />}
          {stepId === "sources" && (
            <>
              <SourcesStep
                disabled={state.answers.disabledSources}
                availability={sourceAvailability}
                onChange={(disabled) =>
                  dispatch({ type: "set-disabled-sources", disabled })
                }
              />
              <LiveSourcesList
                enabled={residency.localOnly ? [] : state.answers.liveSources}
                localOnly={residency.localOnly}
                onChange={(enabled) => dispatch({ type: "set-live-sources", enabled })}
              />
            </>
          )}
          {stepId === "residency" && <ResidencyStep config={residency} />}
          {stepId === "explore" && explore.phase === "ask" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={interestId}
                className="text-muted-foreground text-xs font-medium"
              >
                In your own words (optional)
              </label>
              <textarea
                id={interestId}
                rows={3}
                maxLength={MAX_INTEREST_LENGTH}
                value={state.answers.interest}
                onChange={(event) =>
                  dispatch({ type: "set-interest", interest: event.target.value })
                }
                placeholder="e.g. how my sleep and HRV move together after hard training days"
                aria-describedby={interestHintId}
                className="border-input bg-background placeholder:text-muted-foreground w-full resize-none rounded-md border px-3 py-2 text-[15px] leading-relaxed"
              />
              <p
                id={interestHintId}
                className="text-muted-foreground text-xs leading-relaxed"
              >
                {interestHint(residency)}
              </p>
            </div>
          )}
          {thinking && (
            <div role="status" className="flex flex-col gap-2">
              <p className="text-sm">Thinking of a first question&hellip;</p>
              <div className="skeleton h-10 rounded-lg" aria-hidden />
              <div className="skeleton h-10 rounded-lg" aria-hidden />
              <div className="skeleton h-10 rounded-lg" aria-hidden />
            </div>
          )}
          {picking && (
            <div className="flex flex-col gap-4">
              {explore.result.questions.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {explore.result.questions.map((question) => (
                    <li key={question}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void startThread(question)}
                        className="border-border hover:bg-muted w-full rounded-lg border px-3 py-2.5 text-left text-sm leading-relaxed transition-colors disabled:opacity-60"
                      >
                        {question}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex flex-col gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void startThread(ownQuestion);
                }}
              >
                <label
                  htmlFor={ownId}
                  className="text-muted-foreground text-xs font-medium"
                >
                  Write your own
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id={ownId}
                    value={ownQuestion}
                    onChange={(event) => setOwnQuestion(event.target.value)}
                    className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={busy || ownQuestion.trim().length === 0}
                  >
                    Ask
                  </Button>
                </div>
              </form>
              {busy && (
                <p role="status" className="text-muted-foreground text-sm">
                  Opening a new thread&hellip;
                </p>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {error}
          </p>
        )}

        <div className="border-border mt-8 flex items-center justify-between gap-2 border-t pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={busy || thinking || (state.step === 0 && !picking)}
          >
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSkip} disabled={busy || thinking}>
              Skip
            </Button>
            {!picking && (
              <Button
                variant="primary"
                onClick={onContinue}
                disabled={busy || thinking || !canContinue(state)}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      </Card>

      <p className="text-muted-foreground mt-4 text-center text-xs">
        <button
          type="button"
          onClick={() => void skipSetup()}
          disabled={busy}
          className="hover:text-foreground underline underline-offset-2"
        >
          Skip setup
        </button>{" "}
        and go straight to TwinLLM. You can come back from Get started in the sidebar.
      </p>
    </div>
  );
};
