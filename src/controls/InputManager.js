import * as THREE from 'three';
import { clamp, damp } from '../utils/math.js';

/** Default rebindable bindings: action → KeyboardEvent.code. */
export const DEFAULT_BINDINGS = {
  pitchDown: 'KeyW',
  pitchUp: 'KeyS',
  rollLeft: 'KeyA',
  rollRight: 'KeyD',
  yawLeft: 'KeyQ',
  yawRight: 'KeyE',
  throttleUp: 'KeyX',
  throttleDown: 'KeyZ',
  boost: 'ShiftLeft',
  brake: 'Space',
  fire: 'KeyF',
  missile: 'KeyG',
  flare: 'KeyV',
  camera: 'KeyC',
  autolock: 'KeyL',
  pause: 'KeyP',
  mute: 'KeyM',
  help: 'KeyH',
};

/**
 * Fixed aliases that always work next to the rebindable map (they double as
 * the documented defaults for arrows / right shift / escape).
 */
const FIXED_ALIASES = {
  ArrowUp: 'pitchDown',
  ArrowDown: 'pitchUp',
  ArrowLeft: 'rollLeft',
  ArrowRight: 'rollRight',
  ShiftRight: 'boost',
  Escape: 'pause',
};

/** Human-readable label for a KeyboardEvent.code (menu + help card). */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  const special = {
    Space: 'SPACE',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'ESC',
    Enter: 'ENTER',
    Tab: 'TAB',
    Backspace: 'BKSP',
    CapsLock: 'CAPS',
  };
  return special[code] ?? code.toUpperCase();
}

/**
 * Maps a tilt delta in degrees to a -1..1 command: dead zone around neutral,
 * full deflection once `span` degrees past the dead zone.
 */
function tiltCurve(delta, dead, span) {
  const m = Math.abs(delta) - dead;
  if (m <= 0) return 0;
  return clamp((Math.sign(delta) * m) / span, -1, 1);
}

/**
 * Collects keyboard + pointer input, smooths keyboard axes into analogue
 * values and exposes a single flight-input snapshot for the physics model.
 */
export class InputManager {
  constructor({ touch = false } = {}) {
    this.touch = touch;
    this.enabled = false;
    this.keys = new Set();
    this.actions = [];

    // Rebindable keymap (action → code) + steering sensitivity. Both persist
    // per device through the Setting screen.
    this.bindings = { ...DEFAULT_BINDINGS };
    this.sensitivityScale = 1;
    this._loadSettings();
    this._rebuildActionMap();

    this.keyTarget = { pitch: 0, roll: 0, yaw: 0 };
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.throttle = 0.68;
    this.boost = false;
    this.brake = false;

    this.mobile = {
      pitch: 0,
      roll: 0,
      yaw: 0,
      throttle: 0.68,
      throttleActive: false,
      boost: false,
      brake: false,
      fire: false,
      missile: false,
      flare: false,
    };

    // Continuous cannon trigger (keyboard F, LMB, mobile FIRE) plus an
    // edge-triggered missile / flare queue so one press = one release.
    this.fireHeld = false;
    this.pointerFire = false;
    this.missileRequests = 0;
    this.flareRequests = 0;

    // Gyroscope ("giro") steering: tilt the phone like a yoke. Offsets are
    // captured on enable so the holding position becomes neutral.
    const DOE =
      typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
    this.gyro = {
      enabled: false,
      supported: !!DOE,
      needsPermission: typeof DOE?.requestPermission === 'function',
      offsetBeta: null,
      offsetGamma: null,
      pitch: 0,
      roll: 0,
    };
    this._onDeviceOrientation = this._onDeviceOrientation.bind(this);
    // Rotating the phone re-axes the sensor frame, so neutral is re-zoned.
    this._onOrientationChange = () => {
      if (this.gyro.enabled) this.recalibrateGyro();
    };
    this._boundScreenOrientation = null;

    this.lookDelta = new THREE.Vector2();
    this.zoomDelta = 0;
    this.dragging = false;
    this.pointerId = null;
    this.lastPointer = new THREE.Vector2();
    this.baseSensitivity = touch ? 3.2 : 2.0;
    this.sensitivity = this.baseSensitivity * this.sensitivityScale;
    this.canvas = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  dispose() {
    this.disableGyro();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this._onPointerDown);
      this.canvas.removeEventListener('wheel', this._onWheel);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clearKeys();
  }

