import "server-only";

import type { AppendInput, AppendedEvent } from "@/packages/audit/append";
import { append } from "@/packages/audit/append";
import {
  captureTlsFingerprint,
  fetchAvatarGlb,
  getMeasurementSets,
  getViatar,
  listViatarsForProbandId,
  type VitronicBearerConfig,
  type VitronicViatar,
} from "@/packages/vitronic/client";
import { parseScannerHosts, scannerOrigin } from "@/packages/vitronic/base-url";
import {
  type FieldCipher,
  openJson,
  openNullableJson,
  sealJson,
  sealNullableJson,
} from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import { persistGlb, loadGlb } from "@/packages/vitronic/glb";
import { buildStoredGeometry } from "@/packages/vitronic/geometry";
import {
  buildVitronicSummary,
  propertyRowsFromSummary,
  toChatVitronicSummary,
} from "@/packages/vitronic/summary";
import { fingerprintPrefix } from "@/packages/vitronic/tls";
import {
  mergeStoredScanRefs,
  newestViatarForProbandId,
  presetNameFromViatar,
  scanRefsForViatars,
  type SnapshotSyncFacts,
  type VitronicScanRef,
} from "@/packages/vitronic/viatars";
import { database } from "@/infrastructure/database";
import { vitronicEnv, vitronicScannerHosts } from "@/infrastructure/env";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";

import {
  parseConsentTime,
  VITRONIC_SELF_LABEL,
  VITRONIC_SUBJECT_SOURCE_SCANNER,
  type CreateSubjectInput,
} from "./subject-schema";
import { liveOrFallback } from "./live-fallback";
import { decryptVitronicSecret, encryptVitronicSecret } from "./token-crypto";

export const VITRONIC_AUDIT_TOOL = "vitronic.sync";
export const VITRONIC_SCANS_AUDIT_TOOL = "vitronic.scans";
export const VITRONIC_FILES_AUDIT_TOOL = "vitronic.files";
export const VITRONIC_SUBJECTS_AUDIT_TOOL = "vitronic.subjects";
export const VITRONIC_SUBJECTS_LIST_AUDIT_TOOL = "vitronic.subjects.list";
export const VITRONIC_SUBJECT_DEFAULT_AUDIT_TOOL = "vitronic.subjects.default";
export const VITRONIC_SNAPSHOTS_LIST_AUDIT_TOOL = "vitronic.snapshots.list";
export const VITRONIC_CHAT_SUMMARY_AUDIT_TOOL = "vitronic.chat.summary";
/** Wearables page GET of the same reader; chat keeps VITRONIC_CHAT_SUMMARY_AUDIT_TOOL. */
export const VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL = "vitronic.wearables.summary";
export const VITRONIC_CONNECTION_STATUS_AUDIT_TOOL = "vitronic.connection.status";
export const VITRONIC_AVATAR_AUDIT_TOOL = "vitronic.avatar";
/** A snapshot write naming a subject the actor does not own; recorded, nothing written. */
export const VITRONIC_WRITE_REFUSED_AUDIT_TOOL = "vitronic.write.refused";

export type VitronicSummaryAuditTool =
  typeof VITRONIC_CHAT_SUMMARY_AUDIT_TOOL | typeof VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL;

type LocalReadDb = () => {
  vitronicSubject: {
    findMany: (args: unknown) => Promise<readonly VitronicSubjectRow[]>;
  };
  vitronicConnection: {
    findUnique: (args: unknown) => Promise<{
      lastSyncAt: Date | null;
      tlsFingerprintSha256: string | null;
    } | null>;
  };
  vitronicSnapshot: {
    findMany: (args: unknown) => Promise<
      ReadonlyArray<{
        id: string;
        viatarId: number;
        glbSha256: string | null;
        syncedAt: Date;
        summary: string;
        markers: string | null;
        measures: string | null;
        presetName: string | null;
      }>
    >;
    findFirst: (args: unknown) => Promise<{
      id: string;
      summary: string;
      subjectId: string;
      glbSha256?: string | null;
      syncedAt?: Date;
    } | null>;
  };
};

export type VitronicLocalReadPorts = Readonly<{
  append: (input: AppendInput) => Promise<AppendedEvent>;
  database: LocalReadDb;
  /** The owner's cipher (#141); the default refuses while their vault is locked. */
  cipher: (userId: string) => Promise<FieldCipher>;
}>;

const SNAPSHOTS = "vitronic_snapshots";
const SUBJECTS = "vitronic_subjects";

