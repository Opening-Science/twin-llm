import { describe, expect, test } from "bun:test";

import { parseServerEnv, syntheaEnv } from "./env";

const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
  PATH: "/usr/bin",
} as const;

const failureOf = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("syntheaEnv", () => {
  test("has hosted defaults", () => {
    const env = syntheaEnv(parseServerEnv(BASE));
    expect({ ...env, childPath: "" }).toEqual({
      host: "synthea.opening.science",
      maxPeople: 50,
      jobTimeoutMs: 180_000,
      jobsPerHour: 12,
      queueMax: 5,
      jarPath: null,
      javaBin: "java",
      childPath: "",
    });
  });

  test("reads configured values", () => {
    const env = syntheaEnv(
      parseServerEnv({
        ...BASE,
        SYNTHEA_HOST: "Synthea.Example.Test",
        SYNTHEA_MAX_PEOPLE: "10",
        SYNTHEA_JOB_TIMEOUT_S: "60",
        SYNTHEA_JOBS_PER_HOUR: "3",
        SYNTHEA_QUEUE_MAX: "1",
        SYNTHEA_JAR: "/opt/synthea.jar",
        SYNTHEA_JAVA: "/usr/lib/jvm/21/bin/java",
      }),
    );
    expect({ ...env, childPath: "" }).toEqual({
      host: "synthea.example.test",
      maxPeople: 10,
      jobTimeoutMs: 60_000,
      jobsPerHour: 3,
      queueMax: 1,
      jarPath: "/opt/synthea.jar",
      javaBin: "/usr/lib/jvm/21/bin/java",
      childPath: "",
    });
  });

  test("refuses values out of range or a host with a path", () => {
    expect(failureOf({ ...BASE, SYNTHEA_MAX_PEOPLE: "5000" })).toContain(
      "SYNTHEA_MAX_PEOPLE: SYNTHEA_MAX_PEOPLE must be at most 1000",
    );
    expect(failureOf({ ...BASE, SYNTHEA_JOB_TIMEOUT_S: "2" })).toContain(
      "SYNTHEA_JOB_TIMEOUT_S: SYNTHEA_JOB_TIMEOUT_S must be at least 10",
    );
    expect(failureOf({ ...BASE, SYNTHEA_HOST: "synthea.opening.science/x" })).toContain(
      "SYNTHEA_HOST: SYNTHEA_HOST must be a host name such as synthea.opening.science",
    );
  });
});
