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
