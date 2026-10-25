import { createHash, timingSafeEqual } from "node:crypto";

export const secretsEqual = (left: string, right: string): boolean => {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
};

export const readUploadAuth = (body: unknown): readonly [string, string] | null => {
  if (!body || typeof body !== "object" || !("auth" in body)) return null;
  const auth = (body as { auth: unknown }).auth;
  if (
    Array.isArray(auth) &&
    auth.length === 2 &&
    typeof auth[0] === "string" &&
    typeof auth[1] === "string"
  ) {
    return [auth[0], auth[1]];
  }
  return null;
};
