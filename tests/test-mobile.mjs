import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><canvas id="viewport"></canvas><div id="ui-root"></div></body></html>',
  { pretendToBeVisual: true, url: 'https://skybound.test/' }
);
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

const { InputManager } = await import('../src/controls/InputManager.js');
const { MobileControls } = await import('../src/controls/MobileControls.js');

const input = new InputManager({ touch: true });
input.attach(document.getElementById('viewport'));
const controls = new MobileControls(input, { enabled: false });
assert.ok(controls.root.isConnected, 'mobile controls mounted');
assert.equal(controls.root.classList.contains('visible'), false, 'hidden by default');
assert.ok(controls.root.querySelectorAll('.stick-zone').length === 2, 'two sticks');
assert.ok(controls.root.querySelector('.touch-flare'), 'flare button in the cluster');
assert.equal(
  controls.root.querySelectorAll('.mobile-action-cluster .touch-btn').length,
  5,
  'five action buttons'
);
assert.equal(
  controls.root.querySelectorAll('.mobile-action-cluster .touch-btn svg.touch-btn-icon').length,
  5,
  'every action button has its own functional SVG icon'
);
console.log('PASS  mobile controls mount with two sticks and action buttons');

// jsdom has no layout, so give each stick base a real rect.
const RECT = { left: 100, top: 100, width: 120, height: 120, right: 220, bottom: 220 };
for (const base of controls.root.querySelectorAll('.stick-base')) {
  base.getBoundingClientRect = () => RECT;
}

function pointerEvent(type, target, { id = 1, x = 0, y = 0 } = {}) {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  target.dispatchEvent(event);
  return event;
}

// While hidden, sticks must not react.
const leftBase = controls.root.querySelector('.stick-left .stick-base');
pointerEvent('pointerdown', leftBase, { x: 200, y: 100 });
assert.equal(input.mobile.pitch, 0, 'hidden controls ignore touches');
assert.equal(input.mobile.roll, 0);

controls.setVisible(true);
input.setEnabled(true);
assert.equal(controls.root.classList.contains('visible'), true);
assert.equal(controls.enabled, true);
assert.equal(input.enabled, true);

// Left stick → roll (screen X, inverted) and pitch (screen Y).
const knob = controls.root.querySelector('.stick-left .stick-knob');
pointerEvent('pointerdown', leftBase, { x: 200, y: 100 });
assert.ok(leftBase.classList.contains('active'), 'stick active');
assert.ok(input.mobile.roll < -0.5, `left roll=${input.mobile.roll.toFixed(2)}`);
assert.ok(input.mobile.pitch < -0.5, `left pitch=${input.mobile.pitch.toFixed(2)}`);
assert.ok(knob.style.transform.includes('translate'), 'knob follows finger');
pointerEvent('pointermove', document, { x: 100, y: 200 });
// Moves are captured on the base element through pointer capture; dispatch there.
pointerEvent('pointermove', leftBase, { x: 100, y: 200 });
assert.ok(input.mobile.roll > 0.5, `left roll after drag=${input.mobile.roll.toFixed(2)}`);
assert.ok(input.mobile.pitch > 0.5, `left pitch after drag=${input.mobile.pitch.toFixed(2)}`);
input.update(0.25);
assert.ok(input.pitch > 0.2 && input.roll > 0.2, 'axes reach flight input');
pointerEvent('pointerup', leftBase, { x: 100, y: 200 });
assert.equal(input.mobile.pitch, 0, 'left stick recentres on release');
assert.equal(input.mobile.roll, 0);
assert.equal(knob.style.transform, 'translate(-50%, -50%)');
console.log('PASS  left stick drives pitch/roll and recentres on release');

// Right stick → yaw and throttle. Up is full power.
const rightBase = controls.root.querySelector('.stick-right .stick-base');
pointerEvent('pointerdown', rightBase, { id: 2, x: 140, y: 160 });
assert.ok(input.mobile.yaw > 0.4, `right yaw=${input.mobile.yaw.toFixed(2)}`);
assert.ok(input.mobile.throttleActive, 'throttle active while stick held');
pointerEvent('pointermove', rightBase, { id: 2, x: 160, y: 70 });
assert.ok(input.mobile.throttle > 0.9, `throttle=${input.mobile.throttle.toFixed(2)}`);
assert.ok(Math.abs(input.mobile.yaw) < 0.05, 'yaw recentres at stick centre');
input.update(0.4);
assert.ok(input.throttle > 0.8, `throttle damped to=${input.throttle.toFixed(2)}`);
pointerEvent('pointerup', rightBase, { id: 2, x: 160, y: 70 });
assert.equal(input.mobile.yaw, 0);
assert.equal(input.mobile.throttleActive, false);
console.log('PASS  right stick drives yaw/throttle');

