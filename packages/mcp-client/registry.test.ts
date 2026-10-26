import { describe, expect, test } from "bun:test";

import { findServer, MCP_SERVERS } from "./registry";

describe("MCP server registry", () => {
  test("findServer returns the gbd entry by name", () => {
    expect(findServer("gbd")).toEqual({
      name: "gbd",
      transport: "http",
      locality: "remote",
    });
  });

  test("findServer returns undefined for an unknown name", () => {
    expect(findServer("not-a-server")).toBeUndefined();
  });

  test("the registry lists gbd only", () => {
    expect(MCP_SERVERS.map((server) => server.name)).toEqual(["gbd"]);
  });
});
