/**
 * Member and non-member sets for the disclosure experiment (#301). Pure:
 * randomness only through the seed passed in.
 *
 * The training cohort has one conversation per analytics family per subject.
 * A subject is a member when at least one of their conversations was in the
 * fine-tune's training file. Two levels:
 *
 * - record: a conversation that was trained on, against a conversation of the
 *   same family about a non-member;
 * - subject: a conversation about a member that was never trained on, against
 *   a conversation of the same family about a non-member.
 *
 * Each member is paired with one non-member, so both classes have the same
 * family mix.
 */
import { mulberry32, type Random } from "@/infrastructure/seeded-random";

export const ANALYTICS_FAMILIES: ReadonlySet<string> = new Set([
  "latest_value",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
]);

export type Conversation = Readonly<{ line: number; subject: string; family: string }>;

export type Level = "record" | "subject";

export type ScoreItem = Readonly<{
  id: string;
  level: Level;
  member: boolean;
  subject: string;
  family: string;
  line: number;
  pair: number;
}>;

/** A copy in a seeded random order (Fisher-Yates). */
export const shuffled = <T>(items: readonly T[], random: Random): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const pickOne = <T>(items: readonly T[], random: Random): T =>
  items[Math.floor(random() * items.length)];

const bySubject = (
  conversations: readonly Conversation[],
): Map<string, Conversation[]> => {
  const out = new Map<string, Conversation[]>();
  for (const conversation of conversations) {
    const list = out.get(conversation.subject) ?? [];
    list.push(conversation);
    out.set(conversation.subject, list);
  }
  return out;
};

const analyticsOf = (conversations: readonly Conversation[]): Conversation[] =>
  conversations.filter((conversation) => ANALYTICS_FAMILIES.has(conversation.family));

const pairItems = (
  prefix: string,
  level: Level,
  pair: number,
  member: Conversation,
  nonMember: Conversation,
): ScoreItem[] => [
  {
    id: `${prefix}-${level}-${pair}-m`,
    level,
    member: true,
    subject: member.subject,
    family: member.family,
    line: member.line,
    pair,
  },
  {
    id: `${prefix}-${level}-${pair}-n`,
    level,
    member: false,
    subject: nonMember.subject,
    family: nonMember.family,
    line: nonMember.line,
    pair,
  },
];

/** The record-level and subject-level pairs for one member and one non-member. */
const pairsFor = (
  prefix: string,
  pair: number,
  trainedOfMember: readonly Conversation[],
  freshOfMember: readonly Conversation[],
  nonMemberConversations: readonly Conversation[],
  random: Random,
): ScoreItem[] => {
  const sameFamily = (family: string) =>
    nonMemberConversations.find((conversation) => conversation.family === family);
  const record = pickOne(trainedOfMember, random);
  const fresh = pickOne(freshOfMember, random);
  const recordPeer = sameFamily(record.family);
  const freshPeer = sameFamily(fresh.family);
  return [
    ...(recordPeer ? pairItems(prefix, "record", pair, record, recordPeer) : []),
    ...(freshPeer ? pairItems(prefix, "subject", pair, fresh, freshPeer) : []),
  ];
};

export type PilotSets = Readonly<{
  items: ScoreItem[];
  memberPool: number;
  nonMemberPool: number;
}>;

/**
 * Sets for a fine-tune that was already trained. `trained` holds the lines of
 * the training file. Members have a trained and an untrained analytics
 * conversation; non-members appear in no trained conversation of any family.
 */