// Afterburner and airbrake buttons.
const boost = controls.root.querySelector('.touch-boost');
const brake = controls.root.querySelector('.touch-brake');
pointerEvent('pointerdown', boost, { id: 3 });
assert.equal(input.mobile.boost, true, 'boost pressed');
assert.ok(boost.classList.contains('pressed'));
pointerEvent('pointerup', boost, { id: 3 });
assert.equal(input.mobile.boost, false, 'boost released');
assert.ok(!boost.classList.contains('pressed'));
pointerEvent('pointerdown', brake, { id: 4 });
assert.equal(input.mobile.brake, true, 'brake pressed');
pointerEvent('pointerup', brake, { id: 4 });
assert.equal(input.mobile.brake, false, 'brake released');
console.log('PASS  afterburner and airbrake buttons latch and release');

// Cannon and missile buttons.
const fire = controls.root.querySelector('.touch-fire');
const missile = controls.root.querySelector('.touch-missile');
assert.ok(fire && missile, 'fire and missile buttons mounted');
pointerEvent('pointerdown', fire, { id: 9 });
assert.equal(input.mobile.fire, true, 'fire pressed');
assert.equal(input.isFiring(), true, 'trigger held');
assert.ok(fire.classList.contains('pressed'));
pointerEvent('pointerup', fire, { id: 9 });
assert.equal(input.mobile.fire, false, 'fire released');
assert.equal(input.isFiring(), false, 'trigger released');
pointerEvent('pointerdown', missile, { id: 10 });
assert.equal(input.consumeMissile(), true, 'missile edge-triggers once');
assert.equal(input.consumeMissile(), false, 'held button does not re-trigger');
pointerEvent('pointerup', missile, { id: 10 });
console.log('PASS  FIRE holds the cannon, MSL edge-triggers a missile');

// Flare button: one press = one salvo, holding does not repeat.
const flare = controls.root.querySelector('.touch-flare');
assert.ok(flare, 'flare button mounted');
assert.equal(flare.querySelector('.touch-btn-key').textContent, 'FLR', 'flare key legend');
pointerEvent('pointerdown', flare, { id: 12 });
assert.equal(input.consumeFlares(), true, 'flare edge-triggers once');
assert.equal(input.consumeFlares(), false, 'held button does not re-trigger');
assert.ok(flare.classList.contains('pressed'), 'flare shows pressed state');
pointerEvent('pointerup', flare, { id: 12 });
assert.equal(input.mobile.flare, false, 'flare released');
console.log('PASS  FLR edge-triggers a single flare salvo');

// Hiding the controls clears any latched input.
pointerEvent('pointerdown', leftBase, { id: 5, x: 200, y: 100 });
pointerEvent('pointerdown', boost, { id: 6 });
pointerEvent('pointerdown', fire, { id: 11 });
pointerEvent('pointerdown', flare, { id: 13 });
assert.equal(input.isFiring(), true, 'fire latched before hiding');
controls.setVisible(false);
assert.equal(controls.enabled, false);
assert.equal(input.mobile.pitch, 0);
assert.equal(input.mobile.roll, 0);
assert.equal(input.mobile.boost, false);
assert.equal(input.mobile.brake, false);
assert.equal(input.mobile.fire, false, 'fire released with the panel');
assert.equal(input.mobile.flare, false, 'flare released with the panel');
assert.equal(flare.classList.contains('pressed'), false, 'flare pressed state cleared');
assert.equal(leftBase.classList.contains('active'), false);
console.log('PASS  hiding controls releases sticks and buttons');

controls.setVisible(true);
controls.setEnabled(false);
pointerEvent('pointerdown', leftBase, { id: 7, x: 200, y: 100 });
assert.equal(input.mobile.roll, 0, 'disabled controls ignore input');
controls.setEnabled(true);
pointerEvent('pointerdown', leftBase, { id: 8, x: 200, y: 100 });
assert.notEqual(input.mobile.roll, 0, 're-enabled controls accept input');
console.log('PASS  enable/disable guards stick input');

controls.setButtonLayout('left');
assert.equal(controls.root.classList.contains('btn-left'), true, 'cluster parked left');
assert.equal(controls.root.classList.contains('btn-center'), false);
controls.setButtonLayout('right');
assert.equal(controls.root.classList.contains('btn-right'), true, 'cluster parked right');
controls.setButtonLayout('bogus');
assert.equal(controls.root.classList.contains('btn-center'), true, 'falls back to centre');
console.log('PASS  button layout classes');

