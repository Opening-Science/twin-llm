/**
 * WHAT: UCUM validation / quantity helpers for this package.
 * NOT:  Must not invent unit codes; invalid UCUM fails closed.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: UCUM grammar via @lhncbc/ucum-lhc.
 */
import { UcumLhcUtils, type UcumLhcUtilsInstance } from '@lhncbc/ucum-lhc';
import { ConnectorError } from '@open-twin/fhir-core';

const CONNECTOR = 'fhir-r4';

let cached: UcumLhcUtilsInstance | undefined;

/**
 * The real UCUM grammar, not a list of codes someone believed in.
 *
 * A hand-maintained set of "units we accept" is the same class of artefact as the
 * defects it is meant to catch — it encodes a belief, and it is wrong in exactly the
 * places nobody thought about. `steps` looks like a unit and is not one; `{steps}`
 * is. Only a parser knows the difference.
 */
export function ucum(): UcumLhcUtilsInstance {
  if (cached) return cached;
  try {
    cached = UcumLhcUtils.getInstance();
  } catch (cause) {
    // The cause is a library initialisation failure, never input, so it is safe to
    // chain. ConnectorError carries no payload by construction.
    throw new ConnectorError('The UCUM grammar could not be initialised', {
      code: 'unsupported',
      connector: CONNECTOR,
      operation: 'UcumLhcUtils.getInstance',
      cause
    });
  }
  return cached;
}

export function isValidUcum(code: string): boolean {
  try {
    return ucum().validateUnitString(code, false).status === 'valid';
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    return false;
  }
}

/**
 * True when a value expressed in `from` can be converted to `to` without changing
 * what it measures — that is, when the two codes differ only in scale.
 *
 * The distinction carries the severity of the report. `s` against a policy of `min`
 * is a factor of sixty on a number that still looks entirely plausible: exactly the
 * failure that shipped six Oura sleep durations as raw seconds under LOINC codes
 * whose unit is minutes. `kg` against `min` is a mapping mistake of a different kind
 * and a receiver will notice it. Both are wrong; they are not wrong in the same way.
 */
export function areCommensurable(from: string, to: string): boolean {
  if (from === to) return true;
  if (!isValidUcum(from) || !isValidUcum(to)) return false;
  try {
    return ucum().convertUnitTo(from, 1, to, false).status === 'succeeded';
  } catch {
    return false;
  }
}
