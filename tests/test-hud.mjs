import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
    <canvas id="viewport"></canvas>
    <div id="ui-root"></div>
    <div id="boot-fallback">
      <div class="boot-grid"></div>
      <div class="boot-center">
        <div class="boot-rings"><i></i><i></i><i></i></div>
        <div class="boot-fallback-title">SKY<span>BOUND</span></div>
        <div class="boot-fallback-sub">LOW-POLY FLIGHT OPERATIONS · BOOTING THREE.JS</div>
        <div class="boot-load">
          <div class="boot-load-track"><i id="boot-load-fill"></i></div>
          <div class="boot-load-meta">
            <span id="boot-load-label">INITIALISING FLIGHT SYSTEMS</span>
            <b id="boot-load-percent">0%</b>
          </div>
        </div>
        <ul class="boot-tips">
          <li class="boot-tip">TIP · Press <b>V</b> to deploy flares</li>
          <li class="boot-tip">TIP · The <b>01</b> button cycles views</li>
          <li class="boot-tip">TIP · Tilt your device to steer</li>
        </ul>
        <div class="boot-spinner"></div>
      </div>
      <div class="boot-corner tl"></div>
      <div class="boot-corner tr"></div>
      <div class="boot-corner bl"></div>
      <div class="boot-corner br"></div>
    </div>
  </body></html>`,
  { pretendToBeVisual: true, url: 'https://skybound.test/' }
);

global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
window.devicePixelRatio = 2;

function make2d() {
  const gradient = { addColorStop() {} };
  const base = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createConicGradient: () => gradient,
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'canvas') return null;
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

dom.window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
  if (type === '2d') return make2d();
  return null;
};

const { HUD } = await import('../src/hud/HUD.js');
const { FlightPhysics } = await import('../src/aircraft/FlightPhysics.js');
const { MobileControls } = await import('../src/controls/MobileControls.js');
const THREE = await import('three');

const calls = [];
const hud = new HUD(
  {
    onStart: () => calls.push('start'),
    onPause: () => calls.push('pause'),
    onResume: () => calls.push('resume'),
    onRestart: () => calls.push('restart'),
    onRespawn: () => calls.push('respawn'),
    onHelp: () => calls.push('help'),
    onHelpClose: () => calls.push('help-close'),
    onMute: () => calls.push('mute'),
    onCamera: () => calls.push('camera'),
    onFullscreen: () => calls.push('fullscreen'),
    onQuality: (q) => calls.push(`quality:${q}`),
    onUiScale: (v) => calls.push(`uiscale:${v}`),
    onAutoLock: (v) => calls.push(`autolock:${v}`),
    onAutoLockToggle: () => calls.push('autolock-toggle'),
    onAutopilotToggle: () => calls.push('autopilot-toggle'),
    onMap: (m) => calls.push(`map:${m}`),
    onGyroCalibrate: () => calls.push('gyro-cal'),
  },
  { touch: false, qualityLabel: 'HIGH' }
);

console.log('PASS  HUD constructed');
assert.ok(hud.root && hud.startScreen && hud.crashScreen, 'main HUD nodes');
assert.ok(document.getElementById('boot-fallback'), 'boot overlay kept in the DOM');
assert.ok(hud.bootOverlay, 'HUD holds a boot overlay reference');
assert.equal(document.getElementById('boot-fallback').classList.contains('ready'), false, 'not ready yet');

const source = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/hud/HUD.js', import.meta.url), 'utf8')
);
const ids = [...source.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(ids)].filter((id) => id !== 'boot-fallback' && !document.getElementById(id));
assert.deepEqual(missing, [], `missing HUD ids: ${missing.join(', ')}`);
console.log(`PASS  all ${new Set(ids).size} referenced element ids exist`);

assert.ok(document.querySelectorAll('.compass-tick').length > 100, 'compass ticks');
assert.ok(document.querySelectorAll('.ladder-line').length > 20, 'pitch ladder');
assert.equal(document.querySelectorAll('#boost-segments i').length, 12, 'boost segments');

hud.setProgress(0.42, 'CARVING ISLANDS');
assert.equal(hud.bootPercent.textContent, '42%');
assert.equal(document.getElementById('boot-load-fill').style.width, '42%', 'boot bar mirrors progress');
assert.equal(document.getElementById('boot-load-percent').textContent, '42%', 'boot percent mirrors');
assert.equal(
  document.getElementById('boot-load-label').textContent,
  'CARVING ISLANDS',
  'boot label mirrors progress'
);
hud.setReady({ islands: 15, trees: 4321, area: 480, cloudPuffs: 132 });
assert.equal(hud.startButton.disabled, false, 'start enabled');
assert.equal(document.getElementById('fact-trees').textContent, '4,321');
assert.equal(
  document.getElementById('boot-fallback').classList.contains('ready'),
  true,
  'boot overlay faded out when ready'
);
console.log('PASS  progress and ready stats update');

// Boot failure re-opens the overlay as an error panel.
hud.showBootFailure('TEST CRASH');
assert.equal(document.getElementById('boot-fallback').classList.contains('ready'), false, 'overlay re-shown');
assert.ok(
  document.querySelector('#boot-fallback .boot-fallback-sub').textContent.includes('TEST CRASH'),
  'failure message displayed'
);
hud.setProgress(1, 'ALL SYSTEMS NOMINAL');
hud.bootOverlay.classList.add('ready');
console.log('PASS  boot failure panel');

hud.startButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
hud.helpCard.querySelector('#btn-help-close').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
document
  .querySelector('#settings-quality-select [data-quality="low"]')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
document.getElementById('btn-view').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
document.getElementById('btn-fullscreen').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
document.getElementById('btn-autolock').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(document.getElementById('btn-autopilot'), null, 'AI button removed in favour of chat commands');
document
  .querySelector('#settings-map-select [data-map="city"]')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
document
  .querySelector('#settings-map-select [data-map="desert"]')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
document
  .querySelector('#settings-screen [data-gyrocal]')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.deepEqual(calls, [
  'start',
  'help-close',
  'quality:low',
  'camera',
  'fullscreen',
  'autolock-toggle',
  'map:city',
  'map:desert',
  'gyro-cal',
]);
console.log('PASS  HUD callbacks fire');

hud.setQuality('low');
assert.equal(
  document.querySelector('#settings-quality-select [data-quality="low"]').classList.contains('active'),
  true,
  'quality selection active'
);
hud.setMuted(true);
assert.equal(hud.muted, true);
hud.setMuted(false);
hud.showHelp(true);
assert.ok(hud.helpCard.classList.contains('visible'));
hud.showHelp(false);

hud.setPhase('flying');
const physics = new FlightPhysics();
for (let i = 0; i < 60; i++) physics.update(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 });
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 30000);
camera.position.copy(physics.position).add(new THREE.Vector3(0, 8, 30));
camera.lookAt(physics.position);
camera.updateMatrixWorld();

const world = {
  getHeightAt: (x, z) => {
    const dx = x + 320;
    const dz = z + 1520;
    return Math.max(0, 190 - Math.hypot(dx, dz) * 0.3);
  },
  getRadarContacts: (x, z) => [
    { x: -320, z: -1520, radius: 400, distance: 950, name: 'VERDANT CROWN', major: true },
  ],
};

for (let i = 0; i < 90; i++) {
  physics.update(1 / 60, { pitch: 0.1, roll: 0, yaw: 0, throttle: 0.8 });
  hud.update(1 / 60, {
    telemetry: physics.getTelemetry(),
    physics,
    world,
    camera,
  });
}
assert.equal(hud.phase, 'flying');
assert.ok(Number(hud.speedValue.textContent) > 0, 'speed readout populated');
assert.ok(Number(hud.altValue.textContent) > 0, 'altitude readout populated');
assert.ok(hud.compassStrip.style.transform.includes('translate3d'), 'compass transform');
assert.ok(hud.radarNearest.textContent.includes('VERDANT'), 'nearest contact readout');
assert.ok(hud.statusExtra.textContent.includes('VERDANT'), 'status contact readout');
assert.ok(document.querySelectorAll('.warning').length >= 0);
console.log('PASS  90 live HUD frames with instruments, ladder, radar');

hud.showPause(true);
assert.equal(hud.phase, 'paused');
assert.ok(hud.pauseScreen.classList.contains('visible'));
assert.equal(document.getElementById('btn-pause-settings').textContent, 'PENGATURAN', 'pause has a Setting button');
assert.equal(document.getElementById('btn-pause-menu').textContent, 'KEMBALI KE MENU', 'pause can return to the menu');
assert.equal(
  document.querySelectorAll('#pause-screen .settings-block, #pause-screen .setting-row').length,
  0,
  'pause panel no longer carries the setting list'
);
hud.showSettings(true);
assert.equal(hud.subScreen, 'settings', 'Setting opens from the pause panel');
assert.equal(hud.phase, 'paused', 'game stays paused behind the Setting panel');
assert.equal(
  document.getElementById('btn-settings-back').textContent,
  '← KEMBALI',
  'back label returns to the pause panel'
);
for (const id of ['btn-sound-toggle', 'btn-camera-cycle', 'hud-edit-select', 'btn-hud-reset']) {
  assert.ok(document.getElementById(id), `${id} moved into the Setting screen`);
}
document.getElementById('btn-settings-back').dispatchEvent(
  new dom.window.MouseEvent('click', { bubbles: true })
);
assert.equal(hud.subScreen, null, 'back closes the Setting panel');
assert.equal(hud.phase, 'paused', 'back returns to the pause panel, not the cockpit');
hud.showPause(false);
assert.equal(hud.phase, 'flying');

hud.showCrash({
  cause: 'Water impact.',
  speed: '420 KT',
  altitude: '13 M',
  time: '01:22',
  countdown: 4.5,
});
assert.equal(hud.phase, 'crashed');
assert.ok(hud.crashScreen.classList.contains('visible'));
assert.ok(document.getElementById('respawn-label').textContent.includes('5'));
hud.setRespawnCountdown(2.2);
assert.ok(document.getElementById('respawn-label').textContent.includes('3'));
console.log('PASS  pause and crash flows');

hud.resize();
hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera });
console.log('PASS  resize after live update');

// Camera label, combat panel and cockpit overlay.
hud.setCameraMode(1);
assert.equal(document.getElementById('btn-camera-cycle').textContent, '02 · COCKPIT');
assert.equal(document.getElementById('btn-view').textContent, '02', 'view button shows the preset');
assert.equal(hud.viewName.textContent, 'COCKPIT');
assert.equal(hud.viewIndex.textContent, '02');
hud.setCameraMode(0);
assert.equal(document.getElementById('btn-camera-cycle').textContent, '01 · CHASE');
assert.equal(document.getElementById('btn-view').textContent, '01');

// Fullscreen button state mirrors the browser API.
hud.setFullscreen(true);
assert.equal(document.getElementById('btn-fullscreen').classList.contains('active'), true, 'FS active');
assert.equal(document.getElementById('btn-fullscreen').getAttribute('aria-pressed'), 'true');
hud.setFullscreen(false);
assert.equal(document.getElementById('btn-fullscreen').classList.contains('active'), false, 'FS off');

hud.setCombat({ score: 450, kills: 3, hull: 62, missiles: Infinity, flares: 15, heat: 1 });
hud._updateWeaponPanel();
assert.equal(hud.hullValue.textContent, '62');
assert.equal(hud.killCount.textContent, '3');
assert.equal(hud.scoreValue.textContent, '0450');
assert.equal(hud.missileCount.textContent, '∞', 'unlimited missiles read as infinity');
assert.equal(document.getElementById('heat-fill'), null, 'no heat bar in the HUD');
assert.equal(document.getElementById('heat-value'), null, 'no overheat readout in the HUD');
assert.equal(hud.flareCount.textContent, '15', 'flare stock readout');
assert.equal(document.getElementById('inbound-value').textContent, '—', 'no inbound missile');
hud.setCombat({ hull: 12, missiles: Infinity });
hud._updateWeaponPanel();
assert.equal(hud.hullValue.classList.contains('critical'), true, 'low hull flagged');
assert.equal(hud.missileCount.textContent, '∞');
assert.equal(hud.weaponMode.textContent, 'GUN · MSL', 'no overheat status in the weapon title');
hud.setCombat({ flares: 0 });
hud._updateWeaponPanel();
assert.equal(hud.flareCount.textContent, '0');
assert.equal(hud.flareCount.classList.contains('critical'), true, 'empty flare stock flagged');

// Inbound missile: distance readout + top-priority warning.
hud.setCombat({ incoming: 850 });
hud._updateWeaponPanel();
assert.equal(document.getElementById('inbound-value').textContent, '850M', 'incoming range in metres');
hud.setCombat({ incoming: 1500 });
hud._updateWeaponPanel();
assert.equal(document.getElementById('inbound-value').textContent, '1.5K', 'long range in kilometres');
hud.setCombat({ incoming: null });
hud._updateWeaponPanel();
assert.equal(document.getElementById('inbound-value').textContent, '—', 'incoming cleared');

// Six frames so the 16 Hz instrument pass runs _updateWarnings.
const runFrames = (combat) => {
  for (let i = 0; i < 6; i++) {
    hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera, combat });
  }
};
runFrames({ incoming: 700 });
assert.ok(
  document.getElementById('warning-box').innerHTML.includes('MISSILE INBOUND'),
  'inbound warning shown'
);
runFrames({ incoming: null });
assert.equal(
  document.getElementById('warning-box').innerHTML.includes('MISSILE INBOUND'),
  false,
  'inbound warning cleared'
);

hud.setCockpitView(true);
assert.equal(hud.root.classList.contains('cockpit-active'), true);
assert.equal(hud.cockpitOverlay.classList.contains('visible'), true);
hud.setCockpitView(false);
assert.equal(hud.cockpitOverlay.classList.contains('visible'), false);

// Lock box tracks a target in front of the camera, hides it when out of view,
// and divides by uiScale so a scaled HUD (e.g. desktop 110%) lands on the exact pixel.
const target = { alive: true, position: physics.position.clone().add(new THREE.Vector3(0, 0, -400)) };
hud.setUiScale(1);
hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera, target });
const unscaledMatch = hud.targetBox.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
assert.ok(unscaledMatch, 'unscaled target box transform parsed');
hud.setUiScale(1.25);
hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera, target });
assert.equal(hud.targetBox.classList.contains('visible'), true, 'lock box visible on target');
const scaledMatch = hud.targetBox.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
assert.ok(scaledMatch, 'scaled target box transform parsed');
assert.ok(
  Math.abs(Number(scaledMatch[1]) * 1.25 - Number(unscaledMatch[1])) < 1e-3,
  'scaled target box CSS coordinate compensates for --ui-scale so screen position stays identical'
);
hud.setUiScale(1);
hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera, target });
assert.ok(hud.targetRange.textContent.includes('KM'), 'range readout');
assert.equal(hud.lockState.textContent, 'LOCK');
target.position.copy(physics.position).add(new THREE.Vector3(0, 0, 4000));
hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera, target });
assert.equal(hud.targetBox.classList.contains('visible'), false, 'box hides behind camera');
hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera, target: null });
assert.equal(hud.lockState.textContent, '—', 'no lock state');
console.log('PASS  view tag, weapon panel, cockpit overlay and lock box');

// Stage E: threat arrows (one per bandit) + compact enemy-only scope on the left.
assert.ok(document.getElementById('threat-arrows'), 'threat arrow host node');
assert.ok(document.getElementById('threat-radar-canvas'), 'threat scope canvas');
const dragIds = new Set(hud.hudDragTargets.map((t) => t.id));
for (const id of [
  'weapon',
  'radar',
  'threat',
  'engine',
  'status',
  'speed',
  'altitude',
  'viewtag',
  'hints',
  'brand',
  'compass',
  'topmeta',
  'viewbtn',
  'lockbtn',
  'fsbtn',
  'helpbtn',
  'soundbtn',
  'pausebtn',
]) {
  assert.ok(dragIds.has(id), `${id} registered for the HUD editor`);
}
assert.ok(
  hud.hudDragTargets.some((t) => t.id === 'threat'),
  'threat scope registered for the HUD editor'
);
assert.equal(
  document.querySelectorAll('.threat-arrow.visible').length,
  0,
  'arrows hidden with no contacts'
);

const mkBandit = (dx, dz, distance) => ({
  x: physics.position.x + dx,
  z: physics.position.z + dz,
  distance,
  enemy: true,
  major: true,
  radius: 120,
  name: 'BANDIT',
});
const arrowFrames = (contacts) => {
  for (let i = 0; i < 3; i++) {
    hud.update(1 / 60, { telemetry: physics.getTelemetry(), physics, world, camera, contacts });
  }
};
// Independent derivation: bearing from the heading-up compass frame.
const expectedAngle = (dx, dz) => {
  const rel = (Math.atan2(dx, -dz) * 180) / Math.PI - (physics.heading * 180) / Math.PI;
  return ((rel + 540) % 360) - 180;
};
const visibleArrows = () => [...document.querySelectorAll('.threat-arrow.visible')];
const arrowAngle = (arrow) => Number(arrow.style.transform.match(/rotate\(([-\d.]+)deg\)/)[1]);
const arrowLabel = (arrow) => arrow.lastElementChild.textContent;
const arrowLabelRotation = (arrow) =>
  Number(arrow.lastElementChild.style.transform.match(/rotate\(([-\d.]+)deg\)/)[1]);

arrowFrames([mkBandit(0, -3000, 3000)]);
let arrows = visibleArrows();
assert.equal(arrows.length, 1, 'one arrow for the single bandit');
assert.equal(arrows[0].classList.contains('nearest'), true, 'lone contact is the nearest');
assert.ok(
  Math.abs(arrowAngle(arrows[0]) - expectedAngle(0, -3000)) < 0.6,
  `dead-ahead bandit → ${arrowAngle(arrows[0])}° vs ${expectedAngle(0, -3000).toFixed(1)}°`
);
assert.equal(arrowLabel(arrows[0]), '3.0KM', 'arrow carries the bandit range');
assert.equal(arrowLabelRotation(arrows[0]), -arrowAngle(arrows[0]), 'label counter-rotates');

// Every bandit gets its own arrow, nearest first and highlighted.
arrowFrames([mkBandit(3000, 0, 1500), mkBandit(0, -3000, 3000)]);
arrows = visibleArrows();
assert.equal(arrows.length, 2, 'an arrow for every bandit');
assert.equal(arrowLabel(arrows[0]), '1.5KM', 'nearest contact listed first');
assert.equal(arrows[0].classList.contains('nearest'), true, 'nearest arrow highlighted');
assert.equal(arrows[1].classList.contains('nearest'), false, 'far arrow stays plain');
assert.equal(arrowLabel(arrows[1]), '3.0KM', 'second arrow carries its own range');
assert.ok(
  Math.abs(arrowAngle(arrows[0]) - expectedAngle(3000, 0)) < 0.6,
  `starboard bandit → ${arrowAngle(arrows[0])}° vs ${expectedAngle(3000, 0).toFixed(1)}°`
);
assert.ok(
  Math.abs(arrowAngle(arrows[0]) - 90) < 8,
  `arrow leans right for a bandit on the beam (${arrowAngle(arrows[0])}°)`
);
assert.ok(
  Math.abs(arrowAngle(arrows[1]) - expectedAngle(0, -3000)) < 0.6,
  `dead-ahead bandit keeps its bearing (${arrowAngle(arrows[1])}°)`
);

arrowFrames([]);
assert.equal(
  visibleArrows().length,
  0,
  'arrows hide when the sky is clear'
);

// The scope plots the same contacts: swap in a recording 2d context.
const scopeLog = [];
const gradient = { addColorStop() {} };
hud.threatRadarCtx = new Proxy(
  {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createConicGradient: () => gradient,
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'canvas') return null;
      return () => scopeLog.push(String(prop));
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }
);
arrowFrames([mkBandit(1200, -900, 1500), mkBandit(-4000, 1500, 4200)]);
assert.ok(scopeLog.includes('clearRect'), 'scope clears before drawing');
assert.ok(scopeLog.includes('arc'), 'scope plots the bandits');
assert.equal(document.getElementById('threat-radar-count').textContent, '2', 'scope counts bandits');
assert.equal(
  document.getElementById('threat-radar-nearest').textContent,
  '1.5 KM',
  'scope reads out the nearest bandit'
);
arrowFrames([]);
assert.equal(document.getElementById('threat-radar-count').textContent, '0', 'count clears');
assert.equal(document.getElementById('threat-radar-nearest').textContent, 'CLEAR', 'scope reads CLEAR');
console.log('PASS  threat arrow bearing + compact enemy scope');

// HUD side + button-layout settings toggle their classes and active buttons.
hud.setHudSide('right');
assert.equal(hud.root.classList.contains('hud-right'), true, 'hud-right class');
assert.equal(
  dom.window.document.querySelector('#settings-hud-side [data-hudside="right"]').classList.contains('active'),
  true,
  'KANAN active'
);
hud.setHudSide('left');
assert.equal(hud.root.classList.contains('hud-right'), false, 'back to left');
hud.setButtonLayout('left');
assert.equal(
  dom.window.document.querySelector('#settings-btn-layout [data-btnlayout="left"]').classList.contains('active'),
  true,
  'TOMBOL KIRI active'
);
hud.setButtonLayout('nonsense');
assert.equal(hud.buttonLayout, 'center', 'bad layout falls back to centre');
console.log('PASS  HUD side and button layout settings');

// Global UI scale: CSS variable, both readouts, slider clamp and callback.
assert.equal(hud.setUiScale(1.25), 1.25, 'ui scale clamps and returns');
assert.equal(document.documentElement.style.getPropertyValue('--ui-scale'), '1.25', 'scale variable set');
assert.equal(document.querySelector('#settings-screen .ui-scale-range').value, '1.25', 'settings slider synced');
assert.equal(document.querySelector('#settings-screen .ui-scale-value').textContent, '125%', 'settings readout synced');
assert.equal(
  document.querySelectorAll('#pause-screen .ui-scale-range').length,
  0,
  'pause panel no longer carries setting rows'
);
const uiRange = document.querySelector('#settings-screen .ui-scale-range');
uiRange.value = '1.4';
uiRange.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(hud.uiScale, 1.4, 'slider scales the UI live');
assert.ok(calls.includes('uiscale:1.4'), 'slider reports the new scale');
assert.equal(hud.setUiScale(9), 1.6, 'scale clamps at 160%');
assert.equal(hud.setUiScale(0.1), 0.8, 'scale clamps at 80%');
hud.setUiScale(1);
console.log('PASS  global UI scale variable, readouts and slider');

// Auto-lock toggle lights the HUD button and both settings rows.
hud.setAutoLock(true);
assert.equal(hud.autoLock, true, 'auto lock flag set');
assert.equal(document.getElementById('btn-autolock').classList.contains('active'), true, 'LCK button lit');
assert.equal(document.getElementById('btn-autolock').getAttribute('aria-pressed'), 'true', 'LCK aria pressed');
assert.equal(
  document.querySelector('#settings-autolock [data-autolock="on"]').classList.contains('active'),
  true,
  'settings row ON'
);
assert.equal(
  document.querySelectorAll('#pause-screen [data-autolock]').length,
  0,
  'auto-lock row lives on the settings screen only'
);
document.querySelector('#settings-autolock [data-autolock="off"]').dispatchEvent(
  new dom.window.MouseEvent('click', { bubbles: true })
);
assert.ok(calls.includes('autolock:false'), 'settings row reports OFF');
hud.setAutoLock(false);
assert.equal(document.getElementById('btn-autolock').classList.contains('active'), false, 'LCK button unlit');
console.log('PASS  auto-lock view toggle row and HUD button');

// Auto pilot (AI) state is driven via chat commands (`/hvskbnd` & `/stop`).
hud.setAutopilot(true);
assert.equal(hud.autopilot, true, 'autopilot flag set');
assert.equal(hud.root.classList.contains('ai-active'), true, 'HUD reflects AI active');
hud.openChat();
assert.equal(hud.isChatOpen(), true, 'chat bar opens');
hud.addChatMessage('SYSTEM', 'AI MODE AKTIF (/hvskbnd)', 'system');
assert.ok(document.getElementById('flight-chat-log').textContent.includes('/hvskbnd'), 'chat message appended');
hud.closeChat();
assert.equal(hud.isChatOpen(), false, 'chat bar closes');
hud.setAutopilot(false);
assert.equal(hud.root.classList.contains('ai-active'), false, 'HUD clears AI active');

// World map selector: the setting screen lights the active map.
hud.setMap('city');
assert.equal(hud.mapId, 'city', 'map id stored');
assert.equal(
  document.querySelector('#settings-map-select [data-map="city"]').classList.contains('active'),
  true,
  'settings KOTA active'
);
assert.equal(
  document.querySelectorAll('#pause-screen [data-map]').length,
  0,
  'map selector no longer duplicated in the pause panel'
);
assert.ok(
  document.getElementById('start-lead').textContent.includes('metropolis'),
  'start screen copy follows the city map'
);
hud.setMap('desert');
assert.ok(
  document.getElementById('start-lead').textContent.includes('dunes'),
  'start screen copy follows the desert map'
);
hud.setWorldFacts({ islands: 1, land: true, trees: 300, area: 638, cloudPuffs: 120 });
assert.equal(
  document.getElementById('fact-landlabel').textContent,
  'DARATAN',
  'land maps label the mainland instead of islands'
);
hud.setWorldFacts({ islands: 15, land: false, trees: 2100, area: 480, cloudPuffs: 70 });
assert.equal(
  document.getElementById('fact-landlabel').textContent,
  'ISLANDS',
  'coral restores the island label'
);
hud.setMap('nope');
assert.equal(hud.mapId, 'coral', 'unknown map id falls back to coral');
hud.setMap('coral');

// Gyro calibration entry point lives on the settings screen.
assert.equal(document.querySelectorAll('[data-gyrocal]').length, 1, 'calibrate button on the settings screen');
console.log('PASS  autopilot button, map selector and gyro calibration rows');

// Gyro row reflects state; HUD edit mode makes panels draggable + persisted.
hud.setGyro('on');
assert.equal(
  document.querySelector('#settings-gyro [data-gyro="on"]').classList.contains('active'),
  true,
  'GIRO HIDUP active'
);
hud.setGyro('off');
assert.equal(
  document.querySelector('#settings-gyro [data-gyro="off"]').classList.contains('active'),
  true,
  'GIRO MATI active'
);

const weapon = document.querySelector('.weapon-panel');
weapon.getBoundingClientRect = () => ({ left: 50, top: 300, width: 216, height: 120, right: 266, bottom: 420 });
hud.setHudEdit(true);
assert.equal(document.body.classList.contains('hud-edit'), true, 'edit class on body');
assert.equal(
  document.querySelector('#hud-edit-select [data-hudedit="on"]').classList.contains('active'),
  true,
  'GESER active'
);

function pe(type, x, y) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  event.pointerId = 9;
  event.clientX = x;
  event.clientY = y;
  weapon.dispatchEvent(event);
}
pe('pointerdown', 100, 320);
assert.equal(hud._hudDrag?.id, 'weapon', 'drag captured');
pe('pointermove', 400, 100);
assert.equal(weapon.style.left, '350px', 'panel follows pointer');
assert.equal(weapon.style.top, '80px', 'panel follows pointer vertically');
assert.equal(weapon.style.right, 'auto', 'anchored by left/top while dragging');
assert.equal(weapon.style.transform, 'none', 'css centring overridden');
pe('pointerup', 400, 100);
assert.equal(hud._hudDrag, null, 'drag released');
const savedPos = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos'));
assert.equal(savedPos.weapon.left, 350, 'position persisted');

// --- Tap (no movement) selects the panel and opens its editor --------------
function tap(type, x, y) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  event.pointerId = 11;
  event.clientX = x;
  event.clientY = y;
  weapon.dispatchEvent(event);
}
tap('pointerdown', 360, 90);
tap('pointerup', 360, 90);
assert.equal(weapon.classList.contains('selected'), true, 'tap selects the panel');
assert.equal(hud._selectedHud, 'weapon', 'selection tracked');
assert.equal(document.getElementById('hud-editor').hidden, false, 'editor opens');
assert.equal(document.getElementById('hud-editor-title').textContent, 'SENJATA', 'panel named');

// Regression: the editor floats inside `.hud` (pointer-events: none), so the
// panel itself has to opt back in or the + / − / RESET / × taps never land.
{
  const styles = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  );
  const block = styles.match(/\.hud-editor \{[^}]*\}/);
  assert.ok(block, 'hud-editor rule present');
  assert.match(block[0], /pointer-events:\s*auto/, 'hud-editor opts into pointer events');
  const coarse = [...styles.matchAll(/\.hud-editor-row > button \{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(
    coarse.some((rule) => /width:\s*32px/.test(rule)),
    'coarse pointers get bigger editor buttons'
  );
}

// Size: + / − in 10 % steps, 50 – 200 %.
const scaleUp = document.getElementById('hud-scale-up');
scaleUp.click();
assert.equal(weapon.style.transform, 'scale(1.1)', 'scale applied to the panel');
assert.equal(document.getElementById('hud-scale-value').textContent, '110%', 'scale readout');
scaleUp.click();
assert.equal(document.getElementById('hud-scale-value').textContent, '120%', 'second step');
document.getElementById('hud-scale-down').click();
assert.equal(document.getElementById('hud-scale-value').textContent, '110%', 'step back down');

// Transparency: 100 % down to 20 % in 10 % steps.
const opDown = document.getElementById('hud-opacity-down');
opDown.click();
opDown.click();
assert.equal(weapon.style.opacity, '0.8', 'opacity applied');
assert.equal(document.getElementById('hud-opacity-value').textContent, '80%', 'opacity readout');
for (let i = 0; i < 12; i++) opDown.click();
assert.equal(document.getElementById('hud-opacity-value').textContent, '20%', 'opacity floors at 20 %');

// Size + transparency persist through a layout restore.
const stored = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos'));
assert.equal(stored.weapon.scale, 1.1, 'scale persisted');
assert.equal(stored.weapon.opacity, 0.2, 'opacity persisted');
weapon.style.left = '';
weapon.style.top = '';
weapon.style.transform = '';
weapon.style.opacity = '';
hud.applyHudPositions();
assert.equal(weapon.style.left, '350px', 'position restored with the tweaks');
assert.equal(weapon.style.transform, 'scale(1.1)', 'scale restored');
assert.equal(weapon.style.opacity, '0.2', 'opacity restored');

// Reset this panel only.
document.getElementById('hud-panel-reset').click();
assert.equal(weapon.style.transform, '', 'reset clears scale');
assert.equal(weapon.style.opacity, '', 'reset clears opacity');
assert.equal(weapon.style.left, '', 'reset clears position');
const afterReset = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos'));
assert.equal(afterReset.weapon, undefined, 'reset drops the panel from storage');

// Close button hides the widget again.
document.getElementById('hud-editor-close').click();
assert.equal(document.getElementById('hud-editor').hidden, true, 'editor closes');
assert.equal(weapon.classList.contains('selected'), false, 'selection cleared');
console.log('PASS  per-panel editor: select, scale, transparency, reset');

// Off state takes the edit class away again.
hud.setHudEdit(false);
assert.equal(document.body.classList.contains('hud-edit'), false, 'edit class removed');
console.log('PASS  HUD edit mode drags and persists panel positions');

// --- Touch buttons: promoted to independent fixed panels ------------------
const touch = new MobileControls(
  {
    setStick() {},
    clearStick() {},
    setMobileButton() {},
  },
  { enabled: true }
);
// The buttons mount after the HUD bound its targets — rebind to pick them up.
hud._initHudDrag();

const fireBtn = touch.buttons.fire;
const mslBtn = touch.buttons.missile;
const flareBtn = touch.buttons.flare;
const boostBtn = touch.buttons.boost;
const brakeBtn = touch.buttons.brake;
assert.ok(fireBtn && mslBtn && flareBtn && boostBtn && brakeBtn, 'five action buttons mounted');

const RECTS = {
  fire: { left: 700, top: 560, width: 96, height: 96, right: 796, bottom: 656 },
  missile: { left: 580, top: 560, width: 96, height: 96, right: 676, bottom: 656 },
  flare: { left: 460, top: 560, width: 96, height: 96, right: 556, bottom: 656 },
  boost: { left: 700, top: 440, width: 96, height: 96, right: 796, bottom: 536 },
  brake: { left: 580, top: 440, width: 96, height: 96, right: 676, bottom: 536 },
};
fireBtn.getBoundingClientRect = () => RECTS.fire;
mslBtn.getBoundingClientRect = () => RECTS.missile;
flareBtn.getBoundingClientRect = () => RECTS.flare;
boostBtn.getBoundingClientRect = () => RECTS.boost;
brakeBtn.getBoundingClientRect = () => RECTS.brake;

hud.setHudEdit(true);
for (const [name, btn] of [
  ['fire', fireBtn],
  ['missile', mslBtn],
  ['flare', flareBtn],
  ['boost', boostBtn],
  ['brake', brakeBtn],
]) {
  assert.equal(btn.style.position, 'fixed', `${name} promoted to fixed`);
  assert.equal(btn.style.left, `${RECTS[name].left}px`, `${name} pinned at its measured rect`);
}
assert.equal(hud._hudStyleFor('fire').custom ?? false, false, 'promotion alone is not custom');
console.log('PASS  touch buttons promote to independent fixed panels');

function bpe(el, type, x, y) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  event.pointerId = 7;
  event.clientX = x;
  event.clientY = y;
  el.dispatchEvent(event);
}

// Dragging GUN must not move the other three buttons.
bpe(fireBtn, 'pointerdown', 720, 580);
assert.equal(hud._hudDrag?.id, 'fire', 'fire drag captured');
bpe(fireBtn, 'pointermove', 400, 300);
assert.equal(fireBtn.style.left, '380px', 'fire follows the pointer');
assert.equal(fireBtn.style.top, '280px', 'fire follows vertically');
assert.equal(mslBtn.style.left, '580px', 'missile stays put');
assert.equal(flareBtn.style.left, '460px', 'flare stays put');
assert.equal(boostBtn.style.top, '440px', 'boost stays put');
bpe(fireBtn, 'pointerup', 400, 300);
assert.equal(hud._hudDrag, null, 'fire released');
const btnPos = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos'));
assert.equal(btnPos.fire.left, 380, 'fire position persisted');
assert.equal(btnPos.missile, undefined, 'untouched button not persisted');
console.log('PASS  buttons drag independently and persist per button');

// Tap (no movement) opens the editor named after the button.
bpe(fireBtn, 'pointerdown', 400, 300);
bpe(fireBtn, 'pointerup', 400, 300);
assert.equal(hud._selectedHud, 'fire', 'tap selects the button');
assert.equal(document.getElementById('hud-editor').hidden, false, 'editor opens');
assert.equal(document.getElementById('hud-editor-title').textContent, 'GUN', 'button named GUN');

// Size + transparency are per button.
document.getElementById('hud-scale-up').click();
assert.equal(fireBtn.style.transform, 'scale(1.1)', 'fire scaled on its own');
assert.equal(mslBtn.style.transform, 'none', 'missile keeps its size');
document.getElementById('hud-opacity-down').click();
assert.equal(fireBtn.style.opacity, '0.9', 'fire transparency applied');
assert.equal(mslBtn.style.opacity, '', 'missile keeps its transparency');
const btnPos2 = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos'));
assert.equal(btnPos2.fire.scale, 1.1, 'fire scale persisted');
assert.equal(btnPos2.fire.opacity, 0.9, 'fire opacity persisted');
console.log('PASS  per-button scale and transparency');

// Layout switch clears only the buttons the user has NOT moved.
hud.setButtonLayout('left');
assert.equal(
  document.querySelector('#settings-btn-layout [data-btnlayout="left"]').classList.contains('active'),
  true,
  'TOMBOL KIRI active'
);
assert.equal(fireBtn.style.position, 'fixed', 'customised button keeps its spot');
assert.equal(fireBtn.style.left, '380px', 'customised button keeps its position');
assert.equal(fireBtn.style.transform, 'scale(1.1)', 'customised button keeps its size');
assert.equal(mslBtn.style.position, '', 'untouched button returns to the flex row');
assert.equal(mslBtn.style.left, '', 'untouched button loses its pinned rect');
assert.equal(boostBtn.style.top, '', 'untouched boost loses its pinned rect');
console.log('PASS  layout switch spares customised buttons');

// Reset this button only.
document.getElementById('hud-panel-reset').click();
assert.equal(fireBtn.style.position, '', 'reset unpins the button');
assert.equal(fireBtn.style.transform, '', 'reset clears scale');
assert.equal(fireBtn.style.opacity, '', 'reset clears transparency');
const afterBtnReset = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos'));
assert.equal(afterBtnReset.fire, undefined, 'reset drops the button from storage');

document.getElementById('hud-editor-close').click();
hud.setHudEdit(false);
assert.equal(document.body.classList.contains('hud-edit'), false, 'edit mode off after button suite');
console.log('PASS  touch buttons: independent drag, scale, layout, reset');

// --- Separate Portrait and Landscape HUD layouts ---------------------------
hud.resetHudPositions();
window.innerWidth = 1280;
window.innerHeight = 720;
hud.resize();
assert.equal(hud.getHudOrientation(), 'landscape', 'landscape detected when w >= h');
assert.equal(document.getElementById('hud-editor-mode').textContent, 'LANDSCAPE');

hud.setHudEdit(true);
assert.equal(document.getElementById('hud-edit-bar').hidden, false, 'HUD edit bar visible in edit mode');
assert.ok(
  hud.hudDragTargets.some((t) => t.id === 'missilecam'),
  'HUD MISSILE CAM registered as draggable panel'
);
assert.ok(
  hud.hudDragTargets.some((t) => t.id === 'touchcam'),
  'Mobile CAM button registered as draggable panel'
);
bpe(fireBtn, 'pointerdown', 720, 580);
bpe(fireBtn, 'pointermove', 320, 260);
bpe(fireBtn, 'pointerup', 320, 260);
assert.equal(fireBtn.style.left, '300px', 'landscape fire button at 300px');
const savedLandscape = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos.landscape'));
assert.equal(savedLandscape.fire.left, 300, 'landscape key stores 300px');

// Switch to Portrait (w < h): layout starts clean and saves to its own key.
window.innerWidth = 420;
window.innerHeight = 880;
hud.resize();
assert.equal(hud.getHudOrientation(), 'portrait', 'portrait detected when h > w');
assert.equal(document.getElementById('hud-editor-mode').textContent, 'PORTRAIT');
assert.notEqual(fireBtn.style.left, '300px', 'portrait does not inherit landscape drag');

bpe(fireBtn, 'pointerdown', 720, 580);
bpe(fireBtn, 'pointermove', 140, 500);
bpe(fireBtn, 'pointerup', 140, 500);
assert.equal(fireBtn.style.left, '120px', 'portrait fire button at 120px');
const savedPortrait = JSON.parse(dom.window.localStorage.getItem('skybound.hudPos.portrait'));
assert.equal(savedPortrait.fire.left, 120, 'portrait key stores 120px');

// Rotate back to Landscape: restores 300px automatically.
window.innerWidth = 1280;
window.innerHeight = 720;
hud.resize();
assert.equal(fireBtn.style.left, '300px', 'rotating back restores landscape layout');

// Rotate to Portrait again: restores 120px automatically.
window.innerWidth = 420;
window.innerHeight = 880;
hud.resize();
assert.equal(fireBtn.style.left, '120px', 'rotating to portrait restores portrait layout');

hud.setHudEdit(false);
window.innerWidth = 1024;
window.innerHeight = 768;
hud.resize();
console.log('PASS  separate landscape and portrait HUD layout persistence');

console.log('\nUI TESTS PASSED');
dom.window.close();
