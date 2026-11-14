/**
 * WHAT: Shared non-clinical utilities for the connector package.
 * NOT:  Must not choose terminology or units.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { z } from 'zod';
import { CardiovascularAgeListSchema } from '../api/schemas/cardiovascular';
import { OuraDailyActivityResponseListSchema } from '../api/schemas/daily';
import { HeartRateListSchema } from '../api/schemas/heartrate';
import type { OuraPersonal } from '../api/schemas/personal';
import { OuraReadinessResponseListSchema } from '../api/schemas/readiness';
import { OuraResilienceResponseListSchema } from '../api/schemas/resilience';
import { RestModeListSchema } from '../api/schemas/restmode';
import { RingConfigListSchema } from '../api/schemas/ringconfig';
import { SessionListSchema } from '../api/schemas/session';
import { SleepListSchema } from '../api/schemas/sleep';
import { Spo2ListSchema } from '../api/schemas/spo2';
import { StressListSchema } from '../api/schemas/stress';
import { VO2MaxListSchema } from '../api/schemas/vo2max';
import { WorkoutListSchema } from '../api/schemas/workout';
import type { SupportedScope } from '../config/constants';

/**
 * Decision D5: the schema is selected by the type that was **requested**.
 *
 * `getSchemaNameRuntime` used to discard that knowledge and guess again by probing
 * `data[0]` for a marker field. Seven of the thirteen markers were fields the
 * schema itself marks optional, so a perfectly valid response that happened to
 * omit one — `daily_activity` without `met`, `daily_readiness` without
 * `temperature_trend_deviation`, `ring_configuration` without `set_up_at` — was
 * classified `unknown` and rejected the whole fan-out. `workout` was worse: its
 * marker, `workout_type`, is a field that does not exist on any Oura response, so
 * the workout mapper was unreachable and any request including it discarded every
 * sibling type.
 *
 * Selecting by the requested type removes the entire class, not one instance.
 */
export const LIST_SCHEMAS = {
  daily_activity: OuraDailyActivityResponseListSchema,
  heartrate: HeartRateListSchema,
  sleep: SleepListSchema,
  daily_spo2: Spo2ListSchema,
  workout: WorkoutListSchema,
  daily_cardiovascular_age: CardiovascularAgeListSchema,
  vO2_max: VO2MaxListSchema,
  daily_readiness: OuraReadinessResponseListSchema,
  daily_resilience: OuraResilienceResponseListSchema,
  daily_stress: StressListSchema,
  rest_mode_period: RestModeListSchema,
  ring_configuration: RingConfigListSchema,
  session: SessionListSchema
} as const;

/** Every supported scope except `personal_info`, which is not a list response. */
export type ListScope = keyof typeof LIST_SCHEMAS;

export type OuraListData = {
  [K in ListScope]: z.infer<(typeof LIST_SCHEMAS)[K]>;
};

/**
 * Compile-time proof that every scope has a schema. Adding a scope to
 * `SUPPORTED_SCOPES` without adding it here is a type error, not a runtime throw.
 */
type AssertNever<T extends never> = T;
export type AllScopesHaveASchema = AssertNever<Exclude<SupportedScope, ListScope | 'personal_info'>>;

/** A parsed response that still knows which endpoint it came from. */
export type OuraTypedData =
  | { type: 'personal_info'; data: OuraPersonal }
  | { [K in ListScope]: { type: K; data: OuraListData[K] } }[ListScope];
