import type { BoundaryFeature } from "./boundaries";
import { projectLonLat, wrapLongitude, type XY } from "./projection";

/**
 * Boundaries to SVG: every ring projected, the drawing fitted to a box and
 * written as path data. Pure, so the server-free tests check exact paths.
 */

export type MapShape = Readonly<{
  code: string;
  name: string;
  /** SVG path data; rings are closed with Z and drawn with the even-odd rule. */
  d: string;
  /** Where a tooltip points: the centre of the shape's largest ring, in the viewBox. */
  anchor: XY;
}>;

export type MapLayout = Readonly<{
  width: number;
  height: number;
  shapes: readonly MapShape[];
}>;

export type Box = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;

const EMPTY_BOX: Box = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

const grow = (box: Box, [x, y]: XY): Box => ({
  minX: Math.min(box.minX, x),
  minY: Math.min(box.minY, y),
  maxX: Math.max(box.maxX, x),
  maxY: Math.max(box.maxY, y),
});

const ringsOf = (feature: BoundaryFeature): readonly (readonly XY[])[] =>
  feature.geometry.coordinates.flat();

/** The projected bounding box of some rings in degrees; null when they have no points. */
export const ringsBox = (rings: readonly (readonly XY[])[], lon0: number): Box | null => {
  const box = rings
    .flat()
    .reduce<Box>(
      (acc, [lon, lat]) => grow(acc, projectLonLat(lon, lat, lon0)),
      EMPTY_BOX,
    );
  return Number.isFinite(box.minX) ? box : null;
};

/** The projected bounding box of some features; null when they have no points. */
export const projectedBox = (
  features: readonly BoundaryFeature[],
  lon0: number,
): Box | null => ringsBox(features.flatMap(ringsOf), lon0);

export type Fit = Readonly<{ scale: number; dx: number; dy: number; height: number }>;

/**
 * Scale and offset that fit `box` into `width`, with `padding` on every
 * side. The height follows from the box's shape, capped at `maxHeight`
 * (then the box is fitted to the height and centred across).
 */
export const fitBox = (
  box: Box,
  width: number,
  padding: number,
  maxHeight: number,
): Fit => {
  const spanX = Math.max(box.maxX - box.minX, 1e-9);
  const spanY = Math.max(box.maxY - box.minY, 1e-9);
  const byWidth = (width - 2 * padding) / spanX;
  const height = Math.min(maxHeight, spanY * byWidth + 2 * padding);
  const scale = Math.min(byWidth, (height - 2 * padding) / spanY);
  return {
    scale,
    dx: (width - spanX * scale) / 2 - box.minX * scale,
    dy: (height - spanY * scale) / 2 - box.minY * scale,
    height,
  };
};

/** One decimal of a viewBox unit is far below a pixel at any size we draw. */
const coord = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

/** Path data for projected rings; repeated points after rounding are dropped. */
export const ringsPath = (rings: readonly (readonly XY[])[]): string =>
  rings
    .map((ring) => {
      const points = ring
        .map(([x, y]) => `${coord(x)} ${coord(y)}`)
        .filter((point, index, all) => index === 0 || point !== all[index - 1]);
      return points.length < 3 ? "" : `M${points.join("L")}Z`;
    })
    .join("");

const ringArea = (ring: readonly XY[]): number =>
  Math.abs(
    ring.reduce((sum, [x, y], index) => {
      const [nx, ny] = ring[(index + 1) % ring.length];
      return sum + x * ny - nx * y;
    }, 0) / 2,
  );

const boxCentre = (ring: readonly XY[]): XY => {
  const box = ring.reduce<Box>(grow, EMPTY_BOX);
  return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
};

export type LayoutOptions = Readonly<{
  /** Centre longitude; 0 for the world, a country's own for its states. */
  lon0: number;
  width: number;
  padding: number;
  maxHeight: number;
  /** The projected box to show (see `fitView`); left out, every feature. */
  box?: Box;
}>;

/**
 * Whether a ring crosses the map's edge, the meridian opposite `lon0`: two
 * neighbouring points close on the globe land on opposite sides of the map.
 * Such a ring would be drawn as a band across the whole map, so it is left
 * out; it lies half a world from the centre, outside any fitted view. With
 * `lon0` 0 nothing crosses, as the boundaries are cut at 180.
 */
export const crossesEdge = (ring: readonly XY[], lon0: number): boolean =>
  ring.some(([lon], index) => {
    if (index === 0) return false;
    const [before] = ring[index - 1];
    const wrapped = wrapLongitude(lon, lon0) - wrapLongitude(before, lon0);
    return Math.abs(wrapped) > 180 && Math.abs(lon - before) <= 180;
  });

/**
 * Every feature as a shape, fitted to `box` (or to all of them). Features
 * outside the box are still drawn and clipped by the SVG, so neighbours
 * show at the edges of a region.
 */
export const layoutMap = (
  features: readonly BoundaryFeature[],
  options: LayoutOptions,
): MapLayout => {
  const box = options.box ?? projectedBox(features, options.lon0);
  if (box === null) return { width: options.width, height: 0, shapes: [] };
  const fit = fitBox(box, options.width, options.padding, options.maxHeight);
  const place = ([lon, lat]: XY): XY => {
    const [x, y] = projectLonLat(lon, lat, options.lon0);
    return [x * fit.scale + fit.dx, y * fit.scale + fit.dy];
  };
  return {
    width: options.width,
    height: Math.round(fit.height),
    shapes: features.map((feature) => {
      const rings = ringsOf(feature)
        .filter((ring) => !crossesEdge(ring, options.lon0))
        .map((ring) => ring.map(place));
      const largest = rings.reduce(
        (best, ring) => (ringArea(ring) > ringArea(best) ? ring : best),
        rings[0] ?? [],
      );
      return {
        code: feature.properties.code,
        name: feature.properties.name,
        d: ringsPath(rings),
        anchor: largest.length > 0 ? boxCentre(largest) : [0, 0],
      };
    }),
  };
};

/**
 * Where to centre a country's map: the mean longitude of its rings' box
 * centres, weighted by area. Small islands across the antimeridian (the
 * Aleutians, Chukotka's tip) barely move it.
 */
export const centreLongitude = (features: readonly BoundaryFeature[]): number => {
  const rings = features.flatMap(ringsOf);
  const weighted = rings.reduce(
    (acc, ring) => {
      const area = ringArea(ring);
      return { sum: acc.sum + boxCentre(ring)[0] * area, area: acc.area + area };
    },
    { sum: 0, area: 0 },
  );
  return weighted.area === 0 ? 0 : weighted.sum / weighted.area;
};
