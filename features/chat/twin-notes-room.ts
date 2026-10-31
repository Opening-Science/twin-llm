import "server-only";

import { asSchema, type ToolSet } from "ai";

import {
  DEFAULT_OLLAMA_NUM_CTX,
  estimateRequestTokens,
  promptBudgetTokens,
} from "@/infrastructure/ollama-context";
import {
  type NotesBlock,
  type TwinNote,
  twinNotesBlock,
} from "@/infrastructure/twin-notes";

import {
  type TwinTurnDeps,
  type TwinTurnPromptDeps,
  twinTurnSystem,
  type TwinTurnWearables,
} from "./run-twin-turn";

/**
 * How many twin notes (#43) a turn carries: up to `NOTES_PROMPT_BUDGET`
 * characters, fewer when the turn's system prompt and tools leave less room
 * in the prompt budget the prompt-size test holds every turn to (the default
 * Ollama context minus the turn reserve). The room is that budget minus the
 * estimated system prompt and tool list without notes, minus a safety margin;
 * whole notes only, newest first, none when there is no room.
 */

/** Tokens kept free under the budget, for estimate drift. */
export const NOTES_SAFETY_TOKENS = 150;

/** The tool list as Ollama's template prints it: one JSON object per line. */
export const toolDefinitionsText = async (tools: ToolSet): Promise<string> =>
  (
    await Promise.all(
      Object.entries(tools).map(async ([name, tool]) =>
        JSON.stringify({
          type: "function",
          function: {
            name,
            ...(typeof tool.description === "string"
              ? { description: tool.description }
              : {}),
            parameters: await asSchema(tool.inputSchema).jsonSchema,
          },
        }),
      ),
    )
  ).join("\n");

/** Estimated tokens the notes block may take: never below zero. */
export const notesRoomTokens = (
  usedTokens: number,
  budgetTokens: number = promptBudgetTokens(DEFAULT_OLLAMA_NUM_CTX),
): number => Math.max(0, budgetTokens - NOTES_SAFETY_TOKENS - usedTokens);

/** The notes block that fits this turn's prompt and tools. */
export const fitTwinNotes = async (
  deps: Omit<TwinTurnPromptDeps, "twinNotes"> & Pick<TwinTurnDeps, "tools">,
  wearables: TwinTurnWearables,
  notes: readonly TwinNote[],
): Promise<NotesBlock> => {
  if (notes.length === 0) return { text: "", ids: [] };
  const system = twinTurnSystem({ ...deps, twinNotes: null }, wearables);
  const used = estimateRequestTokens(system, await toolDefinitionsText(deps.tools));
  // The block joins the prompt after a blank line.
  return twinNotesBlock(notes, undefined, notesRoomTokens(used) - 1);
};
