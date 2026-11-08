import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { VENDOR_LOGOS } from "./vendor-logos";

const ROOT = join(import.meta.dir, "../../..");
const PUBLIC = join(ROOT, "public");
const provenance = readFileSync(join(ROOT, "PROVENANCE.md"), "utf8");

const files = Object.values(VENDOR_LOGOS).flatMap((logo) =>
  "darkSrc" in logo ? [logo.src, logo.darkSrc] : [logo.src],
);

describe("vendor logo files", () => {
  test.each(files)("%s is in public/, with a licence note", (src) => {
    expect(existsSync(join(PUBLIC, src))).toBe(true);
    expect(readFileSync(join(PUBLIC, `${src}.license`), "utf8")).toContain(
      "LicenseRef-Vendor-Trademarks",
    );
  });

  test.each(files)("%s is unchanged: its hash is the one in PROVENANCE.md", (src) => {
    const hash = createHash("sha256")
      .update(readFileSync(join(PUBLIC, src)))
      .digest("hex");
    expect(provenance).toMatch(
      new RegExp(`public${src}\`\\s*\\|[^|]*\\|\\s*\`${hash}\``),
    );
  });
});

describe("vendor rules", () => {
  test("WHOOP is at least 30px, has a dark version and an attribution word", () => {
    expect(VENDOR_LOGOS.whoop.size).toBeGreaterThanOrEqual(30);
    expect(VENDOR_LOGOS.whoop.darkSrc).toContain("white");
    expect(VENDOR_LOGOS.whoop.attribution).toBe("Data by");
  });

  test("no Oura or Fitbit file is shown", () => {
    expect(Object.keys(VENDOR_LOGOS)).toEqual(["whoop", "googleHealth"]);
    expect(files.join()).not.toMatch(/oura|fitbit/i);
  });
});
