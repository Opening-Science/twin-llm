import { describe, expect, test } from "bun:test";

import { anatomyEnv, parseServerEnv } from "./env";

const BASE = {
  NODE_ENV: "test",
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
  PATH: "/usr/bin",
} as const;

const GLB = "/data/open-anatomy/s0086/s0086.skeleton.glb";
const PIN = "741253DAC16EE1EE1DAD59F82CCFD9FB6AE5418DC79D157D3C317440F0AD51B9";

const failureOf = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("anatomyEnv skeleton pin", () => {
  test("no skeleton: neither path nor pin", () => {
    const env = anatomyEnv(parseServerEnv(BASE));
    expect(env.skeletonGlb).toBeNull();
    expect(env.skeletonSha256).toBeNull();
  });

  test("the pin is read in lower case beside the path", () => {
    const env = anatomyEnv(
      parseServerEnv({
        ...BASE,
        ANATOMY_SKELETON_GLB: GLB,
        ANATOMY_SKELETON_SHA256: PIN,
      }),
    );
    expect(env.skeletonGlb).toBe(GLB);
    expect(env.skeletonSha256).toBe(PIN.toLowerCase());
  });

  test("a skeleton path without its pin fails at startup", () => {
    expect(failureOf({ ...BASE, ANATOMY_SKELETON_GLB: GLB })).toContain(
      "ANATOMY_SKELETON_SHA256 must be set with ANATOMY_SKELETON_GLB",
    );
  });

  test("a pin that is not a SHA-256 fails at startup", () => {
    expect(
      failureOf({ ...BASE, ANATOMY_SKELETON_GLB: GLB, ANATOMY_SKELETON_SHA256: "abc" }),
    ).toContain("ANATOMY_SKELETON_SHA256 must be 64 hex characters");
  });
});
