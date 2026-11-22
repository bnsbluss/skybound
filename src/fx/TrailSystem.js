import * as THREE from 'three';
import { clamp, lerp } from '../utils/math.js';
import { smokeTexture } from '../utils/textures.js';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(1.0, -mvPosition.z);
    gl_PointSize = aAlpha > 0.001 ? clamp(aSize * uPixelRatio * (420.0 / dist), 1.0, 220.0) : 0.0;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float alpha = tex.a * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Particle {
  constructor() {
    this.active = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.color = new THREE.Color();
    this.age = 0;
    this.life = 1;
    this.size0 = 1;
    this.size1 = 1;
    this.alpha0 = 1;
    this.drag = 0;
    this.gravity = 0;
    this.sizeEase = 1;
  }
}

/**
 * Pooled GPU point particles for exhaust smoke, high-altitude contrails,
 * wingtip vapour and crash bursts.
 */
export class TrailSystem {
  constructor(quality = {}) {
    this.capacity = quality.particleCapacity ?? 420;
    this.pool = Array.from({ length: this.capacity }, () => new Particle());
    this.cursor = 0;
    this.activeCount = 0;
    this.time = 0;

    this.smokeAcc = 0;
    this.contrailAcc = 0;
    this.vapourAcc = 0;
    this.lastSmokePos = new THREE.Vector3();
    this.lastWingtipPositions = [new THREE.Vector3(), new THREE.Vector3()];

    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.alphas = new Float32Array(this.capacity);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeTexture() },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: true,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'trail-particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;

    this._forward = new THREE.Vector3();
    this._nozzle = new THREE.Vector3();
    this._wingtips = [new THREE.Vector3(), new THREE.Vector3()];
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  setPixelRatio(ratio) {
    this.material.uniforms.uPixelRatio.value = Math.min(2, ratio);
  }

