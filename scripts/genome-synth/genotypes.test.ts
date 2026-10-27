import { describe, expect, test } from "bun:test";

import { stableUuid } from "../synthetic-wearables/bundle";

import type { Variant } from "./catalog";
import { alleles, callFor, callsFor, hardyWeinberg, NO_CALL_SHARE } from "./genotypes";

const site = (altAf: number, rsid = "rs1"): Variant => ({
  rsid,
  category: "trait",
  gene: "GENE",
  chrom: "chr1",
  pos: 100,
  ref: "G",
  alt: "A",
  altAf,
  afSource: "gnomADg:ALL",
  consequence: "missense_variant",
  clinvar: "",
  note: "",
});

const REF = "080b069b-5108-46b6-ecef-6aacd3b9ef3f";

describe("hardyWeinberg", () => {
  test("splits [0, 1) into p², 2pq and q²", () => {
    // q = 0.5: 0.25 / 0.5 / 0.25
    expect(hardyWeinberg(0, 0.5)).toBe(0);
    expect(hardyWeinberg(0.2499, 0.5)).toBe(0);
    expect(hardyWeinberg(0.25, 0.5)).toBe(1);
    expect(hardyWeinberg(0.7499, 0.5)).toBe(1);
    expect(hardyWeinberg(0.75, 0.5)).toBe(2);
    // q = 0.1: 0.81 / 0.18 / 0.01
    expect(hardyWeinberg(0.8099, 0.1)).toBe(0);
    expect(hardyWeinberg(0.98, 0.1)).toBe(1);
    expect(hardyWeinberg(0.995, 0.1)).toBe(2);
  });
});

describe("calls", () => {
  test("the same subject and site give the same call", () => {
    expect(callFor(REF, site(0.3))).toEqual(callFor(REF, site(0.3)));
  });

  test("a site's call does not depend on the other sites", () => {
    const alone = callsFor(REF, [site(0.3, "rs2")]);
    const among = callsFor(REF, [site(0.3, "rs1"), site(0.3, "rs2"), site(0.3, "rs3")]);
    expect(among[1]).toEqual(alone[0]);
  });

  test("genotype shares follow Hardy–Weinberg and about 2% are no-calls", () => {
    const refs = Array.from({ length: 20_000 }, (_, index) =>
      stableUuid(`genome-test:${index}`),
    );
    const calls = refs.map((ref) => callFor(ref, site(0.3)).altCopies);
    const share = (value: number | null) =>
      calls.filter((copies) => copies === value).length / calls.length;
    const called = 1 - NO_CALL_SHARE;
    expect(Math.abs(share(null) - NO_CALL_SHARE)).toBeLessThan(0.004);
    expect(Math.abs(share(0) - 0.49 * called)).toBeLessThan(0.012);
    expect(Math.abs(share(1) - 0.42 * called)).toBeLessThan(0.012);
    expect(Math.abs(share(2) - 0.09 * called)).toBeLessThan(0.008);
  });

  test("alleles are written reference first", () => {
    const variant = site(0.3);
    expect(alleles({ variant, altCopies: 0 })).toBe("G/G");
    expect(alleles({ variant, altCopies: 1 })).toBe("G/A");
    expect(alleles({ variant, altCopies: 2 })).toBe("A/A");
    expect(alleles({ variant, altCopies: null })).toBe(null);
  });
});
