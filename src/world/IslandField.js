import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createArchipelago } from '../utils/terrain.js';
import { BIOMES } from './Biomes.js';
import { CityGrid } from './CityGrid.js';
import { clamp, smoothstep } from '../utils/math.js';
import { flattenGeometry, paintGeometry, transformGeometry, upwardWinding } from '../utils/geometry.js';
import { mulberry32 } from '../utils/noise.js';

const PALETTE = {
  sand: [0xf6e1a9, 0xefd494, 0xffe9ba, 0xf2d99d],
  wetSand: [0xe2c98f, 0xd9bd83],
  lowGrass: [0x8dcc59, 0x7bc24e, 0xa3d964],
  grass: [0x62b147, 0x55a342, 0x6cba4f, 0x4c9440],
  highGrass: [0x4a8d3f, 0x55864a, 0x3f7c39],
  rock: [0x8b8475, 0x746f64, 0x9a9181, 0x67645c],
  highRock: [0x8f928f, 0x7d8383, 0xa5a7a0],
  snow: [0xeff8f3, 0xe2f0eb, 0xf9fffb],
  underwater: [0xc0ae7c, 0xa89d78],
};

function pick(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

/**
 * Builds a faceted radial island mesh. All triangles are unique vertices so
 * normals and colours stay crisp and low-poly.
 */
function buildIslandGeometry(island, rings, segments, palette = PALETTE, biome = null) {
  const def = island.def;
  const R = def.radius;
  const elong = def.elongation;
  const peak = def.peak;
  const snowLine = biome?.snowLine ?? 0.88;
  const minSnowPeak = biome?.minSnowPeak ?? 240;
  const rand = mulberry32(def.seed + rings * 31 + segments);
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  const colorB = new THREE.Color();

  const grid = [];
  const land = !!biome?.land;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    // Land maps concentrate rings near the centre so the downtown relief is
    // sampled finely while the far rim (hidden under the ground plane) can
    // use broad triangles.
    const rr = land
      ? 0.018 + (1.235 - 0.018) * Math.pow(t, 1.6)
      : 0.018 + (1.235 - 0.018) * t;
    const row = [];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const X = Math.cos(a) * R * elong * rr;
      const Z = Math.sin(a) * R * rr;
      row.push({ x: X, y: island.heightLocalAt(X, Z), z: Z });
    }
    grid.push(row);
  }

  const center = { x: 0, y: island.heightLocalAt(0, 0), z: 0 };

  const faceColor = (a, b, c) => {
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    ny /= len;
    const slope = 1 - clamp(ny, 0, 1);
    const patch = island.noise.noise(cx * 0.031 - 9.1, cz * 0.031 + 13.7);

    // Basin tinting: lush oasis green rings in the desert, gravel shores around alpine lakes.
    if (island.basins?.length) {
      for (let i = 0; i < island.basins.length; i++) {
        const b = island.basins[i];
        const d = Math.hypot(cx - b.X, cz - b.Z) / b.r;
        if (d < 1.55) {
          if (b.kind === 'oasis') {
            if (cy <= b.level + 0.6) return color.setHex(0x88b37b);
            const green = 1 - smoothstep(0.75, 1.55, d);
            color.setHex(palette.sand[0]).lerp(colorB.setHex(0x4b8f42), green * 0.85);
            color.multiplyScalar(0.95 + rand() * 0.08);
            return color;
          }
          if (b.kind === 'lake' && cy <= b.level + 4) {
            return color.setHex(pick(palette.sand, rand));
          }
        }
      }
    }

    if (biome?.props === 'mountain') {
      // Smooth altitude/slope gradients instead of a per-face palette raffle.
      if (cy < 0) return color.setHex(pick(palette.underwater, rand));
      if (cy < 1.2) return color.setHex(pick(palette.wetSand, rand));
      if (cy < 4.8) return color.setHex(pick(palette.sand, rand));

      const grassMix = clamp(cy / (peak * 0.52), 0, 1);
      color
        .setHex(palette.lowGrass[0])
        .lerp(colorB.setHex(palette.grass[2]), grassMix * 0.85);
      const broad = island.noise.noise(cx * 0.0011 - 9.1, cz * 0.0011 + 13.7);
      if (broad > 0) {
        color.lerp(colorB.setHex(palette.highGrass[1]), broad * 0.32);
      }
      const rockMix = smoothstep(0.5, 0.82, slope);
      if (rockMix > 0) color.lerp(colorB.setHex(palette.rock[2]), rockMix * 0.88);
      const highRock = smoothstep(peak * 0.58, peak * 0.72, cy);
      if (highRock > 0) color.lerp(colorB.setHex(palette.highRock[1]), highRock);
      const snow = smoothstep(peak * 0.72, peak * 0.81, cy);
      if (snow > 0) color.lerp(colorB.setHex(palette.snow[0]), snow);
      color.multiplyScalar(0.975 + rand() * 0.05);
      return color;
    }

    if (biome?.props === 'desert') {
      // Warm smooth dune shading: golden crests, terracotta slip-faces, red-brown rocky outcrops.
      if (cy < 0) return color.setHex(pick(palette.underwater, rand));
      const altT = clamp(cy / (peak * 0.85), 0, 1);
      color.setHex(palette.wetSand[0]).lerp(colorB.setHex(palette.sand[2]), altT * 0.88);
      const ripple = island.noise.noise(cx * 0.0018 + 3.1, cz * 0.0018 - 5.4);
      if (ripple > 0) color.lerp(colorB.setHex(palette.lowGrass[0]), ripple * 0.35);
      const rockMix = smoothstep(0.32, 0.62, slope);
      if (rockMix > 0) color.lerp(colorB.setHex(palette.rock[0]), rockMix * 0.85);
      color.multiplyScalar(0.96 + rand() * 0.07);
      return color;
    }

    if (cy < 1.2) {
      color.setHex(pick(palette.wetSand, rand));
    } else if (cy < 4.8) {
      color.setHex(pick(palette.sand, rand));
    } else if (cy < 9.5 && patch > -0.15) {
      color.setHex(pick(palette.sand, rand)).lerp(colorB.setHex(pick(palette.lowGrass, rand)), 0.35 + rand() * 0.35);
    } else if (slope > 0.52 && cy > 10) {
      color.setHex(pick(palette.rock, rand));
    } else if (cy > peak * snowLine && peak > minSnowPeak) {
      color.setHex(pick(palette.snow, rand));
    } else if (cy > peak * 0.68) {
      color.setHex(pick(palette.highRock, rand)).lerp(colorB.setHex(pick(palette.rock, rand)), rand() * 0.4);
    } else {
      const t = clamp(cy / (peak * 0.7), 0, 1);
      if (t < 0.34) color.setHex(pick(palette.lowGrass, rand));
      else if (t < 0.7) color.setHex(pick(palette.grass, rand));
      else color.setHex(pick(palette.highGrass, rand));
      if (patch > 0.34) color.lerp(colorB.setHex(pick(palette.grass, rand)), 0.35);
      color.multiplyScalar(0.93 + rand() * 0.14);
    }
    if (cy < 0) color.setHex(pick(palette.underwater, rand));
    color.multiplyScalar(0.94 + rand() * 0.1);
    return color;
  };

  const addTriangle = (a, b, c) => {
    if (!upwardWinding(a, b, c)) {
      const tmp = b;
      b = c;
      c = tmp;
    }
    color.copy(faceColor(a, b, c));
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };

  // Center cap.
  for (let s = 0; s < segments; s++) {
    const next = (s + 1) % segments;
    addTriangle(center, grid[0][s], grid[0][next]);
  }

  // Radial body. Alternate the diagonal for a more organic triangulation.
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      const a = grid[r][s];
      const b = grid[r + 1][s];
      const c = grid[r + 1][s2];
      const d = grid[r][s2];
      if ((r + s) & 1) {
        addTriangle(a, b, d);
        addTriangle(b, c, d);
      } else {
        addTriangle(a, b, c);
        addTriangle(a, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Uniform indexed Cartesian grid for contiguous land maps (mountain, desert, city).
 * Eliminates radial center-pinching, giant outer wedges, and faceted tin-foil
 * artifacts, giving mountain ranges and desert dunes smooth sculpted ridges,
 * clean snowlines, and natural valley transitions across the entire combat zone.
 */
function buildLandGridGeometry(island, gridRes, palette = PALETTE, biome = null) {
  const def = island.def;
  const R = def.radius;
  const elong = def.elongation;
  const peak = def.peak;
  const spanX = R * elong * 1.18;
  const spanZ = R * 1.18;
  const N = Math.max(24, gridRes);
  const vertsPerSide = N + 1;
  const stepX = (spanX * 2) / N;
  const stepZ = (spanZ * 2) / N;

  const positions = new Float32Array(vertsPerSide * vertsPerSide * 3);
  const colors = new Float32Array(vertsPerSide * vertsPerSide * 3);
  const heights = new Float32Array(vertsPerSide * vertsPerSide);

  for (let iz = 0; iz <= N; iz++) {
    const Z = -spanZ + iz * stepZ;
    for (let ix = 0; ix <= N; ix++) {
      const X = -spanX + ix * stepX;
      const idx = iz * vertsPerSide + ix;
      const y = island.heightLocalAt(X, Z);
      heights[idx] = y;
      positions[idx * 3] = X;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = Z;
    }
  }

  const color = new THREE.Color();
  const colorB = new THREE.Color();
  const props = biome?.props;

  for (let iz = 0; iz <= N; iz++) {
    const Z = -spanZ + iz * stepZ;
    const iz0 = Math.max(0, iz - 1);
    const iz1 = Math.min(N, iz + 1);
    const dzSpan = Math.max(1, (iz1 - iz0) * stepZ);
    for (let ix = 0; ix <= N; ix++) {
      const X = -spanX + ix * stepX;
      const ix0 = Math.max(0, ix - 1);
      const ix1 = Math.min(N, ix + 1);
      const dxSpan = Math.max(1, (ix1 - ix0) * stepX);
      const idx = iz * vertsPerSide + ix;
      const cy = heights[idx];
      const dhx = (heights[iz * vertsPerSide + ix1] - heights[iz * vertsPerSide + ix0]) / dxSpan;
      const dhz = (heights[iz1 * vertsPerSide + ix] - heights[iz0 * vertsPerSide + ix]) / dzSpan;
      const ny = 1 / Math.hypot(dhx, 1, dhz);
      const slope = 1 - clamp(ny, 0, 1);

      let basinDone = false;
      if (island.basins?.length) {
        for (let i = 0; i < island.basins.length; i++) {
          const b = island.basins[i];
          const d = Math.hypot(X - b.X, Z - b.Z) / b.r;
          if (d < 1.55) {
            if (b.kind === 'oasis') {
              if (cy <= b.level + 0.8) {
                color.setHex(0x6fa66a);
                basinDone = true;
                break;
              }
              const green = 1 - smoothstep(0.72, 1.55, d);
              color.setHex(palette.sand[0]).lerp(colorB.setHex(0x4a8e43), green * 0.86);
              basinDone = true;
              break;
            }
            if (b.kind === 'lake' && cy <= b.level + 6) {
              color.setHex(palette.sand[0]).lerp(colorB.setHex(palette.lowGrass[0]), smoothstep(b.level, b.level + 6, cy) * 0.5);
              basinDone = true;
              break;
            }
          }
        }
      }

      if (!basinDone) {
        const broad = island.noise.noise(X * 0.00075 - 9.1, Z * 0.00075 + 13.7);
        const mid = island.noise.noise(X * 0.0021 + 4.3, Z * 0.0021 - 7.8);

        if (props === 'mountain') {
          if (cy < 0) {
            color.setHex(palette.underwater[0]);
          } else {
            // Smooth alpine strata: valley meadow -> conifer pine slopes ->
            // granite rock ridges -> bright glacier snowcaps (exposed cliffs stay rocky).
            const elevT = clamp(cy / (peak * 0.62), 0, 1);
            color
              .setHex(palette.lowGrass[0])
              .lerp(colorB.setHex(palette.grass[0]), smoothstep(0.06, 0.45, elevT))
              .lerp(colorB.setHex(palette.highGrass[0]), smoothstep(0.38, 0.78, elevT));
            if (broad > 0) color.lerp(colorB.setHex(palette.grass[2]), broad * 0.24);

            const rockBySlope = smoothstep(0.16, 0.42, slope);
            const rockByAlt = smoothstep(peak * 0.48, peak * 0.68, cy);
            const rockMix = clamp(Math.max(rockBySlope, rockByAlt), 0, 1);
            if (rockMix > 0) {
              color.lerp(
                colorB.setHex(cy > peak * 0.56 ? palette.highRock[0] : palette.rock[0]),
                rockMix * 0.92
              );
            }

            // Crisp natural snowline with slight altitude warp; very steep cliffs shed snow.
            const snowAlt = peak * (0.64 + broad * 0.045);
            const snowRaw = smoothstep(snowAlt, snowAlt + peak * 0.14, cy);
            const snowHold = 1 - smoothstep(0.32, 0.55, slope) * 0.72;
            const snowMix = clamp(snowRaw * snowHold, 0, 1);
            if (snowMix > 0) {
              color.lerp(colorB.setHex(palette.snow[0]), snowMix);
            }
          }
        } else if (props === 'desert') {
          if (cy < 0) {
            color.setHex(palette.underwater[0]);
          } else {
            const altT = clamp(cy / (peak * 0.8), 0, 1);
            color.setHex(palette.wetSand[0]).lerp(colorB.setHex(palette.sand[2]), altT * 0.9);
            if (broad > 0) color.lerp(colorB.setHex(palette.sand[0]), broad * 0.25);
            if (mid < 0) color.lerp(colorB.setHex(palette.grass[1]), -mid * 0.18);
            const rockMix = smoothstep(0.18, 0.44, slope);
            if (rockMix > 0) color.lerp(colorB.setHex(palette.rock[0]), rockMix * 0.85);
          }
        } else {
          // City mainland: clean lawn parks, neutral concrete outskirts, gentle hills.
          if (cy < 0) {
            color.setHex(palette.underwater[0]);
          } else if (cy < 4.5) {
            color.setHex(palette.sand[0]);
          } else {
            const altT = clamp(cy / Math.max(40, peak * 0.6), 0, 1);
            color.setHex(palette.lowGrass[0]).lerp(colorB.setHex(palette.grass[0]), altT * 0.75);
            const rockMix = smoothstep(0.24, 0.5, slope);
            if (rockMix > 0) color.lerp(colorB.setHex(palette.rock[0]), rockMix * 0.8);
          }
        }
      }

      colors[idx * 3] = color.r;
      colors[idx * 3 + 1] = color.g;
      colors[idx * 3 + 2] = color.b;
    }
  }

  const indices = new Uint32Array(N * N * 6);
  let ptr = 0;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const a = iz * vertsPerSide + ix;
      const b = a + 1;
      const c = a + vertsPerSide;
      const d = c + 1;
      if ((ix + iz) & 1) {
        indices[ptr++] = a;
        indices[ptr++] = c;
        indices[ptr++] = b;
        indices[ptr++] = b;
        indices[ptr++] = c;
        indices[ptr++] = d;
      } else {
        indices[ptr++] = a;
        indices[ptr++] = c;
        indices[ptr++] = d;
        indices[ptr++] = a;
        indices[ptr++] = d;
        indices[ptr++] = b;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// --------------------------------------------------------------------------
// Low-poly vegetation & biome props, built once and reused through InstancedMesh.
// --------------------------------------------------------------------------

export function makeBroadleafGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.32, 0.55, 4.2, 5, 1);
  trunk.translate(0, 2.1, 0);
  parts.push(paintGeometry(trunk.toNonIndexed(), new THREE.Color(0x6b4a30)));

  const canopyColors = [0x3f8e3c, 0x4fa044, 0x62af4c];
  const blobs = [
    [0, 5.2, 0, 2.5],
    [1.35, 4.5, 0.35, 1.8],
    [-1.25, 4.65, -0.45, 1.65],
    [0.15, 4.3, 1.3, 1.5],
  ];
  blobs.forEach(([x, y, z, s], i) => {
    const g = flattenGeometry(new THREE.IcosahedronGeometry(s, 0));
    transformGeometry(g, { x, y, z }, { x: i * 0.4, y: i * 1.7, z: i * 0.2 }, { x: 1, y: 0.86, z: 1 });
    parts.push(paintGeometry(g, new THREE.Color(canopyColors[i % canopyColors.length])));
  });
  return mergeGeometries(parts, false);
}

export function makePineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.42, 4.4, 5, 1);
  trunk.translate(0, 2.2, 0);
  parts.push(paintGeometry(trunk.toNonIndexed(), new THREE.Color(0x5f432c)));
  const tiers = [
    [2.6, 4.4, 3.3, 0x2f6e3d],
    [2.0, 5.9, 2.9, 0x347b43],
    [1.35, 7.0, 2.4, 0x3b8849],
  ];
  for (const [radius, y, height, hex] of tiers) {
    const cone = new THREE.ConeGeometry(radius, height, 7, 1).toNonIndexed();
    transformGeometry(cone, { x: 0, y, z: 0 }, { x: 0, y: 0.3, z: 0 }, { x: 1, y: 1, z: 1 });
    parts.push(paintGeometry(cone, new THREE.Color(hex)));
  }
  return mergeGeometries(parts, false);
}

