/**
 * WHAT: Builds a fixture Bundle used by emit-bundles / local verification.
 * NOT:  Must not be treated as production PHI; must not skip validator assumptions.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator (CI fhir-validate); Oura sandbox path additionally uses recorded vendor sandbox responses where applicable.
 */
import type { Bundle } from 'fhir/r4';
import type { RequestParams } from '../api/schemas/client';
import { buildOuraBundle } from '../fhir/bundleBuilder';
import { parseOuraResponse } from '../utils/objectUtils';
import type { OuraTypedData } from '../utils/typeUtils';

/**
 * A representative Oura sync, built through the connector's own parsers and
 * mappers, for the HL7 validator stage in CI.
 *
 * The payloads below are the shapes Oura's published OpenAPI spec and sandbox
 * return, not hand-written FHIR. Going through `parseOuraResponse` and
 * `buildOuraBundle` means the validator checks what the library actually emits;
 * a checked-in JSON bundle would only validate the fixture.
 */
const REQUEST: RequestParams = {
  types: ['personal_info', 'sleep', 'heartrate', 'daily_activity', 'workout', 'ring_configuration'],
  start_date: '2026-06-20',
  end_date: '2026-06-21'
};

const PAYLOADS: Record<string, unknown> = {
  personal_info: {
    id: 'oura-user-exemplar',
    age: 34,
    weight: 71.2,
    height: 1.78,
    biological_sex: 'female'
  },
  sleep: {
    data: [
      {
        id: 'sleep-exemplar-1',
        bedtime_start: '2026-06-20T23:12:00+02:00',
        bedtime_end: '2026-06-21T07:04:00+02:00',
        day: '2026-06-21',
        score: 84,
        type: 'long_sleep',
        total_sleep_duration: 25320,
        rem_sleep_duration: 5400,
        deep_sleep_duration: 4080,
        light_sleep_duration: 15840,
        awake_time: 2000,
        time_in_bed: 28320,
        latency: 780,
        efficiency: 89,
        lowest_heart_rate: 47,
        average_heart_rate: 54.2,
        average_breath: 14.1,
        average_hrv: 62,
        restless_periods: 18,
        temperature_deviation: -0.2,
        temperature_trend_deviation: 0.1,
        sleep_algorithm_version: 'v2',
        ring_id: 'ring-exemplar-1'
      }
    ],
    next_token: null
  },
  heartrate: {
    data: [
      { timestamp: '2026-06-21T07:05:00+02:00', timestamp_unix: 1782363900000, bpm: 58, source: 'awake' },
      { timestamp: '2026-06-21T07:10:00+02:00', timestamp_unix: 1782364200000, bpm: 61, source: 'awake' }
    ],
    next_token: null
  },
  daily_activity: {
    data: [
      {
        id: 'activity-exemplar-1',
        day: '2026-06-21',
        timestamp: '2026-06-21T00:00:00+02:00',
        score: 88,
        steps: 11342,
        total_calories: 2480,
        active_calories: 612,
        target_calories: 500,
        high_activity_met_minutes: 122,
        sedentary_time: 30600,
        inactivity_alerts: 1,
        equivalent_walking_distance: 8600,
        average_met_minutes: 1.6,
        contributors: {
          meet_daily_targets: 92,
          move_every_hour: 78,
          recovery_time: 100,
          stay_active: 85,
          training_frequency: 70,
          training_volume: 81
        }
      }
    ],
    next_token: null
  },
  workout: {
    data: [
      {
        id: 'workout-exemplar-1',
        activity: 'running',
        source: 'confirmed',
        intensity: 'moderate',
        start_datetime: '2026-06-21T17:02:00+02:00',
        end_datetime: '2026-06-21T17:48:00+02:00',
        day: '2026-06-21',
        calories: 431,
        distance: 7420,
        label: 'Evening run'
      }
    ],
    next_token: null
  },
  ring_configuration: {
    data: [
      {
        id: 'ring-config-exemplar-1',
        set_up_at: '2026-01-15T10:00:00+01:00',
        hardware_type: 'gen4',
        color: 'stealth_black',
        design: 'horizon',
        firmware_version: '2.9.4',
        size: 9
      }
    ],
    next_token: null
  }
};

export function ouraBundle(): Bundle {
  const data: OuraTypedData[] = REQUEST.types.map((type) => parseOuraResponse(type, PAYLOADS[type]));

  return buildOuraBundle(data, REQUEST, { timestamp: '2026-07-26T10:00:00Z' });
}
