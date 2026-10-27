/**
 * The names one new query tool is written under, from its snake_case tool
 * name. Pure.
 */

/** OpenAI function names stop at 64 characters. */
const MAX_LENGTH = 64;

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export type ToolNames = Readonly<{
  /** `body_mass_trend`: the tool, audit and manifest name. */
  snake: string;
  /** `body-mass-trend`: the test file. */
  kebab: string;
  /** `bodyMassTrendInput`: the zod input schema. */
  input: string;
  /** `BodyMassTrendInput`: its parsed type. */
  inputType: string;
  /** `runBodyMassTrend`: the scoped, audited read. */
  run: string;
  /** `computeBodyMassTrend`: the pure maths in stats.ts. */
  compute: string;
  /** `BodyMassTrendResult`: the result type. */
  result: string;
}>;

/** Why a name is refused, or null when it is a usable snake_case name. */
export const nameProblem = (name: string): string | null => {
  if (name.length === 0) return "give a tool name: bun run new:tool <snake_name>";
  if (name.length > MAX_LENGTH)
    return `"${name}" is longer than ${MAX_LENGTH} characters`;
  if (!SNAKE_CASE.test(name)) {
    return `"${name}" is not snake_case (lower-case letters and digits, words joined by one underscore, starting with a letter)`;
  }
  return null;
};

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export const toolNames = (snake: string): ToolNames => {
  const words = snake.split("_");
  const pascal = words.map(capitalise).join("");
  const camel = (words[0] ?? "") + words.slice(1).map(capitalise).join("");
  return {
    snake,
    kebab: words.join("-"),
    input: `${camel}Input`,
    inputType: `${pascal}Input`,
    run: `run${pascal}`,
    compute: `compute${pascal}`,
    result: `${pascal}Result`,
  };
};
