import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type AppendInput } from "../../packages/audit/append";
import {
  type PinnedRequestInit,
  type PinnedRequestResult,
  TlsPinMismatchError,
} from "../../packages/vitronic/tls";
import {
  assertAllowedWrite,
  isAllowedWrite,
  writeScanSubjectCreatePath,
  writeViatarCreatePath,
  writeViatarTargetsPath,
} from "../../packages/vitronic/write-paths";
import {
  assertScanSubjectCreateBody,
  CONFIRM_LINE,
  CONFIRM_PROMPT,
  COUNTDOWN_MS,
  CYCLE_AUDIT_TOOL_CREATE_PROBAND,
  CYCLE_AUDIT_TOOL_CREATE_SCAN,
  CYCLE_AUDIT_TOOL_LOGIN,
  CYCLE_AUDIT_TOOL_POLL,
  CYCLE_AUDIT_TOOL_START,
  CYCLE_ERROR,
  DEFAULT_VIATAR_PARAMETERS,
  POLL_TIMEOUT_MS,
  runCycle,
  scanSubjectCreateBody,
  targetPollOutcome,
} from "./cycle";

const ENV = {
  BODYLOOP_BASE_URL: "https://scanner.example",
  BODYLOOP_USERNAME: "admin",
  BODYLOOP_PASSWORD: "not-a-real-password",
};

const EXECUTE_ENV = {
  ...ENV,
  BODYLOOP_TLS_FINGERPRINT: "ab".repeat(32),
};

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    },
  };
};

const jsonResult = (status: number, body: unknown): PinnedRequestResult => ({
  status,
  headers: new Headers(),
  body: Buffer.from(JSON.stringify(body), "utf8"),
});

const recordingAudit = () => {
  const events: AppendInput[] = [];
  return {
    events,
    audit: async (input: AppendInput) => {
      events.push(input);
      return {
        seq: BigInt(events.length),
        hash: "0".repeat(64),
        argsSha256: "a".repeat(64),
        resultSha256: "b".repeat(64),
      };
    },
  };
};

const walk = (abs: string, acc: string[]): void => {
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name === ".next") continue;
      walk(join(abs, name), acc);
    }
    return;
  }
  if (abs.endsWith(".test.ts") || abs.endsWith(".test.tsx")) return;
  if (abs.endsWith(".ts") || abs.endsWith(".tsx")) acc.push(abs);
};

