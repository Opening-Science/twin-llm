import type { AppendInput } from "@/packages/audit/append";

/**
 * One way to store a keep or withhold choice from Settings (#507): the audit
 * row first, then the change. If the audit row cannot be written, nothing is
 * stored. Pure apart from the ports it is given, so the actions that use it
 * (twin notes loading and knowledge sources on Settings, and the sources and
 * live lookups the first-run flow saves) share one tested order.
 *
 * The audit row names the setting and its new value only: a boolean or a
 * list of catalogue ids, never anything a person wrote.
 */

export type SettingId = "twin-notes-loading" | "knowledge-sources" | "live-sources";

export type SettingValue = boolean | readonly string[];

export type SettingSave =
  Readonly<{ ok: true }> | Readonly<{ ok: false; code: string; error: string }>;

export const SETTING_NOT_SAVED = "Your choice wasn't saved. Try again in a moment.";

export const settingAuditEvent = (
  actor: string,
  setting: SettingId,
  value: SettingValue,
): AppendInput => ({
  actor,
  sessionId: "settings",
  subjectRef: null,
  tool: "settings.set",
  args: { setting, value: typeof value === "boolean" ? value : [...value] },
  result: { saved: true },
  rowCount: 0,
});

export type SettingSavePorts<V extends SettingValue> = Readonly<{
  audit: (event: AppendInput) => Promise<unknown>;
  store: (value: V) => Promise<void>;
  logError: (message: string, errorName: string) => void;
}>;

export const saveAuditedSetting = async <V extends SettingValue>(
  ports: SettingSavePorts<V>,
  input: Readonly<{ actor: string; setting: SettingId; value: V }>,
): Promise<SettingSave> => {
  try {
    await ports.audit(settingAuditEvent(input.actor, input.setting, input.value));
    await ports.store(input.value);
    return { ok: true };
  } catch (error) {
    ports.logError(
      `[settings] ${input.setting} not saved`,
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, code: "NOT_SAVED", error: SETTING_NOT_SAVED };
  }
};

export type SettingChange = Readonly<{ setting: SettingId; value: SettingValue }>;

/**
 * Several choices saved by one write (the first-run flow): one audit row per
 * change, all written before the store; if any cannot be, nothing is stored.
 */
export const saveAuditedSettings = async (
  ports: Readonly<{
    audit: (event: AppendInput) => Promise<unknown>;
    store: () => Promise<void>;
    logError: (message: string, errorName: string) => void;
  }>,
  input: Readonly<{ actor: string; changes: readonly SettingChange[] }>,
): Promise<SettingSave> => {
  try {
    for (const change of input.changes) {
      await ports.audit(settingAuditEvent(input.actor, change.setting, change.value));
    }
    await ports.store();
    return { ok: true };
  } catch (error) {
    ports.logError(
      `[settings] ${input.changes.map((change) => change.setting).join(", ") || "no change"} not saved`,
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, code: "NOT_SAVED", error: SETTING_NOT_SAVED };
  }
};

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** The changes worth an audit row: lists that differ from what was stored. */
export const changedLists = (
  pairs: readonly Readonly<{
    setting: SettingId;
    before: readonly string[];
    after: readonly string[];
  }>[],
): readonly SettingChange[] =>
  pairs
    .filter((pair) => !sameList(pair.before, pair.after))
    .map((pair) => ({ setting: pair.setting, value: pair.after }));
