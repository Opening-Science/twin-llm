import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  defaultStateDir,
  isInside,
  stateDirFrom,
} from "../../infrastructure/storage-hardening";
import { defaultStateDirSetting, envFileFromExample, parseEnvFile } from "./env-file";
import { storageSettings } from "./storage-probe";

/**
 * #382: a synthetic install made from `.env.synthetic.example` keeps its keys
 * and anchors out of the default state folder that a personal install uses.
 */

const ROOT = join(import.meta.dir, "../..");
const TEMPLATE = readFileSync(join(ROOT, ".env.synthetic.example"), "utf8");
const HOMES = [
  { platform: "linux", home: "/home/YOU" },
  { platform: "linux", home: "/home/synthetic-owner" },
  { platform: "darwin", home: "/Users/synthetic-owner" },
] as const;

const apart = (a: string, b: string): boolean => !isInside(a, b) && !isInside(b, a);

describe("the synthetic template's state folder (#382)", () => {
  test("the template sets an absolute TWINLLM_STATE_DIR the app accepts", () => {
    const value = parseEnvFile(TEMPLATE).TWINLLM_STATE_DIR;
    expect(value).toBe("/home/YOU/.local/share/twin-llm-synthetic");
    const resolved = stateDirFrom({ value, platform: "linux", home: "/home/YOU" });
    expect(resolved).toEqual({ ok: true, dir: value ?? "" });
  });

  test("copied as is, it does not resolve to or inside the default folder", () => {
    for (const where of HOMES) {
      const settings = storageSettings(ROOT, parseEnvFile(TEMPLATE), where);
      expect(apart(settings.stateDir, defaultStateDir(where))).toBe(true);
    }
  });

  test("as setup writes it, it is the synthetic folder next to the default one", () => {
    for (const where of HOMES) {
      const stateDir = defaultStateDirSetting(
        where.platform,
        undefined,
        where.home,
        undefined,
      );
      const env = parseEnvFile(
        envFileFromExample(TEMPLATE, "postgresql://u@h/db", stateDir),
      );
      const settings = storageSettings(ROOT, env, where);
      expect(settings.stateDir).toBe(`${defaultStateDir(where)}-synthetic`);
      expect(apart(settings.stateDir, defaultStateDir(where))).toBe(true);
      expect(env.DATA_MODE).toBe("synthetic");
    }
  });

  test("setup keeps an absolute TWINLLM_STATE_DIR from the shell, ignores a relative one", () => {
    expect(defaultStateDirSetting("linux", "/tmp/throwaway", "/home/a", undefined)).toBe(
      "/tmp/throwaway",
    );
    expect(defaultStateDirSetting("linux", "~/state", "/home/a", undefined)).toBe(
      "/home/a/.local/share/twin-llm-synthetic",
    );
    expect(defaultStateDirSetting("linux", undefined, "/home/a", "/data/xdg")).toBe(
      "/data/xdg/twin-llm-synthetic",
    );
  });

  test("envFileFromExample replaces the state line only when a folder is given", () => {
    expect(
      envFileFromExample("TWINLLM_STATE_DIR=/x\n# TWINLLM_STATE_DIR=/y\n", "u"),
    ).toBe("TWINLLM_STATE_DIR=/x\n# TWINLLM_STATE_DIR=/y\n");
    expect(envFileFromExample("TWINLLM_STATE_DIR=/x\n", "u", "/z")).toBe(
      "TWINLLM_STATE_DIR=/z\n",
    );
  });
});
