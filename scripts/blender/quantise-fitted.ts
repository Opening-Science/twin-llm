/**
 * Quantises Blender's fitted atlases so the app can serve them.
 *
 * Usage (from the repo root, after `bun run blender:fit-atlas`):
 *   bun run anatomy:quantise-fitted                 # every body × atlas
 *   bun run anatomy:quantise-fitted --body anny-adult-f --atlas hra-f
 *   bun run anatomy:quantise-fitted --report-only   # measure, write nothing
 *
 * Input: `<anatomy dir>/fitted/<body>.<atlas>.fitted.glb`, checked against
 * its pinned SHA-256 (packages/anatomy/fitted-atlases.ts). Output:
 * `<body>.<atlas>.fitted.quantised.glb` beside it: positions as 14-bit
 * integers per mesh, colours as 8 bits, meshopt-compressed without lossy
 * filters (glTF-Transform's `quantize`, `reorder` and EXT_meshopt_compression),
 * node names and extras kept. Each vertex is checked to stay within 1 mm of
 * Blender's, and the file is written (`.partial`, then rename) only when its
 * bytes match the pin. No network, no randomness.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Document, Logger, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { quantize, reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

import { isDemoBodyId } from "../../packages/anatomy/demo-bodies";
import { isAtlasId } from "../../packages/anatomy/manifest";
import { resolveAnatomyDir } from "../../packages/anatomy/paths";
import {
  checkPin,
  MAX_DEVIATION_M,
  maxDeviation,
  QUANTISE_BITS,
  quantiseJobs,
  type QuantiseJob,
} from "./quantise-plan";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const valueOf = (argv: readonly string[], flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

/** Every primitive's positions in world space, in document order. */
const worldPositions = (document: Document): Float64Array[] => {
  const out: Float64Array[] = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      const count = position.getCount();
      const world = new Float64Array(count * 3);
      const p = [0, 0, 0];
      for (let i = 0; i < count; i += 1) {
        position.getElement(i, p);
        const [x = 0, y = 0, z = 0] = p;
        world[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        world[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        world[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      out.push(world);
    }
  }
  return out;
};

const worstOf = (before: Float64Array[], after: Float64Array[]): number =>
  before.length !== after.length
    ? Infinity
    : before.reduce((worst, list, i) => {
        const other = after[i];
        return Math.max(worst, other ? maxDeviation(list, other) : Infinity);
      }, 0);

type Outcome = Readonly<{
  job: QuantiseJob;
  bytes: number;
  sha256: string;
  deviationM: number;
  vertices: number;
  output: Uint8Array;
}>;

const quantiseOne = async (io: NodeIO, job: QuantiseJob): Promise<Outcome | string> => {
  if (!existsSync(job.source)) {
    return `${job.source} is missing. Run bun run blender:fit-atlas first.`;
  }
  const input = readFileSync(job.source);
  const inputSha = sha256(input);
  if (inputSha !== job.pin.sourceSha256 || input.byteLength !== job.pin.sourceBytes) {
    return `${job.source} is not the pinned Blender output (SHA-256 ${inputSha}); the quantised pin was made from ${job.pin.sourceSha256}.`;
  }
  const document = await io.readBinary(new Uint8Array(input));
  document.setLogger(new Logger(Logger.Verbosity.WARN));
  const before = worldPositions(document);
  await document.transform(
    quantize({
      pattern: /^(POSITION|COLOR_\d+)$/,
      quantizePosition: QUANTISE_BITS.position,
      quantizeColor: QUANTISE_BITS.color,
    }),
  );
  // Measured before the reorder, which only permutes vertices.
  const deviationM = worstOf(before, worldPositions(document));
  await document.transform(reorder({ encoder: MeshoptEncoder, target: "size" }));
  document.createExtension(KHRMeshQuantization).setRequired(true);
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const output = await io.writeBinary(document);
  const vertices = before.reduce((sum, list) => sum + list.length / 3, 0);
  return {
    job,
    bytes: output.byteLength,
    sha256: sha256(output),
    deviationM,
    vertices,
    output,
  };
};

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  const bodyArg = valueOf(argv, "--body");
  const atlasArg = valueOf(argv, "--atlas");
  if (
    (bodyArg !== null && !isDemoBodyId(bodyArg)) ||
    (atlasArg !== null && !isAtlasId(atlasArg))
  ) {
    console.error(
      `Unknown ${bodyArg !== null && !isDemoBodyId(bodyArg) ? `body ${bodyArg}` : `atlas ${atlasArg}`}.`,
    );
    return 2;
  }
  const reportOnly = argv.includes("--report-only");
  const anatomyDir = resolveAnatomyDir(process.env.ANATOMY_DATA_DIR, root);
  const jobs = quantiseJobs(
    anatomyDir,
    bodyArg && isDemoBodyId(bodyArg) ? [bodyArg] : undefined,
    atlasArg && isAtlasId(atlasArg) ? [atlasArg] : undefined,
  );
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  let failed = 0;
  for (const job of jobs) {
    const result = await quantiseOne(io, job);
    const label = `${job.bodyId} × ${job.atlasId}`;
    if (typeof result === "string") {
      console.error(`${label}: ${result}`);
      failed += 1;
      continue;
    }
    const mm = (result.deviationM * 1000).toFixed(3);
    console.log(
      `${label}: ${job.pin.sourceBytes.toLocaleString("en")} → ${result.bytes.toLocaleString("en")} bytes, ${result.vertices.toLocaleString("en")} vertices, worst vertex ${mm} mm, SHA-256 ${result.sha256}`,
    );
    if (!(result.deviationM <= MAX_DEVIATION_M)) {
      console.error(`${label}: a vertex moved more than 1 mm; nothing written.`);
      failed += 1;
      continue;
    }
    if (reportOnly) continue;
    const pin = checkPin(result, job.pin);
    if (pin.kind === "mismatch") {
      console.error(
        `${label}: does not match its pin (${job.pin.bytes} bytes, ${job.pin.sha256}); nothing written.`,
      );
      failed += 1;
      continue;
    }
    const partial = `${job.out}.partial`;
    await writeFile(partial, result.output);
    await rename(partial, job.out).catch(async (error: unknown) => {
      await rm(partial, { force: true });
      throw error;
    });
    console.log(`  wrote ${job.out}`);
  }
  return failed === 0 ? 0 : 1;
};

if ((import.meta as { main?: boolean }).main) {
  process.exit(await main());
}
