import { areCommensurable, isValidUcum } from "@open-twin/fhir-r4";

import { anchorLayer, type AnchorLayer } from "@/packages/biomarkers/anchor-layer";

/**
 * Lab test names to LOINC, through an explicit table and nothing else.
 *
 * Each entry names one Anchor biomarker (the pinned open-twin catalogue,
 * docs/biomarkers.md) and the exact names that mean it. The LOINC code comes
 * from Anchor, so this file invents no code. A name matches only when it is
 * spelled as listed (case, spaces and NFC aside): no fuzzy matching, no
 * guessing from parts of a name. Names that could mean more than one code are
 * left out on purpose: plain "glucose" (fasting or not, blood or plasma),
 * plain "CRP" (Anchor has only the high-sensitivity method), "LDL"
 * (calculated or measured).
 *
 * A LOINC code fixes the property (mass or moles per volume, a fraction), so
 * the unit must fit it too: the unit must be valid UCUM and either Anchor's
 * own unit or one convertible to it. Fractions (`%`, `nmol/mmol`) must match
 * exactly, because UCUM counts every ratio as convertible (`%` and `mmol/mol`
 * both reduce to 1, but HbA1c in each has a different code). A marker Anchor
 * flags as BLOCKING (unit against LOINC property) never maps. When the name
 * is known but the unit does not fit, the row keeps its name and gets no code.
 */

export const LAB_TEST_NAMES: Readonly<Record<string, readonly string[]>> = {
  "BM-072": [
    "total cholesterol",
    "cholesterol total",
    "cholesterin (gesamt)",
    "gesamtcholesterin",
  ],
  "BM-140": ["hdl cholesterol", "hdl-cholesterol", "hdl-cholesterin", "hdl-c"],
  "BM-383": ["triglycerides", "triglyceride"],
  "BM-200": ["lipoprotein (a)", "lipoprotein(a)", "lp(a)"],
  "BM-139": ["hba1c", "hemoglobin a1c", "haemoglobin a1c"],
  "BM-128": ["fasting glucose", "nüchternglukose", "nuechternglukose"],
  "BM-079": ["hs-crp", "hscrp", "high-sensitivity crp", "crp (hochsensitiv)"],
  "BM-107": ["ferritin"],
  "BM-386": ["tsh"],
  "BM-114": ["free t3", "ft3", "freies t3 (ft3)", "freies t3"],
  "BM-115": ["free t4", "ft4", "freies t4 (ft4)", "freies t4"],
  "BM-123": ["ggt", "gamma-gt", "gamma-gt (ggt)", "gamma glutamyl transferase"],
  "BM-130": ["ast", "asat", "got (asat)", "aspartate aminotransferase"],
  "BM-132": ["alt", "alat", "gpt (alat)", "alanine aminotransferase"],
  "BM-078": ["ck", "creatine kinase", "creatinkinase (ck)"],
  "BM-436": ["creatinine", "kreatinin"],
  "BM-136": ["uric acid", "urate", "harnsäure"],
  "BM-063": ["calcium"],
  "BM-177": ["potassium", "kalium"],
  "BM-286": ["sodium", "natrium"],
  "BM-258": ["magnesium"],
  "BM-394": ["vitamin b12"],
  "BM-401": ["25-oh vitamin d", "25-hydroxyvitamin d", "vitamin d (25-oh)"],
  "BM-111": ["folate", "folic acid", "folsäure (vitamin b9)", "folsäure"],
  "BM-156": ["homocysteine", "homocystein"],
  "BM-423": ["hemoglobin", "haemoglobin", "hämoglobin"],
  "BM-424": ["hematocrit", "haematocrit", "hämatokrit"],
  "BM-425": ["red blood cells", "rbc", "erythrocytes", "erythrozyten"],
  "BM-426": ["white blood cells", "wbc", "leukocytes", "leukozyten"],
  "BM-427": ["platelets", "thrombocytes", "thrombozyten"],
  "BM-428": ["mcv"],
  "BM-429": ["mch"],
  "BM-430": ["mchc"],
  "BM-315": ["psa"],
  "BM-358": ["total testosterone", "testosterone total", "testosteron (gesamt)"],
  "BM-346": ["shbg"],
  "BM-077": ["cortisol"],
  "BM-087": ["dhea-s", "dheas"],
  "BM-125": ["total protein", "gesamteiweiß"],
};

/** Lower case, NFC, single spaces: the only normalising a name gets. */
export const normaliseTestName = (name: string): string =>
  name.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

export type LabCodeMatch =
  | Readonly<{ kind: "coded"; loinc: string; display: string; biomarkerId: string }>
  | Readonly<{ kind: "unit-mismatch"; biomarkerId: string; expectedUnit: string }>
  | Readonly<{ kind: "unknown-name" }>;

const isRatio = (unit: string): boolean => areCommensurable(unit, "1");

const unitFits = (given: string, anchorUnit: string): boolean => {
  if (given === anchorUnit) return true;
  if (!isValidUcum(given) || !isValidUcum(anchorUnit)) return false;
  if (isRatio(anchorUnit)) return false;
  return areCommensurable(given, anchorUnit);
};

const nameIndex = new Map<string, string>(
  Object.entries(LAB_TEST_NAMES).flatMap(([id, names]) =>
    names.map((name): [string, string] => [normaliseTestName(name), id]),
  ),
);

export const lookupLabCode = (
  testName: string,
  unit: string,
  layer: AnchorLayer = anchorLayer,
): LabCodeMatch => {
  const id = nameIndex.get(normaliseTestName(testName));
  const marker =
    id === undefined ? undefined : layer.biomarkers.find((entry) => entry.id === id);
  if (marker === undefined || marker.blocked) return { kind: "unknown-name" };
  return unitFits(unit.trim(), marker.unitUcum)
    ? {
        kind: "coded",
        loinc: marker.loincCode,
        display: marker.loincDisplay,
        biomarkerId: marker.id,
      }
    : { kind: "unit-mismatch", biomarkerId: marker.id, expectedUnit: marker.unitUcum };
};
