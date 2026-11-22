/**
 * World maps. Every entry reskins the same archipelago: terrain shape
 * (peak / radius scaling), the island colour palette, what gets scattered
 * over it (trees, buildings, cacti) plus the sky and ocean palette.
 *
 * The active map is resolved from `?map=` (deep link) or from
 * `skybound.map` in localStorage, and defaults to the original coral
 * archipelago. Runtime switches rebuild the world in place.
 */

export const BIOME_IDS = ['coral', 'city', 'desert', 'mountain'];

export const BIOMES = {
  coral: {
    id: 'coral',
    label: 'CORAL',
    tagline: 'KEPULAUAN KARANG',
    peakScale: 1,
    radiusScale: 1,
    treeScale: 1,
    rockScale: 1,
    maxSlope: 0.62,
    snowLine: 0.88,
    minSnowPeak: 240,
    props: 'coral',
    palette: {},
    sky: null,
    ocean: null,
  },

  city: {
    id: 'city',
    label: 'KOTA',
    tagline: 'NEW YORK · METROPOLITAN',
    // One huge contiguous landmass: a Manhattan-style street grid between two
    // rivers, boroughs on either bank, bridges, Central Park and live traffic.
    land: true,
    mainland: {
      id: 'metro',
      name: 'METRO PRIME',
      x: 0,
      z: 0,
      radius: 12500,
      peak: 210,
      elongation: 1.0,
      // Axis aligned so the avenue grid, the rivers and the terrain agree.
      rotation: 0,
      seed: 202601,
      profile: 'city',
    },
    peakScale: 0.55,
    radiusScale: 1.14,
    treeScale: 0.5,
    rockScale: 0.35,
    propBoost: 2.4,
    groundColor: 0x5c6458,
    maxSlope: 0.4,
    snowLine: 0.95,
    minSnowPeak: 400,
    buildingMaxHeight: 130,
    props: 'city',
    palette: {
      wetSand: [0x8d949b, 0x828990],
      sand: [0xa9aeb5, 0x9ea4ab, 0xb4b9bf, 0x979da4],
      lowGrass: [0x6f9a55, 0x648f4d],
      grass: [0x5f8749, 0x577f43, 0x6a9152, 0x4f753d],
      highGrass: [0x4b6b41, 0x517147, 0x44613a],
      rock: [0x7f858c, 0x767c83, 0x8a9097, 0x6d737a],
      highRock: [0x878d94, 0x7d848b, 0x949aa1],
      underwater: [0x8f9aa0, 0x849096],
    },
    sky: {
      top: 0x3f76c9,
      mid: 0x9fc2e8,
      horizon: 0xd9dee4,
      haze: 0xc9d2d8,
      sun: 0xfff2d0,
      hemiSky: 0xcfe0f0,
      hemiGround: 0x5a5f66,
      sunColor: 0xfff4de,
    },
    ocean: {
      deep: 0x12495e,
      mid: 0x1d7f92,
      shallow: 0x57b9c4,
      sky: 0x9fc2e8,
      foam: 0xeef6f8,
    },
  },

  desert: {
    id: 'desert',
    label: 'GURUN',
    tagline: 'SAMUN PASIR',
    // A single vast dune sea: no islands, no waterline in sight.
    land: true,
    mainland: {
      id: 'dunes',
      name: 'THE GREAT DUNES',
      x: 0,
      z: 0,
      radius: 15000,
      peak: 168,
      elongation: 1.08,
      rotation: -0.25,
      seed: 202602,
      profile: 'desert',
      // Oases: shallow spring-fed pools ringed with palms.
      basins: [
        { id: 'oasis-a', x: 1500, z: -700, r: 280, depth: 3, freeboard: 4, minLevel: 6, kind: 'oasis' },
        { id: 'oasis-b', x: -2700, z: 2500, r: 240, depth: 3, freeboard: 4, minLevel: 6, kind: 'oasis' },
        { id: 'oasis-c', x: 3600, z: 3300, r: 300, depth: 3, freeboard: 4, minLevel: 6, kind: 'oasis' },
        { id: 'oasis-d', x: -1400, z: -4300, r: 250, depth: 3, freeboard: 4, minLevel: 6, kind: 'oasis' },
      ],
    },
    peakScale: 0.42,
    radiusScale: 1.16,
    treeScale: 0.34,
    rockScale: 1.7,
    propBoost: 1.5,
    groundColor: 0xd4b87c,
    maxSlope: 0.5,
    snowLine: 0.99,
    minSnowPeak: 900,
    props: 'desert',
    palette: {
      wetSand: [0xd9c288, 0xcdb87f],
      sand: [0xf2dda6, 0xeacf95, 0xffeab8, 0xe7cb90],
      lowGrass: [0xd8c27f, 0xcbb573],
      grass: [0xd2bc76, 0xc7b06c, 0xdcc784, 0xbfa963],
      highGrass: [0xc6b071, 0xcdbb7e, 0xb9a366],
      rock: [0xb58a5f, 0xa87f56, 0xc0966a, 0x9c7550],
      highRock: [0xa8825c, 0x9e7a55, 0xb28c64],
      snow: [0xf7ecd0, 0xf2e6c6, 0xfdf6e4],
      underwater: [0xc3a97a, 0xb59c72],
    },
    sky: {
      top: 0x2f86d6,
      mid: 0x9ad4ef,
      horizon: 0xf6e2b8,
      haze: 0xecd6a4,
      sun: 0xffe9ae,
      hemiSky: 0xd9e6ef,
      hemiGround: 0x8a7448,
      sunColor: 0xffeccb,
    },
    ocean: {
      deep: 0x0f6f86,
      mid: 0x27a9ad,
      shallow: 0x63e0d2,
      sky: 0x9ad4ef,
      foam: 0xf7ffe9,
    },
  },

  mountain: {
    id: 'mountain',
    label: 'GUNUNG',
    tagline: 'PEGUNUNGAN',
    // Broad highland massif: ridgelines and wide valleys as far as the fog.
    land: true,
    mainland: {
      id: 'highland',
      name: 'THE RIDGE',
      x: 0,
      z: 0,
      radius: 16500,
      peak: 1180,
      elongation: 1.04,
      rotation: 0.42,
      seed: 202603,
      profile: 'mountain',
      // Alpine lakes in the valleys, each with a small timber village.
      basins: [
        { id: 'lake-a', x: 900, z: -1200, r: 560, depth: 12, freeboard: 8, minLevel: 22, kind: 'lake' },
        { id: 'lake-b', x: -3300, z: 3600, r: 640, depth: 12, freeboard: 8, minLevel: 22, kind: 'lake' },
        { id: 'lake-c', x: 4300, z: 2600, r: 600, depth: 12, freeboard: 8, minLevel: 22, kind: 'lake' },
        { id: 'lake-d', x: -2600, z: -4200, r: 520, depth: 12, freeboard: 8, minLevel: 22, kind: 'lake' },
      ],
    },
    peakScale: 1.7,
    radiusScale: 1.05,
    treeScale: 0.9,
    rockScale: 1.4,
    propBoost: 1.7,
    groundColor: 0x4d5f43,
    maxSlope: 0.65,
    snowLine: 0.72,
    minSnowPeak: 600,
    props: 'mountain',
    palette: {
      wetSand: [0xbdb5a4, 0xb2aa99],
      sand: [0xcfc7b4, 0xc4bca9, 0xdad2bf, 0xbcb4a2],
      lowGrass: [0x5f8a4a, 0x557f43],
      grass: [0x47703a, 0x3f6733, 0x517b42, 0x375c2d],
      highGrass: [0x37592f, 0x3d6036, 0x2f4f28],
      rock: [0x6f6e73, 0x66656a, 0x7a797e, 0x5c5b60],
      highRock: [0x7d7f86, 0x74767d, 0x888a91],
      snow: [0xffffff, 0xf4fafc, 0xe9f4f8],
      underwater: [0x9aa39b, 0x8e978f],
    },
    sky: {
      top: 0x2a6fc4,
      mid: 0x8ec7ea,
      horizon: 0xdfeaf0,
      haze: 0xcfdfe8,
      sun: 0xfff3d6,
      hemiSky: 0xc7e2f2,
      hemiGround: 0x4c5a54,
      sunColor: 0xfff6e2,
    },
    ocean: {
      deep: 0x0b4f6b,
      mid: 0x178fa4,
      shallow: 0x4fd2c6,
      sky: 0x8ec7ea,
      foam: 0xf2fbff,
    },
  },
};

/** Looks up a map id, falling back to the original coral archipelago. */
export function getBiome(id) {
  return BIOMES[id] ?? BIOMES.coral;
}

/** `?map=` (deep link) wins over the saved preference. */
export function resolveBiome() {
  try {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('map') || window.localStorage.getItem('skybound.map');
    if (requested && BIOMES[requested]) return BIOMES[requested];
  } catch {
    /* file:// or privacy mode — defaults to coral */
  }
  return BIOMES.coral;
}

export function storeBiome(id) {
  try {
    window.localStorage.setItem('skybound.map', id);
  } catch {
    /* ignore — the in-memory switch still applies for this session */
  }
}
