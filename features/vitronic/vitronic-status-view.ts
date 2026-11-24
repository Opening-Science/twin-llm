export type VitronicPropertyRow = Readonly<{
  path: string;
  value: number;
  unit: string;
}>;

export type VitronicStatusPayload = Readonly<{
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  hasAvatar: boolean;
  signedIn?: boolean;
  probandId?: number | null;
  scanKeyLocked?: boolean;
  tlsFingerprintPrefix?: string | null;
  scanDate?: string | null;
  properties?: readonly VitronicPropertyRow[];
}>;

const isPropertyRow = (value: unknown): value is VitronicPropertyRow => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.path === "string" &&
    typeof row.value === "number" &&
    typeof row.unit === "string"
  );
};

export const isVitronicStatusPayload = (
  value: unknown,
): value is VitronicStatusPayload => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const prefixOk =
    row.tlsFingerprintPrefix === undefined ||
    row.tlsFingerprintPrefix === null ||
    typeof row.tlsFingerprintPrefix === "string";
  const scanOk =
    row.scanDate === undefined ||
    row.scanDate === null ||
    typeof row.scanDate === "string";
  const propertiesOk =
    row.properties === undefined ||
    (Array.isArray(row.properties) && row.properties.every(isPropertyRow));
  return (
    typeof row.configured === "boolean" &&
    typeof row.connected === "boolean" &&
    (row.lastSyncAt === null || typeof row.lastSyncAt === "string") &&
    typeof row.hasAvatar === "boolean" &&
    (row.probandId == null ||
      (typeof row.probandId === "number" &&
        Number.isInteger(row.probandId) &&
        row.probandId > 0)) &&
    (row.scanKeyLocked === undefined || typeof row.scanKeyLocked === "boolean") &&
    prefixOk &&
    scanOk &&
    propertiesOk
  );
};
