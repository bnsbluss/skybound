import * as THREE from 'three';
import { clamp } from '../utils/math.js';
import { glowTexture } from '../utils/textures.js';

function flameCone(radius, length, color, opacity) {
  const geometry = new THREE.ConeGeometry(radius, length, 8, 1, true);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, length / 2);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 6;
  return mesh;
}

/**
 * Exhaust flame, afterburner shock diamonds and engine light.
 * Everything is parented to the aircraft so it inherits attitude.
 */
export class EngineEffects {
  constructor(quality, options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'engine-effects';
    this.quality = quality;
    this.enableLight = options.enableLight !== false;
    this.time = 0;

    this.anchor = new THREE.Group();
    this.anchor.position.set(0, 0.1, 9.02);
    this.group.add(this.anchor);

    this.outer = flameCone(0.46, 4.8, 0xff5d1f, 0.34);
    this.mid = flameCone(0.29, 3.5, 0xffad4c, 0.55);
    this.core = flameCone(0.15, 2.5, 0x9fe9ff, 0.92);
    this.anchor.add(this.outer, this.mid, this.core);

    const tex = glowTexture();
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color: 0xffc77c,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.glow.position.set(0, 0, 0.2);
    this.glow.scale.setScalar(3.4);
    this.anchor.add(this.glow);

    this.glowBlue = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color: 0x9fe8ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.glowBlue.position.set(0, 0, 2.2);
    this.glowBlue.scale.setScalar(4.0);
    this.anchor.add(this.glowBlue);

    this.shockDiamonds = [];
    const diamondMat = new THREE.MeshBasicMaterial({
      color: 0xbfeaff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (let i = 0; i < 4; i++) {
      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), diamondMat.clone());
      diamond.position.z = 1.1 + i * 0.72;
      diamond.scale.set(0.35, 0.35, 1.0 - i * 0.12);
      diamond.renderOrder = 7;
      this.anchor.add(diamond);
      this.shockDiamonds.push(diamond);
    }

    this.light = new THREE.PointLight(0xff7a32, 2.5, 28, 2);
    this.light.position.set(0, 0.1, 9.4);
    this.light.castShadow = false;
    if (this.enableLight) {
      this.group.add(this.light);
    }
  }

  update(dt, physics) {
    this.time += Number.isFinite(dt) ? dt : 0;
    const ab = Number.isFinite(physics?.afterburner) ? clamp(physics.afterburner, 0, 1) : 0;
    const throttle = Number.isFinite(physics?.throttle) ? clamp(physics.throttle, 0, 1) : 0.65;
    const flicker = 0.9 + Math.sin(this.time * 57.0) * 0.06 + Math.sin(this.time * 31.7) * 0.04;
    const visible = !physics?.crashed;

    this.anchor.visible = visible;
    this.outer.visible = visible;
    this.mid.visible = visible;
    this.core.visible = visible;

    this.outer.scale.set(0.9 + ab * 0.2, 0.9 + ab * 0.2, (0.3 + throttle * 0.25 + ab * 1.5) * flicker);
    this.mid.scale.set(0.8 + ab * 0.1, 0.8 + ab * 0.1, (0.4 + throttle * 0.4 + ab * 1.15) * flicker);
    this.core.scale.set(0.8, 0.8, (0.5 + throttle * 0.25 + ab * 0.55) * flicker);

    this.outer.material.opacity = 0.2 + ab * 0.25 + throttle * 0.08;
    this.mid.material.opacity = 0.3 + ab * 0.35 + throttle * 0.12;
    this.core.material.opacity = 0.55 + throttle * 0.2;

    this.glow.material.opacity = 0.35 + throttle * 0.25 + ab * 0.4;
    this.glow.scale.setScalar(2.6 + ab * 3.1 + throttle * 0.6);
    this.glowBlue.material.opacity = ab * 0.75;
    this.glowBlue.scale.setScalar(3.2 + ab * 3.4);

    for (let i = 0; i < this.shockDiamonds.length; i++) {
      const d = this.shockDiamonds[i];
      d.material.opacity = ab * (0.55 - i * 0.1) * (0.75 + Math.sin(this.time * 70 + i) * 0.15);
      d.visible = ab > 0.05;
      d.position.z = 1.0 + i * 0.8;
      d.scale.z = 0.9 + ab * 0.5;
    }

    this.light.intensity = clamp(2 + throttle * 3 + ab * 26, 0, 40) * (0.94 + Math.sin(this.time * 40) * 0.06);
    this.light.color.setHex(ab > 0.35 ? 0xff8c42 : 0xffb070);
  }
}
