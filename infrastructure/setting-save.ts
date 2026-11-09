import type { AppendInput } from "@/packages/audit/append";

/**
 * One way to store a keep or withhold choice from Settings (#507): the audit
 * row first, then the change. If the audit row cannot be written, nothing is
 * stored. Pure apart from the ports it is given, so the actions that use it
 * (twin notes loading, knowledge sources) share one tested order.
 *
 * The audit row names the setting and its new value only: a boolean or a
 * list of catalogue ids, never anything a person wrote.
 */

export type SettingId = "twin-notes-loading" | "knowledge-sources";

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
