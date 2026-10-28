import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Whether `generated/prisma` was built from today's `prisma/schema.prisma`.
 * A pull that adds a model (UserSkill, the search embeddings, the personal
 * imports) leaves the old client in place, and every shell page then fails
 * on `database().userSkill` being undefined. `bun install` regenerates it,
 * but only when a package changed too.
 *
 * The client embeds the schema it was built from as `inlineSchema`, so the
 * check compares text, not file times (a pull rewrites those anyway).
 */

export type PrismaClientState = "ok" | "stale" | "missing";

const CLIENT_CLASS = join("generated", "prisma", "internal", "class.ts");
const SCHEMA = join("prisma", "schema.prisma");

/** Pure: the schema text a generated client was built from, or null. */
export const embeddedSchema = (classSource: string): string | null => {
  const match = /"inlineSchema":\s*("(?:[^"\\]|\\.)*")/.exec(classSource);
  if (match?.[1] === undefined) return null;
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
};

/** Pure: compares the schema with the client's copy of it. */
export const clientState = (
  schema: string,
  classSource: string | null,
): PrismaClientState => {
  if (classSource === null) return "missing";
  return embeddedSchema(classSource) === schema ? "ok" : "stale";
};

export const checkPrismaClient = (root: string): PrismaClientState => {
  const client = join(root, CLIENT_CLASS);
  return clientState(
    readFileSync(join(root, SCHEMA), "utf8"),
    existsSync(client) ? readFileSync(client, "utf8") : null,
  );
};
