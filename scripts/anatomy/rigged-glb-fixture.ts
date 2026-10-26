/**
 * Test fixture: a tiny rigged body GLB laid out like bake-anny-rigged.py
 * writes one (positions, joints, weights, indices, a two-bone skeleton), so
 * the digest and the bake check can be tested without a Python run.
 */
export type Body = Readonly<{
  positions: readonly number[];
  joints: readonly number[];
  weights: readonly number[];
  indices: readonly number[];
  bones: readonly Readonly<{
    name: string;
    translation: readonly number[];
    rotation: readonly number[];
  }>[];
}>;

const pad4 = (bytes: Uint8Array, fill: number): Uint8Array => {
  const out = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4).fill(fill);
  out.set(bytes);
  return out;
};

/** A minimal rigged GLB laid out like bake-anny-rigged.py writes it. */
export const buildGlb = (body: Body): Uint8Array => {
  const count = body.positions.length / 3;
  const floats = new DataView(new ArrayBuffer(body.positions.length * 4));
  body.positions.forEach((value, i) => floats.setFloat32(i * 4, value, true));
  const shorts = new DataView(new ArrayBuffer(body.indices.length * 2));
  body.indices.forEach((value, i) => shorts.setUint16(i * 2, value, true));
  const blobs = [
    new Uint8Array(floats.buffer),
    Uint8Array.from(body.joints),
    Uint8Array.from(body.weights),
    new Uint8Array(shorts.buffer),
  ].map((blob) => pad4(blob, 0));
  const offsets = blobs.reduce<number[]>(
    (acc, blob, i) => [...acc, (acc[i] ?? 0) + blob.byteLength],
    [0],
  );
  const gltf = {
    asset: { version: "2.0" },
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3" },
      { bufferView: 1, componentType: 5121, count, type: "VEC4" },
      { bufferView: 2, componentType: 5121, normalized: true, count, type: "VEC4" },
      { bufferView: 3, componentType: 5123, count: body.indices.length, type: "SCALAR" },
    ],
    bufferViews: blobs.map((blob, i) => ({
      buffer: 0,
      byteOffset: offsets[i],
      byteLength: blob.byteLength,
    })),
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3 },
        ],
      },
    ],
    nodes: [
      { name: "AnnyBody", mesh: 0, skin: 0 },
      ...body.bones.map((bone) => ({ ...bone })),
    ],
    skins: [{ joints: body.bones.map((_, j) => 1 + j) }],
  };
  const json = pad4(new TextEncoder().encode(JSON.stringify(gltf)), 0x20);
  const bin = new Uint8Array(offsets.at(-1) ?? 0);
  blobs.forEach((blob, i) => bin.set(blob, offsets[i]));
  const out = new Uint8Array(12 + 8 + json.byteLength + 8 + bin.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, json.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  view.setUint32(20 + json.byteLength, bin.byteLength, true);
  view.setUint32(24 + json.byteLength, 0x004e4942, true);
  out.set(bin, 28 + json.byteLength);
  return out;
};

export const SPINE = {
  name: "spine01",
  translation: [0, 0.1, 0.000001],
  rotation: [0, 0, 0, 1],
} as const;

export const BODY: Body = {
  positions: [0, 1.02902, 0.13711, 0.25, 0.5, -0.01, -0.25, 0.5, -0.01],
  joints: [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
  weights: [255, 0, 0, 0, 128, 127, 0, 0, 255, 0, 0, 0],
  indices: [0, 1, 2],
  bones: [
    {
      name: "root",
      translation: [0, 1.02902, 0],
      rotation: [-0.7071067811865476, 0, 0, 0.7071067811865476],
    },
    SPINE,
  ],
};
