import { describe, expect, test } from "bun:test";

import { sealedCipher } from "./field-cipher";
import { variantIdsOf, variantSiteValue } from "./personal-columns";
import { variantLookups } from "./personal-data-store";

const cipher = sealedCipher({ keyId: "0123456789abcdef", dataKey: Buffer.alloc(32, 5) });
const stored = (cell: string | null) =>
  variantIdsOf(cell).map((id) => cipher.index("personal_variants", "variant_id", id));

describe("variant lookups over keyed hashes (#141)", () => {
  test("an rsID matches the whole ID cell or one part of a ; list, never a prefix", () => {
    const [wanted] = variantLookups(cipher, { rsids: ["rs12"], sites: [] }).ids;
    expect(stored("rs12")).toContain(wanted ?? "");
    expect(stored("rs1;rs12")).toContain(wanted ?? "");
    expect(stored("rs12;rs9;rs3")).toContain(wanted ?? "");
    expect(stored("rs123")).not.toContain(wanted ?? "");
    expect(stored(null)).toEqual([]);
  });

  test("a site asks for every spelling of its chromosome, never the plain position", () => {
    const { sites } = variantLookups(cipher, {
      rsids: [],
      sites: [{ chroms: ["chr1", "1"], pos: 12345 }],
    });
    expect(sites).toEqual([
      cipher.index("personal_variants", "site", variantSiteValue("chr1", 12345)),
      cipher.index("personal_variants", "site", variantSiteValue("1", "12345")),
    ]);
    expect(sites.join(" ")).not.toContain("12345");
  });

  test("during a rotation each name is asked under both keys", () => {
    const rotating = sealedCipher(
      { keyId: "fedcba9876543210", dataKey: Buffer.alloc(32, 6) },
      [{ keyId: "0123456789abcdef", dataKey: Buffer.alloc(32, 5) }],
    );
    expect(variantLookups(rotating, { rsids: ["rs12"], sites: [] }).ids).toHaveLength(2);
  });
});