  spawn(options) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    p.active = true;
    p.age = 0;
    p.life = options.life ?? 1;
    p.pos.copy(options.position);
    p.vel.copy(options.velocity ?? this._tmp.set(0, 0, 0));
    p.color.set(options.color ?? 0xffffff);
    p.size0 = options.size0 ?? 1;
    p.size1 = options.size1 ?? p.size0 * 2;
    p.alpha0 = options.alpha ?? 0.4;
    p.drag = options.drag ?? 0.6;
    p.gravity = options.gravity ?? 0;
    p.sizeEase = options.sizeEase ?? 1;
  }

  clear() {
    for (const p of this.pool) p.active = false;
    this.activeCount = 0;
    this.points.visible = false;
    this._writeBuffers(true);
  }

  update(dt, aircraft, physics, world, active = true) {
    this.time += dt;
    dt = Math.min(dt, 0.05);

    // Integrate living particles.
    let alive = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      alive++;
      p.pos.addScaledVector(p.vel, dt);
      const drag = Math.exp(-p.drag * dt);
      p.vel.multiplyScalar(drag);
      p.vel.y += p.gravity * dt;
    }

    if (active && aircraft.visible) {
      aircraft.getNozzleWorldPosition(this._nozzle);
      aircraft.getWingtipWorldPositions(this._wingtips);
      this._forward.copy(physics.velocity).normalize().negate();
      this._right.set(1, 0, 0).applyQuaternion(physics.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(physics.quaternion);

      const altitude = physics.position.y - Math.max(0, world.getHeightAt(physics.position.x, physics.position.z));
      const speed = physics.speed;
      const boost = physics.afterburner;
      const g = Math.abs(physics.gForce);

      // Engine smoke.
      const smokeRate = boost > 0.08 ? 19 : speed > 90 ? 4.5 : 1.5;
      this.smokeAcc = Math.min(this.smokeAcc + smokeRate * dt, 6);
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        this._tmp
          .copy(this._forward)
          .multiplyScalar(7 + Math.random() * 5)
          .addScaledVector(this._right, (Math.random() - 0.5) * 2.4)
          .addScaledVector(this._up, (Math.random() - 0.5) * 1.6);
        this.spawn({
          position: this._nozzle,
          velocity: this._tmp,
          life: 0.9 + Math.random() * 1.2,
          size0: 1.0 + Math.random() * 1.4,
          size1: 8 + Math.random() * 8,
          color: boost > 0.08 ? 0x6b625a : 0x58646a,
          alpha: boost > 0.08 ? 0.22 : 0.14,
          drag: 0.75,
          gravity: 0.4,
        });
      }

      // High-altitude contrails from both wingtips.
      if (altitude > 700 && speed > 80) {
        const density = clamp((altitude - 700) / 900, 0, 1) * clamp((speed - 80) / 100, 0, 1);
        this.contrailAcc = Math.min(this.contrailAcc + dt * (2 + density * 14), 6);
        while (this.contrailAcc >= 1) {
          this.contrailAcc -= 1;
          for (let i = 0; i < 2; i++) {
            this._tmp
              .copy(this._forward)
              .multiplyScalar(2 + Math.random() * 3)
              .addScaledVector(this._up, (Math.random() - 0.5) * 0.6);
            this.spawn({
              position: this._wingtips[i],
              velocity: this._tmp,
              life: 3.0 + Math.random() * 2.5,
              size0: 0.8 + Math.random() * 0.6,
              size1: 7 + Math.random() * 6,
              color: 0xf2fcff,
              alpha: 0.13 + density * 0.1,
              drag: 0.12,
              gravity: 0.05,
            });
          }
        }
      }

      // Wingtip vapour during hard manoeuvres.
      if (g > 2.7 && speed > 90) {
        const intensity = clamp((g - 2.7) / 4.5, 0, 1);
        this.vapourAcc = Math.min(this.vapourAcc + dt * (8 + intensity * 26), 6);
        while (this.vapourAcc >= 1) {
          this.vapourAcc -= 1;
          for (let i = 0; i < 2; i++) {
            this._tmp
              .copy(this._forward)
              .multiplyScalar(0.5 + Math.random() * 1.5)
              .addScaledVector(this._up, (Math.random() - 0.5) * 0.5);
            this.spawn({
              position: this._wingtips[i],
              velocity: this._tmp,
              life: 0.45 + Math.random() * 0.4,
              size0: 0.35 + Math.random() * 0.3,
              size1: 2.4 + Math.random() * 1.6,
              color: 0xffffff,
              alpha: 0.1 + intensity * 0.2,
              drag: 0.9,
              gravity: 0,
            });
          }
        }
      }
    }

    this._writeBuffers();
  }

  _writeBuffers(force = false) {
    const pos = this.positions;
    const col = this.colors;
    const size = this.sizes;
    const alpha = this.alphas;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      const i3 = i * 3;
      if (!p.active) {
        alpha[i] = 0;
        size[i] = 0;
        pos[i3] = 0;
        pos[i3 + 1] = 0;
        pos[i3 + 2] = 0;
        continue;
      }
      alive++;
      const t = p.age / p.life;
      const fadeIn = clamp(t / 0.04, 0, 1);
      const fadeOut = 1 - Math.pow(t, 2.2);
      const a = p.alpha0 * fadeIn * fadeOut;
      const grow = p.sizeEase === 1 ? 1 - Math.pow(1 - t, 2.2) : Math.pow(t, p.sizeEase);
      const s = lerp(p.size0, p.size1, grow);
      pos[i3] = p.pos.x;
      pos[i3 + 1] = p.pos.y;
      pos[i3 + 2] = p.pos.z;
      col[i3] = p.color.r;
      col[i3 + 1] = p.color.g;
      col[i3 + 2] = p.color.b;
      size[i] = s;
      alpha[i] = a;
    }
    const hadActive = this.activeCount > 0;
    this.activeCount = alive;
    this.points.visible = alive > 0;
    if (alive > 0 || hadActive || force) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }

  burst(position, type = 'water') {
    const fireColors = [0xfff0bb, 0xffbe5c, 0xff7a2e, 0xb94318];
    const waterColors = [0xffffff, 0xc9f6ff, 0x5ee0e6, 0x2a9fb8];
    const smokeColors = [0x33373a, 0x4c4f50, 0x232628];
    for (let i = 0; i < 100; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 1.1 - 0.2,
        Math.random() * 2 - 1
      ).normalize();
      const speed = (type === 'water' ? 8 : 14) + Math.random() * 28;
      const useSmoke = Math.random() > 0.72;
      const palette = type === 'water' ? waterColors : fireColors;
      const color = useSmoke ? smokeColors[i % smokeColors.length] : palette[i % palette.length];
      this.spawn({
        position: this._tmp.copy(position).addScaledVector(dir, Math.random() * 3),
        velocity: dir.multiplyScalar(speed).add(new THREE.Vector3(0, 4, 0)),
        life: (type === 'water' ? 0.8 : 1.4) + Math.random() * 1.8,
        size0: 1.4 + Math.random() * 2.2,
        size1: 9 + Math.random() * 15,
        color,
        alpha: useSmoke ? 0.18 : 0.3,
        drag: 0.9,
        gravity: type === 'water' ? -8 : -4.5,
      });
    }
    // lingering dark plume
    for (let i = 0; i < 22; i++) {
      this.spawn({
        position: position,
        velocity: new THREE.Vector3(Math.random() * 6 - 3, 2 + Math.random() * 5, Math.random() * 6 - 3),
        life: 2.0 + Math.random() * 2.5,
        size0: 2 + Math.random() * 2,
        size1: 16 + Math.random() * 16,
        color: 0x2f3537,
        alpha: 0.16,
        drag: 0.4,
        gravity: 0.3,
      });
    }
    this._writeBuffers();
  }

  getActiveCount() {
    return this.activeCount;
  }
}
