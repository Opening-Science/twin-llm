import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { speechEngines, voiceSetupSchema } from "./engines";
import { createSpeechSidecar } from "./speech-sidecar";

/**
 * `bun run voice:serve`: the speech sidecar on 127.0.0.1 (docs/voice.md).
 * The host is fixed; only the port can change. It reads the `voice.json` that
 * `bun run voice:setup` wrote and stops with a plain message when the setup
 * or a file it names is missing. It downloads nothing.
 */

const DEFAULT_HOME = join(homedir(), ".local/share/twinllm-voice");

const { values } = parseArgs({
  options: {
    home: { type: "string", default: process.env.VOICE_HOME ?? DEFAULT_HOME },
    port: { type: "string", default: "8095" },
  },
});

const home = values.home;
const configPath = join(home, "voice.json");
if (!existsSync(configPath)) {
  console.error(`No voice setup at ${configPath}. Run bun run voice:setup first.`);
  process.exit(1);
}
const setup = voiceSetupSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
const missing = [
  setup.whisper.bin,
  setup.whisper.model,
  setup.piper.bin,
  setup.piper.voices.en,
  setup.piper.voices.de,
].filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`The voice setup names files that are not there:\n${missing.join("\n")}`);
  process.exit(1);
}

const workDir = join(home, "work");
mkdirSync(workDir, { recursive: true, mode: 0o700 });

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const handle = createSpeechSidecar({
  engines: speechEngines(setup),
  workDir,
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});

/** The request's body, or null once it passes the size limit. */
const readBody = (request: IncomingMessage): Promise<Buffer | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.removeAllListeners("data");
        request.resume();
        resolve(null);
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const server = createServer((request, response) => {
  void (async () => {
    const body = await readBody(request);
    if (body === null) {
      response.writeHead(413, {
        "content-type": "application/json",
        connection: "close",
      });
      response.end(
        JSON.stringify({
          error: { message: "The body is too large.", type: "too_large" },
        }),
      );
      return;
    }
    const answer = await handle(
      new Request(`http://127.0.0.1${request.url ?? "/"}`, {
        method: request.method ?? "GET",
        headers: { "content-type": request.headers["content-type"] ?? "" },
        ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
      }),
    );
    response.writeHead(answer.status, Object.fromEntries(answer.headers.entries()));
    response.end(Buffer.from(await answer.arrayBuffer()));
  })().catch((error: unknown) => {
    console.error(
      `request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    response.destroy();
  });
});

server.listen(Number(values.port), "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  console.log(`speech sidecar on http://127.0.0.1:${port}`);
  console.log(`set VOICE_SIDECAR_URL=http://127.0.0.1:${port} in .env.local`);
});
