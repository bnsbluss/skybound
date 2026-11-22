import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';

/**
 * Builds a soft procedural vapor texture so cloud surfaces have subtle organic
 * density variation and feathered illumination.
 */
function createCloudVaporTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#d8e6f2';
  ctx.fillRect(0, 0, 128, 128);

  const patches = [
    [64, 58, 62, 'rgba(255, 255, 255, 0.95)', 'rgba(220, 235, 248, 0)'],
    [42, 46, 44, 'rgba(255, 253, 248, 0.75)', 'rgba(230, 242, 252, 0)'],
    [88, 52, 48, 'rgba(255, 255, 255, 0.72)', 'rgba(225, 238, 250, 0)'],
    [54, 82, 46, 'rgba(236, 244, 252, 0.65)', 'rgba(210, 226, 242, 0)'],
    [82, 86, 40, 'rgba(240, 247, 255, 0.6)', 'rgba(210, 226, 242, 0)'],
  ];
  for (const [x, y, r, inner, outer] of patches) {
    const grad = ctx.createRadialGradient(x, y, r * 0.12, x, y, r);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Sculpts an icosahedron into an organic cumulus lobe: flattened condensation
 * base, billowing cauliflower domes on top, smooth normals and baked vertical
 * self-shadowing vertex colours (sunlit crown, cool blue-grey underside).
 */
function createCumulusPuffGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 3);
  const pos = geometry.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Multi-frequency billowing displacement for natural cumulus bumps.
    const bump =
      1 +
      0.13 * Math.sin(x * 3.4 + z * 2.1) * Math.cos(y * 2.8) +
      0.08 * Math.cos(z * 4.7 - x * 2.6) +
      0.05 * Math.sin((x + y + z) * 5.5);

    x *= bump;
    z *= bump;

    if (y < 0) {
      // Real cumulus clouds sit on a flatter atmospheric condensation floor.
      y *= 0.54 * (0.92 + 0.08 * bump);
    } else {
      y *= 0.94 + 0.16 * bump;
    }

    pos.setXYZ(i, x, y, z);

    // Baked vertical ambient occlusion: bright warm crown, shaded cool base.
    const shade = THREE.MathUtils.clamp((y + 0.55) / 1.45, 0, 1);
    const smooth = shade * shade * (3 - 2 * shade);
    colors[i * 3] = 0.74 + smooth * 0.26;
    colors[i * 3 + 1] = 0.81 + smooth * 0.19;
    colors[i * 3 + 2] = 0.9 + smooth * 0.1;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Realistic translucent cumulus banks (50 % transparent core + soft outer
 * vapor halo) with flattened condensation bases, billowing upper turrets and
 * silver-lining atmospheric scatter.
 */
