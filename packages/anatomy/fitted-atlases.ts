import { DEMO_BODY_IDS, isDemoBodyId, type DemoBodyId } from "./demo-bodies";
import { ATLAS_IDS, isAtlasId, type AtlasId } from "./manifest";

/**
 * The atlases refitted limb by limb to each rigged demo body (#525), pinned
 * by size and SHA-256 like the atlases and rigged bodies.
 *
 * They are made on this machine, never downloaded: `bun run blender:fit-atlas`
 * turns each atlas's thighs and shins (and arms where it has arm bones)
 * toward the rigged ANNY body's knees and ankles, keeping bone lengths, and
 * `bun run anatomy:quantise-fitted` stores Blender's float positions as
 * quantised integers, as the pinned atlases are. A file is installed only
 * when its bytes match the pin, so a different Blender or encoder never shows
 * silently. They are derivatives of the CC BY 4.0 atlases and are never
 * committed.
 *
 * Frame: the rigged body's own frame (metres, +Y up, faces +Z, feet at y=0),
 * fitted at its bind pose; the viewer places the file with the body's own
 * transform and stands the body unposed.
 */
export type FittedAtlasEntry = Readonly<{
  bodyId: DemoBodyId;
  atlasId: AtlasId;
  /** The file the app serves, inside the anatomy dir's `fitted/`. */
  fileName: string;
  bytes: number;
  sha256: string;
  /** Blender's output, the quantise step's input. */
  sourceFileName: string;
  sourceBytes: number;
  sourceSha256: string;
}>;

/** `<body>.<atlas>`: one closed-list id per pair, for the route and the status. */
export type FittedAtlasId = `${DemoBodyId}.${AtlasId}`;

export const fittedAtlasId = (bodyId: DemoBodyId, atlasId: AtlasId): FittedAtlasId =>
  `${bodyId}.${atlasId}`;

export const FITTED_ATLAS_IDS: readonly FittedAtlasId[] = DEMO_BODY_IDS.flatMap((body) =>
  ATLAS_IDS.map((atlas) => fittedAtlasId(body, atlas)),
);

export const isFittedAtlasId = (value: unknown): value is FittedAtlasId =>
  typeof value === "string" && (FITTED_ATLAS_IDS as readonly string[]).includes(value);

/** The body and atlas of a closed-list id. */
export const splitFittedAtlasId = (
  id: FittedAtlasId,
): Readonly<{ bodyId: DemoBodyId; atlasId: AtlasId }> => {
  const dot = id.indexOf(".");
  const bodyId = id.slice(0, dot);
  const atlasId = id.slice(dot + 1);
  if (!isDemoBodyId(bodyId) || !isAtlasId(atlasId)) {
    throw new Error(`Not a fitted atlas id: ${id}`);
  }
  return { bodyId, atlasId };
};

type Pin = Readonly<{ bytes: number; sha256: string }>;

const entry = (
  bodyId: DemoBodyId,
  atlasId: AtlasId,
  quantised: Pin,
  source: Pin,
): FittedAtlasEntry => ({
  bodyId,
  atlasId,
  fileName: `${bodyId}.${atlasId}.fitted.quantised.glb`,
  bytes: quantised.bytes,
  sha256: quantised.sha256,
  sourceFileName: `${bodyId}.${atlasId}.fitted.glb`,
  sourceBytes: source.bytes,
  sourceSha256: source.sha256,
});

export const FITTED_ATLASES: Readonly<
  Record<DemoBodyId, Readonly<Record<AtlasId, FittedAtlasEntry>>>
> = Object.freeze({
  "anny-adult-m": {
    bodyparts3d: entry(
      "anny-adult-m",
      "bodyparts3d",
      {
        bytes: 9_726_548,
        sha256: "65e803e0097fb977b7b089dd362e54a2168cfa79d8347ead2248de649d7368b7",
      },
      {
        bytes: 15_936_512,
        sha256: "81e75dcc8401850f1f5520f1483f444d99a434d0718921b5483e9cd51e4a9eb8",
      },
    ),
    "hra-f": entry(
      "anny-adult-m",
      "hra-f",
      {
        bytes: 13_597_576,
        sha256: "bc758cc2a933bcb05127264fb559cb935039e0e6dae082db82105f58af3a79ee",
      },
      {
        bytes: 23_559_348,
        sha256: "fa9c9f384948b1130b0ed8c7a29f0213bea8a58c46ff9f7867e1b25f177d9250",
      },
    ),
    "hra-m": entry(
      "anny-adult-m",
      "hra-m",
      {
        bytes: 7_630_324,
        sha256: "f16bfdbea9e8ad88ebd236802732b4fd6a8f81f992eb3fb2ac970e5ff5d2be86",
      },
      {
        bytes: 12_284_868,
        sha256: "32007ba3d47a64c718ed630838b0f59146b280a24d19fdb72b6d80945b208e78",
      },
    ),
  },
  "anny-adult-f": {
    bodyparts3d: entry(
      "anny-adult-f",
      "bodyparts3d",
      {
        bytes: 9_690_896,
        sha256: "fc4174d8c1c6035e634d587cb11b6e374669dde7bfce73585d217fe5ef5f7b23",
      },
      {
        bytes: 15_920_240,
        sha256: "671c4f2ee858ab981f361791ec232f9c5bd3b39b846014f4abcf126ce54caa5b",
      },
    ),
    "hra-f": entry(
      "anny-adult-f",
      "hra-f",
      {
        bytes: 13_553_344,
        sha256: "0fd52020d138c6b466e62e1f15bfc27fbcb1da17eb20f5f6a148a231ba593839",
      },
      {
        bytes: 23_535_304,
        sha256: "17e2d99efa4f682638a8f4cd86c58b9438439c8170586158dc26d46fc01f5783",
      },
    ),
    "hra-m": entry(
      "anny-adult-f",
      "hra-m",
      {
        bytes: 7_491_840,
        sha256: "bc42a4a79fc872d2e2488882bed0ad48ef1008fc4e2f681f9e5a35d10430b23e",
      },
      {
        bytes: 12_269_252,
        sha256: "07716f5a2617a6eff2f94798a9909edcd4d730c191a5a52573ff2bd5b29dfb88",
      },
    ),
  },
});

export const fittedAtlasEntry = (id: FittedAtlasId): FittedAtlasEntry => {
  const { bodyId, atlasId } = splitFittedAtlasId(id);
  return FITTED_ATLASES[bodyId][atlasId];
};

/** A short, stable cache key: changes exactly when the pinned bytes change. */
export const fittedAtlasVersion = (id: FittedAtlasId): string =>
  fittedAtlasEntry(id).sha256.slice(0, 16);

/** Same-origin URL the viewer loads when the fitted atlas is shown. */
export const fittedAtlasApiUrl = (bodyId: DemoBodyId, atlasId: AtlasId): string => {
  const id = fittedAtlasId(bodyId, atlasId);
  return `/api/anatomy/fitted/${id}?v=${fittedAtlasVersion(id)}`;
};
