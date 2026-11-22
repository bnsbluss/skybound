import * as THREE from 'three';
import { clamp, damp, lerp, radToDeg, smoothstep } from '../utils/math.js';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export const SPAWN = {
  position: new THREE.Vector3(-150, 460, 1700),
  heading: THREE.MathUtils.degToRad(-3),
  speed: 176,
};

export const THROTTLE_MIN = 0.15;
export const THROTTLE_MAX = 1;
export const STALL_SPEED = 70;

/**
 * Arcade flight model with real quaternion attitude, coordinated bank turns,
 * energy trading, stall sink and an afterburner reserve.
 *
 * Local aircraft axes: forward = -Z, right = +X, up = +Y.
 */
export class FlightPhysics {
  constructor(options = {}) {
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();

    this.speed = SPAWN.speed;
    this.throttle = 0.68;
    this.boostAmount = 1;
    this.boostReady = true;
    this.boosting = false;
    this.airbrake = false;
    this.boostRequested = false;

    this.rates = { pitch: 0, roll: 0, yaw: 0 };
    this.sinkSpeed = 0;
    this.gForce = 1;
    this.stallFactor = 0;
    this.stalling = false;
    this.bank = 0;
    this.pitch = 0;
    this.heading = 0;
    this.rollDeg = 0;
    this.pitchDeg = 0;
    this.headingDeg = 0;
    this.verticalSpeed = 0;
    this.afterburner = 0;
    this.time = 0;
    this.turnRate = 0;
    this.controlAuthority = 1;

    this._prevY = this.position.y;
    this._sinkTarget = 0;

    // Catalogue flight stats: multipliers around 1.0 plus the hull pool.
    this.stats = { speed: 1, turn: 1, boost: 1, hull: 100 };

    this.reset();
  }

  /**
   * Apply an airframe's catalogue stats. Values are clamped to sane bands so
   * a bad save file can never turn the sim into an unflyable brick.
   * @param {{speed?:number,turn?:number,boost?:number,hull?:number}} stats
   */
  setStats(stats = {}) {
    this.stats.speed = clamp(stats.speed ?? 1, 0.6, 1.6);
    this.stats.turn = clamp(stats.turn ?? 1, 0.6, 1.6);
    this.stats.boost = clamp(stats.boost ?? 1, 0.6, 1.6);
    this.stats.hull = clamp(stats.hull ?? 100, 40, 400);
    return this.stats;
  }

  reset(spawn = SPAWN) {
    this.position.copy(spawn.position);
    this.heading = spawn.heading ?? 0;
    this.quaternion.setFromAxisAngle(Y_AXIS, this.heading);
    this.speed = spawn.speed ?? SPAWN.speed;
    this.throttle = 0.68;
    this.boostAmount = 1;
    this.boostReady = true;
    this.boosting = false;
    this.airbrake = false;
    this.boostRequested = false;
    this.rates.pitch = this.rates.roll = this.rates.yaw = 0;
    this.sinkSpeed = 0;
    this.gForce = 1;
    this.stallFactor = 0;
    this.stalling = false;
    this.bank = 0;
    this.pitch = 0;
    this.rollDeg = 0;
    this.pitchDeg = 0;
    this.turnRate = 0;
    this.afterburner = 0;
    this.time = 0;
    this._prevY = this.position.y;
    this.updateDerived(0);
    this.velocity.copy(_forward).multiplyScalar(this.speed);
  }

  /**
   * @param {number} dt seconds
   * @param {{pitch:number,roll:number,yaw:number,boost:boolean,brake:boolean,throttle:number}} input
   */
  update(dt, input) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    const throttle = clamp(
      input.throttle ?? this.throttle,
      THROTTLE_MIN,
      THROTTLE_MAX
    );
    this.throttle = throttle;
    this.airbrake = !!input.brake;

    // ---- Afterburner reserve (longer burn + faster aircraft-scaled recharge) ----
    const boostStat = clamp(this.stats.boost || 1, 0.6, 1.6);
    this.boostRequested = !!input.boost;
    if (this.boostAmount <= 0.001) {
      this.boostReady = false;
    } else if (this.boostAmount > 0.14) {
      this.boostReady = true;
    }

