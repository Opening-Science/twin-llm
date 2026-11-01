"use client";

import { SignInButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";

import { AppAuth, isClientAuthDisabled } from "@/features/auth/app-auth";
import {
  CommandPalette,
  commandOptionId,
  paletteKey,
  unknownCommandHint,
} from "@/features/commands/command-palette";
import {
  type Command,
  matchCommands,
  paletteCommands,
  readsLine,
  skillDraft,
} from "@/features/commands/registry";
import { useWearableStatus } from "@/features/wearables/use-wearable-status";
import { WearableChips, WearableSlashMenu } from "@/features/wearables/wearable-slash";
import { DEFAULT_EFFORT, type EffortLevel } from "@/infrastructure/chat-effort";
import { INCOGNITO_MODEL_NOT_LOCAL } from "@/infrastructure/incognito";
import {
  type CatalogModel,
  findCatalogRow,
  turnModelName,
} from "@/infrastructure/model-catalog";
import { Button } from "@/infrastructure/ui-kit/button";

import { initialSelection, MODE_COPY, modeModelIds, modeProblem } from "./chat-mode";
import { EffortMenu } from "./effort-menu";
import { Mark } from "./marks";
import { ModeMenu } from "./mode-menu";
import { incognitoHint, missingCount, offeredModels } from "./model-selection";
import { routeDraft, routePick } from "./prompt-route";
import {
  matchSources,
  NO_SOURCE_FACTS,
  type PromptSource,
  type PromptSourceFacts,
  promptSources,
} from "./prompt-sources";
import { promptToken, withMention } from "./prompt-tokens";
import { SourceMenu, sourceOptionId } from "./source-menu";
import type { SuggestedQuestions } from "./suggested-questions";
import { SuggestionChips } from "./suggestion-chips";

/**
 * Where a prompt is written and where it goes. It knows nothing about turns
 * or streams: it hands "this text, these models, this effort" upward and
 * clears.
 *
 * Under the text box (#366):
 * - Sources (`@`): the sources this person can point a question at here
 *   (`prompt-sources.ts`). Typing `@` and a word opens the same list.
 *   Picking one writes `@Name` into the question; "Import a file" opens the
 *   import page.
 * - Mode (`mode-menu.tsx`): Auto, Manual or Compare and, for the latter two,
 *   the specialists and models (`chat-mode.ts`). A thread reopens in the mode
 *   its last answers show.
 * - Effort (`effort-menu.tsx`): five steps (`chat-effort.ts`). At Ultra the
 *   box takes a faint tint.
 * - Send, which is Stop while answers stream into this tab (`onStop`).
 *
 * Typing `/` (or `/` and a word) opens the command palette; picking `connect`
 * shows the wearable rows; picking `twin` (or sending `/twin`) shows the twin
 * card in the conversation and asks no model. Picking a skill writes `/sleep `
 * into the prompt so a window or subject can follow; a prompt that starts with
 * a listed skill is sent tagged with it. Enter sends, Shift+Enter starts a new
 * line.
 *
 * On an empty thread, suggested questions sit above the prompt; picking one
 * writes it into the prompt to be read or edited first, never sent.
 *
 * In an incognito chat only local models can be chosen; the others stay in
 * the menu, greyed out with the reason, and the frame is dashed.
 */

export type ChosenModel = Readonly<{ id: string; name: string }>;

const missingHint = (missing: number, chosen: number): string | null => {
  if (missing === 0) return null;
  if (chosen === 0) {
    return "None of this thread's models are on the list any more. Choose one to carry on.";
  }
  return missing === 1
    ? "One of this thread's models is no longer offered, so this prompt goes to the rest."
    : `${String(missing)} of this thread's models are no longer offered, so this prompt goes to the rest.`;
};

const disconnect = (path: string, refresh: () => Promise<void>) => () => {
  void fetch(path, { method: "DELETE" }).finally(() => void refresh());
};

export const PromptBar = ({
  catalog,
  initialModelIds,
  initialEffort = DEFAULT_EFFORT,
  busy,
  streaming = false,
  skills = [],
  suggestions = null,
  incognito = false,
  localModelIds = [],
  initialDraft = "",
  sourceFacts = NO_SOURCE_FACTS,
  onSubmit,
  onStop = () => undefined,
  onTwin,
  onCompact,
}: Readonly<{
  catalog: readonly CatalogModel[] | null;
  initialModelIds: readonly string[];
  /** The effort a reopened thread's last turn ran at (#379); Balanced for a new chat. */
  initialEffort?: EffortLevel;
  /** A prompt is being written down; the box waits. */
  busy: boolean;
  /** Answers are streaming into this tab: Send becomes Stop. */
  streaming?: boolean;
  /** Skills the server offers, as palette commands. */
  skills?: readonly Command[];
  /** Shown above the prompt; null once the thread has a turn. */
  suggestions?: SuggestedQuestions | null;
  /** An incognito chat: only `localModelIds` may be chosen. */
  incognito?: boolean;
  localModelIds?: readonly string[];
  /** A `/command ` the search box opened the chat with (`safeDraft`). */
  initialDraft?: string;
  /** What the sources list may offer (`prompt-source-facts.ts`). */
  sourceFacts?: PromptSourceFacts;
  onSubmit: (
    prompt: string,
    models: readonly ChosenModel[],
    skill: string | null,
    effort: EffortLevel,
  ) => void;
  /** Stop: closes this tab's open answer streams. */
  onStop?: () => void;
  /** `/twin`: show the twin card. Never a turn. */
  onTwin: () => void;
  /** `/compact`: draft a twin note of the thread (#43). Never a turn. */
  onCompact: () => void;
}>) => {
  const router = useRouter();
  const wearables = useWearableStatus();
  const offered = catalog ? offeredModels(catalog, incognito, localModelIds) : null;
  const [draft, setDraft] = useState(initialDraft);
  const [selection, setSelection] = useState(() =>
    initialSelection(initialModelIds, offered ?? []),
  );
  const [effort, setEffort] = useState<EffortLevel>(initialEffort);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [picked, setPicked] = useState<Command | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const chosen = offered
    ? modeModelIds(selection, offered).flatMap((id) => {
        const row = findCatalogRow(id, offered);
        return row === null ? [] : [row];
      })
    : [];
  const problem = offered ? modeProblem(selection, offered) : null;
  const lockedIds =
    catalog && offered && incognito
      ? catalog.filter((model) => !offered.includes(model)).map((model) => model.id)
      : [];

  const token = menuDismissed ? null : promptToken(draft);
  const slashOpen = token?.kind === "slash";
  const atToken = token?.kind === "at" ? token : null;
  const atOpen = !slashOpen && (sourcesOpen || atToken !== null);
  const commands = slashOpen ? matchCommands(token.query, paletteCommands(skills)) : [];
  const sources = atOpen
    ? matchSources(
        promptSources(sourceFacts, {
          oura: wearables.oura?.connected === true,
          whoop: wearables.whoop?.connected === true,
          googleHealth: wearables.googleHealth?.connected === true,
        }),
        atToken?.query ?? "",
      )
    : [];
  const skillTurn = skillDraft(draft, skills);
  const paletteOpen = slashOpen && picked === null;
  const connectOpen = slashOpen && picked?.name === "connect";
  const listLength = paletteOpen ? commands.length : atOpen ? sources.length : 0;
  const active = Math.min(activeIndex, Math.max(listLength - 1, 0));
  const ready = !busy && draft.trim() !== "" && chosen.length > 0 && problem === null;

  const reset = () => {
    setPicked(null);
    setActiveIndex(0);
    setNotice(undefined);
    setSourcesOpen(false);
  };

  const openTwin = () => {
    onTwin();
    setDraft("");
    reset();
  };

  const openCompact = () => {
    onCompact();
    setDraft("");
    reset();
  };

  const submit = () => {
    if (busy) return;
    routeDraft(draft, {
      openTwin,
      openCompact,
      send: () => {
        if (!ready || catalog === null) return;
        const prompt = skillTurn?.prompt ?? draft;
        onSubmit(
          prompt,
          chosen.map((model) => ({
            id: model.id,
            name: turnModelName(model, catalog, prompt),
          })),
          skillTurn?.skill.name ?? null,
          effort,
        );
        setDraft("");
        reset();
      },
    });
  };

  /**
   * A skill goes into the prompt to be sent; `twin` shows its card at once;
   * another built-in opens its own menu.
   */
  const pickCommand = (command: Command | null) => {
    if (routePick(command, { openTwin, openCompact })) return;
    if (command?.kind === "skill") {
      setDraft(`/${command.name} `);
      reset();
      return;
    }
    setPicked(command);
  };

  const pickSource = (source: PromptSource) => {
    if (source.href !== undefined) {
      router.push(source.href);
      return;
    }
    const mention = `@${source.name.replace(/\s+/g, "")} `;
    setDraft((text) =>
      atToken !== null
        ? withMention(text, atToken, source.name)
        : `${text}${text === "" || /\s$/.test(text) ? "" : " "}${mention}`,
    );
    reset();
    promptRef.current?.focus();
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (streaming) onStop();
    else submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (paletteOpen) {
      const action = paletteKey(event.key, active, commands.length);
      if (action === null) return;
      event.preventDefault();
      if (action === "close") setMenuDismissed(true);
      else if (action === "pick") pickCommand(commands[active] ?? null);
      else if (action === "unknown") setNotice(unknownCommandHint(draft));
      else setActiveIndex(action.index);
      return;
    }
    if (slashOpen && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault();
      if (event.key === "Escape") setMenuDismissed(true);
      return;
    }
    if (atOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuDismissed(true);
        setSourcesOpen(false);
        return;
      }
      const count = sources.length;
      if (count > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setActiveIndex((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      const source = sources[active];
      if (source !== undefined && (event.key === "Tab" || event.key === "Enter")) {
        event.preventDefault();
        pickSource(source);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const activeOption = paletteOpen
    ? commands[active] === undefined
      ? undefined
      : commandOptionId(commands[active].name)
    : atOpen && sources[active] !== undefined
      ? sourceOptionId(sources[active].key)
      : undefined;

  const hint = skillTurn
    ? `Sends with /${skillTurn.skill.name}, which ${readsLine(skillTurn.skill.reads)}.`
    : incognito
      ? incognitoHint(offered?.length ?? 0)
      : (missingHint(missingCount(catalog, initialModelIds), chosen.length) ??
        problem ??
        MODE_COPY[selection.mode].line);

  return (
    <div className="bg-background/90 sticky bottom-0 z-10 px-4 pt-2 pb-3 backdrop-blur sm:px-6">
      {suggestions ? (
        <SuggestionChips
          suggestions={suggestions}
          onPick={(question) => {
            setDraft(question.prompt);
            setMenuDismissed(false);
            reset();
            promptRef.current?.focus();
          }}
        />
      ) : null}
      <form
        onSubmit={onFormSubmit}
        data-incognito={incognito ? "true" : undefined}
        data-effort={effort}
        className="surface relative mx-auto max-w-5xl"
      >
        {paletteOpen ? (
          <CommandPalette
            commands={commands}
            activeIndex={active}
            onPick={pickCommand}
            notice={notice}
          />
        ) : null}
        {atOpen ? (
          <SourceMenu
            sources={sources}
            activeIndex={active}
            onPick={pickSource}
            onHover={setActiveIndex}
          />
        ) : null}
        <WearableSlashMenu
          open={connectOpen}
          oura={wearables.oura}
          whoop={wearables.whoop}
          googleHealth={wearables.googleHealth}
          onClose={() => {
            setMenuDismissed(true);
            setDraft((text) => (text === "/" ? "" : text));
          }}
        />
        <label htmlFor="prompt" className="sr-only">
          Your prompt
        </label>
        <textarea
          id="prompt"
          ref={promptRef}
          rows={2}
          value={draft}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setMenuDismissed(false);
            reset();
          }}
          onKeyDown={onKeyDown}
          aria-activedescendant={activeOption}
          placeholder={
            incognito
              ? "Ask in incognito…  @ for sources, / for commands"
              : "Ask TwinLLM…  @ for sources, / for commands"
          }
          className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none disabled:opacity-60"
        />
        <div className="flex items-end gap-3 px-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Sources"
              aria-expanded={atOpen}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setActiveIndex(0);
                setMenuDismissed(false);
                setSourcesOpen((was) => !was);
                promptRef.current?.focus();
              }}
              className="size-8 shrink-0 p-0"
            >
              <Mark name="sources" />
            </Button>
            {catalog && offered ? (
              <ModeMenu
                catalog={catalog}
                selection={selection}
                lockedIds={lockedIds}
                lockedNote={INCOGNITO_MODEL_NOT_LOCAL}
                onChange={setSelection}
              />
            ) : (
              <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                The model list didn&rsquo;t load, so there is nowhere to send a prompt
                yet.
                <Button variant="pill" size="sm" onClick={() => router.refresh()}>
                  Try again
                </Button>
              </p>
            )}
            <EffortMenu effort={effort} onChange={setEffort} />
            <WearableChips
              oura={wearables.oura}
              whoop={wearables.whoop}
              googleHealth={wearables.googleHealth}
              onDisconnectOura={disconnect("/api/oura/disconnect", wearables.refresh)}
              onDisconnectWhoop={disconnect("/api/whoop/disconnect", wearables.refresh)}
              onDisconnectGoogleHealth={disconnect(
                "/api/google-health/disconnect",
                wearables.refresh,
              )}
            />
          </div>
          <AppAuth>
            {({ isSignedIn }) =>
              isSignedIn || isClientAuthDisabled() ? (
                <Button
                  type="submit"
                  variant="primary"
                  aria-label={streaming ? "Stop the answers" : "Send prompt"}
                  disabled={!streaming && !ready}
                  className="size-9 shrink-0 p-0"
                >
                  <Mark name={streaming ? "stop" : "send"} />
                </Button>
              ) : (
                <SignInButton mode="modal">
                  <Button variant="primary" className="shrink-0">
                    Sign in to send
                  </Button>
                </SignInButton>
              )
            }
          </AppAuth>
        </div>
      </form>
      <p className="text-muted-foreground mt-1.5 text-center text-xs" aria-live="polite">
        {hint}
      </p>
    </div>
  );
};
