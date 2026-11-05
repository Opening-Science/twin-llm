import { type KdfCost } from "@/infrastructure/vault-crypto";

/**
 * KDF work factors for tests that seal or open vault records (#465): 1 MiB
 * and one pass for Argon2id, N = 2^10 for scrypt. The production defaults
 * (64 MiB, 3 passes; N = 2^17) cost about 0.1 s per key and a rotating
 * record derives eight, which ran past Bun's 5 s limit on a loaded machine.
 * The code paths are the same; only the cost differs. Never use outside tests.
 */
export const TEST_KDF_COST: KdfCost = Object.freeze({
  argon2id: Object.freeze({ memoryKiB: 1024, passes: 1, parallelism: 1 }),
  scrypt: Object.freeze({ N: 1024, r: 8, p: 1 }),
});
