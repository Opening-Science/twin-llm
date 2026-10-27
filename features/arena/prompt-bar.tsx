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
import type { CatalogModel } from "@/infrastructure/model-catalog";
import { Button } from "@/infrastructure/ui-kit/button";

import { Mark } from "./marks";
import { ModelMenu } from "./model-menu";
import { chosenModels, missingCount, toggleModel } from "./model-selection";
import type { SuggestedQuestions } from "./suggested-questions";
import { SuggestionChips } from "./suggestion-chips";

/**
 * Where a prompt is written and its models are chosen. It knows nothing about
 * turns or streams: it hands "this text, these models" upward and clears.
 *
 * Typing `/` (or `/` and a word) opens the command palette; picking `connect`
 * shows the wearable rows. Picking a skill writes `/sleep ` into the prompt so
 * a window or subject can follow; a prompt that starts with a listed skill is
 * sent tagged with it. Enter sends, Shift+Enter starts a new line.
 *
 * On an empty thread, suggested questions sit above the prompt; picking one
 * writes it into the prompt to be read or edited first, never sent.
 */

export type ChosenModel = Readonly<{ id: string; name: string }>;

const SLASH_COMMAND = /^\/[a-z]*$/i;

const hintFor = (missing: number, chosen: number): string => {
  if (missing === 0) return "One to three models. Linked wearables appear beside them.";
  if (chosen === 0) {
    return "None of this thread's models are on the list any more. Choose one to carry on.";
  }
  return missing === 1
    ? "One of this thread's models is no longer offered, so this prompt goes to the rest."
    : `${missing} of this thread's models are no longer offered, so this prompt goes to the rest.`;
};

const disconnect = (path: string, refresh: () => Promise<void>) => () => {
  void fetch(path, { method: "DELETE" }).finally(() => void refresh());
};

export const PromptBar = ({
  catalog,
  initialModelIds,
  busy,
  skills = [],
  suggestions = null,
  onSubmit,
}: Readonly<{
  catalog: readonly CatalogModel[] | null;
  initialModelIds: readonly string[];
  busy: boolean;
  /** Skills the server offers, as palette commands. */
  skills?: readonly Command[];
  /** Shown above the prompt; null once the thread has a turn. */
  suggestions?: SuggestedQuestions | null;
  onSubmit: (
    prompt: string,
    models: readonly ChosenModel[],
    skill: string | null,
  ) => void;
}>) => {
  const router = useRouter();
  const wearables = useWearableStatus();
  const [draft, setDraft] = useState("");
  const [modelIds, setModelIds] = useState<readonly string[]>(initialModelIds);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [picked, setPicked] = useState<Command | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const chosen = catalog ? chosenModels(catalog, modelIds) : [];
  const slashOpen = !slashDismissed && SLASH_COMMAND.test(draft);
  const commands = slashOpen
    ? matchCommands(draft.slice(1), paletteCommands(skills))
    : [];
  const skillTurn = skillDraft(draft, skills);
  const active = Math.min(activeIndex, Math.max(commands.length - 1, 0));
  const paletteOpen = slashOpen && picked === null;
  const connectOpen = slashOpen && picked?.name === "connect";
  const ready = !busy && draft.trim() !== "" && chosen.length > 0;

  const submit = () => {
    if (!ready) return;
    onSubmit(
      skillTurn?.prompt ?? draft,
      chosen.map((model) => ({ id: model.id, name: model.name })),
      skillTurn?.skill.name ?? null,
    );
    setDraft("");
  };

  /** A skill goes into the prompt to be sent; a built-in opens its own menu. */
  const pick = (command: Command | null) => {
    if (command?.kind === "skill") {
      setDraft(`/${command.name} `);
      setPicked(null);
      setActiveIndex(0);
      return;
    }
    setPicked(command);
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (paletteOpen) {
      const action = paletteKey(event.key, active, commands.length);
      if (action === null) return;
      event.preventDefault();
      if (action === "close") setSlashDismissed(true);
      else if (action === "pick") pick(commands[active] ?? null);
      else if (action === "unknown") setNotice(unknownCommandHint(draft));
      else setActiveIndex(action.index);
      return;
    }
    if (slashOpen && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault();
      if (event.key === "Escape") setSlashDismissed(true);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="bg-background/90 sticky bottom-0 z-10 px-4 pt-2 pb-3 backdrop-blur sm:px-6">
      {suggestions ? (
        <SuggestionChips
          suggestions={suggestions}
          onPick={(question) => {
            setDraft(question.prompt);
            setSlashDismissed(false);
            setPicked(null);
            promptRef.current?.focus();
          }}
        />
      ) : null}
      <form onSubmit={onFormSubmit} className="surface relative mx-auto max-w-5xl">
        {paletteOpen ? (
          <CommandPalette
            commands={commands}
            activeIndex={active}
            onPick={pick}
            notice={notice}
          />
        ) : null}
        <WearableSlashMenu
          open={connectOpen}
          oura={wearables.oura}
          whoop={wearables.whoop}
          googleHealth={wearables.googleHealth}
          onClose={() => {
            setSlashDismissed(true);
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
            setSlashDismissed(false);
            setPicked(null);
            setActiveIndex(0);
            setNotice(undefined);
          }}
          onKeyDown={onKeyDown}
          aria-activedescendant={
            paletteOpen && commands[active]
              ? commandOptionId(commands[active].name)
              : undefined
          }
          placeholder="Ask TwinLLM…  /  for commands"
          className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none disabled:opacity-60"
        />
        <div className="flex items-end gap-3 px-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {catalog ? (
              <>
                <WearableChips
                  oura={wearables.oura}
                  whoop={wearables.whoop}
                  googleHealth={wearables.googleHealth}
                  onDisconnectOura={disconnect("/api/oura/disconnect", wearables.refresh)}
                  onDisconnectWhoop={disconnect(
                    "/api/whoop/disconnect",
                    wearables.refresh,
                  )}
                  onDisconnectGoogleHealth={disconnect(
                    "/api/google-health/disconnect",
                    wearables.refresh,
                  )}
                />
                {chosen.map((model) => (
                  <span
                    key={model.id}
                    className="border-border text-muted-foreground inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs"
                  >
                    <span className="truncate">{model.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${model.name}`}
                      title={chosen.length === 1 ? "One model has to stay" : undefined}
                      disabled={chosen.length === 1}
                      onClick={() =>
                        setModelIds(toggleModel(catalog, modelIds, model.id))
                      }
                      className="hover:text-foreground hover:bg-muted rounded-full p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Mark name="remove" className="size-3" />
                    </button>
                  </span>
                ))}
                <ModelMenu
                  catalog={catalog}
                  selectedIds={modelIds}
                  onToggle={(id) => setModelIds(toggleModel(catalog, modelIds, id))}
                />
              </>
            ) : (
              <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                The model list didn&rsquo;t load, so there is nowhere to send a prompt
                yet.
                <Button variant="pill" size="sm" onClick={() => router.refresh()}>
                  Try again
                </Button>
              </p>
            )}
          </div>
          <AppAuth>
            {({ isSignedIn }) =>
              isSignedIn || isClientAuthDisabled() ? (
                <Button
                  type="submit"
                  variant="primary"
                  aria-label="Send prompt"
                  disabled={!ready}
                  className="size-9 shrink-0 p-0"
                >
                  <Mark name="send" />
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
        {skillTurn
          ? `Sends with /${skillTurn.skill.name}, which ${readsLine(skillTurn.skill.reads)}.`
          : hintFor(missingCount(catalog, initialModelIds), chosen.length)}
      </p>
    </div>
  );
};
