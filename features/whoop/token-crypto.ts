import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { whoopEnv } from "@/infrastructure/env";

/**
 * Encrypts Whoop OAuth tokens at rest with AES-256-GCM.
 * Payload format: base64(iv || authTag || ciphertext).
 */
export const encryptWhoopSecret = (plaintext: string): string => {
  const env = whoopEnv();
  if (!env) throw new Error("Whoop encryption key is not configured.");

  const key = Buffer.from(env.encryptionKey, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
};

export const decryptWhoopSecret = (payload: string): string => {
  const env = whoopEnv();
  if (!env) throw new Error("Whoop encryption key is not configured.");

  const key = Buffer.from(env.encryptionKey, "hex");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};