export class Clouds {
  constructor(quality) {
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'clouds';
    this.time = 0;
    this.puffs = [];
    this.wind = new THREE.Vector2(2.1, 0.9);
    this.extent = 9500;

    const clusterTarget = quality.cloudClusters ?? 15;
    const puffsPerCluster = quality.cloudPuffs ?? 7;
    this._seed = mulberry32(884422);
    this._build(clusterTarget, puffsPerCluster);

    const geometry = createCumulusPuffGeometry();
    const vaporMap = createCloudVaporTexture();

    this.coreMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: vaporMap,
      vertexColors: true,
      flatShading: false,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      emissive: 0x8bb6cf,
      emissiveIntensity: 0.18,
      fog: true,
    });
    this.shellMaterial = new THREE.MeshLambertMaterial({
      color: 0xf2faff,
      map: vaporMap,
      vertexColors: true,
      flatShading: false,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      emissive: 0xa6cce0,
      emissiveIntensity: 0.22,
      fog: true,
    });

    this.core = new THREE.InstancedMesh(geometry, this.coreMaterial, this.puffs.length);
    this.core.name = 'cloud-cores';
    this.core.castShadow = false;
    this.core.receiveShadow = false;
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.core.frustumCulled = false;
    this.core.renderOrder = 1;

    this.shell = new THREE.InstancedMesh(geometry, this.shellMaterial, this.puffs.length);
    this.shell.name = 'cloud-shells';
    this.shell.castShadow = false;
    this.shell.receiveShadow = false;
    this.shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 2;

    this.group.add(this.core, this.shell);
    this._dummy = new THREE.Object3D();
    this._updateAcc = 0;
    this._updateMatrices(true);
  }

  _build(clusterTarget, puffsPerCluster) {
    const rand = this._seed;
    const anchors = [
      [1350, 780, -1150, 1.45],
      [-2850, 1050, -2900, 1.65],
      [3050, 900, -4150, 1.8],
      [-4100, 720, 1450, 1.25],
      [4550, 1150, 1750, 1.3],
      [-900, 520, 3400, 0.8],
      [2650, 550, 3100, 0.72],
      [-5300, 1250, -4200, 2.0],
      [5600, 820, -1200, 1.1],
      [-2200, 1450, 5250, 1.5],
    ];

    for (let i = 0; i < clusterTarget; i++) {
      let ax, ay, az, scale;
      if (i < anchors.length) {
        [ax, ay, az, scale] = anchors[i];
      } else {
        const angle = rand() * Math.PI * 2;
        const radius = 2400 + rand() * 6200;
        ax = Math.cos(angle) * radius;
        az = Math.sin(angle) * radius;
        ay = 620 + rand() * 1050;
        scale = 0.7 + rand() * 1.2;
      }
      const count = Math.max(5, Math.round(puffsPerCluster * (0.85 + rand() * 0.55)));
      const heading = rand() * Math.PI * 2;
      const stretch = 0.85 + rand() * 1.15;
      for (let j = 0; j < count; j++) {
        const offset = j / count;
        const isCrown = j >= Math.ceil(count * 0.52);
        const localAngle = heading + rand() * Math.PI * 2;
        const spread = (isCrown ? 45 + rand() * 135 : 70 + rand() * 210) * scale;
        const px =
          ax +
          Math.cos(localAngle) * spread * (0.95 + offset * 0.85) +
          (rand() - 0.5) * 145 * scale;
        const pz =
          az +
          Math.sin(localAngle) * spread * (0.95 + offset * 0.85) * stretch +
          (rand() - 0.5) * 115 * scale;
        // Cumulus structure: flat condensation base with taller central turrets.
        const py = isCrown
          ? ay + (45 + rand() * 95) * scale
          : ay + (rand() - 0.25) * 38 * scale;
        const base = (118 + rand() * 128) * scale;
        this.puffs.push({
          x: px,
          y: py,
          z: pz,
          sx: base * (isCrown ? 0.92 + rand() * 0.35 : 1.18 + rand() * 0.45),
          sy: base * (isCrown ? 0.74 + rand() * 0.32 : 0.52 + rand() * 0.22),
          sz: base * (isCrown ? 0.9 + rand() * 0.32 : 1.06 + rand() * 0.38),
          rot: rand() * Math.PI * 2,
          tiltX: (rand() - 0.5) * 0.14,
          tiltZ: (rand() - 0.5) * 0.14,
          tint: 0.94 + rand() * 0.08,
        });
      }
    }
  }

  _updateMatrices(initial = false) {
    const dummy = this._dummy;
    const color = new THREE.Color();
    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i];
      dummy.position.set(puff.x, puff.y, puff.z);
      dummy.rotation.set(puff.tiltX, puff.rot, puff.tiltZ);
      dummy.scale.set(puff.sx, puff.sy, puff.sz);
      dummy.updateMatrix();
      this.core.setMatrixAt(i, dummy.matrix);

      // Soft outer vapor envelope surrounds each cumulus lobe.
      dummy.scale.set(puff.sx * 1.18, puff.sy * 1.14, puff.sz * 1.18);
      dummy.updateMatrix();
      this.shell.setMatrixAt(i, dummy.matrix);

      if (initial) {
        color.setRGB(puff.tint, puff.tint, Math.min(1, puff.tint * 1.01));
        this.core.setColorAt(i, color);
        color.setRGB(0.88 + puff.tint * 0.1, 0.94 + puff.tint * 0.05, 1.0);
        this.shell.setColorAt(i, color);
      }
    }
    this.core.instanceMatrix.needsUpdate = true;
    this.shell.instanceMatrix.needsUpdate = true;
    if (initial) {
      if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
      if (this.shell.instanceColor) this.shell.instanceColor.needsUpdate = true;
      this.core.computeBoundingSphere();
      this.shell.computeBoundingSphere();
    }
  }

  update(dt) {
    this.time += dt;
    this._updateAcc += dt;
    if (this._updateAcc < 1 / 20) return;
    const step = this._updateAcc;
    this._updateAcc = 0;
    const dx = this.wind.x * step;
    const dz = this.wind.y * step;
    for (const puff of this.puffs) {
      puff.x += dx;
      puff.z += dz;
      if (puff.x > this.extent) puff.x -= this.extent * 2;
      if (puff.x < -this.extent) puff.x += this.extent * 2;
      if (puff.z > this.extent) puff.z -= this.extent * 2;
      if (puff.z < -this.extent) puff.z += this.extent * 2;
    }
    this._updateMatrices(false);
  }
}
