"use client";

import Link from "next/link";
import { useId, useState } from "react";

import {
  groupOnCount,
  KNOWLEDGE_SOURCE_GROUPS,
  type KnowledgeSourceId,
  setGroupEnabled,
  setSourceEnabled,
} from "@/infrastructure/knowledge-sources";
import { cn } from "@/infrastructure/ui";
import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { StatusBadge, type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import type { ConnectGroup, ConnectState, SourceAvailability } from "./connect-rows";
import {
  dataModeSentence,
  HOW_TO_SWITCH,
  PROVIDER_NAME,
  RESIDENCY_TONE_LABEL,
  residencyChoice,
  type ResidencyConfig,
  residencyRows,
  type ResidencyTone,
} from "./data-residency";
import { ChoiceOption, LaterNote, Switch } from "./onboarding-parts";
import {
  DATA_CHOICES,
  type DataChoiceId,
  type OnboardingAnswers,
  type RoleId,
  ROLES,
} from "./onboarding-steps";

/**
 * The body of each onboarding step. The card, the dots and the buttons live in
 * `OnboardingFlow`; these only render one question and report changes up.
 */

export const PurposeStep = ({
  answers,
  dataModeNote,
  onToggleRole,
  onDataChoice,
}: {
  readonly answers: OnboardingAnswers;
  readonly dataModeNote: string;
  readonly onToggleRole: (role: RoleId) => void;
  readonly onDataChoice: (choice: DataChoiceId) => void;
}) => (
  <div className="flex flex-col gap-6">
    <fieldset>
      <legend className="text-eyebrow mb-2">I&rsquo;m here as</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {ROLES.map((role) => (
          <ChoiceOption
            key={role.id}
            type="checkbox"
            name="role"
            checked={answers.roles.includes(role.id)}
            onChange={() => onToggleRole(role.id)}
            label={role.label}
            hint={role.hint}
          />
        ))}
      </div>
    </fieldset>
    <fieldset>
      <legend className="text-eyebrow mb-2">Start with</legend>
      <div className="grid gap-2">
        {DATA_CHOICES.map((choice) => (
          <ChoiceOption
            key={choice.id}
            type="radio"
            name="data-choice"
            checked={answers.dataChoice === choice.id}
            onChange={() => onDataChoice(choice.id)}
            label={choice.label}
            hint={choice.hint}
          />
        ))}
      </div>
    </fieldset>
    <LaterNote>This tailors the starter questions at the end. {dataModeNote}</LaterNote>
  </div>
);

const CONNECT_TONE: Readonly<Record<ConnectState, StatusTone>> = {
  linked: "ok",
  on: "ok",
  ready: "neutral",
  "not-set-up": "off",
};

export const ConnectStep = ({ groups }: { readonly groups: readonly ConnectGroup[] }) => (
  <div className="flex flex-col gap-5">
    {groups.map((group) => (
      <section key={group.label} aria-label={group.label}>
        <h2 className="text-eyebrow mb-2">{group.label}</h2>
        <ul className="border-border divide-border divide-y rounded-lg border">
          {group.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                  {row.name}
                  <StatusBadge tone={CONNECT_TONE[row.state]}>
                    {row.stateLabel}
                  </StatusBadge>
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {row.purpose}
                </p>
              </div>
              {row.action &&
                (row.action.external ? (
                  <a href={row.action.href} className={buttonClassName({ size: "sm" })}>
                    {row.action.label}
                  </a>
                ) : (
                  <Link
                    href={row.action.href}
                    className={buttonClassName({ size: "sm" })}
                  >
                    {row.action.label}
                  </Link>
                ))}
            </li>
          ))}
        </ul>
      </section>
    ))}
    <LaterNote>
      Linking opens the vendor&rsquo;s sign-in and returns to Connectors; come back here
      from Get started in the sidebar. Change anytime on the{" "}
      <Link href="/customize/connectors" className="underline underline-offset-2">
        Connectors
      </Link>{" "}
      page.
    </LaterNote>
  </div>
);

