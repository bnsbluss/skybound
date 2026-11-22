import * as THREE from 'three';
import { clamp, damp, lerp } from '../utils/math.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _target = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _lockDir = new THREE.Vector3();

/**
 * Smooth third-person chase camera with mouse orbit, speed FOV, buffeting,
 * crash shake and terrain/ocean collision avoidance.
 *
 * Three selectable views are supported: the default CHASE, a top-down
 * OVERHEAD view and a forward-locked COCKPIT view. An optional auto-lock
 * target swings the chase camera around so the bandit stays framed.
 */
export class ChaseCamera {
  constructor(camera, quality) {
    this.camera = camera;
    this.quality = quality;
    this.mode = 'chase';
    this.time = 0;

    this.baseDistance = 29;
    this.distance = 29;
    this.distanceTarget = 29;
    this.minDistance = 16;
    this.maxDistance = 58;
    this.baseElevation = 0.21;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.orbitIdle = 10;
    this.lookSensitivity = 1;
    this.autoTarget = null;

    this.fov = 62;
    this.fovTarget = 62;
    this.shake = 0;
    this.crashShake = 0;

    this.position = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.viewMode = 0;
    this.viewPreset = 0;
    this._cockpitBlend = 0;
    this._snapNext = false;
    this._initialized = false;
    this._intro = 0;

    this.cinematicAngle = 2.15;
    this._cinematicPos = new THREE.Vector3();
    this._cinematicTarget = new THREE.Vector3();
    this._last = new THREE.Vector3();
    this._lookAhead = 24;
  }

  /** View ids: 0 = CHASE, 1 = COCKPIT. */
  static VIEW_NAMES = ['CHASE', 'COCKPIT'];

  snapTo(physics) {
    this.camera.position.copy(physics.position);
    this.camera.position.y += 8;
    this.camera.position.z += 30;
    this.camera.lookAt(physics.position);
    this.position.copy(this.camera.position);
    this.lookTarget.copy(physics.position);
    this.up.copy(WORLD_UP);
    this._cockpitBlend = 0;
    this._initialized = true;
  }

  applyLook(delta) {
    if (!delta) return;
    // Cockpit view is deliberately fixed forward: mouse movement must never
    // turn the pilot's head away from the nose.
    if (this.viewMode === 1) {
      this.orbitYaw = 0;
      this.orbitPitch = 0;
      return;
    }
    const yawLimit = 2.7;
    const pitchLimit = 0.75;
    this.orbitYaw = clamp(this.orbitYaw + delta.x * 0.8, -yawLimit, yawLimit);
    this.orbitPitch = clamp(this.orbitPitch + delta.y * 0.55, -pitchLimit, pitchLimit);
    this.orbitIdle = 0;
    if (delta.zoom) {
      this.distanceTarget = clamp(this.distanceTarget + delta.zoom * 14, this.minDistance, this.maxDistance);
    }
  }

  /** Auto-lock target (anything with a `position`) or null to release. */
  setAutoTarget(target) {
    this.autoTarget = target && target.position ? target : null;
  }

  /** Resets chase camera orbit, zoom, and auto-lock back behind the aircraft (`R`). */
  resetOrbit() {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.orbitIdle = 0;
    this.distanceTarget = this.viewMode === 1 ? 0 : this.baseDistance;
    this.distance = this.distanceTarget;
    this.autoTarget = null;
    this._snapNext = true;
  }

  cycleView() {
    this.viewMode = (this.viewMode + 1) % 2;
    this.viewPreset = this.viewMode;
    this.distanceTarget = [29, 0][this.viewMode];
    this.distance = this.distanceTarget;
    this.orbitIdle = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this._cockpitBlend = this.viewMode === 1 ? 1 : 0;
    this._snapNext = true;
    return this.viewMode;
  }

  setView(mode) {
    this.viewMode = ((mode % 2) + 2) % 2;
    this.viewPreset = this.viewMode;
    this.distanceTarget = [29, 0][this.viewMode];
    this.distance = this.distanceTarget;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this._cockpitBlend = this.viewMode === 1 ? 1 : 0;
    this._snapNext = true;
    return this.viewMode;
  }

  setCinematic(cinematic) {
    this.mode = cinematic ? 'cinematic' : 'chase';
    if (!cinematic) {
      this._intro = 1;
      this._cockpitBlend = 0;
    }
  }

