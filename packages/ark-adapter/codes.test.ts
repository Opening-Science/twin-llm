import { describe, expect, test } from "bun:test";

import { errorFromExitCode, mapArkFailure, toArkError } from "./codes";

describe("ark-adapter exit and error map", () => {
  test("maps stable error codes onto the six states", () => {
    expect(mapArkFailure(toArkError("locked", "locked")).status).toBe("locked");
    expect(mapArkFailure(toArkError("not-paired", "unpaired")).status).toBe("unpaired");
    expect(mapArkFailure(toArkError("device-busy", "busy")).status).toBe("busy");
    expect(mapArkFailure(toArkError("approval-denied", "denied")).status).toBe("refused");
    expect(mapArkFailure(toArkError("approval-timeout", "wait")).status).toBe(
      "awaiting_approval",
    );
    expect(mapArkFailure(toArkError("no-device", "missing")).status).toBe("error");
    expect(mapArkFailure(toArkError("usage", "bad args")).status).toBe("error");
  });

  test("does not map remote ark numbers", () => {
    const failure = mapArkFailure(
      toArkError("ark", "device verdict", "9001", "remote text"),
    );
    expect(failure.status).toBe("error");
    expect(failure.error.code).toBe("ark");
    expect(failure.error.remoteCode).toBe("9001");
  });

  test("exit-code fallbacks stay in the error state", () => {
    expect(errorFromExitCode(2).code).toBe("usage");
    expect(errorFromExitCode(3).code).toBe("device-access");
    expect(errorFromExitCode(8).code).toBe("app-failed");
    expect(mapArkFailure(errorFromExitCode(7)).status).toBe("error");
  });
});
