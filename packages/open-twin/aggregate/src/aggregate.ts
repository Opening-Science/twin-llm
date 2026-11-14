/**
 * WHAT: Cross-source reconciliation / measure keys / source selection for overlapping Observations.
 * NOT:  Must not fetch vendor data or invent scores for openXR HealthTwinData.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { buildBundle, ConnectorError, derivedObservation } from '@open-twin/fhir-core';
import type { Bundle, FhirResource, Observation } from 'fhir/r4';
import { effectiveDay, type Measure, measureOf } from './measure';
import { selectSource } from './select';

/**
 * One bundle from several connectors, with overlaps reconciled and nothing discarded.
 *
 * Two rules hold this together, and both are about not destroying evidence:
 *
 *   1. Every source Observation survives. A reconciliation is an added assertion, not
 *      a replacement, so changing the selection policy later is a re-run over data
 *      already held rather than a re-fetch from vendors who may no longer serve it.
 *   2. Where the evidence gives no basis to prefer a source, none is preferred. The
 *      output then says several sources disagreed and no more, which is the truth.
 *
 * The derived Observation carries `derivedFrom` pointing at every source it considered
 * — not only the winner — and `method` carrying the policy in readable prose. A
 * selection nobody can audit is indistinguishable from a guess.
 */

export const AGGREGATOR = { connector: 'open-twin', version: '0.1.0' } as const;

export interface SourceBundle {
  /** The connector that produced it. Read from `meta.tag` when not given. */
  connector?: string;
  bundle: Bundle;
}

export interface AggregateOptions {
  sources: SourceBundle[];
  /** The subject every source describes. Reconciling across subjects is meaningless. */
  subjectKey: string;
  /** Bundle.timestamp. Supplied so the result is reproducible. */
  timestamp: string;
}

export interface AggregateResult {
  bundle: Bundle;
  /** One line per occasion where more than one source reported the same measure. */
  reconciliations: Reconciliation[];
}

export interface Reconciliation {
  measure: Measure;
  day: string;
  sources: string[];
  /** The connector selected, or undefined when the evidence gave no basis to choose. */
  selected?: string;
  /** Why — including why not, when nothing was selected. */
  policy: string;
}

const CONNECTOR_TAG = 'http://opentwin.ch/fhir/CodeSystem/connector';

function connectorOf(source: SourceBundle): string {
  const tagged = source.bundle.meta?.tag?.find((tag) => tag.system === CONNECTOR_TAG)?.code;
  const connector = source.connector ?? tagged;
  if (!connector) {
    throw new ConnectorError('Cannot attribute a bundle: it carries no connector tag and none was supplied', {
      code: 'validation',
      connector: AGGREGATOR.connector,
      operation: 'aggregate'
    });
  }
  return connector;
}

const isObservation = (resource: FhirResource | undefined): resource is Observation =>
  resource?.resourceType === 'Observation';

interface Attributed {
  connector: string;
  observation: Observation;
}

export function aggregate(options: AggregateOptions): AggregateResult {
  if (options.sources.length === 0) {
    throw new ConnectorError('Cannot aggregate nothing: supply at least one source bundle', {
      code: 'validation',
      connector: AGGREGATOR.connector,
      operation: 'aggregate'
    });
  }

  const carried: FhirResource[] = [];
  // Keyed by subject and occasion, and the measure and day are carried alongside rather
  // than re-parsed out of the key: splitting the key was how the subject came back as
  // the measure name the moment the key gained a third part.
  const byOccasion = new Map<string, { measure: Measure; day: string; items: Attributed[] }>();
  const subjects = new Set<string>();

  for (const source of options.sources) {
    const connector = connectorOf(source);
    for (const entry of source.bundle.entry ?? []) {
      // `Bundle.entry.resource` is typed as the abstract `Resource`; anything actually
      // in a bundle is a member of the concrete union.
      const resource = entry.resource as FhirResource | undefined;
      if (!resource) continue;
      carried.push(resource);

      if (!isObservation(resource)) continue;
      const subject = resource.subject?.reference;
      if (subject) subjects.add(subject);

      const measure = measureOf(resource);
      const day = effectiveDay(resource);
      // No known measure or no effective time: carried, not reconciled. Without a time
      // there is nothing to say it describes the same occasion as anything else.
      if (!measure || !day) continue;

      // Keyed by subject as well as occasion. Reconciling across subjects would
      // attribute one person's reading to another; the guard below means this can only
      // ever be belt and braces.
      const key = `${subject ?? '(none)'}|${measure}|${day}`;
      const group = byOccasion.get(key) ?? { measure, day, items: [] };
      group.items.push({ connector, observation: resource });
      byOccasion.set(key, group);
    }
  }

  // Each connector mints its own `urn:uuid:` subject from `patientUuid(connector, key)`,
  // which hashes the connector in — so the same person reaches this function under a
  // different reference from every source unless the integrator supplied a common one.
  // Left alone, nothing would match and the result would report no overlap: a wrong
  // answer that looks like a clean one. Refusing is the only safe reading.
  if (subjects.size > 1) {
    throw new ConnectorError(
      `Cannot reconcile across ${subjects.size} different subjects. Each connector derives its own ` +
        'subject reference, so supply one `subject` to every connector for the same person before aggregating.',
      { code: 'validation', connector: AGGREGATOR.connector, operation: 'aggregate' }
    );
  }

  const derived: Observation[] = [];
  const reconciliations: Reconciliation[] = [];

  for (const [, group] of [...byOccasion.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const { measure, day, items } = group;
    // One connector reporting a measure twice in a day is not a disagreement between
    // sources, and picking between a device's own two readings is not what the
    // reliability evidence speaks to.
    const connectors = [...new Set(items.map((item) => item.connector))].sort();
    if (connectors.length < 2) continue;

    const selection = selectSource(
      connectors.map((connector) => ({ connector })),
      measure
    );

    if (selection.kind === 'abstained') {
      reconciliations.push({ measure, day, sources: connectors, policy: selection.reason });
      continue;
    }

    const winningReadings = items.filter((item) => item.connector === selection.winner.connector);
    if (winningReadings.length !== 1) {
      reconciliations.push({
        measure,
        day,
        sources: connectors,
        policy:
          `${selection.winner.connector} is the preferred source for ${measure}, but it supplied ` +
          `${winningReadings.length} readings for ${day}. No within-source selection rule is defined, so aggregation abstained.`
      });
      continue;
    }
    const winner = winningReadings[0]?.observation;
    if (!winner) continue;

    derived.push(
      derivedObservation({
        sources: items.map((item) => item.observation),
        selected: winner,
        policy: selection.policy,
        connector: AGGREGATOR.connector,
        subjectKey: options.subjectKey,
        measure: `${measure}/${day}`
      })
    );
    reconciliations.push({
      measure,
      day,
      sources: connectors,
      selected: selection.winner.connector,
      policy: selection.policy
    });
  }

  return {
    bundle: buildBundle({
      connector: AGGREGATOR,
      resources: [...carried, ...derived],
      timestamp: options.timestamp,
      bundleKey: [AGGREGATOR.connector, options.subjectKey, options.sources.map(connectorOf).sort().join(',')].join('|')
    }),
    reconciliations
  };
}
