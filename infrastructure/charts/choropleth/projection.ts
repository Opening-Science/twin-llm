/**
 * The Equal Earth projection (Šavrič, Patterson and Jenny, "The Equal Earth
 * map projection", International Journal of Geographical Information
 * Science 33(3), 2019, doi:10.1080/13658816.2018.1504949). Equal-area, so
 * a country's colour covers as much of the map as its land does. Pure.
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const DEG = Math.PI / 180;

export type XY = readonly [number, number];

/** Longitude and latitude in radians to Equal Earth x and y (y grows north). */
export const equalEarth = (lambda: number, phi: number): XY => {
  const theta = Math.asin(M * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const x =
    (2 * Math.sqrt(3) * lambda * Math.cos(theta)) /
    (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, y];
};

/**
 * A longitude relative to the map's centre `lon0`, moved into -180..180.
 * The edges stay where they are (180 is not turned into -180), so a ring
 * that runs along the antimeridian does not jump across the map.
 */
export const wrapLongitude = (lon: number, lon0: number): number => {
  const shifted = lon - lon0;
  if (shifted > 180) return shifted - 360;
  if (shifted < -180) return shifted + 360;
  return shifted;
};

/**
 * Degrees to plane coordinates for SVG: Equal Earth centred on `lon0`, with
 * y flipped so it grows down the screen.
 */
export const projectLonLat = (lon: number, lat: number, lon0 = 0): XY => {
  const [x, y] = equalEarth(wrapLongitude(lon, lon0) * DEG, lat * DEG);
  return [x, -y];
};
