import { resolve } from "node:path";

/**
 * Which OAuth redirect proxies `bun run dev` starts next to Next. Oura's
 * registered redirect is `http://localhost:8787/callback` and WHOOP's is
 * `https://localhost:8788/api/whoop/callback`; without the proxy the
 * provider's return ends at "can't connect". A proxy starts only when its
 * redirect env points at the proxy's own host and port, and WHOOP's only when
 * its TLS files exist. Host, port and file defaults and overrides are the
 * ones `scripts/oura-oauth-proxy.mjs` and `scripts/whoop-oauth-proxy.mjs`
 * read. Pure: the env and a file check are passed in.
 */

export type ProxyId = "oura" | "whoop";

export type DevEnv = Readonly<Record<string, string | undefined>>;

export type ProxyPlan =
  | Readonly<{
      kind: "start";
      id: ProxyId;
      tag: string;
      script: string;
      /** Where the proxy listens; undefined means every interface. */
      host: string | undefined;
      port: number;
    }>
  | Readonly<{ kind: "skip"; id: ProxyId; tag: string; message: string }>;

const DEFAULT_CERT = "certificates/localhost.pem";
const DEFAULT_KEY = "certificates/localhost-key.pem";

/** The port a URL addresses, its scheme's default when it names none. */
const urlPort = (url: URL): number =>
  url.port !== "" ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

/** Whether `uri` is a `protocol` URL at exactly `host` and `port`. */
export const redirectsTo = (
  uri: string | undefined,
  protocol: "http:" | "https:",
  host: string,
  port: number,
): boolean => {
  if (uri === undefined || uri.trim() === "") return false;
  try {
    const url = new URL(uri.trim());
    return (
      url.protocol === protocol &&
      url.hostname.toLowerCase() === host.toLowerCase() &&
      urlPort(url) === port
    );
  } catch {
    return false;
  }
};

/** The mkcert command from docs/connectors.md, for the configured files. */
export const mkcertCommand = (certFile: string, keyFile: string): string =>
  `mkcert -cert-file ${certFile} -key-file ${keyFile} localhost`;

const ouraPlan = (env: DevEnv): readonly ProxyPlan[] => {
  const host = env.OURA_PROXY_HOST ?? "localhost";
  const port = Number(env.OURA_PROXY_PORT ?? 8787);
  return redirectsTo(env.OURA_REDIRECT_URI, "http:", host, port)
    ? [
        {
          kind: "start",
          id: "oura",
          tag: "[oura-proxy]",
          script: "scripts/oura-oauth-proxy.mjs",
          host,
          port,
        },
      ]
    : [];
};

const whoopPlan = (
  env: DevEnv,
  exists: (path: string) => boolean,
  root: string,
): readonly ProxyPlan[] => {
  // The WHOOP proxy accepts on every interface; the redirect names localhost.
  const host = env.WHOOP_PROXY_HOST ?? "localhost";
  const port = Number(env.WHOOP_PROXY_PORT ?? 8788);
  if (!redirectsTo(env.WHOOP_REDIRECT_URI, "https:", host, port)) return [];
  const certFile = env.WHOOP_PROXY_CERT ?? DEFAULT_CERT;
  const keyFile = env.WHOOP_PROXY_KEY ?? DEFAULT_KEY;
  const tag = "[whoop-proxy]";
  return exists(resolve(root, certFile)) && exists(resolve(root, keyFile))
    ? [
        {
          kind: "start",
          id: "whoop",
          tag,
          script: "scripts/whoop-oauth-proxy.mjs",
          host: undefined,
          port,
        },
      ]
    : [
        {
          kind: "skip",
          id: "whoop",
          tag,
          message: `${tag} Not started: the TLS certificate is missing. Make it once with: ${mkcertCommand(certFile, keyFile)}`,
        },
      ];
};

/** The proxies to start, and any to leave out with the line that says why. */
export const planDevProxies = (
  env: DevEnv,
  exists: (path: string) => boolean,
  root: string,
): readonly ProxyPlan[] => [...ouraPlan(env), ...whoopPlan(env, exists, root)];

/**
 * The addresses to try before starting a proxy on `host`. `localhost` is both
 * loopbacks: a proxy started by hand may hold either one, and Bun would then
 * bind the other, so the browser could reach either. Every interface
 * (undefined) is tried as a whole and on each loopback.
 */
export const probeHosts = (host: string | undefined): readonly (string | undefined)[] =>
  host === undefined
    ? [undefined, "127.0.0.1", "::1"]
    : host.toLowerCase() === "localhost"
      ? ["127.0.0.1", "::1"]
      : [host];

/** The one line printed when a proxy's port cannot be taken. */
export const portBusyLine = (
  tag: string,
  host: string | undefined,
  port: number,
  code: string,
): string => {
  const where = host === undefined ? `port ${port}` : `${host}:${port}`;
  return code === "EADDRINUSE"
    ? `${tag} Not started: ${where} is already in use (a proxy you started yourself keeps working).`
    : `${tag} Not started: cannot listen on ${where} (${code}).`;
};

/** A child's output line with its tag, unless the child already wrote it. */
export const tagLine = (tag: string, line: string): string =>
  line.startsWith(tag) ? line : `${tag} ${line}`;
