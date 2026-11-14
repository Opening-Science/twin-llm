import { describe, expect, it } from 'vitest';
import { createObservation } from '../observation';
import {
  parseGermanDecimal,
  parseGermanInterval,
  RANGE_TYPE,
  REFERENCE_RANGE_SOURCE_URL,
  referenceInterval
} from '../referenceRange';
import { SYSTEMS } from '../systems';
import { quantity, UCUM } from '../units';

const IMD_2025 = {
  url: 'https://www.imd-berlin.de/fileadmin/user_upload/leistungsverzeichnis_druck/imd_leistungsverzeichnis_2025-03-06.pdf',
  publisher: 'IMD Berlin, Leistungsverzeichnis',
  retrieved: '2026-07-12',
  version: '2025-02-12'
};
const IMD_2015 = {
  url: 'https://www.imd-berlin.de/fileadmin/user_upload/leistungsverzeichnis_druck/09a_Referenzbereiche_Standort_Potsdam.pdf',
  publisher: 'IMD Labor Berlin-Potsdam, Referenzbereiche',
  retrieved: '2026-07-12',
  version: '2015-09-28'
};

describe('parseGermanDecimal', () => {
  it('reads a comma as the decimal point', () => {
    expect(parseGermanDecimal('4,7')).toBe(4.7);
    expect(parseGermanDecimal('6,2')).toBe(6.2);
  });

  it('reads a point as a thousands separator', () => {
    // The workbook specifies the format 1.234,000.
    expect(parseGermanDecimal('1.234,5')).toBe(1234.5);
    expect(parseGermanDecimal('1.234.567,89')).toBe(1234567.89);
  });

  it('does not turn 4,7 into 47', () => {
    // The failure this function exists to prevent. Stripping the comma instead of
    // converting it gives 47, and an HbA1c upper bound of 47% is wrong in a way no
    // structural or UCUM check will ever catch — it is a plausible number.
    expect(parseGermanDecimal('4,7')).not.toBe(47);
    expect(parseGermanDecimal('5,7')).toBeCloseTo(5.7, 10);
  });

  it('handles integers and negatives', () => {
    expect(parseGermanDecimal('40')).toBe(40);
    expect(parseGermanDecimal('-2,5')).toBe(-2.5);
  });

  it('rejects rather than guesses', () => {
    // An English-formatted number is ambiguous here: '4.7' means 47 under German
    // rules if the point is a thousands separator. Refusing is the only safe answer.
    for (const bad of ['', 'n.a.', '4,7,1', 'siehe Text', '< 5,7']) {
      expect(() => parseGermanDecimal(bad)).toThrow(TypeError);
    }
  });

  it('rejects a German date, which otherwise parses to a plausible number', () => {
    // The failure the original expression allowed: '12.02.2025' matched, the points
    // were stripped as thousands separators, and the result was 12022025 — no throw,
    // no NaN, just a large number in a reference range. The catalogues print dates in
    // exactly this form ('Stand 12.02.2025') on the same page as the intervals, so a
    // mis-scraped cell had a silent path all the way through.
    for (const date of ['12.02.2025', '1.2.3', '28.09.2015', '...5', '.5']) {
      expect(() => parseGermanDecimal(date)).toThrow(TypeError);
    }
  });

  it('still accepts ungrouped integers, which the fix must not exclude', () => {
    // Guarding the guard: requiring three-digit groups everywhere would reject '12345',
    // and platelet or enzyme counts are written without separators.
    expect(parseGermanDecimal('12345')).toBe(12345);
    expect(parseGermanDecimal('150000')).toBe(150000);
  });
});

