import { Noise2D, mulberry32 } from './noise.js';
import { clamp, smoothstep } from './math.js';
import { CITY_LAYOUT, cityWaterMask } from '../world/cityLayout.js';

/**
 * Hand-authored archipelago layout, enriched by deterministic procedural
 * height fields. Positions are in metres. Radius describes the size of the
 * whole island footprint (coastline sits around 88-95% of it).
 */
export const ISLAND_BLUEPRINTS = [
  {
    id: 'verdant',
    name: 'VERDANT CROWN',
    x: -320,
    z: -1520,
    radius: 540,
    peak: 218,
    elongation: 1.18,
    rotation: 0.33,
    seed: 101,
    major: true,
  },
  {
    id: 'twin',
    name: 'TWINSPIRE',
    x: 1540,
    z: -2560,
    radius: 640,
    peak: 324,
    elongation: 0.86,
    rotation: -0.52,
    seed: 202,
    major: true,
  },
  {
    id: 'ember',
    name: 'EMBER CAY',
    x: -2130,
    z: -2940,
    radius: 400,
    peak: 96,
    elongation: 1.12,
    rotation: 1.15,
    seed: 303,
    major: true,
  },
  {
    id: 'palm',
    name: 'PALM REEF',
    x: 2460,
    z: 520,
    radius: 470,
    peak: 146,
    elongation: 1.3,
    rotation: -0.98,
    seed: 404,
    major: true,
  },
  {
    id: 'highpeak',
    name: 'HIGHPEAK',
    x: -3140,
    z: 1280,
    radius: 750,
    peak: 382,
    elongation: 1.0,
    rotation: 0.2,
    seed: 505,
    major: true,
  },
  {
    id: 'crescent',
    name: 'CRESCENT',
    x: 940,
    z: 2320,
    radius: 340,
    peak: 88,
    elongation: 1.38,
    rotation: 2.12,
    seed: 606,
    major: true,
  },
  {
    id: 'north',
    name: 'NORTHWATCH',
    x: -1040,
    z: 3640,
    radius: 520,
    peak: 196,
    elongation: 0.92,
    rotation: 0.72,
    seed: 707,
    major: true,
  },
  {
    id: 'far',
    name: 'FAR HAVEN',
    x: 3320,
    z: 3120,
    radius: 470,
    peak: 158,
    elongation: 1.2,
    rotation: -2.03,
    seed: 808,
    major: true,
  },
  {
    id: 'west',
    name: 'WESTWARD',
    x: -4020,
    z: -1710,
    radius: 550,
    peak: 246,
    elongation: 1.05,
    rotation: -0.82,
    seed: 909,
    major: true,
  },
  {
    id: 'titan',
    name: 'TITAN RIDGE',
    x: 4750,
    z: -3720,
    radius: 830,
    peak: 428,
    elongation: 1.16,
    rotation: 0.94,
    seed: 1010,
    major: true,
  },
  {
    id: 'gull',
    name: 'GULL ROCK',
    x: -690,
    z: 470,
    radius: 118,
    peak: 34,
    elongation: 1.1,
    rotation: 0.4,
    seed: 1111,
    major: false,
  },
  {
    id: 'spire',
    name: 'SPIRE ISLET',
    x: 610,
    z: -580,
    radius: 168,
    peak: 62,
    elongation: 0.9,
    rotation: -1.2,
    seed: 1212,
    major: false,
  },
  {
    id: 'mirage',
    name: 'MIRAGE',
    x: -1580,
    z: -820,
    radius: 142,
    peak: 38,
    elongation: 1.5,
    rotation: 1.8,
    seed: 1313,
    major: false,
  },
  {
    id: 'tiny',
    name: 'LITTLE EYE',
    x: 3360,
    z: 120,
    radius: 110,
    peak: 27,
    elongation: 1.0,
    rotation: 0.9,
    seed: 1414,
    major: false,
  },
  {
    id: 'shoal',
    name: 'SHOAL',
    x: -2680,
    z: 420,
    radius: 155,
    peak: 41,
    elongation: 1.34,
    rotation: -0.35,
    seed: 1515,
    major: false,
  },
];

