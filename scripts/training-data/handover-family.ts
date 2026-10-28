/**
 * The `agent_handover` family (#210, tracks only): a question that belongs to
 * another agent. The General Practitioner answers a specialist's question with
 * the same audited tool a latest-value question uses, then names the agent to
 * ask for more; a question about the genome report it cannot read, so it only
 * names the Genetics agent. A specialist asked about something outside its
 * area calls no tool and says which agent fits. Every answer is a fixed
 * template; every number in it is one a tool returned. Pure apart from `run`.
 */
import { pick } from "../synthetic-wearables/random";

import { latestDraft } from "./data-families";
import {
  asked,
  type Draft,
  type FamilyContext,
  sections,
  SYNTHETIC_NOTE,
} from "./family-kit";
import type { Measure } from "./measures";
import { type Bank, askFrom, ask, nameMeasure } from "./questions";
import {
  AGENTS,
  otherAgents,
  type Track,
  type TrackAgent,
  TRACKS,
  trackMeasures,
} from "./tracks";

/** Placeholders: {topic} {ref}. A bank of its own, so the main bank's split groups stay as they are. */
export const HANDOVER_BANK = {
  handover: {
    formal: [
      "Could you look at {topic} for subject {ref}?",
      "Please describe {topic} for subject {ref}.",
    ],
    casual: ["can you tell me about {topic} for {ref}?", "what about {topic} for {ref}?"],
    terse: ["{topic}, subject {ref}", "{topic} {ref}"],
    non_native: [
      "Please explain me {topic} for the subject {ref}.",
      "What you can say about {topic} of subject {ref}?",
    ],
  },
} as const satisfies Readonly<Record<string, Bank>>;

const capitalise = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const lowerFirst = (text: string): string =>
  `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** "The Sleep agent describes sleep against the person's own recent nights." */
export const agentSentence = (agent: TrackAgent): string =>
  `The ${agent.name} agent ${lowerFirst(agent.role)}`;

/** A specialist asked about another agent's area: no tool, and the agent that fits. */
export const outsideArea = (context: FamilyContext, track: Track): Draft => {
  const others = otherAgents(track);
  const [first, ...rest] = others;
  const target = pick(
    context.random,
    first === undefined ? [AGENTS.general] : [first, ...rest],
  );
  const topic = pick(context.random, target.topics);
  const self = track.agent;
  return {
    family: "agent_handover",
    ...asked(
      askFrom(HANDOVER_BANK, context.random, "handover", {
        topic,
        ref: context.subjectRef,
      }),
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [],
    outcome: "handed_over",
    reply: sections(
      `The question is about ${topic}. As the ${self.name} agent I look at ${self.area}; ${topic} belongs to the ${target.name} agent, so I called no tool.`,
      `${capitalise(topic)} is outside what the ${self.name} agent looks at. ${agentSentence(target)} Ask it instead.`,
      `Nothing was read, so nothing is said here about ${topic}. ${SYNTHETIC_NOTE}`,
    ),
  };
};

/** The specialists whose questions the GP can answer with a tool, with the measures left for this subject. */
type DataSpecialist = Readonly<{
  agent: TrackAgent;
  measures: readonly [Measure, ...Measure[]];
}>;

const dataSpecialists = (hasWearables: boolean): readonly DataSpecialist[] =>
  [TRACKS.diet, TRACKS.sleep, TRACKS.trainer].flatMap((track) => {
    const usable = (trackMeasures(track) ?? []).filter(
      (measure) => hasWearables || measure.source === "clinical",
    );
    const [first, ...rest] = usable;
    return first === undefined
      ? []
      : [{ agent: track.agent, measures: [first, ...rest] } as const];
  });

/**
 * The GP asked a specialist's question: it reads the latest value with the
 * audited tool and names the agent to ask for more. A genome question gets no
 * tool (the GP's turn has none) and names the Genetics agent.
 */
export const generalHandover = async (context: FamilyContext): Promise<Draft> => {
  // null is the genome question, which the GP cannot read.
  const choices: readonly [DataSpecialist | null, ...(DataSpecialist | null)[]] = [
    null,
    ...dataSpecialists(context.hasWearables),
  ];
  const choice = pick(context.random, choices);
  if (choice === null) {
    const target = AGENTS.genetics;
    const topic = pick(context.random, target.topics);
    return {
      family: "agent_handover",
      ...asked(
        askFrom(HANDOVER_BANK, context.random, "handover", {
          topic,
          ref: context.subjectRef,
        }),
      ),
      measureLoinc: null,
      subjectRef: context.subjectRef,
      calls: [],
      outcome: "handed_over",
      reply: sections(
        `The question is about ${topic}. Only a turn with the genome tools reads a genome report, and this turn has none, so I called no tool.`,
        `I cannot read the genome report here. ${agentSentence(target)} Ask it about ${topic}.`,
        `Nothing was read, so nothing is said here about ${topic}. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  const { agent: target, measures } = choice;
  const measure = pick(context.random, measures);
  return latestDraft(
    context,
    measure,
    "agent_handover",
    ask(context.random, "latest", {
      label: nameMeasure(context.random, measure),
      ref: context.subjectRef,
    }),
    { answer: `${agentSentence(target)} Ask it for more on ${measure.label}.` },
  );
};

/** The hand-over builder for a track: the GP answers and names; a specialist names only. */
export const handoverFor =
  (track: Track) =>
  async (context: FamilyContext): Promise<Draft> =>
    track.id === "general" ? generalHandover(context) : outsideArea(context, track);
