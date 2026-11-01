"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { LLM_PROVIDERS, type LlmProvider } from "@/infrastructure/data-mode-policy";
import { KNOWLEDGE_SOURCE_GROUPS } from "@/infrastructure/knowledge-sources";
import { skillSourceLabel, WEARABLE_CONTEXT_SOURCE } from "@/infrastructure/skill-gate";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";

import { saveSkill, type SkillFormState } from "./skill-actions";
import { SKILL_VIEW_KINDS } from "./skill-schema";
import { USER_SKILL_INSTRUCTIONS_MAX, type UserSkillRow } from "./user-skill";

/**
 * The skill builder (#174). Each choice says what it allows, and the card on
 * the right shows the skill as the `/` palette will: what it reads, which
 * tools it may call, where it runs. Ticking a tool ticks its source, since a
 * tool never runs without it; the server checks every rule again on save.
 */

const PROVIDER_LABELS: Readonly<Record<LlmProvider, string>> = {
  ollama: "Local models (Ollama on this machine)",
  exoscale: "Exoscale (Switzerland)",
  openrouter: "OpenRouter (synthetic data only)",
  infomaniak: "Infomaniak (synthetic data only)",
  "remote-gpu": "Remote GPU (synthetic data only)",
};

const VIEW_LABELS: Readonly<Record<string, string>> = {
  "chart.timeseries": "Time-series chart",
  "chart.compare": "Comparison chart",
  "biomarker.card": "Biomarker card",
  "twin.body": "Body twin",
  "map.choropleth": "Map",
  table: "Table",
};

const SOURCES = [
  ...KNOWLEDGE_SOURCE_GROUPS.flatMap((group) => group.sources),
  {
    id: WEARABLE_CONTEXT_SOURCE,
    label: skillSourceLabel(WEARABLE_CONTEXT_SOURCE),
    description: "The wearable summaries attached to the turn; personal data.",
    tools: [] as readonly string[],
  },
];

const EMPTY: UserSkillRow = {
  id: "",
  name: "",
  description: "",
  instructions: "",
  tools: [],
  sources: [],
  providers: ["ollama"],
  views: [],
};

const toggle = (list: readonly string[], value: string, on: boolean): string[] =>
  on ? [...new Set([...list, value])] : list.filter((item) => item !== value);

const ErrorLine = ({ message }: Readonly<{ message?: string }>) =>
  message ? (
    <p role="alert" className="text-destructive mt-1 text-xs">
      {message}
    </p>
  ) : null;

