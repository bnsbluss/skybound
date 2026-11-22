import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/noise.js';
import { clamp } from '../utils/math.js';
import { paintGeometry, transformGeometry, flattenGeometry } from '../utils/geometry.js';
import { makeBroadleafGeometry } from './IslandField.js';
import {
  CITY_LAYOUT,
  CITY_WATER,
  CITY_BRIDGES,
  MANHATTAN_EDGE,
  BOROUGH_INNER,
  URBAN_HALF_Z,
  aveCenter,
  stCenter,
  boroughCols,
  boroughOuter,
  parkRect,
} from './cityLayout.js';

const L = CITY_LAYOUT;
const BLOCK_W = L.aveSpacing - L.aveWidth; // 224 m (east/west)
const BLOCK_D = L.stSpacing - L.stWidth; // 66 m (north/south)

const mod = (a, n) => ((a % n) + n) % n;

// --------------------------------------------------------------------------
// Materials
// --------------------------------------------------------------------------

/**
 * Lambert material with a procedural facade: window grid computed from the
 * world position, so instanced boxes of any size keep 3.6 m storeys and
 * ~3.2 m window bays. Roofs are darkened, ground floors read as shopfronts,
 * and the pattern fades to an average tone far away to avoid moiré.
 */
export function makeFacadeMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vCityNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    vec4 cityWp = vec4( transformed, 1.0 );
    vec3 cityN = objectNormal;
    #ifdef USE_INSTANCING
      cityWp = instanceMatrix * cityWp;
      cityN = mat3( instanceMatrix ) * cityN;
    #endif
    cityWp = modelMatrix * cityWp;
    vCityPos = cityWp.xyz;
    vCityNrm = mat3( modelMatrix ) * cityN;
  }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vCityNrm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    vec3 cn = normalize( vCityNrm );
    float side = 1.0 - step( 0.6, abs( cn.y ) );
    float along = abs( cn.x ) > abs( cn.z ) ? vCityPos.z : vCityPos.x;
    float fy = fract( vCityPos.y / 3.6 );
    float fx = fract( along / 3.2 );
    float win = step( 0.3, fy ) * step( fy, 0.84 ) * step( 0.16, fx ) * step( fx, 0.84 );
    float camDist = length( vCityPos - cameraPosition );
    float fade = smoothstep( 600.0, 2400.0, camDist );
    vec2 cell = floor( vec2( along / 3.2, vCityPos.y / 3.6 ) );
    float rnd = fract( sin( dot( cell, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    float shine = step( 0.86, rnd ) * ( 1.0 - fade );
    win = mix( win, 0.42, fade );
    float shop = 1.0 - step( 17.5, vCityPos.y );
    vec3 glass = diffuseColor.rgb * vec3( 0.36, 0.44, 0.56 ) + vec3( 0.03, 0.05, 0.08 );
    glass = mix( glass, vec3( 0.86, 0.9, 0.92 ), shine * 0.35 );
    vec3 facade = mix( diffuseColor.rgb, glass, win );
    facade = mix( facade, diffuseColor.rgb * 0.55, shop * 0.6 );
    vec3 roof = diffuseColor.rgb * 0.55 + vec3( 0.06 );
    diffuseColor.rgb = mix( roof, facade, side );
  }`
      );
  };
  material.customProgramCacheKey = () => 'skybound-city-facade-1';
  return material;
}

/** One 250 x 80 m tile of the street grid: avenue, cross street, markings. */
function makeRoadTexture() {
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const px = (m) => (m / L.aveSpacing) * W; // metres → px across (x)
  const pz = (m) => (m / L.stSpacing) * H; // metres → px along (z)

  ctx.fillStyle = '#9d9a92';
  ctx.fillRect(0, 0, W, H);

  const aveX0 = px(L.aveSpacing / 2 - L.aveWidth / 2);
  const aveX1 = px(L.aveSpacing / 2 + L.aveWidth / 2);
  const stZ0 = pz(L.stSpacing / 2 - L.stWidth / 2);
  const stZ1 = pz(L.stSpacing / 2 + L.stWidth / 2);

  ctx.fillStyle = '#3c3f45';
  ctx.fillRect(aveX0, 0, aveX1 - aveX0, H);
  ctx.fillRect(0, stZ0, W, stZ1 - stZ0);

  // Asphalt grain.
  const rand = mulberry32(77);
  for (let i = 0; i < 1400; i++) {
    const shade = 50 + Math.floor(rand() * 26);
    ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
    const onAvenue = rand() < 0.5;
    const x = onAvenue ? aveX0 + rand() * (aveX1 - aveX0) : rand() * W;
    const y = onAvenue ? rand() * H : stZ0 + rand() * (stZ1 - stZ0);
    ctx.fillRect(x, y, 2, 2);
  }

  // Avenue lane dividers (one-way, dashed white) between the crosswalks.
  ctx.fillStyle = 'rgba(240,240,232,0.9)';
  const cx = px(L.aveSpacing / 2);
  for (const off of [-3.5, 0, 3.5]) {
    for (let z = 0; z < L.stSpacing; z += 12) {
      const z0 = z;
      const z1 = z + 4;
      if (z1 > L.stSpacing / 2 - 13 && z0 < L.stSpacing / 2 + 13) continue;
      ctx.fillRect(cx + px(off) - 1, pz(z0), 2, pz(4));
    }
  }
  // Parking lane edge lines.
  ctx.fillStyle = 'rgba(238,238,230,0.75)';
  ctx.fillRect(aveX0 + px(2.4), 0, 2, stZ0 - pz(6));
  ctx.fillRect(aveX0 + px(2.4), stZ1 + pz(6), 2, H - stZ1 - pz(6));
  ctx.fillRect(aveX1 - px(2.4) - 2, 0, 2, stZ0 - pz(6));
  ctx.fillRect(aveX1 - px(2.4) - 2, stZ1 + pz(6), 2, H - stZ1 - pz(6));

  // Zebra crosswalks across the avenue (stripes along the traffic).
  ctx.fillStyle = 'rgba(246,246,240,0.95)';
  for (const zc of [L.stSpacing / 2 - L.stWidth / 2 - 3.2, L.stSpacing / 2 + L.stWidth / 2 + 0.4]) {
    for (let x = -L.aveWidth / 2 + 1; x < L.aveWidth / 2 - 0.5; x += 1.6) {
      ctx.fillRect(cx + px(x), pz(zc), Math.max(1.5, px(0.8)), pz(2.8));
    }
  }
  // Crosswalks across the street.
  const sz = pz(L.stSpacing / 2);
  for (const xc of [L.aveSpacing / 2 - L.aveWidth / 2 - 3.6, L.aveSpacing / 2 + L.aveWidth / 2 + 0.6]) {
    for (let z = -L.stWidth / 2 + 0.8; z < L.stWidth / 2 - 0.4; z += 1.6) {
      ctx.fillRect(px(xc), sz + pz(z), px(3), Math.max(1.5, pz(0.8)));
    }
  }
  // Stop bars.
  ctx.fillRect(aveX0, stZ0 - pz(4.2), aveX1 - aveX0, Math.max(2, pz(0.5)));
  ctx.fillRect(aveX0, stZ1 + pz(3.8), aveX1 - aveX0, Math.max(2, pz(0.5)));
  // Street centre: double yellow is for two-way roads; NYC cross streets
  // are one-way, so only a faint dashed guide.
  ctx.fillStyle = 'rgba(232,196,72,0.55)';
  for (let x = 0; x < L.aveSpacing; x += 10) {
    if (x > L.aveSpacing / 2 - 20 && x < L.aveSpacing / 2 + 20) continue;
    ctx.fillRect(px(x), sz - 1, px(4), 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --------------------------------------------------------------------------
// Geometry helpers
// --------------------------------------------------------------------------

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  return paintGeometry(g, new THREE.Color(hex));
}

/** Unit box standing on y = 0 without its (never visible) bottom face. */
function unitBoxNoBottom(hex = 0xffffff) {
  const src = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  src.translate(0, 0.5, 0);
  const keep = (attr) => {
    const size = attr.itemSize;
    const out = [];
    for (let v = 0; v < attr.count; v++) {
      if (v >= 18 && v < 24) continue; // -Y face
      for (let k = 0; k < size; k++) out.push(attr.array[v * size + k]);
    }
    return new THREE.Float32BufferAttribute(out, size);
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', keep(src.attributes.position));
  g.setAttribute('normal', keep(src.attributes.normal));
  g.setAttribute('uv', keep(src.attributes.uv));
  src.dispose();
  return paintGeometry(g, new THREE.Color(hex));
}

/** A box spanning segment (x0,y0)→(x1,y1) in the XY plane at depth z. */
function beam(x0, y0, x1, y1, z, thick, depth, hex) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const g = new THREE.BoxGeometry(len, thick, depth).toNonIndexed();
  transformGeometry(
    g,
    { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z },
    { x: 0, y: 0, z: Math.atan2(y1 - y0, x1 - x0) },
    null
  );
  return paintGeometry(g, new THREE.Color(hex));
}

function quadXZ(positions, uvs, x0, z0, x1, z1, y, uvFn) {
  // Two triangles facing +Y.
  const pts = [
    [x0, z0],
    [x0, z1],
    [x1, z1],
    [x0, z0],
    [x1, z1],
    [x1, z0],
  ];
  for (const [x, z] of pts) {
    positions.push(x, y, z);
    if (uvs) {
      const [u, v] = uvFn(x, z);
      uvs.push(u, v);
    }
  }
}

function wallRect(parts, x0, z0, x1, z1, y0, y1, hex) {
  const t = 1.2;
  parts.push(box(x1 - x0 + t * 2, y1 - y0, t, (x0 + x1) / 2, y0, z0 - t / 2, hex));
  parts.push(box(x1 - x0 + t * 2, y1 - y0, t, (x0 + x1) / 2, y0, z1 + t / 2, hex));
  parts.push(box(t, y1 - y0, z1 - z0, x0 - t / 2, y0, (z0 + z1) / 2, hex));
  parts.push(box(t, y1 - y0, z1 - z0, x1 + t / 2, y0, (z0 + z1) / 2, hex));
}

/** Modern setback skyscraper, unit footprint and unit height. */
function makeSetbackTowerGeometry() {
  const tiers = [
    [1.0, 0.1, 0xf2f2f2],
    [0.88, 0.46, 0xffffff],
    [0.74, 0.22, 0xf6f6f6],
    [0.56, 0.13, 0xffffff],
    [0.34, 0.06, 0xe4e4e4],
  ];
  const parts = [];
  let y = 0;
  for (const [w, h, hex] of tiers) {
    parts.push(box(w, h, w, 0, y, 0, hex));
    y += h;
  }
  parts.push(box(0.025, 0.06, 0.025, 0, y, 0, 0xc8c8c8));
  return mergeGeometries(parts, false);
}

/** Art-deco tower with a stepped crown and needle (Chrysler style). */
function makeDecoTowerGeometry() {
  const parts = [];
  const tiers = [
    [1.0, 0.5],
    [0.78, 0.18],
    [0.6, 0.1],
  ];
  let y = 0;
  for (const [w, h] of tiers) {
    parts.push(box(w, h, w, 0, y, 0, 0xf4efe4));
    y += h;
  }
  const crown = [0.46, 0.38, 0.3, 0.22, 0.15];
  for (let i = 0; i < crown.length; i++) {
    const w = crown[i];
    const g = new THREE.CylinderGeometry(w * 0.5, w * 0.62, 0.035, 8, 1).toNonIndexed();
    g.rotateY(Math.PI / 8);
    g.translate(0, y + 0.0175, 0);
    parts.push(paintGeometry(g, new THREE.Color(i % 2 ? 0xd9e2ea : 0xbfcad3)));
    y += 0.035;
  }
  const needle = new THREE.ConeGeometry(0.05, 0.16, 6, 1).toNonIndexed();
  needle.translate(0, y + 0.08, 0);
  parts.push(paintGeometry(needle, new THREE.Color(0xdfe6ec)));
  return mergeGeometries(parts, false);
}

/** Empire State style landmark in metres (≈443 m to the antenna tip). */
function makeEmpireGeometry() {
  const parts = [];
  const stone = 0xdcd2bb;
  const tiers = [
    [62, 24],
    [56, 18],
    [46, 238],
    [40, 22],
    [32, 22],
    [24, 18],
    [17, 16],
  ];
  let y = 0;
  for (let i = 0; i < tiers.length; i++) {
    const [w, h] = tiers[i];
    parts.push(box(w, h, w * (i === 2 ? 0.86 : 1), 0, y, 0, i >= 5 ? 0xf0e6cc : stone));
    y += h;
  }
  const mast = new THREE.CylinderGeometry(4.2, 6, 30, 8, 1).toNonIndexed();
  mast.translate(0, y + 15, 0);
  parts.push(paintGeometry(mast, new THREE.Color(0xe8e2d2)));
  y += 30;
  const antenna = new THREE.CylinderGeometry(0.7, 1.4, 62, 6, 1).toNonIndexed();
  antenna.translate(0, y + 31, 0);
  parts.push(paintGeometry(antenna, new THREE.Color(0xb7bcc2)));
  return mergeGeometries(parts, false);
}

/** One World Trade Center style obelisk in metres. */
function makeFreedomTowerGeometry() {
  const parts = [box(64, 56, 64, 0, 0, 0, 0xc8d4dc)];
  const shaft = new THREE.CylinderGeometry(24, 45, 360, 4, 1).toNonIndexed();
  shaft.rotateY(Math.PI / 4);
  shaft.translate(0, 56 + 180, 0);
  parts.push(paintGeometry(shaft, new THREE.Color(0xa9c3d6)));
  parts.push(box(34, 6, 34, 0, 416, 0, 0xd8e0e6));
  const spire = new THREE.CylinderGeometry(0.8, 1.8, 120, 6, 1).toNonIndexed();
  spire.translate(0, 422 + 60, 0);
  parts.push(paintGeometry(spire, new THREE.Color(0xd0d6dc)));
  return mergeGeometries(parts, false);
}

/** Statue of Liberty on her island in the Upper Bay (metres). */
function makeLibertyGeometry() {
  const parts = [];
  const island = new THREE.CylinderGeometry(150, 168, 10, 10, 1).toNonIndexed();
  island.translate(0, 3 + 5, 0);
  parts.push(paintGeometry(island, new THREE.Color(0x6e9a52)));
  const quay = new THREE.CylinderGeometry(152, 152, 1.4, 10, 1, true).toNonIndexed();
  quay.translate(0, 12.6, 0);
  parts.push(paintGeometry(quay, new THREE.Color(0xa8a297)));
  // Star fort.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const g = new THREE.BoxGeometry(18, 8, 18).toNonIndexed();
    g.rotateY(a + Math.PI / 4);
    g.translate(Math.cos(a) * 34, 13 + 4, Math.sin(a) * 34);
    parts.push(paintGeometry(g, new THREE.Color(0xb7ac98)));
  }
  parts.push(box(58, 8, 58, 0, 13, 0, 0xb7ac98));
  parts.push(box(26, 26, 26, 0, 21, 0, 0xc9bea8));
  parts.push(box(20, 6, 20, 0, 47, 0, 0xbdb29c));
  const green = new THREE.Color(0x77b7a1);
  const robe = new THREE.CylinderGeometry(5.5, 9.5, 30, 8, 1).toNonIndexed();
  robe.translate(0, 53 + 15, 0);
  parts.push(paintGeometry(robe, green));
  const torso = new THREE.CylinderGeometry(4.2, 5.4, 9, 8, 1).toNonIndexed();
  torso.translate(0, 83 + 4.5, 0);
  parts.push(paintGeometry(torso, green));
  const head = flattenGeometry(new THREE.IcosahedronGeometry(3.4, 0));
  head.translate(0, 95, 0);
  parts.push(paintGeometry(head, green));
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + ((i - 3) / 7) * Math.PI;
    const spike = new THREE.ConeGeometry(0.6, 4.2, 4, 1).toNonIndexed();
    transformGeometry(
      spike,
      { x: Math.cos(a) * 3.6, y: 97.5, z: Math.sin(a) * 3.6 },
      { x: Math.sin(a) * 0.9, y: 0, z: -Math.cos(a) * 0.9 },
      null
    );
    parts.push(paintGeometry(spike, green));
  }
  const arm = new THREE.CylinderGeometry(1.3, 1.7, 15, 6, 1).toNonIndexed();
  transformGeometry(arm, { x: 4.6, y: 97, z: 0 }, { x: 0, y: 0, z: -0.28 }, null);
  parts.push(paintGeometry(arm, green));
  const torch = new THREE.ConeGeometry(1.8, 4, 6, 1).toNonIndexed();
  torch.rotateX(Math.PI);
  torch.translate(6.8, 106, 0);
  parts.push(paintGeometry(torch, new THREE.Color(0xc9a94a)));
  const flame = flattenGeometry(new THREE.IcosahedronGeometry(1.8, 0));
  flame.translate(6.8, 109, 0);
  parts.push(paintGeometry(flame, new THREE.Color(0xffc23d)));
  parts.push(box(3, 7, 1.4, -5, 82, 2.5, 0x6aa592));
  return mergeGeometries(parts, false);
}

function makeWaterTankGeometry() {
  const parts = [];
  for (const [x, z] of [
    [-1.6, -1.6],
    [1.6, -1.6],
    [-1.6, 1.6],
    [1.6, 1.6],
  ]) {
    parts.push(box(0.35, 3, 0.35, x, 0, z, 0x3e3a36));
  }
  const barrel = new THREE.CylinderGeometry(2.4, 2.5, 4.4, 7, 1, true).toNonIndexed();
  barrel.translate(0, 3 + 2.2, 0);
  parts.push(paintGeometry(barrel, new THREE.Color(0x8a6142)));
  const roof = new THREE.ConeGeometry(2.7, 1.8, 7, 1).toNonIndexed();
  roof.translate(0, 7.4 + 0.9, 0);
  parts.push(paintGeometry(roof, new THREE.Color(0x5b4434)));
  return mergeGeometries(parts, false);
}

function makeCarGeometry(taxi) {
  const parts = [
    box(1.86, 0.5, 4.5, 0, 0.18, 0, 0x262626),
    box(1.84, 0.6, 4.42, 0, 0.5, 0, 0xffffff),
    box(1.64, 0.58, 2.3, 0, 1.1, -0.25, 0x28323e),
    box(1.6, 0.08, 2.1, 0, 1.68, -0.25, 0xffffff),
  ];
  if (taxi) parts.push(box(0.75, 0.3, 0.26, 0, 1.76, -0.25, 0xfff4c0));
  return mergeGeometries(parts, false);
}

function makeBusGeometry() {
  return mergeGeometries(
    [
      box(2.5, 0.5, 12, 0, 0.2, 0, 0x262626),
      box(2.5, 2.3, 11.9, 0, 0.6, 0, 0xffffff),
      box(2.54, 0.85, 11.2, 0, 1.55, 0, 0x26303c),
      box(2.52, 0.3, 11.92, 0, 0.75, 0, 0x2f63b8),
      box(2.3, 0.2, 10, 0, 2.9, 0, 0xd4d8dc),
    ],
    false
  );
}

/** Suspension bridge across a river, built in world metres. */
function makeBridgeGeometry(bridge) {
  const river = CITY_WATER.find((w) => w.id === bridge.river);
  const x0 = river.x0;
  const x1 = river.x1;
  const span = x1 - x0;
  const { z, deck, tower: towerH, style } = bridge;
  const parts = [];
  const steel = style === 'stone' ? 0x8d8577 : style === 'truss' ? 0x7f8a8f : 0x7f96a6;
  const over = 40;
  const ramp = 300;

  // Deck and road surface.
  parts.push(box(span + over * 2, 3.5, 24, (x0 + x1) / 2, deck - 3.5, z, steel));
  parts.push(box(span + over * 2, 0.3, 19, (x0 + x1) / 2, deck, z, 0x3c3f45));
  // Approach ramps down to street level on both banks.
  for (const side of [-1, 1]) {
    const xa = side < 0 ? x0 - over : x1 + over;
    const xb = xa + side * ramp;
    parts.push(beam(xa, deck - 1.6, xb, L.street + 0.4, z, 3.4, 22, steel));
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const px = xa + (xb - xa) * t;
      const py = deck + (L.street - deck) * t;
      parts.push(box(5, py - L.street, 12, px, L.street, z, 0x8a857b));
    }
  }

  const towers = [x0 + span * 0.18, x1 - span * 0.18];
  for (const tx of towers) {
    if (style === 'stone') {
      parts.push(box(16, towerH, 30, tx, L.waterLevel - 2, z, 0xa39784));
      parts.push(box(16.4, 26, 7, tx, deck + 8, z - 7, 0x4a4239));
      parts.push(box(16.4, 26, 7, tx, deck + 8, z + 7, 0x4a4239));
      parts.push(box(18, 3, 32, tx, L.waterLevel - 2 + towerH, z, 0x8f8574));
    } else {
      for (const sz of [-11, 11]) parts.push(box(4.5, towerH, 4.5, tx, L.waterLevel - 2, z + sz, steel));
      for (const f of [0.42, 0.72, 0.98]) {
        parts.push(box(4, 3.2, 26, tx, L.waterLevel - 2 + towerH * f, z, steel));
      }
    }
  }

  // Main cables (parabola between towers, straight backstays) + suspenders.
  const topY = L.waterLevel - 2 + towerH;
  const sagY = deck + 4;
  const cableAt = (x) => {
    if (x <= towers[0]) {
      const t = (x - (x0 - over)) / (towers[0] - (x0 - over));
      return deck + 1 + (topY - deck - 1) * t;
    }
    if (x >= towers[1]) {
      const t = (x1 + over - x) / (x1 + over - towers[1]);
      return deck + 1 + (topY - deck - 1) * t;
    }
    const u = (x - (towers[0] + towers[1]) / 2) / ((towers[1] - towers[0]) / 2);
    return sagY + (topY - sagY) * u * u;
  };
  const cableHex = style === 'stone' ? 0xc9c2b4 : 0x9fb3c2;
  const steps = 18;
  for (const sz of [-11, 11]) {
    const xs = [x0 - over];
    for (let i = 0; i <= steps; i++) xs.push(towers[0] + ((towers[1] - towers[0]) * i) / steps);
    xs.push(x1 + over);
    for (let i = 0; i < xs.length - 1; i++) {
      parts.push(beam(xs[i], cableAt(xs[i]), xs[i + 1], cableAt(xs[i + 1]), z + sz, 1.1, 1.1, cableHex));
    }
    for (let x = towers[0] + 18; x < towers[1] - 9; x += 18) {
      const top = cableAt(x);
      parts.push(box(0.35, top - deck, 0.35, x, deck, z + sz, cableHex));
    }
  }
  return mergeGeometries(parts, false);
}

// --------------------------------------------------------------------------
// Traffic
// --------------------------------------------------------------------------

const CAR_COLORS = [0xf2f2f2, 0xc9ccd0, 0x1c1d20, 0x2b2f36, 0x9b1f24, 0x1f4f8f, 0x6a7178, 0x3d5a3f];
const TAXI_COLOR = 0xf7c41c;

/**
 * Manhattan traffic in a sliding window around the player: a fixed pool of
 * cars drives one-way avenues and cross streets, queues behind each other and
 * obeys a shared 32-second signal cycle. Only the window's lanes are
 * simulated, so the cost is constant no matter where the jet flies.
 */
class Traffic {
  constructor(quality, isRoad) {
    this.isRoad = isRoad;
    const q = clamp(quality.treeDensity ?? 1, 0.4, 1.2);
    this.nA = 8;
    this.nS = 24;
    this.Wx = this.nA * L.aveSpacing;
    this.Wz = this.nS * L.stSpacing;
    this.perAve = Math.max(6, Math.round(24 * q));
    this.perSt = Math.max(4, Math.round(12 * q));
    this.time = 0;
    this._trafficAcc = 0;
    this.kStart = null;
    this.jStart = null;
    const rand = mulberry32(911);
    this.rand = rand;

    this.cars = [];
    const counts = [0, 0, 0];
    const makeCar = (lane, curb) => {
      let type = 0;
      const roll = rand();
      if (curb && roll < 0.1) type = 2;
      else if (roll < 0.42) type = 1;
      const car = {
        lane,
        c: 0,
        v: 0,
        vmax: type === 2 ? 9 + rand() * 2 : 10 + rand() * 5,
        len: type === 2 ? 12 : 4.6,
        type,
        idx: counts[type]++,
      };
      this.cars.push(car);
      return car;
    };

    this.aveSlots = [];
    for (let i = 0; i < this.nA; i++) {
      const lanes = [-5.25, -1.75, 1.75].map((offset, j) => {
        const lane = { axis: 'z', offset, key: null, dir: 1, fixed: 0, cars: [] };
        for (let n = 0; n < this.perAve; n++) lane.cars.push(makeCar(lane, j === 0));
        return lane;
      });
      this.aveSlots.push({ key: null, lanes });
    }
    this.stSlots = [];
    for (let i = 0; i < this.nS; i++) {
      const lane = { axis: 'x', offset: -1.6, key: null, dir: 1, fixed: 0, cars: [] };
      for (let n = 0; n < this.perSt; n++) lane.cars.push(makeCar(lane, false));
      this.stSlots.push({ key: null, lanes: [lane] });
    }

    const geometries = [makeCarGeometry(false), makeCarGeometry(true), makeBusGeometry()];
    const names = ['city-cars', 'city-taxis', 'city-buses'];
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.meshes = geometries.map((geometry, type) => {
      const mesh = new THREE.InstancedMesh(geometry, this.material, Math.max(1, counts[type]));
      mesh.name = names[type];
      mesh.count = counts[type];
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = !!quality.shadows;
      return mesh;
    });
    const color = new THREE.Color();
    for (const car of this.cars) {
      if (car.type === 1) color.setHex(TAXI_COLOR);
      else if (car.type === 2) color.setRGB(0.92, 0.95, 1);
      else color.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
      this.meshes[car.type].setColorAt(car.idx, color);
    }
    for (const mesh of this.meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.update(0, 0, 0);
  }

  get count() {
    return this.cars.length;
  }

  _seedLane(lane, key, w0, length) {
    lane.key = key;
    lane.dir = mod(key, 2) === 0 ? 1 : -1;
    lane.fixed = (lane.axis === 'z' ? aveCenter(key) : stCenter(key)) + lane.offset;
    const n = lane.cars.length;
    const spacing = length / n;
    for (let i = 0; i < n; i++) {
      const car = lane.cars[i];
      car.c = w0 + (i + 0.15 + this.rand() * 0.5) * spacing;
      car.v = car.vmax * (0.4 + this.rand() * 0.5);
    }
    // Ring order follows the direction of travel (ascending t = dir * c).
    if (lane.dir < 0) lane.cars.reverse();
  }

  _recenter(fx, fz) {
    const kStart = Math.round(fx / L.aveSpacing - 0.5 - (this.nA - 1) / 2);
    const jStart = Math.round(fz / L.stSpacing - 0.5 - (this.nS - 1) / 2);
    this.kStart = kStart;
    this.jStart = jStart;
    this.xw0 = kStart * L.aveSpacing;
    this.zw0 = jStart * L.stSpacing;
    for (let i = 0; i < this.nA; i++) {
      const k = kStart + mod(i - kStart, this.nA);
      const slot = this.aveSlots[i];
      if (slot.key === k) continue;
      slot.key = k;
      for (const lane of slot.lanes) this._seedLane(lane, k, this.zw0, this.Wz);
    }
    for (let i = 0; i < this.nS; i++) {
      const j = jStart + mod(i - jStart, this.nS);
      const slot = this.stSlots[i];
      if (slot.key === j) continue;
      slot.key = j;
      for (const lane of slot.lanes) this._seedLane(lane, j, this.xw0, this.Wx);
    }
  }

  _stepLane(lane, dt, green) {
    const cars = lane.cars;
    const n = cars.length;
    const dir = lane.dir;
    const alongZ = lane.axis === 'z';
    const length = alongZ ? this.Wz : this.Wx;
    const w0 = alongZ ? this.zw0 : this.xw0;
    const P = alongZ ? L.stSpacing : L.aveSpacing;
    const hw = (alongZ ? L.stWidth : L.aveWidth) / 2 + 1.5;
    for (let i = 0; i < n; i++) {
      const car = cars[i];
      const leader = cars[(i + 1) % n];
      const t = dir * car.c;
      let target = car.vmax;
      if (n > 1) {
        const gap = mod(dir * leader.c - t, length);
        const minGap = (leader.len + car.len) / 2 + 2.6;
        target = Math.min(target, Math.sqrt(Math.max(0, 2 * 4.5 * (gap - minGap))));
      }
      if (!green) {
        const jn = Math.ceil((t + hw) / P - 0.5);
        const d = (jn + 0.5) * P - hw - t;
        if (d > (car.v * car.v) / 14 + 0.3) {
          target = Math.min(target, Math.sqrt(Math.max(0, 2 * 4.5 * (d - 0.4))));
        }
      }
      if (car.v < target) car.v = Math.min(target, car.v + 2.8 * dt);
      else car.v = Math.max(target, car.v - 9 * dt);
    }
    for (let i = 0; i < n; i++) {
      const car = cars[i];
      car.c = w0 + mod(car.c + dir * car.v * dt - w0, length);
    }
  }

  update(dt, fx, fz) {
    if (dt > 0) {
      this._trafficAcc += dt;
      if (this._trafficAcc < 1 / 30) return;
      dt = this._trafficAcc;
      this._trafficAcc = 0;
    }
    this.time += dt;
    this._recenter(fx, fz);
    const phase = this.time % 32;
    const aveGreen = phase < 14;
    const stGreen = phase >= 16 && phase < 30;
    const step = Math.min(dt, 0.1);
    if (step > 0) {
      for (const slot of this.aveSlots) for (const lane of slot.lanes) this._stepLane(lane, step, aveGreen);
      for (const slot of this.stSlots) for (const lane of slot.lanes) this._stepLane(lane, step, stGreen);
    }
    const arrays = this.meshes.map((m) => m.instanceMatrix.array);
    const y = L.street + 0.02;
    for (const car of this.cars) {
      const lane = car.lane;
      const x = lane.axis === 'z' ? lane.fixed : car.c;
      const z = lane.axis === 'z' ? car.c : lane.fixed;
      let cs;
      let sn;
      if (lane.axis === 'z') {
        cs = lane.dir;
        sn = 0;
      } else {
        cs = 0;
        sn = lane.dir;
      }
      const visible = this.isRoad(x, z);
      const a = arrays[car.type];
      const o = car.idx * 16;
      a[o] = cs;
      a[o + 1] = 0;
      a[o + 2] = -sn;
      a[o + 3] = 0;
      a[o + 4] = 0;
      a[o + 5] = 1;
      a[o + 6] = 0;
      a[o + 7] = 0;
      a[o + 8] = sn;
      a[o + 9] = 0;
      a[o + 10] = cs;
      a[o + 11] = 0;
      a[o + 12] = x;
      a[o + 13] = visible ? y : -400;
      a[o + 14] = z;
      a[o + 15] = 1;
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

// --------------------------------------------------------------------------
// City grid
// --------------------------------------------------------------------------

const PALETTES = {
  low: [0x9b5a44, 0x8a4f3d, 0xa8674e, 0x7b5443, 0xcdbf9f, 0xb9ab8c, 0x9a9a96],
  mid: [0xd2c6aa, 0xc9bb9b, 0xb0aca4, 0x9da0a3, 0xa8674e, 0xe0d6c0],
  tall: [0x9db8cc, 0x7f9fbd, 0x5f7f9c, 0xb6c4cc, 0xd2c6aa, 0x44586c, 0xa9b0b6],
};
const BILLBOARD_COLORS = [0xff3b6b, 0x29d3ff, 0xffd23f, 0x7cff5b, 0xff7a1a, 0xc65bff, 0xffffff, 0x2f7bff];

/**
 * KOTA: a New York style city. A Manhattan street grid between the Hudson
 * and the East River, brownstone boroughs on both banks, Midtown and the
 * Financial District skylines, Central Park, Times Square, five bridges, the
 * Statue of Liberty in the bay and live one-way traffic with signals.
 */
export class CityGrid {
  constructor(quality, biome) {
    this.quality = quality;
    this.biome = biome;
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.stats = { structures: 0, trees: 0, cars: 0, blocks: 0, bridges: 0 };
    this.boroughCols = boroughCols(quality);
    this.boroughOuter = boroughOuter(quality);
    this.park = parkRect();
    this.facadeMaterial = makeFacadeMaterial();
    this.plainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.traffic = null;
  }

  /** True on drivable asphalt (cars outside are parked below the ground). */
  isRoad(x, z) {
    if (Math.abs(z) > URBAN_HALF_Z - 2) return false;
    const ax = Math.abs(x);
    const onLand = ax <= MANHATTAN_EDGE - 2 || (ax >= BOROUGH_INNER + 2 && ax <= this.boroughOuter - 2);
    if (!onLand) return false;
    const p = this.park;
    if (x > p.x0 - 1 && x < p.x1 + 1 && z > p.z0 - 1 && z < p.z1 + 1) return false;
    return true;
  }

  build() {
    this._buildGround();
    this._buildBlocks();
    this._buildPark();
    this._buildLandmarks();
    this._buildBridges();
    this.traffic = new Traffic(this.quality, (x, z) => this.isRoad(x, z));
    for (const mesh of this.traffic.meshes) this.group.add(mesh);
    this.stats.cars = this.traffic.count;
    return this;
  }

  update(dt, focus) {
    if (!this.traffic) return;
    this.traffic.update(dt, focus?.x ?? 0, focus?.z ?? 0);
  }

  _urbanRects() {
    const zz = URBAN_HALF_Z;
    return [
      { x0: -MANHATTAN_EDGE, x1: MANHATTAN_EDGE, z0: -zz, z1: zz },
      { x0: -this.boroughOuter, x1: -BOROUGH_INNER, z0: -zz, z1: zz },
      { x0: BOROUGH_INNER, x1: this.boroughOuter, z0: -zz, z1: zz },
    ];
  }

  _buildGround() {
    // Asphalt decks with the repeating grid texture (UV = world / tile).
    const positions = [];
    const uvs = [];
    const uvFn = (x, z) => [x / L.aveSpacing, z / L.stSpacing];
    for (const r of this._urbanRects()) quadXZ(positions, uvs, r.x0, r.z0, r.x1, r.z1, L.street, uvFn);
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.computeVertexNormals();
    const roadMat = new THREE.MeshLambertMaterial({
      map: makeRoadTexture(),
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4,
    });
    const roads = new THREE.Mesh(roadGeo, roadMat);
    roads.name = 'city-roads';
    roads.receiveShadow = !!this.quality.shadows;
    this.group.add(roads);

    // Sea walls around every urban deck.
    const walls = [];
    for (const r of this._urbanRects()) wallRect(walls, r.x0, r.z0, r.x1, r.z1, L.riverBed - 1, L.street, 0x7d7a73);
    const wallMesh = new THREE.Mesh(mergeGeometries(walls, false), this.plainMaterial);
    wallMesh.name = 'city-seawalls';
    this.group.add(wallMesh);

    // Rivers and the bay.
    const water = [];
    for (const w of CITY_WATER) quadXZ(water, null, w.x0, w.z0, w.x1, w.z1, L.waterLevel);
    const waterGeo = new THREE.BufferGeometry();
    waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(water, 3));
    waterGeo.computeVertexNormals();
    const waterMat = new THREE.MeshPhongMaterial({
      color: 0x2d6480,
      specular: 0x9fc4d8,
      shininess: 70,
      emissive: 0x0b2230,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.name = 'city-rivers';
    waterMesh.receiveShadow = !!this.quality.shadows;
    this.group.add(waterMesh);
  }

  _landmarkBlocks() {
    return new Set(['0,0', '1,-3', '-1,59', '0,-5']);
  }

  _bridgeBlocked(x, z, w, d) {
    for (const b of CITY_BRIDGES) {
      if (Math.abs(z - b.z) > d / 2 + 16) continue;
      const river = CITY_WATER.find((r) => r.id === b.river);
      if (x + w / 2 > river.x0 - 360 && x - w / 2 < river.x1 + 360) return true;
    }
    return false;
  }

  _buildBlocks() {
    const rand = mulberry32(20261121);
    const d = this.quality.treeDensity ?? 1;
    const lotFactor = d < 0.6 ? 1.35 : d < 1 ? 1.12 : 1;
    const tankChance = d < 0.6 ? 0.08 : 0.16;
    const slabs = [];
    const boxes = [];
    const towers = [];
    const decos = [];
    const tanks = [];
    const billboards = [];
    const reserved = this._landmarkBlocks();
    const park = L.park;
    const color = new THREE.Color();

    const pickColor = (list) => list[Math.floor(rand() * list.length)];
    const addSlab = (cx, cz, w, dd, h, hex) => slabs.push({ x: cx, z: cz, w, d: dd, h, hex });

    const cols = [];
    for (let c = -L.manhattanCols; c <= L.manhattanCols; c++) cols.push(c);
    for (let i = 0; i < this.boroughCols; i++) {
      cols.push(L.boroughFirst + i);
      cols.push(-(L.boroughFirst + i));
    }

    const timesSquare = { faces: [] };

    for (const c of cols) {
      const manhattan = Math.abs(c) <= L.manhattanCols;
      for (let r = -L.rows; r <= L.rows; r++) {
        const cx = c * L.aveSpacing;
        const cz = r * L.stSpacing;
        if (manhattan && c >= park.c0 && c <= park.c1 && r >= park.r0 && r <= park.r1) continue;
        const boroughPark = !manhattan && rand() < 0.035;
        addSlab(cx, cz, BLOCK_W, BLOCK_D, 0.9, boroughPark ? 0x5f9a4c : 0xb8b4aa);
        this.stats.blocks++;
        if (boroughPark) {
          // Small neighbourhood park: a few trees, no buildings.
          for (let i = 0; i < 6; i++) {
            this._parkTreeList = this._parkTreeList ?? [];
            this._parkTreeList.push({
              x: cx + (rand() - 0.5) * BLOCK_W * 0.85,
              z: cz + (rand() - 0.5) * BLOCK_D * 0.7,
              s: 1.3 + rand() * 0.8,
            });
          }
          continue;
        }
        if (manhattan && reserved.has(`${c},${r}`)) continue;

        if (manhattan) {
          const mid = Math.exp(-((cx / 1150) ** 2 + (cz / 1600) ** 2));
          const fin = Math.exp(-(((cx + 250) / 950) ** 2 + ((cz - 4650) / 720) ** 2));
          const core = Math.max(mid, fin * 1.1);
          const uptown = Math.exp(-(((cz + 3400) / 1500) ** 2));
          let x = cx - BLOCK_W / 2 + 2;
          const end = cx + BLOCK_W / 2 - 2;
          while (x < end - 10) {
            const tallLot = rand() < core * 0.9;
            const minW = tallLot ? 46 : 26;
            const maxW = tallLot ? 84 : 58;
            let w = (minW + rand() * (maxW - minW)) * lotFactor;
            if (end - (x + w) < minW * 0.7) w = end - x;
            const lx = x + w / 2;
            const depth = BLOCK_D - 4;
            if (this._bridgeBlocked(lx, cz, w, depth)) {
              x += w + 1;
              continue;
            }
            if (tallLot) {
              const H = 80 + Math.pow(rand(), 0.85) * core * 320;
              const roll = rand();
              const hex = pickColor(PALETTES.tall);
              const fw = Math.min(w - 2, depth);
              if (H > 115 && roll < 0.58) {
                towers.push({ x: lx, z: cz, w: fw, h: H, d: depth * (0.86 + rand() * 0.14), hex });
              } else if (H > 140 && roll < 0.64) {
                decos.push({ x: lx, z: cz, w: Math.min(fw, 56), h: H, d: Math.min(fw, 56), hex: 0xf0ebe0 });
              } else {
                boxes.push({ x: lx, z: cz, w: w - 2, h: H, d: depth, hex });
              }
            } else {
              const split = rand() < 0.55;
              const rows = split ? [cz - depth / 4 - 0.5, cz + depth / 4 + 0.5] : [cz];
              for (const rz of rows) {
                const H = 16 + rand() * 34 + uptown * rand() * 40;
                const dd = split ? depth / 2 - 1 : depth;
                const hex = pickColor(H > 40 ? PALETTES.mid : PALETTES.low);
                boxes.push({ x: lx, z: rz, w: w - 1.5, h: H, d: dd, hex });
                if (H < 70 && rand() < tankChance) {
                  tanks.push({
                    x: lx + (rand() - 0.5) * (w - 10),
                    z: rz + (rand() - 0.5) * (dd - 8),
                    y: L.slabTop + H,
                  });
                }
                if (c === 0 && (r === -6 || r === -4)) {
                  const faceZ = r === -6 ? rz + dd / 2 : rz - dd / 2;
                  if (Math.abs(faceZ - (r === -6 ? cz + depth / 2 : cz - depth / 2)) < 1) {
                    timesSquare.faces.push({ x: lx, z: faceZ, w: w - 1.5, h: H, sign: r === -6 ? 1 : -1 });
                  }
                }
              }
            }
            x += w + rand() * 1.5;
          }
        } else {
          // Boroughs: brownstone rows front/back, waterfront towers.
          const ax = Math.abs(cx);
          const waterfront = Math.exp(-(((ax - 2550) / 520) ** 2));
          const brooklyn = cx > 0 ? Math.exp(-(((cx - 2700) / 700) ** 2 + ((cz - 4300) / 900) ** 2)) : 0;
          if (rand() < (waterfront + brooklyn) * 0.42) {
            const H = 45 + rand() * 120 * Math.max(waterfront, brooklyn * 1.2);
            const w = (60 + rand() * 50) * lotFactor;
            const lx = cx + (rand() - 0.5) * (BLOCK_W - w - 6);
            if (!this._bridgeBlocked(lx, cz, w, BLOCK_D - 6)) {
              const hex = pickColor(PALETTES.tall);
              if (H > 115) towers.push({ x: lx, z: cz, w: Math.min(w, BLOCK_D - 6), h: H, d: BLOCK_D - 6, hex });
              else boxes.push({ x: lx, z: cz, w, h: H, d: BLOCK_D - 6, hex });
            }
          }
          for (const rz of [cz - BLOCK_D / 2 + 10, cz + BLOCK_D / 2 - 10]) {
            const segments = rand() < 0.5 * lotFactor ? 1 : 2;
            let x = cx - BLOCK_W / 2 + 3;
            const segW = (BLOCK_W - 6) / segments;
            for (let s = 0; s < segments; s++) {
              const w = segW - 3;
              const lx = x + segW / 2;
              x += segW;
              if (this._bridgeBlocked(lx, rz, w, 17)) continue;
              const H = 9 + rand() * 12 + (rand() < 0.08 ? 20 : 0);
              boxes.push({ x: lx, z: rz, w, h: H, d: 17, hex: pickColor(PALETTES.low) });
            }
          }
        }
      }
    }

    // Times Square: a plaza block framed by stacked, glowing billboards.
    for (const face of timesSquare.faces) {
      for (let y = 18; y + 10 < face.h; y += 15) {
        const h = 9 + rand() * 5;
        billboards.push({ x: face.x, z: face.z + face.sign * 0.7, w: face.w * 0.86, h, y: L.slabTop + y, hex: pickColor(BILLBOARD_COLORS) });
      }
    }

    // --- instanced meshes ---
    const unit = unitBoxNoBottom();
    const write = (mesh, i, x, y, z, sx, sy, sz) => {
      const a = mesh.instanceMatrix.array;
      const o = i * 16;
      a.fill(0, o, o + 16);
      a[o] = sx;
      a[o + 5] = sy;
      a[o + 10] = sz;
      a[o + 12] = x;
      a[o + 13] = y;
      a[o + 14] = z;
      a[o + 15] = 1;
    };
    const instanced = (name, geometry, material, list, place, colorOf) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      mesh.name = name;
      list.forEach((item, i) => {
        place(mesh, i, item);
        mesh.setColorAt(i, colorOf(item));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = !!(this.quality.shadows && this.quality.treeShadows);
      mesh.receiveShadow = !!this.quality.shadows;
      this.group.add(mesh);
      return mesh;
    };
    const tinted = (item) => {
      color.setHex(item.hex);
      const t = 0.9 + ((item.x * 13.1 + item.z * 7.7) % 1 + 1) % 1 * 0.18;
      return color.multiplyScalar(t);
    };

    const slabMesh = instanced(
      'city-blocks',
      unit,
      this.plainMaterial,
      slabs,
      (m, i, s) => write(m, i, s.x, L.street - 0.1, s.z, s.w, s.h, s.d),
      (s) => color.setHex(s.hex)
    );
    if (slabMesh) slabMesh.castShadow = false;
    instanced(
      'city-buildings',
      unit.clone(),
      this.facadeMaterial,
      boxes,
      (m, i, b) => write(m, i, b.x, L.slabTop - 0.1, b.z, b.w, b.h, b.d),
      tinted
    );
    instanced(
      'trees-tower',
      makeSetbackTowerGeometry(),
      this.facadeMaterial,
      towers,
      (m, i, b) => write(m, i, b.x, L.slabTop - 0.1, b.z, b.w, b.h, b.d),
      tinted
    );
    instanced(
      'city-deco',
      makeDecoTowerGeometry(),
      this.facadeMaterial,
      decos,
      (m, i, b) => write(m, i, b.x, L.slabTop - 0.1, b.z, b.w, b.h, b.d),
      tinted
    );
    const tankMesh = instanced(
      'city-watertanks',
      makeWaterTankGeometry(),
      this.plainMaterial,
      tanks,
      (m, i, t) => write(m, i, t.x, t.y - 0.1, t.z, 1, 1, 1),
      () => color.setRGB(1, 1, 1)
    );
    if (tankMesh) tankMesh.castShadow = false;
    if (billboards.length) {
      const boardMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      const mesh = instanced(
        'city-billboards',
        unitBoxNoBottom(),
        boardMat,
        billboards,
        (m, i, b) => write(m, i, b.x, b.y, b.z, b.w, b.h, 0.8),
        (b) => color.setHex(b.hex)
      );
      if (mesh) mesh.castShadow = false;
    }

    this.stats.structures += boxes.length + towers.length + decos.length;
    this.counts = {
      buildings: boxes.length,
      towers: towers.length,
      deco: decos.length,
      tanks: tanks.length,
      billboards: billboards.length,
    };
  }

  _buildPark() {
    const p = this.park;
    const rand = mulberry32(1857);
    const parts = [box(p.x1 - p.x0, 1.4, p.z1 - p.z0, (p.x0 + p.x1) / 2, L.street - 0.2, (p.z0 + p.z1) / 2, 0x5f9a4c)];
    const top = L.street + 1.2;
    const len = p.z1 - p.z0;
    // Great Lawn and the Sheep Meadow: paler oval-ish patches.
    parts.push(box((p.x1 - p.x0) * 0.42, 0.25, len * 0.12, (p.x0 + p.x1) / 2, top, p.z0 + len * 0.52, 0x86bf62));
    parts.push(box((p.x1 - p.x0) * 0.36, 0.25, len * 0.08, (p.x0 + p.x1) / 2 - 60, top, p.z0 + len * 0.86, 0x86bf62));
    // Perimeter wall.
    wallRect(parts, p.x0 + 1, p.z0 + 1, p.x1 - 1, p.z1 - 1, top, top + 1.1, 0x8f8a7c);
    const parkMesh = new THREE.Mesh(mergeGeometries(parts, false), this.plainMaterial);
    parkMesh.name = 'city-park';
    parkMesh.receiveShadow = !!this.quality.shadows;
    this.group.add(parkMesh);

    // Reservoir and The Lake.
    const waters = [
      { x: (p.x0 + p.x1) / 2, z: p.z0 + len * 0.28, rx: 230, rz: 300 },
      { x: (p.x0 + p.x1) / 2 + 40, z: p.z0 + len * 0.72, rx: 130, rz: 90 },
      { x: (p.x0 + p.x1) / 2 - 150, z: p.z0 + len * 0.08, rx: 90, rz: 70 },
    ];
    const pondParts = waters.map((w) => {
      const g = new THREE.CircleGeometry(1, 18);
      g.rotateX(-Math.PI / 2);
      g.scale(w.rx, 1, w.rz);
      g.translate(w.x, top + 0.35, w.z);
      return g;
    });
    const pondMat = new THREE.MeshPhongMaterial({
      color: 0x3a7090,
      specular: 0x9fc4d8,
      shininess: 60,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
    });
    const ponds = new THREE.Mesh(mergeGeometries(pondParts, false), pondMat);
    ponds.name = 'city-park-water';
    this.group.add(ponds);

    // Trees.
    const d = clamp(this.quality.treeDensity ?? 1, 0.4, 1.2);
    const target = Math.round(1100 * d);
    const trees = this._parkTreeList ?? [];
    let guard = 0;
    let placed = 0;
    while (placed < target && guard < target * 6) {
      guard++;
      const x = p.x0 + 10 + rand() * (p.x1 - p.x0 - 20);
      const z = p.z0 + 10 + rand() * (len - 20);
      if (waters.some((w) => ((x - w.x) / (w.rx + 12)) ** 2 + ((z - w.z) / (w.rz + 12)) ** 2 < 1)) continue;
      if (Math.abs(x - (p.x0 + p.x1) / 2) < (p.x1 - p.x0) * 0.24 && Math.abs(z - (p.z0 + len * 0.52)) < len * 0.07) continue;
      trees.push({ x, z, s: 1.5 + rand() * 1.1, y: top });
      placed++;
    }
    if (trees.length) {
      const mesh = new THREE.InstancedMesh(makeBroadleafGeometry(), this.plainMaterial, trees.length);
      mesh.name = 'city-park-trees';
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      trees.forEach((t, i) => {
        dummy.position.set(t.x, (t.y ?? L.slabTop) - 0.2, t.z);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.set(t.s, t.s * (0.9 + rand() * 0.3), t.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const tint = 0.85 + rand() * 0.25;
        mesh.setColorAt(i, color.setRGB(tint, tint * (0.98 + rand() * 0.06), tint * 0.92));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = !!(this.quality.shadows && this.quality.treeShadows);
      mesh.receiveShadow = !!this.quality.shadows;
      this.group.add(mesh);
      this.stats.trees += trees.length;
    }
  }

  _buildLandmarks() {
    // Empire State style supertower dead centre (kept as `trees-supertower`).
    const empire = new THREE.InstancedMesh(makeEmpireGeometry(), this.facadeMaterial, 1);
    empire.name = 'trees-supertower';
    const m = new THREE.Matrix4().makeTranslation(0, L.slabTop - 0.1, 0);
    empire.setMatrixAt(0, m);
    empire.setColorAt(0, new THREE.Color(1, 1, 1));
    empire.computeBoundingSphere();
    empire.castShadow = !!this.quality.shadows;
    empire.receiveShadow = !!this.quality.shadows;
    this.group.add(empire);

    const chrysler = makeDecoTowerGeometry();
    chrysler.scale(54, 300, 54);
    chrysler.translate(aveCenter(0) + BLOCK_W / 2 - 80, L.slabTop - 0.1, stCenter(-4) + L.stWidth / 2 + BLOCK_D / 2);
    const freedom = makeFreedomTowerGeometry();
    freedom.translate(-250, L.slabTop - 0.1, 59 * L.stSpacing);
    const sky = new THREE.Mesh(mergeGeometries([chrysler, freedom], false), this.facadeMaterial);
    sky.name = 'city-landmarks';
    sky.castShadow = !!this.quality.shadows;
    sky.receiveShadow = !!this.quality.shadows;
    this.group.add(sky);

    const liberty = makeLibertyGeometry();
    liberty.translate(-1450, 0, 6650);
    const libertyMesh = new THREE.Mesh(liberty, this.plainMaterial);
    libertyMesh.name = 'city-liberty';
    this.group.add(libertyMesh);

    this.stats.structures += 3;
  }

  _buildBridges() {
    const parts = CITY_BRIDGES.map((b) => makeBridgeGeometry(b));
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), this.plainMaterial);
    mesh.name = 'city-bridges';
    mesh.castShadow = !!this.quality.shadows;
    mesh.receiveShadow = !!this.quality.shadows;
    this.group.add(mesh);
    this.stats.bridges = CITY_BRIDGES.length;
  }
}