  addCrashShake(amount = 1) {
    this.crashShake = Math.max(this.crashShake, amount);
  }

  update(dt, physics, world) {
    this.time += dt;
    this.orbitIdle += dt;
    this.crashShake = damp(this.crashShake, 0, 1.6, dt);

    if (this.mode === 'cinematic') {
      this._updateCinematic(dt, physics, world);
      return;
    }

    _forward.set(0, 0, -1).applyQuaternion(physics.quaternion);
    _up.set(0, 1, 0).applyQuaternion(physics.quaternion);

    if (this.viewMode === 1) {
      this._updateCockpit(dt, physics, world);
      return;
    }

    // Ease the camera back behind the aircraft after the player stops looking.
    if (this.orbitIdle > 2.1) {
      const recenter = 1.5 * clamp((this.orbitIdle - 2.1) / 1.6, 0, 1);
      this.orbitYaw = damp(this.orbitYaw, 0, recenter, dt);
      this.orbitPitch = damp(this.orbitPitch, 0, recenter, dt);
    }

    this._intro = damp(this._intro, 0, 1.6, dt);
    this.distance = damp(this.distance, this.distanceTarget, 4.5, dt);

    const speedFactor = clamp((physics.speed - 55) / 260, 0, 1);
    const boostFactor = clamp(physics.afterburner, 0, 1);
    const distance = this.distance + speedFactor * 4.5 + boostFactor * 3.5 + this._intro * 34;
    const lockPos = this.autoTarget?.position ?? null;

    if (lockPos) {
      // Auto-lock view: park the camera on the opposite side of the jet from
      // the target and keep the target centred, so the bandit is always in
      // frame even when it is not straight ahead.
      _lockDir.subVectors(lockPos, physics.position);
      const lockDistance = _lockDir.length();
      if (lockDistance > 1) {
        _lockDir.divideScalar(lockDistance);
        _desired
          .copy(physics.position)
          .addScaledVector(_lockDir, -distance * 0.92)
          .addScaledVector(WORLD_UP, distance * 0.18 + 2.6);
        _target.copy(lockPos);
      } else {
        _desired.copy(physics.position).addScaledVector(_forward, -distance);
        _target.copy(lockPos);
      }
    } else {
      const elev = this.baseElevation + this.orbitPitch;
      const yaw = this.orbitYaw;
      const cosE = Math.cos(elev);
      _offset.set(
        Math.sin(yaw) * cosE * distance,
        Math.sin(elev) * distance + 2.6,
        Math.cos(yaw) * cosE * distance
      );
      _offset.applyQuaternion(physics.quaternion);
      _desired.copy(physics.position).add(_offset);

      // Look ahead of the nose for speed and intent, or at the jet when orbiting.
      const lookAhead =
        this._lookAhead *
        (1 - Math.min(1, Math.abs(this.orbitYaw) * 0.6)) *
        (1 - this._intro * 0.6);
      _target.copy(physics.position).addScaledVector(_forward, lookAhead).addScaledVector(_up, 2.2);
      if (Math.abs(this.orbitYaw) > 0.4) {
        _target.lerp(physics.position, clamp((Math.abs(this.orbitYaw) - 0.4) / 2.0, 0, 0.75));
      }
    }

    // Pull camera in if the line of sight would cut through terrain.
    this._resolveCollision(physics, world, _desired);

    if (!this._initialized || this._snapNext) {
      this.position.copy(_desired);
      this.lookTarget.copy(_target);
      this.up.copy(WORLD_UP);
      this._initialized = true;
    }

    const posLambda = 5.4 - speedFactor * 1.2;
    const targetLambda = 8.5;
    if (!this._snapNext) {
      this.position.lerp(_desired, 1 - Math.exp(-posLambda * dt));
      this.lookTarget.lerp(_target, 1 - Math.exp(-targetLambda * dt));
    }

    // Camera body follows a fraction of the jet's roll for dynamism; auto-lock
    // leans on world-up so a turning target does not roll the horizon.
    const upWeight = lockPos ? 0.08 : 0.32 + boostFactor * 0.12;
    _probe.copy(WORLD_UP).lerp(_up, upWeight).normalize();
    if (this._snapNext) this.up.copy(_probe);
    else this.up.lerp(_probe, 1 - Math.exp(-4.5 * dt)).normalize();

    // Keep the smoothed camera from ending up inside terrain.
    const surface = world.getHeightAt(this.position.x, this.position.z);
    const water = world.getWaveHeightAt
      ? world.getWaveHeightAt(this.position.x, this.position.z)
      : 0;
    const floor = Math.max(surface, water) + 3.0;
    if (this.position.y < floor) this.position.y = floor;

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.lookTarget);

