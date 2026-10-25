import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { vitronicEnv } from "@/infrastructure/env";

/**
 * Encrypts BodyLoop API tokens / upload secrets at rest with AES-256-GCM.
 * Payload format: base64(iv || authTag || ciphertext).
 */
export const encryptVitronicSecret = (plaintext: string): string => {
  const env = vitronicEnv();
  if (!env) throw new Error("Vitronic encryption key is not configured.");

  const key = Buffer.from(env.encryptionKey, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
};

export const decryptVitronicSecret = (payload: string): string => {
  const env = vitronicEnv();
  if (!env) throw new Error("Vitronic encryption key is not configured.");

  const key = Buffer.from(env.encryptionKey, "hex");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};