export function makePalmGeometry() {
  const parts = [];
  const trunkSource = new THREE.CylinderGeometry(0.22, 0.38, 6.4, 5, 1);
  const trunk = trunkSource.index ? trunkSource.toNonIndexed() : trunkSource;
  transformGeometry(trunk, { x: 0, y: 3.2, z: 0 }, { x: 0, y: 0.2, z: 0.06 }, { x: 1, y: 1, z: 1 });
  parts.push(paintGeometry(trunk, new THREE.Color(0x8a6843)));

  const crown = flattenGeometry(new THREE.IcosahedronGeometry(0.55, 0));
  transformGeometry(crown, { x: 0, y: 6.5, z: 0.35 }, null, { x: 1, y: 0.8, z: 1 });
  parts.push(paintGeometry(crown, new THREE.Color(0x5d7f35)));

  for (let i = 0; i < 7; i++) {
    const frond = new THREE.ConeGeometry(0.52, 3.9, 3, 1).toNonIndexed();
    const angle = (i / 7) * Math.PI * 2;
    transformGeometry(
      frond,
      {
        x: Math.cos(angle) * 1.55,
        y: 6.35 + Math.sin(i * 2.1) * 0.22,
        z: 0.35 + Math.sin(angle) * 1.55,
      },
      { x: Math.PI * 0.44, y: angle, z: 0.2 },
      { x: 1, y: 1, z: 0.45 }
    );
    parts.push(paintGeometry(frond, new THREE.Color(i % 2 ? 0x3e8f42 : 0x52a54a)));
  }
  return mergeGeometries(parts, false);
}

