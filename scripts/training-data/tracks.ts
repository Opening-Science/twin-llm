/**
 * Training tracks (#210): one per agent, so a fine-tune can learn one agent's
 * role. A track names the agent and its role line, the conversation families
 * it trains on, the LOINC codes its questions ask about and the question
 * styles it keeps. Pure data and pure helpers.
 *
 * Each agent's id, name and role line come from `infrastructure/agents.ts`
 * (#218), the agents the chat runs, so a role change there reaches the
 * training data too. Only the area and hand-over topics are kept here.
 */
import { AGENTS as LIVE_AGENTS, type Agent } from "../../infrastructure/agents";

import { type Family, FAMILIES, GENOME_FAMILIES, TRACK_FAMILIES } from "./family-kit";
import {
  CREATININE,
  GLUCOSE,
  HDL,
  LDL,
  type Measure,
  MEASURES,
  TRIGLYCERIDES,
} from "./measures";
import { type Style, STYLES } from "./questions";
import type { SystemPrompt } from "./conversation";

export type TrackAgent = Readonly<{
  /** The agent id in `infrastructure/agents.ts` (`agent:<id>`). */
  id: string;
  name: string;
  /** One plain sentence on what the agent looks at, from `infrastructure/agents.ts`. */
  role: string;
  /** What the agent looks at, as a noun phrase for hand-over answers. */
  area: string;
  /** How a question names this agent's area, for another agent's hand-over. */
  topics: readonly [string, ...string[]];
}>;

export const TRACK_IDS = [
  "general",
  "diet",
  "anatomy",
  "sleep",
  "trainer",
  "genetics",
] as const;

export type TrackId = (typeof TRACK_IDS)[number];

export type Track = Readonly<{
  id: TrackId;
  agent: TrackAgent;
  families: readonly Family[];
  /** The codes data questions ask about; null keeps every measure (the General agent). */
  loincs: readonly string[] | null;
  styles: readonly Style[];
  /** The genome families and tools (`--genome`). */
  genome: boolean;
}>;

type LiveAgent = Pick<Agent, "id" | "name" | "role">;

/**
 * The id, name and role line of one agent in `infrastructure/agents.ts`.
 * Throws when the id is missing, so a renamed agent fails at load, not in a
 * training file.
 */
export const liveAgent = (
  id: string,
  agents: readonly LiveAgent[] = LIVE_AGENTS,
): LiveAgent => {
  const found = agents.find((agent) => agent.id === id);
  if (found === undefined) {
    throw new Error(`No agent "${id}" in infrastructure/agents.ts.`);
  }
  return { id: found.id, name: found.name, role: found.role };
};

export const AGENTS: Readonly<Record<TrackId, TrackAgent>> = {
  general: {
    ...liveAgent("gp"),
    area: "the whole record",
    topics: [
      "the whole record at once",
      "an overview of every measure on file",
      "how complete the record is overall",
    ],
  },
  diet: {
    ...liveAgent("diet"),
    area: "weight, BMI, glucose, HbA1c and blood lipids",
    topics: ["body weight", "BMI", "HbA1c", "LDL cholesterol", "blood glucose"],
  },
  anatomy: {
    ...liveAgent("anatomy"),
    area: "where organs and body systems are and which biomarkers relate to them",
    topics: [
      "the organ that HbA1c relates to",
      "where the kidneys sit",
      "the organ system behind blood pressure",
    ],
  },
  sleep: {
    ...liveAgent("sleep"),
    area: "sleep from the wearable series",
    topics: ["sleep duration", "time asleep", "the last few nights of sleep"],
  },
  trainer: {
    ...liveAgent("trainer"),
    area: "recovery, heart rate variability and training load",
    topics: ["heart rate variability", "training load", "recovery after workouts"],
  },
  genetics: {
    ...liveAgent("genetics"),
    area: "the synthetic genome report",
    topics: [
      "the variants in the genome report",
      "a CYP2C19 result in the genome report",
    ],
  },
};

const DATA_FAMILIES: readonly Family[] = [
  "latest_value",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
];

const SAFETY_FAMILIES: readonly Family[] = [
  "decline_dose",
  "decline_condition",
  "other_person",
];

const handover = TRACK_FAMILIES[0];

