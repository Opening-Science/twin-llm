"use client";

import { useCallback, useEffect, useReducer, useState } from "react";

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

/** Anatomy UI state plus which atlases are installed (fetched once, skipped in previews). */
export const useAnatomyView = (enabled: boolean) => {
  const [state, dispatch] = useReducer(anatomyReducer, initialAnatomyState);
  const [installed, setInstalled] = useState<Record<AtlasId, boolean> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch("/api/anatomy/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled) return;
        const status = parseAnatomyStatus(value);
        setInstalled(status);
        // A missing atlas should not leave the slider stuck when another one is here.
        dispatch({ type: "installed", installed: status });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const onLoad = useCallback((load: AnatomyLoad) => dispatch({ type: "load", load }), []);

  return { state, dispatch, installed, onLoad };
};