function makeRockGeometry() {
  const parts = [];
  const add = (x, y, z, sx, sy, sz, hex) => {
    const g = flattenGeometry(new THREE.DodecahedronGeometry(1.3, 0));
    transformGeometry(g, { x, y, z }, { x: y, y: x, z: y * 0.6 }, { x: sx, y: sy, z: sz });
    parts.push(paintGeometry(g, new THREE.Color(hex)));
  };
  add(0, 0.75, 0, 1.5, 0.8, 1.1, 0x7d7a6d);
  add(1.2, 0.35, 0.4, 0.8, 0.6, 0.7, 0x918c7e);
  add(-1.0, 0.25, -0.3, 0.6, 0.45, 0.6, 0x6b6a60);
  return mergeGeometries(parts, false);
}

function propBox(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  return paintGeometry(g, new THREE.Color(hex));
}

// --- Coral archipelago props -----------------------------------------------

/** Red-and-white coastal lighthouse with a lantern crown and keeper cottage. */
function makeLighthouseGeometry() {
  const parts = [propBox(10, 2.5, 10, 0, 0, 0, 0x7d7a72)];
  const bands = [
    [3.6, 4.0, 5.2, 0xf7f5ee],
    [3.2, 3.6, 5.2, 0xc93a2b],
    [2.8, 3.2, 5.2, 0xf7f5ee],
    [2.4, 2.8, 5.2, 0xc93a2b],
    [2.1, 2.4, 4.4, 0xf7f5ee],
  ];
  let y = 2.5;
  for (const [rTop, rBot, h, hex] of bands) {
    const seg = new THREE.CylinderGeometry(rTop, rBot, h, 8, 1).toNonIndexed();
    seg.translate(0, y + h / 2, 0);
    parts.push(paintGeometry(seg, new THREE.Color(hex)));
    y += h;
  }
  const gallery = new THREE.CylinderGeometry(2.8, 2.5, 1.1, 8, 1).toNonIndexed();
  gallery.translate(0, y + 0.55, 0);
  parts.push(paintGeometry(gallery, new THREE.Color(0x2d3238)));
  y += 1.1;
  const lantern = new THREE.CylinderGeometry(1.85, 1.85, 2.8, 8, 1).toNonIndexed();
  lantern.translate(0, y + 1.4, 0);
  parts.push(paintGeometry(lantern, new THREE.Color(0xfff1a8)));
  y += 2.8;
  const dome = new THREE.ConeGeometry(2.3, 2.4, 8, 1).toNonIndexed();
  dome.translate(0, y + 1.2, 0);
  parts.push(paintGeometry(dome, new THREE.Color(0xb83022)));
  // Keeper cottage beside the tower.
  parts.push(propBox(6.8, 3.6, 5.2, 6.2, 1.2, 0, 0xf2ede2));
  parts.push(propBox(7.4, 1.5, 5.8, 6.2, 4.8, 0, 0xb8432f));
  return mergeGeometries(parts, false);
}

