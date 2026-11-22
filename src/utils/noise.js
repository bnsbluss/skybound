/**
 * Deterministic, seedable Perlin noise + fBm used by the procedural world.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const GRADIENTS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function gradDot(hash, x, y) {
  const g = GRADIENTS[hash & 7];
  return g[0] * x + g[1] * y;
}

export class Noise2D {
  constructor(seed = 1337) {
    const random = mulberry32(seed);
    const p = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;

    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    this.perm = p;
  }

  /** Classic 2D Perlin noise in roughly [-1, 1]. */
  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const p = this.perm;

    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];

    const x1 = gradDot(aa, xf, yf);
    const x2 = gradDot(ba, xf - 1, yf);
    const y1 = gradDot(ab, xf, yf - 1);
    const y2 = gradDot(bb, xf - 1, yf - 1);

    const top = x1 + (x2 - x1) * u;
    const bottom = y1 + (y2 - y1) * u;
    return (top + (bottom - top) * v) * 1.4142;
  }

  /** Fractal Brownian motion, normalized to roughly [-1, 1]. */
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in roughly [0, 1] — great for mountain spines. */
  ridged(x, y, octaves = 4, lacunarity = 2.05, gain = 0.55) {
    let amplitude = 0.55;
    let frequency = 1;
    let sum = 0;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(x * frequency, y * frequency));
      n *= n;
      n *= weight;
      weight = Math.min(1, Math.max(0, n * 1.6));
      sum += n * amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return Math.min(1, sum);
  }
}

/** Cheap deterministic 1D wobble used for camera/engine animation. */
export function wobble(t, seed = 0) {
  return (
    Math.sin(t * 1.7 + seed * 13.1) * 0.5 +
    Math.sin(t * 3.9 + seed * 7.7) * 0.3 +
    Math.sin(t * 7.3 + seed * 3.3) * 0.2
  );
}
