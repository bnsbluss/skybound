const clampUnit = (value) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));

export class MobileControls {
  constructor(input, { enabled = true, onCamera = null } = {}) {
    this.input = input;
    this.enabled = enabled;
    this.onCamera = onCamera;
    this.root = document.createElement('div');
    this.root.className = 'mobile-controls';
    this.root.innerHTML = `
      <div class="stick-zone stick-left" data-stick="left">
        <div class="stick-caption"><span>PITCH</span><span>ROLL</span></div>
        <div class="stick-base">
          <span class="stick-crosshair"></span>
          <div class="stick-knob"><span></span></div>
        </div>
      </div>
      <div class="mobile-action-cluster">
        <button type="button" class="touch-btn touch-missile" aria-label="Fire missile">
          <svg class="touch-btn-icon" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 3l4.2 6.8v9.4l3.8 3.8v2.2h-4.6l-1.4 3.4h-4l-1.4-3.4H8v-2.2l3.8-3.8V9.8z" fill="currentColor" opacity="0.88"/>
            <path d="M16 6.2l1.8 3.2v7.6h-3.6V9.4z" fill="#04181a" opacity="0.55"/>
          </svg>
          <span class="touch-btn-key">MSL</span>
          <span class="touch-btn-label">MISSILE</span>
        </button>
        <button type="button" class="touch-btn touch-flare" aria-label="Deploy flares">
          <svg class="touch-btn-icon" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 3l2.2 6.8 6.4-3.2-3.2 6.4L28 16l-6.6 2.2 3.2 6.4-6.4-3.2L16 28l-2.2-6.6-6.4 3.2 3.2-6.4L4 16l6.6-3-3.2-6.4 6.4 3.2z" fill="currentColor"/>
            <circle cx="6.5" cy="7.5" r="1.6" fill="currentColor"/><circle cx="25.5" cy="7.5" r="1.6" fill="currentColor"/>
          </svg>
          <span class="touch-btn-key">FLR</span>
          <span class="touch-btn-label">FLARE</span>
        </button>
        <button type="button" class="touch-btn touch-fire" aria-label="Fire cannon">
          <svg class="touch-btn-icon" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="9.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
            <circle cx="16" cy="16" r="2.6" fill="currentColor"/>
            <path d="M16 2.5v5.5M16 24v5.5M2.5 16h5.5M24 16h5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
          <span class="touch-btn-key">GUN</span>
          <span class="touch-btn-label">FIRE</span>
        </button>
        <button type="button" class="touch-btn touch-brake" aria-label="Air brake">
          <svg class="touch-btn-icon" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M11 6l-6 10 6 10M21 6l6 10-6 10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="14" y="8" width="4" height="16" rx="1.5" fill="currentColor" opacity="0.8"/>
          </svg>
          <span class="touch-btn-key">BRK</span>
          <span class="touch-btn-label">AIRBRAKE</span>
        </button>
        <button type="button" class="touch-btn touch-boost" aria-label="Afterburner">
          <svg class="touch-btn-icon" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16.5 3c3.5 4.2 6.8 8.8 6.8 14.2 0 5.4-3.6 9.8-7.3 11.8 1.4-2.8 1.2-5.8-.6-8.2-1.8 2.2-2.2 5-.9 8.2C10.8 27 8 22.8 8 17.4c0-4.2 2.2-7.8 4.4-10.4-.2 2.4.6 4.2 2.1 5.4C14.2 9 15 5.8 16.5 3z" fill="currentColor"/>
          </svg>
          <span class="touch-btn-key">AB</span>
          <span class="touch-btn-label">BOOST</span>
        </button>
      </div>
      <button type="button" class="touch-btn touch-cam" aria-label="Ganti kamera">
        <svg class="touch-btn-icon" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="4" y="9" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
          <path d="M20 13.5l7-3.5v12l-7-3.5z" fill="currentColor" opacity="0.88"/>
          <circle cx="12" cy="16" r="3.2" fill="currentColor" opacity="0.72"/>
        </svg>
        <span class="touch-btn-key">CAM</span>
        <span class="touch-btn-label">CAMERA</span>
      </button>
      <div class="stick-zone stick-right" data-stick="right">
        <div class="stick-caption"><span>YAW</span><span>THROTTLE</span></div>
        <div class="stick-base">
          <span class="stick-crosshair"></span>
          <div class="stick-knob"><span></span></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.sticks = {};
    this.root.querySelectorAll('.stick-zone').forEach((zone) => {
      const which = zone.dataset.stick;
      const base = zone.querySelector('.stick-base');
      const knob = zone.querySelector('.stick-knob');
      const state = {
        which,
        base,
        knob,
        pointerId: null,
        radius: 56,
        active: false,
      };
      this.sticks[which] = state;
      this._bindStick(state);
    });

    this.buttons = {
      boost: this.root.querySelector('.touch-boost'),
      brake: this.root.querySelector('.touch-brake'),
      fire: this.root.querySelector('.touch-fire'),
      missile: this.root.querySelector('.touch-missile'),
      flare: this.root.querySelector('.touch-flare'),
      cam: this.root.querySelector('.touch-cam'),
    };
    this._bindButton(this.buttons.boost, 'boost');
    this._bindButton(this.buttons.brake, 'brake');
    this._bindButton(this.buttons.fire, 'fire');
    this._bindButton(this.buttons.missile, 'missile');
    this._bindButton(this.buttons.flare, 'flare');
    this._bindTapButton(this.buttons.cam, () => this.onCamera?.());
    this.setButtonLayout('center');
    this.setVisible(false);
  }

  _bindStick(state) {
    const onDown = (event) => {
      if (!this.enabled || document.body.classList.contains('hud-edit')) return;
      event.preventDefault();
      event.stopPropagation();
      state.active = true;
      state.pointerId = event.pointerId;
      state.base.setPointerCapture?.(event.pointerId);
      state.base.classList.add('active');
      this._updateStick(state, event);
      if (navigator.vibrate) navigator.vibrate(6);
    };
    const onMove = (event) => {
      if (!state.active || event.pointerId !== state.pointerId) return;
      event.preventDefault();
      this._updateStick(state, event);
    };
    const onUp = (event) => {
      if (event.pointerId !== state.pointerId) return;
      state.active = false;
      state.pointerId = null;
      state.drive = false;
      state.base.classList.remove('active');
      state.knob.style.transform = 'translate(-50%, -50%)';
      this.input.clearStick(state.which);
      try {
        state.base.releasePointerCapture?.(event.pointerId);
      } catch {
        /* pointer already gone */
      }
    };

    state.base.addEventListener('pointerdown', onDown, { passive: false });
    state.base.addEventListener('pointermove', onMove, { passive: false });
    state.base.addEventListener('pointerup', onUp);
    state.base.addEventListener('pointercancel', onUp);
    state.base.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _updateStick(state, event) {
    const rect = state.base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * 0.34;
    let dx = (event.clientX - cx) / radius;
    let dy = (event.clientY - cy) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    state.knob.style.transform = `translate(calc(-50% + ${dx * radius}px), calc(-50% + ${dy * radius}px))`;
    this.input.setStick(state.which, dx, dy);
  }

  /**
   * Drives the on-screen sticks to mirror the autopilot's commands so the
   * pilot can watch the AI fly: the knobs track pitch/roll on the left stick
   * and yaw/throttle on the right. Visual only — the flight model already
   * consumes the AI input directly, and a finger on the stick wins.
   *
   * @param {{pitch:number,roll:number,yaw:number,throttle:number}|null} ai
   *   the AI's input for this frame, or null to recentre the knobs.
   */
  setAutopilotDrive(ai) {
    for (const key of Object.keys(this.sticks)) {
      const state = this.sticks[key];
      // A finger on the glass keeps the knob it is holding.
      if (state.active) continue;
      if (!ai) {
        if (state.drive) state.knob.style.transform = 'translate(-50%, -50%)';
        state.drive = false;
        continue;
      }
      let dx = 0;
      let dy = 0;
      if (state.which === 'left') {
        // Matches setStick(): roll = -x, pitch = y.
        dx = -clampUnit(ai.roll);
        dy = clampUnit(ai.pitch);
      } else {
        // yaw = -x, and throttle = 0.5 - y·0.45 inverted back to y.
        dx = -clampUnit(ai.yaw);
        dy = clampUnit((0.5 - clampUnit(ai.throttle ?? 0.68)) / 0.45);
      }
      const rect = state.base.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) * 0.34 || 40;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      state.knob.style.transform = `translate(calc(-50% + ${dx * radius}px), calc(-50% + ${dy * radius}px))`;
      state.drive = true;
    }
  }

  _bindButton(button, name) {
    const press = (event) => {
      // In HUD edit mode the cluster is being dragged, not fired.
      if (!this.enabled || document.body.classList.contains('hud-edit')) return;
      event.preventDefault();
      event.stopPropagation();
      button.classList.add('pressed');
      button.setPointerCapture?.(event.pointerId);
      this.input.setMobileButton(name, true);
      if (navigator.vibrate) navigator.vibrate(10);
    };
    const release = (event) => {
      button.classList.remove('pressed');
      this.input.setMobileButton(name, false);
      try {
        button.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    };
    button.addEventListener('pointerdown', press, { passive: false });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindTapButton(button, callback) {
    if (!button) return;
    const press = (event) => {
      if (!this.enabled || document.body.classList.contains('hud-edit')) return;
      event.preventDefault();
      event.stopPropagation();
      button.classList.add('pressed');
      callback?.();
      if (navigator.vibrate) navigator.vibrate(8);
    };
    const release = () => {
      button.classList.remove('pressed');
    };
    button.addEventListener('pointerdown', press, { passive: false });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Places the action cluster: left / center / right of the screen. */
  setButtonLayout(layout) {
    const side = ['left', 'center', 'right'].includes(layout) ? layout : 'center';
    this.root.classList.remove('btn-left', 'btn-center', 'btn-right');
    this.root.classList.add(`btn-${side}`);
  }

  setVisible(visible) {
    this.root.classList.toggle('visible', !!visible);    this.enabled = !!visible;
    if (!visible) {
      for (const key of Object.keys(this.sticks)) {
        const s = this.sticks[key];
        s.active = false;
        s.pointerId = null;
        s.drive = false;
        s.base.classList.remove('active');
        s.knob.style.transform = 'translate(-50%, -50%)';
        this.input.clearStick(key);
      }
      this.input.setMobileButton('boost', false);
      this.input.setMobileButton('brake', false);
      this.input.setMobileButton('fire', false);
      this.input.setMobileButton('missile', false);
      this.input.setMobileButton('flare', false);
      for (const key of Object.keys(this.buttons)) {
        this.buttons[key]?.classList.remove('pressed');
      }
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.root.classList.toggle('disabled', !enabled);
  }
}