/** Tropical stilt bungalow with a thatched pyramid roof and wooden pier deck. */
function makeHutGeometry() {
  const parts = [
    propBox(6.2, 0.5, 6.2, 0, 1.2, 0, 0x8b623f),
    propBox(4.8, 2.8, 4.8, 0, 1.7, 0, 0xdec89f),
  ];
  for (const [x, z] of [
    [-2.6, -2.6],
    [2.6, -2.6],
    [-2.6, 2.6],
    [2.6, 2.6],
  ]) {
    parts.push(propBox(0.4, 1.4, 0.4, x, 0, z, 0x5c3f26));
  }
  const roof = new THREE.ConeGeometry(4.6, 2.7, 4, 1).toNonIndexed();
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 4.5 + 1.35, 0);
  parts.push(paintGeometry(roof, new THREE.Color(0xa6783d)));
  return mergeGeometries(parts, false);
}

/** Outrigger sailboat anchored in the turquoise lagoons. */
function makeBoatGeometry() {
  const parts = [
    propBox(2.4, 1.1, 8.2, 0, 0, 0, 0xf4f1e8),
    propBox(2.5, 0.35, 8.4, 0, 0.85, 0, 0x246b9e),
    propBox(0.22, 8.6, 0.22, 0, 1.1, -0.4, 0xd8cfc0),
  ];
  const sail = new THREE.ConeGeometry(2.3, 6.8, 3, 1).toNonIndexed();
  transformGeometry(sail, { x: 0, y: 5.1, z: -0.9 }, { x: 0.08, y: Math.PI / 2, z: 0 }, { x: 0.25, y: 1, z: 1 });
  parts.push(paintGeometry(sail, new THREE.Color(0xfff8ea)));
  return mergeGeometries(parts, false);
}

// --- Desert map props ------------------------------------------------------

/** Saguaro-style cactus with two raised arms. */
function makeCactusGeometry() {
  const parts = [];
  const green = new THREE.Color(0x4e7f45);
  const dark = new THREE.Color(0x436e3b);
  const trunk = new THREE.CylinderGeometry(0.5, 0.62, 6.8, 6, 1).toNonIndexed();
  trunk.translate(0, 3.4, 0);
  parts.push(paintGeometry(trunk, green));

  for (const side of [-1, 1]) {
    const elbow = new THREE.CylinderGeometry(0.3, 0.34, 1.8, 6, 1).toNonIndexed();
    elbow.rotateZ(Math.PI / 2);
    elbow.translate(side * 0.7, 3.7, 0);
    parts.push(paintGeometry(elbow, dark));
    const arm = new THREE.CylinderGeometry(0.28, 0.32, 2.7, 6, 1).toNonIndexed();
    arm.translate(side * 1.5, 5, 0);
    parts.push(paintGeometry(arm, green));
  }

  const cap = flattenGeometry(new THREE.IcosahedronGeometry(0.5, 0));
  cap.translate(0, 6.8, 0);
  parts.push(paintGeometry(cap, green));
  return mergeGeometries(parts, false);
}

/** Dry scrub tuft: a few bleached spikes over a sandy base. */
function makeShrubGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const spike = new THREE.ConeGeometry(0.26, 1.7, 4, 1).toNonIndexed();
    transformGeometry(
      spike,
      { x: Math.cos(angle) * 0.32, y: 0.8, z: Math.sin(angle) * 0.32 },
      { x: Math.cos(angle) * 0.4, y: 0, z: -Math.sin(angle) * 0.4 },
      { x: 1, y: 0.8 + (i % 3) * 0.3, z: 1 }
    );
    parts.push(paintGeometry(spike, new THREE.Color(i % 2 ? 0xb99a5b : 0xa98c52)));
  }
  return mergeGeometries(parts, false);
}

/** Stepped sandstone pyramid monument rising out of the dune sea. */
function makePyramidGeometry() {
  const parts = [];
  const tiers = [
    [130, 22, 0xd8b477],
    [102, 20, 0xcfa96c],
    [76, 18, 0xd8b477],
    [52, 16, 0xc7a063],
    [30, 14, 0xdfc089],
  ];
  let y = 0;
  for (const [w, h, hex] of tiers) {
    parts.push(propBox(w, h, w, 0, y, 0, hex));
    y += h;
  }
  const cap = new THREE.ConeGeometry(16, 16, 4, 1).toNonIndexed();
  cap.rotateY(Math.PI / 4);
  cap.translate(0, y + 8, 0);
  parts.push(paintGeometry(cap, new THREE.Color(0xf2d388)));
  return mergeGeometries(parts, false);
}

/** Flat-topped red sandstone butte / mesa for Monument-Valley style vistas. */
function makeMesaGeometry() {
  const parts = [];
  const base = new THREE.CylinderGeometry(28, 42, 26, 7, 1).toNonIndexed();
  base.translate(0, 13, 0);
  parts.push(paintGeometry(base, new THREE.Color(0xb8764c)));
  const mid = new THREE.CylinderGeometry(21, 27, 22, 7, 1).toNonIndexed();
  mid.translate(1.5, 26 + 11, -1);
  parts.push(paintGeometry(mid, new THREE.Color(0xc78458)));
  const cap = new THREE.CylinderGeometry(18, 20, 8, 7, 1).toNonIndexed();
  cap.translate(1.5, 48 + 4, -1);
  parts.push(paintGeometry(cap, new THREE.Color(0xa86842)));
  return mergeGeometries(parts, false);
}

// --- Mountain map props ----------------------------------------------------

/** Snow-dusted alpine pine for the high timberline. */
function makeSnowPineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.42, 4.4, 5, 1);
  trunk.translate(0, 2.2, 0);
  parts.push(paintGeometry(trunk.toNonIndexed(), new THREE.Color(0x5a402a)));
  const tiers = [
    [2.6, 4.4, 3.3, 0x2d643b],
    [2.0, 5.9, 2.9, 0x4b7f58],
    [1.35, 7.0, 2.4, 0xe8f3f7],
  ];
  for (const [radius, y, height, hex] of tiers) {
    const cone = new THREE.ConeGeometry(radius, height, 7, 1).toNonIndexed();
    transformGeometry(cone, { x: 0, y, z: 0 }, { x: 0, y: 0.3, z: 0 }, { x: 1, y: 1, z: 1 });
    parts.push(paintGeometry(cone, new THREE.Color(hex)));
  }
  return mergeGeometries(parts, false);
}

