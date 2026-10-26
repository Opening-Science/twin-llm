import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for the Carbon-X sidecar's contract, for tests and local
 * screenshots: `GET /health` and `POST /v1/chat/completions` on 127.0.0.1.
 * It records what it received so tests can check exactly what arrived, and
 * answers with a fixed text.
 */

export type FakeCarbonXRequest = Readonly<{
  model: unknown;
  messages: readonly Readonly<{ role: string; content: string }>[];
}>;

export type FakeCarbonX = Readonly<{
  baseUrl: string;
  received: FakeCarbonXRequest[];
  stop: () => void;
}>;

export const FAKE_CARBON_X_ANSWER =
  "The alternate allele changes a splice site in exon 5, which is reported to produce a non-functional enzyme.";

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

export const startFakeCarbonX = async (
  options: Readonly<{ answer?: string; status?: number; delayMs?: number }> = {},
): Promise<FakeCarbonX> => {
  const received: FakeCarbonXRequest[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, { status: "ok", model: "carbon-x" });
      return;
    }
    if (request.method !== "POST" || path !== "/v1/chat/completions") {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    void readBody(request).then(async (text) => {
      received.push(JSON.parse(text) as FakeCarbonXRequest);
      if (options.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.status !== undefined && options.status !== 200) {
        response.writeHead(options.status);
        response.end("sidecar exploded: CUDA out of memory");
        return;
      }
      sendJson(response, 200, {
        id: "fake-1",
        object: "chat.completion",
        model: "carbon-x",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: options.answer ?? FAKE_CARBON_X_ANSWER,
            },
            finish_reason: "stop",
          },
        ],
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    received,
    stop: () => {
      server.closeAllConnections();
      server.close();
    },
  };
};