export const buildPilotSets = (
  conversations: readonly Conversation[],
  trained: ReadonlySet<number>,
  size: number,
  seed: number,
): PilotSets => {
  const random = mulberry32(seed);
  const subjects = bySubject(analyticsOf(conversations));
  const trainedSubjects = new Set(
    conversations.filter((c) => trained.has(c.line)).map((c) => c.subject),
  );
  const names = [...subjects.keys()].sort();
  const memberPool = names.filter((name) => {
    const list = subjects.get(name) ?? [];
    return (
      list.some((c) => trained.has(c.line)) && list.some((c) => !trained.has(c.line))
    );
  });
  const nonMemberPool = names.filter((name) => !trainedSubjects.has(name));
  const members = shuffled(memberPool, random).slice(0, size);
  const nonMembers = shuffled(nonMemberPool, random).slice(0, size);
  const count = Math.min(members.length, nonMembers.length);
  const items = Array.from({ length: count }, (_, pair) => {
    const own = subjects.get(members[pair]) ?? [];
    return pairsFor(
      "pilot",
      pair,
      own.filter((c) => trained.has(c.line)),
      own.filter((c) => !trained.has(c.line)),
      subjects.get(nonMembers[pair]) ?? [],
      random,
    );
  }).flat();
  return { items, memberPool: memberPool.length, nonMemberPool: nonMemberPool.length };
};

export type ControlSets = Readonly<{
  /** Lines the positive-control fine-tune trains on. */
  trainLines: number[];
  /** One analytics conversation per member, kept out of training. */
  heldOutLines: number[];
  members: string[];
  nonMembers: string[];
  items: ScoreItem[];
}>;

/**
 * Sets for the positive control: a fine-tune on very few people. Members and
 * non-members come from subjects with every analytics family and none of the
 * `excluded` subjects. Each member keeps one analytics conversation out of
 * training (for the subject level); all their other conversations, of every
 * family, are trained on.
 */
export const buildControlSets = (
  conversations: readonly Conversation[],
  excluded: ReadonlySet<string>,
  size: number,
  seed: number,
): ControlSets => {
  const random = mulberry32(seed);
  const all = bySubject(conversations);
  const analytics = bySubject(analyticsOf(conversations));
  const pool = [...analytics.keys()]
    .sort()
    .filter(
      (name) =>
        !excluded.has(name) &&
        (analytics.get(name) ?? []).length === ANALYTICS_FAMILIES.size,
    );
  const order = shuffled(pool, random);
  const members = order.slice(0, size);
  const nonMembers = order.slice(size, 2 * size);
  const count = Math.min(members.length, nonMembers.length);
  const heldOut = members.map((name) => pickOne(analytics.get(name) ?? [], random));
  const held = new Set(heldOut.map((c) => c.line));
  const trainLines = members
    .flatMap((name) => (all.get(name) ?? []).map((c) => c.line))
    .filter((line) => !held.has(line))
    .sort((a, b) => a - b);
  const items = Array.from({ length: count }, (_, pair) =>
    pairsFor(
      "control",
      pair,
      (analytics.get(members[pair]) ?? []).filter((c) => !held.has(c.line)),
      [heldOut[pair]],
      analytics.get(nonMembers[pair]) ?? [],
      random,
    ),
  ).flat();
  return {
    trainLines,
    heldOutLines: heldOut.map((c) => c.line).sort((a, b) => a - b),
    members: members.slice(0, count),
    nonMembers: nonMembers.slice(0, count),
    items,
  };
};

export type ProbeSlot = Readonly<{ id: string; member: boolean; line: number }>;

/**
 * Value-extraction probes: up to `size` latest-value conversations that were
 * trained on and as many that were not, in a seeded order.
 */
export const sampleProbes = (
  prefix: string,
  memberLines: readonly number[],
  nonMemberLines: readonly number[],
  size: number,
  seed: number,
): ProbeSlot[] => {
  const random = mulberry32(seed);
  const members = shuffled(
    [...memberLines].sort((a, b) => a - b),
    random,
  ).slice(0, size);
  const nonMembers = shuffled(
    [...nonMemberLines].sort((a, b) => a - b),
    random,
  ).slice(0, size);
  return [
    ...members.map((line, i) => ({ id: `${prefix}-probe-${i}-m`, member: true, line })),
    ...nonMembers.map((line, i) => ({
      id: `${prefix}-probe-${i}-n`,
      member: false,
      line,
    })),
  ];
};
