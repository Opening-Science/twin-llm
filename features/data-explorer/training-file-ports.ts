import "server-only";

import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { resolveActorId } from "@/infrastructure/auth-actor";

import { type TrainingFileDeps } from "./training-files";

/**
 * File system calls for the Training tab. The directory is the generator's
 * default output, relative to where the server runs (the project root), so
 * nothing about it is configurable from a request.
 */

export const TRAINING_OUT_DIR = join("training-data", "out");

const isMissing = (error: unknown): boolean =>
  error instanceof Error && Reflect.get(error, "code") === "ENOENT";

const inDir = (fileName: string) => join(process.cwd(), TRAINING_OUT_DIR, fileName);

const readLineAt = async (path: string, index: number): Promise<string | null> => {
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let seen = 0;
    for await (const line of reader) {
      if (line.trim() === "") continue;
      if (seen === index) return line;
      seen += 1;
    }
    return null;
  } finally {
    reader.close();
    stream.destroy();
  }
};

export const trainingFileDeps: TrainingFileDeps = {
  resolveActorId,
  listFiles: async () => {
    try {
      return await readdir(join(process.cwd(), TRAINING_OUT_DIR));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  },
  readText: async (fileName) => {
    try {
      return await readFile(inDir(fileName), "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
  readLine: async (fileName, index) => {
    try {
      return await readLineAt(inDir(fileName), index);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
};
