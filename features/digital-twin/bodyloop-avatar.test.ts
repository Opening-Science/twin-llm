import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Box3, Group, Object3D, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEMO_BODIES } from "@/packages/anatomy/demo-bodies";

import { DEMO_BODY_NOTE, DEMO_SUBJECT_LABEL } from "./anatomy/demo-copy";
import { BODY_PANEL_LABEL } from "./body-panel";
import { SELF_NO_LABS } from "./biomarkers/biomarker-copy";
import {
  BODY_TWIN_LOADING,
  BodyLoopAvatar,
  BODYLOOP_NO_MESH,
  BODYLOOP_NO_SCANS,
  DEMO_NEEDS_WEBGL,
  demoErrorShown,
  fitCameraToBox,
  HIDDEN_NODE_NAMES,
  hideOverlayNodes,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  SCAN_CLEAR_DEFAULT,
  SCAN_RESYNC,
  SCAN_SET_DEFAULT,
  SCAN_SYNC_AGAIN,
  snapshotStature,
  ZOOM_STEP,
} from "./bodyloop-avatar";

/** The line that used to stand above a Demo-only picker (removed in D6). */
const NO_SUBJECTS_LINE = "No BodyLoop subjects";

const SYNCED_IDS = [22, 23, 24, 25, 26, 27, 28];

const syncedPreview = (defaultViatarId: number | null) => ({
  subjects: [
    { id: "sub-self", label: "Self", isSelf: true, source: "scanner", defaultViatarId },
  ],
  scans: [
    ...SYNCED_IDS.map((id) => ({
      viatarId: id,
      crtime: `2026-10-${String(id - 20).padStart(2, "0")}T09:00:00.000Z`,
    })),
    { viatarId: 30, crtime: "2026-10-10T09:00:00.000Z" },
  ],
  snapshots: SYNCED_IDS.map((id) => ({
    id: `snap-${id}`,
    viatarId: id,
    hasAvatar: true,
    properties: [],
    markers: [],
  })),
  selectedSubjectId: "sub-self",
});

