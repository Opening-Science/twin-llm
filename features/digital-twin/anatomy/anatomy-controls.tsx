"use client";

import { useId, type KeyboardEvent } from "react";

import { litPartsHidden } from "@/packages/anatomy/highlight";
import {
  ATLAS_LAYER_IDS,
  DEPTH_MAX,
  DEPTH_MIN,
  DEPTH_STOPS,
} from "@/packages/anatomy/layers";
import { ATLAS_IDS, ATLASES, type AtlasId } from "@/packages/anatomy/manifest";
import {
  leftOutSummary,
  type SkeletonAtlas,
  type SkeletonProblem,
} from "@/packages/anatomy/open-skeleton";

import {
  ANATOMY_CHANGES_NOTE,
  ANATOMY_DONOR_NOTE,
  ANATOMY_FIT_FAILED,
  ANATOMY_FITTED_CHANGES_NOTE,
  ANATOMY_LOAD_ERROR,
  ANATOMY_NOT_IN_ATLAS,
  ANATOMY_NOT_INSTALLED,
  ANATOMY_RETRY,
  anatomyFitNote,
  anatomyLoading,
  anatomyTypicalNote,
  ATLAS_COVERAGE_NOTE,
  ATLAS_OPTION_LABEL,
  depthValueText,
  FIT_ATLAS_TOGGLE,
  HIGHLIGHT_GROUPS,
  HIGHLIGHT_HIDDEN,
  HIGHLIGHT_LABEL,
  HIGHLIGHT_SYSTEMS,
  HIGHLIGHT_SYSTEMS_ONLY,
  LAYER_LABEL,
  SKELETON_CREDIT_FALLBACK,
  SKELETON_EXPLODE,
  SKELETON_FIT_FAILED,
  SKELETON_HEADING,
  SKELETON_ISOLATE,
  SKELETON_PROBLEM_TEXT,
  SKELETON_LOAD_ERROR,
  SKELETON_LOADING,
  SKELETON_MODELLED_NOTE,
  skeletonExplodeText,
  skeletonFitNote,
  skeletonLeftOutNote,
  skeletonSourceLabel,
  SYSTEM_LABEL,
  type AnatomyEnvelope,
} from "./anatomy-copy";
import {
  skeletonInView,
  type AnatomyAction,
  type AnatomyState,
  type SkeletonLoad,
} from "./anatomy-state";
import { atlasSexNote } from "./atlas-sex";
import { highlightOptions, selectedHighlightValue } from "./highlight-options";

const STEP_UP = new Set(["ArrowRight", "ArrowUp", "PageUp"]);
const IDLE: SkeletonLoad = { kind: "idle" };

/**
 * What the panel says about the CT skeleton, two short sentences at most: how
 * it is placed (and that it is not this body's), then what its build left out
 * or, with nothing left out, that some parts are modelled. The pick card names
 * each modelled part.
 */
export const skeletonLines = (
  skeleton: SkeletonAtlas,
  load: SkeletonLoad,
): readonly string[] => {
  switch (load.kind) {
    case "idle":
      return [];
    case "loading":
      return [SKELETON_LOADING];
    case "error":
      return [SKELETON_LOAD_ERROR];
    case "ready": {
      if (!load.fitOk) return [SKELETON_FIT_FAILED];
      const second =
        skeletonLeftOutNote(leftOutSummary(skeleton.excluded)) ??
        (load.modelled > 0 ? SKELETON_MODELLED_NOTE : null);
      return [skeletonFitNote(load.anchor), ...(second ? [second] : [])];
    }
  }
};

/** The loading line's progress, shown only while bytes arrive; parsing shows none. */
export const loadingPercent = (percent: number | null): number | null =>
  percent !== null && percent < 100 ? Math.round(percent) : null;

export type FittedControl = Readonly<{ available: boolean; shown: boolean }>;

