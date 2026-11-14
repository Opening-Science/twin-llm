/**
 * WHAT: Embeds an HL7-published example Bundle for ingest tests.
 * NOT:  Must not rewrite clinical codes to suit our mappers; normalisation repairs addressing only.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: golden fixture (HL7 published R4 examples).
 */
import type { Bundle, FhirResource } from 'fhir/r4';

/**
 * HL7's own body-height example, verbatim, in a collection Bundle.
 *
 * Fetched from: https://hl7.org/fhir/R4/observation-example-body-height.json
 *
 * It states 66.899999999999991 `[in_i]` under LOINC 8302-2. That is impeccable
 * FHIR — `[in_i]` is inside the *required* binding of the `bodyheight` profile, so
 * the HL7 validator passes it — and it still violates decision D4, which binds
 * 8302-2 to `cm` alone across every connector. It is the fixture for that
 * disagreement precisely because nobody in this repository wrote it.
 *
 * HL7 spells the value `66.899999999999991`; it appears below as `66.89999999999999`
 * because that is JavaScript's shortest round-tripping spelling of the identical
 * IEEE 754 double — `66.899999999999991 === 66.89999999999999` is true, and both
 * differ from `66.9`. Tidying it to 66.9 would be a small silent edit to a number,
 * which is the class of change this package exists to refuse.
 */
export const HL7_BODY_HEIGHT_BUNDLE: Bundle<FhirResource> = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      fullUrl: 'http://hl7.org/fhir/R4/Observation/body-height',
      resource: {
        resourceType: 'Observation',
        id: 'body-height',
        meta: {
          profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns']
        },
        text: {
          status: 'generated',
          div: "<div xmlns=\"http://www.w3.org/1999/xhtml\"><p><b>Generated Narrative with Details</b></p><p><b>id</b>: body-height</p><p><b>meta</b>: </p><p><b>status</b>: final</p><p><b>category</b>: Vital Signs <span>(Details : {http://terminology.hl7.org/CodeSystem/observation-category code 'vital-signs' = 'Vital Signs', given as 'Vital Signs'})</span></p><p><b>code</b>: Body height <span>(Details : {LOINC code '8302-2' = 'Body height', given as 'Body height'})</span></p><p><b>subject</b>: <a>Patient/example</a></p><p><b>effective</b>: 02/07/1999</p><p><b>value</b>: 66.899999999999991 in<span> (Details: UCUM code [in_i] = 'in_i')</span></p></div>"
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
            }
          ],
          text: 'Body height'
        },
        subject: {
          reference: 'Patient/example'
        },
        effectiveDateTime: '1999-07-02',
        valueQuantity: {
          value: 66.89999999999999,
          unit: 'in',
          system: 'http://unitsofmeasure.org',
          code: '[in_i]'
        }
      }
    }
  ]
};
