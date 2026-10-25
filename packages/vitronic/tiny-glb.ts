/**
 * Minimal glTF 2.0 binary with an AutoMarkers mesh. For tests only — not a scan.
 */

const pad4 = (buffer: Buffer, padByte: number): Buffer => {
  const extra = (4 - (buffer.byteLength % 4)) % 4;
  if (extra === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(extra, padByte)]);
};

export const buildTinyGlb = (): Uint8Array => {
  const json = {
    asset: { version: "2.0", generator: "twin-llm-test" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "AutoMarkers" }],
    meshes: [
      {
        name: "AutoMarkers",
        primitives: [{ attributes: { POSITION: 0 }, mode: 0 }],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 1,
        type: "VEC3",
        max: [0, 0, 0],
        min: [0, 0, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: 12, target: 34962 }],
    buffers: [{ byteLength: 12 }],
  };

  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad4(Buffer.alloc(12), 0x00);
  const total = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let offset = 12;
  out.writeUInt32LE(jsonChunk.byteLength, offset);
  out.writeUInt32LE(0x4e4f534a, offset + 4);
  jsonChunk.copy(out, offset + 8);
  offset += 8 + jsonChunk.byteLength;
  out.writeUInt32LE(binChunk.byteLength, offset);
  out.writeUInt32LE(0x004e4942, offset + 4);
  binChunk.copy(out, offset + 8);
  return new Uint8Array(out);
};