describe('parseGermanInterval', () => {
  it('reads a two-sided range', () => {
    expect(parseGermanInterval('4,7 - 6,2')).toEqual({ low: 4.7, high: 6.2 });
    expect(parseGermanInterval('4,7–6,2')).toEqual({ low: 4.7, high: 6.2 });
    expect(parseGermanInterval('4,7 bis 6,2')).toEqual({ low: 4.7, high: 6.2 });
  });

  it('reads a one-sided upper bound without inventing a lower one', () => {
    // '< 5,7' has no low. Supplying low: 0 would assert a boundary the laboratory
    // never published.
    expect(parseGermanInterval('< 5,7')).toEqual({ high: 5.7 });
    expect(parseGermanInterval('≤ 5,7')).toEqual({ high: 5.7 });
    expect(parseGermanInterval('bis 5,7')).toEqual({ high: 5.7 });
  });

  it('reads a one-sided lower bound', () => {
    expect(parseGermanInterval('> 40')).toEqual({ low: 40 });
    expect(parseGermanInterval('ab 40')).toEqual({ low: 40 });
  });

  it('returns undefined for text it does not understand, so the caller abstains', () => {
    for (const text of ['negativ', 'siehe Befund', 'methodenabhängig', '']) {
      expect(parseGermanInterval(text)).toBeUndefined();
    }
  });
});

describe('referenceInterval', () => {
  it('carries the source, because an interval without one is not usable', () => {
    // The Anchor rule: never from memory, never without a source URL and a retrieval
    // date. FHIR has no field for it, so it travels in a declared extension.
    const range = referenceInterval({ high: 5.7, unit: UCUM.PERCENT, type: RANGE_TYPE.RECOMMENDED, source: IMD_2025 });
    const source = range.extension?.find((e) => e.url === REFERENCE_RANGE_SOURCE_URL);
    const parts = Object.fromEntries(
      (source?.extension ?? []).map((e) => [e.url, e.valueUrl ?? e.valueString ?? e.valueDate])
    );
    expect(parts.url).toContain('imd-berlin.de');
    expect(parts.publisher).toBe('IMD Berlin, Leistungsverzeichnis');
    expect(parts.retrieved).toBe('2026-07-12');
  });

  it('emits a one-sided interval with only the bound the source gave', () => {
    const range = referenceInterval({ high: 5.7, unit: UCUM.PERCENT, type: RANGE_TYPE.RECOMMENDED, source: IMD_2025 });
    expect(range.high).toEqual({ value: 5.7, unit: '%', system: SYSTEMS.UCUM, code: '%' });
    expect(range.low).toBeUndefined();
  });

  it('refuses an interval with neither bound', () => {
    expect(() => referenceInterval({ unit: UCUM.PERCENT, type: RANGE_TYPE.NORMAL, source: IMD_2025 })).toThrow(
      TypeError
    );
  });

  it('refuses an inverted interval', () => {
    // FHIR has no invariant against low > high, so this would have validated cleanly
    // and then judged every value — including correct ones — as out of range. Two
    // swapped columns in a spreadsheet is the obvious way to produce it.
    expect(() =>
      referenceInterval({ low: 6.2, high: 4.7, unit: UCUM.PERCENT, type: RANGE_TYPE.NORMAL, source: IMD_2015 })
    ).toThrow(TypeError);
  });

  it('allows a degenerate interval where low equals high', () => {
    // Not inverted, just narrow. A source is entitled to publish a single point.
    expect(() =>
      referenceInterval({ low: 5, high: 5, unit: UCUM.PERCENT, type: RANGE_TYPE.NORMAL, source: IMD_2015 })
    ).not.toThrow();
  });

  it('keeps the laboratory’s own wording alongside the parsed bounds', () => {
    const range = referenceInterval({
      high: 5.7,
      unit: UCUM.PERCENT,
      type: RANGE_TYPE.RECOMMENDED,
      source: IMD_2025,
      text: '< 5,7 %'
    });
    expect(range.text).toBe('< 5,7 %');
  });
});

