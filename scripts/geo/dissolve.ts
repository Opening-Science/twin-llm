import type { Ring } from "./shapefile";

type Point = readonly [number, number];

const key = (point: Point): string => `${point[0]},${point[1]}`;

/**
 * The outline of several neighbouring units as one: every edge two of the
 * rings share (walked in opposite directions, as neighbours in one consistent
 * winding do) is dropped, and the edges left are joined back into closed
 * rings. Natural Earth's admin-1 units share their border vertices exactly,
 * so a province's inner borders cancel and the region's outline remains.
 * Edges that are not shared exactly are kept, so a gap in the source shows
 * as a line inside the unit rather than being papered over. Rings keep the
 * input winding. Pure.
 */
export const dissolveRings = (rings: readonly Ring[]): Ring[] => {
  const edges = rings.flatMap((ring) =>
    ring.slice(1).map((to, at) => [ring[at] as Point, to] as const),
  );
  const directed = new Map<string, number>();
  edges.forEach(([from, to]) => {
    const id = `${key(from)}>${key(to)}`;
    directed.set(id, (directed.get(id) ?? 0) + 1);
  });
  const kept = edges.filter(
    ([from, to]) =>
      key(from) !== key(to) && (directed.get(`${key(to)}>${key(from)}`) ?? 0) === 0,
  );
  const outgoing = new Map<string, (readonly [Point, Point])[]>();
  kept.forEach((edge) => {
    const list = outgoing.get(key(edge[0])) ?? [];
    outgoing.set(key(edge[0]), [...list, edge]);
  });
  const take = (point: Point): Point | null => {
    const list = outgoing.get(key(point)) ?? [];
    const [next, ...rest] = list;
    if (next === undefined) return null;
    outgoing.set(key(point), rest);
    return next[1];
  };
  return kept.flatMap(([start]) => {
    const firstStep = take(start);
    if (firstStep === null) return [];
    const ring: Point[] = [start, firstStep];
    while (key(ring[ring.length - 1] as Point) !== key(start)) {
      const next = take(ring[ring.length - 1] as Point);
      if (next === null) break;
      ring.push(next);
    }
    return ring.length >= 4 ? [ring] : [];
  });
};
