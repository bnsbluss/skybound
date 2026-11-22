/**
 * Shared layout of the KOTA (New York style) map. The terrain sampler, the
 * street grid, the traffic simulation and the tests all read these numbers,
 * so the asphalt, the rivers and the collision surface always line up.
 *
 * Coordinates are world metres. The grid is axis aligned:
 *  - AVENUES run north/south (along Z), centred at x = (k + 0.5) * aveSpacing
 *  - STREETS run east/west (along X), centred at z = (j + 0.5) * stSpacing
 *  - block column c is centred at x = c * aveSpacing, block row r at z = r * stSpacing
 */
export const CITY_LAYOUT = {
  ground: 9, // terrain under the whole urban zone
  street: 12, // asphalt deck
  slabTop: 12.8, // sidewalk / block top, buildings stand here
  waterLevel: 10.5,
  riverBed: 4,
  aveSpacing: 250,
  aveWidth: 26,
  stSpacing: 80,
  stWidth: 14,
  manhattanCols: 7, // block columns -7..7
  boroughFirst: 10, // boroughs use |c| >= 10
  boroughMaxCols: 16,
  rows: 66, // block rows -66..66
  flatHalfX: 6900,
  flatHalfZ: 8600,
  // Central Park: block columns -1..1, rows -55..-31 (the inner avenues are
  // swallowed by the park, exactly like 5th Ave / CPW frame the real one).
  park: { c0: -1, c1: 1, r0: -55, r1: -31 },
};

const L = CITY_LAYOUT;

export const aveCenter = (k) => (k + 0.5) * L.aveSpacing;
export const stCenter = (j) => (j + 0.5) * L.stSpacing;

/** Outer x edge of Manhattan's asphalt (outer avenue included). */
export const MANHATTAN_EDGE = (L.manhattanCols + 0.5) * L.aveSpacing + L.aveWidth / 2; // 1888
/** Inner x edge of the boroughs' asphalt. */
export const BOROUGH_INNER = (L.boroughFirst - 0.5) * L.aveSpacing - L.aveWidth / 2; // 2362
/** North/south edge of every urban slab. */
export const URBAN_HALF_Z = (L.rows + 0.5) * L.stSpacing + L.stWidth / 2; // 5327

/** Borough column count for a quality preset (keeps low-end GPUs happy). */
export function boroughCols(quality = {}) {
  const d = quality.treeDensity ?? 1;
  if (d < 0.6) return 6;
  if (d < 1) return 10;
  return L.boroughMaxCols;
}

export function boroughOuter(quality = {}) {
  return (L.boroughFirst + boroughCols(quality) - 1 + 0.5) * L.aveSpacing + L.aveWidth / 2;
}

/** Hudson, East River and the Upper Bay. Terrain is carved under them. */
export const CITY_WATER = [
  { id: 'hudson', x0: -BOROUGH_INNER, x1: -MANHATTAN_EDGE, z0: -12500, z1: URBAN_HALF_Z },
  { id: 'east', x0: MANHATTAN_EDGE, x1: BOROUGH_INNER, z0: -12500, z1: URBAN_HALF_Z },
  { id: 'bay', x0: -7600, x1: 7600, z0: URBAN_HALF_Z, z1: 8400 },
];

/** 1 inside a water rectangle, fading to 0 within 140 m of its bank. */
export function cityWaterMask(x, z) {
  let mask = 0;
  for (const w of CITY_WATER) {
    const dx = Math.max(w.x0 - x, 0, x - w.x1);
    const dz = Math.max(w.z0 - z, 0, z - w.z1);
    const d = Math.hypot(dx, dz);
    if (d >= 140) continue;
    const t = d / 140;
    const m = 1 - t * t * (3 - 2 * t);
    if (m > mask) mask = m;
  }
  return mask;
}

export function isCityWater(x, z) {
  for (const w of CITY_WATER) {
    if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) return true;
  }
  return false;
}

/** Central Park footprint in world metres. */
export function parkRect() {
  const p = L.park;
  return {
    x0: aveCenter(p.c0 - 1) + L.aveWidth / 2,
    x1: aveCenter(p.c1) - L.aveWidth / 2,
    z0: stCenter(p.r0 - 1) + L.stWidth / 2,
    z1: stCenter(p.r1) - L.stWidth / 2,
  };
}

/** East River / Hudson crossings: z position, which river, deck height. */
export const CITY_BRIDGES = [
  { id: 'brooklyn', river: 'east', z: 4520, deck: 44, tower: 96, style: 'stone' },
  { id: 'manhattan', river: 'east', z: 3880, deck: 46, tower: 104, style: 'steel' },
  { id: 'williamsburg', river: 'east', z: 2280, deck: 48, tower: 100, style: 'steel' },
  { id: 'queensboro', river: 'east', z: -1340, deck: 42, tower: 78, style: 'truss' },
  { id: 'gwb', river: 'hudson', z: -4980, deck: 62, tower: 150, style: 'steel' },
];
