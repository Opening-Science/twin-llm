import { type DemoBodyId } from "./demo-bodies";

/**
 * Rigged variants of the demo bodies: the same ANNY shapes with ANNY's own
 * 104-bone skeleton and skin weights, so the body can walk. `bun run
 * anatomy:fetch` downloads them from the `anatomy-rigged-v1` release of this
 * repository and installs a file only when its bytes match the pin below. The
 * release files are this repository's bake (scripts/anatomy/bake-anny-rigged.py
 * on Linux x86_64); `bun run anatomy:bake-rigged` bakes them locally instead,
 * the fallback, with the same byte check. Like the static bodies they are never
 * committed. When a rigged file is installed the viewer shows it in place of
 * the static one; otherwise the static body shows and cannot walk.
 *
 * Frame: the atlas frame (metres, +Y up, faces +Z, feet at y=0), like the
 * static bodies. Plain glTF: positions, joints, weights, no normals.
 */
export type RiggedBodyEntry = Readonly<{
  /** The static demo body this rigs; heights and phenotypes match it. */
  id: DemoBodyId;
  /** Shown by the fetch and bake scripts. */
  name: string;
  /** The release asset; GitHub answers with a redirect to its asset host. */
  url: string;
  fileName: string;
  bytes: number;
  sha256: string;
  /**
   * SHA-256 of the body's content at the precision it is written with (see
   * scripts/anatomy/rigged-content-digest.ts): positions, joints, weights,
   * triangles and the skeleton, but not the sign of a zero or the last bits
   * of a float. A local bake whose bytes differ but whose digest matches is
   * the same body encoded slightly differently by this machine's float maths.
   */
  contentSha256: string;
  /** The `bake-anny-rigged.py` argument. */
  sex: "male" | "female";
  joints: number;
  triangles: number;
}>;

/** The credit shown with a rigged body: same model and licences, our bake. */
export const RIGGED_ATTRIBUTION =
  "ANNY, a free-to-use 3D human parametric model for all ages — NAVER LABS Europe / NAVER Corporation. Apache-2.0 code over CC0 shape assets derived from MakeHuman. Cite arXiv:2511.03589. Baked with its skeleton by this repository; no scan of any person was used.";

/** The GitHub release that carries the pinned rigged bodies as assets. */
export const RIGGED_RELEASE_TAG = "anatomy-rigged-v1";

const RIGGED_RELEASE_BASE = `https://github.com/Opening-Science/twin-llm/releases/download/${RIGGED_RELEASE_TAG}`;

/**
 * Hosts a release download may redirect to. GitHub sends release assets from
 * github.com to its asset host; anything else is refused.
 */
export const RIGGED_RELEASE_HOSTS: readonly string[] = [
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
];

export const RIGGED_BODIES: Readonly<Record<DemoBodyId, RiggedBodyEntry>> = Object.freeze(
  {
    "anny-adult-m": {
      id: "anny-adult-m",
      name: "ANNY adult (male), rigged",
      url: `${RIGGED_RELEASE_BASE}/anny-adult-m.rigged.glb`,
      fileName: "anny-adult-m.rigged.glb",
      bytes: 464_852,
      sha256: "16d101090af7719069cd78d0a091d7d9c4975bc45df44201f23761ea89553589",
      contentSha256: "5231a8dbb70cb5ca679cfc963fba8407f829b6c8f73093f52b0c5a5b452f859c",
      sex: "male",
      joints: 104,
      triangles: 27_420,
    },
    "anny-adult-f": {
      id: "anny-adult-f",
      name: "ANNY adult (female), rigged",
      url: `${RIGGED_RELEASE_BASE}/anny-adult-f.rigged.glb`,
      fileName: "anny-adult-f.rigged.glb",
      bytes: 464_816,
      sha256: "9032bfeb29ba4be8aeb0eb38a81e72c5dd5420a38005913d907c83c4f87fdbe1",
      contentSha256: "808a7ffa5afe7d900359c3fc6dd8b3e90a396d7e883ec58ab8e581b2a19f0b28",
      sex: "female",
      joints: 104,
      triangles: 27_420,
    },
  },
);

/** A short, stable cache key: changes exactly when the pinned bytes change. */
export const riggedBodyVersion = (id: DemoBodyId): string =>
  RIGGED_BODIES[id].sha256.slice(0, 16);

/** Same-origin URL the viewer loads when the rigged body is installed. */
export const riggedBodyApiUrl = (id: DemoBodyId): string =>
  `/api/anatomy/rigged/${id}?v=${riggedBodyVersion(id)}`;
