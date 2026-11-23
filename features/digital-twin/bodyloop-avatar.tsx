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
import { ACESFilmicToneMapping, Box3, type Group, PerspectiveCamera } from "three";
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
import { glucoseUnavailable, type GlucoseStatus } from "./anatomy/glucose-flow";
import { type GlucoseControlModel } from "./anatomy/glucose-control";
import { demoStanceFor, fittedAvailable, fittedShown } from "./anatomy/fitted-option";
import { highlightValue } from "./anatomy/highlight-options";
import { BodyPanel, type BodyPanelProps, type PanelTab } from "./body-panel";
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
import { BEAT_FOCUS_PREFIX, beatFocusMove } from "./day/beat-focus";
import { DAY_FOCUS_FROM } from "./day/day-copy";
import { MyDayPanel } from "./day/my-day-panel";
import { useMyDay } from "./day/use-my-day";
import { DayMotionBar } from "./motion/day-motion-bar";
import { useDayMotion } from "./motion/use-day-motion";
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
import { heartAnimationRate } from "./live/heart-rate-control";
import { type LiveVitalMode } from "./live/live-vitals-control";
import { heartRhythmOf } from "./live/heart-rhythm";
import { NIGHT_NEEDS_READINGS } from "./live/live-copy";
import { NightPlayback, useNightPlayback } from "./live/night-playback";
import { nightPlaybackFor } from "./live/night-series";
import {
  heartPickDismissal,
  linkedRows,
  pickHighlight,
  pickHighlights,
  pickVisible,
  type Picked,
} from "./environment/pick-part";
import {
  HEMISPHERE_GROUND,
  HEMISPHERE_SKY,
  INLINE_LIGHT,
  lookFor,
} from "./environment/environment-look";
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
import { useTwinPalette } from "./use-twin-palette";
import { HeartFocus, type CameraFocusRequest } from "./heart-focus";
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
  SCAN_AUTO_SYNC_STOPPED,
  scanAutoSyncing,
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
import { scanLabel, isScansPayload, isSnapshotsPayload } from "./body-twin-payloads";
import { loadSubjects } from "./load-subjects";
import { autoSyncScans, scansToAutoSync } from "./scan-auto-sync";
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
  SCAN_AUTO_SYNC_STOPPED,
  scanAutoSyncing,
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
const DEMO_PANEL_TABS: readonly PanelTab[] = ["anatomy", "biomarkers"];

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
  /** A focus asked for after the viewer opened (a spoken answer); lit once per `at`. */
  readonly focusRequest?: FocusRequest;
  /** A tap on the body, as the HRA group and system it names; null when cleared. */
  readonly onPickPart?: (part: PickedPart | null) => void;
  /** False when the server knows BodyLoop is off: no subjects call, the demo only. */
  readonly bodyLoopConfigured?: boolean;
};

export type InitialFocus = Readonly<{
  id: string;
  label: string;
  highlights: Readonly<Record<AtlasScheme, Highlight>>;
  depth: number;
}>;

export type FocusRequest = Readonly<{ focus: InitialFocus; at: number }>;

export type PickedPart = Readonly<{ group: string | null; system: string | null }>;

/**
 * Inline beside the 3D view: the one panel, with the viewer's anatomy
 * controls as its first tab. Its own component so a test reaches it without
 * WebGL.
 */
export const TwinSidePanel = ({
  anatomy,
  panel,
}: Readonly<{ anatomy: ReactNode; panel: BodyPanelProps }>) => (
  <BodyPanel {...panel} anatomy={anatomy} className="twin-side-panel" />
);