export const TRACKS: Readonly<Record<TrackId, Track>> = {
  general: {
    id: "general",
    agent: AGENTS.general,
    families: [...FAMILIES, handover],
    loincs: null,
    styles: STYLES,
    genome: false,
  },
  diet: {
    id: "diet",
    agent: AGENTS.diet,
    families: [
      "latest_value",
      "trend",
      "baseline_deviation",
      "compare_windows",
      "outside_record",
      "near_miss",
      "unit_conversion",
      ...SAFETY_FAMILIES,
      handover,
    ],
    loincs: [
      "29463-7",
      "39156-5",
      "4548-4",
      GLUCOSE.loinc,
      "2093-3",
      LDL.loinc,
      HDL.loinc,
      TRIGLYCERIDES.loinc,
    ],
    styles: STYLES,
    genome: false,
  },
  anatomy: {
    id: "anatomy",
    agent: AGENTS.anatomy,
    families: [
      "anatomy_note",
      "latest_value",
      "near_miss",
      "absent_code",
      "decline_condition",
      "other_person",
      handover,
    ],
    // Codes no other specialist asks about, so no track both answers and hands over one.
    loincs: ["8480-6", CREATININE.loinc],
    styles: STYLES,
    genome: false,
  },
  sleep: {
    id: "sleep",
    agent: AGENTS.sleep,
    families: [
      "sleep_summary",
      "sleep_no_rows",
      ...DATA_FAMILIES,
      "outside_record",
      "wearable_key",
      "decline_condition",
      "other_person",
      handover,
    ],
    loincs: ["93832-4", "9279-1"],
    // People ask about their nights in plain words; the terse and non-native wordings read as lookups.
    styles: ["formal", "casual"],
    genome: false,
  },
  trainer: {
    id: "trainer",
    agent: AGENTS.trainer,
    families: [
      "hrv_trend",
      "resting_hr_trend",
      "training_load",
      "wearable_too_short",
      "wearable_no_rows",
      ...DATA_FAMILIES,
      "outside_record",
      "near_miss",
      "unit_conversion",
      "wearable_key",
      "decline_condition",
      "other_person",
      handover,
    ],
    loincs: ["40443-4", "8867-4", "41950-7"],
    // A training check-in is short: casual and terse questions only.
    styles: ["casual", "terse"],
    genome: false,
  },
  genetics: {
    id: "genetics",
    agent: AGENTS.genetics,
    families: [...GENOME_FAMILIES, handover],
    loincs: [],
    styles: STYLES,
    genome: true,
  },
};

export const isTrackId = (name: string): name is TrackId =>
  (TRACK_IDS as readonly string[]).includes(name);

/** Every measure a track may name: the data measures and the lipid, glucose and creatinine codes. */
const KNOWN_MEASURES: readonly Measure[] = [
  ...MEASURES,
  GLUCOSE,
  LDL,
  HDL,
  TRIGLYCERIDES,
  CREATININE,
];

/** The measures a track asks about, in its own order, or null for every measure. */
export const trackMeasures = (track: Track): readonly Measure[] | null =>
  track.loincs === null
    ? null
    : track.loincs.flatMap((loinc) => {
        const found = KNOWN_MEASURES.find((measure) => measure.loinc === loinc);
        return found === undefined ? [] : [found];
      });

/** The line the chat adds for an agent turn, as `features/chat/twin-system-prompt.ts` writes it. */
export const agentLine = (agent: Pick<TrackAgent, "name" | "role">): string =>
  `Agent: ${agent.name}. ${agent.role}`;

/**
 * The system prompt with the agent's line right under who TwinLLM is, where
 * the chat puts it, and an id that names the agent. A prompt without that
 * first line gets the agent line on top.
 */
export const withAgentLine = (prompt: SystemPrompt, agent: TrackAgent): SystemPrompt => {
  const lines = prompt.text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("You are TwinLLM"));
  const text =
    at === -1
      ? [agentLine(agent), ...lines].join("\n")
      : [...lines.slice(0, at + 1), agentLine(agent), ...lines.slice(at + 1)].join("\n");
  return { id: `${prompt.id}/agent/${agent.id}`, text };
};

/** The other agents a track's agent can hand a question to, in track order. */
export const otherAgents = (track: Track): readonly TrackAgent[] =>
  TRACK_IDS.filter((id) => id !== track.id).map((id) => AGENTS[id]);

/** Whether a track keeps a question in this style; without a track every style is kept. */
export const keepsStyle = (track: Pick<Track, "styles"> | null, style: Style): boolean =>
  track === null || track.styles.includes(style);

/** The default output path for a track: `<cohort>.<track>.jsonl`. */
export const trackOut = (cohortId: string, track: TrackId): string =>
  `training-data/out/${cohortId}.${track}.jsonl`;
