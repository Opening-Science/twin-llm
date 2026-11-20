import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { GLUCOSE_EFFECT } from "./effects";

/** Separate from fetched anatomy so deployment tracing includes only this committed asset. */
export const openGlucoseEffect = async (): Promise<Uint8Array<ArrayBuffer> | null> => {
  try {
    const bytes = await readFile(
      join(process.cwd(), "data/anatomy/glucose-particles/glucose-particles.glb"),
    );
    return bytes.byteLength === GLUCOSE_EFFECT.bytes ? new Uint8Array(bytes) : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};
