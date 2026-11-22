import { clamp } from '../utils/math.js';

/**
 * Three hand-tuned quality tiers. Everything the world/aircraft builders read
 * lives here so a single object can drive geometry density, shadows, cloud
 * counts and particle budgets.
 */
export const QUALITY_PRESETS = {
  low: {
    name: 'low',
    label: 'LOW',
    antialias: false,
    pixelRatio: 1,
    pixelScale: 2,
    colorLevels: 32,
    dither: true,
    enemies: 3,
    shadows: false,
    shadowMapSize: 1024,
    treeShadows: false,
    oceanSegments: 128,
    islandRings: 14,
    islandSegments: 36,
    islandLowRings: 6,
    islandLowSegments: 18,
    islandLodDistance: 2400,
    treeDensity: 0.42,
    maxTreesPerIsland: 200,
    cloudClusters: 7,
    cloudPuffs: 5,
    particleCapacity: 220,
    fogNear: 1100,
    fogFar: 8800,
    oceanSize: 24000,
  },
  medium: {
    name: 'medium',
    label: 'MED',
    antialias: true,
    pixelRatio: 1.5,
    pixelScale: 2,
    colorLevels: 48,
    dither: true,
    enemies: 4,
    shadows: true,
    shadowMapSize: 1536,
    treeShadows: false,
    oceanSegments: 176,
    islandRings: 22,
    islandSegments: 52,
    islandLowRings: 9,
    islandLowSegments: 24,
    islandLodDistance: 3000,
    treeDensity: 0.8,
    maxTreesPerIsland: 460,
    cloudClusters: 12,
    cloudPuffs: 6,
    particleCapacity: 340,
    fogNear: 1400,
    fogFar: 10500,
    oceanSize: 26000,
  },
  high: {
    name: 'high',
    label: 'HIGH',
    antialias: true,
    pixelRatio: 2,
    pixelScale: 1,
    colorLevels: 0,
    dither: false,
    enemies: 5,
    shadows: true,
    shadowMapSize: 2048,
    treeShadows: true,
    oceanSegments: 240,
    islandRings: 30,
    islandSegments: 72,
    islandLowRings: 10,
    islandLowSegments: 28,
    islandLodDistance: 3600,
    treeDensity: 1.15,
    maxTreesPerIsland: 700,
    cloudClusters: 17,
    cloudPuffs: 7,
    particleCapacity: 520,
    fogNear: 1500,
    fogFar: 12000,
    oceanSize: 28000,
  },
};

export function detectQualityTier() {
  if (typeof window === 'undefined') return 'high';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = navigator.deviceMemory ?? 4;
  const ua = navigator.userAgent ?? '';
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

  if (coarse) {
    if (cores >= 8 && memory >= 6 && window.innerWidth >= 900) return 'medium';
    return 'low';
  }
  if (mobileUa && (cores < 6 || memory <= 4)) return 'medium';
  if (cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

function readStoredQuality() {
  try {
    return window.localStorage.getItem('skybound.quality');
  } catch {
    return null;
  }
}

export function resolveQuality() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('quality') || readStoredQuality();
  const tier = QUALITY_PRESETS[requested] ? requested : detectQualityTier();
  const preset = QUALITY_PRESETS[tier];

  // ?pixelscale=N overrides the pixel-art block size (1 disables the effect),
  // ?dither=0 turns the ordered-dither pass off.
  const scaleParam = Number(params.get('pixelscale'));
  const pixelScale =
    Number.isFinite(scaleParam) && scaleParam >= 1
      ? Math.min(8, Math.round(scaleParam))
      : preset.pixelScale;
  const dither = params.get('dither') === '0' ? false : preset.dither;

  return {
    ...preset,
    pixelScale,
    dither,
    detected: tier === detectQualityTier(),
    auto: !requested,
    maxPixelRatio: Math.min(window.devicePixelRatio || 1, preset.pixelRatio),
  };
}

export function storeQuality(name) {
  try {
    window.localStorage.setItem('skybound.quality', name);
  } catch {
    /* file:// or privacy mode — the URL parameter still carries the choice */
  }
}

export function applyQualityParam(name) {
  const url = new URL(window.location.href);
  url.searchParams.set('quality', name);
  window.location.replace(url.toString());
}

export function qualityPixelRatio(quality, scale = 1) {
  const dpr = window.devicePixelRatio || 1;
  return clamp(Math.min(dpr, quality.maxPixelRatio) * scale, 0.6, quality.maxPixelRatio);
}
