/**
 * The codes this study reads, taken from what Synthea v4.0.0 actually writes
 * (a scan of batch-001, seed 1001) and from its module files. Synthea writes
 * one cerebrovascular code (230690007), no TIA, no peripheral artery disease
 * and no direct oral anticoagulant: warfarin is its only oral anticoagulant.
 * The `*_PATTERN`s let the extractor count any other code that would match,
 * so a later Synthea version that adds one shows up in the report.
 */

export const TOPICS = [
  "af",
  "stroke",
  "heartFailure",
  "hypertension",
  "diabetes",
  "vascular",
  "ischaemicHeart",
  "dementia",
  "sleepApnea",
  "venousThromboembolism",
] as const;
export type Topic = (typeof TOPICS)[number];

export type CodeEntry = Readonly<{ code: string; display: string }>;

/** SNOMED CT condition codes per topic. */
export const CONDITION_CODES: Readonly<Record<Topic, readonly CodeEntry[]>> = {
  af: [{ code: "49436004", display: "Atrial fibrillation" }],
  stroke: [{ code: "230690007", display: "Cerebrovascular accident" }],
  heartFailure: [
    { code: "88805009", display: "Chronic congestive heart failure" },
    { code: "84114007", display: "Heart failure" },
  ],
  hypertension: [{ code: "59621000", display: "Essential hypertension" }],
  diabetes: [{ code: "44054006", display: "Diabetes mellitus type 2" }],
  vascular: [
    { code: "22298006", display: "Myocardial infarction" },
    { code: "401303003", display: "Acute ST segment elevation myocardial infarction" },
    {
      code: "401314000",
      display: "Acute non-ST segment elevation myocardial infarction",
    },
    { code: "399211009", display: "History of myocardial infarction" },
  ],
  ischaemicHeart: [{ code: "414545008", display: "Ischemic heart disease" }],
  dementia: [
    { code: "26929004", display: "Alzheimer's disease" },
    { code: "230265002", display: "Familial Alzheimer's disease of early onset" },
  ],
  sleepApnea: [
    { code: "78275009", display: "Obstructive sleep apnea syndrome" },
    { code: "73430006", display: "Sleep apnea" },
  ],
  venousThromboembolism: [
    { code: "132281000119108", display: "Acute deep venous thrombosis" },
    { code: "706870000", display: "Acute pulmonary embolism" },
  ],
};

/** RxNorm oral anticoagulants Synthea writes (warfarin only, in two display spellings). */
export const ORAL_ANTICOAGULANT_CODES: readonly CodeEntry[] = [
  { code: "855332", display: "Warfarin Sodium 5 MG Oral Tablet" },
];

/** Displays that would be a cerebrovascular event, to find codes outside the list. */
export const CEREBROVASCULAR_PATTERN =
  /cerebrovascular|stroke|transient ischemic|cerebral infarct|intracerebral|subarachnoid|brain infarct/i;

/** Oral anticoagulant names, to find codes outside the list. */
export const ORAL_ANTICOAGULANT_PATTERN =
  /warfarin|apixaban|rivaroxaban|dabigatran|edoxaban|phenprocoumon|acenocoumarol/i;

const TOPIC_BY_CODE: ReadonlyMap<string, Topic> = new Map(
  TOPICS.flatMap((topic) =>
    CONDITION_CODES[topic].map((entry): [string, Topic] => [entry.code, topic]),
  ),
);

/** The topic a SNOMED condition code belongs to, or null. */
export const topicOf = (code: string): Topic | null => TOPIC_BY_CODE.get(code) ?? null;

const ANTICOAGULANTS = new Set(ORAL_ANTICOAGULANT_CODES.map((entry) => entry.code));

export const isOralAnticoagulant = (code: string): boolean => ANTICOAGULANTS.has(code);
