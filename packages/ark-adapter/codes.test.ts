import { describe, expect, test } from "bun:test";

import { errorFromExitCode, errorFromObject, mapArkFailure, toArkError } from "./codes";

describe("ark-adapter exit and error map", () => {
  test("maps stable error codes onto adapter states", () => {
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

  test("0.5.0 codes for exit classes 4, 5, 6 and 8", () => {
    expect(mapArkFailure(toArkError("approval-undelivered", "x")).status).toBe(
      "undelivered",
    );
    expect(mapArkFailure(toArkError("firmware-outdated", "x")).status).toBe("outdated");
    expect(mapArkFailure(toArkError("app-failed", "x")).status).toBe("app_failed");
    expect(mapArkFailure(errorFromExitCode(8)).status).toBe("app_failed");
  });

  test("an Ark refusal is rejected, whatever its remote number", () => {
    const failure = mapArkFailure(
      toArkError("ark", "device verdict", "9001", "remote text"),
    );
    expect(failure.status).toBe("rejected");
    expect(failure.error.code).toBe("ark");
    expect(failure.error.remoteCode).toBe("9001");
  });

  test("reads the 0.5.0 remote object and the older flat fields", () => {
    expect(
      errorFromObject({
        code: "ark",
        message: "m",
        remote: { code: 7, message: "r" },
      }),
    ).toEqual({ code: "ark", message: "m", remoteCode: "7", remoteMessage: "r" });
    expect(errorFromObject({ code: "ark", message: "m", remote_code: "8" })).toEqual({
      code: "ark",
      message: "m",
      remoteCode: "8",
    });
  });

  test("exit-code fallbacks stay in the error state", () => {
    expect(errorFromExitCode(2).code).toBe("usage");
    expect(errorFromExitCode(3).code).toBe("device-access");
    expect(errorFromExitCode(8).code).toBe("app-failed");
    expect(mapArkFailure(errorFromExitCode(7)).status).toBe("error");
  });
});