const NOT_FITTED: FittedControl = { available: false, shown: false };
const STEP_DOWN = new Set(["ArrowLeft", "ArrowDown", "PageDown"]);

/**
 * Depth slider, stop buttons, layer and organ-system toggles, atlas picker and
 * credits. Presentational only: state and dispatch come from the viewer, which
 * keeps this testable as plain markup.
 */
export const AnatomyControls = ({
  state,
  installed,
  dispatch,
  onInteract,
  envelope = "scan",
  posed = false,
  fitted = NOT_FITTED,
  skeleton = null,
  skeletonProblem = null,
  skeletonLoad = IDLE,
}: Readonly<{
  state: AnatomyState;
  /** null until /api/anatomy/status answers (or if it cannot be reached). */
  installed: Readonly<Record<AtlasId, boolean>> | null;
  dispatch: (action: AnatomyAction) => void;
  onInteract: () => void;
  /** The demo body changes the fit and shape notes; real scans keep theirs. */
  envelope?: AnatomyEnvelope;
  /** The demo body is posed to the atlas's stance: only a rigged body is. */
  posed?: boolean;
  /**
   * "Fit atlas to body": offered only where the Blender-fitted atlas for this
   * body and atlas is made here (`fitted-option.ts`); hidden otherwise.
   */
  fitted?: FittedControl;
  /** The open-anatomy skeleton the server has; null: the layer is absent. */
  skeleton?: SkeletonAtlas | null;
  /** Why a configured skeleton is not shown (it fails closed); null otherwise. */
  skeletonProblem?: SkeletonProblem | null;
  skeletonLoad?: SkeletonLoad;
}>) => {
  const sliderId = useId();
  const listId = useId();
  const pickerId = useId();
  const highlightId = useId();
  const notInstalled = installed !== null && !installed[state.atlasId];
  const { load } = state;
  const ready = load.kind === "ready" ? load : null;
  const entry = ATLASES[state.atlasId];
  const coverage = ATLAS_COVERAGE_NOTE[state.atlasId];
  const sexNote = atlasSexNote(state.bodySex, state.atlasId, installed);
  const options = highlightOptions(ready, state);
  const fromOptions = options.filter((option) => option.section === "from");
  const systemOptions = options.filter((option) => option.section === "systems");
  const groupOptions = options.filter((option) => option.section === "groups");
  const highlightNotes = [
    ready && groupOptions.length === 0 ? HIGHLIGHT_SYSTEMS_ONLY : null,
    ready &&
    litPartsHidden(state.highlight, ready.parts, state.layers, state.hiddenSystems)
      ? HIGHLIGHT_HIDDEN
      : null,
  ].filter((note) => note !== null);
  // The CT skeleton is the Skeleton layer when it is on; the atlas has none then.
  const ct = skeleton !== null && state.ctSkeleton ? skeleton : null;
  const ctReady = ct && skeletonLoad.kind === "ready" ? skeletonLoad : null;
  const absentLayers = ready
    ? ATLAS_LAYER_IDS.filter(
        (layer) =>
          !ready.presentLayers.includes(layer) && !(layer === "skeleton" && ctReady),
      )
    : [];
  const skeletonNotes = ct && state.requested ? skeletonLines(ct, skeletonLoad) : [];
  // A configured skeleton that fails closed says why, once anyone looks inside.
  const problemNote =
    skeleton === null && skeletonProblem !== null && state.requested
      ? SKELETON_PROBLEM_TEXT[skeletonProblem]
      : null;
  // With the CT skeleton in view the donor atlas's notes do not apply to it.
  const ctView = skeletonInView(state, skeleton, skeletonLoad);
  const percent = load.kind === "loading" ? loadingPercent(load.percent) : null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = STEP_UP.has(event.key) ? 1 : STEP_DOWN.has(event.key) ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    dispatch({ type: "step", direction });
    onInteract();
  };

  return (
    <section
      aria-label="Reference anatomy"
      className="border-input rounded-md border p-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={sliderId} className="text-muted-foreground text-xs">
          Depth
        </label>
        <span className="text-xs">{depthValueText(state.targetDepth)}</span>
      </div>
      <input
        id={sliderId}
        type="range"
        min={DEPTH_MIN}
        max={DEPTH_MAX}
        step={0.01}
        value={state.targetDepth}
        list={listId}
        aria-valuetext={depthValueText(state.targetDepth)}
        disabled={notInstalled}
        onChange={(event) => {
          dispatch({ type: "depth", depth: Number(event.target.value) });
          onInteract();
        }}
        onPointerUp={() => dispatch({ type: "release" })}
        onKeyDown={onKeyDown}
        className="mt-1 w-full accent-[var(--primary)] disabled:opacity-50"
      />
      <datalist id={listId}>
        {DEPTH_STOPS.map((stop) => (
          <option key={stop.layer} value={stop.depth} label={LAYER_LABEL[stop.layer]} />
        ))}
      </datalist>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {DEPTH_STOPS.map((stop) => (
          <button
            key={stop.layer}
            type="button"
            className="chip"
            aria-pressed={Math.abs(state.targetDepth - stop.depth) < 0.02}
            disabled={notInstalled}
            onClick={() => {
              dispatch({ type: "depth", depth: stop.depth });
              onInteract();
            }}
          >
            {LAYER_LABEL[stop.layer]}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <button
          type="button"
          className="chip"
          aria-pressed={state.isolate === "skeleton"}
          disabled={notInstalled}
          onClick={() => {
            dispatch({
              type: "isolate",
              layer: state.isolate === "skeleton" ? null : "skeleton",
            });
            onInteract();
          }}
        >
          {SKELETON_ISOLATE}
        </button>
        {ctReady && ctReady.fitOk ? (
          <label className="flex min-w-40 flex-1 items-center gap-2">
            <span className="text-muted-foreground shrink-0">{SKELETON_EXPLODE}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.explode}
              aria-label={SKELETON_EXPLODE}
              aria-valuetext={skeletonExplodeText(state.explode)}
              onChange={(event) => {
                dispatch({ type: "explode", amount: Number(event.target.value) });
                onInteract();
              }}
              className="w-full accent-[var(--primary)]"
            />
          </label>
        ) : null}
      </div>

      {fitted.available ? (
        <label className="mt-2 flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={state.fitAtlas}
            disabled={notInstalled}
            onChange={(event) => dispatch({ type: "fitAtlas", on: event.target.checked })}
          />
          {FIT_ATLAS_TOGGLE}
        </label>
      ) : null}

      <div aria-live="polite" className="text-muted-foreground mt-2 space-y-1 text-xs">
        {notInstalled ? <p>{ANATOMY_NOT_INSTALLED}</p> : null}
        {sexNote && !ctView ? <p className="text-foreground">{sexNote}</p> : null}
        {load.kind === "loading" && !ctView ? (
          <p>
            {anatomyLoading(null)}
            {/* Visual progress only: a changing number in a live region is announced every step. */}
            {percent !== null ? <span aria-hidden="true"> {percent}%</span> : null}
          </p>
        ) : null}
        {load.kind === "error" ? (
          <p>
            {ANATOMY_LOAD_ERROR}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => dispatch({ type: "retry" })}
            >
              {ANATOMY_RETRY}
            </button>
          </p>
        ) : null}
        {ctView ? null : (
          <>
            {ready && !ready.fitOk ? <p>{ANATOMY_FIT_FAILED}</p> : null}
            {ready && ready.fitOk ? (
              <p>{anatomyFitNote(ready.anchor, envelope, posed)}</p>
            ) : null}
            {state.requested ? <p>{anatomyTypicalNote(envelope)}</p> : null}
            {state.requested && coverage ? <p>{coverage}</p> : null}
            {absentLayers.map((layer) => (
              <p key={layer}>
                {LAYER_LABEL[layer]}: {ANATOMY_NOT_IN_ATLAS}
              </p>
            ))}
          </>
        )}
        {skeletonNotes.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {problemNote ? <p>{problemNote}</p> : null}
      </div>

      <details className="mt-3">
        <summary className="text-muted-foreground cursor-pointer text-xs">
          Layers and organ systems
        </summary>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {ATLAS_LAYER_IDS.map((layer) => (
            <label key={layer} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={state.layers[layer]}
                disabled={notInstalled}
                onChange={() => dispatch({ type: "toggleLayer", layer })}
              />
              {LAYER_LABEL[layer]}
            </label>
          ))}
        </div>
        {skeleton ? (
          <fieldset className="mt-3 text-xs">
            <legend className="text-muted-foreground">{SKELETON_HEADING}</legend>
            <label className="mt-1 flex items-center gap-1">
              <input
                type="checkbox"
                checked={state.ctSkeleton}
                disabled={notInstalled}
                onChange={(event) =>
                  dispatch({ type: "ctSkeleton", on: event.target.checked })
                }
              />
              {skeletonSourceLabel(skeleton.caseId)}
            </label>
          </fieldset>
        ) : null}
        {ready && ready.systems.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap gap-1"
            role="group"
            aria-label="Organ systems"
          >
            {ready.systems.map((system) => (
              <button
                key={system}
                type="button"
                className="chip"
                aria-pressed={!state.hiddenSystems.includes(system)}
                onClick={() => dispatch({ type: "toggleSystem", system })}
              >
                {SYSTEM_LABEL[system]}
              </button>
            ))}
          </div>
        ) : null}
        {ready ? (
          <>
            <label
              htmlFor={highlightId}
              className="text-muted-foreground mt-3 block text-xs"
            >
              {HIGHLIGHT_LABEL}
            </label>
            <select
              id={highlightId}
              value={selectedHighlightValue(state)}
              onChange={(event) => {
                const option = options.find((item) => item.value === event.target.value);
                // The row's own option is the current highlight already.
                if (option && option.section !== "from") {
                  dispatch({ type: "highlight", highlight: option.highlight });
                }
              }}
              className="border-input text-foreground mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value={options[0].value}>{options[0].label}</option>
              {fromOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <optgroup label={HIGHLIGHT_SYSTEMS}>
                {systemOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
              {groupOptions.length > 0 ? (
                <optgroup label={HIGHLIGHT_GROUPS}>
                  {groupOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {highlightNotes.length > 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {highlightNotes.join(" ")}
              </p>
            ) : null}
          </>
        ) : null}
        <label htmlFor={pickerId} className="text-muted-foreground mt-3 block text-xs">
          Reference atlas
        </label>
        <select
          id={pickerId}
          value={state.atlasId}
          onChange={(event) => {
            const next = ATLAS_IDS.find((id) => id === event.target.value);
            if (next) dispatch({ type: "atlas", atlasId: next });
          }}
          className="border-input text-foreground mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        >
          {ATLAS_IDS.map((id) => (
            <option key={id} value={id} disabled={installed !== null && !installed[id]}>
              {ATLAS_OPTION_LABEL[id]}
              {installed !== null && !installed[id] ? " (not installed)" : ""}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground mt-1 text-xs">{ANATOMY_DONOR_NOTE}</p>
      </details>

      {ctReady ? (
        <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
          {ct?.attribution ?? SKELETON_CREDIT_FALLBACK}{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            CC BY 4.0
          </a>
        </p>
      ) : null}
      {state.requested && !(ctReady && state.isolate === "skeleton") ? (
        <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
          {entry.attribution}{" "}
          {fitted.shown ? ANATOMY_FITTED_CHANGES_NOTE : ANATOMY_CHANGES_NOTE}{" "}
          <a
            href={entry.licenceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            CC BY 4.0
          </a>
        </p>
      ) : null}
    </section>
  );
};
