/**
 * WHAT: Embeds an HL7-published example Bundle for ingest tests.
 * NOT:  Must not rewrite clinical codes to suit our mappers; normalisation repairs addressing only.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: golden fixture (HL7 published R4 examples).
 */
import type { Bundle, FhirResource } from 'fhir/r4';

/**
 * Three vital-signs Observations HL7 publishes as R4 examples, wrapped in a
 * collection Bundle. The resources are verbatim; only the Bundle around them is
 * this repository's.
 *
 * Fetched from:
 *   https://hl7.org/fhir/R4/observation-example-heart-rate.json
 *   https://hl7.org/fhir/R4/observation-example-satO2.json
 *   https://hl7.org/fhir/R4/observation-example-body-length.json
 *
 * Each declares `meta.profile = vitalsigns`, so the HL7 validator enforces the
 * vital-signs profile on whatever the normaliser produces and the normaliser cannot
 * get away with output that merely parses. Each also arrives with subject
 * `Patient/example` and no Patient anywhere in the bundle — the exact anti-pattern
 * decision D1 exists to end, which is why this is the input the normaliser is
 * measured against.
 */
export const HL7_VITALS_BUNDLE: Bundle<FhirResource> = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      fullUrl: 'http://hl7.org/fhir/R4/Observation/heart-rate',
      resource: {
        resourceType: 'Observation',
        id: 'heart-rate',
        meta: {
          profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns']
        },
        text: {
          status: 'generated',
          div: "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>Generated Narrative with Details</b></p><p><b>id</b>: heart-rate</p><p><b>meta</b>: </p><p><b>status</b>: final</p><p><b>category</b>: Vital Signs <span>(Details : {http://terminology.hl7.org/CodeSystem/observation-category code 'vital-signs' = 'Vital Signs', given as 'Vital Signs'})</span></p><p><b>code</b>: Heart rate <span>(Details : {LOINC code '8867-4' = 'Heart rate', given as 'Heart rate'})</span></p><p><b>subject</b>: <a>Patient/example</a></p><p><b>effective</b>: 02/07/1999</p><p><b>value</b>: 44 beats/minute<span> (Details: UCUM code /min = '/min')</span></p></div>"
        },
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs'
              }
            ],
            text: 'Vital Signs'
          }
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '8867-4',
              display: 'Heart rate'
            }
          ],
          text: 'Heart rate'
        },
        subject: {
          reference: 'Patient/example'
        },
        effectiveDateTime: '1999-07-02',
        valueQuantity: {
          value: 44,
          unit: 'beats/minute',
          system: 'http://unitsofmeasure.org',
          code: '/min'
        }
      }
    },
    {
      fullUrl: 'http://hl7.org/fhir/R4/Observation/satO2',
      resource: {
        resourceType: 'Observation',
        id: 'satO2',
        meta: {
          profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns']
        },
        text: {
          status: 'generated',
          div: "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>Generated Narrative with Details</b></p><p><b>id</b>: satO2</p><p><b>meta</b>: </p><p><b>identifier</b>: o1223435-10</p><p><b>partOf</b>: <a>Procedure/ob</a></p><p><b>status</b>: final</p><p><b>category</b>: Vital Signs <span>(Details : {http://terminology.hl7.org/CodeSystem/observation-category code 'vital-signs' = 'Vital Signs', given as 'Vital Signs'})</span></p><p><b>code</b>: Oxygen saturation in Arterial blood <span>(Details : {LOINC code '2708-6' = 'Oxygen saturation in Arterial blood', given as 'Oxygen saturation in Arterial blood'}; {LOINC code '59408-5' = 'Oxygen saturation in Arterial blood by Pulse oximetry', given as 'Oxygen saturation in Arterial blood by Pulse oximetry'}; {urn:iso:std:iso:11073:10101 code '150456' = '150456', given as 'MDC_PULS_OXIM_SAT_O2'})</span></p><p><b>subject</b>: <a>Patient/example</a></p><p><b>effective</b>: 05/12/2014 9:30:10 AM</p><p><b>value</b>: 95 %<span> (Details: UCUM code % = '%')</span></p><p><b>interpretation</b>: Normal (applies to non-numeric results) <span>(Details : {http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation code 'N' = 'Normal', given as 'Normal'})</span></p><p><b>device</b>: <a>DeviceMetric/example</a></p><h3>ReferenceRanges</h3><table><tr><td>-</td><td><b>Low</b></td><td><b>High</b></td></tr><tr><td>*</td><td>90 %<span> (Details: UCUM code % = '%')</span></td><td>99 %<span> (Details: UCUM code % = '%')</span></td></tr></table></div>"
        },
        identifier: [
          {
            system: 'http://goodcare.org/observation/id',
            value: 'o1223435-10'
          }
        ],
        partOf: [
          {
            reference: 'Procedure/ob'
          }
        ],
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs'
              }
            ],
            text: 'Vital Signs'
          }
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '2708-6',
              display: 'Oxygen saturation in Arterial blood'
            },
            {
              system: 'http://loinc.org',
              code: '59408-5',
              display: 'Oxygen saturation in Arterial blood by Pulse oximetry'
            },
            {
              system: 'urn:iso:std:iso:11073:10101',
              code: '150456',
              display: 'MDC_PULS_OXIM_SAT_O2'
            }
          ]
        },
        subject: {
          reference: 'Patient/example'
        },
        effectiveDateTime: '2014-12-05T09:30:10+01:00',
        valueQuantity: {
          value: 95,
          unit: '%',
          system: 'http://unitsofmeasure.org',
          code: '%'
        },
        interpretation: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                code: 'N',
                display: 'Normal'
              }
            ],
            text: 'Normal (applies to non-numeric results)'
          }
        ],
        device: {
          reference: 'DeviceMetric/example'
        },
        referenceRange: [
          {
            low: {
              value: 90,
              unit: '%',
              system: 'http://unitsofmeasure.org',
              code: '%'
            },
            high: {
              value: 99,
              unit: '%',
              system: 'http://unitsofmeasure.org',
              code: '%'
            }
          }
        ]
      }
    },
    {
      fullUrl: 'http://hl7.org/fhir/R4/Observation/body-length',
      resource: {
        resourceType: 'Observation',
        id: 'body-length',
        meta: {
          profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns']
        },
        text: {
          status: 'generated',
          div: "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>Generated Narrative with Details</b></p><p><b>id</b>: body-length</p><p><b>meta</b>: </p><p><b>status</b>: final</p><p><b>category</b>: Vital Signs <span>(Details : {http://terminology.hl7.org/CodeSystem/observation-category code 'vital-signs' = 'Vital Signs', given as 'Vital Signs'})</span></p><p><b>code</b>: Body Length <span>(Details : {LOINC code '8302-2' = 'Body height', given as 'Body height'}; {LOINC code '8306-3' = 'Body height --lying', given as 'Body height --lying'})</span></p><p><b>subject</b>: <a>Patient/example</a></p><p><b>effective</b>: 02/07/1999</p><p><b>value</b>: 25 cm<span> (Details: UCUM code cm = 'cm')</span></p></div>"
        },
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs'
              }
            ],
            text: 'Vital Signs'
          }
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '8302-2',
              display: 'Body height'
            },
            {
              system: 'http://loinc.org',
              code: '8306-3',
              display: 'Body height --lying',
              userSelected: true
            }
          ],
          text: 'Body Length'
        },
        subject: {
          reference: 'Patient/example'
        },
        effectiveDateTime: '1999-07-02',
        valueQuantity: {
          value: 25,
          unit: 'cm',
          system: 'http://unitsofmeasure.org',
          code: 'cm'
        }
      }
    }
  ]
};
