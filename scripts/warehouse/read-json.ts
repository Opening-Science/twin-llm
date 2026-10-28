/** File reads shared by `warehouse:ingest` and its worker processes. */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { type JsonRead } from "./ingest-shard";

/** Absolute paths of the *.json files in dir, sorted; null when dir does not exist. */
export const listJsonFiles = async (dir: string): Promise<readonly string[] | null> => {
  try {
    const names = await readdir(resolve(dir));
    return names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(resolve(dir), name));
  } catch {
    return null;
  }
};

export const readJsonFile = async (path: string): Promise<JsonRead> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { kind: "missing" };
  }
  try {
    return { kind: "json", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "invalid" };
  }
};
