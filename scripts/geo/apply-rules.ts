import { normalizeName } from "../../infrastructure/charts/choropleth/match-location";

import { dissolveRings } from "./dissolve";
import type { CountryRules, Members } from "./gbd-boundaries";
import type { DbfValue, Ring } from "./shapefile";

/** One Natural Earth admin-1 unit, or one built from several. */
export type StateUnit = Readonly<{
  country: string;
  code: string;
  name: string;
  names: readonly string[];
  rings: readonly Ring[];
  fields: Readonly<Record<string, DbfValue>>;
}>;

const isMember = (unit: StateUnit, members: Members): boolean =>
  Array.isArray(members)
    ? members.includes(unit.code)
    : !Array.isArray(members) &&
      "field" in members &&
      unit.fields[members.field] === members.value &&
      !(members.except ?? []).includes(unit.code);

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * One country's boundary units after its rules (gbd-boundaries.ts): borrowed
 * units added, members dissolved into their GBD unit (in the place of the
 * first member), codes replaced, names corrected and aliases added. Throws
 * when a rule names a unit that is not there, so a new Natural Earth release
 * cannot quietly leave a rule unused. Pure.
 */
export const applyCountryRules = (
  country: string,
  rules: CountryRules,
  all: readonly StateUnit[],
): StateUnit[] => {
  const borrowed = (rules.borrow ?? []).map((code) => {
    const unit = all.find((candidate) => candidate.code === code);
    if (unit === undefined) throw new Error(`${country}: nothing to borrow for ${code}`);
    return { ...unit, country };
  });
  const pool = [...all.filter((unit) => unit.country === country), ...borrowed];

  const groups = (rules.dissolve ?? []).map((rule) => {
    const members = pool.filter((unit) => isMember(unit, rule.members));
    if (members.length === 0) throw new Error(`${country}: ${rule.name} has no members`);
    return { rule, members };
  });
  const firstMember = new Map(
    groups.map(({ rule, members }) => [members[0], rule.code] as const),
  );
  const joined = new Map(
    groups.map(({ rule, members }) => {
      const unit: StateUnit = {
        country,
        code: rule.code,
        name: rule.name,
        names: unique([rule.name, ...(rule.names ?? [])]),
        rings: dissolveRings(members.flatMap((member) => member.rings)),
        fields: {},
      };
      return [rule.code, unit] as const;
    }),
  );
  const consumed = new Set(groups.flatMap(({ members }) => members));

  const recode = rules.recode ?? {};
  const rename = rules.rename ?? {};
  const used = new Set<string>();
  const kept = pool.flatMap((unit): StateUnit[] => {
    const start = firstMember.get(unit);
    if (start !== undefined) return [joined.get(start) as StateUnit];
    if (consumed.has(unit)) return [];
    const recodeKey = [`${unit.code}|${unit.name}`, unit.code].find(
      (key) => recode[key] !== undefined,
    );
    if (recodeKey !== undefined) used.add(recodeKey);
    const newName = rename[unit.code];
    if (newName !== undefined) used.add(`rename:${unit.code}`);
    return [
      {
        ...unit,
        code: recodeKey === undefined ? unit.code : (recode[recodeKey] as string),
        name: newName ?? unit.name,
        names: newName === undefined ? unit.names : [newName],
      },
    ];
  });
  const unused = [
    ...Object.keys(recode).filter((key) => !used.has(key)),
    ...Object.keys(rename).filter((code) => !used.has(`rename:${code}`)),
  ];
  if (unused.length > 0) throw new Error(`${country}: unused rules ${unused.join(", ")}`);

  const aliases = Object.entries(rules.aliases ?? {});
  aliases.forEach(([name, code]) => {
    if (!kept.some((unit) => unit.code === code)) {
      throw new Error(`${country}: alias ${name} names no unit ${code}`);
    }
  });
  return kept.map((unit) => ({
    ...unit,
    names: unique([
      ...unit.names,
      ...aliases.filter(([, code]) => code === unit.code).map(([name]) => name),
    ]),
  }));
};

export type GbdUnitName = Readonly<{ name: string; iso3166_2: string | null }>;

/**
 * Takes out of each unit's other names any GBD unit name that belongs to a
 * different boundary, so a name match cannot land on the wrong unit
 * (Natural Earth lists "Southampton" among Hampshire's names, and GBD has
 * both). A GBD name belongs to the boundary with its ISO code, else to the
 * one its alias names, else to the one that has it as its own name, else to
 * none. Pure.
 */
export const reserveGbdNames = (
  units: readonly StateUnit[],
  gbd: readonly GbdUnitName[],
  aliases: Readonly<Record<string, string>> = {},
): StateUnit[] => {
  const owner = new Map(
    gbd.map((unit) => {
      const wanted = normalizeName(unit.name);
      const target =
        units.find((candidate) => candidate.code === unit.iso3166_2) ??
        units.find((candidate) => candidate.code === aliases[unit.name]) ??
        units.find((candidate) => normalizeName(candidate.name) === wanted);
      return [wanted, target?.code ?? null] as const;
    }),
  );
  return units.map((unit) => ({
    ...unit,
    names: unit.names.filter((name) => {
      const wanted = normalizeName(name);
      return name === unit.name || !owner.has(wanted) || owner.get(wanted) === unit.code;
    }),
  }));
};