/**
 * Creates a fast analytic island sampler. The same function drives the mesh,
 * tree placement, radar contacts and collision, so visuals and physics agree.
 *
 * `biome` selects a height profile:
 *  - coral: the original volcanic island silhouette
 *  - city: a broad, almost flat plain with low hills toward the map rim
 *  - desert: a vast dune sea with long, soft ridges
 *  - mountain: wide highland massifs, ridgelines and deep valleys
 */
export function createIsland(def, biome = null) {
  const noise = new Noise2D(def.seed);
  const detailNoise = new Noise2D(def.seed + 7919);
  const R = def.radius;
  const elong = def.elongation;
  const peak = def.peak;
  const profile = def.profile ?? biome?.mainland?.profile ?? 'coral';
  const cosR = Math.cos(def.rotation);
  const sinR = Math.sin(def.rotation);

  const baseHeightAt = (X, Z) => {
    const d = Math.hypot(X / (R * elong), Z / R);
    if (d > 1.35) return -80;
    const edgeWarp = noise.noise(X * 0.0032 + 8.3, Z * 0.0032 - 4.1);
    const dWarp = d * (1 + edgeWarp * 0.075);

    if (profile === 'city') {
      // Nearly flat downtown, low hills rising only near the outer districts.
      const fbm = noise.fbm(X * 0.00072 + 4.7, Z * 0.00072 - 8.2, 3) * 0.5 + 0.5;
      const hills = noise.ridged(X * 0.00155 - 12.4, Z * 0.00155 + 6.1, 3);
      const plateau = Math.pow(clamp(1 - dWarp, 0, 1), 1.6);
      let h = 11 + fbm * 12 + plateau * 24;
      h += 28 * smoothstep(0.66, 1.02, dWarp) * (0.42 + 0.58 * hills);
      h += detailNoise.fbm(X * 0.0042 + 2.2, Z * 0.0042 - 5.6, 3) * 5.5;
      h -= 3.2;
      // New York style urban zone: a dead-flat deck for the street grid that
      // blends into the rolling outskirts, with the Hudson, the East River and
      // the Upper Bay carved out as real channels.
      const ex = Math.max(0, Math.abs(X) - CITY_LAYOUT.flatHalfX);
      const ez = Math.max(0, Math.abs(Z) - CITY_LAYOUT.flatHalfZ);
      const flat = 1 - smoothstep(0, 2400, Math.hypot(ex, ez));
      h += (CITY_LAYOUT.ground - h) * flat;
      const water = cityWaterMask(X, Z);
      if (water > 0) h += (CITY_LAYOUT.riverBed - h) * water;
      if (dWarp > 1.02) h = -8 - (dWarp - 1.02) * 44;
      return h;
    }

    if (profile === 'desert') {
      // Long dune bands: two low-frequency swells plus a sharper crest field.
      const swell = noise.fbm(X * 0.00062 - 2.1, Z * 0.00062 + 9.4, 4) * 0.5 + 0.5;
      const dune = noise.ridged(X * 0.0019 + 17.3, Z * 0.0019 - 11.8, 4);
      const detail = detailNoise.fbm(X * 0.009 + 3.7, Z * 0.009 - 1.4, 3);
      const basin = Math.pow(clamp(1 - dWarp, 0, 1), 1.2);
      let h = 7 + swell * 78 + dune * 44 * (0.35 + basin * 0.65);
      h += basin * 26 + detail * 8;
      h -= 2.4;
      if (dWarp > 1.03) h = -9 - (dWarp - 1.03) * 46;
      return h;
    }

    if (profile === 'mountain') {
      // Broad highland massif. Every feature is deliberately kept at a
      // multi-kilometre wavelength: the radial mesh only has ~400–600 m
      // triangles out here, so finer noise would alias into needles and a
      // shredded silhouette. One low crest field adds relief without turning
      // the range into a field of spikes.
      const mask = 1 - smoothstep(0.0, 1.08, dWarp);
      const massif = noise.fbm(X * 0.00036 + 4.7, Z * 0.00036 - 8.2, 3) * 0.5 + 0.5;
      const crest = noise.ridged(X * 0.00062 + 21.4, Z * 0.00062 - 13.7, 2);
      const valley = noise.fbm(X * 0.00045 + 12.8, Z * 0.00045 - 7.3, 3) * 0.5 + 0.5;
      const detail = detailNoise.fbm(X * 0.002 - 4.4, Z * 0.002 + 16.1, 2);
      let h = 26 + peak * (0.28 + 0.72 * massif) * mask;
      h += peak * 0.18 * crest * mask;
      h += peak * 0.012 * detail * mask;
      h += 10 * (noise.fbm(X * 0.0008 - 15.1, Z * 0.0008 + 22.7, 2) * 0.5 + 0.5) * mask;
      h -= peak * 0.17 * valley * mask;
      if (dWarp > 1.03) h = -10 - (dWarp - 1.03) * 48;
      return h;
    }

    // Coral archipelago: the original volcanic island profile.
    const mountain = Math.pow(1 - smoothstep(0.015, 0.985, dWarp), 1.32);
    const ridge = noise.ridged(X * 0.0055 + 21.4, Z * 0.0055 - 13.7, 4);
    let h = peak * mountain * (0.76 + 0.38 * ridge);
    h += peak * 0.12 * (noise.fbm(X * 0.0042 - 3.1, Z * 0.0042 + 7.4, 4) * 0.5 + 0.5) * mountain;
    h += peak * 0.038 * detailNoise.fbm(X * 0.019 + 4.4, Z * 0.019 - 9.2, 3) * mountain;
    // Carve a couple of broad valleys for readable low-poly silhouettes.
    h += peak * 0.08 * noise.noise(X * 0.0026 - 17.2, Z * 0.0026 + 23.8) * mountain;
    h -= 3.1;
    if (dWarp > 1.0) h = -10 - (dWarp - 1.0) * 52;
    return h;
  };

  // Basins (desert oases, alpine lakes) are carved into the base field. The
  // water level sits below the lowest point of the surrounding rim, so the
  // pool is always enclosed and never hangs in the air.
  const basins = (def.basins ?? []).map((b) => {
    const dx = b.x - def.x;
    const dz = b.z - def.z;
    const X = dx * cosR - dz * sinR;
    const Z = dx * sinR + dz * cosR;
    let rim = baseHeightAt(X, Z);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const k of [0.7, 1.05, 1.35]) {
        rim = Math.min(rim, baseHeightAt(X + Math.cos(a) * b.r * k, Z + Math.sin(a) * b.r * k));
      }
    }
    const depth = b.depth ?? 6;
    const level = Math.max(b.minLevel ?? 6, rim - (b.freeboard ?? 6));
    return { ...b, X, Z, level, floor: level - depth };
  });

  const heightLocalAt = (X, Z) => {
    let h = baseHeightAt(X, Z);
    for (let i = 0; i < basins.length; i++) {
      const b = basins[i];
      const d = Math.hypot(X - b.X, Z - b.Z) / b.r;
      if (d >= 1.6) continue;
      const s = smoothstep(0.55, 1.6, d);
      const carved = b.floor + (h - b.floor) * s;
      if (carved < h) h = carved;
    }
    return h;
  };

  const toLocal = (x, z) => {
    const dx = x - def.x;
    const dz = z - def.z;
    return [dx * cosR - dz * sinR, dx * sinR + dz * cosR];
  };

  const toWorldXZ = (X, Z) => [
    def.x + X * cosR + Z * sinR,
    def.z - X * sinR + Z * cosR,
  ];

  const heightAt = (x, z) => {
    const [X, Z] = toLocal(x, z);
    return heightLocalAt(X, Z);
  };

  const slopeAt = (x, z, eps = 4) => {
    const hx = heightAt(x + eps, z) - heightAt(x - eps, z);
    const hz = heightAt(x, z + eps) - heightAt(x, z - eps);
    return Math.hypot(hx, hz) / (eps * 2);
  };

  // Sample the coastline at 48 compass directions. This gives the average
  // normalised coast and a seed used by the shallow-water shader.
  const coastSamples = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const dx = Math.cos(a) * R * elong;
    const dz = Math.sin(a) * R;
    let lo = 0.2;
    let hi = 1.25;
    for (let step = 0; step < 12; step++) {
      const mid = (lo + hi) * 0.5;
      if (heightLocalAt(dx * mid, dz * mid) > 0) lo = mid;
      else hi = mid;
    }
    const t = (lo + hi) * 0.5;
    coastSamples.push({
      angle: a,
      ratio: t,
      x: def.x + dx * t * cosR + dz * t * sinR,
      z: def.z - dx * t * sinR + dz * t * cosR,
    });
  }
  const coastRatio =
    coastSamples.reduce((sum, s) => sum + s.ratio, 0) / coastSamples.length;
  const coastRadius =
    coastSamples.reduce((sum, s) => sum + s.ratio * R, 0) / coastSamples.length;
  const maxCoastRadius = Math.max(...coastSamples.map((s) => s.ratio * R));

  return {
    def,
    noise,
    heightAt,
    heightLocalAt,
    slopeAt,
    toLocal,
    toWorldXZ,
    coastRatio,
    coastRadius,
    maxCoastRadius,
    coastSamples,
    basins,
    /** Broad phase for collision and shader tests. */
    footprintRadius: R * Math.max(elong, 1) * 1.1,
  };
}

