/**
 * What a rigged demo body is, apart from how this machine's floats encoded it.
 *
 * The bake rounds every value before writing it (positions to 10 µm, bone
 * translations to 1e-6, quaternions to 1e-7, weights to 1/255), but two things
 * still follow the platform's float maths: the sign of a zero (a midline
 * vertex at -1e-17 on one machine and +1e-17 on another) and the last bits of
 * a renormalised quaternion. Neither changes the body. This module reads a
 * rigged GLB back onto those grids as integers, so two bakes that differ only
 * there give the same bytes here, and the SHA-256 of those bytes is pinned as
 * `contentSha256` next to the file's own SHA-256.
 *
 * Covered: positions, joints, weights, triangle indices, bone names,
 * hierarchy, rest translations and rotations, skin joint order. Left out:
 * inverse bind matrices and the position bounds, which are derived from the
 * covered values, and the asset text. Pure; returns null for a file that is
 * not a rigged body as bake-anny-rigged.py writes it.
 */
import { z } from "zod";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;

const accessorSchema = z.object({
  bufferView: z.number().int().nonnegative(),
  componentType: z.number().int(),
  count: z.number().int().nonnegative(),
  type: z.string(),
});

const gltfSchema = z.object({
  accessors: z.array(accessorSchema),
  bufferViews: z.array(
    z.object({
      byteOffset: z.number().int().nonnegative().optional(),
      byteLength: z.number().int().nonnegative(),
    }),
  ),
  nodes: z.array(
    z.object({
      name: z.string().optional(),
      children: z.array(z.number().int()).optional(),
      translation: z.array(z.number()).length(3).optional(),
      rotation: z.array(z.number()).length(4).optional(),
    }),
  ),
  skins: z.array(z.object({ joints: z.array(z.number().int()) })).length(1),
  meshes: z
    .array(
      z.object({
        primitives: z
          .array(
            z.object({
              attributes: z.object({
                POSITION: z.number().int(),
                JOINTS_0: z.number().int(),
                WEIGHTS_0: z.number().int(),
              }),
              indices: z.number().int(),
            }),
          )
          .length(1),
      }),
    )
    .length(1),
});

type Gltf = z.infer<typeof gltfSchema>;

const COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/** Rounds onto a grid of `1 / perUnit`, as an integer; -0 comes out as 0. */
const onGrid = (value: number, perUnit: number): number =>
  Math.round(value * perUnit) + 0;

/** A quaternion on the 1e-7 grid with one sign: w > 0, or the first non-zero part > 0. */
export const canonicalQuaternion = (q: readonly number[]): readonly number[] => {
  const ints = q.map((value) => onGrid(value, 1e7));
  const [x = 0, y = 0, z = 0, w = 0] = ints;
  const lead = [w, x, y, z].find((value) => value !== 0) ?? 0;
  return lead < 0 ? ints.map((value) => 0 - value) : ints;
};

type Chunks = Readonly<{ json: unknown; bin: Uint8Array }>;

const readChunks = (glb: Uint8Array): Chunks | null => {
  if (glb.byteLength < 28) return null;
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) return null;
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength + 8 > glb.byteLength)
    return null;
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  if (
    view.getUint32(binStart + 4, true) !== CHUNK_BIN ||
    binStart + 8 + binLength > glb.byteLength
  )
    return null;
  try {
    return {
      json: JSON.parse(new TextDecoder().decode(glb.subarray(20, binStart))),
      bin: glb.subarray(binStart + 8, binStart + 8 + binLength),
    };
  } catch {
    return null;
  }
};

/** The bytes of one accessor, checked against its declared type; null when they do not fit. */
const accessorBytes = (
  gltf: Gltf,
  bin: Uint8Array,
  index: number,
  componentType: number,
  componentBytes: number,
): Readonly<{ bytes: Uint8Array; values: number }> | null => {
  const accessor = gltf.accessors[index];
  const components = accessor ? COMPONENTS[accessor.type] : undefined;
  if (!accessor || components === undefined || accessor.componentType !== componentType)
    return null;
  const bufferView = gltf.bufferViews[accessor.bufferView];
  if (!bufferView) return null;
  const values = accessor.count * components;
  const start = bufferView.byteOffset ?? 0;
  const length = values * componentBytes;
  if (length > bufferView.byteLength || start + length > bin.byteLength) return null;
  return { bytes: bin.subarray(start, start + length), values };
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + 4 + part.byteLength, 0));
  const view = new DataView(out.buffer);
  parts.reduce((offset, part) => {
    view.setUint32(offset, part.byteLength, true);
    out.set(part, offset + 4);
    return offset + 4 + part.byteLength;
  }, 0);
  return out;
};

/** The canonical content of a rigged GLB (hash it for `contentSha256`), or null. */
export const riggedCanonicalContent = (glb: Uint8Array): Uint8Array | null => {
  const chunks = readChunks(glb);
  if (chunks === null) return null;
  const parsed = gltfSchema.safeParse(chunks.json);
  if (!parsed.success) return null;
  const gltf = parsed.data;
  const [mesh] = gltf.meshes;
  const [primitive] = mesh?.primitives ?? [];
  if (!primitive) return null;

  const positions = accessorBytes(
    gltf,
    chunks.bin,
    primitive.attributes.POSITION,
    FLOAT,
    4,
  );
  const joints = accessorBytes(
    gltf,
    chunks.bin,
    primitive.attributes.JOINTS_0,
    UNSIGNED_BYTE,
    1,
  );
  const weights = accessorBytes(
    gltf,
    chunks.bin,
    primitive.attributes.WEIGHTS_0,
    UNSIGNED_BYTE,
    1,
  );
  const indices = accessorBytes(gltf, chunks.bin, primitive.indices, UNSIGNED_SHORT, 2);
  if (!positions || !joints || !weights || !indices) return null;

  const floats = new DataView(
    positions.bytes.buffer,
    positions.bytes.byteOffset,
    positions.bytes.byteLength,
  );
  const gridPositions = new Int32Array(positions.values);
  for (let i = 0; i < positions.values; i += 1) {
    gridPositions[i] = onGrid(floats.getFloat32(i * 4, true), 1e5);
  }
  const littleEndian = new Uint8Array(gridPositions.byteLength);
  const out = new DataView(littleEndian.buffer);
  gridPositions.forEach((value, i) => out.setInt32(i * 4, value, true));

  const skeleton = JSON.stringify({
    nodes: gltf.nodes.map((node) => ({
      name: node.name ?? "",
      children: node.children ?? [],
      translation: (node.translation ?? [0, 0, 0]).map((value) => onGrid(value, 1e6)),
      rotation: canonicalQuaternion(node.rotation ?? [0, 0, 0, 1]),
    })),
    skinJoints: gltf.skins[0]?.joints ?? [],
  });

  return concat([
    new TextEncoder().encode(skeleton),
    littleEndian,
    joints.bytes,
    weights.bytes,
    indices.bytes,
  ]);
};