    // Shake: engine buzz, speed buffet, near-ground turbulence, impacts.
    const nearGround = clamp(1 - (physics.position.y - surface) / 260, 0, 1);
    const buffet = physics.stalling ? 0.22 : 0;
    this.shake = damp(
      this.shake,
      boostFactor * 0.11 + speedFactor * 0.025 + nearGround * 0.045 + buffet + this.crashShake,
      7,
      dt
    );
    if (this.shake > 0.0005) this._applyShakeTransforms();

    // FOV opens with speed and afterburner.
    this.fovTarget = 60 + speedFactor * 8 + boostFactor * 7 + this.crashShake * -4;
    if (this._snapNext) {
      this.fov = this.fovTarget;
      this._snapNext = false;
    } else {
      this.fov = damp(this.fov, this.fovTarget, 3.5, dt);
    }
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _applyShakeTransforms() {
    const t = this.time;
    const shakeX = (Math.sin(t * 47.3) + Math.sin(t * 29.1) * 0.5) * this.shake * 0.55;
    const shakeY = (Math.sin(t * 39.7 + 1.2) + Math.sin(t * 61.3) * 0.4) * this.shake * 0.45;
    const shakeZ = Math.sin(t * 33.3 + 2.1) * this.shake * 0.3;
    this.camera.translateX(shakeX);
    this.camera.translateY(shakeY);
    this.camera.translateZ(shakeZ);
    this.camera.rotateZ(Math.sin(t * 21.2) * this.shake * 0.012);
  }

  /**
   * Top-down tactical view. The camera hangs above the jet looking straight
   * down with the nose pointing to the top of the screen, so the world spins
   * around the aircraft like a classic overhead shooter.
   */
  _updateOverhead(dt, physics, world) {
    const speedFactor = clamp((physics.speed - 55) / 260, 0, 1);
    const boostFactor = clamp(physics.afterburner, 0, 1);
    const distance = this.distanceTarget + speedFactor * 16;

    _desired.copy(physics.position).addScaledVector(_up, distance);
    _target.copy(physics.position).addScaledVector(_forward, 4).addScaledVector(_up, 1.2);

    // Screen-up = aircraft nose (the component of forward perpendicular to the
    // view axis), which keeps the jet upright while the ground rotates.
    _probe.copy(_forward).addScaledVector(_up, -_forward.dot(_up));
    if (_probe.lengthSq() < 1e-6) _probe.set(0, 0, -1);
    _probe.normalize();

    const surface = Math.max(
      world.getHeightAt(_desired.x, _desired.z),
      world.getWaveHeightAt ? world.getWaveHeightAt(_desired.x, _desired.z) : 0
    );
    if (_desired.y < surface + 8) _desired.y = surface + 8;

    if (!this._initialized) {
      this.position.copy(_desired);
      this.lookTarget.copy(_target);
      this.up.copy(_probe);
      this._initialized = true;
    }

    this.position.lerp(_desired, 1 - Math.exp(-7 * dt));
    this.lookTarget.lerp(_target, 1 - Math.exp(-9 * dt));
    this.up.lerp(_probe, 1 - Math.exp(-7 * dt)).normalize();

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.lookTarget);

    const nearGround = clamp(1 - (physics.position.y - surface) / 260, 0, 1);
    this.shake = damp(
      this.shake,
      boostFactor * 0.05 + speedFactor * 0.02 + nearGround * 0.03 + this.crashShake * 0.7,
      7,
      dt
    );
    if (this.shake > 0.0005) this._applyShakeTransforms();

