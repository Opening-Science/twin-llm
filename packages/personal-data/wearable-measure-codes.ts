/**
 * The measures an Apple Health or wearable export import stores, each with
 * its code and the UCUM unit it is stored in. Codes are LOINC where one
 * fits exactly; a measure with no exact code (HRV as RMSSD, the lowest
 * heart rate in sleep, workout values) is stored with its name and no code,
 * as a lab name not in the table would be. Nothing here invents a code.
 *
 * Pure data, with no Node import, so the browser can name a code from it too
 * (the tool trace, `features/compare/tool-cards.ts`).
 */

const LOINC = "http://loinc.org";

export type Measure = Readonly<{
  codeSystem: string | null;
  code: string | null;
  display: string;
  unit: string;
}>;

const loinc = (code: string, display: string, unit: string): Measure => ({
  codeSystem: LOINC,
  code,
  display,
  unit,
});

const uncoded = (display: string, unit: string): Measure => ({
  codeSystem: null,
  code: null,
  display,
  unit,
});

export const MEASURES = {
  heartRate: loinc("8867-4", "Heart rate", "/min"),
  restingHeartRate: loinc("40443-4", "Resting heart rate", "/min"),
  hrvSdnn: loinc("80404-7", "Heart rate variability (SDNN)", "ms"),
  steps: loinc("55423-8", "Steps", "{steps}"),
  stepsPerDay: loinc("41950-7", "Steps in 24 hours", "{steps}/d"),
  bodyMass: loinc("29463-7", "Body weight", "kg"),
  bodyMassIndex: loinc("39156-5", "Body mass index", "kg/m2"),
  oxygenSaturation: loinc("59408-5", "Oxygen saturation (pulse oximetry)", "%"),
  respiratoryRate: loinc("9279-1", "Respiratory rate", "/min"),
  sleepDuration: loinc("93832-4", "Sleep duration", "min"),
  hrvRmssd: uncoded("Heart rate variability (RMSSD)", "ms"),
  lowestSleepHeartRate: uncoded("Lowest heart rate during sleep", "/min"),
  workoutHeartRate: uncoded("Average heart rate during a workout", "/min"),
  workoutDuration: uncoded("Workout duration", "min"),
} as const satisfies Readonly<Record<string, Measure>>;