export function createArchipelago(quality = {}, biome = null) {
  // Land maps (city / desert / mountain) are one huge contiguous mainland.
  // Everything else keeps the hand-authored archipelago layout.
  if (biome?.land && biome.mainland) {
    const base = biome.mainland;
    const def = {
      ...base,
      radius: Math.round(base.radius * (biome.radiusScale ?? 1)),
      peak: Math.round(base.peak * (biome.peakScale ?? 1)),
      major: true,
      profile: base.profile ?? biome.props ?? 'coral',
    };
    return [
      {
        ...createIsland(def, biome),
        treeCountTarget: Math.round(
          (def.radius / 500) * (quality.treeDensity ?? 1) * (biome.propBoost ?? 1.6)
        ),
      },
    ];
  }

  // The coral map stretches the same blueprints: taller massifs for the
  // mountains, wider and flatter shelves for the city / desert maps.
  const peakScale = biome?.peakScale ?? 1;
  const radiusScale = biome?.radiusScale ?? 1;
  const islands = ISLAND_BLUEPRINTS.map((base) => {
    const def = {
      ...base,
      radius: Math.round(base.radius * radiusScale),
      peak: Math.round(base.peak * peakScale),
    };
    return {
      ...createIsland(def, biome),
      treeCountTarget: Math.round(
        (def.major ? 380 : 80) * (def.radius / 500) * (quality.treeDensity ?? 1)
      ),
    };
  });
  return islands;
}

/**
 * Samples shore points for foam decoration / small props.
 */
export function sampleIslandPoints(island, count, seedOffset = 1) {
  const random = mulberry32(island.def.seed + seedOffset);
  const points = [];
  let guard = 0;
  while (points.length < count && guard < count * 24) {
    guard++;
    const angle = random() * Math.PI * 2;
    const dist = Math.sqrt(random()) * island.def.radius * 0.95;
    const [x, z] = island.toWorldXZ(
      Math.cos(angle) * dist * island.def.elongation,
      Math.sin(angle) * dist
    );
    const h = island.heightAt(x, z);
    const slope = island.slopeAt(x, z, 3);
    points.push({ x, z, height: h, slope, random: random() });
  }
  return points;
}

export function describeIsland(island) {
  const d = island.def;
  return `${d.name} · r${Math.round(island.coastRadius)}m · peak ${Math.round(d.peak)}m`;
}
