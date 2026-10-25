import { describe, expect, test } from "bun:test";

import {
  mergeRemoteGpuRoutes,
  mergeVllmRouteTable,
  routeInTable,
  type VllmRouteTable,
} from "./fetch-model-catalog";

/** Two catalog fetches in flight at once, one of which missed a port. */
describe("mergeRemoteGpuRoutes", () => {
  const PORT_A = "http://127.0.0.1:8000/v1";
  const PORT_B = "http://127.0.0.1:8002/v1";

  test("a fetch that missed one port keeps the route an earlier fetch found", () => {
    const both = new Map([
      ["synthetic/model-a", PORT_A],
      ["synthetic/model-b", PORT_B],
    ]);
    const missedB = new Map([["synthetic/model-a", PORT_A]]);

    expect([...mergeRemoteGpuRoutes(both, missedB)]).toEqual([
      ["synthetic/model-a", PORT_A],
      ["synthetic/model-b", PORT_B],
    ]);
  });

  test("a model that moved port goes to the port the newest fetch saw", () => {
    const before = new Map([["synthetic/model-a", PORT_A]]);
    const after = new Map([["synthetic/model-a", PORT_B]]);

    expect([...mergeRemoteGpuRoutes(before, after)]).toEqual([
      ["synthetic/model-a", PORT_B],
    ]);
  });
});

/** One shared table, but remote-gpu and exoscale routes never mix. */
describe("mergeVllmRouteTable", () => {
  const TUNNEL = "http://127.0.0.1:8000/v1";
  const GPU_1 = "https://gpu1.example.invalid/v1";
  const EMPTY: VllmRouteTable = new Map();

  test("the same id listed by both providers keeps one route per provider", () => {
    const withTunnel = mergeVllmRouteTable(
      EMPTY,
      "remote-gpu",
      new Map([["Qwen/Qwen3-8B", TUNNEL]]),
    );
    const both = mergeVllmRouteTable(
      withTunnel,
      "exoscale",
      new Map([["Qwen/Qwen3-8B", GPU_1]]),
    );

    expect(routeInTable(both, "remote-gpu", "Qwen/Qwen3-8B")).toBe(TUNNEL);
    expect(routeInTable(both, "exoscale", "Qwen/Qwen3-8B")).toBe(GPU_1);
  });

  test("an id only a remote-gpu tunnel listed has no exoscale route", () => {
    const table = mergeVllmRouteTable(
      EMPTY,
      "remote-gpu",
      new Map([["apertus-70b-fp8", TUNNEL]]),
    );

    expect(routeInTable(table, "exoscale", "apertus-70b-fp8")).toBeNull();
    expect(routeInTable(table, "remote-gpu", "apertus-70b-fp8")).toBe(TUNNEL);
  });

  test("merging one provider leaves the other's routes and the input untouched", () => {
    const start = mergeVllmRouteTable(EMPTY, "exoscale", new Map([["m", GPU_1]]));
    const next = mergeVllmRouteTable(start, "remote-gpu", new Map([["n", TUNNEL]]));

    expect([...(next.get("exoscale") ?? [])]).toEqual([["m", GPU_1]]);
    expect([...(next.get("remote-gpu") ?? [])]).toEqual([["n", TUNNEL]]);
    expect([...start.keys()]).toEqual(["exoscale"]);
  });
});
