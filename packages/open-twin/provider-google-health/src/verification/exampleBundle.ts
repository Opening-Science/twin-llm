/**
 * WHAT: Builds a fixture Bundle used by emit-bundles / local verification.
 * NOT:  Must not be treated as production PHI; must not skip validator assumptions.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator (CI fhir-validate).
 */
import type { Bundle } from 'fhir/r4';
import type { health_v4 } from 'googleapis';
import { buildBundleFromResponses } from '../fhir/bundleBuilder';

/**
 * A representative sync, built through the connector's own mappers so the HL7
 * validator checks what the library actually emits rather than a checked-in JSON
 * fixture — which would validate the fixture, not the code.
 *
 * The payload is shaped from real `dataPoints.list` responses: int64 fields as JSON
 * strings, lengths in millimetres, mass in grams, and a `utcOffset` on every timestamp.
 */
const SUBJECT_KEY = '8338456149191909237';
const TIMESTAMP = '2026-07-26T10:00:00Z';

const RESPONSES: health_v4.Schema$ListDataPointsResponse[] = [
  {
    dataPoints: [
      {
        dataSource: {
          recordingMethod: 'UNKNOWN',
          platform: 'HEALTH_CONNECT',
          application: { packageName: 'com.sec.android.app.shealth' }
        },
        heartRate: {
          sampleTime: { physicalTime: '2026-07-07T05:40:29.354Z', utcOffset: '7200s' },
          beatsPerMinute: '73',
          metadata: { motionContext: 'RESTING' }
        }
      }
    ]
  },
  {
    dataPoints: [
      {
        name: 'users/8338456149191909237/dataTypes/weight/dataPoints/233475372306809440',
        dataSource: { recordingMethod: 'MANUAL_ENTRY', platform: 'FITBIT' },
        weight: {
          sampleTime: { physicalTime: '2026-07-07T07:33:14.417Z', utcOffset: '7200s' },
          weightGrams: 86000
        }
      }
    ]
  },
  {
    dataPoints: [
      {
        dataSource: { recordingMethod: 'AUTO_DETECTED', platform: 'FITBIT' },
        height: {
          sampleTime: { physicalTime: '2026-07-07T07:33:14.417Z', utcOffset: '7200s' },
          heightMillimeters: '1750'
        }
      }
    ]
  },
  {
    dataPoints: [
      {
        dataSource: { recordingMethod: 'DERIVED', device: { displayName: 'MobileTrack' }, platform: 'FITBIT' },
        distance: {
          interval: {
            startTime: '2026-07-07T07:51:29Z',
            startUtcOffset: '7200s',
            endTime: '2026-07-07T07:52:29Z',
            endUtcOffset: '7200s'
          },
          millimeters: '44286'
        }
      },
      {
        dataSource: { recordingMethod: 'DERIVED', platform: 'FITBIT' },
        steps: {
          interval: {
            startTime: '2026-07-07T07:51:29Z',
            startUtcOffset: '7200s',
            endTime: '2026-07-07T07:52:29Z',
            endUtcOffset: '7200s'
          },
          // An absent count must publish a dataAbsentReason, never a zero.
          count: ''
        }
      }
    ]
  },
  {
    dataPoints: [
      {
        dataSource: { recordingMethod: 'AUTO_DETECTED', platform: 'FITBIT' },
        sleep: {
          interval: {
            startTime: '2026-07-06T21:58:00Z',
            startUtcOffset: '7200s',
            endTime: '2026-07-07T05:31:00Z',
            endUtcOffset: '7200s'
          },
          type: 'stages',
          metadata: { externalId: '48291736' },
          summary: {
            minutesAsleep: '392',
            minutesAwake: '61',
            minutesAfterWakeUp: '4',
            minutesInSleepPeriod: '453',
            minutesToFallAsleep: '9',
            stagesSummary: [
              { type: 'DEEP', minutes: '71', count: '4' },
              { type: 'REM', minutes: '96', count: '6' }
            ]
          },
          stages: [
            {
              type: 'LIGHT',
              startTime: '2026-07-06T21:58:00Z',
              startUtcOffset: '7200s',
              endTime: '2026-07-06T22:41:00Z',
              endUtcOffset: '7200s'
            },
            {
              type: 'DEEP',
              startTime: '2026-07-06T22:41:00Z',
              startUtcOffset: '7200s',
              endTime: '2026-07-06T23:29:00Z',
              endUtcOffset: '7200s'
            }
          ]
        }
      }
    ]
  }
];

export function googleHealthBundle(): Bundle {
  return buildBundleFromResponses(RESPONSES, {
    subjectKey: SUBJECT_KEY,
    timestamp: TIMESTAMP,
    bundleKey: 'google-health-verification'
  }).bundle;
}