    const wantBoost =
      this.boostRequested &&
      this.boostReady &&
      this.boostAmount > 0.001 &&
      !this.airbrake &&
      this.speed > 52;

    this.boosting = wantBoost;
    if (this.boosting) {
      // Slower drain scaled by aircraft boost rating (~8.7 s stock, ~11.8 s on Elite jets).
      const drainRate = 0.115 / Math.pow(boostStat, 0.7);
      this.boostAmount = Math.max(0, this.boostAmount - dt * drainRate);
    } else {
      // Fast recovery scaled directly by each aircraft's boost stat (~2.7–5.5 s full).
      const rechargeRate = 0.22 * Math.pow(boostStat, 1.15);
      this.boostAmount = Math.min(1, this.boostAmount + dt * rechargeRate);
    }
    this.afterburner = damp(this.afterburner, this.boosting ? 1 : 0, 7, dt);

    // ---- Attitude vectors ---------------------------------------------------
    _forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.bank = Math.atan2(_right.y, Math.max(0.0001, _up.y));

    // Neutral roll softly levels the wings, which keeps the jet friendly on
    // touch screens without fighting an intentional aileron input.
    let rollInput = clamp(input.roll || 0, -1, 1);
    if (Math.abs(rollInput) < 0.04) {
      rollInput = clamp(-_right.y * 0.9, -1, 1) * 0.65;
    }

    // ---- Control authority & rates ----------------------------------------
    this.stallFactor = clamp((STALL_SPEED + 24 - this.speed) / 40, 0, 1);
    this.stalling = this.stallFactor > 0.35;
    const authority =
      clamp(this.speed / 135, 0.22, 1.15) * (1 - this.stallFactor * 0.55);
    this.controlAuthority = authority;

    const targetPitch = clamp(input.pitch || 0, -1, 1) * 1.12 * authority * this.stats.turn;
    const targetRoll = rollInput * 2.55 * authority * this.stats.turn;
    const targetYaw = clamp(input.yaw || 0, -1, 1) * 0.72 * authority * this.stats.turn;

    this.rates.pitch = damp(this.rates.pitch, targetPitch, 8.5, dt);
    this.rates.roll = damp(this.rates.roll, targetRoll, 9.5, dt);
    this.rates.yaw = damp(this.rates.yaw, targetYaw, 7.5, dt);

    // ---- Coordinated bank turn --------------------------------------------
    const bankTurn =
      _right.y * 0.62 * clamp(this.speed / 150, 0.35, 1.25) * this.stats.turn;
    this.turnRate = bankTurn;
    _qYaw.setFromAxisAngle(Y_AXIS, bankTurn * dt);
    this.quaternion.premultiply(_qYaw);

    // ---- Local rotations ---------------------------------------------------
    _qPitch.setFromAxisAngle(X_AXIS, this.rates.pitch * dt);
    _qYaw.setFromAxisAngle(Y_AXIS, this.rates.yaw * dt);
    _qRoll.setFromAxisAngle(Z_AXIS, this.rates.roll * dt);
    this.quaternion.multiply(_qPitch).multiply(_qYaw).multiply(_qRoll).normalize();

    // ---- Airspeed / energy -------------------------------------------------
    _forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const climb = _forward.y;
    let target =
      (82 + throttle * 152) *
      (this.boosting ? 1 + 0.34 * this.stats.boost : 1) *
      (this.airbrake ? 0.48 : 1);
    target -= climb * 86;
    target += this.boosting ? 22 * this.stats.boost : 0;
    target = clamp(target, 36, 362) * this.stats.speed;

    const accelLambda = this.boosting ? 1.55 : this.airbrake ? 1.65 : 0.72;
    this.speed = damp(this.speed, target, accelLambda, dt);
    if (this.airbrake) this.speed *= Math.exp(-0.16 * dt);
    this.speed = clamp(this.speed, 30, 370 * this.stats.speed);

