/**
 * S4 on the local GBD store (#387). The S4 items list `GBD_MCP_URL` and
 * `GBD_MCP_TOKEN` in `context.requires` for the remote server. When the eval
 * database holds imported GBD results, the harness offers `gbd_estimate`
 * instead, so those two names count as met and the items run. Pure.
 */
export const REMOTE_GBD_ENV: readonly string[] = ["GBD_MCP_URL", "GBD_MCP_TOKEN"];

export const withLocalGbd =
  (hasEnv: (name: string) => boolean, localGbd: boolean) =>
  (name: string): boolean =>
    hasEnv(name) || (localGbd && REMOTE_GBD_ENV.includes(name));

/** What the local store holds of the S4 probes' place and year (`gbdProbeRows`). */
export type GbdProbeRows = Readonly<{ germany: boolean; year2015: boolean }>;

/**
 * Q-S4-09 (Germany) and Q-S4-10 (2015) expect no estimate. A local store
 * holding either turns them into answerable questions, so an S4 run on it is
 * refused with one line: the reason and the fix. Null when the store is clean.
 */
export const gbdProbeRefusal = (rows: GbdProbeRows): string | null => {
  const held = [rows.germany ? "Germany" : null, rows.year2015 ? "2015" : null].filter(
    (part): part is string => part !== null,
  );
  if (held.length === 0) return null;
  return `S4 not run: the local GBD store holds ${held.join(" and ")} rows, which make the out-of-catalogue probes Q-S4-09 and Q-S4-10 answerable; import into a fresh eval database without Germany and 2015 (docs/evaluation/question-set.md, "Refresh").`;
};

type EnvItem = Readonly<{
  id: string;
  scenario: string;
  context: Readonly<{ requires?: readonly string[] }>;
}>;

/**
 * The names each scenario still needs (#273), in the order its items list
 * them, so a run says which variables to set before it writes MISSING_ENV.
 */
export const missingEnvByScenario = (
  items: readonly EnvItem[],
  hasEnv: (name: string) => boolean,
): ReadonlyMap<
  string,
  Readonly<{ items: readonly string[]; names: readonly string[] }>
> => {
  const out = new Map<string, { items: string[]; names: string[] }>();
  for (const item of items) {
    const unset = (item.context.requires ?? []).filter((name) => !hasEnv(name));
    if (unset.length === 0) continue;
    const entry = out.get(item.scenario) ?? { items: [], names: [] };
    entry.items.push(item.id);
    for (const name of unset) if (!entry.names.includes(name)) entry.names.push(name);
    out.set(item.scenario, entry);
  }
  return out;
};

/** One stderr line per scenario that will be skipped; the GBD names also get the local route. */
export const missingEnvNotice = (
  items: readonly EnvItem[],
  hasEnv: (name: string) => boolean,
): readonly string[] =>
  [...missingEnvByScenario(items, hasEnv)].map(([scenario, { items: ids, names }]) => {
    const head = `${scenario}: ${ids.length} item${ids.length === 1 ? "" : "s"} will be skipped as MISSING_ENV; unset: ${names.join(", ")}.`;
    return names.every((name) => REMOTE_GBD_ENV.includes(name))
      ? `${head} Set them in .env.eval for the remote GBD MCP server, or import GBD 2023 estimates into the eval database for the local route (docs/evaluation/question-set.md, "Refresh").`
      : head;
  });
