import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import { GLB_MODEL_PREFERENCE } from "./models";
import { buildVitronicSummary } from "./summary";
import { newestViatarForProbandId } from "./viatars";

const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const inCi = Reflect.get(process.env, "CI") === "true";

describe.skipIf(!runLive || inCi)("BodyLoop live (RUN_LIVE=1, never CI)", () => {
  test("status, newest viatar by integer scan key, units, no banned paths", async () => {
    const baseUrl = Reflect.get(process.env, "VITRONIC_BASE_URL");
    const apiToken = Reflect.get(process.env, "VITRONIC_API_TOKEN");
    const rawId = Reflect.get(process.env, "VITRONIC_PROBAND_ID");
    const pinned = Reflect.get(process.env, "VITRONIC_TLS_FINGERPRINT");
    if (typeof baseUrl !== "string" || typeof apiToken !== "string" || typeof rawId !== "string") {
      throw new Error("VITRONIC_BASE_URL, VITRONIC_API_TOKEN, and VITRONIC_PROBAND_ID are required");
    }
    const scanKey = Number.parseInt(rawId, 10);
    if (!Number.isInteger(scanKey) || scanKey < 1) {
      throw new Error("VITRONIC_PROBAND_ID must be a positive integer");
    }

    const { captureTlsFingerprint, fetchAvatarGlb, getMeasurementSets, getViatar, listViatarsForProbandId } =
      await import("./client");

    const paths: string[] = [];
    const onRequestPath = (path: string) => {
      paths.push(path);
    };

    const tlsFingerprintSha256 =
      typeof pinned === "string" && pinned.length > 0
        ? pinned
        : await captureTlsFingerprint({ baseUrl, apiToken, onRequestPath });

    const config = {
      baseUrl,
      apiToken,
      tlsFingerprintSha256,
      onRequestPath,
    };

    const listed = await listViatarsForProbandId(config, scanKey);
    expect(Array.isArray(listed)).toBe(true);
    const newest = newestViatarForProbandId(listed, scanKey);
    expect(newest).toBeDefined();
    if (!newest) throw new Error("expected a viatar for VITRONIC_PROBAND_ID");
    const viatar = (await getViatar(config, newest.viatar_id)) ?? newest;
    const sets = await getMeasurementSets(config, viatar.viatar_id);
    const summary = buildVitronicSummary({
      scanId: String(viatar.viatar_id),
      effectiveDateTime: viatar.meta?.crtime ?? undefined,
      height: Array.isArray(sets.height) ? (sets.height as never) : undefined,
      distance: Array.isArray(sets.distance) ? (sets.distance as never) : undefined,
      angle: Array.isArray(sets.angle) ? (sets.angle as never) : undefined,
      cross_section: sets.cross_section,
      properties: Array.isArray(sets.properties) ? (sets.properties as never) : undefined,
    });
    const avatar = await fetchAvatarGlb(config, viatar.viatar_id);
    expect(
      avatar.chosen === null ||
        (GLB_MODEL_PREFERENCE as readonly string[]).includes(avatar.chosen),
    ).toBe(true);
    if (avatar.bytes) expect(avatar.chosen).toBeTruthy();
    for (const metric of summary.metrics) {
      expect(typeof metric.unit).toBe("string");
      expect(metric.unit?.length).toBeGreaterThan(0);
    }
    const heightMetric = summary.metrics.find((row) => row.key.startsWith("vitronic.property.body.height."));
    if (heightMetric) expect(heightMetric.unit).toBe("m");
    const bmiMetric = summary.metrics.find((row) => row.key.startsWith("vitronic.property.body.bmi."));
    if (bmiMetric) expect(bmiMetric.unit).toBe("kg/m2");
    expect(paths.some((path) => path.includes("/viatars"))).toBe(true);
    expect(paths.some((path) => path.includes("/probands"))).toBe(false);
  });
});
