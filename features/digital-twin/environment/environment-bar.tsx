"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

import { RESEARCH_FOOTER_TEXT } from "@/features/shell/research-footer";
import { CollapsiblePanel } from "@/infrastructure/ui-kit/collapsible-panel";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import {
  ABSTRACT_NOTE,
  FOLLOW_TIME,
  HOW_TO_MOVE,
  LIGHT_AT_MIDDAY,
  LIGHT_FOLLOWS_CLOCK,
  PRESET_LABEL,
  PRESET_TEXT,
  WALK_HINT,
} from "./environment-copy";
import { ENVIRONMENT_PRESETS, type EnvironmentPreset } from "./environment-look";
import {
  browserStorage,
  readHelpOpen,
  rememberFirstVisit,
  saveHelpOpen,
} from "./help-disclosure";

const PRESET_OPTIONS = ENVIRONMENT_PRESETS.map((preset) => ({
  value: preset,
  label: PRESET_TEXT[preset],
}));

export type EnvironmentBarProps = Readonly<{
  /** Whether its panel is open; the first visit counts only once the help was seen. */
  shown: boolean;
  preset: EnvironmentPreset;
  followTime: boolean;
  onPreset: (preset: EnvironmentPreset) => void;
  onFollowTime: () => void;
}>;

/**
 * Preset, the outdoor clock switch, the line that says this is an abstraction,
 * and the walking help folded under "How to move", so the panel stays small.
 */
export const EnvironmentBar = ({
  shown,
  preset,
  followTime,
  onPreset,
  onFollowTime,
}: EnvironmentBarProps) => {
  const followId = useId();
  const [helpOpen, setHelpOpen] = useState(() => readHelpOpen(browserStorage()));
  useEffect(() => {
    if (shown) rememberFirstVisit(browserStorage());
  }, [shown]);
  return (
    <div className="flex max-w-full flex-col gap-1.5 text-xs">
      <SegmentedControl
        label={PRESET_LABEL}
        options={PRESET_OPTIONS}
        value={preset}
        onChange={onPreset}
        size="sm"
      />
      {preset === "outdoors" ? (
        <label htmlFor={followId} className="flex items-center gap-1.5">
          <input
            id={followId}
            type="checkbox"
            checked={followTime}
            onChange={onFollowTime}
          />
          {FOLLOW_TIME}
        </label>
      ) : null}
      <p className="text-muted-foreground">
        {ABSTRACT_NOTE}
        {preset === "outdoors"
          ? ` ${followTime ? LIGHT_FOLLOWS_CLOCK : LIGHT_AT_MIDDAY}`
          : null}
      </p>
      <details
        open={helpOpen}
        // The browser also fires this for the initial `open`; only a real change is saved.
        onToggle={(event) => {
          const open = event.currentTarget.open;
          if (open === helpOpen) return;
          setHelpOpen(open);
          saveHelpOpen(browserStorage(), open);
        }}
        className="text-muted-foreground"
      >
        <summary className="text-foreground cursor-pointer">{HOW_TO_MOVE}</summary>
        <p className="mt-1">{WALK_HINT}</p>
      </details>
    </div>
  );
};

/**
 * The research-use line: the overlay covers the shell footer while values stay
 * on screen, so the footer's sentence comes along, outside any panel that can
 * collapse.
 */
export const ResearchLine = () => (
  <p className="twin-research-line">{RESEARCH_FOOTER_TEXT}</p>
);

/**
 * One viewer panel: inline a card, inside the environment a block floating
 * over the canvas. Both collapse under their title through the shared
 * `CollapsiblePanel`; only the class changes, so the controls inside keep
 * their state, such as the body panel's tab and search, across enter and exit.
 */
export const EnvironmentPanel = ({
  label,
  floating,
  open,
  onToggle,
  children,
}: Readonly<{
  label: string;
  /** Inside the environment. */
  floating: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}>) => (
  <CollapsiblePanel
    label={label}
    open={open}
    onToggle={onToggle}
    className={floating ? "twin-environment-panel" : "twin-panel"}
  >
    {children}
  </CollapsiblePanel>
);