  // --- Keymap + sensitivity persistence ------------------------------------

  _loadSettings() {
    try {
      const raw = window.localStorage.getItem('skybound.keys');
      if (raw) {
        const saved = JSON.parse(raw);
        for (const action of Object.keys(DEFAULT_BINDINGS)) {
          if (typeof saved[action] === 'string' && saved[action]) {
            this.bindings[action] = saved[action];
          }
        }
      }
      const sens = Number(window.localStorage.getItem('skybound.sens'));
      if (Number.isFinite(sens) && sens >= 0.4 && sens <= 2.5) {
        this.sensitivityScale = sens;
      }
    } catch {
      /* ignore corrupt saves */
    }
  }

  _persistSettings() {
    try {
      window.localStorage.setItem('skybound.keys', JSON.stringify(this.bindings));
      window.localStorage.setItem('skybound.sens', String(this.sensitivityScale));
    } catch {
      /* ignore */
    }
  }

  /** code → action lookup used by the key handlers (rebuilt on every rebind). */
  _rebuildActionMap() {
    this.actionByCode = {};
    for (const [action, code] of Object.entries(this.bindings)) {
      // First action wins if the user forced a duplicate; setBinding blocks it.
      if (!(code in this.actionByCode)) this.actionByCode[code] = action;
    }
    for (const [code, action] of Object.entries(FIXED_ALIASES)) {
      if (!(code in this.actionByCode)) this.actionByCode[code] = action;
    }
    this.sensitivity = this.baseSensitivity * this.sensitivityScale;
  }

  getBindings() {
    return { ...this.bindings };
  }

  /**
   * Rebinds one action to a key code. Refuses codes already owned by another
   * action (returns false) so the mapping stays one-to-one.
   */
  setBinding(action, code) {
    if (!(action in DEFAULT_BINDINGS)) return false;
    if (typeof code !== 'string' || !code) return false;
    const owner = this.actionByCode[code];
    if (owner && owner !== action && owner in DEFAULT_BINDINGS) return false;
    this.bindings[action] = code;
    this._rebuildActionMap();
    this._persistSettings();
    return true;
  }

  resetBindings() {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.sensitivityScale = 1;
    this._rebuildActionMap();
    this._persistSettings();
  }

  /** Steering / look sensitivity, 0.4–2.5 (menu slider drives this). */
  getSensitivity() {
    return this.sensitivityScale;
  }

  setSensitivity(scale) {
    const value = clamp(Number(scale), 0.4, 2.5);
    if (!Number.isFinite(value)) return this.sensitivityScale;
    this.sensitivityScale = value;
    this.sensitivity = this.baseSensitivity * value;
    this._persistSettings();
    return value;
  }

  clearKeys() {
    this.keys.clear();
    // Edge-triggered actions queued while the menu had focus (Escape, P…)
    // must never leak into the sortie that is about to start.
    this.actions = [];
    this.keyTarget.pitch = 0;
    this.keyTarget.roll = 0;
    this.keyTarget.yaw = 0;
    this.boost = false;
    this.brake = false;
    this.fireHeld = false;
    this.pointerFire = false;
    this.missileRequests = 0;
    this.flareRequests = 0;
  }

