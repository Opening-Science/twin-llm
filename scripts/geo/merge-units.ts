import type { Ring } from "./shapefile";
import { signedArea } from "./simplify";

type Unit = Readonly<{
  code: string;
  name: string;
  names: readonly string[];
  label: readonly [number, number];
  rings: readonly Ring[];
}>;

const area = (unit: Unit): number =>
  unit.rings.reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0);

/**
 * Natural Earth splits a few countries into several units with one ISO code
 * (Australia and two of its island territories share `AUS`). One feature
 * per code: the rings of all of them, with the names and label point of the
 * largest (a territory's own name is not a name of the country). Order follows each code's first unit.
 */
export const mergeByCode = <U extends Unit>(units: readonly U[]): U[] => {
  const codes = [...new Set(units.map((unit) => unit.code))];
  return codes.map((code) => {
    const group = units.filter((unit) => unit.code === code);
    const main = group.reduce((best, unit) => (area(unit) > area(best) ? unit : best));
    return { ...main, rings: group.flatMap((unit) => unit.rings) };
  });
};
