export type GbdStatusUnconfigured = {
  readonly configured: false;
};

export type GbdStatusOk = {
  readonly configured: true;
  readonly state: "ok";
  readonly tools: readonly string[];
};

export type GbdStatusError = {
  readonly configured: true;
  readonly state: "error";
};

export type GbdStatusPayload = GbdStatusUnconfigured | GbdStatusOk | GbdStatusError;

export const isGbdStatusPayload = (value: unknown): value is GbdStatusPayload => {
  if (typeof value !== "object" || value === null || !("configured" in value)) {
    return false;
  }
  const payload = value as { configured?: unknown; state?: unknown; tools?: unknown };
  if (payload.configured === false) return true;
  if (payload.configured !== true) return false;
  if (payload.state === "error") return true;
  return (
    payload.state === "ok" &&
    Array.isArray(payload.tools) &&
    payload.tools.every((name) => typeof name === "string")
  );
};
