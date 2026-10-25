import { type BiomarkerStatus } from "./biomarkers/use-biomarker-tab";
import { EMPTY_TEXT, SOURCE_LABEL, SOURCE_TEXT } from "./twin-page-copy";

/**
 * Which sections of /digital-twin show, and which say they are empty, per
 * subject kind. Pure, so the rules are tested apart from the 3D view. The body
 * viewer reports a TwinContext once its subject is known; before that the page
 * has no Sources section rather than a blank one.
 */
export type TwinSubject = "demo" | "self" | "other";

export type TwinContext = Readonly<{
  subject: TwinSubject;
  scans: number;
  /** Biomarker rows with a value: lab values and wearable vitals. */
  biomarkerValues: number;
  /** While the values load, or after their read failed, a 0 is not "no values". */
  biomarkersStatus: BiomarkerStatus;
  liveVitals: boolean;
}>;

export type TwinSection = "body" | "sources" | "genome";
export type TwinEmpty = "scans" | "biomarkers" | "vitals" | "genome";

export type SectionPlan = Readonly<{
  sections: readonly TwinSection[];
  empty: readonly TwinEmpty[];
}>;

export type SourceLine = Readonly<{ label: string; text: string }>;

export const twinSections = ({
  context,
  genomeEnabled,
}: Readonly<{ context: TwinContext | null; genomeEnabled: boolean }>): SectionPlan => {
  const genome: readonly TwinEmpty[] = genomeEnabled ? [] : ["genome"];
  if (context === null) return { sections: ["body", "genome"], empty: genome };
  const empty: readonly TwinEmpty[] = [
    // The Demo body is generated; it never has scans, so it never lacks them.
    ...(context.subject !== "demo" && context.scans === 0 ? (["scans"] as const) : []),
    ...(context.biomarkersStatus === "ok" && context.biomarkerValues === 0
      ? (["biomarkers"] as const)
      : []),
    ...(context.liveVitals ? [] : (["vitals"] as const)),
    ...genome,
  ];
  return { sections: ["body", "sources", "genome"], empty };
};

/** Another subject has no lab source yet, so it only ever gets the empty sentence. */
const BIOMARKER_SOURCE: Readonly<Record<TwinSubject, string | null>> = {
  demo: SOURCE_TEXT.demoBiomarkers,
  self: SOURCE_TEXT.selfBiomarkers,
  other: null,
};

const biomarkerText = (context: TwinContext, empty: readonly TwinEmpty[]): string => {
  if (context.biomarkersStatus === "failed") return EMPTY_TEXT.biomarkersFailed;
  if (empty.includes("biomarkers")) return EMPTY_TEXT.biomarkers;
  return BIOMARKER_SOURCE[context.subject] ?? EMPTY_TEXT.biomarkers;
};

/** Only the Demo and Self have a vitals source; another subject never does. */
const VITALS_SOURCE: Readonly<Record<TwinSubject, string | null>> = {
  demo: SOURCE_TEXT.demoVitals,
  self: SOURCE_TEXT.selfVitals,
  other: null,
};

export const sourceLines = (
  context: TwinContext,
  empty: readonly TwinEmpty[],
): readonly SourceLine[] => [
  {
    label: SOURCE_LABEL.body,
    text:
      context.subject === "demo"
        ? SOURCE_TEXT.demoBody
        : empty.includes("scans")
          ? EMPTY_TEXT.scans
          : SOURCE_TEXT.scans,
  },
  {
    label: SOURCE_LABEL.biomarkers,
    text: biomarkerText(context, empty),
  },
  {
    label: SOURCE_LABEL.vitals,
    text: empty.includes("vitals")
      ? EMPTY_TEXT.vitals
      : (VITALS_SOURCE[context.subject] ?? EMPTY_TEXT.vitals),
  },
];