const ChevronIcon = ({ open }: { readonly open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>
);

export const SourcesStep = ({
  disabled,
  availability,
  onChange,
}: {
  readonly disabled: readonly KnowledgeSourceId[];
  readonly availability: Readonly<Record<KnowledgeSourceId, SourceAvailability>>;
  readonly onChange: (next: readonly KnowledgeSourceId[]) => void;
}) => {
  const [openGroups, setOpenGroups] = useState<readonly string[]>([]);
  const baseId = useId();
  const usable = (id: KnowledgeSourceId) => availability[id].available;

  return (
    <div>
      <ul className="border-border divide-border divide-y rounded-lg border">
        {KNOWLEDGE_SOURCE_GROUPS.map((group) => {
          const open = openGroups.includes(group.id);
          const { on, total } = groupOnCount(group, disabled, usable);
          const panelId = `${baseId}-${group.id}`;
          return (
            <li key={group.id}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() =>
                    setOpenGroups((current) =>
                      open
                        ? current.filter((id) => id !== group.id)
                        : [...current, group.id],
                    )
                  }
                  className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left"
                >
                  <span className="text-muted-foreground mt-0.5">
                    <ChevronIcon open={open} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{group.label}</span>
                    <span className="text-muted-foreground block text-xs leading-relaxed">
                      {group.description}
                    </span>
                    <span className="metric mt-1 block">
                      {total === 0
                        ? "Unavailable here"
                        : `${String(on)} of ${String(total)} on`}
                    </span>
                  </span>
                </button>
                <Switch
                  checked={total > 0 && on === total}
                  disabled={total === 0}
                  label={`${group.label}: all sources`}
                  onChange={(next) =>
                    onChange(setGroupEnabled(disabled, group, next, usable))
                  }
                />
              </div>
              <ul id={panelId} hidden={!open} className="bg-background/40 pb-1">
                {group.sources.map((source) => {
                  const state = availability[source.id];
                  return (
                    <li
                      key={source.id}
                      className="flex items-center gap-3 py-2 pr-3 pl-9 sm:pl-10"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{source.label}</p>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {source.description}
                        </p>
                      </div>
                      {state.available ? (
                        <Switch
                          checked={!disabled.includes(source.id)}
                          label={source.label}
                          onChange={(next) =>
                            onChange(setSourceEnabled(disabled, source.id, next))
                          }
                        />
                      ) : (
                        <StatusBadge tone="off">
                          {state.note ?? "Unavailable"}
                        </StatusBadge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <LaterNote>
        A source that is off is left out of every chat answer. The Anchor reference
        intervals on the Digital Twin page are not a chat source, so they have no switch.
        Change anytime from Get started in the sidebar.
      </LaterNote>
    </div>
  );
};

const RESIDENCY_BADGE: Readonly<Record<ResidencyTone, StatusTone>> = {
  stays: "ok",
  download: "neutral",
  leaves: "neutral",
  off: "off",
};

const ResidencyOption = ({
  title,
  body,
  current,
}: {
  readonly title: string;
  readonly body: string;
  readonly current: boolean;
}) => (
  <li
    className={cn(
      "rounded-lg border px-3 py-2.5",
      current ? "border-primary bg-muted" : "border-border",
    )}
  >
    <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
      {title}
      {current ? (
        <StatusBadge tone="ok">In use</StatusBadge>
      ) : (
        <StatusBadge tone="off">Not in use</StatusBadge>
      )}
    </p>
    <p className="text-muted-foreground text-xs leading-relaxed">{body}</p>
  </li>
);

export const ResidencyStep = ({ config }: { readonly config: ResidencyConfig }) => {
  const choice = residencyChoice(config);
  return (
    <div className="flex flex-col gap-5">
      <ul className="grid gap-2 sm:grid-cols-2">
        <ResidencyOption
          title="Local only"
          body="Models, embeddings and storage on this machine. Cloud services are refused at startup."
          current={choice === "local-only"}
        />
        <ResidencyOption
          title="Our own cloud models"
          body="Open models we run on an Exoscale instance in Switzerland."
          current={choice === "own-cloud"}
        />
      </ul>
      {choice === "other" && (
        <p className="text-sm">
          In use: <span className="font-medium">{PROVIDER_NAME[config.provider]}</span>
        </p>
      )}
      <section aria-label="What leaves this machine">
        <h2 className="text-eyebrow mb-2">What leaves this machine</h2>
        <ul className="border-border divide-border divide-y rounded-lg border">
          {residencyRows(config).map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{row.label}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {row.where}
                </p>
              </div>
              <StatusBadge tone={RESIDENCY_BADGE[row.tone]} className="mt-0.5">
                {RESIDENCY_TONE_LABEL[row.tone]}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </section>
      <LaterNote>
        {HOW_TO_SWITCH} {dataModeSentence(config.dataMode)}
      </LaterNote>
    </div>
  );
};
