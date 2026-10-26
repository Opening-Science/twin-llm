/**
 * Every MCP server TwinLLM can talk to, with where it runs. `locality` is what
 * the data-mode policy reads: a remote server never sees personal data.
 * A `url` is listed only when it is fixed; GBD's comes from `GBD_MCP_URL`.
 */

export type McpTransport = "stdio" | "http";
export type McpLocality = "local" | "remote";

export type McpServerEntry = Readonly<{
  name: string;
  transport: McpTransport;
  locality: McpLocality;
  url?: string;
}>;

export const MCP_SERVERS: readonly McpServerEntry[] = [
  { name: "gbd", transport: "http", locality: "remote" },
];

export const findServer = (name: string): McpServerEntry | undefined =>
  MCP_SERVERS.find((server) => server.name === name);
