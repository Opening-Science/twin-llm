"use client";

import { SignInButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react";

import { AppAuth } from "@/features/auth/app-auth";
import {
  CommandPalette,
  commandOptionId,
  paletteKey,
  unknownCommandHint,
} from "@/features/commands/command-palette";
import {
  COMPACT_COMMAND,
  type Command,
  matchCommands,
  paletteCommands,
  skillDraft,
  TWIN_COMMAND,
} from "@/features/commands/registry";
import { useWearableStatus } from "@/features/wearables/use-wearable-status";
import { WearableChips, WearableSlashMenu } from "@/features/wearables/wearable-slash";
import type { EffortLevel } from "@/infrastructure/chat-effort";
import type { CatalogModel } from "@/infrastructure/model-catalog";

import {
  droppedModels,
  initialModeState,
  MODE_COPY,
  type ModeContext,
  modeProblem,
  type ModeState,
  pickedModels,
} from "./chat-modes";
import type { PromptSend, PromptSourceFacts } from "./conversation";
import { EffortPicker } from "./effort-picker";
import { ModePicker } from "./mode-picker";
import { promptHint } from "./prompt-hint";
import {
  IMPORT_FILE,
  matchSources,
  mentionQuery,
  slashQuery,
  type SourceOption,
  sourceKey,
  sourceOptionId,
  sourceOptions,
  withCommand,
  withMention,
} from "./prompt-menus";
import { SourcesMenu } from "./sources-menu";
import { SuggestionChips } from "./suggestion-chips";
import { chipSend, type SuggestedQuestion } from "./suggestion-send";

/**
 * The prompt bar (SPEC 3.3, 7): suggested questions on an empty thread, the
 * composer with its Sources, mode and effort controls and linked wearables,
 * Send (Stop while answers stream), and one hint line. The sticky frame
 * around it is the screen's.
 */

export const CATALOG_FAILED =
  "The model list did not load, so there is nowhere to send this yet.";
export const DATA_HREF = "/customize/data";

const ICON_BUTTON =
  "border-input hover:bg-muted text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-full border text-sm transition-colors";

const ArrowUp = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className="size-4"
  >
    <path d="M10 16V4M5 9l5-5 5 5" />
  </svg>
);

const StopSquare = () => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    className="size-3.5"
  >
    <rect x="5" y="5" width="10" height="10" rx="1.5" />
  </svg>
);

const SEND_BUTTON =
  "bg-primary text-primary-foreground hover:bg-primary/90 inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const disconnect = async (path: "oura" | "whoop" | "google-health"): Promise<void> => {
  const routes = {
    oura: () => fetch("/api/oura/disconnect", { method: "DELETE" }),
    whoop: () => fetch("/api/whoop/disconnect", { method: "DELETE" }),
    "google-health": () => fetch("/api/google-health/disconnect", { method: "DELETE" }),
  } as const;
  await routes[path]().catch(() => undefined);
};