    this.fovTarget = 56 + speedFactor * 7 + boostFactor * 5;
    this.fov = damp(this.fov, this.fovTarget, 3.5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * First-person view rigidly locked to the pilot seat and facing straight ahead.
   * Snaps cleanly on view switch so the camera never flies through the airframe
   * or flips backwards looking at `physics.position`.
   */
  _updateCockpit(dt, physics, world) {
    const speedFactor = clamp((physics.speed - 55) / 260, 0, 1);
    const boostFactor = clamp(physics.afterburner, 0, 1);

    _desired
      .copy(physics.position)
      .addScaledVector(_forward, 1.4)
      .addScaledVector(_up, 1.15);

    const surface = Math.max(
      world.getHeightAt(_desired.x, _desired.z),
      world.getWaveHeightAt ? world.getWaveHeightAt(_desired.x, _desired.z) : 0
    );
    if (_desired.y < surface + 1.4) _desired.y = surface + 1.4;

    // The cockpit never free-looks; any leftover orbit offset is discarded.
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this._cockpitBlend = 1;

    this.position.copy(_desired);
    this.lookTarget.copy(_desired).addScaledVector(_forward, 40);
    this.up.copy(_up);
    this._initialized = true;

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.up);
    this.camera.quaternion.copy(physics.quaternion);

    const nearGround = clamp(1 - (physics.position.y - surface) / 260, 0, 1);
    this.shake = damp(
      this.shake,
      boostFactor * 0.07 + speedFactor * 0.025 + nearGround * 0.04 + this.crashShake * 0.65,
      7,
      dt
    );
    if (this.shake > 0.0005) this._applyShakeTransforms();

    // Clean, undistorted cockpit FOV so instruments and pilot hands stay crisp.
    this.fovTarget = 64 + speedFactor * 4 + boostFactor * 3;
    if (this._snapNext) {
      this.fov = this.fovTarget;
      this._snapNext = false;
    } else {
      this.fov = damp(this.fov, this.fovTarget, 4.5, dt);
    }
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _resolveCollision(physics, world, desired) {
    const steps = 7;
    let blockedAt = 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      _probe.lerpVectors(physics.position, desired, t);
      const terrain = world.getHeightAt(_probe.x, _probe.z);
      const water = world.getWaveHeightAt ? world.getWaveHeightAt(_probe.x, _probe.z) : 0;
      const floor = Math.max(terrain, water) + 2.2;
      if (_probe.y < floor) {
        blockedAt = Math.max(0.18, t - 0.12);
        break;
      }
    }
    if (blockedAt < 1) {
      desired.lerpVectors(physics.position, desired, blockedAt);
      desired.y += 2.4 * (1 - blockedAt);
    }

    const terrain = world.getHeightAt(desired.x, desired.z);
    const water = world.getWaveHeightAt ? world.getWaveHeightAt(desired.x, desired.z) : 0;
    const floor = Math.max(terrain, water) + 3.0;
    if (desired.y < floor) desired.y = floor;
  }

  _updateCinematic(dt, physics, world) {
    this.cinematicAngle += dt * 0.075;
    const radius = 36 + Math.sin(this.time * 0.14) * 7;
    const height = 7 + Math.sin(this.time * 0.19) * 4;
    this._cinematicPos.set(
      physics.position.x + Math.sin(this.cinematicAngle) * radius,
      physics.position.y + height,
      physics.position.z + Math.cos(this.cinematicAngle) * radius
    );

    const surface = world.getHeightAt(this._cinematicPos.x, this._cinematicPos.z);
    const floor = Math.max(surface, 2.5) + 4;
    if (this._cinematicPos.y < floor) this._cinematicPos.y = floor;

    _forward.set(0, 0, -1).applyQuaternion(physics.quaternion);
    this._cinematicTarget.copy(physics.position).addScaledVector(_forward, 3.5);
    this._cinematicTarget.y += 1.2;

    if (!this._initialized) {
      this.position.copy(this._cinematicPos);
      this.lookTarget.copy(this._cinematicTarget);
      this.up.copy(WORLD_UP);
      this._initialized = true;
    }

    this.position.lerp(this._cinematicPos, 1 - Math.exp(-3.2 * dt));
    this.lookTarget.lerp(this._cinematicTarget, 1 - Math.exp(-4.2 * dt));
    this.up.lerp(WORLD_UP, 1 - Math.exp(-3 * dt)).normalize();

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.lookTarget);
    this.fovTarget = 52;
    this.fov = damp(this.fov, this.fovTarget, 2, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
