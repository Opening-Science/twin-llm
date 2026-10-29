import { clientAddress, type RateLimiter } from "./synthea-limits";
import { parseSyntheaOptions } from "./synthea-options";
import { type JobQueue } from "./synthea-queue";

/**
 * The job API behind `/synthea`, as handler factories so tests pass a fake
 * queue, limiter and JAR check. Every refusal is a short sentence; details go
 * to the server log only.
 *
 * - `POST /api/synthea/jobs` checks the options, the per-address limit and
 *   the queue, then answers 202 with the job.
 * - `GET /api/synthea/jobs/:id` is the job's state and, when done, a preview.
 * - `GET /api/synthea/jobs/:id/download` sends the zip once; the folder is
 *   removed right after.
 */

export type SyntheaRouteDeps = Readonly<{
  queue: () => JobQueue;
  limiter: () => RateLimiter;
  maxPeople: () => number;
  jarReady: () => Promise<boolean>;
}>;

/** Larger bodies are refused before parsing; a real request is under 400 bytes. */
const MAX_BODY_BYTES = 2048;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const refuse = (status: number, error: string, headers?: HeadersInit): Response =>
  Response.json(
    { error },
    { status, headers: { "cache-control": "no-store", ...headers } },
  );

const noStore = { "cache-control": "no-store" } as const;

/** Only this page may start runs: a browser request from another site is refused. */
const fromOtherSite = (request: Request): boolean => {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
};

const readJson = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const createSyntheaRoutes = (deps: SyntheaRouteDeps) => {
  const createJob = async (request: Request): Promise<Response> => {
    if (fromOtherSite(request))
      return refuse(403, "Start a run from the generator page.");
    const body = await readJson(request);
    if (body === undefined) return refuse(400, "The request could not be read.");
    const parsed = parseSyntheaOptions(body, deps.maxPeople());
    if (!parsed.ok) return refuse(400, parsed.message);
    if (!(await deps.jarReady())) {
      return refuse(503, "The generator is not set up on this server yet.");
    }
    const rate = deps.limiter().take(clientAddress(request.headers));
    if (!rate.ok) {
      return refuse(
        429,
        "The hourly limit of runs from this address is reached. Try again later.",
        { "retry-after": String(rate.retryAfterS) },
      );
    }
    const submitted = deps.queue().submit(parsed.options);
    if (!submitted.ok) {
      return refuse(503, "The generator is busy. Try again in a few minutes.");
    }
    return Response.json({ job: submitted.job }, { status: 202, headers: noStore });
  };

  const jobStatus = (id: string): Response => {
    const job = JOB_ID.test(id) ? deps.queue().status(id) : null;
    if (job === null) return refuse(404, "This run is not known here. Start a new one.");
    return Response.json({ job }, { headers: noStore });
  };

  const downloadJob = async (id: string): Promise<Response> => {
    const job = JOB_ID.test(id) ? deps.queue().status(id) : null;
    const bytes = job === null ? null : await deps.queue().download(id);
    if (job === null || bytes === null) {
      return refuse(
        404,
        "This download is no longer available. Each result can be downloaded once, within 10 minutes.",
      );
    }
    return new Response(new Blob([new Uint8Array(bytes)]), {
      headers: {
        ...noStore,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="synthea-seed${job.seed}-${job.people}.zip"`,
      },
    });
  };

  return { createJob, jobStatus, downloadJob };
};
