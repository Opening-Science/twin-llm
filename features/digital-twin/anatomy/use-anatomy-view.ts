"use client";

import { useCallback, useEffect, useReducer, useState } from "react";

import {
  DEMO_BODY_IDS,
  isDemoBodyId,
  type DemoBodyId,
} from "@/packages/anatomy/demo-bodies";
import { ATLAS_IDS, isAtlasId, type AtlasId } from "@/packages/anatomy/manifest";

import { anatomyReducer, initialAnatomyState, type AnatomyLoad } from "./anatomy-state";

type StatusRow = { readonly id?: unknown; readonly installed?: unknown };

export const parseAnatomyStatus = (value: unknown): Record<AtlasId, boolean> | null => {
  if (!value || typeof value !== "object") return null;
  const rows: unknown = (value as { atlases?: unknown }).atlases;
  if (!Array.isArray(rows)) return null;
  const installed = Object.fromEntries(ATLAS_IDS.map((id) => [id, false])) as Record<
    AtlasId,
    boolean
  >;
  for (const row of rows as readonly unknown[]) {
    if (!row || typeof row !== "object") continue;
    const { id, installed: present } = row as StatusRow;
    if (isAtlasId(id) && present === true) installed[id] = true;
  }
  return installed;
};

/** Which demo bodies have a baked rigged variant; all false for an older or odd body. */
export const parseRiggedStatus = (value: unknown): Record<DemoBodyId, boolean> => {
  const rigged = Object.fromEntries(DEMO_BODY_IDS.map((id) => [id, false])) as Record<
    DemoBodyId,
    boolean
  >;
  const rows: unknown =
    value && typeof value === "object"
      ? (value as { riggedBodies?: unknown }).riggedBodies
      : null;
  if (!Array.isArray(rows)) return rigged;
  for (const row of rows as readonly unknown[]) {
    if (!row || typeof row !== "object") continue;
    const { id, installed: present } = row as StatusRow;
    if (isDemoBodyId(id) && present === true) rigged[id] = true;
  }
  return rigged;
};

/**
 * Anatomy UI state plus which atlases and rigged demo bodies are installed
 * (fetched once, skipped in previews). `rigged` stays null until the status
 * answers, so the demo body is not loaded twice; a failed status counts as none.
 */
export const useAnatomyView = (enabled: boolean) => {
  const [state, dispatch] = useReducer(anatomyReducer, initialAnatomyState);
  const [rigged, setRigged] = useState<Record<DemoBodyId, boolean> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch("/api/anatomy/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled) return;
        setRigged(parseRiggedStatus(value));
        // A missing atlas should not leave the slider stuck when another one is
        // here; the reducer keeps the status, so a later body sex can use it.
        dispatch({ type: "installed", installed: parseAnatomyStatus(value) });
      })
      .catch(() => {
        if (!cancelled) setRigged(parseRiggedStatus(null));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const onLoad = useCallback((load: AnatomyLoad) => dispatch({ type: "load", load }), []);

  return { state, dispatch, installed: state.installed, rigged, onLoad };
};
