import { createHash } from "node:crypto";

/**
 * The key a bundle is stored under: the SHA-256 of its JSON as parsed and
 * re-serialised. Its own module so setup can compute it without a database.
 */
export const bundleSha = (bundle: unknown): string => {
  const raw = typeof bundle === "string" ? bundle : JSON.stringify(bundle);
  return createHash("sha256").update(raw).digest("hex");
};
