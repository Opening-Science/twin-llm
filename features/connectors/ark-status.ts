import {
  allPathsStartWithGenome,
  ARK_SLOT_NAMES,
  dataList,
  dataPaths,
  isArkOk,
  status,
  type ArkDataListDocument,
  type ArkDataPathsDocument,
  type ArkResult,
  type ArkStatusSafe,
} from "@/packages/ark-adapter";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { serverEnv } from "@/infrastructure/env";

/**
 * Read-only Connectors inventory. Status, slot list, and path counts only —
 * never pubkey, identity, path names, or dataset bytes. Every adapter call
 * is audited with a per-request session id and the signed-in actor.
 */

type StatusFn = (ctx: {
  readonly actor: string;
  readonly sessionId: string;
}) => Promise<ArkResult<ArkStatusSafe>>;

type DataListFn = (ctx: {
  readonly actor: string;
  readonly sessionId: string;
}) => Promise<ArkResult<ArkDataListDocument>>;

type DataPathsFn = (ctx: {
  readonly actor: string;
  readonly sessionId: string;
}) => Promise<ArkResult<ArkDataPathsDocument>>;

export type ArkStatusPorts = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly genomeSource: () => "none" | "ark";
  readonly status: StatusFn;
  readonly dataList: DataListFn;
  readonly dataPaths: DataPathsFn;
};

const defaultPorts = (): ArkStatusPorts => ({
  resolveActorId,
  genomeSource: () => serverEnv().GENOME_SOURCE,
  status,
  dataList,
  dataPaths,
});

const SLOT_LABEL: Readonly<Record<(typeof ARK_SLOT_NAMES)[number], string>> = {
  "reference-genome": "Reference genome",
  "gene-annotations": "Gene annotations",
  "small-variants": "Small variants",
  "structural-variants": "Structural variants",
  "copy-number-variants": "Copy number variants",
  "variant-catalog": "Variant catalog",
};

const isKnownSlot = (value: string): value is (typeof ARK_SLOT_NAMES)[number] =>
  (ARK_SLOT_NAMES as readonly string[]).includes(value);

const publicSlotId = (row: {
  readonly slot: string | number;
  readonly name: string;
}): string => {
  const raw = String(row.slot);
  if (isKnownSlot(raw)) return raw;
  if (isKnownSlot(row.name)) return row.name;
  return raw;
};

const publicSlotName = (slot: string, name: string): string => {
  if (isKnownSlot(name) && name === slot) return SLOT_LABEL[name];
  return name;
};

/** CLI 0.5.0 gives the catalog's dbSNP release as a number (157). */
const slotVersion = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : null;

const unavailable = (state: string, code: string): Response =>
  Response.json({ enabled: true, state, error: { code } });

/**
 * ArkStatusSafe is Omit<looseObject, "pubkey">, which widens nested fields
 * to unknown. Re-read the inventory fields we actually return.
 */
const hardwareView = (
  value: unknown,
): { model: string; version: string; revision: string } | null => {
  if (typeof value !== "object" || value === null) return null;
  const { model, version, revision } = value as Record<string, unknown>;
  if (
    typeof model !== "string" ||
    typeof version !== "string" ||
    typeof revision !== "string"
  ) {
    return null;
  }
  return { model, version, revision };
};

const firmwareVersion = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const { version } = value as Record<string, unknown>;
  return typeof version === "string" ? version : null;
};

export const getArkStatusResponse = async (
  ports: Partial<ArkStatusPorts> = {},
): Promise<Response> => {
  const {
    resolveActorId: resolve,
    genomeSource,
    status: readStatus,
    dataList: readList,
    dataPaths: readPaths,
  } = { ...defaultPorts(), ...ports };

  const actor = await resolve();
  if (!actor) {
    return Response.json({ error: "Sign in to view Ark status." }, { status: 401 });
  }

  if (genomeSource() !== "ark") {
    return Response.json({ enabled: false });
  }

  const ctx = { actor, sessionId: crypto.randomUUID() };

  const device = await readStatus(ctx);
  if (!isArkOk(device)) {
    return unavailable(device.status, device.error.code);
  }

  const listed = await readList(ctx);
  if (!isArkOk(listed)) {
    return unavailable(listed.status, listed.error.code);
  }

  const listedPaths = await readPaths(ctx);
  if (!isArkOk(listedPaths)) {
    return unavailable(listedPaths.status, listedPaths.error.code);
  }

  const hardware = hardwareView(device.data.hardware);
  const firmware = firmwareVersion(device.data.firmware);
  if (
    hardware === null ||
    firmware === null ||
    typeof device.data.serial !== "string" ||
    typeof device.data.trust !== "string"
  ) {
    return unavailable("error", "invalid-document");
  }

  const slots = listed.data.slots.map((row) => {
    const slot = publicSlotId(row);
    return {
      slot,
      name: publicSlotName(slot, row.name),
      state: row.state === "empty" ? ("empty" as const) : ("filled" as const),
      build: typeof row.build === "string" ? row.build : null,
      version: slotVersion(row.version),
    };
  });

  return Response.json({
    enabled: true,
    state: "ok",
    serial: device.data.serial,
    hardware,
    firmware,
    trust: device.data.trust,
    paired: typeof device.data.paired === "boolean" ? device.data.paired : null,
    unlocked: typeof device.data.unlocked === "boolean" ? device.data.unlocked : null,
    slots,
    pathCount: listedPaths.data.paths.length,
    allGenome: allPathsStartWithGenome(listedPaths.data.paths),
  });
};
