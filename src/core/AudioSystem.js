import { clamp } from '../utils/math.js';

/**
 * Fully procedural WebAudio soundscape: turbofan whine, jet rush, wind and an
 * afterburner roar. No audio files are required, which keeps the build
 * self-contained and instant to boot.
 */
export class AudioSystem {
  constructor() {
    this.supported =
      typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.ready = false;
    this.time = 0;
    this.paused = false;
    this._nodes = null;
    this._crashCooldown = 0;
    this._explosionCooldown = 0;
    this._hitCooldown = 0;
    this._lastGun = -1;
    this._missileAlarmTimer = 0;
    this._missileAlarmActive = false;
    this._missileAlarmCount = 0;
    this._targetLockTimer = 0;
    this._targetLockActive = false;
    this._targetLockCount = 0;
  }

  init() {
    if (!this.supported || this.started) {
      this.resume();
      return;
    }
    this.started = true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new Ctx();
    } catch {
      this.supported = false;
      return;
    }

    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.6;
    master.connect(ctx.destination);

    // ---- Turbine: two detuned saw oscillators through a low-pass ----------
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 900;
    engineFilter.Q.value = 3.2;
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 90;
    const oscB = ctx.createOscillator();
    oscB.type = 'sawtooth';
    oscB.frequency.value = 93;
    const oscMix = ctx.createGain();
    oscMix.gain.value = 0.16;
    oscA.connect(oscMix);
    oscB.connect(oscMix);
    oscMix.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    // ---- Shared white-noise buffer ---------------------------------------
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = last * 6.5;
    }

    const makeNoise = () => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      return source;
    };

    // Jet rush through a band-pass.
    const jetSource = makeNoise();
    const jetFilter = ctx.createBiquadFilter();
    jetFilter.type = 'bandpass';
    jetFilter.frequency.value = 420;
    jetFilter.Q.value = 0.75;
    const jetGain = ctx.createGain();
    jetGain.gain.value = 0;
    jetSource.connect(jetFilter);
    jetFilter.connect(jetGain);
    jetGain.connect(master);

    // Afterburner roar — low, wide and mean.
    const burnerSource = makeNoise();
    const burnerFilter = ctx.createBiquadFilter();
    burnerFilter.type = 'lowpass';
    burnerFilter.frequency.value = 280;
    burnerFilter.Q.value = 1.4;
    const burnerGain = ctx.createGain();
    burnerGain.gain.value = 0;
    burnerSource.connect(burnerFilter);
    burnerFilter.connect(burnerGain);
    burnerGain.connect(master);

    // Wind over the airframe.
    const windSource = makeNoise();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'highpass';
    windFilter.frequency.value = 1500;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);

    // Menu / UI blip bus.
    const uiGain = ctx.createGain();
    uiGain.gain.value = 0.16;
    uiGain.connect(master);

    oscA.start();
    oscB.start();
    jetSource.start();
    burnerSource.start();
    windSource.start();

    this._nodes = {
      master,
      engineGain,
      engineFilter,
      oscA,
      oscB,
      jetGain,
      jetFilter,
      burnerGain,
      burnerFilter,
      windGain,
      windFilter,
      uiGain,
      noiseBuffer: buffer,
    };
    this.ready = true;
    this.resume();
  }

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (!this._nodes) return;
    const { master } = this._nodes;
    master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.08);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setPaused(paused) {
    this.paused = !!paused;
  }

  _set(param, value, timeConstant = 0.16) {
    if (!this.ctx) return;
    param.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
  }

  update(dt, telemetry, active = true) {
    if (!this.ready || !this._nodes) return;
    this.time += dt;
    const n = this._nodes;
    const speed = telemetry?.speed ?? 0;
    const throttle = telemetry?.throttle ?? 0.6;
    const boost = telemetry?.boosting ? 1 : telemetry?.afterburner ?? 0;
    const airbrake = telemetry?.airbrake ? 1 : 0;
    const alive = active && !this.paused;

    const engineBase = 48 + throttle * 72 + speed * 0.22;
    this._set(n.oscA.frequency, engineBase);
    this._set(n.oscB.frequency, engineBase * 1.034 + 4);
    this._set(n.engineFilter.frequency, 520 + throttle * 1700 + speed * 1.6);
    this._set(n.engineGain.gain, alive ? 0.1 + throttle * 0.1 : 0);

    this._set(n.jetFilter.frequency, 260 + speed * 2.4 + boost * 340);
    this._set(n.jetGain.gain, alive ? clamp(speed / 360, 0, 1) * 0.24 + boost * 0.12 : 0);
    this._set(n.burnerGain.gain, alive ? boost * 0.34 : 0);
    this._set(n.burnerFilter.frequency, 220 + boost * 260);
    this._set(n.windGain.gain, alive ? Math.pow(clamp(speed / 370, 0, 1), 1.6) * 0.12 + airbrake * 0.03 : 0);
    this._set(n.windFilter.frequency, 900 + speed * 3.2);

    if (this._crashCooldown > 0) this._crashCooldown -= dt;
    if (this._explosionCooldown > 0) this._explosionCooldown -= dt;
    if (this._hitCooldown > 0) this._hitCooldown -= dt;
  }

  /**
   * Short cannon burst: filtered noise crack with a body thump. Throttled so
   * the 12 Hz gun rate does not stack dozens of voices.
   */
  gunFire() {
    if (!this.ctx || !this._nodes || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - (this._lastGun ?? -1) < 0.045) return;
    this._lastGun = now;

    const duration = 0.09;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500 + Math.random() * 500;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0.24;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);
    source.start(now);

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'square';
    thump.frequency.setValueAtTime(170, now);
    thump.frequency.exponentialRampToValueAtTime(70, now + 0.06);
    thumpGain.gain.setValueAtTime(0.1, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    thump.connect(thumpGain);
    thumpGain.connect(this._nodes.master);
    thump.start(now);
    thump.stop(now + 0.09);
  }

  /** Missile rail launch: rising noise whoosh. */
  missileLaunch() {
    if (!this.ctx || !this._nodes || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const duration = 0.85;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      data[i] = last * Math.min(1, t * 6) * Math.pow(1 - t, 1.3);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 0.5);
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.value = 0.4;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);
    source.start(now);
  }

  /** Flare salvo: bright noise pop sweeping down like burning magnesium. */
  flareBurst() {
    if (!this.ctx || !this._nodes || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const duration = 0.5;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const white = Math.random() * 2 - 1;
      last = last * 0.7 + white * 0.3;
      data[i] = last * Math.min(1, t * 24) * Math.pow(1 - t, 1.6);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.exponentialRampToValueAtTime(700, now + 0.45);
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.value = 0.34;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);
    source.start(now);
  }

  /** Fireball: noise burst + low thump, `size` scales weight (1 = missile). */
  explosion(size = 1) {
    if (!this.ctx || !this._nodes || this.muted) return;
    if (this._explosionCooldown > 0) return;
    this._explosionCooldown = 0.08;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const duration = 1.1;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.0) * (1 - t * 0.4);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200 * size, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.8);
    const gain = ctx.createGain();
    gain.gain.value = 0.5 * clamp(size, 0.5, 1.6);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);
    source.start(now);

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, now);
    thump.frequency.exponentialRampToValueAtTime(34, now + 0.5);
    thumpGain.gain.setValueAtTime(0.42 * size, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    thump.connect(thumpGain);
    thumpGain.connect(this._nodes.master);
    thump.start(now);
    thump.stop(now + 0.8);
  }

  /** Hit on your own airframe: metallic clank + short noise slap. */
  hullHit() {
    if (!this.ctx || !this._nodes || this.muted) return;
    if (this._hitCooldown > 0) return;
    this._hitCooldown = 0.12;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);
    oscGain.gain.setValueAtTime(0.16, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(oscGain);
    oscGain.connect(this._nodes.master);
    osc.start(now);
    osc.stop(now + 0.18);

    const duration = 0.14;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);
    source.start(now);
  }

  /**
   * Fighter-jet RWR missile-inbound alarm: urgent alternating two-tone warble
   * that prompts the pilot to deploy flares. Higher urgency increases pitch
   * and sharpness as the hostile missile closes in.
   */
  missileWarningBeep(urgency = 0.5) {
    this._missileAlarmCount += 1;
    if (!this.ctx || !this._nodes || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const u = clamp(urgency, 0, 1);

    const fLow = 1380 + u * 340;
    const fHigh = 1920 + u * 520;
    const stepDur = 0.052 - u * 0.012;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1850 + u * 400;
    filter.Q.value = 2.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24 + u * 0.08, now + 0.008);
    gain.gain.setValueAtTime(0.24 + u * 0.08, now + stepDur * 2);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + stepDur * 2 + 0.045);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(fLow, now);
    osc.frequency.setValueAtTime(fHigh, now + stepDur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);
    osc.start(now);
    osc.stop(now + stepDur * 2 + 0.055);
  }

  /**
   * Drives the rhythmic missile-warning alarm each frame while a hostile
   * missile is chasing the player. Pulse cadence speeds up as range drops.
   *
   * @param {number} dt frame delta in seconds
   * @param {number|null} incomingDistance nearest hostile missile range in metres
   * @param {boolean} active true only while actively flying and unpaused
   * @returns {boolean} true while the alarm is engaged
   */
  missileAlarmUpdate(dt, incomingDistance, active = true) {
    if (!active || this.paused || !Number.isFinite(incomingDistance)) {
      this._missileAlarmActive = false;
      this._missileAlarmTimer = 0;
      return false;
    }

    const urgency =
      incomingDistance < 650 ? 1.0 : incomingDistance < 1350 ? 0.65 : 0.35;
    const interval =
      incomingDistance < 650 ? 0.14 : incomingDistance < 1350 ? 0.25 : 0.44;

    if (!this._missileAlarmActive) {
      this._missileAlarmActive = true;
      this._missileAlarmTimer = interval;
      this.missileWarningBeep(urgency);
      return true;
    }

    this._missileAlarmTimer -= dt;
    if (this._missileAlarmTimer <= 0) {
      this._missileAlarmTimer = interval;
      this.missileWarningBeep(urgency);
    }
    return true;
  }

  /** Missile lock achieved — crisp rising two-tone confirmation chirp on master bus. */
  lockTone() {
    if (!this.ctx || !this._nodes || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    gain.connect(this._nodes.master);
    for (const [freq, delay] of [[1040, 0], [1560, 0.095]]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + delay);
      osc.stop(now + delay + 0.14);
    }
  }

  /**
   * Single Sidewinder-style missile-seeker lock-ready pulse ("SHOOT" tone).
   * Routed directly to `master` so it cuts cleanly through engine & afterburner roar.
   */
  lockReadyBeep(ready = true) {
    this._targetLockCount += 1;
    if (!this.ctx || !this._nodes || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = ready ? 0.11 : 0.065;
    const baseFreq = ready ? 1560 : 1220;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = baseFreq * 1.15;
    filter.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(ready ? 0.22 : 0.11, now + 0.008);
    gain.gain.setValueAtTime(ready ? 0.2 : 0.1, now + dur * 0.72);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.018);

    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(baseFreq, now);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 1.5, now);

    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.5;

    osc1.connect(filter);
    osc2.connect(harmGain);
    harmGain.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + dur + 0.03);
    osc2.stop(now + dur + 0.03);
  }

  /**
   * Drives a rhythmic Sidewinder-style lock-on tone while a hostile target is
   * locked in the missile seeker envelope so the pilot hears "ready to fire!".
   *
   * @param {number} dt frame delta in seconds
   * @param {boolean} locked true when a live target is locked for missile launch
   * @param {boolean} readyToFire true when missile launcher cooldown is clear
   * @param {boolean} active true only while flying and unpaused
   * @returns {boolean}
   */
  targetLockUpdate(dt, locked, readyToFire = true, active = true) {
    if (!active || this.paused || !locked) {
      this._targetLockActive = false;
      this._targetLockTimer = 0;
      return false;
    }

    const interval = readyToFire ? 0.17 : 0.38;
    if (!this._targetLockActive) {
      this._targetLockActive = true;
      this._targetLockTimer = interval;
      this.lockReadyBeep(readyToFire);
      return true;
    }

    this._targetLockTimer -= dt;
    if (this._targetLockTimer <= 0) {
      this._targetLockTimer = interval;
      this.lockReadyBeep(readyToFire);
    }
    return true;
  }

  uiBlip(frequency = 660, duration = 0.08) {
    if (!this.ctx || !this._nodes || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this._nodes.uiGain);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  crash() {
    if (!this.ctx || !this._nodes || this._crashCooldown > 0) return;
    this._crashCooldown = 1.5;
    const ctx = this.ctx;
    if (this.muted) return;

    const seconds = 1.4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const decay = Math.pow(1 - i / data.length, 2.2);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.55;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._nodes.master);
    source.start();

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(90, ctx.currentTime);
    thump.frequency.exponentialRampToValueAtTime(32, ctx.currentTime + 0.7);
    thumpGain.gain.setValueAtTime(0.5, ctx.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    thump.connect(thumpGain);
    thumpGain.connect(this._nodes.master);
    thump.start();
    thump.stop(ctx.currentTime + 1.0);
  }
}
