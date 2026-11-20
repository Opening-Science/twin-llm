import type { TwinFocusOrgan } from "@/packages/anatomy/twin-focus";

/**
 * The organ a spoken answer is about, so the twin can turn to it (#616). Words
 * in English and German, matched at the start of a word so German compounds
 * count ("Herzfrequenz" is the heart, "Nierenwerte" the kidneys). The organ
 * named first wins; the answer is read before the question, and nothing
 * named means no turn. Only the organs the twin can focus on
 * (`packages/anatomy/twin-focus.ts`). Pure.
 */

const WORDS: Readonly<Record<TwinFocusOrgan, RegExp>> = {
  heart: /\b(?:heart(?:s|beats?)?\b|cardiac|herz(?!lich)\w*|puls\w*)/iu,
  lung: /\b(?:lungs?|pulmonary|breathing|respirat\w*|lunge\w*|atem\w*|atmung)/iu,
  brain: /\b(?:brain|cerebr\w*|gehirn\w*|hirn\w*)/iu,
  liver: /\b(?:liver|hepat\w*|leber\w*)/iu,
  kidney: /\b(?:kidneys?|renal|niere\w*)/iu,
  pancreas:
    /\b(?:pancrea\w*|blood sugar|glucose|insulin\w*|bauchspeicheldrüse|blutzucker\w*|glukose)/iu,
  bloodvasculature:
    /\b(?:blood vessels?|arter(?:y|ies)|veins?|blood pressure|blutgefäß\w*|gefäß\w*|arterie\w*|blutdruck\w*)/iu,
};

const firstNamed = (text: string): TwinFocusOrgan | null => {
  const found = (Object.entries(WORDS) as [TwinFocusOrgan, RegExp][])
    .map(([organ, pattern]) => ({ organ, at: pattern.exec(text)?.index ?? -1 }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at);
  return found[0]?.organ ?? null;
};

export const organNamed = (answer: string, question: string): TwinFocusOrgan | null =>
  firstNamed(answer) ?? firstNamed(question);
