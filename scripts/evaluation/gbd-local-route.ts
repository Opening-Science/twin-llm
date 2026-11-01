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