  /**
   * Turns tilt steering on. iOS requires a permission prompt that must run
   * inside a user gesture, so this is async; resolves `true` when the sensor
   * stream is (or already was) running.
   */
  async enableGyro() {
    if (!this.gyro.supported) return false;
    if (this.gyro.needsPermission) {
      try {
        const answer = await window.DeviceOrientationEvent.requestPermission();
        if (answer !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.gyro.enabled) {
      this.gyro.enabled = true;
      window.addEventListener('deviceorientation', this._onDeviceOrientation);
      window.addEventListener('orientationchange', this._onOrientationChange);
      const screenOrientation = window.screen?.orientation;
      if (screenOrientation && typeof screenOrientation.addEventListener === 'function') {
        screenOrientation.addEventListener('change', this._onOrientationChange);
        this._boundScreenOrientation = screenOrientation;
      }
    }
    this.recalibrateGyro();
    return true;
  }

  disableGyro() {
    if (this.gyro.enabled) {
      window.removeEventListener('deviceorientation', this._onDeviceOrientation);
      window.removeEventListener('orientationchange', this._onOrientationChange);
      if (this._boundScreenOrientation) {
        this._boundScreenOrientation.removeEventListener?.('change', this._onOrientationChange);
        this._boundScreenOrientation = null;
      }
    }
    this.gyro.enabled = false;
    this.gyro.pitch = 0;
    this.gyro.roll = 0;
    this.gyro.offsetBeta = null;
    this.gyro.offsetGamma = null;
  }

  /** Re-zeros neutral to whatever tilt the device has right now. */
  recalibrateGyro() {
    this.gyro.offsetBeta = null;
    this.gyro.offsetGamma = null;
    this.gyro.pitch = 0;
    this.gyro.roll = 0;
  }

  /**
   * Current viewport rotation in degrees (0 portrait, 90 / 270 landscape).
   * Safe on browsers without the Screen Orientation API.
   */
  _screenAngle() {
    let angle = 0;
    try {
      const so = window.screen?.orientation;
      angle = Number(so && Number.isFinite(so.angle) ? so.angle : window.orientation);
    } catch {
      angle = 0;
    }
    if (!Number.isFinite(angle)) angle = 0;
    return ((angle % 360) + 360) % 360;
  }

  /**
   * Projects a raw sensor sample onto the *screen* frame. In portrait the
   * mapping is the identity; in landscape (90° / 270°) the beta/gamma axes
   * are rotated so "tilt away = pitch" and "tilt right = roll" keep working
   * whichever way the phone is held. Offsets are captured after this step,
   * so a recalibration always zeroes the current hold.
   */
  _orientTilt(beta, gamma) {
    const angle = this._screenAngle();
    if (!angle) return [beta, gamma];
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return [beta * cos - gamma * sin, beta * sin + gamma * cos];
  }

  _onDeviceOrientation(event) {
    if (!this.gyro.enabled) return;
    const rawBeta = Number(event.beta);
    const rawGamma = Number(event.gamma);
    if (!Number.isFinite(rawBeta) || !Number.isFinite(rawGamma)) return;
    const [beta, gamma] = this._orientTilt(rawBeta, rawGamma);

    if (this.gyro.offsetBeta === null || this.gyro.offsetGamma === null) {
      // First sample after (re)enable defines the neutral hold position.
      this.gyro.offsetBeta = beta;
      this.gyro.offsetGamma = gamma;
      return;
    }

    // beta grows as the top edge tips toward the user = pull back = nose up.
    // gamma grows as the device tips right = roll right (negative command).
    const dPitch = beta - this.gyro.offsetBeta;
    const dRoll = gamma - this.gyro.offsetGamma;
    // Sensitivity shrinks the tilt span: same motion, bigger command.
    const span = 30 / this.sensitivityScale;
    this.gyro.pitch = tiltCurve(dPitch, 5, span);
    this.gyro.roll = -tiltCurve(dRoll, 5, span);
  }

  _onKeyDown(event) {
    const code = event.code;
    const action = this.actionByCode[code];
    if (action && this.enabled) event.preventDefault();
    if (event.repeat) return;

    if (!this.enabled) return;

    this.keys.add(code);
    switch (action) {
      case 'boost':
        this.boost = true;
        break;
      case 'brake':
        this.brake = true;
        break;
      case 'autolock':
        this.actions.push('autolock');
        break;
      case 'pause':
        this.actions.push('pause');
        break;
      case 'mute':
        this.actions.push('mute');
        break;
      case 'help':
        this.actions.push('help');
        break;
      case 'camera':
        this.actions.push('camera');
        break;
      case 'fire':
        this.fireHeld = true;
        break;
      case 'missile':
        this.missileRequests += 1;
        break;
      case 'flare':
        this.flareRequests += 1;
        break;
    }

    this._updateKeyTargets();
  }

  _onKeyUp(event) {
    const code = event.code;
    this.keys.delete(code);
    const action = this.actionByCode[code];
    if (action === 'boost') this.boost = false;
    if (action === 'brake') this.brake = false;
    if (action === 'fire') this.fireHeld = false;
    this._updateKeyTargets();
  }

  /** True while any key bound to `action` is held down. */
  _actionHeld(action) {
    const bound = this.bindings[action];
    if (bound && this.keys.has(bound)) return true;
    for (const [code, owner] of Object.entries(this.actionByCode)) {
      if (owner === action && this.keys.has(code)) return true;
    }
    return false;
  }

  _updateKeyTargets() {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    // Nose down / nose up (bound keys plus the fixed arrow aliases).
    if (this._actionHeld('pitchDown')) pitch -= 1;
    if (this._actionHeld('pitchUp')) pitch += 1;
    if (this._actionHeld('rollLeft')) roll += 1;
    if (this._actionHeld('rollRight')) roll -= 1;
    if (this._actionHeld('yawLeft')) yaw += 1;
    if (this._actionHeld('yawRight')) yaw -= 1;
    this.keyTarget.pitch = clamp(pitch, -1, 1);
    this.keyTarget.roll = clamp(roll, -1, 1);
    this.keyTarget.yaw = clamp(yaw, -1, 1);
  }

  _onBlur() {
    this.clearKeys();
    this.dragging = false;
    this.lookDelta.set(0, 0);
  }

  _onPointerDown(event) {
    if (!this.enabled || event.pointerType === 'touch') return;
    if (event.button === 2) {
      // Right button = missile, edge-triggered.
      this.missileRequests += 1;
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    if (this.dragging) return;
    this.dragging = true;
    this.pointerFire = true;
    this.pointerId = event.pointerId;
    this.lastPointer.set(event.clientX, event.clientY);
    if (this.canvas) {
      this.canvas.style.cursor = 'grabbing';
      this.canvas.setPointerCapture?.(event.pointerId);
    }
  }

  _onPointerMove(event) {
    // Pointer lock feeds raw movement deltas; regular drag look uses the
    // cursor position. Camera settings decide whether the delta is used.
    const locked =
      typeof document !== 'undefined' &&
      this.canvas &&
      document.pointerLockElement === this.canvas;
    if (locked && !this.enabled) return;
    if (!locked && (!this.dragging || event.pointerId !== this.pointerId)) return;

    let dx;
    let dy;
    if (locked) {
      dx = event.movementX || 0;
      dy = event.movementY || 0;
    } else {
      dx = event.clientX - this.lastPointer.x;
      dy = event.clientY - this.lastPointer.y;
      this.lastPointer.set(event.clientX, event.clientY);
    }
    this.lookDelta.x -= dx * this.sensitivity * 0.0035;
    this.lookDelta.y += dy * this.sensitivity * 0.0028;
  }

  _onPointerUp(event) {
    if (event.button === 0) this.pointerFire = false;
    if (event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    if (this.canvas) {
      this.canvas.style.cursor = 'grab';
      this.canvas.releasePointerCapture?.(event.pointerId);
    }
  }

  _onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    this.zoomDelta += clamp(event.deltaY, -120, 120) * 0.0035;
  }

  /**
   * Touch sticks feed these setters. Values use screen coordinates
   * (right/down positive) and are converted into aircraft conventions here.
   */
  setStick(which, x, y) {
    if (which === 'left') {
      this.mobile.roll = -clamp(x, -1, 1);
      this.mobile.pitch = clamp(y, -1, 1);
    } else {
      this.mobile.yaw = -clamp(x, -1, 1);
      // Push up = full military power, pull down = idle.
      this.mobile.throttle = clamp(0.5 - clamp(y, -1, 1) * 0.45, 0.15, 1);
      this.mobile.throttleActive = true;
    }
  }

  clearStick(which) {
    if (which === 'left') {
      this.mobile.pitch = 0;
      this.mobile.roll = 0;
    } else {
      this.mobile.yaw = 0;
      this.mobile.throttleActive = false;
    }
  }

  setMobileButton(name, pressed) {
    if (name === 'boost') this.mobile.boost = pressed;
    if (name === 'brake') this.mobile.brake = pressed;
    if (name === 'fire') this.mobile.fire = pressed;
    if (name === 'missile') {
      if (pressed && !this.mobile.missile) this.missileRequests += 1;
      this.mobile.missile = pressed;
    }
    if (name === 'flare') {
      if (pressed && !this.mobile.flare) this.flareRequests += 1;
      this.mobile.flare = pressed;
    }
  }

  /** Continuous cannon trigger: keyboard F, left mouse, or mobile FIRE. */
  isFiring() {
    return this.enabled && (this.fireHeld || this.pointerFire || this.mobile.fire);
  }

  /** Edge-triggered missile queue — one press requests exactly one missile. */
  consumeMissile() {
    if (this.missileRequests <= 0) return false;
    this.missileRequests -= 1;
    return true;
  }

  /** Edge-triggered flare salvo — one press requests exactly one salvo. */
  consumeFlares() {
    if (this.flareRequests <= 0) return false;
    this.flareRequests -= 1;
    return true;
  }

  update(dt) {
    if (!this.enabled) {
      this.pitch = damp(this.pitch, 0, 8, dt);
      this.roll = damp(this.roll, 0, 8, dt);
      this.yaw = damp(this.yaw, 0, 8, dt);
      return;
    }

    // Keyboard throttle ratchet (rebindable up/down keys).
    if (this._actionHeld('throttleUp')) {
      this.throttle = clamp(this.throttle + dt * 0.5, 0.15, 1);
    }
    if (this._actionHeld('throttleDown')) {
      this.throttle = clamp(this.throttle - dt * 0.5, 0.15, 1);
    }
    if (this.mobile.throttleActive) this.throttle = this.mobile.throttle;

    const targetPitch = clamp(this.keyTarget.pitch + this.mobile.pitch + this.gyro.pitch, -1, 1);
    const targetRoll = clamp(this.keyTarget.roll + this.mobile.roll + this.gyro.roll, -1, 1);
    const targetYaw = clamp(this.keyTarget.yaw + this.mobile.yaw, -1, 1);

    // "Sensitif gerak": higher scale = snappier control response.
    const s = this.sensitivityScale;
    this.pitch = damp(this.pitch, targetPitch, 9 * s, dt);
    this.roll = damp(this.roll, targetRoll, 11 * s, dt);
    this.yaw = damp(this.yaw, targetYaw, 8 * s, dt);
  }

  getFlightInput() {
    return {
      pitch: this.pitch,
      roll: this.roll,
      yaw: this.yaw,
      boost: this.boost || this.mobile.boost,
      brake: this.brake || this.mobile.brake,
      throttle: this.throttle,
    };
  }

  consumeLook() {
    const delta = { x: this.lookDelta.x, y: this.lookDelta.y };
    const zoom = this.zoomDelta;
    this.lookDelta.set(0, 0);
    this.zoomDelta = 0;
    return { ...delta, zoom };
  }

  consumeActions() {
    if (!this.actions.length) return [];
    const actions = this.actions;
    this.actions = [];
    return actions;
  }
}
