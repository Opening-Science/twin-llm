/**
 * Anchor writes each interval's population as one key (`age_>18J_male`,
 * `female_Follikelphase`, `time_vor_10h`, `fasting_adult`). This turns the key
 * into constraints and checks a subject against them.
 *
 * It fails closed. An unknown token makes the whole key unparseable, so a
 * new population on a pin bump matches nobody (and the tests say so) instead of
 * being read as "everyone". A constraint the context says nothing about is not
 * met: without an age there is no `age_>18J` interval, and a glucose that is not
 * known to be fasting gets no fasting range.
 *
 * `adult` (`general_adult`, `fasting_adult`) adds no constraint: TwinLLM subjects
 * are adults.
 */
export type Sex = "female" | "male";

export const QUALIFIERS = ["follicular", "before-10h", "after-17h", "fasting"] as const;

export type Qualifier = (typeof QUALIFIERS)[number];

export type AgeBound = Readonly<{
  /** `>18J` → 18, exclusive; `12-60J` → 12, inclusive. */
  min: number;
  minInclusive: boolean;
  /** Inclusive upper bound, when the key has one. */
  max: number | null;
}>;

export type Population = Readonly<{
  sex: Sex | null;
  age: AgeBound | null;
  qualifier: Qualifier | null;
}>;

export type PopulationContext = Readonly<{
  sex?: Sex;
  ageYears?: number;
  qualifiers?: readonly Qualifier[];
}>;

const OPEN_AGE = /^>(\d+)J$/;
const RANGE_AGE = /^(\d+)-(\d+)J$/;

const parseAge = (token: string | undefined): AgeBound | null => {
  const open = token ? OPEN_AGE.exec(token) : null;
  if (open) return { min: Number(open[1]), minInclusive: false, max: null };
  const range = token ? RANGE_AGE.exec(token) : null;
  if (range) return { min: Number(range[1]), minInclusive: true, max: Number(range[2]) };
  return null;
};

const TIME_QUALIFIERS: Readonly<Record<string, Qualifier>> = {
  "vor 10h": "before-10h",
  "nach 17h": "after-17h",
};

/** Constraints for an Anchor population key, or null when any token is unknown. */
export const parsePopulation = (key: string): Population | null => {
  const tokens = key.split("_");
  const walk = (index: number, found: Population): Population | null => {
    const token = tokens[index];
    if (token === undefined) return found;
    if (token === "general" || token === "adult") return walk(index + 1, found);
    if ((token === "male" || token === "female") && !found.sex) {
      return walk(index + 1, { ...found, sex: token });
    }
    if (token === "age" && !found.age) {
      const age = parseAge(tokens[index + 1]);
      return age ? walk(index + 2, { ...found, age }) : null;
    }
    if (found.qualifier) return null;
    if (token === "Follikelphase")
      return walk(index + 1, { ...found, qualifier: "follicular" });
    if (token === "fasting") return walk(index + 1, { ...found, qualifier: "fasting" });
    if (token === "time") {
      const qualifier = TIME_QUALIFIERS[`${tokens[index + 1]} ${tokens[index + 2]}`];
      return qualifier ? walk(index + 3, { ...found, qualifier }) : null;
    }
    return null;
  };
  return walk(0, { sex: null, age: null, qualifier: null });
};

const ageFits = (age: AgeBound, years: number | undefined): boolean => {
  if (years === undefined || !Number.isFinite(years)) return false;
  const aboveMin = age.minInclusive ? years >= age.min : years > age.min;
  return aboveMin && (age.max === null || years <= age.max);
};

/** True only when every constraint the population has is met by the context. */
export const populationMatches = (
  population: Population,
  context: PopulationContext,
): boolean =>
  (population.sex === null || population.sex === context.sex) &&
  (population.age === null || ageFits(population.age, context.ageYears)) &&
  (population.qualifier === null ||
    (context.qualifiers ?? []).includes(population.qualifier));
