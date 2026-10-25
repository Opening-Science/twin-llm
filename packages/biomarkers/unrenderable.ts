/**
 * Markers open-twin says have no single body location (DECISIONS.md#d12 at the
 * pin, see docs/open-twin-pins.md). Upstream emits them under `unrenderable[]`
 * and forbids rerouting them into a neighbouring system, so the twin never
 * lights anything for them, even where one of their regions has a mesh
 * (Kreatinin and Harnsäure list `kidney`).
 *
 * The list exists upstream only as prose in D12, not as data, which is why it
 * is copied here. Its size (14) is checked against D12's count in the tests.
 */
export const UNRENDERABLE_IDS: ReadonlySet<string> = new Set([
  // Blood count (CBC)
  "BM-423",
  "BM-424",
  "BM-425",
  "BM-426",
  "BM-427",
  "BM-428",
  "BM-429",
  "BM-430",
  // Immunoglobulins IgA, IgG, IgM
  "BM-431",
  "BM-432",
  "BM-433",
  // Kreatinin, Harnsäure, hsCRP
  "BM-436",
  "BM-136",
  "BM-079",
]);
