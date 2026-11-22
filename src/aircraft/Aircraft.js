import * as THREE from 'three';
import { AircraftModel } from './AircraftModel.js';
import { EngineEffects } from './EngineEffects.js';
import { shadowTexture } from '../utils/textures.js';
import { clamp } from '../utils/math.js';

export class Aircraft {
  constructor(quality, variant = null, options = {}) {
    this.quality = quality;
    this.root = new THREE.Group();
    this.root.name = 'aircraft-root';

    this.model = new AircraftModel(quality, variant);
    this.root.add(this.model.group);

    this.engineEffects = new EngineEffects(quality, options);
    this.root.add(this.engineEffects.group);

    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        color: 0x06151a,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        toneMapped: false,
        fog: true,
      })
    );
    this.shadow.name = 'aircraft-shadow';
    this.shadow.renderOrder = 2;
    this.shadow.visible = false;

    this.visible = true;
    this.cockpitHidden = false;
    this.time = 0;

    this._local = new THREE.Vector3();
    this._wingtipL = new THREE.Vector3(-7.45, 0.18, 1.7);
    this._wingtipR = new THREE.Vector3(7.45, 0.18, 1.7);
    this._outL = new THREE.Vector3();
    this._outR = new THREE.Vector3();
    this._nozzleLocal = new THREE.Vector3(0, 0.1, 9.35);
    this.variantScale = 1;
    this.setVariant(variant);
  }

  /** Swap livery / proportions for a catalogue airframe. */
  setVariant(variant = null) {
    this.model.applyVariant(variant);
    const scale = variant?.visual?.scale ?? 1;
    this.variantScale = scale;
    this._wingtipL.set(-7.45 * scale, 0.18 * scale, 1.7 * scale);
    this._wingtipR.set(7.45 * scale, 0.18 * scale, 1.7 * scale);
    this._nozzleLocal.set(0, 0.1, 9.35 * scale);
    return this;
  }

  sync(physics) {
    this.root.position.copy(physics.position);
    this.root.quaternion.copy(physics.quaternion);
  }

  setVisible(visible) {
    this.visible = visible;
    this.root.visible = visible;
    this.shadow.visible = false;
  }

  /** Cockpit view hides the airframe so the camera sits "inside" the jet. */
  setCockpitHidden(hidden) {
    this.cockpitHidden = !!hidden;
    this.model.group.visible = !this.cockpitHidden;
    this.engineEffects.group.visible = !this.cockpitHidden;
  }

  updateVisual(dt, physics, input, time, world) {
    this.time = time;
    this.sync(physics);
    this.model.update(dt, physics, input, time);
    this.engineEffects.update(dt, physics);
    this.root.updateMatrixWorld();
    this._updateShadow(physics, world);
  }

  _updateShadow(physics, world) {
    if (!this.visible) {
      this.shadow.visible = false;
      return;
    }
    const ground = world.getHeightAt(physics.position.x, physics.position.z);
    const water = world.getWaveHeightAt
      ? world.getWaveHeightAt(physics.position.x, physics.position.z)
      : 0;
    const surface = Math.max(ground, water + 0.25);
    const agl = Math.max(0, physics.position.y - surface);
    if (agl > 1350) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    this.shadow.position.set(physics.position.x, surface + 0.45, physics.position.z);
    this.shadow.rotation.y = physics.heading;
    const grow = 1 + clamp(agl / 900, 0, 1) * 0.55;
    this.shadow.scale.set(19 * grow * this.variantScale, 1, 24 * grow * this.variantScale);
    this.shadow.material.opacity = 0.34 * clamp(1 - agl / 1400, 0, 1);
  }

  getNozzleWorldPosition(out) {
    return out
      .copy(this._nozzleLocal)
      .applyQuaternion(this.root.quaternion)
      .add(this.root.position);
  }

  getWingtipWorldPositions(outArray) {
    outArray[0]
      .copy(this._wingtipL)
      .applyQuaternion(this.root.quaternion)
      .add(this.root.position);
    outArray[1]
      .copy(this._wingtipR)
      .applyQuaternion(this.root.quaternion)
      .add(this.root.position);
    return outArray;
  }

  getCockpitWorldPosition(out) {
    return out
      .set(0, 1.4, -3.8)
      .applyQuaternion(this.root.quaternion)
      .add(this.root.position);
  }
}