describe("BodyLoop avatar viewer", () => {
  test("source uses GLTFLoader, OrbitControls, hemisphere light, and AutoMarkers", () => {
    const source = readFileSync(join(import.meta.dir, "bodyloop-avatar.tsx"), "utf8");
    expect(source).toContain("GLTFLoader");
    expect(source).toContain("three/examples/jsm/controls/OrbitControls.js");
    expect(source).toContain("enableDamping");
    expect(source).toContain("hemisphereLight");
    expect(source).toContain("AutoMarkers");
    expect(source).toContain("gltf.scene");
    expect(source).toContain("camera.up.set(0, 0, 1)");
    expect(source).toContain("fitCameraToBox");
    expect(source).toContain("RoomEnvironment");
    expect(source).toContain("ACESFilmicToneMapping");
    expect(source).toContain("autoRotate");
    expect(source).toContain("prefers-reduced-motion");
    expect(source).toContain("PMREMGenerator");
    expect(source).toContain(SCAN_RESYNC);
    expect(source).not.toContain("camera.near =");
    expect(source).not.toContain("obj.visible");
  });

  test("source wires anatomy layers, zoom limits, disposal and on-demand frames", () => {
    const source = readFileSync(join(import.meta.dir, "bodyloop-avatar.tsx"), "utf8");
    expect(source).toContain("<AnatomyLayers");
    expect(source).toContain("<AnatomyControls");
    expect(source).toContain("controls.minDistance = MIN_ZOOM_DISTANCE");
    expect(source).toContain("controls.maxDistance = MAX_ZOOM_DISTANCE");
    expect(source).toContain("controls.zoomToCursor = true");
    expect(source).toContain("disposeObject3D(loaded)");
    expect(source).toContain('frameloop="demand"');
    expect(source).toContain('"webglcontextlost"');
    expect(source).toContain('canvas.removeEventListener("webglcontextlost", handler)');
    expect(source).toContain(
      "useSyncExternalStore(subscribeNever, probeWebgl, () => false)",
    );
    expect(source).not.toContain("onCreated");
    expect(source).toContain("{BODY_VIEW_LOST}");
    const loader = readFileSync(
      join(import.meta.dir, "anatomy", "load-atlas.ts"),
      "utf8",
    );
    expect(loader).toContain("setMeshoptDecoder");
    expect(loader).toContain("meshopt_decoder.module.js");
  });

  test("zoom buttons move the camera the right way and stop at the limits", () => {
    const camera = new PerspectiveCamera(40, 1, 0.01, 40);
    camera.position.set(0, -2, 1);
    const controls = new OrbitControls(camera);
    controls.target.set(0, 0, 1);
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.update();
    const distance = () => camera.position.distanceTo(controls.target);
    controls.dollyIn(ZOOM_STEP);
    expect(distance()).toBeCloseTo(1.6, 6);
    controls.dollyOut(ZOOM_STEP);
    controls.dollyOut(ZOOM_STEP);
    expect(distance()).toBeCloseTo(2.5, 6);
    for (let i = 0; i < 40; i += 1) controls.dollyIn(ZOOM_STEP);
    expect(distance()).toBeCloseTo(MIN_ZOOM_DISTANCE, 6);
    for (let i = 0; i < 40; i += 1) controls.dollyOut(ZOOM_STEP);
    expect(distance()).toBeCloseTo(MAX_ZOOM_DISTANCE, 6);
  });

  test("fitCameraToBox is Z-up with near/far from a copied PerspectiveCamera", () => {
    const camera = new PerspectiveCamera(40, 1, 0.01, 40);
    const box = new Box3(new Vector3(-0.5, -0.15, 0), new Vector3(0.56, 0.28, 1.89));
    const center = fitCameraToBox(camera, box);
    const size = box.getSize(new Vector3());
    const expected = box.getCenter(new Vector3());
    const span = Math.max(size.x, size.y, size.z, 0.5);
    expect(center.x).toBeCloseTo(expected.x);
    expect(camera.up.equals(new Vector3(0, 0, 1))).toBe(true);
    expect(camera.position.x).toBeCloseTo(expected.x);
    expect(camera.position.y).toBeCloseTo(expected.y - span * 1.8);
    expect(camera.position.z).toBeCloseTo(expected.z + size.z * 0.05);
    expect(camera.near).toBeCloseTo(span / 80);
    expect(camera.far).toBeCloseTo(span * 20);
  });

  test("lighting and auto-rotate pacing are wired for the Z-up scene", () => {
    const source = readFileSync(join(import.meta.dir, "bodyloop-avatar.tsx"), "utf8");
    expect(source).toContain(
      "Object.assign(scene.environmentRotation, { x: Math.PI / 2, y: 0, z: 0 })",
    );
    expect(source).toContain("position={[0, 0, 1]}");
    expect(source).toContain("<FloorPool object={scene} dark={dark} />");
    expect(source).toContain("new IntersectionObserver(");
    expect(source).toContain("nextAutoRotateDelay(");
    expect(source).toContain("controls.update(Math.min(delta, MAX_ROTATE_DELTA_S))");
  });

  test("scan textures are prepared in the load callback before the scan joins the scene", () => {
    const source = readFileSync(join(import.meta.dir, "bodyloop-avatar.tsx"), "utf8");
    const textures = source.indexOf("prepareScanTextures(gltf.scene");
    const joins = source.indexOf("setScene(gltf.scene)");
    expect(textures).toBeGreaterThan(-1);
    expect(joins).toBeGreaterThan(textures);
    expect(source.indexOf("loader.load(")).toBeLessThan(textures);
  });

  test("BodyLoop helper nodes are hidden, Analysis_Spine included", () => {
    expect([...HIDDEN_NODE_NAMES]).toEqual([
      "AutoMarkers",
      "PalpationMarkers",
      "Analysis_Spine",
    ]);
    const root = new Group();
    const named = (name: string) => Object.assign(new Object3D(), { name });
    const spine = named("Analysis_Spine");
    const markers = named("AutoMarkers");
    const body = named("Body");
    const nested = new Group();
    nested.add(spine);
    root.add(nested, markers, body);
    hideOverlayNodes(root);
    expect([spine.visible, markers.visible, body.visible, nested.visible]).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  test("stature comes from body.height in metres, else null", () => {
    expect(snapshotStature([{ path: "body.height", value: 1.74, unit: "m" }])).toBe(1.74);
    expect(snapshotStature([{ path: "body.mass", value: 68, unit: "kg" }])).toBeNull();
    expect(snapshotStature([{ path: "body.height", value: 174, unit: "cm" }])).toBeNull();
    expect(snapshotStature([{ path: "body.height", value: 0, unit: "m" }])).toBeNull();
    expect(snapshotStature([])).toBeNull();
  });

  test("the demo error belongs to the failed URL only", () => {
    expect(
      demoErrorShown("/api/anatomy/demo/anny-adult-m", "/api/anatomy/demo/anny-adult-m"),
    ).toBe(true);
    // a later success clears the failed URL back to null
    expect(demoErrorShown(null, "/api/anatomy/demo/anny-adult-m")).toBe(false);
    expect(
      demoErrorShown("/api/anatomy/demo/anny-adult-f", "/api/anatomy/demo/anny-adult-m"),
    ).toBe(false);
  });

  test("first paint while subjects load is a neutral loading line", () => {
    expect(BODY_TWIN_LOADING).toBe("Loading body twin…");
    const markup = renderToStaticMarkup(createElement(BodyLoopAvatar, {}));
    expect(markup).toContain(BODY_TWIN_LOADING);
    expect(markup).not.toContain(NO_SUBJECTS_LINE);
  });

  test("with no BodyLoop subjects the Demo picker is enough: no extra line", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        preview: { subjects: [] },
      }),
    );
    expect(markup).not.toContain(NO_SUBJECTS_LINE);
  });

  test("OrbitControls mounts under the WebGL guard", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        forceFallback: true,
        preview: {
          subjects: [{ id: "sub-self", label: "Self", isSelf: true }],
          scans: [{ viatarId: 1, crtime: "2026-07-10T12:00:00.000Z" }],
          snapshots: [
            {
              id: "snap-1",
              viatarId: 1,
              hasAvatar: true,
              properties: [{ path: "body.height", value: 1.7, unit: "m" }],
            },
          ],
          selectedSubjectId: "sub-self",
          selectedViatarId: 1,
        },
      }),
    );
    expect(markup).toContain("Scan mesh needs WebGL");
    expect(markup).not.toContain("data-engine");
    // The view toolbar comes with the canvas; without WebGL there is nothing to steer.
    expect(markup).not.toContain('aria-label="3D view"');
    expect(markup).not.toContain("Reset view");
    expect(markup).not.toContain("Pause");
    expect(markup).toContain("Scan overlays");
    expect(markup).toContain("not a name");
  });

  test("the View fieldset ends with a legend of the overlay colours", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        forceFallback: true,
        preview: {
          subjects: [{ id: "sub-synthetic", label: "Synthetic", isSelf: false }],
          scans: [{ viatarId: 1, crtime: "2026-07-10T12:00:00.000Z" }],
          snapshots: [{ id: "snap-1", viatarId: 1, hasAvatar: true, properties: [] }],
          selectedSubjectId: "sub-synthetic",
          selectedViatarId: 1,
        },
      }),
    );
    const fieldset = markup.slice(
      markup.indexOf("<fieldset"),
      markup.indexOf("</fieldset>"),
    );
    const swatch = (color: string, label: string) =>
      '<li class="text-foreground flex items-center gap-1.5 text-xs">' +
      `<span class="size-2 rounded-full bg-current ring-border ring-1" style="color:${color}" aria-hidden="true"></span>${label}</li>`;
    expect(fieldset).toContain('<ul class="flex flex-wrap gap-4 mt-2 gap-y-1">');
    expect(fieldset).toContain(swatch("#8ec5ff", "Markers · Auto"));
    expect(fieldset).toContain(swatch("#d4a5ff", "Angles"));
    expect(fieldset.split('style="color:').length - 1).toBe(7);
    expect(fieldset.indexOf('type="checkbox"')).toBeLessThan(
      fieldset.indexOf('<ul class="flex flex-wrap gap-4 mt-2 gap-y-1">'),
    );
  });

  test("no scans empty state", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        preview: {
          subjects: [{ id: "sub-self", label: "Self", isSelf: true }],
          scans: [],
          selectedSubjectId: "sub-self",
        },
      }),
    );
    expect(markup).toContain(BODYLOOP_NO_SCANS);
  });

  test("Self with no scans still gets the Biomarkers tab with the catalogue", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        preview: {
          subjects: [{ id: "sub-self", label: "Self", isSelf: true }],
          scans: [],
          selectedSubjectId: "sub-self",
        },
      }),
    );
    expect(markup).toContain(BODYLOOP_NO_SCANS);
    expect(markup).toContain(">Biomarkers</button>");
    expect(markup).toContain('aria-selected="true" aria-controls="radix-');
    expect(markup).toContain(SELF_NO_LABS);
    expect(markup).toContain(">Gamma-GT (GGT)</span>");
    expect(markup.indexOf(BODYLOOP_NO_SCANS)).toBeLessThan(
      markup.indexOf(">Biomarkers<"),
    );
  });

  test("scan list includes unsynced rows", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        preview: {
          subjects: [{ id: "sub-self", label: "Self", isSelf: true }],
          scans: [
            { viatarId: 1, crtime: "2026-07-10T12:00:00.000Z", synced: true },
            {
              viatarId: 2,
              crtime: "2026-07-11T12:00:00.000Z",
              synced: false,
              presetName: "Marker Only",
            },
          ],
          snapshots: [
            {
              id: "snap-1",
              viatarId: 1,
              hasAvatar: false,
              properties: [],
            },
          ],
          selectedSubjectId: "sub-self",
          selectedViatarId: 2,
        },
      }),
    );
    expect(markup).toContain("not synced");
    expect(markup).toContain("Marker Only");
    expect(markup).toContain("scan 2");
  });

  test("incomplete scanner snapshots say Sync again and show the no-mesh copy", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        preview: {
          subjects: [{ id: "sub-self", label: "Self", isSelf: true, source: "scanner" }],
          scans: [{ viatarId: 2, crtime: "2026-07-11T12:00:00.000Z", synced: true }],
          snapshots: [
            {
              id: "snap-stale",
              viatarId: 2,
              hasAvatar: false,
              properties: [],
              markers: null,
            },
          ],
          selectedSubjectId: "sub-self",
          selectedViatarId: 2,
        },
      }),
    );
    expect(markup).toContain(SCAN_SYNC_AGAIN);
    expect(markup).toContain(BODYLOOP_NO_MESH);
    expect(markup).not.toContain("data-engine");
  });

  test("file-only snapshot appears in the scan list when live viatars are empty", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        preview: {
          subjects: [{ id: "sub-file", label: "Export", isSelf: false }],
          scans: [],
          snapshots: [
            {
              id: "snap-file",
              viatarId: 11,
              hasAvatar: true,
              properties: [],
            },
          ],
          selectedSubjectId: "sub-file",
          selectedViatarId: 11,
        },
      }),
    );
    expect(markup).not.toContain(BODYLOOP_NO_SCANS);
    expect(markup).toContain("scan 11");
    expect(markup).toContain("synced");
  });

  test("pinned default scan opens first and offers Clear default", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, { forceFallback: true, preview: syncedPreview(22) }),
    );
    expect(markup).toContain('<option value="22" selected="">');
    expect(markup).toContain("scan 22 · synced · default");
    expect(markup).toContain(SCAN_CLEAR_DEFAULT);
    expect(markup).not.toContain(SCAN_SET_DEFAULT);
  });

  test("without a pin the newest synced scan opens and offers Set as default", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        forceFallback: true,
        preview: syncedPreview(null),
      }),
    );
    expect(markup).toContain('<option value="28" selected="">');
    expect(markup).not.toContain("· default");
    expect(markup).toContain(SCAN_SET_DEFAULT);
  });

  test("synced scans list before unsynced ones, newest first", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        forceFallback: true,
        preview: syncedPreview(null),
      }),
    );
    const at = (id: number) => markup.indexOf(`<option value="${id}"`);
    expect(at(28)).toBeLessThan(at(27));
    expect(at(23)).toBeLessThan(at(22));
    expect(at(22)).toBeLessThan(at(30));
  });

  test("properties render in the body panel without a canvas, through the formatter", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        preview: {
          subjects: [{ id: "sub-self", label: "Self", isSelf: true }],
          scans: [{ viatarId: 1, crtime: "2026-07-10T12:00:00.000Z" }],
          snapshots: [
            {
              id: "snap-1",
              viatarId: 1,
              hasAvatar: false,
              properties: [
                { path: "body.height", value: 1.7, unit: "m" },
                { path: "body.volume", value: 0.065, unit: "m3" },
              ],
            },
          ],
          selectedSubjectId: "sub-self",
          selectedViatarId: 1,
        },
      }),
    );
    const row = (label: string, value: string) =>
      '<li class="flex justify-between gap-2 px-2.5 py-1">' +
      `<span class="min-w-0 truncate">${label}</span>` +
      `<span class="shrink-0 tabular-nums">${value}</span></li>`;
    expect(markup).toContain(`aria-label="${BODY_PANEL_LABEL}"`);
    expect(markup).toContain(row("Height", "1.70 m"));
    expect(markup).toContain(row("Body volume", "0.07 m³"));
    expect(markup).not.toContain("1.7 m<");
  });

  test("with no subjects the demo subject still renders, labelled synthetic and credited", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, { forceFallback: true, preview: { subjects: [] } }),
    );
    expect(markup).not.toContain(NO_SUBJECTS_LINE);
    expect(markup).toContain(
      `<option value="demo" selected="">${DEMO_SUBJECT_LABEL}</option>`,
    );
    expect(markup).toContain(
      '<option value="male" selected="">Male · ANNY adult · 1.91 m</option>',
    );
    expect(markup).toContain(
      '<option value="female">Female · ANNY adult · 1.77 m</option>',
    );
    expect(markup).toContain(DEMO_BODY_NOTE);
    expect(markup).toContain(DEMO_BODIES["anny-adult-m"].attribution);
    expect(markup).toContain('href="https://arxiv.org/abs/2511.03589"');
    expect(markup).toContain(DEMO_NEEDS_WEBGL);
    expect(markup).not.toContain(`aria-label="${BODY_PANEL_LABEL}"`);
    expect(markup).not.toContain("Reset view");
    expect(markup).not.toContain("Sync this scan");
    expect(markup).not.toContain("Label is");
  });

  test("Self stays the default and the demo is listed after it", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, { forceFallback: true, preview: syncedPreview(22) }),
    );
    expect(markup).toContain('<option value="sub-self" selected="">Self (self)</option>');
    expect(markup.indexOf('value="sub-self"')).toBeLessThan(
      markup.indexOf('value="demo"'),
    );
    expect(markup).not.toContain(DEMO_BODY_NOTE);
    expect(markup).not.toContain("ANNY");
  });

  test("choosing the demo subject in a preview shows the demo, not the scans", () => {
    const markup = renderToStaticMarkup(
      createElement(BodyLoopAvatar, {
        forceFallback: true,
        preview: { ...syncedPreview(22), selectedSubjectId: "demo" },
      }),
    );
    expect(markup).toContain(
      `<option value="demo" selected="">${DEMO_SUBJECT_LABEL}</option>`,
    );
    expect(markup).toContain(DEMO_BODY_NOTE);
    expect(markup).not.toContain("scan 22");
    expect(markup).not.toContain(SCAN_CLEAR_DEFAULT);
  });

  test("each picker's label points at its own select", () => {
    /** Label text → whether its `for` matches the select right after it. */
    const pickers = (markup: string) =>
      [
        ...markup.matchAll(
          /<label for="([^"]+)"[^>]*>([^<]+)<\/label><select id="([^"]+)"/g,
        ),
      ].map(([, labelFor, text, selectId]) => [text, labelFor === selectId]);
    const scan = renderToStaticMarkup(
      createElement(BodyLoopAvatar, { forceFallback: true, preview: syncedPreview(22) }),
    );
    const demo = renderToStaticMarkup(
      createElement(BodyLoopAvatar, { forceFallback: true, preview: { subjects: [] } }),
    );
    expect(pickers(scan)).toEqual([
      ["Subject", true],
      ["Scan", true],
    ]);
    expect(pickers(demo)).toEqual([
      ["Subject", true],
      ["Body", true],
    ]);
  });
});