const openSummary = (cipher: FieldCipher, id: string, stored: string): VitronicSummary =>
  openJson(cipher, SNAPSHOTS, "summary", id, stored) as VitronicSummary;

const openGeometry = (
  cipher: FieldCipher,
  id: string,
  row: Readonly<{ markers: string | null; measures: string | null }>,
) => ({
  markers: openNullableJson(cipher, SNAPSHOTS, "markers", id, row.markers),
  measures: openNullableJson(cipher, SNAPSHOTS, "measures", id, row.measures),
});

/** A subject row as shown: the label opened; the consent note is never read back. */
const openSubject = <T extends Readonly<{ id: string; label: string }>>(
  cipher: FieldCipher,
  row: T,
): T => ({ ...row, label: cipher.openText(SUBJECTS, "label", row.id, row.label) });

type HeightRow = {
  readonly height_path: string;
  readonly height: number;
  readonly at_marker?: string;
  readonly details?: unknown;
};
type DistanceRow = {
  readonly distance_path: string;
  readonly distances: { readonly linear_distance: number };
};
type AngleRow = {
  readonly angle_path: string;
  readonly angles: { readonly primary: number };
};
type PropertyRow = { readonly property_path: string; readonly value: unknown };

export type VitronicIngestInput = Readonly<{
  subjectId: string;
  scan_id?: string | number;
  viatar?: {
    readonly viatar_id: number;
    readonly proband_id?: number | null;
    readonly key_external?: string | null;
    readonly meta?: { readonly crtime?: string | null } | null;
  };
  effectiveDateTime?: string;
  height?: readonly HeightRow[];
  distance?: readonly DistanceRow[];
  angle?: readonly AngleRow[];
  axis?: unknown;
  cross_section?: unknown;
  marker?: unknown;
  properties?: readonly PropertyRow[];
  glb?: Uint8Array;
  glbModelName?: string;
  presetName?: string | null;
}>;

export type VitronicConnectInput = Readonly<{
  baseUrl: string;
  apiToken: string;
  probandId: number;
  uploadSecret?: string;
  apiTokenName?: string;
}>;

export type VitronicSubjectRow = Readonly<{
  id: string;
  label: string;
  source: string;
  isSelf: boolean;
  probandId: number | null;
  defaultViatarId: number | null;
}>;

export type VitronicSnapshotCard = Readonly<{
  id: string;
  viatarId: number;
  hasAvatar: boolean;
  syncedAt: string;
  presetName: string | null;
  properties: ReturnType<typeof propertyRowsFromSummary>;
  markers: unknown;
  measures: unknown;
}>;

