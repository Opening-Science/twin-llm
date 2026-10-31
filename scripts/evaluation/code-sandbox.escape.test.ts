/**
 * Escape tests for the code arm's sandbox (#303). They run the real sandbox
 * on this host: every probe in `SANDBOX_PROBES` must be contained before the
 * harness may run model code. On a host without bubblewrap, a systemd user
 * session or prlimit they are skipped, and the harness refuses the arm there
 * (`SANDBOX_UNAVAILABLE`).
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

import { PROBE_LIMITS, SANDBOX_PROBES } from "./code-sandbox";
import { createHostSandbox } from "./code-sandbox-host";

const sandbox = (() => {
  try {
    return createHostSandbox();
  } catch {
    return null;
  }
})();

const scopeLeft = (): boolean => {
  try {
    const text = execFileSync(
      "systemctl",
      ["--user", "list-units", "--type=scope", "--no-legend", "twin-eval-code-*"],
      { encoding: "utf8" },
    );
    return text.trim().length > 0;
  } catch {
    return false;
  }
};

describe.skipIf(sandbox === null)("the code sandbox contains every escape probe", () => {
  test(
    "all probes contained, and nothing is left running",
    async () => {
      const outcomes =
        (await sandbox?.selfCheck({
          home: homedir(),
          repo: process.cwd(),
        })) ?? [];
      expect(outcomes.map((outcome) => outcome.name)).toEqual(
        SANDBOX_PROBES.map((probe) => probe.name),
      );
      for (const outcome of outcomes) {
        expect({ name: outcome.name, contained: outcome.contained }).toEqual({
          name: outcome.name,
          contained: true,
        });
      }
      const ended = new Map(outcomes.map((outcome) => [outcome.name, outcome.ended]));
      expect(ended.get("infinite loop killed")).toMatch(
        /wall clock|signal SIGXCPU|signal SIGKILL/,
      );
      expect(ended.get("huge output capped")).toBe("output cap");
      await Bun.sleep(500);
      expect(scopeLeft()).toBe(false);
    },
    SANDBOX_PROBES.length * (PROBE_LIMITS.wallMs + 6_000),
  );

  test("a plain program reads its input and prints", async () => {
    const session = await sandbox?.open(
      '{"observations": [{"value": 2.5}, {"value": 3.5}]}',
    );
    try {
      const result = await session?.run(
        "import json, statistics\nrows = json.load(open('/data/subject.json'))['observations']\nprint(statistics.mean(r['value'] for r in rows))",
      );
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout.trim()).toBe("3.0");
      expect(result?.timedOut).toBe(false);
    } finally {
      await session?.close();
    }
  });
});
