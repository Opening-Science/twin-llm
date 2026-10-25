/**
 * The reference-anatomy atlases TwinLLM can fetch, pinned by size and SHA-256.
 *
 * The files are open-twin-xr's built assets (meshopt-compressed, AO-baked GLBs)
 * as served from the org's deployment. They are CC BY 4.0, separately licensed
 * from this code, and never committed: `bun run anatomy:fetch` downloads them
 * into the gitignored anatomy data dir and refuses any byte that does not match
 * the pin. Bumping a pin is a deliberate edit here plus a note in docs/anatomy.md.
 *
 * Frames were measured on these exact files (docs/anatomy.md): every atlas is
 * +Y up, faces +Z, with +X the subject's left, so one rotation fits all three.
 */
export const ATLAS_IDS = ["bodyparts3d", "hra-f", "hra-m"] as const;

export type AtlasId = (typeof ATLAS_IDS)[number];

export type AtlasScheme = "bodyparts3d" | "hra";

/** A horizontal point in the atlas's own frame: x across, z front-to-back, metres. */
export type HorizontalPoint = Readonly<{ x: number; z: number }>;

export type AtlasEntry = Readonly<{
  id: AtlasId;
  /** Product name for logs and credits, e.g. "BodyParts3D". */
  name: string;
  /** Which node classifier reads this file's extras. */
  scheme: AtlasScheme;
  donor: "male" | "female";
  url: string;
  fileName: string;
  bytes: number;
  sha256: string;
  triangles: number;
  licenceUrl: string;
  /** The licence condition, verbatim from open-twin-xr's ANATOMY_SOURCES. */
  attribution: string;
  /**
   * Where the hips sit, horizontally, in the atlas frame. BodyParts3D: midpoint
   * of the left and right hip-bone centroids. HRA: the pelvis node centre.
   */
  hipAnchor: HorizontalPoint;
  /** True only if an atlas were stored mirrored; none of the pinned ones is. */
  mirrorX: boolean;
}>;

const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/";
const HRA_ATTRIBUTION =
  "3D anatomical structures from the HuBMAP Human Reference Atlas (HRA), humanatlas.io, CC BY 4.0.";
const MODELS_URL = "https://opentwin.opening.science/models";

export const ATLASES: Readonly<Record<AtlasId, AtlasEntry>> = Object.freeze({
  bodyparts3d: {
    id: "bodyparts3d",
    name: "BodyParts3D",
    scheme: "bodyparts3d",
    donor: "male",
    url: `${MODELS_URL}/bodyparts3d.ao.glb`,
    fileName: "bodyparts3d.ao.glb",
    bytes: 10_333_316,
    sha256: "a65116b5ac9e33f37794e0f364bbf1375e29af3212a458caace107a983274855",
    triangles: 2_613_871,
    licenceUrl: CC_BY_4,
    attribution:
      "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.",
    hipAnchor: { x: 0, z: 0.0715 },
    mirrorX: false,
  },
  "hra-f": {
    id: "hra-f",
    name: "HuBMAP HRA (female donor)",
    scheme: "hra",
    donor: "female",
    url: `${MODELS_URL}/hra.ao.glb`,
    fileName: "hra.ao.glb",
    bytes: 15_388_344,
    sha256: "37468cf1180b0367a698d40eefd962df0b12a53c1ce74a29d8b70a8af5dc0eb1",
    triangles: 4_028_716,
    licenceUrl: CC_BY_4,
    attribution: HRA_ATTRIBUTION,
    hipAnchor: { x: -0.009, z: -0.091 },
    mirrorX: false,
  },
  "hra-m": {
    id: "hra-m",
    name: "HuBMAP HRA (male donor)",
    scheme: "hra",
    donor: "male",
    url: `${MODELS_URL}/hra-m.ao.glb`,
    fileName: "hra-m.ao.glb",
    bytes: 8_489_716,
    sha256: "5d820f289a529ef6ee6d2a1158c867d33f25dceaf269eebbbcd46f85b602addc",
    triangles: 2_062_715,
    licenceUrl: CC_BY_4,
    attribution: HRA_ATTRIBUTION,
    hipAnchor: { x: 0.005, z: -0.032 },
    mirrorX: false,
  },
});

export const DEFAULT_ATLAS_ID: AtlasId = "bodyparts3d";

export const isAtlasId = (value: unknown): value is AtlasId =>
  typeof value === "string" && (ATLAS_IDS as readonly string[]).includes(value);

/** A short, stable cache key: changes exactly when the pinned bytes change. */
export const atlasVersion = (id: AtlasId): string => ATLASES[id].sha256.slice(0, 16);

/** Same-origin URL the viewer loads; `?v=` lets the route cache it forever. */
export const atlasApiUrl = (id: AtlasId): string =>
  `/api/anatomy/atlas/${id}?v=${atlasVersion(id)}`;
