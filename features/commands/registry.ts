/**
 * The commands behind `/` in the prompt bar. Built-ins live here; skills (#41)
 * will be appended to the same list, each saying what it reads.
 */

export type Command = Readonly<{
  name: string;
  description: string;
  reads: readonly string[];
}>;

export const BUILT_IN_COMMANDS: readonly Command[] = [
  { name: "connect", description: "Connect a wearable", reads: [] },
];

export const matchCommands = (
  query: string,
  commands: readonly Command[],
): readonly Command[] => {
  const prefix = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(prefix));
};

export const readsLine = (reads: readonly string[]): string =>
  reads.length === 0 ? "reads nothing" : `reads: ${reads.join(", ")}`;