/** BodyLoop helper geometry that must not show inside the (glass) scan. */
export const BodyLoopAvatar = ({
  preview,
  forceFallback = false,
  onContext,
  initialSubjectId,
  initialPersonRef,
  initialFocus,
  focusRequest,
  onPickPart,
  bodyLoopConfigured = true,
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
  // #613: scans the scanner lists that were never stored are fetched on open.
  const [autoSyncing, setAutoSyncing] = useState(0);
  const [autoSyncStopped, setAutoSyncStopped] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Live vitals: on in the environment, off inline until asked (battery on an
  // 8 GB Air), never with reduced motion.
  const [inlineLiveMode, setInlineLiveMode] = useState<LiveVitalMode>(null);
  const [environmentLiveMode, setEnvironmentLiveMode] = useState<LiveVitalMode>("hr");
  const [heartOverride, setHeartOverride] = useState<{
    subjectId: string;
    personRef: string | null;
    bpm: number;
  } | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(IDLE_STATUS);
  const [scanScene, setScanScene] = useState<Group | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [glLost, setGlLost] = useState(false);
  const onGlLost = useCallback(() => setGlLost(true), []);
  const onGlFresh = useCallback(() => setGlLost(false), []);
  const idleRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [heartFocus, setHeartFocus] = useState<CameraFocusRequest | null>(null);
  const camera = useMemo(() => new PerspectiveCamera(40, 1, 0.01, 40), []);
  const anatomy = useAnatomyView(preview === undefined);
  const [particleDensity, setParticleDensity] = useState(0.5);
  const [particleStatus, setParticleStatus] = useState<GlucoseStatus>("idle");
  const [particleRetry, setParticleRetry] = useState(0);
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
  const palette = useTwinPalette();
  const environment = useEnvironment();
  const { preset, followTime } = environment.state;
  const hour = useLocalHour(environment.active && preset === "outdoors" && followTime);
  const look = useMemo(
    () =>
      environment.active ? lookFor(preset, palette, followTime ? hour : null) : null,
    [environment.active, preset, palette, followTime, hour],
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
    void loadSubjects({
      bodyLoopConfigured,
      fetchSubjects: () =>
        fetch("/api/vitronic/subjects").then((response) =>
          response.ok ? response.json() : null,
        ),
    })
      .then((rows) => {
        if (cancelled) return;
        // No BodyLoop connection or no subjects: the demo subject still works.
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
  }, [preview, bodyLoopConfigured]);

  const selectedSubject = subjects.find((row) => row.id === subjectId);
  const subjectKind: "scanner" | "file" =
    selectedSubject?.source === VITRONIC_SUBJECT_SOURCE_SCANNER ||
    selectedSubject?.isSelf === true
      ? "scanner"
      : "file";

  useEffect(() => {
    if (preview !== undefined || !subjectId || isDemoSubject(subjectId)) return;
    let cancelled = false;
    const loadLists = () =>
      Promise.all([
        fetch(`/api/vitronic/subjects/${subjectId}/scans`).then((response) =>
          response.ok ? response.json() : null,
        ),
        fetch(`/api/vitronic/subjects/${subjectId}/snapshots`).then((response) =>
          response.ok ? response.json() : null,
        ),
      ]).then(([scansBody, snapshotsBody]: readonly [unknown, unknown]) => {
        const nextScans = isScansPayload(scansBody) ? (scansBody.scans ?? []) : [];
        if (!cancelled) {
          setScans(nextScans);
          setSnapshots(
            isSnapshotsPayload(snapshotsBody) ? (snapshotsBody.snapshots ?? []) : [],
          );
        }
        return nextScans;
      });
    setAutoSyncing(0);
    setAutoSyncStopped(false);
    void loadLists()
      .then(async (listed) => {
        // Once per open: the lists read after the fetch do not start another round.
        // Only scanner subjects: a file subject has nothing on the scanner to fetch.
        const fresh =
          subjectKind === "scanner" ? scansToAutoSync(listed, Date.now()) : [];
        if (cancelled || fresh.length === 0) return;
        setAutoSyncing(fresh.length);
        const outcome = await autoSyncScans(
          fresh,
          (viatarId) =>
            fetch(`/api/vitronic/subjects/${subjectId}/sync`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ viatarId }),
            }).then((response) => response.ok),
          () => cancelled,
        );
        if (cancelled) return;
        setAutoSyncing(0);
        setAutoSyncStopped(outcome.stopped);
        if (outcome.synced.length > 0) await loadLists();
      })
      .catch(() => {
        if (!cancelled) setAutoSyncing(0);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, subjectId, subjectKind]);

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
    setHeartFocus(null);
    setAutoRotate(false);
    if (idleRef.current) window.clearTimeout(idleRef.current);
    if (!wantRotate) return;
    idleRef.current = window.setTimeout(() => {
      setAutoRotate(true);
    }, AUTO_ROTATE_IDLE_MS);
  }, [wantRotate]);
  const onHeartFocus = useCallback((box: Box3) => {
    if (idleRef.current) window.clearTimeout(idleRef.current);
    setWantRotate(false);
    setAutoRotate(false);
    setHeartFocus({ kind: "heart", box });
  }, []);
  const resetView = useCallback(() => {
    if (idleRef.current) window.clearTimeout(idleRef.current);
    setWantRotate(false);
    setAutoRotate(false);
    if (scanScene) {
      setHeartFocus({ kind: "body", box: new Box3().setFromObject(scanScene) });
    } else {
      setHeartFocus(null);
      setResetKey((value) => value + 1);
    }
  }, [scanScene]);

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
  // #52: the twin can follow a wearable day; a toolbar clip stops following.
  const dayMotion = useDayMotion({
    subject: biomarkerSubject,
    personRef: biomarkers.personRef,
    personLabel:
      biomarkers.people.find((person) => person.ref === biomarkers.personRef)?.label ??
      "",
    enabled: preview === undefined,
  });
  const { onFollow: setFollowDay } = dayMotion;
  // "Show me my day": the Demo person's day as beats, or the illustrative mock day.
  const myDay = useMyDay({
    personRef: biomarkers.personRef,
    enabled: preview === undefined && biomarkerSubject === "demo",
  });
  const motion = useBodyMotion(scanScene, reducedMotion, isDemo ? "demo" : "scan", {
    plan: dayMotion.plan,
    lines: dayMotion.lines,
    onManual: () => setFollowDay(false),
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
  // The toolbar and the overlays fold away; inline the choice is remembered per viewer.
  const [toolbarOpen, toggleToolbar] = usePanelOpen(PANEL_IDS.toolbar);
  const [overlaysOpen, toggleOverlays] = usePanelOpen(PANEL_IDS.overlays);
  // G3b: a tap on the body picks a part, lights it and opens its card.
  const [picked, setPicked] = useState<Picked | null>(null);
  const [anchorStore] = useState(createAnchorStore);
  const scheme = ATLASES[anatomy.state.atlasId].scheme;
  const pickLit = anatomy.state.highlightFrom?.id.startsWith(PICK_PREFIX) === true;
  const onPick = useCallback(
    (next: Picked | null) => {
      setHeartFocus(null);
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
  const lightFocus = useCallback(
    (focus: InitialFocus) => {
      anatomyDispatch({ type: "depth", depth: focus.depth });
      anatomyDispatch({
        type: "highlight",
        highlight: focus.highlights[scheme],
        from: {
          id: `chat:${focus.id}`,
          label: `From chat: ${focus.label}`,
          highlights: focus.highlights,
        },
      });
    },
    [scheme, anatomyDispatch],
  );
  const focusApplied = useRef(false);
  useEffect(() => {
    if (initialFocus === undefined || focusApplied.current) return;
    focusApplied.current = true;
    lightFocus(initialFocus);
  }, [initialFocus, lightFocus]);
  // A pressed beat turns the twin to its organ at its layer; letting go clears
  // only a beat's glow, never a pick or a Biomarkers row.
  const dayFocus = myDay.focus;
  const dayLit = anatomy.state.highlightFrom?.id.startsWith(BEAT_FOCUS_PREFIX) === true;
  const dayApplied = useRef<string | null>(null);
  const { onBeat: letBeatGo } = myDay;
  useEffect(() => {
    const move = beatFocusMove(dayFocus?.id ?? null, dayApplied.current, dayLit);
    if (dayFocus === null) dayApplied.current = null;
    if (move === "clear") anatomyDispatch({ type: "highlight", highlight: null });
    // A pick or a Biomarkers row took the twin over: the beat lets go with it.
    if (move === "let-go") letBeatGo(null);
    if (move !== "apply" || dayFocus === null) return;
    dayApplied.current = dayFocus.id;
    anatomyDispatch({ type: "depth", depth: dayFocus.depth });
    anatomyDispatch({
      type: "highlight",
      highlight: dayFocus.highlights[scheme],
      from: {
        id: dayFocus.id,
        label: `${DAY_FOCUS_FROM}${dayFocus.label}`,
        highlights: dayFocus.highlights,
      },
    });
  }, [dayFocus, dayLit, scheme, anatomyDispatch, letBeatGo]);
  // A later request is lit once each; the person's own changes stay until the next.
  const requestApplied = useRef<number | null>(null);
  useEffect(() => {
    if (focusRequest === undefined || requestApplied.current === focusRequest.at) return;
    requestApplied.current = focusRequest.at;
    lightFocus(focusRequest.focus);
  }, [focusRequest, lightFocus]);
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
  const { clearHighlight: clearPickedHeart, resetView: resetPickedHeart } =
    heartPickDismissal(picked, pickLit, environment.active);
  // Return keyboard focus on every close, but reframe only an inline heart pick.
  const closeCard = useCallback(() => {
    setPicked(null);
    if (clearPickedHeart) anatomyDispatch({ type: "highlight", highlight: null });
    if (resetPickedHeart) resetView();
    viewRef.current?.focus();
  }, [anatomyDispatch, clearPickedHeart, resetPickedHeart, resetView]);
  const { live: measuredVitals } = biomarkers;
  // Night playback replaces the newest readings while it is open, inline only.
  const night = useNightPlayback(biomarkerSubject, reducedMotion);
  const liveMode = environment.active ? environmentLiveMode : inlineLiveMode;
  const nightSynthetic = nightPlaybackFor(biomarkerSubject) === "synthetic";
  const playing = nightSynthetic && night.open && !environment.active;
  const liveVitals = playing ? night.vitals : measuredVitals;
  const currentOverride =
    heartOverride?.subjectId === subjectId &&
    heartOverride.personRef === (isDemo ? biomarkers.personRef : null)
      ? heartOverride.bpm
      : null;
  const animationHeart = heartAnimationRate(
    liveVitals.heart?.perMinute ?? null,
    currentOverride,
    playing,
  );
  const liveOn =
    !reducedMotion && liveMode !== "glucose" && (playing || liveMode === "hr");
  // Heart chambers (#53): on by default with live vitals, remembered per viewer.
  // BodyParts3D uses tagged heart structures and a delayed vessel-surface pulse.
  const [chambersWanted, toggleChambers] = usePanelOpen(PANEL_IDS.heartChambers);
  const chambersAvailable = liveOn && liveVitals.heart !== null;
  const heartRhythm = useMemo(
    () => heartRhythmOf(biomarkers.rhythm ?? { kind: "measured" }),
    [biomarkers.rhythm],
  );
  const chambers = useMemo(
    () => ({ on: chambersWanted, pattern: heartRhythm.pattern }),
    [chambersWanted, heartRhythm.pattern],
  );
  const setLiveMode = environment.active ? setEnvironmentLiveMode : setInlineLiveMode;
  const { onOpen: setNightOpen } = night;
  const selectLiveMode = (mode: LiveVitalMode) => {
    setLiveMode(mode);
    if (mode !== "hr") setNightOpen(false);
    if (mode !== null) anatomyDispatch({ type: "depth", depth: 3 });
  };
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
    setHeartFocus(null);
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
    if (pickedShown) return;
    setPicked(null);
    if (clearPickedHeart) anatomyDispatch({ type: "highlight", highlight: null });
  }, [anatomyDispatch, clearPickedHeart, pickedShown]);
  // The biomarker catalogue counts too: a subject with no scan rows still gets it.
  const hasPanelRows =
    properties.length +
      geometry.markers.length +
      geometry.measures.length +
      biomarkers.rows.length >
    0;
  const scanPanel: BodyPanelProps = {
    properties,
    markers: shownMarkers,
    measures: shownMeasures,
    selectedId: highlightId,
    onSelect: setHighlightId,
    biomarkers,
    panel,
    onPanel,
  };
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
  // "Fit atlas to body": the atlas refitted to this rigged demo body in
  // Blender, where it is made here; the body then stands unposed.
  const fittedContext = {
    bodyId: isDemo ? demoBody.id : null,
    rigged: demoRigged,
    atlasId: anatomy.state.atlasId,
    installed: anatomy.fitted,
  };
  const fittedOn = fittedShown(anatomy.state.fitAtlas, fittedContext);
  const particleControl: GlucoseControlModel = {
    density: particleDensity,
    status: particleStatus,
    unavailable: glucoseUnavailable(
      anatomy.state.atlasId,
      fittedOn,
      motion.clip !== null,
    ),
    onDensity: setParticleDensity,
    onRetry: () => setParticleRetry((value) => value + 1),
  };

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
        // The row and its notes are on the Biomarkers tab, so the panel shows it.
        if (!id) return;
        if (environment.active) environment.openPanel("details");
        onPanel({ type: "tab", tab: "biomarkers" });
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
            : // The same height as the side panel (`--twin-view-height` in globals.css).
              "wearables-hero relative h-(--twin-view-height) min-h-(--twin-view-min-height) overflow-hidden rounded-xl"
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
            color={HEMISPHERE_SKY}
            groundColor={HEMISPHERE_GROUND}
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
            rates={motion.rates}
            stance={
              body.kind === "demo"
                ? demoStanceFor(demoBody.id, anatomy.state.atlasId, fittedOn)
                : null
            }
          />
          <HeartFocus
            request={heartFocus}
            getControls={getControls}
            reducedMotion={reducedMotion}
          />
          <ProjectAnchor point={picked?.point ?? null} store={anchorStore} />
          <AnatomyLayers
            scanRoot={scanScene}
            statureM={body.kind === "scan" ? snapshotStature(properties) : null}
            atlasId={anatomy.state.atlasId}
            fittedBody={body.kind === "demo" && fittedOn ? demoBody.id : null}
            requested={anatomy.state.requested}
            retry={anatomy.state.retry}
            // The atlas cannot follow the bones, so it fades out while the body moves.
            targetDepth={motion.clip ? 0 : anatomy.state.targetDepth}
            layers={anatomy.state.layers}
            hiddenSystems={anatomy.state.hiddenSystems}
            highlight={anatomy.state.highlight}
            highlightFromPick={pickLit}
            reducedMotion={reducedMotion}
            moving={motion.clip !== null}
            visualization={
              liveMode === "glucose"
                ? {
                    kind: "glucose",
                    model: {
                      density: particleDensity,
                      retry: particleRetry,
                      status: particleStatus,
                      onStatus: setParticleStatus,
                    },
                  }
                : liveMode === "hr" || playing
                  ? {
                      kind: "hr",
                      model: {
                        enabled: liveOn,
                        vitals: liveVitals,
                        heartBpm: animationHeart.bpm,
                        chambers,
                        onStatus: setLiveStatus,
                      },
                    }
                  : null
            }
            onLoad={anatomy.onLoad}
            onPick={onPick}
            onHeartFocus={onHeartFocus}
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
                className="bg-popover text-popover-foreground border-border pointer-events-none absolute z-10 rounded border px-1.5 py-0.5 text-[10px]"
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

  // Inline on lg: the toolbar across the top, the canvas on the left with the
  // live lines under it, and the side panel beside the canvas with its height
  // (`.twin-side-panel`); below lg they stack in that order. In the environment
  // the same elements cover the window: the canvas fills it and the toolbar
  // floats over it, as do the Anatomy and Details panels of the rail. The
  // canvas and the toolbar only change class on enter or exit, so they never
  // remount; the rail is rebuilt, and the panel's search and tab live in
  // `panel` here, so they survive it, as they do the move between the side
  // panel and standing alone below.
  const inEnvironment = environment.active;
  const viewer = (
    body: Readonly<{ kind: "scan" | "demo"; url: string }>,
    rail: Readonly<{ anatomy: ReactNode; panel: BodyPanelProps }>,
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
          : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]"
      }
    >
      <div className={inEnvironment ? "twin-environment-bar" : "lg:col-span-2"}>
        <CollapsiblePanel
          label={TOOLBAR_PANEL}
          open={toolbarOpen}
          onToggle={toggleToolbar}
          className={inEnvironment ? "twin-toolbar" : "twin-panel twin-toolbar"}
        >
          <ViewToolbar
            autoRotate={autoRotate}
            onReset={resetView}
            onToggleRotate={() => {
              setHeartFocus(null);
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
            onLiveInteract={onUserRotate}
            liveVitals={{
              mode: liveMode,
              onSelect: selectLiveMode,
              hrUnavailable: reducedMotion
                ? "HR animation is off with reduced motion."
                : null,
              heartRate: {
                bpm: animationHeart.bpm,
                overridden: currentOverride !== null,
                nightPlayback: playing,
                onChange: (bpm) =>
                  setHeartOverride({
                    subjectId,
                    personRef: isDemo ? biomarkers.personRef : null,
                    bpm,
                  }),
                onReset: () => setHeartOverride(null),
              },
              glucose: particleControl,
            }}
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
              onPreset={(next) => environment.dispatch({ type: "preset", preset: next })}
              onFollowTime={() => environment.dispatch({ type: "followTime" })}
            />
          </EnvironmentPanel>
        ) : null}
      </div>
      {viewport(body)}
      {/* Beside the 3D view, not in its role="application", so both read as text.
            Below 640 px in the environment they stack at the bottom (globals.css);
            inline they sit under the canvas, in its column. */}
      <div className={inEnvironment ? "twin-bottom-stack" : "lg:col-start-1"}>
        <LiveLines
          status={liveOn ? liveStatus : IDLE_STATUS}
          vitals={liveVitals}
          animationHeart={animationHeart}
          timing={heartRhythm.timing}
          scheme={scheme}
          context={{
            on: liveOn,
            inEnvironment: environment.active && liveMode !== "glucose",
            reducedMotion,
          }}
          extra={motionLines(motion.control, anatomy.state.targetDepth > 0)}
        />
        {environment.active || !motion.control ? null : (
          <DayMotionBar
            state={{
              ...dayMotion,
              onFollow: (next) => {
                motion.clearManual();
                dayMotion.onFollow(next);
              },
            }}
            unavailable={motion.control.unavailable}
          />
        )}
        {environment.active ? null : nightSynthetic ? (
          <NightPlayback
            state={{
              ...night,
              onOpen: (open) => {
                night.onOpen(open);
                if (open) setInlineLiveMode("hr");
              },
            }}
            reducedMotion={reducedMotion}
          />
        ) : (
          <p className="text-muted-foreground mt-2 text-xs">{NIGHT_NEEDS_READINGS}</p>
        )}
        {environment.active || biomarkerSubject !== "demo" ? null : (
          <MyDayPanel state={myDay} />
        )}
        {environment.active ? pickCard : null}
      </div>
      {inEnvironment ? (
        <div className="twin-environment-rail">
          {/* The panels open by screen size on entry (environment-state.ts). */}
          {(["anatomy", "details"] as const).map((panel) => (
            <EnvironmentPanel
              key={panel}
              label={PANEL_TEXT[panel]}
              floating
              open={environment.state.open[panel]}
              onToggle={() => environment.togglePanel(panel)}
            >
              {panel === "anatomy" ? rail.anatomy : <BodyPanel {...rail.panel} />}
            </EnvironmentPanel>
          ))}
        </div>
      ) : (
        <TwinSidePanel anatomy={rail.anatomy} panel={rail.panel} />
      )}
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
                    // BodyMotion poses a body to its stance once it has a rig binding.
                    posed={motion.binding !== null}
                    fitted={{
                      available: fittedAvailable(fittedContext),
                      shown: fittedOn,
                    }}
                  />
                ),
                panel: {
                  properties: [],
                  markers: NO_MARKERS,
                  measures: NO_MEASURES,
                  selectedId: null,
                  biomarkers,
                  tabs: DEMO_PANEL_TABS,
                  panel,
                  onPanel,
                },
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
                  disabled={autoSyncing > 0}
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
          {autoSyncing > 0 ? (
            <p role="status" className="text-muted-foreground mt-2 text-xs">
              {scanAutoSyncing(autoSyncing)}
            </p>
          ) : autoSyncStopped ? (
            <p role="status" className="text-muted-foreground mt-2 text-xs">
              {SCAN_AUTO_SYNC_STOPPED}
            </p>
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
                        panel: scanPanel,
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
              scan with one moves it beside the view and remounts it; `panel` keeps
              its search and tab. */}
          {!panelInRail && hasPanelRows ? (
            <div className="mt-3">
              <BodyPanel {...scanPanel} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};
