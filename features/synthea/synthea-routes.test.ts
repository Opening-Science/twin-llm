import { describe, expect, test } from "bun:test";

import { type RateLimiter } from "./synthea-limits";
import { type JobQueue, type JobView } from "./synthea-queue";
import { createSyntheaRoutes } from "./synthea-routes";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const JOB: JobView = {
  id: ID,
  state: "done",
  position: null,
  people: 2,
  done: 2,
  seed: 9,
  patientFiles: 2,
  preview: null,
};

const BODY = {
  people: 2,
  seed: 9,
  ageMin: 30,
  ageMax: 50,
  sex: "any",
  state: "Ohio",
  modules: [],
  formats: ["fhir"],
};

const routes = (
  overrides: Partial<{
    queue: Partial<JobQueue>;
    limiter: RateLimiter;
    jarReady: boolean;
  }> = {},
) => {
  const submitted: unknown[] = [];
  const keys: string[] = [];
  const queue: JobQueue = {
    submit: (options) => {
      submitted.push(options);
      return { ok: true, job: { ...JOB, state: "queued", position: 1 } };
    },
    status: (id) => (id === ID ? JOB : null),
    download: () => Promise.resolve(new Uint8Array([80, 75])),
    ...overrides.queue,
  };
  const limiter: RateLimiter = overrides.limiter ?? {
    take: (key) => {
      keys.push(key);
      return { ok: true };
    },
  };
  const handlers = createSyntheaRoutes({
    queue: () => queue,
    limiter: () => limiter,
    maxPeople: () => 50,
    jarReady: () => Promise.resolve(overrides.jarReady ?? true),
  });
  return { handlers, submitted, keys };
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/synthea/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const errorOf = async (response: Response) =>
  [response.status, ((await response.json()) as { error: string }).error] as const;

describe("createJob", () => {
  test("queues a valid request and counts it against the address", async () => {
    const { handlers, submitted, keys } = routes();
    const response = await handlers.createJob(post(BODY, { "x-real-ip": "203.0.113.4" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      job: { ...JOB, state: "queued", position: 1 },
    });
    expect(submitted).toEqual([BODY]);
    expect(keys).toEqual(["203.0.113.4"]);
  });

  test("refuses bad input, other sites, a missing JAR, the limit and a full queue", async () => {
    expect(await errorOf(await routes().handlers.createJob(post("{not json")))).toEqual([
      400,
      "The request could not be read.",
    ]);
    expect(
      await errorOf(await routes().handlers.createJob(post({ ...BODY, people: 500 }))),
    ).toEqual([400, "This server makes at most 50 people per run"]);
    expect(
      await errorOf(
        await routes().handlers.createJob(post(BODY, { "sec-fetch-site": "cross-site" })),
      ),
    ).toEqual([403, "Start a run from the generator page."]);
    expect(
      await errorOf(await routes({ jarReady: false }).handlers.createJob(post(BODY))),
    ).toEqual([503, "The generator is not set up on this server yet."]);
    const limited = await routes({
      limiter: { take: () => ({ ok: false, retryAfterS: 120 }) },
    }).handlers.createJob(post(BODY));
    expect(limited.headers.get("retry-after")).toBe("120");
    expect(await errorOf(limited)).toEqual([
      429,
      "The hourly limit of runs from this address is reached. Try again later.",
    ]);
    expect(
      await errorOf(
        await routes({
          queue: { submit: () => ({ ok: false, reason: "busy" }) },
        }).handlers.createJob(post(BODY)),
      ),
    ).toEqual([503, "The generator is busy. Try again in a few minutes."]);
    expect(
      await errorOf(await routes().handlers.createJob(post(" ".repeat(3000)))),
    ).toEqual([400, "The request could not be read."]);
  });
});

describe("jobStatus and downloadJob", () => {
  test("answers for a known id and 404 otherwise", async () => {
    const { handlers } = routes();
    expect(await handlers.jobStatus(ID).json()).toEqual({ job: JOB });
    expect(handlers.jobStatus("../etc").status).toBe(404);
    expect(handlers.jobStatus("0f8fad5b-d9cb-469f-a165-70867728950f").status).toBe(404);
  });

  test("sends the zip with a fixed file name", async () => {
    const response = await routes().handlers.downloadJob(ID);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="synthea-seed9-2.zip"',
    );
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([80, 75]);
    const gone = await routes({
      queue: { download: () => Promise.resolve(null) },
    }).handlers.downloadJob(ID);
    expect(gone.status).toBe(404);
  });
});
