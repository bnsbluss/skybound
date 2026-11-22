import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (420.0 / max(1.0, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 delta = gl_PointCoord - 0.5;
    float r = dot(delta, delta);
    if (r > 0.25) discard;
    float a = smoothstep(0.25, 0.02, r) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

const _dir = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Pooled fireball/spark/smoke bursts for missile hits, mid-air kills and
 * cannon impacts. One draw call, additive blending, fixed capacity.
 */
export class ExplosionSystem {
  constructor(quality = {}) {
    this.capacity = Math.max(60, quality.particleCapacity ?? 320);
    this.particles = [];
    this.time = 0;

    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.alphas = new Float32Array(this.capacity);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'explosions';
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;

    for (let i = 0; i < this.capacity; i++) {
      this.particles.push({
        active: false,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        drag: 1,
        gravity: 0,
        r: 1, g: 1, b: 1,
        r0: 1, g0: 1, b0: 1,
        r1: 1, g1: 1, b1: 1,
        alpha0: 1,
      });
    }
    this.activeCount = 0;
  }

  _spawn(x, y, z, options) {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = options.vx;
      p.vy = options.vy;
      p.vz = options.vz;
      p.life = 0;
      p.maxLife = options.maxLife;
      p.size = options.size;
      p.drag = options.drag;
      p.gravity = options.gravity;
      p.r0 = options.r0; p.g0 = options.g0; p.b0 = options.b0;
      p.r1 = options.r1; p.g1 = options.g1; p.b1 = options.b1;
      p.alpha0 = options.alpha0;
      return p;
    }
    return null;
  }

  /**
   * Fireball: fast incandescent sparks, a few slower debris chunks and a
   * rising smoke plume. `scale` sizes the whole burst.
   */
  burst(position, scale = 1, tint = 0xffb14a) {
    const sparks = Math.round(16 * scale);
    const smoke = Math.round(10 * scale);
    _color.setHex(tint);

    for (let i = 0; i < sparks; i++) {
      _dir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 1, 0);
      _dir.normalize();
      const speed = (16 + Math.random() * 46) * scale;
      this._spawn(position.x, position.y, position.z, {
        vx: _dir.x * speed,
        vy: _dir.y * speed + 6,
        vz: _dir.z * speed,
        maxLife: 0.5 + Math.random() * 0.7,
        size: (7 + Math.random() * 9) * scale,
        drag: 1.7,
        gravity: -22,
        r0: 1, g0: 0.94 - Math.random() * 0.15, b0: 0.62,
        r1: _color.r, g1: _color.g * 0.42, b1: _color.b * 0.14,
        alpha0: 1,
      });
    }

    for (let i = 0; i < smoke; i++) {
      _dir.set(Math.random() * 2 - 1, Math.random() * 1.4, Math.random() * 2 - 1).normalize();
      const speed = (4 + Math.random() * 12) * scale;
      this._spawn(position.x, position.y, position.z, {
        vx: _dir.x * speed,
        vy: _dir.y * speed + 5,
        vz: _dir.z * speed,
        maxLife: 1.4 + Math.random() * 1.6,
        size: (14 + Math.random() * 16) * scale,
        drag: 1.15,
        gravity: 2.5,
        r0: 0.42, g0: 0.4, b0: 0.42,
        r1: 0.14, g1: 0.14, b1: 0.17,
        alpha0: 0.5,
      });
    }
  }

  /** Small bright puff for cannon hits on metal or terrain. */
  spark(position, scale = 1) {
    const count = Math.round(6 * scale);
    for (let i = 0; i < count; i++) {
      _dir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const speed = 10 + Math.random() * 26;
      this._spawn(position.x, position.y, position.z, {
        vx: _dir.x * speed,
        vy: _dir.y * speed + 3,
        vz: _dir.z * speed,
        maxLife: 0.25 + Math.random() * 0.35,
        size: 5 + Math.random() * 6,
        drag: 2.4,
        gravity: -14,
        r0: 1, g0: 1, b0: 0.86,
        r1: 1, g1: 0.55, b1: 0.18,
        alpha0: 1,
      });
    }
  }

  /** Continuous smoke for a damaged, trailing aircraft. */
  trailSmoke(position, velocity, scale = 1) {
    _dir.set(
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5
    );
    this._spawn(position.x, position.y, position.z, {
      vx: (velocity?.x ?? 0) * 0.35 + _dir.x,
      vy: (velocity?.y ?? 0) * 0.35 + _dir.y + 1.5,
      vz: (velocity?.z ?? 0) * 0.35 + _dir.z,
      maxLife: 1.1 + Math.random() * 0.8,
      size: (9 + Math.random() * 8) * scale,
      drag: 1.4,
      gravity: 1.5,
      r0: 0.5, g0: 0.5, b0: 0.52,
      r1: 0.2, g1: 0.2, b1: 0.22,
      alpha0: 0.55,
    });
  }

  update(dt) {
    this.time += dt;
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        continue;
      }
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const t = p.life / p.maxLife;
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      this.positions[count * 3] = p.x;
      this.positions[count * 3 + 1] = p.y;
      this.positions[count * 3 + 2] = p.z;
      this.colors[count * 3] = p.r0 + (p.r1 - p.r0) * t;
      this.colors[count * 3 + 1] = p.g0 + (p.g1 - p.g0) * t;
      this.colors[count * 3 + 2] = p.b0 + (p.b1 - p.b0) * t;
      this.sizes[count] = p.size * (1 + t * 0.7);
      this.alphas[count] = Math.max(0, fade) * p.alpha0;
      count++;
    }

    this.activeCount = count;
    this.geometry.setDrawRange(0, count);
    if (count > 0) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }
    this.points.visible = count > 0;
  }

  clear() {
    for (const p of this.particles) p.active = false;
    this.activeCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  getActiveCount() {
    return this.activeCount;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