export const SkillForm = ({ skill = EMPTY }: Readonly<{ skill?: UserSkillRow }>) => {
  const [state, action, pending] = useActionState<SkillFormState, FormData>(saveSkill, {
    errors: {},
  });
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [sources, setSources] = useState<readonly string[]>(skill.sources);
  const [tools, setTools] = useState<readonly string[]>(skill.tools);
  const [providers, setProviders] = useState<readonly string[]>(skill.providers);
  const [instructions, setInstructions] = useState(skill.instructions);
  const errors = state.errors;

  const toolSource = useMemo(
    () =>
      new Map(SOURCES.flatMap((source) => source.tools.map((tool) => [tool, source.id]))),
    [],
  );

  const setTool = (tool: string, on: boolean) => {
    setTools((list) => toggle(list, tool, on));
    const owner = toolSource.get(tool);
    if (on && owner !== undefined) setSources((list) => toggle(list, owner, true));
  };
  const setSource = (id: string, on: boolean) => {
    setSources((list) => toggle(list, id, on));
    if (!on) setTools((list) => list.filter((tool) => toolSource.get(tool) !== id));
  };

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <input type="hidden" name="id" value={skill.id} />
        <Field
          label="Name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Lower-case letters, digits and dashes. You will type it as /name."
          error={errors.name}
          required
          maxLength={40}
          autoComplete="off"
        />
        <Field
          label="What it does"
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          hint="One sentence; the palette shows it."
          error={errors.description}
          required
          maxLength={200}
        />
        <div>
          <label htmlFor="skill-instructions" className="text-sm">
            Instructions
          </label>
          <p id="skill-instructions-hint" className="text-muted-foreground text-xs">
            What the model should do when someone runs it. Plain language; it is added to
            the system prompt for that turn.
          </p>
          <textarea
            id="skill-instructions"
            name="instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={8}
            maxLength={USER_SKILL_INSTRUCTIONS_MAX}
            aria-describedby="skill-instructions-hint"
            aria-invalid={errors.instructions ? true : undefined}
            className="border-input bg-background mt-2 w-full rounded-md border px-2 py-1.5 text-sm"
            required
          />
          <ErrorLine message={errors.instructions} />
        </div>

        <fieldset>
          <legend className="text-sm">
            What it may read, and which tools it may call
          </legend>
          <ErrorLine message={errors.sources ?? errors.tools} />
          <div className="mt-3 flex flex-col gap-3">
            {SOURCES.map((source) => (
              <div key={source.id} className="surface p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="sources"
                    value={source.id}
                    checked={sources.includes(source.id)}
                    onChange={(event) => setSource(source.id, event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {source.label}
                    <span className="text-muted-foreground block text-xs">
                      {source.description}
                    </span>
                  </span>
                </label>
                {source.tools.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-6">
                    {source.tools.map((tool) => (
                      <label
                        key={tool}
                        className="flex items-center gap-1.5 font-mono text-xs"
                      >
                        <input
                          type="checkbox"
                          name="tools"
                          value={tool}
                          checked={tools.includes(tool)}
                          onChange={(event) => setTool(tool, event.target.checked)}
                        />
                        {tool}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm">Views it may draw</legend>
          <ErrorLine message={errors.views} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {SKILL_VIEW_KINDS.map((view) => (
              <label key={view} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="views"
                  value={view}
                  defaultChecked={skill.views.includes(view)}
                />
                {VIEW_LABELS[view] ?? view}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm">Where its model may run</legend>
          <p className="text-muted-foreground text-xs">
            Local models by default. A skill can only narrow what the data-mode policy
            allows; genome tools and your wearables never go to a hosted model.
          </p>
          <ErrorLine message={errors.providers} />
          <div className="mt-2 flex flex-col gap-1">
            {LLM_PROVIDERS.map((provider) => (
              <label key={provider} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="providers"
                  value={provider}
                  checked={providers.includes(provider)}
                  onChange={(event) =>
                    setProviders((list) => toggle(list, provider, event.target.checked))
                  }
                />
                {PROVIDER_LABELS[provider]}
              </label>
            ))}
          </div>
        </fieldset>

        <ErrorLine message={errors.form} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : skill.id === "" ? "Create skill" : "Save changes"}
          </Button>
          <Link href="/customize" className="text-muted-foreground text-sm underline">
            Cancel
          </Link>
        </div>
      </div>

      <aside
        aria-label="How the palette will show it"
        className="lg:sticky lg:top-6 lg:self-start"
      >
        <p className="text-eyebrow">Preview</p>
        <div className="surface mt-2 flex flex-col gap-2 p-4 text-sm">
          <span className="font-mono">/{name.trim() || "name"}</span>
          <span className="text-muted-foreground">
            {description.trim() || "What it does"}
          </span>
          <span className="text-muted-foreground text-xs">
            Reads: {sources.map(skillSourceLabel).join(", ") || "nothing yet"}
          </span>
          <span className="text-muted-foreground text-xs">
            May call: <span className="font-mono">{tools.join(", ") || "no tools"}</span>
          </span>
          <span className="text-muted-foreground text-xs">
            {providers.length === 1 && providers[0] === "ollama"
              ? "Runs on local models only"
              : `Runs on: ${providers.join(", ") || "local models"}`}
          </span>
          <span className="text-muted-foreground text-xs">Yours · not evaluated</span>
        </div>
      </aside>
    </form>
  );
};
