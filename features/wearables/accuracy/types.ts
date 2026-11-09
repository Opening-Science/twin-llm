/** A device family the accuracy review has notes for. */
export type AccuracyDevice = "oura" | "whoop" | "fitbit" | "pixel-watch";

/** A measure the accuracy review has notes for. */
export type AccuracyMeasure =
  | "restingHeartRate"
  | "hrv"
  | "totalSleepTime"
  | "sleepWake"
  | "sleepStages"
  | "exerciseHeartRate"
  | "energyExpenditure"
  | "spo2"
  | "compositeScores";

/** How much evidence the review found: none means no validation study at all. */
export type EvidenceLevel = "validated" | "limited" | "none";

/** A paper, with its citation fields as the review recorded them. */
export type AccuracySource = Readonly<{
  authors: string;
  year: number;
  title: string;
  /** Journal, volume and pages; a preprint says so here. */
  journal: string;
  doi: string | null;
  pmid: string | null;
  url: string;
  /** The funding statement as the review read it. */
  funding: string;
  conflicts: string;
}>;

/** One verified evidence row: which paper, and which part of it was read. */
export type AccuracyRow<S extends string = string> = Readonly<{
  source: S;
  verifiedIn: string;
}>;

export type AccuracyNote = Readonly<{
  device: AccuracyDevice;
  measure: AccuracyMeasure;
  /** The measure in the review's own words. */
  measureAsReviewed: string;
  evidence: EvidenceLevel;
  note: string;
  /** Vendor funding or a competing interest in a cited study; null when none. */
  funding: string | null;
  /** Evidence-row numbers in `ACCURACY_ROWS`. */
  rows: readonly number[];
}>;
