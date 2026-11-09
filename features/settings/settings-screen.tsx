"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";

import { Button, buttonClassName } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";
import { Switch } from "@/infrastructure/ui-kit/switch";

import {
  type SettingRow,
  type SettingsFacts,
  settingsSections,
  type SettingsState,
  type SwitchTarget,
  withSwitch,
} from "./settings-view";

/**
 * Settings (#507): the keep and withhold choices in one list. A switch saves
 * at once through the action its store already had, and goes back with a
 * sentence when the save is refused. A switch toward the riskier way (today,
 * a live lookup on) asks first, in words, and saves only on "Turn on".
 */

export type SaveResult = Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>;

export type SettingsActions = Readonly<{
  saveNotes: (on: boolean) => Promise<SaveResult>;
  saveSources: (input: Readonly<{ disabled: string[] }>) => Promise<SaveResult>;
  saveLive: (input: Readonly<{ enabled: string[] }>) => Promise<SaveResult>;
}>;

const save = (
  actions: SettingsActions,
  target: SwitchTarget,
  next: SettingsState,
): Promise<SaveResult> => {
  switch (target.setting) {
    case "notes":
      return actions.saveNotes(next.notesOn);
    case "source":
      return actions.saveSources({ disabled: [...next.disabledSources] });
    case "live":
      return actions.saveLive({ enabled: [...next.liveSources] });
  }
};

const changedCount = (rows: readonly SettingRow[]): number =>
  rows.filter((row) => !row.isDefault).length;

export const SettingsScreen = ({
  facts,
  initialState,
  actions,
}: Readonly<{
  facts: SettingsFacts;
  initialState: SettingsState;
  actions: SettingsActions;
}>) => {
  const [state, setState] = useState(initialState);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [pending, startTransition] = useTransition();
  const sections = settingsSections(facts, state);
  const changed = changedCount(sections.flatMap((section) => section.rows));

  const apply = (row: SettingRow, target: SwitchTarget, on: boolean) => {
    const previous = state;
    const next = withSwitch(state, target, on);
    setState(next);
    setConfirming(null);
    setErrors((current) => ({ ...current, [row.key]: "" }));
    startTransition(async () => {
      const result = await save(actions, target, next);
      if (!result.ok) {
        setState(previous);
        setErrors((current) => ({ ...current, [row.key]: result.error }));
      }
    });
  };

  const onSwitch = (row: SettingRow, target: SwitchTarget, on: boolean, ask: boolean) => {
    if (on && ask) setConfirming(row.key);
    else apply(row, target, on);
  };

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="settings-heading">
        <h2 id="settings-heading" className="text-lg">
          Settings
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          What TwinLLM keeps on this machine and what it may read or send, in one place.
          Each choice starts at its safe default for this server&rsquo;s data mode, and
          nothing here can be set looser than that mode allows. Every change is saved for
          you and written to the audit chain.
        </p>
        <p className="mt-3 text-sm" aria-live="polite">
          {changed === 0
            ? "Every choice is at its safe default."
            : `${String(changed)} ${changed === 1 ? "choice differs" : "choices differ"} from the safe default.`}
        </p>
      </section>
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`settings-${section.id}`}>
          <h3 id={`settings-${section.id}`} className="text-base font-medium">
            {section.title}
          </h3>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{section.intro}</p>
          <Card padding="sm" className="mt-3">
            <ul className="divide-border divide-y">
              {section.rows.map((row) => (
                <SettingItem
                  key={row.key}
                  row={row}
                  disabled={pending}
                  confirming={confirming === row.key}
                  error={errors[row.key] ?? ""}
                  onSwitch={onSwitch}
                  onCancel={() => setConfirming(null)}
                  onConfirm={apply}
                />
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
};

const SettingItem = ({
  row,
  disabled,
  confirming,
  error,
  onSwitch,
  onCancel,
  onConfirm,
}: Readonly<{
  row: SettingRow;
  disabled: boolean;
  confirming: boolean;
  error: string;
  onSwitch: (row: SettingRow, target: SwitchTarget, on: boolean, ask: boolean) => void;
  onCancel: () => void;
  onConfirm: (row: SettingRow, target: SwitchTarget, on: boolean) => void;
}>) => {
  const { control } = row;
  return (
    <li className="flex flex-col gap-2 px-1 py-3 sm:px-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {row.does}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="metric">Safe default: {row.safeDefault}</span>
            {row.isDefault ? (
              <StatusBadge tone="ok">Default</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Changed</StatusBadge>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end sm:text-right">
          {control.kind === "switch" ? (
            control.locked === null ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground text-xs">
                  {control.on ? "On" : "Off"}
                </span>
                <Switch
                  checked={control.on}
                  disabled={disabled || confirming}
                  label={row.title}
                  onChange={(next) =>
                    onSwitch(row, control.target, next, control.confirmOn !== null)
                  }
                />
              </span>
            ) : (
              <span className="flex flex-col items-start gap-1 sm:max-w-40 sm:items-end">
                <StatusBadge tone="off">{control.on ? "On" : "Off"}</StatusBadge>
                <span className="text-muted-foreground text-xs">{control.locked}</span>
              </span>
            )
          ) : (
            <span className="text-sm">{control.value}</span>
          )}
          {control.kind === "link" ? (
            <Link
              href={control.href}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
            >
              {control.label}
            </Link>
          ) : null}
        </div>
      </div>
      {confirming && control.kind === "switch" && control.confirmOn !== null ? (
        <ConfirmTurnOn
          text={control.confirmOn}
          onConfirm={() => onConfirm(row, control.target, true)}
          onCancel={onCancel}
        />
      ) : null}
      {error === "" ? null : (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </li>
  );
};

/** The explicit step before a riskier choice; focus moves to it and Escape cancels. */
const ConfirmTurnOn = ({
  text,
  onConfirm,
  onCancel,
}: Readonly<{ text: string; onConfirm: () => void; onCancel: () => void }>) => {
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);
  const escape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") onCancel();
  };
  return (
    <div
      role="group"
      aria-label="Confirm this change"
      className="bg-muted rounded-md p-3 text-xs leading-relaxed"
    >
      <p>{text}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          ref={confirm}
          type="button"
          onClick={onConfirm}
          onKeyDown={escape}
          className={buttonClassName({ variant: "primary", size: "sm" })}
        >
          Turn on
        </button>
        <Button size="sm" variant="ghost" onClick={onCancel} onKeyDown={escape}>
          Keep it off
        </Button>
      </div>
    </div>
  );
};