// --- Autopilot stick drive --------------------------------------------------
// In AI mode the knobs mirror the pilot AI's commands so the player can
// watch it fly. Visual only: a finger on the glass keeps the stick it holds.
pointerEvent('pointerup', leftBase, { id: 8, x: 200, y: 100 }); // release the enable test
const leftKnob = controls.root.querySelector('.stick-left .stick-knob');
const rightKnob = controls.root.querySelector('.stick-right .stick-knob');
const AI_INPUT = { pitch: 0.5, roll: -0.8, yaw: 0.3, throttle: 1 };
controls.setAutopilotDrive(AI_INPUT);
// Left: dx = -roll = +0.8, dy = pitch = +0.5 → both offsets non-zero.
assert.ok(
  /calc\(-50% \+ \d/.test(leftKnob.style.transform),
  `left knob driven by AI (transform=${leftKnob.style.transform})`
);
assert.ok(
  !leftKnob.style.transform.includes('-50%, -50%'),
  'left knob left the centre'
);
// Right: dx = -yaw = -0.3, throttle 1 inverts to full-up dy.
assert.ok(
  /calc\(-50% [+-] \d/.test(rightKnob.style.transform),
  `right knob driven by AI (transform=${rightKnob.style.transform})`
);
assert.ok(
  rightKnob.style.transform !== 'translate(-50%, -50%)',
  'right knob left the centre'
);
console.log('PASS  autopilot drive moves both knobs with the AI commands');

// Extreme input is clamped to the knob radius, never past it.
controls.setAutopilotDrive({ pitch: 9, roll: -9, yaw: 9, throttle: 9 });
for (const k of [leftKnob, rightKnob]) {
  const m = k.style.transform.match(/calc\(-50% [+-] ([\d.]+)px\), calc\(-50% [+-] ([\d.]+)px\)/);
  assert.ok(m, `knob offset parsed (${k.style.transform})`);
  const radius = Math.hypot(Number(m[1]), Number(m[2]));
  assert.ok(radius <= 40.81, `knob stays inside the well (r=${radius.toFixed(1)})`);
}
console.log('PASS  autopilot drive clamps the knobs inside the well');

// Dropping out of AI recentres both sticks.
controls.setAutopilotDrive(null);
assert.equal(leftKnob.style.transform, 'translate(-50%, -50%)', 'left recentred');
assert.equal(rightKnob.style.transform, 'translate(-50%, -50%)', 'right recentred');
console.log('PASS  autopilot drive recentres the knobs when AI lets go');

// A finger on the stick wins over the AI.
pointerEvent('pointerdown', leftBase, { id: 14, x: 200, y: 100 });
const fingerTransform = leftKnob.style.transform;
controls.setAutopilotDrive(AI_INPUT);
assert.equal(leftKnob.style.transform, fingerTransform, 'held stick ignores the AI drive');
assert.notEqual(rightKnob.style.transform, 'translate(-50%, -50%)', 'free stick still follows');
pointerEvent('pointerup', leftBase, { id: 14, x: 200, y: 100 });
controls.setAutopilotDrive(AI_INPUT);
assert.notEqual(leftKnob.style.transform, 'translate(-50%, -50%)', 'released stick resumes drive');
controls.setAutopilotDrive(null);
console.log('PASS  a finger on the stick beats the autopilot drive');

// --- Gyro (tilt) steering --------------------------------------------------
class FakeDOE extends dom.window.Event {
  constructor(type, init = {}) {
    super(type);
    this.beta = init.beta;
    this.gamma = init.gamma;
  }
}
dom.window.DeviceOrientationEvent = FakeDOE;

const gyroInput = new InputManager({ touch: true });
assert.equal(gyroInput.gyro.supported, true, 'sensor API detected');
assert.equal(gyroInput.gyro.enabled, false, 'off by default');
assert.equal(await gyroInput.enableGyro(), true, 'enables without a permission prompt');

const orient = (beta, gamma) => dom.window.dispatchEvent(new FakeDOE('deviceorientation', { beta, gamma }));
orient(0, 0); // first sample after enable = neutral hold position
orient(3, 0);
assert.equal(gyroInput.gyro.pitch, 0, 'dead zone around neutral');
orient(20, 0);
assert.ok(gyroInput.gyro.pitch > 0.3, 'tip top toward user = nose up');
orient(-20, 0);
assert.ok(gyroInput.gyro.pitch < -0.3, 'tip top away = nose down');
orient(0, 20);
assert.ok(gyroInput.gyro.roll < -0.3, 'tip right = roll right (negative command)');
orient(0, -20);
assert.ok(gyroInput.gyro.roll > 0.3, 'tip left = roll left');

// Gyro mixes into the flight input alongside keys and sticks.
gyroInput.enabled = true;
orient(40, 0);
for (let i = 0; i < 12; i++) gyroInput.update(1 / 60);
assert.ok(gyroInput.getFlightInput().pitch > 0.5, 'tilt reaches the aircraft');

orient(25, 10); // device held at an arbitrary tilt
gyroInput.recalibrateGyro();
orient(25, 10); // first sample after recalibrate becomes the new neutral
assert.equal(gyroInput.gyro.pitch, 0, 'recalibration re-zeros neutral');
orient(40, 10);
assert.ok(gyroInput.gyro.pitch > 0 && gyroInput.gyro.pitch < 0.5, 'neutral shifted with the hold');

gyroInput.disableGyro();
assert.equal(gyroInput.gyro.enabled, false, 'disable stops the stream');
assert.equal(gyroInput.gyro.pitch, 0, 'disable zeroes the command');
orient(40, 0);
assert.equal(gyroInput.gyro.pitch, 0, 'events ignored while off');
console.log('PASS  gyro tilt steering mapping and lifecycle');

console.log('\nMOBILE TESTS PASSED');
dom.window.close();