describe('the HbA1c case', () => {
  /**
   * The Anchor layer's central finding, as a test.
   *
   * IMD Berlin's 2025 catalogue gives < 5,7 % and its 2015 catalogue 4,7 - 6,2 %.
   * Same laboratory. Both correct. One is a diagnostic decision boundary, the other a
   * population distribution. A model holding one canonical range per analyte must
   * discard one of them, and whichever it discards is the answer to some question it
   * will later be asked.
   */
  const diagnostic = referenceInterval({
    high: 5.7,
    unit: UCUM.PERCENT,
    type: RANGE_TYPE.RECOMMENDED,
    source: IMD_2025,
    text: '< 5,7 %'
  });
  const population = referenceInterval({
    low: 4.7,
    high: 6.2,
    unit: UCUM.PERCENT,
    type: RANGE_TYPE.NORMAL,
    source: IMD_2015,
    text: '4,7 - 6,2 %'
  });

  const observation = createObservation({
    code: { system: SYSTEMS.LOINC, code: '4548-4' },
    category: { code: 'laboratory', display: 'Laboratory' },
    subject: { reference: 'urn:uuid:cd483717-65bb-5d76-a007-ddb564f6c2cb' },
    effectiveDateTime: '2026-07-12T09:00:00+02:00',
    valueQuantity: quantity(5.9, UCUM.PERCENT),
    referenceRange: [diagnostic, population]
  });

  it('carries both intervals on one Observation, neither discarded', () => {
    expect(observation.referenceRange).toHaveLength(2);
  });

  it('tells them apart by type rather than by order', () => {
    const types = (observation.referenceRange ?? []).map((r) => r.type?.coding?.[0]?.code);
    expect(types).toEqual(['recommended', 'normal']);
  });

  it('keeps each interval attributable to the catalogue it came from', () => {
    const versions = (observation.referenceRange ?? []).map(
      (r) =>
        r.extension?.find((e) => e.url === REFERENCE_RANGE_SOURCE_URL)?.extension?.find((e) => e.url === 'version')
          ?.valueString
    );
    expect(versions).toEqual(['2025-02-12', '2015-09-28']);
  });

  it('is a value that both intervals judge differently', () => {
    // 5,9 % is above the 2025 diagnostic cutoff and inside the 2015 population range.
    // The disagreement is the point: a consumer must be able to see both verdicts.
    expect(observation.valueQuantity?.value).toBe(5.9);
    expect(diagnostic.high?.value).toBeLessThan(5.9);
    expect(population.high?.value).toBeGreaterThan(5.9);
  });
});

describe('the abstain contract', () => {
  it('omits referenceRange entirely when no interval arrived', () => {
    // Invariant 3: if a result arrives without an interval, the field is null and the
    // model abstains. An empty array or a zero-width range would both read as "an
    // interval exists", which is the one thing that must not happen.
    const observation = createObservation({
      code: { system: SYSTEMS.LOINC, code: '4548-4' },
      subject: { reference: 'urn:uuid:cd483717-65bb-5d76-a007-ddb564f6c2cb' },
      valueQuantity: quantity(5.9, UCUM.PERCENT)
    });
    expect(observation.referenceRange).toBeUndefined();
    expect('referenceRange' in observation).toBe(false);
  });

  it('omits it for an empty array too, rather than emitting one', () => {
    const observation = createObservation({
      code: { system: SYSTEMS.LOINC, code: '4548-4' },
      subject: { reference: 'urn:uuid:cd483717-65bb-5d76-a007-ddb564f6c2cb' },
      valueQuantity: quantity(5.9, UCUM.PERCENT),
      referenceRange: []
    });
    expect(observation.referenceRange).toBeUndefined();
  });

  it('survives serialisation without gaining a range', () => {
    const observation = createObservation({
      code: { system: SYSTEMS.LOINC, code: '4548-4' },
      subject: { reference: 'urn:uuid:cd483717-65bb-5d76-a007-ddb564f6c2cb' },
      valueQuantity: quantity(5.9, UCUM.PERCENT)
    });
    expect(JSON.stringify(observation)).not.toContain('referenceRange');
  });
});
