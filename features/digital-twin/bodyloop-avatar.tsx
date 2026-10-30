"use client";

import { Canvas } from "@react-three/fiber";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ACESFilmicToneMapping, type Group, PerspectiveCamera } from "three";
import { type OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { VitronicPropertyRow } from "@/features/vitronic/vitronic-status-view";
import {
  LABEL_HINT,
  VITRONIC_SUBJECT_SOURCE_SCANNER,
} from "@/features/vitronic/subject-schema";
import {
  ANNY_CODE_LICENCE_URL,
  ANNY_PAPER_URL,
  ANNY_SHAPE_LICENCE_URL,
  DEMO_BODIES,
  demoBodyApiUrl,
  demoBodyIdFor,
} from "@/packages/anatomy/demo-bodies";
import { type Highlight } from "@/packages/anatomy/highlight";
import { ATLASES, type AtlasScheme } from "@/packages/anatomy/manifest";
import { RIGGED_ATTRIBUTION, riggedBodyApiUrl } from "@/packages/anatomy/rigged-bodies";
import { Button } from "@/infrastructure/ui-kit/button";
import {
  CollapsiblePanel,
  usePanelOpen,
} from "@/infrastructure/ui-kit/collapsible-panel";
import { Field } from "@/infrastructure/ui-kit/field";
import { Legend } from "@/infrastructure/ui-kit/legend";
import { AnatomyControls } from "./anatomy/anatomy-controls";
import { AnatomyLayers } from "./anatomy/anatomy-layers";
import { highlightValue } from "./anatomy/highlight-options";
import { BodyPanel, type PanelTab } from "./body-panel";
import { useBiomarkerTab } from "./biomarkers/use-biomarker-tab";
import {
  DEMO_BODY_NOTE,
  DEMO_BODY_PICKER,
  DEMO_LOAD_ERROR,
  DEMO_SEX_LABEL,
  type DemoSex,
} from "./anatomy/demo-copy";
import { useAnatomyView } from "./anatomy/use-anatomy-view";
import { BodyMotion } from "./motion/body-motion";
import { motionLines } from "./motion/motion-copy";
import { useBodyMotion } from "./motion/use-body-motion";
import {
  EnvironmentBar,
  EnvironmentPanel,
  ResearchLine,
} from "./environment/environment-bar";
import { createAnchorStore } from "./environment/card-anchor";
import {
  ENVIRONMENT_LABEL,
  PANEL_TEXT,
  pickedLabel,
  VIEW_LABEL,
} from "./environment/environment-copy";
import { PickCard, ProjectAnchor } from "./environment/pick-card";
import { IDLE_STATUS, type LiveStatus } from "./live/live-conditioning";
import { LiveLines } from "./live/live-lines";
import { heartRhythmOf } from "./live/heart-rhythm";
import { NIGHT_NEEDS_READINGS } from "./live/live-copy";
import { NightPlayback, useNightPlayback } from "./live/night-playback";
import { nightPlaybackFor } from "./live/night-series";
import {
  linkedRows,
  pickHighlight,
  pickHighlights,
  pickVisible,
  type Picked,
} from "./environment/pick-part";
import { INLINE_LIGHT, lookFor } from "./environment/environment-look";
import { useEnvironment, useLocalHour } from "./environment/use-environment";
import { WALK_SURFACE_ATTR } from "./environment/walk-controls";
import { type BodySex } from "./anatomy/atlas-sex";
import {
  DEMO_SUBJECT_ID,
  defaultSubjectId,
  demoBodySex,
  isDemoSubject,
  subjectOptions,
  type DemoSexPick,
} from "./demo-subject";
import { mergeScanRows, orderScans, pickDefaultScan } from "./scan-default";
import { initialAutoRotate } from "./scan-materials";
import {
  DEFAULT_OVERLAYS,
  OVERLAY_OPTIONS,
  overlayLegendItems,
  parseSnapshotGeometry,
  visibleMarkers,
  visibleMeasures,
  type OverlayToggles,
} from "./scan-overlays";
import { type TwinContext } from "./page-sections";
import { initialPanel, panelReducer } from "./panel-state";
import { ViewToolbar } from "./view-toolbar";
import { useWheelGate, WHEEL_ZOOM_HINT } from "./wheel-zoom";

import {
  BODY_TWIN_LOADING,
  BODYLOOP_NO_SCANS,
  BODYLOOP_NO_MESH,
  SCAN_SYNC,
  SCAN_SYNC_AGAIN,
  SCAN_RESYNC,
  SCAN_SET_DEFAULT,
  SCAN_CLEAR_DEFAULT,
  SCAN_DEFAULT_FAILED,
  BODY_VIEW_LOST,
  BODY_VIEW_RELOAD,
  DEMO_NEEDS_WEBGL,
  SCAN_NEEDS_WEBGL,
  TOOLBAR_PANEL,
  OVERLAYS_PANEL,
  PANEL_IDS,
} from "./body-twin-copy";
import {
  type BodyTwinSubject,
  type BodyTwinScan,
  type BodyTwinSnapshot,
  type BodyTwinPreview,
} from "./body-twin-types";
import {
  AUTO_ROTATE_IDLE_MS,
  ZOOM_STEP,
  ScanEnvironment,
  BodyScan,
  useWebglAvailable,
  ContextLossWatcher,
} from "./scan-scene";
import {
  scanLabel,
  isSubjectsPayload,
  isScansPayload,
  isSnapshotsPayload,
} from "./body-twin-payloads";
export {
  BODY_TWIN_LOADING,
  BODYLOOP_NO_SCANS,
  BODYLOOP_NO_MESH,
  SCAN_SYNC,
  SCAN_SYNC_AGAIN,
  SCAN_RESYNC,
  SCAN_SET_DEFAULT,
  SCAN_CLEAR_DEFAULT,
  SCAN_DEFAULT_TAG,
  SCAN_DEFAULT_FAILED,
  BODY_VIEW_LOST,
  BODY_VIEW_RELOAD,
  DEMO_NEEDS_WEBGL,
  SCAN_NEEDS_WEBGL,
  TOOLBAR_PANEL,
  OVERLAYS_PANEL,
  PANEL_IDS,
} from "./body-twin-copy";
export {
  type BodyTwinSubject,
  type BodyTwinScan,
  type BodyTwinSnapshot,
  type BodyTwinPreview,
} from "./body-twin-types";
export {
  HIDDEN_NODE_NAMES,
  hideOverlayNodes,
  fitCameraToBox,
  AUTO_ROTATE_SPEED,
  AUTO_ROTATE_IDLE_MS,
  MIN_ZOOM_DISTANCE,
  MAX_ZOOM_DISTANCE,
  ZOOM_STEP,
} from "./scan-scene";

const DEMO_SEXES: readonly DemoSex[] = ["male", "female"];
const NO_MARKERS: ReturnType<typeof visibleMarkers> = [];
const NO_MEASURES: ReturnType<typeof visibleMeasures> = [];
const DEMO_PANEL_TABS: readonly PanelTab[] = ["biomarkers"];

/** Measured stature in metres from a snapshot's `body.height`, or null. */
export const snapshotStature = (
  properties: readonly VitronicPropertyRow[],
): number | null => {
  const row = properties.find((item) => item.path === "body.height" && item.unit === "m");
  return row && Number.isFinite(row.value) && row.value > 0 ? row.value : null;
};

/** The demo load error belongs to one URL; a later success or another body clears it. */
export const demoErrorShown = (failedUrl: string | null, url: string): boolean =>
  failedUrl === url;

/** Highlights set by a pick; a body or empty pick clears only these. */
const PICK_PREFIX = "pick:";

type BodyLoopAvatarProps = {
  readonly preview?: BodyTwinPreview;
  readonly forceFallback?: boolean;
  /** Tells the page which subject is shown and what it has, for its Sources section. */
  readonly onContext?: (context: TwinContext) => void;
  /** The subject to start on instead of the default (the chat's `/twin` card passes the demo). */
  readonly initialSubjectId?: string;
  /** The Demo's synthetic person to start on instead of the first one. */
  readonly initialPersonRef?: string;
  /** A chat `twin.body` view: what to light, and the depth to start at. Read once. */
  readonly initialFocus?: InitialFocus;
  /** A tap on the body, as the HRA group and system it names; null when cleared. */
  readonly onPickPart?: (part: PickedPart | null) => void;
};

export type InitialFocus = Readonly<{
  id: string;
  label: string;
  highlights: Readonly<Record<AtlasScheme, Highlight>>;
  depth: number;
}>;

export type PickedPart = Readonly<{ group: string | null; system: string | null }>;

/** BodyLoop helper geometry that must not show inside the (glass) scan. */
export const BodyLoopAvatar = ({
  preview,
  forceFallback = false,
  onContext,
  initialSubjectId,
  initialPersonRef,
  initialFocus,
  onPickPart,
}: BodyLoopAvatarProps) => {
  const [subjects, setSubjects] = useState<readonly BodyTwinSubject[]>(
    preview?.subjects ?? [],
  );
  const [scans, setScans] = useState<readonly BodyTwinScan[]>(preview?.scans ?? []);
  const [snapshots, setSnapshots] = useState<readonly BodyTwinSnapshot[]>(
    preview?.snapshots ?? [],
  );
  const [chosenSubjectId, setSubjectId] = useState(
    preview?.selectedSubjectId ?? initialSubjectId ?? "",
  );
  // Previews know their subjects up front; live, the list (or its failure) decides.
  const [subjectsReady, setSubjectsReady] = useState(preview !== undefined);
  const [demoSexPick, setDemoSexPick] = useState<DemoSexPick | null>(null);
  const [demoFailedUrl, setDemoFailedUrl] = useState<string | null>(null);
  const subjectId = chosenSubjectId || (subjectsReady ? defaultSubjectId(subjects) : "");
  const isDemo = isDemoSubject(subjectId);
  const [viatarId, setViatarId] = useState(
    preview?.selectedViatarId !== undefined ? String(preview.selectedViatarId) : "",
  );
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [overlays, setOverlays] = useState<OverlayToggles>(DEFAULT_OVERLAYS);
  const [wantRotate, setWantRotate] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [panel, onPanel] = useReducer(panelReducer, initialPanel);
  const onHover = useCallback((id: string | null) => onPanel({ type: "hover", id }), []);
  const [labelScreen, setLabelScreen] = useState<
    readonly { id: string; text: string; x: number; y: number }[]
  >([]);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultError, setDefaultError] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Live vitals: on in the environment, off inline until asked (battery on an
  // 8 GB Air), never with reduced motion.
  const [liveInline, setLiveInline] = useState(false);
  const [liveInEnvironment, setLiveInEnvironment] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(IDLE_STATUS);
  const [scanScene, setScanScene] = useState<Group | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [glLost, setGlLost] = useState(false);
  const onGlLost = useCallback(() => setGlLost(true), []);
  const onGlFresh = useCallback(() => setGlLost(false), []);
  const idleRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const camera = useMemo(() => new PerspectiveCamera(40, 1, 0.01, 40), []);
  const anatomy = useAnatomyView(preview === undefined);
  const motion = useBodyMotion(scanScene, reducedMotion, isDemo ? "demo" : "scan");
  const onControls = useCallback((controls: OrbitControls | null) => {
    controlsRef.current = controls;
  }, []);
  const getControls = useCallback(() => controlsRef.current, []);
  const onDemoError = useCallback((url: string) => setDemoFailedUrl(url), []);
  const onDemoReady = useCallback(
    (url: string) => setDemoFailedUrl((failed) => (failed === url ? null : failed)),
    [],
  );
  const { resolvedTheme } = useTheme();
  // Dark is this design's home; before next-themes resolves, assume it.
  const dark = resolvedTheme !== "light";
  const environment = useEnvironment();
  const { preset, followTime } = environment.state;
  const hour = useLocalHour(environment.active && preset === "outdoors" && followTime);
  const look = useMemo(
    () => (environment.active ? lookFor(preset, dark, followTime ? hour : null) : null),
    [environment.active, preset, dark, followTime, hour],
  );
  const light = look?.light ?? INLINE_LIGHT;
  const zoom = (direction: "in" | "out") => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (direction === "in") controls.dollyIn(ZOOM_STEP);
    else controls.dollyOut(ZOOM_STEP);
    onUserRotate();
  };

  useEffect(() => {
    if (preview !== undefined) return;
    let cancelled = false;
    void fetch("/api/vitronic/subjects")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled) return;
        // No BodyLoop connection or no subjects: the demo subject still works.
        const rows = isSubjectsPayload(value) ? (value.subjects ?? []) : [];
        setSubjects(rows);
        setSubjectId(defaultSubjectId(rows));
        setSubjectsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSubjectId(DEMO_SUBJECT_ID);
        setSubjectsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  useEffect(() => {
    if (preview !== undefined || !subjectId || isDemoSubject(subjectId)) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/vitronic/subjects/${subjectId}/scans`).then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch(`/api/vitronic/subjects/${subjectId}/snapshots`).then((response) =>
        response.ok ? response.json() : null,
      ),
    ])
      .then(([scansBody, snapshotsBody]: readonly [unknown, unknown]) => {
        if (cancelled) return;
        const nextScans = isScansPayload(scansBody) ? (scansBody.scans ?? []) : [];
        const nextSnapshots = isSnapshotsPayload(snapshotsBody)
          ? (snapshotsBody.snapshots ?? [])
          : [];
        setScans(nextScans);
        setSnapshots(nextSnapshots);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [preview, subjectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const reduced = media.matches;
      setReducedMotion(reduced);
      setWantRotate(initialAutoRotate(reduced));
      setAutoRotate(initialAutoRotate(reduced));
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const onUserRotate = useCallback(() => {
    setAutoRotate(false);
    if (idleRef.current) window.clearTimeout(idleRef.current);
    if (!wantRotate) return;
    idleRef.current = window.setTimeout(() => {
      setAutoRotate(true);
    }, AUTO_ROTATE_IDLE_MS);
  }, [wantRotate]);

  const selectedSubject = subjects.find((row) => row.id === subjectId);
  const subjectKind: "scanner" | "file" =
    selectedSubject?.source === VITRONIC_SUBJECT_SOURCE_SCANNER ||
    selectedSubject?.isSelf === true
      ? "scanner"
      : "file";

  const listedScans = useMemo(
    () => orderScans(mergeScanRows(scans, snapshots, subjectKind)),
    [scans, snapshots, subjectKind],
  );
  const pinnedViatarId = selectedSubject?.defaultViatarId ?? null;
  const shownViatarId =
    viatarId !== ""
      ? viatarId
      : String(pickDefaultScan(listedScans, pinnedViatarId) ?? "");

  const selectedViatar = Number.parseInt(shownViatarId, 10);
  const selectedScan = listedScans.find((row) => row.viatarId === selectedViatar);
  const snapshot = snapshots.find((row) => row.viatarId === selectedViatar);
  const scanState = selectedScan
    ? selectedScan.incomplete
      ? "incomplete"
      : selectedScan.synced
        ? "complete"
        : "missing"
    : snapshot
      ? "incomplete"
      : "missing";
  const scannerActions =
    preview === undefined &&
    subjectKind === "scanner" &&
    subjectId.length > 0 &&
    shownViatarId.length > 0;
  const isPinned = selectedScan !== undefined && selectedScan.viatarId === pinnedViatarId;
  const defaultActions =
    subjectId.length > 0 &&
    selectedScan !== undefined &&
    (isPinned || selectedScan.synced);

  const saveDefault = (next: number | null) => {
    setSavingDefault(true);
    setDefaultError(false);
    void fetch(`/api/vitronic/subjects/${subjectId}/default`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viatarId: next }),
    })
      .then((response) => {
        if (!response.ok) {
          setDefaultError(true);
          return;
        }
        setSubjects((rows) =>
          rows.map((row) =>
            row.id === subjectId ? { ...row, defaultViatarId: next } : row,
          ),
        );
        if (next !== null) setViatarId(String(next));
      })
      .catch(() => setDefaultError(true))
      .finally(() => setSavingDefault(false));
  };
  const syncLabel =
    scanState === "complete"
      ? SCAN_RESYNC
      : scanState === "incomplete"
        ? SCAN_SYNC_AGAIN
        : SCAN_SYNC;
  const properties = snapshot?.properties ?? [];
  const geometry = parseSnapshotGeometry(snapshot ?? {});
  const shownMarkers = visibleMarkers(geometry.markers, overlays);
  const shownMeasures = visibleMeasures(geometry.measures, overlays);
  const readyMesh = snapshot?.hasAvatar === true;
  const webgl = useWebglAvailable();
  const showWebgl = !forceFallback && webgl;
  // With a canvas the panel sits in its rail; without one it stands alone.
  const panelInRail = showWebgl && readyMesh;
  const biomarkerSubject = isDemo ? "demo" : selectedSubject?.isSelf ? "self" : "other";
  const biomarkers = useBiomarkerTab({
    subject: biomarkerSubject,
    enabled: preview === undefined,
    anatomy: anatomy.state,
    dispatch: anatomy.dispatch,
    initialPersonRef,
  });
  // The Demo body follows the synthetic person's stored sex unless picked by hand.
  const personSex =
    biomarkers.people.find((person) => person.ref === biomarkers.personRef)?.sex ?? null;
  const demoSex = demoBodySex(demoSexPick, biomarkers.personRef, personSex);
  // The atlas follows the body's sex where it is known; a scan's is not.
  const bodySex: BodySex | null = isDemo ? demoSex : null;
  const { dispatch: anatomyDispatch } = anatomy;
  useEffect(() => {
    anatomyDispatch({ type: "bodySex", sex: bodySex });
  }, [anatomyDispatch, bodySex]);
  // Every viewer panel folds away; inline the choice is remembered per viewer.
  const [toolbarOpen, toggleToolbar] = usePanelOpen(PANEL_IDS.toolbar);
  const [anatomyOpen, toggleAnatomy] = usePanelOpen(PANEL_IDS.anatomy);
  const [detailsOpen, toggleDetails, setDetailsOpen] = usePanelOpen(PANEL_IDS.details);
  const [overlaysOpen, toggleOverlays] = usePanelOpen(PANEL_IDS.overlays);
  const inlinePanels = {
    anatomy: { open: anatomyOpen, toggle: toggleAnatomy },
    details: { open: detailsOpen, toggle: toggleDetails },
  };
  // G3b: a tap on the body picks a part, lights it and opens its card.
  const [picked, setPicked] = useState<Picked | null>(null);
  const [anchorStore] = useState(createAnchorStore);
  const scheme = ATLASES[anatomy.state.atlasId].scheme;
  const pickLit = anatomy.state.highlightFrom?.id.startsWith(PICK_PREFIX) === true;
  const onPick = useCallback(
    (next: Picked | null) => {
      setPicked(next);
      onPickPart?.(
        next?.target.kind === "part"
          ? { group: next.target.group, system: next.target.system }
          : null,
      );
      const lit = next ? pickHighlight(next.target) : null;
      if (!next || next.target.kind !== "part" || !lit) {
        // The body outline or empty sky replaces a pick; its glow goes with it.
        if (pickLit) anatomyDispatch({ type: "highlight", highlight: null });
        return;
      }
      const highlights = pickHighlights(next.target, scheme);
      anatomyDispatch({
        type: "highlight",
        highlight: lit,
        from: {
          id: `${PICK_PREFIX}${highlightValue(lit)}`,
          label: pickedLabel(next.target.label),
          highlights,
        },
      });
    },
    [scheme, anatomyDispatch, pickLit, onPickPart],
  );
  // A chat view's focus is lit once, at its depth; after that the viewer is the person's.
  const focusApplied = useRef(false);
  useEffect(() => {
    if (initialFocus === undefined || focusApplied.current) return;
    focusApplied.current = true;
    anatomyDispatch({ type: "depth", depth: initialFocus.depth });
    anatomyDispatch({
      type: "highlight",
      highlight: initialFocus.highlights[scheme],
      from: {
        id: `chat:${initialFocus.id}`,
        label: `From chat: ${initialFocus.label}`,
        highlights: initialFocus.highlights,
      },
    });
  }, [initialFocus, scheme, anatomyDispatch]);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [viewNode, setViewNode] = useState<HTMLDivElement | null>(null);
  const setView = useCallback((node: HTMLDivElement | null) => {
    viewRef.current = node;
    setViewNode(node);
  }, []);
  const wheelHint = useWheelGate(viewNode, environment.active);
  // Entering or leaving, however it happens (button, Esc, full screen dropped),
  // re-frames the body: the inline view may have been zoomed, the environment walked.
  const wasActiveRef = useRef(environment.active);
  useEffect(() => {
    if (wasActiveRef.current === environment.active) return;
    wasActiveRef.current = environment.active;
    setResetKey((value) => value + 1);
  }, [environment.active]);
  // Closing the card hands focus back to the 3D view, so the keys walk again.
  const closeCard = useCallback(() => {
    setPicked(null);
    viewRef.current?.focus();
  }, []);
  const { live: measuredVitals } = biomarkers;
  // Night playback replaces the newest readings while it is open, inline only.
  const night = useNightPlayback(biomarkerSubject, reducedMotion);
  const nightSynthetic = nightPlaybackFor(biomarkerSubject) === "synthetic";
  const playing = nightSynthetic && night.open && !environment.active;
  const liveVitals = playing ? night.vitals : measuredVitals;
  const liveAvailable =
    !reducedMotion &&
    (measuredVitals.heart !== null ||
      measuredVitals.breath !== null ||
      measuredVitals.hrvBelow !== null);
  const liveOn =
    !reducedMotion &&
    (playing || (liveAvailable && (environment.active ? liveInEnvironment : liveInline)));
  // Heart chambers (#53): on by default with live vitals, remembered per viewer.
  // Only the HRA heart is a mesh of its own; the toggle shows while it can beat.
  const [chambersWanted, toggleChambers] = usePanelOpen(PANEL_IDS.heartChambers);
  const chambersAvailable = liveOn && liveVitals.heart !== null && scheme === "hra";
  const heartRhythm = useMemo(
    () => heartRhythmOf(biomarkers.rhythm ?? { kind: "measured" }),
    [biomarkers.rhythm],
  );
  const chambers = useMemo(
    () => ({ on: chambersWanted, pattern: heartRhythm.pattern }),
    [chambersWanted, heartRhythm.pattern],
  );
  // Primitives only, so the page hears about a change once, not on every render.
  const contextScans = listedScans.length;
  const contextValues = biomarkers.rows.filter((row) => row.value !== null).length;
  const contextLive =
    measuredVitals.heart !== null ||
    measuredVitals.breath !== null ||
    measuredVitals.hrvBelow !== null;
  const contextStatus = biomarkers.status;
  useEffect(() => {
    if (!subjectsReady || !onContext) return;
    onContext({
      subject: biomarkerSubject,
      scans: contextScans,
      biomarkerValues: contextValues,
      biomarkersStatus: contextStatus,
      liveVitals: contextLive,
    });
  }, [
    subjectsReady,
    onContext,
    biomarkerSubject,
    contextScans,
    contextValues,
    contextStatus,
    contextLive,
  ]);
  const linked = useMemo(
    () => (picked ? linkedRows(picked.target, biomarkers.rows, scheme) : []),
    [picked, biomarkers.rows, scheme],
  );
  // HRA parts carry a group key; BodyParts3D parts have none, so they get no line.
  const pickedGroup = picked?.target.kind === "part" ? picked.target.group : null;
  const pickedOrgan =
    biomarkers.organs.find((status) => status.organ === pickedGroup) ?? null;
  // A card describes one part of one body on one atlas; any of those changing closes it.
  const bodyKey = isDemo ? `demo:${demoSex}` : `scan:${shownViatarId}`;
  useEffect(() => {
    setPicked(null);
  }, [environment.active, anatomy.state.atlasId, bodyKey]);
  // Another subject or scan starts with an empty search; the chosen tab stays.
  useEffect(() => {
    onPanel({ type: "query", query: "" });
  }, [subjectId, bodyKey]);
  // A part a toggle or the slider has hidden has no card either.
  const { targetDepth, layers: shownLayers, hiddenSystems } = anatomy.state;
  const pickedShown =
    picked === null ||
    pickVisible(picked.target, targetDepth, shownLayers, hiddenSystems);
  useEffect(() => {
    if (!pickedShown) setPicked(null);
  }, [pickedShown]);
  // The biomarker catalogue counts too: a subject with no scan rows still gets it.
  const hasPanelRows =
    properties.length +
      geometry.markers.length +
      geometry.measures.length +
      biomarkers.rows.length >
    0;
  const bodyPanel = (
    <BodyPanel
      properties={properties}
      markers={shownMarkers}
      measures={shownMeasures}
      selectedId={highlightId}
      onSelect={setHighlightId}
      biomarkers={biomarkers}
      panel={panel}
      onPanel={onPanel}
    />
  );
  const scanMeta = selectedScan
    ? [
        selectedScan.crtime ? selectedScan.crtime.slice(0, 10) : null,
        `scan ${selectedScan.viatarId}`,
        selectedScan.presetName ?? snapshot?.presetName,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  // First paint, before the subject list answers: same line as before the demo existed.
  if (!subjectsReady) {
    return (
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {BODY_TWIN_LOADING}
      </p>
    );
  }

  const demoBody = DEMO_BODIES[demoBodyIdFor(demoSex)];
  // The rigged bake replaces the static body when installed; until the status
  // answers there is no URL, so the demo body is never loaded twice.
  const demoRigged = anatomy.rigged?.[demoBody.id] === true;
  const demoUrl =
    anatomy.rigged === null && preview === undefined
      ? null
      : demoRigged
        ? riggedBodyApiUrl(demoBody.id)
        : demoBodyApiUrl(demoBody.id);

  // One card for a picked part: inline over the canvas, in the environment in
  // the bottom stack. It describes one view, so entering or leaving closes it.
  const pickCard = picked ? (
    <PickCard
      picked={picked}
      linked={linked}
      organ={pickedOrgan}
      selectedId={biomarkers.selectedId}
      store={anchorStore}
      onSelectRow={(id) => {
        biomarkers.onSelect(id);
        // The row and its notes are in Details, so it opens.
        if (!id) return;
        if (environment.active) environment.openPanel("details");
        else setDetailsOpen(true);
      }}
      onClose={closeCard}
    />
  ) : null;

  // The wrapper places the inline card over the canvas; in the environment it
  // has no box, so the view stays a cell of the environment's grid. The tree
  // is the same either way, so the canvas never remounts.
  const viewport = (body: Readonly<{ kind: "scan" | "demo"; url: string }>) => (
    <div className={environment.active ? "contents" : "relative"}>
      <div
        className={
          environment.active
            ? "twin-environment-view relative overflow-hidden"
            : "wearables-hero relative h-[min(70vh,640px)] min-h-[360px] overflow-hidden rounded-xl"
        }
        // The 3D view takes focus (a click, or Tab); focused or hovered, the
        // keys walk (walk-controls.tsx). Inline, focus is also what lets the
        // wheel zoom (wheel-zoom.ts).
        ref={setView}
        tabIndex={0}
        role="application"
        aria-label={VIEW_LABEL}
        {...{ [WALK_SURFACE_ATTR]: "" }}
      >
        <Canvas
          key={canvasKey}
          camera={camera}
          frameloop="demand"
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "low-power",
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
          }}
        >
          <ContextLossWatcher onLost={onGlLost} onFresh={onGlFresh} />
          <ScanEnvironment intensity={light.environment} />
          {/* Z-up scene: the sky is +Z, the key is front-top (the body faces -Y), the rim behind.
            The environment changes only colours and intensities, never the light count. */}
          <hemisphereLight
            position={[0, 0, 1]}
            color={0xf2f6ff}
            groundColor={0x3a3a3a}
            intensity={light.hemisphere}
          />
          <directionalLight
            position={[0, -2.4, 3.2]}
            intensity={light.key}
            color={light.keyColor}
          />
          <directionalLight position={[0, 2.5, 1.5]} intensity={light.rim} />
          <BodyScan
            url={body.url}
            kind={body.kind}
            onError={body.kind === "demo" ? onDemoError : undefined}
            onReady={body.kind === "demo" ? onDemoReady : undefined}
            dark={look ? look.world.dark : dark}
            camera={camera}
            showLandmarks={body.kind === "scan" && showLandmarks}
            resetKey={resetKey}
            autoRotate={autoRotate}
            onUserRotate={onUserRotate}
            markers={body.kind === "scan" ? shownMarkers : NO_MARKERS}
            measures={body.kind === "scan" ? shownMeasures : NO_MEASURES}
            highlightId={highlightId ?? panel.hoverId}
            onHover={onHover}
            onLabels={setLabelScreen}
            onScene={setScanScene}
            onControls={onControls}
            world={look?.world ?? null}
            walk={environment.active}
            getControls={getControls}
          />
          <BodyMotion
            binding={motion.binding}
            clip={motion.clip}
            tempo={motion.tempo}
            video={motion.video}
          />
          <ProjectAnchor point={picked?.point ?? null} store={anchorStore} />
          <AnatomyLayers
            scanRoot={scanScene}
            statureM={body.kind === "scan" ? snapshotStature(properties) : null}
            atlasId={anatomy.state.atlasId}
            requested={anatomy.state.requested}
            retry={anatomy.state.retry}
            // The atlas cannot follow the bones, so it fades out while the body moves.
            targetDepth={motion.clip ? 0 : anatomy.state.targetDepth}
            layers={anatomy.state.layers}
            hiddenSystems={anatomy.state.hiddenSystems}
            highlight={anatomy.state.highlight}
            reducedMotion={reducedMotion}
            onLoad={anatomy.onLoad}
            onPick={onPick}
            liveVitals={{
              enabled: liveOn,
              vitals: liveVitals,
              chambers,
              onStatus: setLiveStatus,
            }}
          />
        </Canvas>
        {glLost ? (
          <div
            role="alert"
            className="bg-card/90 absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm"
          >
            <p>{BODY_VIEW_LOST}</p>
            <Button
              onClick={() => {
                setGlLost(false);
                setCanvasKey((value) => value + 1);
              }}
            >
              {BODY_VIEW_RELOAD}
            </Button>
          </div>
        ) : null}
        {wheelHint ? (
          <p role="status" className="twin-wheel-hint">
            {WHEEL_ZOOM_HINT}
          </p>
        ) : null}
        {body.kind === "scan" && showLandmarks
          ? labelScreen.map((row) => (
              <div
                key={row.id}
                className="pointer-events-none absolute z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                style={{
                  left: row.x,
                  top: row.y,
                  transform: "translate(-50%, -120%)",
                }}
              >
                {row.text}
              </div>
            ))
          : null}
      </div>
      {environment.active ? null : pickCard}
    </div>
  );

  // Toolbar and canvas on the left; on lg the rail sits beside them, below lg
  // it stacks directly under the canvas. In the environment the same elements
  // cover the window: the canvas fills it and the toolbar and rail float over
  // it. Only classes change, so the canvas and the panels are never remounted on
  // enter or exit. The move between rail and standalone below does remount the
  // panel; its search and tab live in `panel` here, so they survive it.
  const inEnvironment = environment.active;
  const viewer = (
    body: Readonly<{ kind: "scan" | "demo"; url: string }>,
    rail: Readonly<{ anatomy: ReactNode; details: ReactNode }>,
  ) => (
    <div
      ref={environment.setContainer}
      // Takes focus on a canvas drag, so focus never falls back to the page behind.
      tabIndex={inEnvironment ? -1 : undefined}
      role={inEnvironment ? "dialog" : undefined}
      aria-modal={inEnvironment ? true : undefined}
      aria-label={inEnvironment ? ENVIRONMENT_LABEL : undefined}
      className={
        inEnvironment
          ? "twin-environment"
          : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start"
      }
    >
      <div className={inEnvironment ? "contents" : "min-w-0"}>
        <div className={inEnvironment ? "twin-environment-bar" : undefined}>
          <CollapsiblePanel
            label={TOOLBAR_PANEL}
            open={toolbarOpen}
            onToggle={toggleToolbar}
            className={inEnvironment ? "twin-toolbar" : "twin-panel twin-toolbar mb-2"}
          >
            <ViewToolbar
              autoRotate={autoRotate}
              onReset={() => setResetKey((value) => value + 1)}
              onToggleRotate={() => {
                const next = !wantRotate;
                setWantRotate(next);
                setAutoRotate(next);
              }}
              onZoom={zoom}
              landmarks={
                body.kind === "scan"
                  ? {
                      shown: showLandmarks,
                      onToggle: () => setShowLandmarks((value) => !value),
                    }
                  : undefined
              }
              motion={motion.control}
              environment={{ active: inEnvironment, onToggle: environment.toggle }}
              environmentRef={environment.buttonRef}
              liveVitals={
                liveAvailable
                  ? {
                      on: liveOn,
                      onToggle: () =>
                        environment.active
                          ? setLiveInEnvironment((on) => !on)
                          : setLiveInline((on) => !on),
                    }
                  : undefined
              }
              heartChambers={
                chambersAvailable
                  ? { on: chambersWanted, onToggle: toggleChambers }
                  : undefined
              }
            />
          </CollapsiblePanel>
          {inEnvironment ? (
            <EnvironmentPanel
              label={PANEL_TEXT.scene}
              floating
              open={environment.state.open.scene}
              onToggle={() => environment.togglePanel("scene")}
            >
              <EnvironmentBar
                shown={environment.state.open.scene}
                preset={preset}
                followTime={followTime}
                onPreset={(next) =>
                  environment.dispatch({ type: "preset", preset: next })
                }
                onFollowTime={() => environment.dispatch({ type: "followTime" })}
              />
            </EnvironmentPanel>
          ) : null}
        </div>
        {viewport(body)}
        {/* Beside the 3D view, not in its role="application", so both read as text.
            Below 640 px in the environment they stack at the bottom (globals.css). */}
        <div className="twin-bottom-stack">
          <LiveLines
            status={liveOn ? liveStatus : IDLE_STATUS}
            vitals={liveVitals}
            timing={heartRhythm.timing}
            scheme={scheme}
            context={{
              on: playing || (environment.active ? liveInEnvironment : liveInline),
              inEnvironment: environment.active,
              reducedMotion,
            }}
            extra={motionLines(motion.control, anatomy.state.targetDepth > 0)}
          />
          {environment.active ? null : nightSynthetic ? (
            <NightPlayback state={night} reducedMotion={reducedMotion} />
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">{NIGHT_NEEDS_READINGS}</p>
          )}
          {environment.active ? pickCard : null}
        </div>
      </div>
      <div
        className={
          inEnvironment ? "twin-environment-rail" : "flex min-w-0 flex-col gap-3"
        }
      >
        {/* In the environment the panels open by screen size on entry
            (environment-state.ts); inline each keeps the viewer's own choice. */}
        {(["anatomy", "details"] as const).map((panel) => (
          <EnvironmentPanel
            key={panel}
            label={PANEL_TEXT[panel]}
            floating={inEnvironment}
            open={
              inEnvironment ? environment.state.open[panel] : inlinePanels[panel].open
            }
            onToggle={
              inEnvironment
                ? () => environment.togglePanel(panel)
                : inlinePanels[panel].toggle
            }
          >
            {rail[panel]}
          </EnvironmentPanel>
        ))}
      </div>
      {inEnvironment ? <ResearchLine /> : null}
    </div>
  );

  return (
    <div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          as="select"
          label="Subject"
          value={subjectId}
          onChange={(event) => {
            setSubjectId(event.target.value);
            setViatarId("");
          }}
        >
          {subjectOptions(subjects).map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </Field>
        {isDemo ? (
          <Field
            as="select"
            label={DEMO_BODY_PICKER}
            value={demoSex}
            onChange={(event) => {
              const next = DEMO_SEXES.find((sex) => sex === event.target.value);
              if (next) setDemoSexPick({ personRef: biomarkers.personRef, sex: next });
            }}
          >
            {DEMO_SEXES.map((sex) => (
              <option key={sex} value={sex}>
                {DEMO_SEX_LABEL[sex]}
              </option>
            ))}
          </Field>
        ) : (
          <Field
            as="select"
            label="Scan"
            value={shownViatarId}
            onChange={(event) => setViatarId(event.target.value)}
          >
            {listedScans.length === 0 ? <option value="">No scans</option> : null}
            {listedScans.map((row) => (
              <option key={row.viatarId} value={String(row.viatarId)}>
                {scanLabel(row, pinnedViatarId)}
              </option>
            ))}
          </Field>
        )}
      </div>
      {isDemo ? (
        <>
          <p className="text-muted-foreground mt-2 text-xs">{DEMO_BODY_NOTE}</p>
          {demoUrl && demoErrorShown(demoFailedUrl, demoUrl) ? (
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {DEMO_LOAD_ERROR}
            </p>
          ) : null}
          {showWebgl ? (
            demoUrl &&
            viewer(
              { kind: "demo", url: demoUrl },
              {
                anatomy: (
                  <AnatomyControls
                    state={anatomy.state}
                    installed={anatomy.installed}
                    dispatch={anatomy.dispatch}
                    onInteract={onUserRotate}
                    envelope="demo"
                  />
                ),
                details: (
                  <BodyPanel
                    properties={[]}
                    markers={NO_MARKERS}
                    measures={NO_MEASURES}
                    selectedId={null}
                    biomarkers={biomarkers}
                    tabs={DEMO_PANEL_TABS}
                    panel={panel}
                    onPanel={onPanel}
                  />
                ),
              },
            )
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">{DEMO_NEEDS_WEBGL}</p>
          )}
          <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
            {demoRigged ? RIGGED_ATTRIBUTION : demoBody.attribution}{" "}
            <a
              href={ANNY_CODE_LICENCE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Apache-2.0
            </a>{" "}
            ·{" "}
            <a
              href={ANNY_SHAPE_LICENCE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              CC0 1.0
            </a>{" "}
            ·{" "}
            <a
              href={ANNY_PAPER_URL}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              arXiv:2511.03589
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 text-xs">Label is {LABEL_HINT}.</p>
          {scannerActions || defaultActions ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {scannerActions ? (
                <Button
                  onClick={() => {
                    void fetch(`/api/vitronic/subjects/${subjectId}/sync`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ viatarId: selectedViatar }),
                    }).then(async (response) => {
                      if (!response.ok) return;
                      const [snaps, scanList] = await Promise.all([
                        fetch(`/api/vitronic/subjects/${subjectId}/snapshots`),
                        fetch(`/api/vitronic/subjects/${subjectId}/scans`),
                      ]);
                      const snapBody: unknown = snaps.ok ? await snaps.json() : null;
                      const scanBody: unknown = scanList.ok
                        ? await scanList.json()
                        : null;
                      if (isSnapshotsPayload(snapBody))
                        setSnapshots(snapBody.snapshots ?? []);
                      if (isScansPayload(scanBody)) setScans(scanBody.scans ?? []);
                    });
                  }}
                >
                  {syncLabel}
                </Button>
              ) : null}
              {defaultActions ? (
                <Button
                  disabled={savingDefault}
                  onClick={() => saveDefault(isPinned ? null : selectedViatar)}
                >
                  {isPinned ? SCAN_CLEAR_DEFAULT : SCAN_SET_DEFAULT}
                </Button>
              ) : null}
            </div>
          ) : null}
          {defaultError ? (
            <p className="text-muted-foreground mt-2 text-xs">{SCAN_DEFAULT_FAILED}</p>
          ) : null}
          {listedScans.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {BODYLOOP_NO_SCANS}
            </p>
          ) : (
            <>
              {scanMeta ? (
                <p className="text-muted-foreground mt-3 text-xs">{scanMeta}</p>
              ) : null}
              {snapshot && !readyMesh ? (
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                  {BODYLOOP_NO_MESH}
                </p>
              ) : null}
              {(readyMesh && snapshot) ||
              geometry.markers.length + geometry.measures.length > 0 ? (
                <>
                  <CollapsiblePanel
                    label={OVERLAYS_PANEL}
                    open={overlaysOpen}
                    onToggle={toggleOverlays}
                    className="twin-panel mt-3"
                  >
                    <fieldset className="px-1.5">
                      <legend className="sr-only">{OVERLAYS_PANEL}</legend>
                      <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                        {OVERLAY_OPTIONS.map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={overlays[key]}
                              onChange={() =>
                                setOverlays((current) => ({
                                  ...current,
                                  [key]: !current[key],
                                }))
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <Legend items={overlayLegendItems()} className="mt-2 gap-y-1" />
                    </fieldset>
                  </CollapsiblePanel>
                  {showWebgl && readyMesh && snapshot ? (
                    viewer(
                      { kind: "scan", url: `/api/vitronic/avatar/${snapshot.id}` },
                      {
                        anatomy: (
                          <AnatomyControls
                            state={anatomy.state}
                            installed={anatomy.installed}
                            dispatch={anatomy.dispatch}
                            onInteract={onUserRotate}
                          />
                        ),
                        details: bodyPanel,
                      },
                    )
                  ) : readyMesh ? (
                    <p className="text-muted-foreground mt-3 text-sm">
                      {SCAN_NEEDS_WEBGL}
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          )}
          {/* Without a mesh the panel stands here, under the selectors. Swapping to a
              scan with one moves it into the rail and remounts it; `panel` keeps
              its search and tab. */}
          {!panelInRail && hasPanelRows ? <div className="mt-3">{bodyPanel}</div> : null}
        </>
      )}
    </div>
  );
};
