import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

mock.module("server-only", () => ({}));

const spawnSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "spawn.ts"),
  "utf8",
);

const { setArkAdapterTestHooks } = await import("./hooks");
const { setArkNodeSpawnForTests, spawnArk } = await import("./spawn");

setArkAdapterTestHooks({
  env: { GENOME_SOURCE: "ark" },
  audit: async () => undefined,
});

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: () => boolean;
};

const makeChild = (onKill?: (child: FakeChild) => void): FakeChild => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as FakeChild;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {
    onKill?.(child);
    return true;
  };
  return child;
};

const endAndClose = (child: FakeChild, signal: NodeJS.Signals) => {
  child.stdout.end();
  child.stderr.end();
  child.emit("close", null, signal);
};

describe("ark-adapter spawn source", () => {
  test("does not reference globalThis.Bun", () => {
    expect(spawnSource).not.toContain("globalThis.Bun");
    expect(spawnSource).not.toContain("Bun.spawn");
    expect(spawnSource).toContain("node:child_process");
  });
});

describe("ark-adapter spawn close mapping", () => {
  afterEach(() => {
    setArkNodeSpawnForTests(null);
  });

  test("host timeout calls kill and maps to exit 7", async () => {
    const kills: FakeChild[] = [];
    setArkNodeSpawnForTests(() =>
      makeChild((child) => {
        kills.push(child);
        endAndClose(child, "SIGTERM");
      }),
    );

    const result = await spawnArk(["status"], { hostTimeoutMs: 15 });
    expect(kills).toHaveLength(1);
    expect(result).toMatchObject({
      kind: "spawned",
      exitCode: 7,
      timedOut: true,
    });
  });

  test("close(null, SIGINT) maps to 130", async () => {
    setArkNodeSpawnForTests(() => {
      const child = makeChild();
      queueMicrotask(() => endAndClose(child, "SIGINT"));
      return child;
    });

    const result = await spawnArk(["status"]);
    expect(result).toMatchObject({
      kind: "spawned",
      exitCode: 130,
      timedOut: false,
    });
  });

  test("close(null, SIGTERM) maps to 143", async () => {
    setArkNodeSpawnForTests(() => {
      const child = makeChild();
      queueMicrotask(() => endAndClose(child, "SIGTERM"));
      return child;
    });

    const result = await spawnArk(["status"]);
    expect(result).toMatchObject({
      kind: "spawned",
      exitCode: 143,
      timedOut: false,
    });
  });
});

afterAll(() => {
  setArkAdapterTestHooks({ env: null, audit: null });
  setArkNodeSpawnForTests(null);
});
