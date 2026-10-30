/**
 * What the Simulations form asks for, read from the page's query string
 * (`/lab?subject=…&date=…&seconds=…&recording=…`). The form is a plain GET
 * form, so a recording has a link that gives the same recording again. Pure.
 */

/** The pinned evaluation cohort the Simulations view picks people from. */
export const SIMULATION_COHORT = "synthea-v4-seed42";

/** The simulator's own bounds for a recording's length, s. */
export const SIM_SECONDS = { min: 30, max: 600, default: 300 } as const;
/** The tool's bounds for the recording number. */
export const SIM_RECORDING = { min: 1, max: 1000, default: 1 } as const;

export type SimulationRequest = Readonly<{
  subjectRef: string;
  /** YYYY-MM-DD, or null for the subject's last observation day. */
  date: string | null;
  durationSec: number;
  recording: number;
}>;

export type SimulationField = "subject" | "date" | "seconds" | "recording";

export type SimulationForm = Readonly<{
  /** What the form shows again, as typed. */
  values: Readonly<Record<SimulationField, string>>;
  /** A plain sentence per field that was not usable. */
  errors: Readonly<Partial<Record<SimulationField, string>>>;
  /** Null until a subject is chosen, or while a field has an error. */
  request: SimulationRequest | null;
}>;

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SUBJECT_REF = /^[A-Za-z0-9-]{1,64}$/;

const isRealDay = (text: string): boolean => {
  if (!ISO_DAY.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
};

const wholeIn = (text: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
};

export const parseSimulationForm = (params: SearchParams): SimulationForm => {
  const values = {
    subject: first(params.subject),
    date: first(params.date),
    seconds: first(params.seconds) || String(SIM_SECONDS.default),
    recording: first(params.recording) || String(SIM_RECORDING.default),
  };
  const seconds = wholeIn(values.seconds, SIM_SECONDS.min, SIM_SECONDS.max);
  const recording = wholeIn(values.recording, SIM_RECORDING.min, SIM_RECORDING.max);
  const errors: Partial<Record<SimulationField, string>> = {
    ...(values.subject !== "" && !SUBJECT_REF.test(values.subject)
      ? { subject: "Choose a person from the list." }
      : {}),
    ...(values.date !== "" && !isRealDay(values.date)
      ? { date: "Use a date such as 2025-06-01, or leave it empty." }
      : {}),
    ...(seconds === null
      ? {
          seconds: `A whole number of seconds from ${SIM_SECONDS.min} to ${SIM_SECONDS.max}.`,
        }
      : {}),
    ...(recording === null
      ? {
          recording: `A whole number from ${SIM_RECORDING.min} to ${SIM_RECORDING.max}.`,
        }
      : {}),
  };
  const usable =
    values.subject !== "" &&
    Object.keys(errors).length === 0 &&
    seconds !== null &&
    recording !== null;
  return {
    values,
    errors,
    request: usable
      ? {
          subjectRef: values.subject,
          date: values.date === "" ? null : values.date,
          durationSec: seconds,
          recording,
        }
      : null,
  };
};