export class IslandField {
  constructor(quality, biome = BIOMES.coral) {
    this.quality = quality;
    this.biome = biome;
    this.group = new THREE.Group();
    this.group.name = 'islands';
    this.islands = createArchipelago(quality, biome);
    this.lodObjects = [];
    this.props = new THREE.Group();
    this.props.name = 'island-props';
    this.group.add(this.props);
    this.city = null;
    this.loaded = false;
    this.palette = { ...PALETTE, ...(biome.palette ?? {}) };

    this.terrainMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: !biome.land,
    });
    this.propMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });

    this.treeBuckets = {
      broadleaf: [],
      pine: [],
      snowpine: [],
      palm: [],
      cactus: [],
      shrub: [],
      lighthouse: [],
      hut: [],
      boat: [],
      pyramid: [],
      mesa: [],
    };
    this.rockTransforms = [];
    this.stats = { trees: 0, structures: 0, rocks: 0, triangles: 0 };
    this._tmp = new THREE.Object3D();
  }

  async build(onProgress = () => {}) {
    const total = this.islands.length;
    const land = !!this.biome.land;
    const rings = land
      ? Math.round((this.quality.islandRings ?? 26) * 2.6)
      : this.quality.islandRings ?? 26;
    const segments = land
      ? Math.round((this.quality.islandSegments ?? 64) * 2.4)
      : this.quality.islandSegments ?? 64;

    for (let i = 0; i < total; i++) {
      const island = this.islands[i];
      this._buildIslandObject(island, rings, segments);
      this._scatterProps(island);
      this._placeLandmarks(island);
      onProgress((i + 1) / (total + 1), `SURVEYING ${island.def.name}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (this.biome.props === 'city') {
      this.city = new CityGrid(this.quality, this.biome).build();
      this.group.add(this.city.group);
      this.stats.structures += this.city.stats.structures;
      this.stats.trees += this.city.stats.trees;
    }

    this._buildBasinWater();
    this._buildCoralVolcanoes();
    this._createInstancedProps();
    onProgress(1, 'VEGETATION SYNCHRONISED');
    this.loaded = true;
  }

  _buildIslandObject(island, rings, segments) {
    const group = new THREE.Group();
    group.name = `island-${island.def.id}`;
    group.position.set(island.def.x, 0, island.def.z);
    group.rotation.y = island.def.rotation;

    const land = !!this.biome.land;
    let highGeo;
    let lowGeo;
    if (land) {
      const highRes = clamp(Math.round((this.quality.islandRings ?? 26) * 3.8), 76, 128);
      const lowRes = Math.max(48, Math.round(highRes * 0.6));
      highGeo = buildLandGridGeometry(island, highRes, this.palette, this.biome);
      lowGeo = buildLandGridGeometry(island, lowRes, this.palette, this.biome);
    } else {
      highGeo = buildIslandGeometry(island, rings, segments, this.palette, this.biome);
      lowGeo = buildIslandGeometry(
        island,
        this.quality.islandLowRings ?? 10,
        this.quality.islandLowSegments ?? 24,
        this.palette,
        this.biome
      );
    }

    const high = new THREE.Mesh(highGeo, this.terrainMaterial);
    high.castShadow = this.quality.shadows && island.def.major;
    high.receiveShadow = this.quality.shadows;
    high.name = `${island.def.id}-high`;

    const low = new THREE.Mesh(lowGeo, this.terrainMaterial);
    low.castShadow = false;
    low.receiveShadow = this.quality.shadows;
    low.name = `${island.def.id}-low`;

    const lod = new THREE.LOD();
    lod.addLevel(high, 0);
    // Land maps span 30+ km centered at origin — keep high-res terrain active
    // everywhere inside the playable combat zone instead of popping at 3.2 km.
    lod.addLevel(low, land ? 42000 : this.quality.islandLodDistance ?? 3200);
    group.add(lod);
    this.lodObjects.push(lod);
    this.group.add(group);

    island.object = group;
    island.lod = lod;
    island.highMesh = high;
    island.lowMesh = low;

    const triCount = (geo) => (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
    this.stats.triangles += triCount(highGeo) + triCount(lowGeo);
  }

  /** Water discs for desert oases and alpine mountain lakes. */
  _buildBasinWater() {
    const parts = [];
    let isOasis = false;
    for (const island of this.islands) {
      if (!island.basins?.length) continue;
      for (const b of island.basins) {
        if (b.kind === 'oasis') isOasis = true;
        const disc = new THREE.CircleGeometry(b.r * 0.88, 24);
        disc.rotateX(-Math.PI / 2);
        disc.translate(b.x, b.level, b.z);
        parts.push(disc);
      }
    }
    if (!parts.length) return;
    const mat = new THREE.MeshPhongMaterial({
      color: isOasis ? 0x28a89e : 0x2b6d8c,
      specular: 0xbfe8f5,
      shininess: 80,
      emissive: isOasis ? 0x0b3b38 : 0x0a2433,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
    mesh.name = isOasis ? 'desert-oases' : 'mountain-lakes';
    mesh.receiveShadow = !!this.quality.shadows;
    this.group.add(mesh);
  }

  /**
   * Active volcanic calderas on the CORAL archipelago (Twinspire, Highpeak,
   * Titan Ridge and Ember Cay) with basalt craters, glowing lava pools and
   * rising animated volcanic ash/smoke columns.
   */
  _buildCoralVolcanoes() {
    this.volcanoPlumes = [];
    this.volcanoSmokeMesh = null;
    this._volcanoAcc = 0;
    if (this.biome.props !== 'coral') return;

    const volcanoTargets = [
      { id: 'twin', craterR: 46, coneH: 62, plumeH: 520, puffs: 14 },
      { id: 'highpeak', craterR: 54, coneH: 74, plumeH: 600, puffs: 16 },
      { id: 'titan', craterR: 62, coneH: 84, plumeH: 660, puffs: 18 },
      { id: 'ember', craterR: 32, coneH: 42, plumeH: 380, puffs: 10 },
    ];

    const coneParts = [];
    const lavaParts = [];
    const rand = mulberry32(994411);

    for (const cfg of volcanoTargets) {
      const island = this.islands.find((isl) => isl.def.id === cfg.id);
      if (!island) continue;

      // Locate the true highest summit point of the island.
      let vx = island.def.x;
      let vz = island.def.z;
      let vy = island.heightAt(vx, vz);
      for (let r = 12; r <= 120; r += 18) {
        for (let s = 0; s < 16; s++) {
          const a = (s / 16) * Math.PI * 2;
          const sx = island.def.x + Math.cos(a) * r;
          const sz = island.def.z + Math.sin(a) * r;
          const sh = island.heightAt(sx, sz);
          if (sh > vy) {
            vy = sh;
            vx = sx;
            vz = sz;
          }
        }
      }

      const { craterR, coneH, plumeH, puffs } = cfg;
      const baseY = vy - coneH * 0.58;
      const rimY = baseY + coneH;

      // Outer charred basalt volcanic cone.
      const outerCone = new THREE.CylinderGeometry(craterR, craterR * 2.05, coneH, 14, 2).toNonIndexed();
      const pos = outerCone.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);
        const ang = Math.atan2(pz, px);
        const rib = 1 + 0.08 * Math.sin(ang * 5 + cfg.craterR) + 0.05 * Math.cos(ang * 3);
        pos.setXYZ(i, px * rib, py, pz * rib);
      }
      outerCone.translate(vx, baseY + coneH * 0.5, vz);
      outerCone.computeVertexNormals();
      coneParts.push(paintGeometry(outerCone, new THREE.Color(0x2d2624)));

      // Ash-crusted upper caldera rim crown.
      const rimCrown = new THREE.CylinderGeometry(craterR * 0.86, craterR * 1.16, coneH * 0.24, 14, 1).toNonIndexed();
      rimCrown.translate(vx, rimY - coneH * 0.08, vz);
      coneParts.push(paintGeometry(rimCrown, new THREE.Color(0x3f3532)));

      // Glowing molten lava lake inside the caldera + magma spill channels.
      const lavaPool = new THREE.CylinderGeometry(craterR * 0.78, craterR * 0.72, 3.5, 14, 1).toNonIndexed();
      lavaPool.translate(vx, rimY - 1.2, vz);
      lavaParts.push(paintGeometry(lavaPool, new THREE.Color(0xff4d0a)));

      const lavaCore = new THREE.CylinderGeometry(craterR * 0.42, craterR * 0.42, 4.1, 12, 1).toNonIndexed();
      lavaCore.translate(vx, rimY - 0.8, vz);
      lavaParts.push(paintGeometry(lavaCore, new THREE.Color(0xffbe3b)));

      // 3 glowing lava streams flowing down the upper volcanic cone flank.
      for (let k = 0; k < 3; k++) {
        const flowAngle = (k / 3) * Math.PI * 2 + rand() * 0.7;
        const flow = new THREE.BoxGeometry(craterR * 0.16, coneH * 0.52, craterR * 0.55).toNonIndexed();
        transformGeometry(
          flow,
          {
            x: vx + Math.cos(flowAngle) * craterR * 1.05,
            y: rimY - coneH * 0.24,
            z: vz + Math.sin(flowAngle) * craterR * 1.05,
          },
          { x: 0, y: -flowAngle + Math.PI / 2, z: -0.58 },
          { x: 1, y: 1, z: 1 }
        );
        lavaParts.push(paintGeometry(flow, new THREE.Color(0xff5e14)));
      }

      // Register rising smoke puffs for this volcano's plume.
      for (let p = 0; p < puffs; p++) {
        this.volcanoPlumes.push({
          vx,
          vy: rimY + 6,
          vz,
          craterR,
          plumeH,
          phase: p / puffs,
          speed: (0.042 + rand() * 0.014) * (500 / plumeH),
          swirlFreq: 0.7 + rand() * 0.9,
          swirlAmp: craterR * (0.28 + rand() * 0.45),
          seedAngle: rand() * Math.PI * 2,
          rot: rand() * Math.PI * 2,
          tilt: (rand() - 0.5) * 0.35,
          aspectY: 0.72 + rand() * 0.32,
        });
      }
    }

    if (coneParts.length) {
      const volcanoGroup = new THREE.Group();
      volcanoGroup.name = 'coral-volcanoes';

      const coneMesh = new THREE.Mesh(mergeGeometries(coneParts, false), this.terrainMaterial);
      coneMesh.name = 'volcano-cones';
      coneMesh.castShadow = !!this.quality.shadows;
      coneMesh.receiveShadow = !!this.quality.shadows;
      volcanoGroup.add(coneMesh);

      const lavaMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
      });
      const lavaMesh = new THREE.Mesh(mergeGeometries(lavaParts, false), lavaMat);
      lavaMesh.name = 'volcano-lava';
      volcanoGroup.add(lavaMesh);

      this.group.add(volcanoGroup);
    }

    if (this.volcanoPlumes.length) {
      const puffGeo = new THREE.IcosahedronGeometry(1, 2);
      const pos = puffGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const b = 1 + 0.14 * Math.sin(x * 3.1 + z * 2.7) * Math.cos(y * 2.5);
        pos.setXYZ(i, x * b, y * (y < 0 ? 0.68 : 1.08), z * b);
      }
      puffGeo.computeVertexNormals();

      const smokeMat = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.54,
        depthWrite: false,
        emissive: 0x3b2c28,
        emissiveIntensity: 0.22,
        fog: true,
      });

      const smokeMesh = new THREE.InstancedMesh(puffGeo, smokeMat, this.volcanoPlumes.length);
      smokeMesh.name = 'volcano-smoke';
      smokeMesh.castShadow = false;
      smokeMesh.receiveShadow = false;
      smokeMesh.frustumCulled = false;
      smokeMesh.renderOrder = 2;
      smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.volcanoSmokeMesh = smokeMesh;
      this.group.add(smokeMesh);
      this._updateVolcanoSmoke(0, true);
    }
  }

  _updateVolcanoSmoke(dt, initial = false) {
    if (!this.volcanoSmokeMesh || !this.volcanoPlumes?.length) return;
    if (!initial) {
      this._volcanoAcc += dt;
      if (this._volcanoAcc < 1 / 24) return;
      dt = this._volcanoAcc;
      this._volcanoAcc = 0;
    }

    const dummy = this._tmp;
    const color = new THREE.Color();
    for (let i = 0; i < this.volcanoPlumes.length; i++) {
      const p = this.volcanoPlumes[i];
      p.phase = (p.phase + p.speed * dt) % 1;
      const t = p.phase;
      // Billowing plume rises from crater mouth and drifts downwind.
      const height = t * p.plumeH;
      const windDriftX = Math.pow(t, 1.35) * p.plumeH * 0.42;
      const windDriftZ = Math.pow(t, 1.35) * p.plumeH * 0.18;
      const swirl = p.swirlAmp * (0.25 + t * 1.45);
      const ang = p.seedAngle + t * Math.PI * 2 * p.swirlFreq;

      const x = p.vx + windDriftX + Math.cos(ang) * swirl;
      const y = p.vy + height;
      const z = p.vz + windDriftZ + Math.sin(ang) * swirl;

      // Puff expands as it climbs, then thins near the top of the column.
      const envelope = t < 0.12 ? t / 0.12 : t > 0.85 ? Math.max(0.15, (1 - t) / 0.15) : 1;
      const radius = p.craterR * (0.42 + t * 1.95) * (0.55 + 0.45 * envelope);

      dummy.position.set(x, y, z);
      dummy.rotation.set(p.tilt, p.rot + t * 1.4, -p.tilt * 0.7);
      dummy.scale.set(radius, radius * p.aspectY, radius);
      dummy.updateMatrix();
      this.volcanoSmokeMesh.setMatrixAt(i, dummy.matrix);

      // Hot fiery orange-ash glow near the crater mouth -> dark volcanic ash -> pale steam-ash high up.
      if (t < 0.16) {
        const glow = 1 - t / 0.16;
        color.setRGB(0.36 + glow * 0.62, 0.32 + glow * 0.22, 0.32 - glow * 0.16);
      } else {
        const ash = 0.34 + t * 0.36;
        color.setRGB(ash, ash * 0.97, ash * 0.99);
      }
      this.volcanoSmokeMesh.setColorAt(i, color);
    }

    this.volcanoSmokeMesh.instanceMatrix.needsUpdate = true;
    if (this.volcanoSmokeMesh.instanceColor) {
      this.volcanoSmokeMesh.instanceColor.needsUpdate = true;
    }
    if (initial) {
      this.volcanoSmokeMesh.computeBoundingSphere();
    }
  }

  _inBasinPool(island, x, z, pad = 1.0) {
    if (!island.basins?.length) return false;
    for (const b of island.basins) {
      if (Math.hypot(x - b.x, z - b.z) < b.r * pad) return true;
    }
    return false;
  }

  _scatterProps(island) {
    const random = mulberry32(island.def.seed + 31337);
    const def = island.def;
    const biome = this.biome;
    const land = !!biome.land;
    // The city grid owns the whole urban core; only scatter outer hill trees
    // beyond the street deck on the KOTA map.
    const isCity = biome.props === 'city';
    const density = (this.quality.treeDensity ?? 1) * (biome.treeScale ?? 1);
    const baseCount = def.major
      ? Math.round((def.radius * (land ? (isCity ? 0.14 : 0.62) : 0.78) + 100) * density)
      : Math.round((def.radius * 0.42 + 18) * density);
    const cap = Math.round(
      (this.quality.maxTreesPerIsland ?? 680) * (land ? (isCity ? 0.65 : biome.propBoost ?? 1.8) : 1)
    );
    const target = Math.min(baseCount, cap);
    const treeLine =
      biome.props === 'desert'
        ? Infinity
        : biome.props === 'mountain'
          ? Math.max(640, def.peak * 0.62)
          : Math.min(def.peak * 0.74, 270);
    const coast = island.coastRatio;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = target * 18;

    while (placed < target && attempts < maxAttempts) {
      attempts++;
      const angle = random() * Math.PI * 2;
      const rr = isCity
        ? (0.64 + random() * 0.34) * coast
        : Math.sqrt(random()) * coast * 0.985;
      const X = Math.cos(angle) * def.radius * def.elongation * rr;
      const Z = Math.sin(angle) * def.radius * rr;
      const [x, z] = island.toWorldXZ(X, Z);
      if (isCity && Math.abs(x) < 6900 && Math.abs(z) < 8600) continue;
      if (this._inBasinPool(island, x, z, 0.92)) continue;
      const h = island.heightAt(x, z);
      if (h < 3.8 || h > treeLine) continue;
      const slope = island.slopeAt(x, z, 3);
      if (slope > (biome.maxSlope ?? 0.62)) continue;

      const type = this._pickPropType(def, h, rr, coast, random);
      if (!type) continue;

      const scaleBase = this._propScale(type, random);
      let sx = scaleBase;
      let sy = scaleBase * (0.9 + random() * 0.25);
      let sz = scaleBase;
      if (type === 'cactus') {
        sy = scaleBase * (1.1 + random() * 0.8);
      } else if (type === 'shrub') {
        sy = scaleBase * (0.8 + random() * 0.7);
      }
      const tint = 0.92 + random() * 0.16;
      const rotation = random() * Math.PI * 2;
      this.treeBuckets[type].push({
        x,
        y: h - 0.35,
        z,
        rotation,
        sx,
        sy,
        sz,
        tint: new THREE.Color(tint, tint * (1 + (random() - 0.5) * 0.04), tint * (0.96 + random() * 0.05)),
        islandId: def.id,
      });
      placed++;
    }

    // Rocks: rugged boulders around the beach and mountainside.
    const rockDensity = (this.quality.treeDensity ?? 1) * (biome.rockScale ?? 1);
    const rockCount = Math.round(
      (def.major ? (land ? (isCity ? 18 : 90) : 16) : 3) * rockDensity
    );
    for (let i = 0; i < rockCount; i++) {
      const angle = random() * Math.PI * 2;
      const rr = (0.55 + random() * 0.45) * coast;
      const X = Math.cos(angle) * def.radius * def.elongation * rr;
      const Z = Math.sin(angle) * def.radius * rr;
      const [x, z] = island.toWorldXZ(X, Z);
      if (isCity && Math.abs(x) < 6900 && Math.abs(z) < 8600) continue;
      if (this._inBasinPool(island, x, z, 0.95)) continue;
      const h = island.heightAt(x, z);
      if (h < 0.6) continue;
      const s = 0.6 + random() * (land ? 3.2 : 1.9);
      this.rockTransforms.push({
        x,
        y: h - 0.2,
        z,
        rotation: random() * Math.PI * 2,
        sx: s * (0.7 + random() * 0.5),
        sy: s * (0.5 + random() * 0.5),
        sz: s * (0.7 + random() * 0.4),
        tint: 0.82 + random() * 0.3,
      });
    }
  }

  /**
   * Biome landmarks & character props:
   *  - coral: coastal lighthouses on major headlands, beach huts & lagoon sailboats
   *  - desert: lush palm rings around every oasis, stepped pyramids & sandstone mesas
   *  - mountain: alpine timber villages by the lakes
   */
  _placeLandmarks(island) {
    const def = island.def;
    const random = mulberry32(def.seed + 9001);
    const props = this.biome.props;

    if (props === 'coral') {
      if (!def.major || !island.coastSamples?.length) return;
      // Pick a prominent headland sample for a lighthouse on the first 5 major islands.
      const sample = island.coastSamples[Math.floor(random() * island.coastSamples.length)];
      const [lx, lz] = island.toWorldXZ(
        Math.cos(sample.angle) * def.radius * def.elongation * sample.ratio * 0.86,
        Math.sin(sample.angle) * def.radius * sample.ratio * 0.86
      );
      const lh = island.heightAt(lx, lz);
      if (lh > 2.5 && lh < 28 && this.treeBuckets.lighthouse.length < 5) {
        this.treeBuckets.lighthouse.push({
          x: lx,
          y: lh - 0.3,
          z: lz,
          rotation: sample.angle,
          sx: 1,
          sy: 1,
          sz: 1,
          tint: new THREE.Color(1, 1, 1),
          islandId: def.id,
        });
      }
      // Beach huts along a sheltered bay.
      const bayAngle = sample.angle + Math.PI * 0.65;
      for (let i = 0; i < 4; i++) {
        const a = bayAngle + (i - 1.5) * 0.14;
        const [hx, hz] = island.toWorldXZ(
          Math.cos(a) * def.radius * def.elongation * island.coastRatio * 0.9,
          Math.sin(a) * def.radius * island.coastRatio * 0.9
        );
        const hh = island.heightAt(hx, hz);
        if (hh > 1.5 && hh < 12) {
          this.treeBuckets.hut.push({
            x: hx,
            y: hh - 0.25,
            z: hz,
            rotation: a + Math.PI / 2,
            sx: 1,
            sy: 1,
            sz: 1,
            tint: new THREE.Color(0.95 + random() * 0.1, 0.95 + random() * 0.08, 0.92),
            islandId: def.id,
          });
        }
      }
      // Sailboats anchored in the shallow turquoise lagoon outside the shore.
      for (let i = 0; i < 2; i++) {
        const a = bayAngle + (random() - 0.5) * 0.7;
        const [bx, bz] = island.toWorldXZ(
          Math.cos(a) * def.radius * def.elongation * (island.coastRatio + 0.18 + random() * 0.14),
          Math.sin(a) * def.radius * (island.coastRatio + 0.18 + random() * 0.14)
        );
        this.treeBuckets.boat.push({
          x: bx,
          y: 0.15,
          z: bz,
          rotation: random() * Math.PI * 2,
          sx: 1.15,
          sy: 1.15,
          sz: 1.15,
          tint: new THREE.Color(1, 1, 1),
          islandId: def.id,
        });
      }
      return;
    }

    if (props === 'desert') {
      // Palm groves & huts ringing each desert oasis.
      for (const b of island.basins ?? []) {
        const palmCount = 26;
        for (let i = 0; i < palmCount; i++) {
          const a = (i / palmCount) * Math.PI * 2 + random() * 0.18;
          const rad = b.r * (0.94 + random() * 0.35);
          const px = b.x + Math.cos(a) * rad;
          const pz = b.z + Math.sin(a) * rad;
          const ph = island.heightAt(px, pz);
          const s = 1.05 + random() * 0.55;
          this.treeBuckets.palm.push({
            x: px,
            y: ph - 0.3,
            z: pz,
            rotation: random() * Math.PI * 2,
            sx: s,
            sy: s * (0.95 + random() * 0.25),
            sz: s,
            tint: new THREE.Color(0.95, 1, 0.92),
            islandId: def.id,
          });
        }
      }
      // Ancient stepped pyramids.
      const pyramids = [
        [-1950, -1450, 1.15],
        [-2320, -1780, 0.85],
        [2750, -2450, 1.05],
      ];
      for (const [px, pz, s] of pyramids) {
        const ph = island.heightAt(px, pz);
        this.treeBuckets.pyramid.push({
          x: px,
          y: ph - 1.5,
          z: pz,
          rotation: Math.PI / 6,
          sx: s,
          sy: s,
          sz: s,
          tint: new THREE.Color(1, 0.98, 0.94),
          islandId: def.id,
        });
      }
      // Red sandstone mesas across the dune horizon.
      const mesas = [
        [2900, 1100, 1.8, 1.4],
        [-3400, 850, 2.2, 1.6],
        [1100, 3900, 1.6, 1.3],
        [-900, -3200, 2.0, 1.5],
        [4400, -900, 2.4, 1.7],
        [-4500, -2400, 1.9, 1.5],
      ];
      for (const [mx, mz, sx, sy] of mesas) {
        const mh = island.heightAt(mx, mz);
        this.treeBuckets.mesa.push({
          x: mx,
          y: mh - 1.2,
          z: mz,
          rotation: random() * Math.PI * 2,
          sx,
          sy,
          sz: sx * (0.85 + random() * 0.3),
          tint: new THREE.Color(0.96 + random() * 0.08, 0.94, 0.92),
          islandId: def.id,
        });
      }
      return;
    }

    if (props === 'mountain') {
      // Dense pine rings around the alpine lakes.
      for (const b of island.basins ?? []) {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2 + random() * 0.2;
          const rad = b.r * (1.02 + random() * 0.35);
          const px = b.x + Math.cos(a) * rad;
          const pz = b.z + Math.sin(a) * rad;
          const ph = island.heightAt(px, pz);
          const s = 1.1 + random() * 0.6;
          this.treeBuckets.pine.push({
            x: px,
            y: ph - 0.3,
            z: pz,
            rotation: random() * Math.PI * 2,
            sx: s,
            sy: s,
            sz: s,
            tint: new THREE.Color(0.92, 0.98, 0.94),
            islandId: def.id,
          });
        }
      }
    }
  }

  /** What grows (or stands) at a spot, per map. */
  _pickPropType(def, h, rr, coast, random) {
    const biome = this.biome;
    switch (biome.props) {
      case 'city': {
        return random() < 0.72 ? 'broadleaf' : 'pine';
      }
      case 'desert': {
        if (h > def.peak * 0.62) return random() < 0.4 ? 'shrub' : null;
        const roll = random();
        if (roll < 0.55) return 'cactus';
        if (roll < 0.85) return 'shrub';
        return null;
      }
      case 'mountain': {
        if (h > def.peak * 0.46) return random() < 0.82 ? 'snowpine' : null;
        if (h > def.peak * 0.34) return random() < 0.55 ? 'snowpine' : 'pine';
        return random() < 0.78 ? 'pine' : 'broadleaf';
      }
      default: {
        // Coral archipelago: palms on the beach, pines uphill, broadleaf between.
        if (h < 15 && rr > coast * 0.68) return 'palm';
        if (h > def.peak * 0.3 && random() > 0.42) return 'pine';
        return 'broadleaf';
      }
    }
  }

  /** Base size for a prop type. */
  _propScale(type, random) {
    switch (type) {
      case 'palm':
        return 0.72 + random() * 0.5;
      case 'pine':
      case 'snowpine':
        return 0.85 + random() * 0.7;
      case 'cactus':
        return 0.8 + random() * 0.7;
      case 'shrub':
        return 0.7 + random() * 0.6;
      default:
        return 0.78 + random() * 0.75;
    }
  }

  _createInstancedProps() {
    const defs = [
      ['broadleaf', makeBroadleafGeometry()],
      ['pine', makePineGeometry()],
      ['snowpine', makeSnowPineGeometry()],
      ['palm', makePalmGeometry()],
      ['cactus', makeCactusGeometry()],
      ['shrub', makeShrubGeometry()],
      ['lighthouse', makeLighthouseGeometry()],
      ['hut', makeHutGeometry()],
      ['boat', makeBoatGeometry()],
      ['pyramid', makePyramidGeometry()],
      ['mesa', makeMesaGeometry()],
    ];
    const structureTypes = new Set(['lighthouse', 'hut', 'boat']);

    for (const [type, geometry] of defs) {
      const list = this.treeBuckets[type];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geometry, this.propMaterial, list.length);
      mesh.name = `trees-${type}`;
      mesh.castShadow = this.quality.shadows && this.quality.treeShadows;
      mesh.receiveShadow = this.quality.shadows;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(0, t.rotation, 0);
        dummy.scale.set(t.sx, t.sy, t.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, t.tint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.props.add(mesh);
      if (structureTypes.has(type)) {
        this.stats.structures += list.length;
      } else if (type === 'mesa' || type === 'pyramid') {
        this.stats.rocks += list.length;
      } else {
        this.stats.trees += list.length;
      }
    }

    if (this.rockTransforms.length) {
      const geometry = makeRockGeometry();
      const mesh = new THREE.InstancedMesh(geometry, this.propMaterial, this.rockTransforms.length);
      mesh.name = 'rocks';
      mesh.castShadow = this.quality.shadows && this.quality.treeShadows;
      mesh.receiveShadow = this.quality.shadows;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < this.rockTransforms.length; i++) {
        const r = this.rockTransforms[i];
        dummy.position.set(r.x, r.y, r.z);
        dummy.rotation.set(0, r.rotation, 0);
        dummy.scale.set(r.sx, r.sy, r.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, new THREE.Color(r.tint, r.tint, r.tint));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.props.add(mesh);
      this.stats.rocks += this.rockTransforms.length;
    }
  }

  update(camera, dt = 0, focus = null) {
    for (const lod of this.lodObjects) lod.update(camera);
    if (this.city) this.city.update(dt, focus || camera?.position);
    if (this.volcanoSmokeMesh) this._updateVolcanoSmoke(dt, false);
  }

  /** Highest solid terrain at a world XZ position. Ocean is handled separately. */
  getHeightAt(x, z) {
    let height = 0;
    for (let i = 0; i < this.islands.length; i++) {
      const h = this.islands[i].heightAt(x, z);
      if (h > height) height = h;
    }
    return height;
  }

  getIslandAt(x, z) {
    let best = null;
    let bestH = 0;
    for (const island of this.islands) {
      const h = island.heightAt(x, z);
      if (h > bestH) {
        bestH = h;
        best = island;
      }
    }
    return best ? { island: best, height: bestH } : null;
  }

  getRadarContacts(x, z, range = 7000) {
    const contacts = [];
    for (const island of this.islands) {
      const dx = island.def.x - x;
      const dz = island.def.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist < range + island.coastRadius) {
        contacts.push({
          x: island.def.x,
          z: island.def.z,
          radius: island.coastRadius,
          distance: Math.max(0, dist - island.coastRadius),
          height: island.def.peak,
          name: island.def.name,
          major: island.def.major,
        });
      }
    }
    contacts.sort((a, b) => a.distance - b.distance);
    return contacts;
  }

  getVisibleTriangles() {
    return this.stats.triangles;
  }

  /** Releases every GPU buffer owned by this terrain build. */
  dispose() {
    const geometries = new Set();
    const materials = new Set([this.terrainMaterial, this.propMaterial]);
    this.group.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      if (Array.isArray(node.material)) {
        for (const material of node.material) materials.add(material);
      } else if (node.material) {
        materials.add(node.material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      material.map?.dispose?.();
      material.dispose();
    }
    this.group.removeFromParent();
    this.lodObjects.length = 0;
    this.islands.length = 0;
    this.city = null;
  }
}