describe("vitronic cycle CLI", () => {
  test("dry-run is the default and prints method, path, and body shape", async () => {
    const calls: string[] = [];
    const { out, io } = capture();
    const recorded = recordingAudit();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1"],
      ENV,
      io,
      {
        audit: recorded.audit,
        http: async () => {
          calls.push("http");
          return jsonResult(500, {});
        },
      },
    );
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(recorded.events).toEqual([]);
    expect(out.join("")).toContain("POST");
    expect(out.join("")).toContain(writeScanSubjectCreatePath());
    expect(out.join("")).toContain("{ key_external }");
  });

  test("create-scan dry-run prints path and parameter shape", async () => {
    const { out, io } = capture();
    const code = await runCycle(["create-scan", "--proband-id", "7"], ENV, io);
    expect(code).toBe(0);
    expect(out.join("")).toContain(writeViatarCreatePath());
    expect(out.join("")).toContain("{ proband_id, parameters }");
  });

  test("start dry-run prints targets path without confirmation", async () => {
    const { out, io } = capture();
    const code = await runCycle(
      ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d"],
      ENV,
      io,
      { readLine: async () => "nope" },
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain(writeViatarTargetsPath(3));
    expect(out.join("")).toContain("{ target_kind }");
  });

  test("start rejects viatar-id below 1", async () => {
    const { io, err } = capture();
    const code = await runCycle(
      ["start", "--viatar-id", "0", "--target", "analyzed_avatar_3d"],
      ENV,
      io,
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain("start requires --viatar-id");
  });

  test("create-proband rejects name, date_of_birth, gender, contact, address, and note", () => {
    expect(() => assertScanSubjectCreateBody({ key_external: "x", name: "no" })).toThrow(
      "vitronic-scan-subject-field-rejected",
    );
    expect(() =>
      assertScanSubjectCreateBody({ key_external: "x", date_of_birth: "1990-01-01" }),
    ).toThrow("vitronic-scan-subject-field-rejected");
    expect(() => assertScanSubjectCreateBody({ key_external: "x", gender: "x" })).toThrow(
      "vitronic-scan-subject-field-rejected",
    );
    expect(() => assertScanSubjectCreateBody({ key_external: "x", contact: {} })).toThrow(
      "vitronic-scan-subject-field-rejected",
    );
    expect(() => assertScanSubjectCreateBody({ key_external: "x", address: {} })).toThrow(
      "vitronic-scan-subject-field-rejected",
    );
    expect(() => assertScanSubjectCreateBody({ key_external: "x", note: "no" })).toThrow(
      "vitronic-scan-subject-field-rejected",
    );
    expect(scanSubjectCreateBody("synth-1")).toEqual({ key_external: "synth-1" });
  });

  test("create-proband CLI rejects banned flags", async () => {
    const { io, err } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--name", "no"],
      ENV,
      io,
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain("rejects fields other than key_external");
  });

  test("write allowlist is POST-only and excludes GET scan-subject and password grant", () => {
    expect(isAllowedWrite("POST", writeScanSubjectCreatePath())).toBe(true);
    expect(isAllowedWrite("POST", writeViatarCreatePath())).toBe(true);
    expect(isAllowedWrite("POST", writeViatarTargetsPath(4))).toBe(true);
    expect(isAllowedWrite("GET", writeScanSubjectCreatePath())).toBe(false);
    expect(isAllowedWrite("GET", `${writeScanSubjectCreatePath()}1`)).toBe(false);
    expect(isAllowedWrite("POST", "/api/v2/authentification/token")).toBe(false);
    expect(() => assertAllowedWrite("GET", writeScanSubjectCreatePath())).toThrow(
      "vitronic-write-path-not-allowed",
    );
  });

  test("no app or features module imports write-paths", () => {
    const root = join(import.meta.dir, "../..");
    const files: string[] = [];
    walk(join(root, "app"), files);
    walk(join(root, "features"), files);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toContain("write-paths");
    }
  });

  test("start execute requires the exact confirmation line", async () => {
    const calls: string[] = [];
    const recorded = recordingAudit();
    const { io, err } = capture();
    const code = await runCycle(
      ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        readLine: async () => "yes",
        http: async (url, init) => {
          calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
          return jsonResult(200, { access_token: "t" });
        },
      },
    );
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(recorded.events).toEqual([]);
    expect(err.join("")).toContain(CONFIRM_PROMPT);
  });

  test("start execute prints the confirmation prompt before reading stdin", async () => {
    const recorded = recordingAudit();
    const { err, io } = capture();
    await runCycle(
      ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        readLine: async () => CONFIRM_LINE,
        sleep: async () => undefined,
        http: async (url, init) => {
          const pathname = new URL(url).pathname;
          if (pathname.endsWith("/authentification/token")) {
            return jsonResult(200, { access_token: "t" });
          }
          if (init.method === "POST") return jsonResult(202, {});
          return jsonResult(200, {
            targets: { analyzed_avatar_3d: { state: { status: "Ready", progress: 1 } } },
          });
        },
      },
    );
    expect(err.join("")).toContain(
      'Type "yes, the person is in position" and press Enter to start the scan (anything else aborts):',
    );
  });

  test("start execute writes countdown ticks on stderr", async () => {
    const recorded = recordingAudit();
    const { err, io } = capture();
    await runCycle(
      ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        readLine: async () => CONFIRM_LINE,
        sleep: async () => undefined,
        http: async (url, init) => {
          const pathname = new URL(url).pathname;
          if (pathname.endsWith("/authentification/token")) {
            return jsonResult(200, { access_token: "t" });
          }
          if (init.method === "POST") return jsonResult(202, {});
          return jsonResult(200, {
            targets: { analyzed_avatar_3d: { state: { status: "Ready", progress: 1 } } },
          });
        },
      },
    );
    const tickCount = COUNTDOWN_MS / 1000;
    const ticks = Array.from({ length: tickCount }, (_, i) => `${tickCount - i}\n`).join(
      "",
    );
    expect(err.join("")).toContain(ticks);
  });

  test("create-proband --execute POSTs exactly { key_external } and login is the only other POST", async () => {
    const recorded = recordingAudit();
    const posts: { path: string; body: unknown }[] = [];
    const { io, out } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        http: async (url, init) => {
          const path = new URL(url).pathname;
          if (init.method === "POST") posts.push({ path, body: init.body });
          if (path.endsWith("/authentification/token")) {
            return jsonResult(200, { access_token: "t" });
          }
          return jsonResult(200, { proband_id: 7 });
        },
      },
    );
    expect(code).toBe(0);
    expect(out.join("")).toBe("7\n");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.path).toBe("/api/v2/authentification/token");
    expect(posts[1]?.path).toBe(writeScanSubjectCreatePath());
    expect(JSON.parse(posts[1]?.body as string)).toEqual({ key_external: "synth-1" });
  });

  test("create-scan --execute POSTs exactly { proband_id, parameters } and login is the only other POST", async () => {
    const recorded = recordingAudit();
    const posts: { path: string; body: unknown }[] = [];
    const { io, out } = capture();
    const code = await runCycle(
      ["create-scan", "--proband-id", "7", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        http: async (url, init) => {
          const path = new URL(url).pathname;
          if (init.method === "POST") posts.push({ path, body: init.body });
          if (path.endsWith("/authentification/token")) {
            return jsonResult(200, { access_token: "t" });
          }
          return jsonResult(200, { viatar_id: 4 });
        },
      },
    );
    expect(code).toBe(0);
    expect(out.join("")).toBe("4\n");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.path).toBe("/api/v2/authentification/token");
    expect(posts[1]?.path).toBe(writeViatarCreatePath());
    expect(JSON.parse(posts[1]?.body as string)).toEqual({
      proband_id: 7,
      parameters: DEFAULT_VIATAR_PARAMETERS,
    });
  });

  test("create-proband --execute audits login then create_proband", async () => {
    const recorded = recordingAudit();
    const { io } = capture();
    await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        http: async (url) => {
          const path = new URL(url).pathname;
          if (path.endsWith("/authentification/token")) {
            return jsonResult(200, { access_token: "t" });
          }
          return jsonResult(200, { proband_id: 7 });
        },
      },
    );
    expect(recorded.events.map((event) => event.tool)).toEqual([
      CYCLE_AUDIT_TOOL_LOGIN,
      CYCLE_AUDIT_TOOL_CREATE_PROBAND,
    ]);
    expect(recorded.events[0]?.args).toEqual({
      method: "POST",
      path: "/api/v2/authentification/token",
    });
    expect(recorded.events[1]?.args).toEqual({
      method: "POST",
      path: writeScanSubjectCreatePath(),
    });
    expect(JSON.stringify(recorded.events)).not.toContain("synth-1");
    expect(JSON.stringify(recorded.events)).not.toContain("not-a-real-password");
    expect(JSON.stringify(recorded.events)).not.toContain("access_token");
  });

  test("create-scan --execute audits login then create_scan", async () => {
    const recorded = recordingAudit();
    const { io } = capture();
    await runCycle(["create-scan", "--proband-id", "7", "--execute"], EXECUTE_ENV, io, {
      audit: recorded.audit,
      http: async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/authentification/token")) {
          return jsonResult(200, { access_token: "t" });
        }
        return jsonResult(200, { viatar_id: 4 });
      },
    });
    expect(recorded.events.map((event) => event.tool)).toEqual([
      CYCLE_AUDIT_TOOL_LOGIN,
      CYCLE_AUDIT_TOOL_CREATE_SCAN,
    ]);
    expect(recorded.events[1]?.args).toEqual({
      method: "POST",
      path: writeViatarCreatePath(),
    });
  });

  test("start --execute audits login, start, and one poll event", async () => {
    const recorded = recordingAudit();
    const { io } = capture();
    const code = await runCycle(
      ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        readLine: async () => CONFIRM_LINE,
        sleep: async () => undefined,
        http: async (url, init) => {
          const pathname = new URL(url).pathname;
          if (pathname.endsWith("/authentification/token")) {
            return jsonResult(200, { access_token: "t" });
          }
          if (init.method === "POST") return jsonResult(202, {});
          return jsonResult(200, {
            targets: { analyzed_avatar_3d: { state: { status: "Ready", progress: 1 } } },
          });
        },
      },
    );
    expect(code).toBe(0);
    expect(recorded.events.map((event) => event.tool)).toEqual([
      CYCLE_AUDIT_TOOL_LOGIN,
      CYCLE_AUDIT_TOOL_START,
      CYCLE_AUDIT_TOOL_POLL,
    ]);
    expect(recorded.events[2]?.result).toEqual({
      ticks: 1,
      state: "Ready",
      exit_code: 0,
    });
    expect(recorded.events[2]?.rowCount).toBe(1);
  });

  test("dry-run writes no audit rows", async () => {
    const recorded = recordingAudit();
    const { io } = capture();
    await runCycle(["create-scan", "--proband-id", "7"], ENV, io, {
      audit: recorded.audit,
    });
    expect(recorded.events).toEqual([]);
  });

  test("--execute aborts before HTTP when the audit port cannot be built", async () => {
    const calls: string[] = [];
    const { io, err } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      EXECUTE_ENV,
      io,
      {
        createAudit: async () => {
          throw new Error("blocked");
        },
        http: async () => {
          calls.push("http");
          return jsonResult(200, { access_token: "t" });
        },
      },
    );
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("")).toContain(CYCLE_ERROR.AUDIT_PORT_UNAVAILABLE);
    expect(err.join("")).not.toContain("blocked");
  });

  test("--execute without DATABASE_URL aborts before HTTP", async () => {
    const calls: string[] = [];
    const { io, err } = capture();
    const code = await runCycle(
      ["create-scan", "--proband-id", "7", "--execute"],
      EXECUTE_ENV,
      io,
      {
        http: async () => {
          calls.push("http");
          return jsonResult(200, { access_token: "t" });
        },
      },
    );
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("")).toContain(CYCLE_ERROR.AUDIT_PORT_UNAVAILABLE);
    expect(err.join("")).toContain("DATABASE_URL");
  });

  test("--execute refuses tofu when no TLS pin is configured", async () => {
    const recorded = recordingAudit();
    const calls: string[] = [];
    const { io, err } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      ENV,
      io,
      {
        audit: recorded.audit,
        http: async () => {
          calls.push("http");
          return jsonResult(200, { access_token: "t" });
        },
      },
    );
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("")).toContain(CYCLE_ERROR.TLS_PIN_REQUIRED);
    expect(err.join("")).toContain("BODYLOOP_TLS_FINGERPRINT");
    expect(err.join("")).toContain("full SHA-256");
    expect(err.join("")).toContain("never the 12-char prefix");
  });

  test("dry-run is unaffected when no TLS pin is configured", async () => {
    const { io } = capture();
    const code = await runCycle(["create-proband", "--key-external", "synth-1"], ENV, io);
    expect(code).toBe(0);
  });

  test("login TLS pin mismatch prints TLS_PIN_MISMATCH without cause or URL", async () => {
    const recorded = recordingAudit();
    const { io, err } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        http: async () => {
          throw new TlsPinMismatchError();
        },
      },
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain(CYCLE_ERROR.TLS_PIN_MISMATCH);
    expect(err.join("")).not.toContain("scanner.example");
    expect(err.join("")).not.toContain("cause");
    expect(err.join("")).not.toContain("not-a-real-password");
  });

  test("login HTTP failure prints LOGIN_FAILED without response body", async () => {
    const recorded = recordingAudit();
    const { io, err } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        http: async () => jsonResult(401, { error: "nope", access_token: "secret" }),
      },
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain(CYCLE_ERROR.LOGIN_FAILED);
    expect(err.join("")).not.toContain("nope");
    expect(err.join("")).not.toContain("secret");
  });

  test("poll maps Ready to 0, Failed to 1, and timeout to 2", async () => {
    expect(targetPollOutcome("Ready")).toBe("ready");
    expect(targetPollOutcome("Failed")).toBe("error");
    expect(targetPollOutcome("Aborted")).toBe("error");
    expect(targetPollOutcome("Generating")).toBe("wait");

    const loginThen = (
      pathname: string,
      init: PinnedRequestInit,
    ): PinnedRequestResult => {
      if (pathname.endsWith("/authentification/token")) {
        return jsonResult(200, { access_token: "t" });
      }
      if (init.method === "POST" && pathname.endsWith("/targets/")) {
        return jsonResult(202, {});
      }
      return jsonResult(200, {
        viatar_id: 3,
        targets: {
          analyzed_avatar_3d: { state: { status: "Ready", progress: 1 } },
        },
      });
    };

    const ready = capture();
    const readyAudit = recordingAudit();
    expect(
      await runCycle(
        ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d", "--execute"],
        EXECUTE_ENV,
        ready.io,
        {
          audit: readyAudit.audit,
          readLine: async () => CONFIRM_LINE,
          sleep: async () => undefined,
          http: async (url, init) => loginThen(new URL(url).pathname, init),
        },
      ),
    ).toBe(0);
    expect(ready.out.join("")).toContain("analyzed_avatar_3d 1");

    const failed = capture();
    const failedAudit = recordingAudit();
    expect(
      await runCycle(
        ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d", "--execute"],
        EXECUTE_ENV,
        failed.io,
        {
          audit: failedAudit.audit,
          readLine: async () => CONFIRM_LINE,
          sleep: async () => undefined,
          http: async (url, init) => {
            const pathname = new URL(url).pathname;
            if (pathname.endsWith("/authentification/token")) {
              return jsonResult(200, { access_token: "t" });
            }
            if (init.method === "POST") return jsonResult(202, {});
            return jsonResult(200, {
              targets: {
                analyzed_avatar_3d: { state: { status: "Failed", progress: 0.2 } },
              },
            });
          },
        },
      ),
    ).toBe(1);
    expect(failedAudit.events.at(-1)?.tool).toBe(CYCLE_AUDIT_TOOL_POLL);
    expect(failedAudit.events.at(-1)?.result).toEqual({
      ticks: 1,
      state: "Failed",
      exit_code: 1,
    });

    let now = 0;
    const timed = capture();
    const timedAudit = recordingAudit();
    expect(
      await runCycle(
        ["start", "--viatar-id", "3", "--target", "analyzed_avatar_3d", "--execute"],
        EXECUTE_ENV,
        timed.io,
        {
          audit: timedAudit.audit,
          readLine: async () => CONFIRM_LINE,
          sleep: async () => undefined,
          now: () => now,
          http: async (url, init) => {
            const pathname = new URL(url).pathname;
            if (pathname.endsWith("/authentification/token")) {
              return jsonResult(200, { access_token: "t" });
            }
            if (init.method === "POST") return jsonResult(202, {});
            now = POLL_TIMEOUT_MS + 1;
            return jsonResult(200, {
              targets: {
                analyzed_avatar_3d: { state: { status: "Generating", progress: 0.1 } },
              },
            });
          },
        },
      ),
    ).toBe(2);
    expect(timedAudit.events.at(-1)?.result).toEqual({
      ticks: 1,
      state: "timeout",
      exit_code: 2,
    });
  });

  test("successful scanner write then append throw prints AUDIT_APPEND_FAILED and exits 1", async () => {
    const { io, err } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: async (input) => {
          if (input.tool === CYCLE_AUDIT_TOOL_CREATE_PROBAND) {
            throw new Error("append-down");
          }
          return {
            seq: BigInt(1),
            hash: "0".repeat(64),
            argsSha256: "a".repeat(64),
            resultSha256: "b".repeat(64),
          };
        },
        http: async (url) => {
          const path = new URL(url).pathname;
          if (path.endsWith("/authentification/token")) {
            return jsonResult(200, { access_token: "t" });
          }
          return jsonResult(200, { proband_id: 7 });
        },
      },
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain(CYCLE_ERROR.AUDIT_APPEND_FAILED);
    expect(err.join("")).toContain("scanner write succeeded");
    expect(err.join("")).not.toContain("append-down");
  });

  test("TLS, login, and HTTP failures do not print AUDIT_APPEND_FAILED when append throws", async () => {
    const failingAudit = async () => {
      throw new Error("append-down");
    };

    const tls = capture();
    expect(
      await runCycle(
        ["create-proband", "--key-external", "synth-1", "--execute"],
        EXECUTE_ENV,
        tls.io,
        {
          audit: failingAudit,
          http: async () => {
            throw new TlsPinMismatchError();
          },
        },
      ),
    ).toBe(1);
    expect(tls.err.join("")).toContain(CYCLE_ERROR.TLS_PIN_MISMATCH);
    expect(tls.err.join("")).not.toContain(CYCLE_ERROR.AUDIT_APPEND_FAILED);

    const login = capture();
    expect(
      await runCycle(
        ["create-proband", "--key-external", "synth-1", "--execute"],
        EXECUTE_ENV,
        login.io,
        {
          audit: failingAudit,
          http: async () => jsonResult(401, { error: "nope" }),
        },
      ),
    ).toBe(1);
    expect(login.err.join("")).toContain(CYCLE_ERROR.LOGIN_FAILED);
    expect(login.err.join("")).not.toContain(CYCLE_ERROR.AUDIT_APPEND_FAILED);

    const httpFail = capture();
    expect(
      await runCycle(
        ["create-proband", "--key-external", "synth-1", "--execute"],
        EXECUTE_ENV,
        httpFail.io,
        {
          audit: async (input) => {
            if (input.tool === CYCLE_AUDIT_TOOL_CREATE_PROBAND) {
              throw new Error("append-down");
            }
            return {
              seq: BigInt(1),
              hash: "0".repeat(64),
              argsSha256: "a".repeat(64),
              resultSha256: "b".repeat(64),
            };
          },
          http: async (url) => {
            const path = new URL(url).pathname;
            if (path.endsWith("/authentification/token")) {
              return jsonResult(200, { access_token: "t" });
            }
            return jsonResult(500, { error: "nope" });
          },
        },
      ),
    ).toBe(1);
    expect(httpFail.err.join("")).toContain(CYCLE_ERROR.HTTP_FAILED);
    expect(httpFail.err.join("")).not.toContain(CYCLE_ERROR.AUDIT_APPEND_FAILED);
    expect(httpFail.err.join("")).not.toContain("nope");
  });

  test("printCaught maps an audit-port error to AUDIT_PORT_UNAVAILABLE, not HTTP_FAILED", async () => {
    const recorded = recordingAudit();
    const { io, err } = capture();
    const code = await runCycle(
      ["create-proband", "--key-external", "synth-1", "--execute"],
      EXECUTE_ENV,
      io,
      {
        audit: recorded.audit,
        http: async () => {
          throw new Error("AUDIT_PORT_UNAVAILABLE");
        },
      },
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain(CYCLE_ERROR.AUDIT_PORT_UNAVAILABLE);
    expect(err.join("")).not.toContain(CYCLE_ERROR.HTTP_FAILED);
  });
});