    // ---- Vertical lift budget ---------------------------------------------
    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    const lift = clamp((this.speed - 42) / 96, 0, 1);
    const bankLiftLoss = 1 - clamp(Math.abs(_up.y), 0, 1);
    this._sinkTarget =
      (1 - lift) * 30 + bankLiftLoss * this.speed * 0.032 + this.stallFactor * 6;
    this.sinkSpeed = damp(this.sinkSpeed, this._sinkTarget, 2.2, dt);

    // Gentle buffet at the edge of the envelope.
    const buffet = this.stalling ? Math.sin(this.time * 24) * 0.05 * this.stallFactor : 0;
    _q.setFromAxisAngle(Z_AXIS, buffet * dt * 4);
    this.quaternion.multiply(_q).normalize();

    // ---- Integrate ---------------------------------------------------------
    this._prevY = this.position.y;
    this.velocity.copy(_forward).multiplyScalar(this.speed);
    this.velocity.y -= this.sinkSpeed;

    this.position.addScaledVector(this.velocity, dt);

    if (this.position.y > 5200) {
      this.position.y = 5200;
      this.velocity.y = Math.min(0, this.velocity.y);
      if (_forward.y > 0) {
        _qPitch.setFromAxisAngle(X_AXIS, -Math.min(0.8, _forward.y * 1.2) * dt);
        this.quaternion.multiply(_qPitch).normalize();
      }
    }

    // ---- Derived readouts --------------------------------------------------
    _right.set(1, 0, 0).applyQuaternion(this.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.bank = Math.atan2(_right.y, Math.max(0.0001, _up.y));
    this.pitch = Math.asin(clamp(_forward.y, -1, 1));
    this.heading = Math.atan2(_forward.x, -_forward.z);
    this.rollDeg = radToDeg(this.bank);
    this.pitchDeg = radToDeg(this.pitch);
    this.headingDeg = ((radToDeg(this.heading) % 360) + 360) % 360;
    this.verticalSpeed = (this.position.y - this._prevY) / dt;

    const gTarget =
      1 +
      (Math.abs(this.rates.pitch) * this.speed) / 9.81 * 0.2 +
      (Math.sin(Math.abs(this.bank)) * this.speed) / 9.81 * 0.05 +
      (this.boosting ? 0.35 : 0);
    this.gForce = damp(this.gForce, clamp(gTarget, 0.1, 11), 4.2, dt);
  }

  /** Menu autopilot: a slow, wide, banked orbit for the title screen. */
  menuInput(t) {
    return {
      pitch: Math.sin(t * 0.23) * 0.05,
      roll: Math.sin(t * 0.19) * 0.2,
      yaw: 0,
      boost: false,
      brake: false,
      throttle: 0.52,
    };
  }

  updateDerived() {
    _forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.pitch = Math.asin(clamp(_forward.y, -1, 1));
    this.bank = Math.atan2(_right.y, Math.max(0.0001, _up.y));
    this.heading = Math.atan2(_forward.x, -_forward.z);
    this.rollDeg = radToDeg(this.bank);
    this.pitchDeg = radToDeg(this.pitch);
    this.headingDeg = ((radToDeg(this.heading) % 360) + 360) % 360;
  }

  getForward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  getRight(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  getUp(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  getTelemetry() {
    return {
      speed: this.speed,
      speedKts: this.speed * 1.94384,
      speedKph: this.speed * 3.6,
      throttle: this.throttle,
      boost: this.boostAmount,
      boosting: this.boosting,
      boostReady: this.boostReady,
      airbrake: this.airbrake,
      altitude: this.position.y,
      heading: this.headingDeg,
      pitch: this.pitchDeg,
      roll: this.rollDeg,
      gForce: this.gForce,
      stalling: this.stalling,
      stallFactor: this.stallFactor,
      verticalSpeed: this.verticalSpeed,
      afterburner: this.afterburner,
      speedMach: this.speed / 343,
    };
  }
}
