/**
 * The synthetic demo bodies TwinLLM can fetch, pinned by size and SHA-256.
 *
 * open-twin-xr bakes ANNY (NAVER LABS Europe's parametric human model) into
 * static meshes posed for BodyParts3D. No scan of any person was used, so these
 * are what 3D work is developed and screenshotted against. Like the atlases they
 * are never committed: `bun run anatomy:fetch` downloads them into the gitignored
 * anatomy data dir and refuses any byte that does not match the pin.
 *
 * Frame, measured on these exact files (docs/anatomy.md): metres, +Y up, faces
 * +Z, feet at y=0 — the atlas frame, so the same rotation puts them in the scan
 * frame. They ship without normals, material or skeleton.
 */
export const DEMO_BODY_IDS = ["anny-adult-m", "anny-adult-f"] as const;

export type DemoBodyId = (typeof DEMO_BODY_IDS)[number];

export type DemoBodyEntry = Readonly<{
  id: DemoBodyId;
  /** Product name for logs and credits. */
  name: string;
  sex: "male" | "female";
  url: string;
  fileName: string;
  bytes: number;
  sha256: string;
  triangles: number;
  /** Measured standing height in metres. */
  heightM: number;
  /** The licence condition, verbatim from open-twin-xr's licences.json. */
  attribution: string;
}>;

export const ANNY_CODE_LICENCE_URL = "https://www.apache.org/licenses/LICENSE-2.0";
export const ANNY_SHAPE_LICENCE_URL =
  "https://creativecommons.org/publicdomain/zero/1.0/";
export const ANNY_PAPER_URL = "https://arxiv.org/abs/2511.03589";

const ANNY_ATTRIBUTION =
  "ANNY, a free-to-use 3D human parametric model for all ages — NAVER LABS Europe / NAVER Corporation. Apache-2.0 code over CC0 shape assets derived from MakeHuman. Cite arXiv:2511.03589. Baked to static geometry by this repository; no scan of any person was used.";
const MODELS_URL = "https://opentwin.opening.science/models";

export const DEMO_BODIES: Readonly<Record<DemoBodyId, DemoBodyEntry>> = Object.freeze({
  "anny-adult-m": {
    id: "anny-adult-m",
    name: "ANNY adult (male)",
    sex: "male",
    url: `${MODELS_URL}/anny-adult-m.pose-bodyparts3d.glb`,
    fileName: "anny-adult-m.pose-bodyparts3d.glb",
    bytes: 108_908,
    sha256: "c1723196c2075a7cfb26e4ca6311119c098e031d88ba5c2ba05b5f40cfe9de2b",
    triangles: 27_420,
    heightM: 1.914,
    attribution: ANNY_ATTRIBUTION,
  },
  "anny-adult-f": {
    id: "anny-adult-f",
    name: "ANNY adult (female)",
    sex: "female",
    url: `${MODELS_URL}/anny-adult-f.pose-bodyparts3d.glb`,
    fileName: "anny-adult-f.pose-bodyparts3d.glb",
    bytes: 110_004,
    sha256: "72947c1fdcfc8df272f511989d587f04a2fd2d9a3a35d675a3e8bc0aaf75e190",
    triangles: 27_420,
    heightM: 1.772,
    attribution: ANNY_ATTRIBUTION,
  },
});

export const isDemoBodyId = (value: unknown): value is DemoBodyId =>
  typeof value === "string" && (DEMO_BODY_IDS as readonly string[]).includes(value);

/** The demo body for a sex choice in the viewer. */
export const demoBodyIdFor = (sex: "male" | "female"): DemoBodyId =>
  sex === "male" ? "anny-adult-m" : "anny-adult-f";

/** A short, stable cache key: changes exactly when the pinned bytes change. */
export const demoBodyVersion = (id: DemoBodyId): string =>
  DEMO_BODIES[id].sha256.slice(0, 16);

/** Same-origin URL the viewer loads; `?v=` lets the route cache it forever. */
export const demoBodyApiUrl = (id: DemoBodyId): string =>
  `/api/anatomy/demo/${id}?v=${demoBodyVersion(id)}`;
