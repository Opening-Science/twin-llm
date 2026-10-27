/**
 * Synthetic genotypes for one synthetic subject. Pure and deterministic: each
 * site draws from its own stream, seeded by the catalog version, the
 * subject_ref and the rsID, so the same subject always gets the same calls and
 * adding a site to the catalog never changes the others.
 *
 * A site is a no-call about one time in fifty; otherwise the genotype follows
 * Hardy–Weinberg proportions for the catalog's alternate allele frequency q:
 * (1 − q)² homozygous reference, 2q(1 − q) heterozygous, q² homozygous
 * alternate. Nothing here describes a real person.
 */
import { hash32, mulberry32 } from "../synthetic-wearables/random";

import type { Variant } from "./catalog";

/** Part of every seed: a new catalog version gives every subject new genotypes. */
export const CATALOG_VERSION = "genome-synth-v1";

export const NO_CALL_SHARE = 0.02;

/** Copies of the alternate allele (0, 1 or 2), or null for a no-call. */
export type AltCopies = 0 | 1 | 2 | null;

export type Call = Readonly<{ variant: Variant; altCopies: AltCopies }>;

/** Hardy–Weinberg draw from one uniform value in [0, 1). */
export const hardyWeinberg = (draw: number, q: number): 0 | 1 | 2 => {
  const homRef = (1 - q) * (1 - q);
  if (draw < homRef) return 0;
  return draw < homRef + 2 * q * (1 - q) ? 1 : 2;
};

export const callFor = (subjectRef: string, variant: Variant): Call => {
  const random = mulberry32(hash32(`${CATALOG_VERSION}:${subjectRef}:${variant.rsid}`));
  const noCall = random() < NO_CALL_SHARE;
  const copies = hardyWeinberg(random(), variant.altAf);
  return { variant, altCopies: noCall ? null : copies };
};

/** Every catalog site for one subject, in catalog order. */
export const callsFor = (subjectRef: string, catalog: readonly Variant[]): Call[] =>
  catalog.map((variant) => callFor(subjectRef, variant));

/** The two alleles, reference first (`G/A`), or null for a no-call. */
export const alleles = (call: Call): string | null => {
  const { ref, alt } = call.variant;
  if (call.altCopies === null) return null;
  return [`${ref}/${ref}`, `${ref}/${alt}`, `${alt}/${alt}`][call.altCopies] ?? null;
};