export const PromptBar = ({
  catalog,
  incognito,
  localModelIds,
  skills,
  sourceFacts,
  initialDraft,
  subjectRef,
  lastTurnModelIds,
  initialEffort,
  showSuggestions,
  sending,
  streaming,
  onSend,
  onStop,
  onTwin,
  onCompact,
}: Readonly<{
  catalog: readonly CatalogModel[] | null;
  incognito: boolean;
  localModelIds: readonly string[];
  skills: readonly Command[];
  sourceFacts: PromptSourceFacts;
  initialDraft?: string;
  subjectRef?: string;
  lastTurnModelIds: readonly string[] | null;
  initialEffort: EffortLevel;
  showSuggestions: boolean;
  sending: boolean;
  streaming: boolean;
  onSend: (send: PromptSend) => void;
  onStop: () => void;
  onTwin: () => void;
  onCompact: () => void;
}>) => {
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const labelId = useId();
  const context: ModeContext = { catalog: catalog ?? [], incognito, localModelIds };
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [modes, setModes] = useState<ModeState>(() =>
    initialModeState(context, lastTurnModelIds),
  );
  const [effort, setEffort] = useState<EffortLevel>(initialEffort);
  const [chip, setChip] = useState<SuggestedQuestion | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [connectOpen, setConnectOpen] = useState(false);
  const wearables = useWearableStatus();

  const commands = paletteCommands(skills);
  const slash = dismissed === draft ? null : slashQuery(draft);
  const mention = dismissed === draft || slash !== null ? null : mentionQuery(draft);
  const commandMatches = slash === null ? [] : matchCommands(slash, commands);
  const sourceMatches =
    mention === null
      ? []
      : matchSources(
          mention,
          sourceOptions(sourceFacts, {
            oura: wearables.oura?.connected === true,
            whoop: wearables.whoop?.connected === true,
            googleHealth: wearables.googleHealth?.connected === true,
          }),
        );
  const activeIndex = Math.min(
    active,
    Math.max(0, (slash === null ? sourceMatches : commandMatches).length - 1),
  );
  const activeDescendant =
    slash !== null
      ? commandMatches[activeIndex] === undefined
        ? undefined
        : commandOptionId(commandMatches[activeIndex].name)
      : mention !== null && sourceMatches[activeIndex] !== undefined
        ? sourceOptionId(sourceMatches[activeIndex].id)
        : undefined;

  const skill = skillDraft(draft, skills);
  const typedPrompt = skill?.prompt ?? draft.trim();
  const problem =
    catalog === null ? CATALOG_FAILED : modeProblem(modes, context, typedPrompt);
  const picked = pickedModels(modes, context, typedPrompt);
  const canSend =
    !sending && draft.trim() !== "" && picked.length > 0 && problem === null;
  const hint = promptHint({
    skill: skill === null ? null : skill.skill,
    incognito,
    anyLocal: localModelIds.length > 0,
    dropped: modes.fromThread ? droppedModels(lastTurnModelIds, context) : null,
    problem: catalog === null ? null : problem,
    modeLine: MODE_COPY[modes.mode].line,
  });

  const changeDraft = (next: string) => {
    setDraft(next);
    setActive(0);
    setNotice(undefined);
  };

  const closeMenus = () => {
    setDismissed(draft);
    setConnectOpen(false);
  };

  const send = () => {
    if (!canSend) return;
    const sent =
      skill === null
        ? { ...chipSend(draft, chip), skill: null }
        : { prompt: skill.prompt, label: null, skill: skill.skill.name };
    onSend({ ...sent, models: picked, effort });
    setDraft("");
    setChip(null);
    setDismissed(null);
    setConnectOpen(false);
    setActive(0);
  };

  const pickCommand = (command: Command) => {
    if (command.name === TWIN_COMMAND) {
      changeDraft("");
      onTwin();
      return;
    }
    if (command.name === COMPACT_COMMAND) {
      changeDraft("");
      onCompact();
      return;
    }
    if (command.name === "connect") {
      changeDraft("");
      setConnectOpen(true);
      return;
    }
    changeDraft(withCommand(command.name));
    box.current?.focus();
  };

  const pickSource = (option: SourceOption) => {
    if (option.kind === IMPORT_FILE.kind) {
      router.push(DATA_HREF);
      return;
    }
    changeDraft(withMention(draft, option));
    box.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (slash !== null) {
      const action = paletteKey(event.key, activeIndex, commandMatches.length);
      if (action !== null) {
        event.preventDefault();
        if (action === "close") closeMenus();
        else if (action === "unknown") setNotice(unknownCommandHint(draft));
        else if (action === "pick") {
          const command = commandMatches[activeIndex];
          if (command !== undefined) pickCommand(command);
        } else setActive(action.index);
        return;
      }
    } else if (mention !== null) {
      const action = sourceKey(event.key, activeIndex, sourceMatches.length);
      if (action !== null) {
        event.preventDefault();
        if (action === "close") closeMenus();
        else if (action === "pick") {
          const option = sourceMatches[activeIndex];
          if (option !== undefined) pickSource(option);
        } else setActive(action.index);
        return;
      }
    }
    if (event.key === "Escape" && connectOpen) {
      setConnectOpen(false);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (streaming) onStop();
      else send();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (streaming) onStop();
    else send();
  };

  const sendButton = streaming ? (
    <button type="submit" aria-label="Stop the answers" className={SEND_BUTTON}>
      <StopSquare />
    </button>
  ) : (
    <button
      type="submit"
      aria-label="Send prompt"
      disabled={!canSend}
      className={SEND_BUTTON}
    >
      <ArrowUp />
    </button>
  );

  return (
    <div className="flex w-full flex-col">
      {showSuggestions ? (
        <SuggestionChips
          {...(subjectRef === undefined ? {} : { subjectRef })}
          onPick={(question) => {
            changeDraft(question.label);
            setChip(question);
            box.current?.focus();
          }}
        />
      ) : null}
      <form
        onSubmit={onSubmit}
        className="surface relative flex flex-col gap-2 p-3"
        data-incognito={incognito ? "" : undefined}
        data-effort={effort === "ultra" ? "ultra" : undefined}
      >
        <div id={`${labelId}-menus`}>
          {slash !== null ? (
            <CommandPalette
              commands={commandMatches}
              activeIndex={activeIndex}
              onPick={pickCommand}
              onHover={setActive}
              {...(notice === undefined ? {} : { notice })}
            />
          ) : null}
          {mention !== null ? (
            <SourcesMenu
              options={sourceMatches}
              activeIndex={activeIndex}
              onPick={pickSource}
              onHover={setActive}
            />
          ) : null}
          <WearableSlashMenu
            open={connectOpen}
            oura={wearables.oura}
            whoop={wearables.whoop}
            googleHealth={wearables.googleHealth}
            onClose={() => setConnectOpen(false)}
          />
        </div>
        <label id={labelId} htmlFor={`${labelId}-box`} className="sr-only">
          Your prompt
        </label>
        <textarea
          ref={box}
          id={`${labelId}-box`}
          rows={2}
          value={draft}
          disabled={sending}
          onChange={(event) => {
            changeDraft(event.target.value);
            if (chip !== null && !event.target.value.startsWith(chip.label))
              setChip(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={`${incognito ? "Ask in incognito…" : "Ask TwinLLM…"}  @ for sources, / for commands`}
          role="combobox"
          aria-controls={`${labelId}-menus`}
          aria-expanded={slash !== null || mention !== null}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          aria-describedby={hintId}
          className="placeholder:text-muted-foreground max-h-60 min-h-[3rem] w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed outline-none disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label="Sources"
            aria-expanded={mention !== null}
            onClick={() => {
              const next = draft === "" || /\s$/.test(draft) ? `${draft}@` : `${draft} @`;
              setDismissed(null);
              changeDraft(next);
              box.current?.focus();
            }}
            className={ICON_BUTTON}
          >
            <span aria-hidden="true">@</span>
          </button>
          {catalog === null ? (
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              {CATALOG_FAILED}
              <button
                type="button"
                onClick={() => router.refresh()}
                className="border-input hover:bg-muted text-foreground rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                Try again
              </button>
            </span>
          ) : (
            <>
              <ModePicker
                state={modes}
                context={context}
                prompt={typedPrompt}
                onChange={setModes}
                disabled={sending}
              />
              <EffortPicker effort={effort} onChange={setEffort} disabled={sending} />
            </>
          )}
          <WearableChips
            oura={wearables.oura}
            whoop={wearables.whoop}
            googleHealth={wearables.googleHealth}
            onDisconnectOura={() => void disconnect("oura").then(wearables.refresh)}
            onDisconnectWhoop={() => void disconnect("whoop").then(wearables.refresh)}
            onDisconnectGoogleHealth={() =>
              void disconnect("google-health").then(wearables.refresh)
            }
          />
          <span className="ml-auto">
            <AppAuth>
              {(auth) =>
                auth.isLoaded && !auth.isSignedIn ? (
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      className="border-input hover:bg-muted rounded-lg border px-3 py-1.5 text-xs font-medium"
                    >
                      Sign in to send
                    </button>
                  </SignInButton>
                ) : (
                  sendButton
                )
              }
            </AppAuth>
          </span>
        </div>
      </form>
      <p
        id={hintId}
        aria-live="polite"
        className="text-muted-foreground mt-2 text-center text-xs leading-snug"
      >
        {hint}
      </p>
    </div>
  );
};
