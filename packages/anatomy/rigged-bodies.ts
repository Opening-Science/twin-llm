import { type DemoBodyId } from "./demo-bodies";

/**
 * Rigged variants of the demo bodies: the same ANNY shapes with ANNY's own
 * 104-bone skeleton and skin weights, so the body can walk. They are not
 * downloaded: `bun run anatomy:bake-rigged` bakes them locally from the pinned
 * `anny` Python package (scripts/anatomy/bake-anny-rigged.py) and installs a
 * file only when its bytes match the pin below. Like the static bodies they
 * are never committed. When a rigged file is installed the viewer shows it in
 * place of the static one; otherwise the static body shows and cannot walk.
 *
 * Frame: the atlas frame (metres, +Y up, faces +Z, feet at y=0), like the
 * static bodies. Plain glTF: positions, joints, weights, no normals.
 */
export type RiggedBodyEntry = Readonly<{
  /** The static demo body this rigs; heights and phenotypes match it. */
  id: DemoBodyId;
  fileName: string;
  bytes: number;
  sha256: string;
  /** The `bake-anny-rigged.py` argument. */
  sex: "male" | "female";
  joints: number;
  triangles: number;
}>;

/** The credit shown with a rigged body: same model and licences, our bake. */
export const RIGGED_ATTRIBUTION =
  "ANNY, a free-to-use 3D human parametric model for all ages — NAVER LABS Europe / NAVER Corporation. Apache-2.0 code over CC0 shape assets derived from MakeHuman. Cite arXiv:2511.03589. Baked with its skeleton by this repository; no scan of any person was used.";

export const RIGGED_BODIES: Readonly<Record<DemoBodyId, RiggedBodyEntry>> = Object.freeze(
  {
    "anny-adult-m": {
      id: "anny-adult-m",
      fileName: "anny-adult-m.rigged.glb",
      bytes: 464_852,
      sha256: "16d101090af7719069cd78d0a091d7d9c4975bc45df44201f23761ea89553589",
      sex: "male",
      joints: 104,
      triangles: 27_420,
    },
    "anny-adult-f": {
      id: "anny-adult-f",
      fileName: "anny-adult-f.rigged.glb",
      bytes: 464_816,
      sha256: "9032bfeb29ba4be8aeb0eb38a81e72c5dd5420a38005913d907c83c4f87fdbe1",
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
