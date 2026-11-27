import { expect, mock, test } from "bun:test";

import { type AppendInput } from "@/packages/audit/append";
import { LOINC_SYSTEM } from "@/packages/query-tools/imported-ports";

import { type ImportedDayObservation } from "./your-day-personal-observations";
import { readPersonalReplay, type PersonalReplayDeps } from "./your-day-personal-reader";

const actor = "auth-actor";
const userId = "app-user";
const day = "2026-10-25";
const zone = "Europe/Zurich";
const row: ImportedDayObservation = {
  id: "stored-row",
  datasetId: "stored-dataset",
  code: "2276-4",
  codeSystem: LOINC_SYSTEM,
  display: "Ferritin",
  value: 45,
  unit: "ng/mL",
  effectiveAt: new Date(`${day}T08:00:00Z`),
  effectivePrecision: "instant",
};

const dependencies = (
  rows: readonly ImportedDayObservation[],
  write: PersonalReplayDeps["append"] = async () => undefined,
) => ({
  readPersonalDayObservations: mock(
    async (..._args: Parameters<PersonalReplayDeps["readPersonalDayObservations"]>) =>
      rows,
  ),
  getLatestOuraBundle: mock(async (_userId: string) => null),
  getLatestWhoopBundle: mock(async (_userId: string) => null),
  getLatestGoogleHealthBundle: mock(async (_userId: string) => ({
    resourceType: "Bundle",
    entry: [
      {
        resource: {
          resourceType: "Observation",
          effectiveDateTime: `${day}T08:30:00Z`,
          code: { coding: [{ system: LOINC_SYSTEM, code: "8867-4" }] },
          valueQuantity: { value: 72, code: "/min" },
        },
      },
    ],
  })),
  append: mock(write),
});

test("reads the scoped day, audits only the returned row count, then releases the replay", async () => {
  const started = Promise.withResolvers<AppendInput>();
  const audited = Promise.withResolvers<void>();
  const deps = dependencies(
    [row, { ...row, effectiveAt: new Date("2026-10-25T23:15:00Z") }],
    (input) => {
      started.resolve(input);
      return audited.promise;
    },
  );
  const pending = readPersonalReplay(deps, actor, userId, day, zone);
  const returned = mock(() => undefined);
  void pending.then(returned);
  expect(await started.promise).toEqual({
    actor,
    sessionId: actor,
    subjectRef: null,
    tool: "personal.read.day-replay",
    args: { purpose: "day-replay" },
    result: { rowCount: 2 },
    rowCount: 2,
  });
  expect(deps.readPersonalDayObservations).toHaveBeenCalledWith(
    userId,
    new Date("2026-10-24T22:00:00Z"),
    new Date("2026-10-26T00:00:00Z"),
    5001,
  );
  expect(deps.getLatestOuraBundle).toHaveBeenCalledWith(userId);
  expect(deps.getLatestWhoopBundle).toHaveBeenCalledWith(userId);
  expect(deps.getLatestGoogleHealthBundle).toHaveBeenCalledWith(userId);
  expect(deps.append).toHaveBeenCalledTimes(1);
  expect(returned).not.toHaveBeenCalled();
  audited.resolve();
  const replay = await pending;
  expect(replay.chartData.day.origin).toBe("recorded");
  expect(replay.observations.map(({ provenance }) => provenance)).toEqual([
    "imported",
    "measured",
  ]);
});

test("refuses an over-limit import read without emitting an audit row", async () => {
  const deps = dependencies(Array.from({ length: 5001 }, () => row));
  await expect(readPersonalReplay(deps, actor, userId, day, zone)).rejects.toThrow(
    "PersonalReplayRowLimit",
  );
  expect(deps.append).not.toHaveBeenCalled();
});

test("does not return personal replay data if the audit append rejects", async () => {
  const failure = new Error("audit unavailable");
  const deps = dependencies([row], async () => {
    throw failure;
  });
  await expect(readPersonalReplay(deps, actor, userId, day, zone)).rejects.toBe(failure);
});