export type VitronicSnapshotPorts = {
  readonly database: () => {
    vitronicSubject: {
      findFirst: (args: {
        where: { id: string; userId: string };
        select: { id: true };
      }) => Promise<{ id: string } | null>;
    };
    vitronicSnapshot: {
      findUnique: (args: {
        where: { subjectId_viatarId: { subjectId: string; viatarId: number } };
        select: { id: true };
      }) => Promise<{ id: string } | null>;
      upsert: (args: {
        where: { subjectId_viatarId: { subjectId: string; viatarId: number } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<unknown>;
    };
    vitronicConnection: {
      updateMany: (args: {
        where: { userId: string };
        data: { lastSyncAt: Date };
      }) => Promise<unknown>;
    };
  };
  readonly append: (input: AppendInput) => Promise<AppendedEvent>;
  /** Writes the mesh file, sealed with `cipher` in personal mode (#141). */
  readonly persistGlb: (
    userId: string,
    bytes: Uint8Array,
    cipher: FieldCipher,
  ) => Promise<string>;
  readonly cipher: (userId: string) => Promise<FieldCipher>;
};

const defaultSnapshotPorts = (): VitronicSnapshotPorts =>
  ({
    database,
    append: (input: AppendInput) => append(database(), input),
    persistGlb,
    cipher: cipherForUser,
  }) as unknown as VitronicSnapshotPorts;

const defaultLocalAppend = (input: AppendInput): Promise<AppendedEvent> =>
  append(database(), input);

const localReadDb = (opts?: {
  readonly ports?: Partial<VitronicLocalReadPorts>;
}): LocalReadDb => opts?.ports?.database ?? (database as unknown as LocalReadDb);

const localReadCipher = (opts?: {
  readonly ports?: Partial<VitronicLocalReadPorts>;
}): ((userId: string) => Promise<FieldCipher>) => opts?.ports?.cipher ?? cipherForUser;

const localReadAppend = (opts?: {
  readonly ports?: Partial<VitronicLocalReadPorts>;
}): ((input: AppendInput) => Promise<AppendedEvent>) =>
  opts?.ports?.append ?? defaultLocalAppend;

const scanDateTime = (input: VitronicIngestInput): string | undefined =>
  input.effectiveDateTime ?? input.viatar?.meta?.crtime ?? undefined;

const scanIdOf = (input: VitronicIngestInput): string => {
  if (input.scan_id !== undefined) return String(input.scan_id);
  if (input.viatar) return String(input.viatar.viatar_id);
  return "unknown";
};

const resolveViatarId = (input: VitronicIngestInput, glbSha256?: string): number => {
  const fromViatar = input.viatar?.viatar_id;
  if (Number.isInteger(fromViatar)) return fromViatar as number;
  const parsed = Number.parseInt(scanIdOf(input), 10);
  if (Number.isInteger(parsed)) return parsed;
  if (glbSha256) {
    const derived = Number.parseInt(glbSha256.slice(0, 8), 16) % 1_000_000_000;
    return derived === 0 ? 1 : derived;
  }
  throw new Error("vitronic-viatar-id-rejected");
};

export class VitronicSubjectNotOwnedError extends Error {
  readonly status = 404;
  constructor() {
    super("vitronic-subject-not-found");
    this.name = "VitronicSubjectNotOwnedError";
  }
}

/**
 * Every snapshot write goes through here, so ownership is checked here rather than
 * in each route: the subject must belong to the writing user before anything (the
 * mesh file included) is written. A refusal is audited under the actor's session.
 */
const persistSnapshot = async (params: {
  readonly userId: string;
  readonly input: VitronicIngestInput;
  readonly actor: string;
  readonly tool?: string;
  readonly ports?: Partial<VitronicSnapshotPorts>;
}) => {
  const ports = { ...defaultSnapshotPorts(), ...params.ports };
  const owned = await ports.database().vitronicSubject.findFirst({
    where: { id: params.input.subjectId, userId: params.userId },
    select: { id: true },
  });
  if (!owned) {
    await ports.append({
      actor: params.actor,
      sessionId: params.userId,
      subjectRef: null,
      tool: VITRONIC_WRITE_REFUSED_AUDIT_TOOL,
      args: {
        subjectId: params.input.subjectId,
        tool: params.tool ?? VITRONIC_AUDIT_TOOL,
      },
      result: { refused: true },
      rowCount: 0,
    });
    throw new VitronicSubjectNotOwnedError();
  }
  const scanId = scanIdOf(params.input);
  const effectiveDateTime = scanDateTime(params.input);
  const summary = buildVitronicSummary({
    scanId,
    effectiveDateTime,
    height: params.input.height,
    distance: params.input.distance,
    angle: params.input.angle,
    cross_section: params.input.cross_section,
    properties: params.input.properties,
  });
  const geometry = buildStoredGeometry({
    marker: params.input.marker,
    height: params.input.height,
    distance: params.input.distance,
    angle: params.input.angle,
    cross_section: params.input.cross_section,
  });

  // Sealed with the owner's keys (#141): nothing is written while locked.
  const cipher = await ports.cipher(params.userId);

  let glbSha256: string | undefined;
  let glbModelName: string | undefined;
  if (params.input.glb) {
    glbSha256 = await ports.persistGlb(params.userId, params.input.glb, cipher);
    glbModelName = params.input.glbModelName;
  }

  const viatarId = resolveViatarId(params.input, glbSha256);
  const syncedAt = new Date();
  const key = { subjectId: params.input.subjectId, viatarId };
  // The row id is part of each sealed value's context, so it is fixed first.
  const id =
    (
      await ports.database().vitronicSnapshot.findUnique({
        where: { subjectId_viatarId: key },
        select: { id: true },
      })
    )?.id ?? crypto.randomUUID();
  const sealed = {
    summary: sealJson(cipher, SNAPSHOTS, "summary", id, summary),
    fhirBundle: null,
    markers: sealNullableJson(cipher, SNAPSHOTS, "markers", id, geometry.markers),
    measures: sealNullableJson(cipher, SNAPSHOTS, "measures", id, geometry.measures),
  };

  const create = {
    id,
    userId: params.userId,
    subjectId: params.input.subjectId,
    ...sealed,
    glbSha256,
    glbModelName,
    viatarId,
    presetName: params.input.presetName ?? null,
    syncedAt,
  };
  // userId follows the owned subject, so a row keyed on this subject is the owner's.
  const update = {
    userId: params.userId,
    ...sealed,
    viatarId,
    presetName: params.input.presetName ?? null,
    syncedAt,
    ...(glbSha256 ? { glbSha256, glbModelName } : {}),
  };

  await ports.database().vitronicSnapshot.upsert({
    where: { subjectId_viatarId: key },
    create,
    update,
  });

  await ports.database().vitronicConnection.updateMany({
    where: { userId: params.userId },
    data: { lastSyncAt: new Date() },
  });

  await ports.append({
    actor: params.actor,
    sessionId: params.userId,
    subjectRef: params.input.subjectId,
    tool: params.tool ?? VITRONIC_AUDIT_TOOL,
    args: {
      scanId,
      metricCount: summary.metrics.length,
      glbModelName: glbModelName ?? null,
    },
    result: { glbSha256: glbSha256 ?? null },
    rowCount: 0,
  });

  return { summary, glbSha256: glbSha256 ?? null, fhirBundle: null, viatarId };
};

export const ingestVitronicForUser = async (params: {
  readonly userId: string;
  readonly actor: string;
  readonly input: VitronicIngestInput;
  readonly tool?: string;
  readonly ports?: Partial<VitronicSnapshotPorts>;
}): Promise<{
  readonly summary: VitronicSummary;
  readonly glbSha256: string | null;
  readonly fhirBundle: null;
  readonly viatarId: number;
}> => persistSnapshot(params);

export const persistVitronicConnection = async (params: {
  readonly userId: string;
  readonly input: VitronicConnectInput;
  readonly capturePin?: (cfg: { baseUrl: string }) => Promise<string>;
}): Promise<{ readonly tlsFingerprintSha256: string }> => {
  // Throws ScannerUrlRejectedError before any network contact.
  const baseUrl = scannerOrigin(params.input.baseUrl, scannerUrlPolicy());
  const pin =
    params.capturePin ??
    ((cfg: { baseUrl: string }) =>
      captureTlsFingerprint({ ...cfg, urlPolicy: scannerUrlPolicy() }));
  const tlsFingerprintSha256 = await pin({ baseUrl });

  const data = {
    baseUrl,
    apiTokenEnc: encryptVitronicSecret(params.input.apiToken),
    uploadSecretEnc: encryptVitronicSecret(params.input.uploadSecret ?? "unshipped"),
    probandId: params.input.probandId,
    tlsFingerprintSha256,
    apiTokenName: params.input.apiTokenName ?? null,
  };

  await database().vitronicConnection.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
  await ensureSelfSubjectFromConnection(params.userId);
  return { tlsFingerprintSha256 };
};

const scannerUrlPolicy = () => ({
  allowedHosts: parseScannerHosts(vitronicScannerHosts() ?? undefined),
});

const bearerConfig = (connection: {
  baseUrl: string;
  apiTokenEnc: string;
  tlsFingerprintSha256: string | null;
}): VitronicBearerConfig => ({
  baseUrl: connection.baseUrl,
  apiToken: decryptVitronicSecret(connection.apiTokenEnc),
  tlsFingerprintSha256: connection.tlsFingerprintSha256,
  urlPolicy: scannerUrlPolicy(),
});

export const ensureSelfSubjectFromConnection = async (
  userId: string,
): Promise<VitronicSubjectRow | null> => {
  const existing = await database().vitronicSubject.findFirst({
    where: { userId, isSelf: true },
  });
  const cipher = await cipherForUser(userId);
  if (existing) {
    return {
      id: existing.id,
      label: cipher.openText(SUBJECTS, "label", existing.id, existing.label),
      source: existing.source,
      isSelf: existing.isSelf,
      probandId: existing.probandId,
      defaultViatarId: existing.defaultViatarId,
    };
  }
  const connection = await database().vitronicConnection.findUnique({
    where: { userId },
  });
  if (!connection) return null;
  const id = crypto.randomUUID();
  const created = await database().vitronicSubject.create({
    data: {
      id,
      userId,
      label: cipher.sealText(SUBJECTS, "label", id, VITRONIC_SELF_LABEL),
      source: VITRONIC_SUBJECT_SOURCE_SCANNER,
      isSelf: true,
      selfForUserId: userId,
      probandId: connection.probandId,
      consentRecordedAt: new Date(),
      consentBy: "connection-migration",
      consentNote: cipher.sealText(
        SUBJECTS,
        "consentNote",
        id,
        "Migrated from VitronicConnection.",
      ),
    },
  });
  return {
    id: created.id,
    label: VITRONIC_SELF_LABEL,
    source: created.source,
    isSelf: created.isSelf,
    probandId: created.probandId,
    defaultViatarId: created.defaultViatarId,
  };
};

export const listVitronicSubjects = async (
  userId: string,
  opts?: {
    readonly actor?: string;
    readonly ports?: Partial<VitronicLocalReadPorts>;
  },
): Promise<readonly VitronicSubjectRow[]> => {
  const db = localReadDb(opts);
  if (!opts?.ports?.database) {
    await ensureSelfSubjectFromConnection(userId);
  }
  const rows = await db().vitronicSubject.findMany({
    where: { userId },
    orderBy: [{ isSelf: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      label: true,
      source: true,
      isSelf: true,
      probandId: true,
      defaultViatarId: true,
    },
  });
  const cipher = await localReadCipher(opts)(userId);
  const opened = rows.map((row) => openSubject(cipher, row));
  const doAppend = localReadAppend(opts);
  await doAppend({
    actor: opts?.actor ?? userId,
    sessionId: userId,
    subjectRef: null,
    tool: VITRONIC_SUBJECTS_LIST_AUDIT_TOOL,
    args: { count: rows.length },
    result: { count: rows.length },
    rowCount: rows.length,
  });
  return opened;
};

export class VitronicConsentRequiredError extends Error {
  readonly status = 400;
  constructor() {
    super("vitronic-consent-required");
    this.name = "VitronicConsentRequiredError";
  }
}

export class VitronicSelfExistsError extends Error {
  readonly status = 400;
  constructor() {
    super("vitronic-self-exists");
    this.name = "VitronicSelfExistsError";
  }
}

export const createVitronicSubject = async (params: {
  readonly userId: string;
  readonly actor: string;
  readonly input: CreateSubjectInput;
}): Promise<VitronicSubjectRow> => {
  const consentAt = parseConsentTime(params.input.consentRecordedAt);
  if (
    !consentAt ||
    params.input.consentBy.trim().length === 0 ||
    params.input.consentNote.trim().length === 0
  ) {
    throw new VitronicConsentRequiredError();
  }
  const isSelf = params.input.isSelf === true;
  if (isSelf) {
    const existing = await database().vitronicSubject.findFirst({
      where: { userId: params.userId, isSelf: true },
    });
    if (existing) throw new VitronicSelfExistsError();
  }

  const cipher = await cipherForUser(params.userId);
  const id = crypto.randomUUID();
  const created = await database().vitronicSubject.create({
    data: {
      id,
      userId: params.userId,
      label: cipher.sealText(SUBJECTS, "label", id, params.input.label),
      source: params.input.source,
      isSelf,
      selfForUserId: isSelf ? params.userId : null,
      probandId: params.input.probandId ?? null,
      consentRecordedAt: consentAt,
      consentBy: params.input.consentBy,
      consentNote: cipher.sealText(SUBJECTS, "consentNote", id, params.input.consentNote),
    },
  });

  await append(database(), {
    actor: params.actor,
    sessionId: params.userId,
    subjectRef: created.id,
    tool: VITRONIC_SUBJECTS_AUDIT_TOOL,
    args: { label: params.input.label, source: created.source, isSelf },
    result: { id: created.id },
    rowCount: 0,
  });

  return {
    id: created.id,
    label: params.input.label,
    source: created.source,
    isSelf: created.isSelf,
    probandId: created.probandId,
    defaultViatarId: created.defaultViatarId,
  };
};

export class VitronicDefaultScanNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("vitronic-default-scan-not-found");
    this.name = "VitronicDefaultScanNotFoundError";
  }
}

type DefaultScanDb = () => {
  vitronicSubject: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    update: (args: unknown) => Promise<{ defaultViatarId: number | null }>;
  };
  vitronicSnapshot: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
};

export type VitronicDefaultScanPorts = Readonly<{
  append: (input: AppendInput) => Promise<AppendedEvent>;
  database: DefaultScanDb;
}>;

/**
 * Pin the scan the Digital Twin viewer opens first, or clear it with null.
 * Only a stored snapshot of the actor's own subject can be pinned.
 */
export const setDefaultScanForSubject = async (params: {
  readonly userId: string;
  readonly actor: string;
  readonly subjectId: string;
  readonly viatarId: number | null;
  readonly ports?: Partial<VitronicDefaultScanPorts>;
}): Promise<{ readonly defaultViatarId: number | null }> => {
  const db = params.ports?.database ?? (database as unknown as DefaultScanDb);
  const doAppend = params.ports?.append ?? defaultLocalAppend;
  const subject = await db().vitronicSubject.findFirst({
    where: { id: params.subjectId, userId: params.userId },
    select: { id: true },
  });
  if (!subject) throw new VitronicDefaultScanNotFoundError();
  if (params.viatarId !== null) {
    const snapshot = await db().vitronicSnapshot.findFirst({
      where: { userId: params.userId, subjectId: subject.id, viatarId: params.viatarId },
      select: { id: true },
    });
    if (!snapshot) throw new VitronicDefaultScanNotFoundError();
  }
  await doAppend({
    actor: params.actor,
    sessionId: params.userId,
    subjectRef: subject.id,
    tool: VITRONIC_SUBJECT_DEFAULT_AUDIT_TOOL,
    args: { subjectId: subject.id, viatarId: params.viatarId },
    result: { defaultViatarId: params.viatarId },
    rowCount: 0,
  });
  const updated = await db().vitronicSubject.update({
    where: { id: subject.id },
    data: { defaultViatarId: params.viatarId },
    select: { defaultViatarId: true },
  });
  return { defaultViatarId: updated.defaultViatarId };
};

export const requireSubjectForUser = async (userId: string, subjectId: string) => {
  const subject = await database().vitronicSubject.findFirst({
    where: { id: subjectId, userId },
  });
  if (!subject) throw new Error("vitronic-subject-not-found");
  return subject;
};

export const listScansForSubject = async (params: {
  readonly userId: string;
  readonly actor: string;
  readonly subjectId: string;
}): Promise<readonly VitronicScanRef[]> => {
  const subject = await requireSubjectForUser(params.userId, params.subjectId);
  const cipher = await cipherForUser(params.userId);
  const stored = await database().vitronicSnapshot.findMany({
    where: { userId: params.userId, subjectId: subject.id },
    select: {
      id: true,
      viatarId: true,
      presetName: true,
      syncedAt: true,
      glbSha256: true,
      markers: true,
      measures: true,
      summary: true,
    },
  });
  const subjectKind =
    subject.source === VITRONIC_SUBJECT_SOURCE_SCANNER ? "scanner" : "file";
  const facts: SnapshotSyncFacts[] = stored.map((row) => {
    const summary = openJson(cipher, SNAPSHOTS, "summary", row.id, row.summary) as {
      metrics?: unknown;
    } | null;
    return {
      viatarId: row.viatarId,
      glbSha256: row.glbSha256,
      ...openGeometry(cipher, row.id, row),
      properties: Array.isArray(summary?.metrics) ? summary.metrics : [],
      presetName: row.presetName,
      crtime: row.syncedAt.toISOString(),
    };
  });
  const storedByViatar = new Map(facts.map((row) => [row.viatarId, row] as const));

  let live: readonly VitronicScanRef[] = [];
  if (subject.probandId != null) {
    const connection = await database().vitronicConnection.findUnique({
      where: { userId: params.userId },
    });
    if (connection) {
      const probandId = subject.probandId;
      // Scanner offline or slow: fall back to the stored snapshots.
      const attempt = await liveOrFallback(
        () => listViatarsForProbandId(bearerConfig(connection), probandId),
        [] as readonly VitronicViatar[],
      );
      live = scanRefsForViatars(attempt.value, storedByViatar, subjectKind);
    }
  }

  const refs = mergeStoredScanRefs(live, facts, subjectKind);

  await append(database(), {
    actor: params.actor,
    sessionId: params.userId,
    subjectRef: subject.id,
    tool: VITRONIC_SCANS_AUDIT_TOOL,
    args: { subjectId: subject.id, count: refs.length },
    result: { count: refs.length },
    rowCount: refs.length,
  });

  return refs;
};

export const listSnapshotsForSubject = async (
  userId: string,
  subjectId: string,
  opts?: {
    readonly actor?: string;
    readonly ports?: Partial<VitronicLocalReadPorts>;
  },
): Promise<readonly VitronicSnapshotCard[]> => {
  const db = localReadDb(opts);
  if (!opts?.ports?.database) {
    await requireSubjectForUser(userId, subjectId);
  }
  const rows = await db().vitronicSnapshot.findMany({
    where: { userId, subjectId },
    orderBy: { syncedAt: "desc" },
    select: {
      id: true,
      viatarId: true,
      glbSha256: true,
      syncedAt: true,
      summary: true,
      markers: true,
      measures: true,
      presetName: true,
    },
  });
  const doAppend = localReadAppend(opts);
  await doAppend({
    actor: opts?.actor ?? userId,
    sessionId: userId,
    subjectRef: subjectId,
    tool: VITRONIC_SNAPSHOTS_LIST_AUDIT_TOOL,
    args: { subjectId, count: rows.length },
    result: { count: rows.length },
    rowCount: rows.length,
  });
  const cipher = await localReadCipher(opts)(userId);
  return rows.map((row) => {
    const summary = openSummary(cipher, row.id, row.summary);
    return {
      id: row.id,
      viatarId: row.viatarId,
      hasAvatar: Boolean(row.glbSha256),
      syncedAt: row.syncedAt.toISOString(),
      presetName: row.presetName,
      properties: propertyRowsFromSummary(summary),
      ...openGeometry(cipher, row.id, row),
    };
  });
};

const pullScannerIntoSnapshot = async (params: {
  readonly userId: string;
  readonly actor: string;
  readonly subjectId: string;
  readonly viatarId: number;
}) => {
  const subject = await requireSubjectForUser(params.userId, params.subjectId);
  if (subject.probandId == null) throw new Error("vitronic-viatar-not-found");
  const connection = await database().vitronicConnection.findUnique({
    where: { userId: params.userId },
  });
  if (!connection) throw new Error("Connect BodyLoop before syncing.");

  const config = bearerConfig(connection);
  const listed = await listViatarsForProbandId(config, subject.probandId);
  const allowed = listed.find((row) => row.viatar_id === params.viatarId);
  if (!allowed) throw new Error("vitronic-viatar-not-found");

  const viatar = (await getViatar(config, allowed.viatar_id)) ?? allowed;
  const sets = await getMeasurementSets(config, viatar.viatar_id);
  let glb: Uint8Array | undefined;
  let glbModelName: string | undefined;
  try {
    const avatar = await fetchAvatarGlb(config, viatar.viatar_id);
    if (avatar.chosen) console.warn("[vitronic] glb", avatar.chosen);
    if (avatar.bytes && avatar.chosen) {
      glb = avatar.bytes;
      glbModelName = avatar.chosen;
    }
  } catch (error) {
    console.warn(
      "[vitronic] avatar fetch skipped",
      error instanceof Error ? error.name : "unknown",
    );
  }

  return persistSnapshot({
    userId: params.userId,
    actor: params.actor,
    input: {
      subjectId: subject.id,
      scan_id: String(viatar.viatar_id),
      viatar: {
        viatar_id: viatar.viatar_id,
        proband_id: viatar.proband_id,
        meta: viatar.meta,
      },
      effectiveDateTime: viatar.meta?.crtime ?? undefined,
      presetName: presetNameFromViatar(viatar),
      height: Array.isArray(sets.height) ? (sets.height as HeightRow[]) : undefined,
      distance: Array.isArray(sets.distance)
        ? (sets.distance as DistanceRow[])
        : undefined,
      angle: Array.isArray(sets.angle) ? (sets.angle as AngleRow[]) : undefined,
      axis: sets.axis,
      cross_section: sets.cross_section,
      marker: sets.marker,
      properties: Array.isArray(sets.properties)
        ? (sets.properties as PropertyRow[])
        : undefined,
      glb,
      glbModelName,
    },
  });
};

export const syncVitronicSubjectScan = async (params: {
  readonly userId: string;
  readonly actor: string;
  readonly subjectId: string;
  readonly viatarId: number;
}): Promise<{
  readonly summary: VitronicSummary;
  readonly glbSha256: string | null;
  readonly viatarId: number;
}> => {
  const result = await pullScannerIntoSnapshot(params);
  return {
    summary: result.summary,
    glbSha256: result.glbSha256,
    viatarId: result.viatarId,
  };
};

export const syncVitronicForUser = async (params: {
  readonly userId: string;
  readonly actor: string;
}): Promise<{
  readonly summary: VitronicSummary;
  readonly glbSha256: string | null;
}> => {
  const self = await ensureSelfSubjectFromConnection(params.userId);
  if (!self || self.probandId == null)
    throw new Error("Connect BodyLoop before syncing.");
  const connection = await database().vitronicConnection.findUnique({
    where: { userId: params.userId },
  });
  if (!connection) throw new Error("Connect BodyLoop before syncing.");
  const listed = await listViatarsForProbandId(bearerConfig(connection), self.probandId);
  const match = newestViatarForProbandId(listed, self.probandId);
  if (!match) throw new Error("vitronic-viatar-not-found");
  const result = await pullScannerIntoSnapshot({
    userId: params.userId,
    actor: params.actor,
    subjectId: self.id,
    viatarId: match.viatar_id,
  });
  return { summary: result.summary, glbSha256: result.glbSha256 };
};

export const getLatestVitronicSummary = async (
  userId: string,
  opts?: {
    readonly actor?: string;
    readonly ports?: Partial<VitronicLocalReadPorts>;
    readonly auditTool?: VitronicSummaryAuditTool;
  },
): Promise<VitronicSummary | null> => {
  const db = localReadDb(opts);
  const snap = await db().vitronicSnapshot.findFirst({
    where: { userId, subject: { isSelf: true } },
    orderBy: { syncedAt: "desc" },
    select: { id: true, summary: true, subjectId: true },
  });
  const count = snap ? 1 : 0;
  const doAppend = localReadAppend(opts);
  await doAppend({
    actor: opts?.actor ?? userId,
    sessionId: userId,
    subjectRef: snap?.subjectId ?? null,
    tool: opts?.auditTool ?? VITRONIC_CHAT_SUMMARY_AUDIT_TOOL,
    args: { count },
    result: { count },
    rowCount: count,
  });
  if (!snap) return null;
  return toChatVitronicSummary(
    openSummary(await localReadCipher(opts)(userId), snap.id, snap.summary),
  );
};

export const getVitronicConnectionStatus = async (
  userId: string,
  opts?: {
    readonly actor?: string;
    readonly ports?: Partial<VitronicLocalReadPorts>;
  },
) => {
  const db = localReadDb(opts);
  const connection = await db().vitronicConnection.findUnique({
    where: { userId },
    select: { lastSyncAt: true, tlsFingerprintSha256: true },
  });
  const snapshot = await db().vitronicSnapshot.findFirst({
    where: { userId, subject: { isSelf: true } },
    orderBy: { syncedAt: "desc" },
    select: { id: true, glbSha256: true, syncedAt: true, summary: true, subjectId: true },
  });
  const connected = connection !== null;
  const snapshotCount = snapshot ? 1 : 0;
  const doAppend = localReadAppend(opts);
  await doAppend({
    actor: opts?.actor ?? userId,
    sessionId: userId,
    subjectRef: snapshot?.subjectId ?? null,
    tool: VITRONIC_CONNECTION_STATUS_AUDIT_TOOL,
    args: { connected, count: snapshotCount },
    result: { connected, count: snapshotCount },
    rowCount: (connected ? 1 : 0) + snapshotCount,
  });
  const summary = snapshot?.summary
    ? openSummary(await localReadCipher(opts)(userId), snapshot.id, snapshot.summary)
    : null;
  const scanDate =
    summary && summary.window.startDate !== "unknown" ? summary.window.startDate : null;

  return {
    configured: vitronicEnv() !== null,
    connected,
    lastSyncAt:
      connection?.lastSyncAt?.toISOString() ?? snapshot?.syncedAt?.toISOString() ?? null,
    hasAvatar: Boolean(snapshot?.glbSha256),
    tlsFingerprintPrefix: connection?.tlsFingerprintSha256
      ? fingerprintPrefix(connection.tlsFingerprintSha256)
      : null,
    scanDate,
    properties: summary ? propertyRowsFromSummary(summary) : [],
  };
};

export const localVitronicReads = {
  listSubjects: listVitronicSubjects,
  listSnapshots: listSnapshotsForSubject,
  latestSummary: getLatestVitronicSummary,
  connectionStatus: getVitronicConnectionStatus,
} as const;

export const loadAvatarForSnapshot = async (
  userId: string,
  snapshotId: string,
  actor: string,
  opts?: { readonly ports?: Partial<VitronicLocalReadPorts> },
): Promise<Uint8Array | null> => {
  const snapshot = await localReadDb(opts)().vitronicSnapshot.findFirst({
    where: { id: snapshotId, userId },
    select: { glbSha256: true, subjectId: true },
  });
  if (!snapshot) return null;
  await localReadAppend(opts)({
    actor,
    sessionId: userId,
    subjectRef: snapshot.subjectId,
    tool: VITRONIC_AVATAR_AUDIT_TOOL,
    args: { snapshotId },
    result: { hasAvatar: Boolean(snapshot.glbSha256) },
    rowCount: 0,
  });
  if (!snapshot.glbSha256) return null;
  return loadGlb(userId, snapshot.glbSha256, await localReadCipher(opts)(userId));
};

/** cloud_connect username/password is not shipped (VUSE XR 29 Sep). Lookup is by connection id only. */
export const findConnectionForUpload = async (connectionId: string) => {
  return database().vitronicConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, uploadSecretEnc: true },
  });
};
