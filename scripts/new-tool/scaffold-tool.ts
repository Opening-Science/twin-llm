/**
 * Writes one new query tool into the tree at `root`. Every check and every
 * edit runs in memory first; files are written only when all of them pass,
 * so a refused or broken scaffold leaves the tree as it was.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  applyEdit,
  declaredIdentifiers,
  fileEdits,
  NAME_REGISTRIES,
  newFiles,
  ScaffoldError,
} from "./tool-edits";
import { nameProblem, toolNames } from "./tool-names";

export type ScaffoldResult = Readonly<{
  created: readonly string[];
  edited: readonly string[];
}>;

const read = (root: string, path: string): string => {
  const full = join(root, path);
  if (!existsSync(full)) throw new ScaffoldError(`${path}: file not found under ${root}`);
  return readFileSync(full, "utf8");
};

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const scaffoldTool = (root: string, name: string): ScaffoldResult => {
  const problem = nameProblem(name);
  if (problem !== null) throw new ScaffoldError(problem);
  const names = toolNames(name);

  const created = newFiles(names);
  const taken = created.find((file) => existsSync(join(root, file.path)));
  if (taken) throw new ScaffoldError(`${taken.path} already exists`);

  const registry = NAME_REGISTRIES.find((path) => read(root, path).includes(`"${name}"`));
  if (registry) throw new ScaffoldError(`tool "${name}" already exists (${registry})`);

  const clash = declaredIdentifiers(names).find(({ path, identifier }) =>
    new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(read(root, path)),
  );
  if (clash) {
    throw new ScaffoldError(`${clash.path} already declares ${clash.identifier}`);
  }

  const edited = fileEdits(names).map((edit) => ({
    path: edit.path,
    content: applyEdit(edit, read(root, edit.path)),
  }));

  [...created, ...edited].forEach((file) => {
    const full = join(root, file.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.content);
  });

  return {
    created: created.map((file) => file.path),
    edited: edited.map((file) => file.path),
  };
};
