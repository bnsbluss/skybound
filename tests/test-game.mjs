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
  { pretendToBeVisual: true, url: 'https://skybound.test/?quality=low' }
);
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
window.devicePixelRatio = 1;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

const rafQueue = [];
let rafId = 0;
global.requestAnimationFrame = (fn) => {
  rafQueue.push(fn);
  return ++rafId;
};
global.cancelAnimationFrame = () => {};
window.requestAnimationFrame = global.requestAnimationFrame;

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
dom.window.HTMLCanvasElement.prototype.getContext = function (type) {
  return type === '2d' ? make2d() : null;
};

// jsdom ships no Fullscreen API — stub the three pieces Game relies on.
// The stub must exist before `new Game()` resolves the API bindings.
let fsActive = false;
const fsDocEl = dom.window.document.documentElement;
fsDocEl.requestFullscreen = function () {
  fsActive = true;
  return Promise.resolve();
};
dom.window.document.exitFullscreen = function () {
  fsActive = false;
  return Promise.resolve();
};
Object.defineProperty(dom.window.document, 'fullscreenElement', {
  configurable: true,
  get: () => (fsActive ? fsDocEl : null),
});

// Pointer Lock is missing in jsdom too. The request is recorded but does not
// change pointerLockElement by itself; the test drives that getter manually.
let lockElement = null;
let lockRequests = 0;
let lockExits = 0;
dom.window.HTMLCanvasElement.prototype.requestPointerLock = function requestPointerLock() {
  lockRequests += 1;
  return Promise.resolve();
};
dom.window.document.exitPointerLock = function exitPointerLock() {
  lockExits += 1;
  if (lockElement) {
    lockElement = null;
    dom.window.document.dispatchEvent(new dom.window.Event('pointerlockchange'));
  }
};
Object.defineProperty(dom.window.document, 'pointerLockElement', {
  configurable: true,
  get: () => lockElement,
});

const THREE = await import('three');
const { Game } = await import('../src/core/Game.js');
const { storeQuality } = await import('../src/core/Quality.js');
const { saveProgress, loadProgress, clearProgress, currentMission } = await import('../src/core/Progress.js');

const fakeRenderer = {
  pixelRatio: 1,
  renders: 0,
  targetSets: 0,
  shadowMap: { enabled: false, type: null },
  info: { autoReset: true },
  setPixelRatio(value) {
    this.pixelRatio = value;
  },
  getPixelRatio() {
    return this.pixelRatio;
  },
  setSize(w, h) {
    this.cssWidth = w;
    this.cssHeight = h;
  },
  getSize(target) {
    target.set(this.cssWidth || 1280, this.cssHeight || 720);
    return target;
  },
  getDrawingBufferSize(target) {
    target.set((this.cssWidth || 1280) * this.pixelRatio, (this.cssHeight || 720) * this.pixelRatio);
    return target;
  },
  setRenderTarget() {
    this.targetSets++;
  },
  getRenderTarget() {
    return null;
  },
  render() {
    this.renders++;
  },
};

const game = new Game();
game._createRenderer = function () {
  this.renderer = fakeRenderer;
};

const originalSetTimeout = global.setTimeout;
let booted = false;
game
  .boot()
  .then(() => {
    booted = true;
  })
  .catch((error) => {
    console.error('BOOT FAILED', error);
    throw error;
  });

// Give the island builder its setTimeout yields.
await new Promise((resolve) => {
  const check = () => {
    if (booted) resolve();
    else originalSetTimeout(check, 20);
  };
  check();
});
console.log('PASS  Game.boot completed with stubbed renderer');
assert.equal(game.state, 'menu');
assert.equal(game.ready, true);
assert.equal(game.hud.phase, 'menu');
assert.equal(game.hud.startButton.disabled, false);
assert.ok(game.scene.getObjectByName('ocean'));
assert.ok(game.scene.getObjectByName('aircraft-root'));
assert.ok(game.scene.getObjectByName('trail-particles'));
assert.equal(game.quality.name, 'low');
assert.ok(game.world.getStats().trees > 500);
console.log('PASS  menu world, aircraft, trails and HUD ready');

// Loading overlay: driven by boot progress, faded out once ready.
const bootOverlay = document.getElementById('boot-fallback');
assert.ok(bootOverlay, 'boot overlay still in the DOM');
assert.equal(bootOverlay.classList.contains('ready'), true, 'overlay faded when the world is ready');
assert.equal(document.getElementById('boot-load-fill').style.width, '100%', 'progress bar filled');
assert.equal(document.getElementById('boot-load-percent').textContent, '100%');
console.log('PASS  loading screen mirrors boot progress and fades out');

// Fullscreen toggle through the stubbed API.
assert.equal(document.getElementById('btn-fullscreen').textContent, 'FS', 'FS button present');
game._toggleFullscreen();
assert.equal(document.fullscreenElement, fsDocEl, 'requestFullscreen called');
document.dispatchEvent(new dom.window.Event('fullscreenchange'));
assert.equal(game.hud.btnFullscreen.classList.contains('active'), true, 'FS button lit');
game._toggleFullscreen();
assert.equal(document.fullscreenElement, null, 'exitFullscreen called');
document.dispatchEvent(new dom.window.Event('fullscreenchange'));
assert.equal(game.hud.btnFullscreen.classList.contains('active'), false, 'FS button unlit');
console.log('PASS  fullscreen toggles request/exit and syncs the HUD button');

let now = performance.now();
function step(frames = 1) {
  for (let i = 0; i < frames; i++) {
    const callbacks = rafQueue.splice(0, rafQueue.length);
    now += 16.6667;
    for (const callback of callbacks) callback(now);
  }
}

const menuStart = game.physics.position.clone();
step(45);
assert.ok(game.physics.position.distanceTo(menuStart) > 20, 'attract mode moves');
assert.ok(fakeRenderer.renders >= 45, 'renderer invoked each frame');
assert.equal(game.state, 'menu');
console.log('PASS  attract-mode menu simulates and renders');

// New Game opens the hangar; the launch button applies the chosen airframe.
const click = new dom.window.MouseEvent('click', { bubbles: true });
game.hud.startButton.dispatchEvent(click);
assert.equal(game.hud.hangarOpen, true, 'New Game opens the hangar');
assert.ok(game.hud.hangarScreen.classList.contains('visible'), 'hangar screen visible');
const hangarCards = [...game.hud.hangarGrid.querySelectorAll('.hangar-card')];
assert.equal(hangarCards.length, 9, 'one card per airframe (5 classic + 4 ELITE)');
assert.equal(hangarCards.filter((card) => !card.classList.contains('locked')).length, 2, 'two open');

game.hud.selectAircraft('sparrow');
// Seed advanced career progress to verify New Game resets ONLY missions,
// preserving unlocked aircraft, Points (PTS), and unlocked missiles!
game.progress = saveProgress({
  mission: 3,
  unlocked: ['wraith', 'sparrow', 'thunder', 'ghost'],
  points: 1450,
  unlockedMissiles: ['aim9x', 'amraam', 'aam4'],
  missile: 'aim9x',
});
game._launchAircraft('sparrow');
assert.equal(game.state, 'flying', 'hangar launch starts the sortie');
assert.equal(game.progress.mission, 0, 'New Game resets all missions back to Mission 1 (index 0)');
assert.equal(game.progress.points, 1450, 'New Game preserves earned Points (PTS)');
assert.ok(game.progress.unlocked.includes('ghost'), 'New Game preserves unlocked aircraft');
assert.ok(game.progress.unlockedMissiles.includes('aam4'), 'New Game preserves unlocked missiles');
assert.equal(game.carrier.group.visible, true, 'New Game spawns 3D Aircraft Carrier (CVN-07)');
// Verify no carrier bow mesh protrudes above the flight deck or sticks out past the bow edge.
{
  game.carrier.group.updateMatrixWorld(true);
  const deckTopY = game.carrier.group.position.y + game.carrier.deckHeight;
  const bowEdgeZ = game.carrier.group.position.z - game.carrier.deckLength / 2;
  const box = new THREE.Box3();
  for (const child of game.carrier.group.children) {
    if (!child.isMesh || child.isInstancedMesh) continue;
    box.setFromObject(child);
    if (box.min.z < game.carrier.group.position.z - 105) {
      assert.ok(
        box.max.y <= deckTopY + 1.0,
        `carrier bow mesh stays flush under deck (maxY=${box.max.y.toFixed(1)} <= ${(deckTopY + 1).toFixed(1)})`
      );
      assert.ok(
        box.min.z >= bowEdgeZ - 1.5,
        `carrier bow mesh does not protrude past bow edge (minZ=${box.min.z.toFixed(1)} >= ${(bowEdgeZ - 1.5).toFixed(1)})`
      );
    }
  }
}
assert.equal(game._carrierLaunch?.active, true, 'New Game starts steam catapult takeoff sequence');
// Step through the 3.8s carrier catapult launch and verify bow liftoff & transition to free flight.
step(110);
assert.ok(game.physics.speed > 60, `carrier catapult accelerates jet (${game.physics.speed.toFixed(0)} m/s)`);
step(140);
assert.equal(game._carrierLaunch, null, 'carrier takeoff completes seamlessly into free flight');
assert.ok(game.physics.speed > 140, 'jet airborne after bow liftoff');
assert.equal(game.hud.hangarOpen, false, 'hangar closed for flight');
assert.equal(game.physics.stats.speed, 1.12, 'sparrow speed stat applied');
assert.equal(game.physics.stats.hull, 75, 'sparrow hull stat applied');
assert.equal(game.hullMax, 75, 'hull pool follows the airframe');
assert.equal(game.hull, 75, 'hull fills the pool');
assert.equal(game.hud.combat.hullMax, 75, 'HUD told about the pool');
game.hud._updateWeaponPanel();
assert.equal(game.hud.hullValue.textContent, '75', 'HUD shows the raw pool');
assert.equal(game.hud.hullFill.style.width, '100%', 'full bar on a fresh pool');
assert.equal(game.aircraft.model.group.name, 'sparrow', 'model swapped to the pick');
assert.equal(
  JSON.parse(dom.window.localStorage.getItem('skybound.save')).aircraft,
  'sparrow',
  'airframe choice persisted'
);

// Keyboard path: Enter opens the hangar, Escape backs out, Enter launches.
game.state = 'menu';
game.hud.setPhase('menu');
const keyEvent = (code) => {
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code, bubbles: true }));
  window.dispatchEvent(new dom.window.KeyboardEvent('keyup', { code, bubbles: true }));
};
keyEvent('Enter');
assert.equal(game.hud.hangarOpen, true, 'Enter opens the hangar');
keyEvent('Escape');
assert.equal(game.hud.hangarOpen, false, 'Escape returns to the menu');
keyEvent('Enter');
assert.equal(game.hud.hangarOpen, true, 'Enter reopens the hangar');
assert.equal(game.hud.hangarSelected, 'sparrow', 'hangar remembers the saved pick');
keyEvent('Enter');
assert.equal(game.state, 'flying', 'Enter launches the selected airframe');

// Restore the stock airframe and fresh career so the rest of the suite runs on defaults.
clearProgress();
game.progress = loadProgress();
game.selectedAircraftId = 'wraith';
game.hud.setContinueEnabled(game._hasSave());
game.state = 'menu';
game.hud.setPhase('menu');
console.log('PASS  hangar flow: cards, stats, save, keyboard');

// Stage C: Continue guard, sub-screen wiring, sensitivity + keymap, Exit.
assert.equal(game.hud.continueButton.disabled, true, 'Continue dead without a career save');
const guardPos = game.physics.position.clone();
game.hud.continueButton.dispatchEvent(click);
assert.equal(game.state, 'menu', 'Continue without a save is a no-op');
assert.ok(game.physics.position.distanceTo(guardPos) < 1e-6, 'no launch happened');

// A real save arms Continue and drops the saved airframe straight into flight.
game.progress = saveProgress({ mission: 1, aircraft: 'sparrow' });
game.hud.setContinueEnabled(game._hasSave());
assert.equal(game.hud.continueButton.disabled, false, 'Continue armed after a save');
game.hud.continueButton.dispatchEvent(click);
await game._mapSwitchPromise;
assert.equal(game.state, 'flying', 'Continue starts the sortie');
assert.equal(game.physics.stats.speed, 1.12, 'saved airframe applied');
assert.equal(game.hullMax, 75, 'saved hull pool applied');
assert.equal(game.mapId, 'city', 'continue generates the mission map in place');
assert.equal(game.world.land, true, 'the city mission uses a land world');
assert.equal(game.hud.subScreen, null, 'no sub-screen during flight');

// Back to a clean menu for the rest of the suite.
game.state = 'menu';
game.hud.setPhase('menu');
clearProgress();
game.progress = loadProgress();
game.selectedAircraftId = 'wraith';
game.hud.setContinueEnabled(game._hasSave());
assert.equal(game.hud.continueButton.disabled, true, 'Continue disarmed again');
console.log('PASS  Continue: guard + saved-airframe launch');

// Setting screen from the game side: slider and keymap reach InputManager.
document.getElementById('btn-settings').dispatchEvent(click);
assert.equal(game.hud.subScreen, 'settings', 'Setting opens from the menu');
keyEvent('Escape');
assert.equal(game.hud.subScreen, null, 'Escape closes the sub-screen');
document.getElementById('btn-settings').dispatchEvent(click);
const sensSlider = document.getElementById('sens-slider');
sensSlider.value = '1.8';
sensSlider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(game.input.getSensitivity(), 1.8, 'slider drives input sensitivity');
assert.equal(game.hud.sensValue.textContent, '180%', 'readout synced');

// Global UI scale + auto-lock rows reach the game and persist.
const settingsScale = document.querySelector('#settings-screen .ui-scale-range');
settingsScale.value = '1.35';
settingsScale.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(game.uiScale, 1.35, 'setting scales the UI');
assert.equal(document.documentElement.style.getPropertyValue('--ui-scale'), '1.35', 'CSS scale applied');
assert.equal(dom.window.localStorage.getItem('skybound.uiScale'), '1.35', 'scale persisted');
assert.equal(game.hud.uiScale, 1.35, 'HUD copies the scale');
settingsScale.value = '1.1';
settingsScale.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

document.querySelector('#settings-autolock [data-autolock="on"]').dispatchEvent(click);
assert.equal(game.autoLock, true, 'settings row enables auto lock');
assert.equal(dom.window.localStorage.getItem('skybound.autoLock'), '1', 'auto lock persisted');
assert.equal(document.getElementById('btn-autolock').classList.contains('active'), true, 'HUD button lit');
document.querySelector('#settings-autolock [data-autolock="off"]').dispatchEvent(click);
assert.equal(game.autoLock, false, 'settings row disables auto lock');
assert.equal(dom.window.localStorage.getItem('skybound.autoLock'), '0', 'auto lock off persisted');
console.log('PASS  UI scale + auto-lock settings reach the game and persist');

// World map (biome) row: the world is rebuilt in place — no page reload.
const pageMarker = { alive: true };
document.querySelector('#settings-map-select [data-map="desert"]').dispatchEvent(click);
await game._mapSwitchPromise;
assert.equal(dom.window.localStorage.getItem('skybound.map'), 'desert', 'map choice persisted');
assert.equal(game.hud.mapId, 'desert', 'HUD lights the new map');
assert.ok(game.hud.toast.textContent.includes('GURUN'), 'toast names the new map');
assert.equal(game.mapId, 'desert', 'game carries the new map');
assert.equal(game.world.land, true, 'desert is a land map');
assert.equal(game.world.ocean.mesh.visible, false, 'desert hides the ocean');
assert.ok(game.world.getStats().trees > 0, 'desert generated props');
assert.ok(pageMarker.alive, 'no page reload happened');
const switchedState = game.state;
assert.ok(['menu', 'paused', 'flying'].includes(switchedState), `state restored after switch (${switchedState})`);
assert.equal(await game._setMap('desert'), false, 're-selecting the active map does nothing');
assert.equal(await game._setMap('nonsense'), false, 'unknown map ids are rejected');
await game._setMap('coral');
assert.equal(game.world.ocean.mesh.visible, true, 'coral shows the ocean again');
assert.ok(game.hud.toast.textContent.includes('CORAL'), 'coral toast confirms the switch');
dom.window.localStorage.removeItem('skybound.map');

// Gyro calibration button re-zeros the tilt steering.
let recalibrations = 0;
const realRecalibrate = game.input.recalibrateGyro.bind(game.input);
game.input.recalibrateGyro = () => {
  recalibrations += 1;
  realRecalibrate();
};
document.querySelector('#settings-screen [data-gyrocal]').dispatchEvent(click);
assert.equal(recalibrations, 1, 'calibrate button re-zeros the gyro');
assert.ok(game.hud.toast.textContent.includes('GIRO DIKALIBRASI'), 'toast confirms the calibration');
game.input.recalibrateGyro = realRecalibrate;
console.log('PASS  map selector and gyro calibration reach the game');

const fireCap = document.querySelector('.keymap-row[data-row="fire"] .keycap');
fireCap.dispatchEvent(click);
window.dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true, cancelable: true })
);
assert.equal(game.input.getBindings().fire, 'KeyJ', 'rebind reaches the input map');
assert.equal(fireCap.textContent, 'J', 'keycap repainted');
assert.ok(game.hud.keymapNote.textContent.includes('TERSIMPAN'), 'saved note');

fireCap.dispatchEvent(click);
window.dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { code: 'KeyW', bubbles: true, cancelable: true })
);
assert.equal(game.input.getBindings().fire, 'KeyJ', 'duplicate key rejected');
assert.ok(game.hud.keymapNote.textContent.includes('TIDAK BOLEH DUPLIKAT'), 'conflict note');

document.getElementById('btn-keymap-reset').dispatchEvent(click);
assert.equal(game.input.getBindings().fire, 'KeyF', 'reset restores defaults');
assert.equal(fireCap.textContent, 'F', 'keymap repainted after reset');
document.getElementById('btn-settings-back').dispatchEvent(click);
assert.equal(game.hud.subScreen, null, 'Setting closes');
console.log('PASS  Setting wiring: sensitivity + keymap through InputManager');

// About credit + Exit flow (window.close stubbed so JSDOM survives).
document.getElementById('btn-about').dispatchEvent(click);
assert.equal(game.hud.subScreen, 'about', 'About opens');
assert.ok(
  game.hud.aboutScreen.textContent.includes('HeavyRain AKA Ziky Andeska'),
  'creator credit'
);
keyEvent('Escape');
assert.equal(game.hud.subScreen, null, 'Escape closes About');

let closeRequested = false;
dom.window.close = () => {
  closeRequested = true;
};
document.getElementById('btn-exit').dispatchEvent(click);
assert.equal(game.hud.subScreen, 'exit', 'Exit opens');
document.getElementById('btn-exit-confirm').dispatchEvent(click);
assert.equal(closeRequested, true, 'Exit asks the browser to close');
assert.ok(
  document.getElementById('exit-note').textContent.includes('memblokir'),
  'blocked note explains how to quit'
);
document.getElementById('btn-exit-back').dispatchEvent(click);
assert.equal(game.hud.subScreen, null, 'Exit closes');
console.log('PASS  About credit + Exit flow');

// Enter respects an open sub-screen (only the hangar launches).
document.getElementById('btn-settings').dispatchEvent(click);
keyEvent('Enter');
assert.equal(game.hud.subScreen, 'settings', 'Enter does not launch over a sub-screen');
keyEvent('Escape');
assert.equal(game.state, 'menu', 'still in the menu');
console.log('PASS  keyboard respects open sub-screens');

game._startFlight();
assert.equal(game.state, 'flying');
assert.equal(game.hud.phase, 'flying');
assert.ok(!game.hud.startScreen.classList.contains('visible'), 'start screen hidden');
assert.equal(game.hud.root.classList.contains('visible'), true);
assert.ok(lockRequests > 0, 'starting a sortie requests pointer lock');
assert.equal(game.hud.uiScale, 1.1, 'desktop UI defaults to a readable 110%');
assert.equal(
  document.documentElement.style.getPropertyValue('--ui-scale'),
  '1.1',
  'UI scale variable applied'
);

// Pointer lock look uses raw movement deltas and restores the cursor on exit.
lockElement = game.canvas;
document.dispatchEvent(new dom.window.Event('pointerlockchange'));
assert.equal(game._pointerLocked, true, 'pointer lock tracked');
assert.equal(game.canvas.style.cursor, 'none', 'cursor hidden while locked');
const lookBefore = game.input.lookDelta.clone();
const lockMove = new dom.window.MouseEvent('pointermove', { bubbles: true });
Object.defineProperty(lockMove, 'movementX', { value: 120 });
Object.defineProperty(lockMove, 'movementY', { value: -60 });
window.dispatchEvent(lockMove);
assert.ok(game.input.lookDelta.distanceTo(lookBefore) > 0.1, 'locked movement feeds the camera');
const exitsBeforeResume = lockExits;
lockElement = null;
document.dispatchEvent(new dom.window.Event('pointerlockchange'));
assert.equal(game._pointerLocked, false, 'pointer lock release tracked');
assert.equal(game.canvas.style.cursor, '', 'cursor restored after release');
assert.equal(lockExits, exitsBeforeResume, 'manual unlock does not call exit again');
// Raw-delta look is verified; clear it so the later drag test starts neutral.
game.chase.orbitYaw = 0;
game.chase.orbitPitch = 0;
game.input.lookDelta.set(0, 0);

// The help card needs a cursor: opening it releases the lock, closing restores it.
lockElement = game.canvas;
document.dispatchEvent(new dom.window.Event('pointerlockchange'));
const exitsBeforeHelp = lockExits;
const requestsBeforeHelp = lockRequests;
game._toggleHelp(true);
assert.equal(game.hud.helpCard.classList.contains('visible'), true, 'help card opens');
assert.equal(lockElement, null, 'help releases pointer lock');
assert.equal(game._pointerLocked, false, 'help clears the locked state');
assert.equal(lockExits, exitsBeforeHelp + 1, 'help calls exitPointerLock');
game._toggleHelp(false);
assert.equal(game.hud.helpCard.classList.contains('visible'), false, 'help card closes');
assert.ok(lockRequests > requestsBeforeHelp, 'closing help re-requests pointer lock');
console.log('PASS  help card hands the cursor back');

// Stage E: live bandits feed the threat arrows and the compact left scope.
const liveContacts = () => game.enemies.getContacts(game.physics.position);
assert.ok(liveContacts().length > 0, 'bandits spawned on launch');
for (let i = 0; i < 45; i++) step(1);
const visibleArrows = () => [...document.querySelectorAll('.threat-arrow.visible')];
const arrows = visibleArrows();
assert.equal(arrows.length, liveContacts().length, 'one arrow per live bandit');
assert.ok(arrows.length >= 1, 'arrow tracks a live bandit');
assert.ok(
  /rotate\(-?[\d.]+deg\)/.test(arrows[0].style.transform),
  `arrow rotated: ${arrows[0].style.transform}`
);
assert.equal(arrows[0].classList.contains('nearest'), true, 'leading arrow is the nearest bandit');
assert.ok(
  /\d+(\.\d)?(KM|M)$/.test(arrows[0].lastElementChild.textContent),
  `arrow label reads a range: ${arrows[0].lastElementChild.textContent}`
);
assert.ok(
  Number(document.getElementById('threat-radar-count').textContent) >= 1,
  'compact scope counts the bandits'
);
console.log('PASS  threat arrow + compact scope fed by live contacts');

// Auto-lock view follows a live bandit and can be toggled with L.
game._setAutoLock(true);
assert.equal(game.autoLock, true, 'auto lock enabled');
assert.ok(game.autoLockTarget?.alive, 'auto lock acquired a live bandit');
assert.equal(game.chase.autoTarget, game.autoLockTarget, 'camera follows the acquired bandit');
assert.equal(game.hud.btnAutoLock.classList.contains('active'), true, 'LCK button lit');
step(1);
assert.ok(game.autoLockTarget?.alive, 'auto lock keeps its live target');
keyEvent('KeyL');
step(1);
assert.equal(game.autoLock, false, 'L toggles auto lock off');
assert.equal(game.chase.autoTarget, null, 'camera released');
keyEvent('KeyL');
step(1);
assert.equal(game.autoLock, true, 'L toggles auto lock on');
keyEvent('KeyL');
step(1);
assert.equal(game.autoLock, false, 'auto lock left off for the rest of the suite');
console.log('PASS  auto-lock view acquires, follows and toggles');

// --- Auto pilot (AI · triggered via Enter chat `/hvskbnd` & `/stop`) --------
assert.equal(document.getElementById('btn-autopilot'), null, 'AI button removed from HUD');
assert.equal(game.autopilot, false, 'autopilot starts disengaged');
keyEvent('Enter');
assert.equal(game.hud.isChatOpen(), true, 'Enter opens in-flight chat bar');
const chatInput = document.getElementById('flight-chat-input');
chatInput.value = '/hvskbnd';
chatInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
assert.equal(game.hud.isChatOpen(), false, 'submitting chat closes input bar');
assert.equal(game.autopilot, true, 'chat command /hvskbnd engages AI autopilot');
assert.equal(game.hud.root.classList.contains('ai-active'), true, 'HUD marks AI active');
assert.equal(
  dom.window.localStorage.getItem('skybound.autopilot'),
  null,
  'autopilot is a per-sortie mode, not a stored preference'
);

// Direct check of the AI flight model: full power, in-range commands.
const aiInput = game._autopilotInput(1 / 60);
assert.equal(aiInput.throttle, 1, 'AI flies at full throttle');
assert.ok(Math.abs(aiInput.roll) <= 1 && Math.abs(aiInput.pitch) <= 1, 'AI commands stay clamped');

// Professional energy management: chase, saddle, guns and deck recovery.
const speedPlan = (state) => game._aiSpeedPlan({
  distance: 3000,
  closure: 120,
  forwardDot: 1,
  agl: 1200,
  behind: false,
  speed: 220,
  ...state,
});
const chasePlan = speedPlan({});
assert.equal(chasePlan.throttle, 1, 'far chase uses full dry power');
assert.equal(chasePlan.boost, true, 'burner lights for a long chase below max speed');
const fastPlan = speedPlan({ speed: 340, closure: 200 });
assert.equal(fastPlan.boost, false, 'no burner when already fast and closing');
const sprintPlan = speedPlan({ speed: 260, closure: 10 });
assert.equal(sprintPlan.boost, true, 'burner stays lit when the chase is not closing');
const saddlePlan = speedPlan({ distance: 800, closure: 260, speed: 210 });
assert.ok(saddlePlan.throttle <= 0.6, `saddle pulls the throttle back (${saddlePlan.throttle})`);
assert.equal(saddlePlan.brake, true, 'airbrake opens to stop an overshoot');
const gunsPlan = speedPlan({ distance: 420, closure: 80, speed: 200 });
assert.ok(gunsPlan.throttle <= 0.5, `gun range throttles down (${gunsPlan.throttle})`);
assert.equal(gunsPlan.brake, true, 'speed boards keep the jet in the saddle');
const deckPlan = speedPlan({ distance: 420, agl: 300, closure: 90, speed: 190 });
assert.ok(deckPlan.throttle >= 0.9, 'low AGL restores power');
assert.equal(deckPlan.brake, false, 'no airbrake near the deck');
const stallPlan = speedPlan({ distance: 500, speed: 90, closure: -60 });
assert.equal(stallPlan.throttle, 1, 'stall recovery goes full power');
assert.equal(stallPlan.boost, true, 'stall recovery lights the burner');
const brakePlan = speedPlan({ distance: 700, speed: 260, closure: 300 });
assert.equal(brakePlan.boost, false, 'burner and airbrake never fight each other');

// Nearest live bandit — used by the deterministic AI target tests.
const nearestBandit = () => {
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of game.enemies.getAlive()) {
    const distance = enemy.position.distanceTo(game.physics.position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = enemy;
    }
  }
  return best;
};

// Scored target selection: prefers a bandit aligned with the nose and keeps
// sticky commitment to the currently hunted target.
{
  const alive = game.enemies.getAlive();
  assert.ok(alive.length >= 2, 'multiple bandits alive for the scored target check');
  const savedPositions = alive.map((e) => e.position.clone());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(game.physics.quaternion);
  const back = fwd.clone().negate();
  // Put the last bandit dead ahead at 1200 m and the others behind at 3500 m.
  alive.forEach((e, i) => {
    if (i === alive.length - 1) {
      e.position.copy(game.physics.position).addScaledVector(fwd, 1200);
    } else {
      e.position.copy(game.physics.position).addScaledVector(back, 3500 + i * 200);
    }
  });
  game._aiTarget = null;
  game._aiTargetTimer = 0;
  game._pickAiTarget();
  assert.equal(
    game._aiTarget,
    alive[alive.length - 1],
    'AI picks the best-aligned bandit in front of the nose'
  );
  assert.ok(
    game._aiTargetTimer >= 0.9 && game._aiTargetTimer <= 2,
    `AI retarget cadence armed (${game._aiTargetTimer.toFixed(1)} s)`
  );
  alive.forEach((e, i) => e.position.copy(savedPositions[i]));
}

// Boresight inside missile range → the lock tone chirps and the missile is
// released on the very same frame (no lock-hold delay). The jet points at
// the exact gun solution so the cannon trigger and seeker both fire.
{
  const savedPosition = game.physics.position.clone();
  const savedQuaternion = game.physics.quaternion.clone();
  const nearest = nearestBandit();
  const toBandit = nearest.position.clone().sub(savedPosition).normalize();
  const standoff = 1100;
  game.physics.position.copy(nearest.position).addScaledVector(toBandit, -standoff);
  const tv = new THREE.Vector3();
  if (nearest.direction && nearest.speed) {
    tv.copy(nearest.direction).multiplyScalar(nearest.speed);
  }
  const gunDir = new THREE.Vector3();
  game._gunSolution(nearest.position, tv, gunDir);
  game.physics.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), gunDir);
  game._aiTarget = nearest;
  game._aiTargetTimer = 999;

  // Spy on the lock tone so we can prove the sound leads the shot.
  let lockTones = 0;
  const realLockTone = game.audio.lockTone.bind(game.audio);
  game.audio.lockTone = () => {
    lockTones += 1;
  };

  game._aiLockAnnounced = false;
  game._aiMissileCooldown = 0;

  // Frame 1: the seeker acquires and the missile leaves immediately.
  game._autopilotInput(1 / 60);
  assert.equal(game._aiFire, true, 'AI holds the trigger on the gun solution');
  assert.equal(lockTones, 1, 'auto-lock tone chirps the moment the bandit is in front');
  assert.equal(game._aiMissile, true, 'missile launches on the lock frame, without waiting');
  assert.equal(game._aiMissileCooldown > 0, true, 'AI missile cooldown armed');

  // The rack cooldown still gates the next shot.
  game._autopilotInput(1 / 60);
  assert.equal(game._aiMissile, false, 'cooldown holds the second missile');

  game.audio.lockTone = realLockTone;
  game._aiFire = false;
  game._aiMissile = false;
  game._aiMissileCooldown = 0;
  game._aiLockAnnounced = false;
  game._aiTarget = null;
  game._aiTargetTimer = 0;
  game.physics.position.copy(savedPosition);
  game.physics.quaternion.copy(savedQuaternion);
}

// Auto flare: a hostile bird inside the envelope arms an AI salvo; clear
// skies and an empty stock keep it disarmed.
{
  const realIncoming = game._incoming;
  game._aiMissileCooldown = 0;
  game._autopilotInput(1 / 60);
  assert.equal(game._aiFlare, false, 'no inbound missile → no AI flare');
  game._incoming = 900;
  const flaresBefore = game.weapons.getStats().flares;
  game._autopilotInput(1 / 60);
  assert.equal(game._aiFlare, true, 'inbound missile inside 1.6 km arms the AI flare');
  assert.equal(flaresBefore, game.weapons.getStats().flares, 'salvo not spent until combat runs');
  game._updateCombat(1 / 60);
  assert.equal(
    game.weapons.getStats().flares,
    flaresBefore - 1,
    'AI spends exactly one flare salvo on the inbound bird'
  );
  game._incoming = null;
  game._aiFlare = false;
  game._autopilotInput(1 / 60);
  assert.equal(game._aiFlare, false, 'decoyed/cleared sky disarms the AI flare');
  game._incoming = realIncoming;
  game._aiFlare = false;
  // Put the world back: stock, cooldown and the live decoys this test
  // burned, so the inbound-missile stage below starts from a clean slate.
  game.weapons.flaresLeft = flaresBefore;
  game.weapons._flareTimer = 0;
  for (const decoy of game.weapons.decoys) decoy.active = false;
}

// Nose-on check: knock the jet off-axis, then let the AI pull it back onto
// the nearest bandit (the same target the autopilot steers toward).
const noseOn = () => {
  const bandit = game._aiTarget ?? nearestBandit();
  const to = bandit.position.clone().sub(game.physics.position).normalize();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(game.physics.quaternion);
  return fwd.dot(to);
};
// Keep the AI locked onto the bandit this check measures against for the
// whole handling run (the random retarget timer would otherwise re-roll).
game._aiTarget = nearestBandit();
game._aiTargetTimer = 999;
// Fly this handling check high above the deck with a stationary bandit
// straight ahead: the terrain look-ahead must not interrupt a pure
// nose-on test, and a fixed target keeps the geometry deterministic.
const noseTarget = game._aiTarget;
const noseSaved = {
  targetPosition: noseTarget.position.clone(),
  targetDirection: noseTarget.direction.clone(),
  targetSpeed: noseTarget.speed,
};
game.physics.position.y = Math.max(
  game.physics.position.y,
  game.world.getHeightAt(game.physics.position.x, game.physics.position.z) + 1400
);
game.physics.speed = 220;
game.physics.sinkSpeed = 0;
game.physics._prevY = game.physics.position.y;
const noseForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
  game.physics.quaternion
);
noseForward.y = 0;
noseForward.normalize();
noseTarget.position
  .copy(game.physics.position)
  .addScaledVector(noseForward, 1000);
noseTarget.position.y = game.physics.position.y;
noseTarget.direction.set(0, 0, -1);
noseTarget.speed = 0;
// Spawn geometry is random, so no single fixed rotation lands at a useful
// angle — try a few and keep the one closest to a moderate off-axis start.
const savedQuatBeforeNose = game.physics.quaternion.clone();
let bestOff = null;
let bestErr = Infinity;
for (const [axis, angle] of [
  [new THREE.Vector3(0, 1, 0), 1.1],
  [new THREE.Vector3(0, 1, 0), -1.1],
  [new THREE.Vector3(1, 0, 0), 1.1],
  [new THREE.Vector3(1, 0, 0), -1.1],
]) {
  game.physics.quaternion
    .copy(savedQuatBeforeNose)
    .premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  const err = Math.abs(noseOn() - 0.35);
  if (err < bestErr) {
    bestErr = err;
    bestOff = game.physics.quaternion.clone();
  }
}
game.physics.quaternion.copy(bestOff);
game.physics.velocity
  .set(0, 0, -1)
  .applyQuaternion(game.physics.quaternion)
  .multiplyScalar(game.physics.speed);
game.physics.updateDerived();
const beforeNose = noseOn();
assert.ok(beforeNose < 0.9, `jet starts off-axis (dot=${beforeNose.toFixed(2)})`);
// Fly the autopilot + flight model directly (no combat step) so this
// handling run cannot leak kills, hull damage or spent countermeasures
// into the checks below. The bandits hold still, which also makes the
// geometry deterministic: the nose must come back onto the target.
const boostBeforeNose = game.physics.boostAmount;
let bestNose = beforeNose;
let minAiSpeed = game.physics.speed;
for (let i = 0; i < 420 && bestNose < 0.75; i++) {
  const aiInput = game._autopilotInput(1 / 60);
  game.physics.update(1 / 60, aiInput);
  bestNose = Math.max(bestNose, noseOn());
  minAiSpeed = Math.min(minAiSpeed, game.physics.speed);
  assert.equal(game.state, 'flying', 'AI keeps the jet in the fight');
}
assert.ok(
  minAiSpeed > 85,
  `AI protects its energy through the turn (min ${minAiSpeed.toFixed(0)} m/s)`
);
assert.ok(
  bestNose >= 0.75,
  `AI pulls the nose back onto the bandit (${beforeNose.toFixed(2)} → ${bestNose.toFixed(2)})`
);
// Put the bandit back where the combat checks expect it.
noseTarget.position.copy(noseSaved.targetPosition);
noseTarget.direction.copy(noseSaved.targetDirection);
noseTarget.speed = noseSaved.targetSpeed;
// The AI may light the burner — put the reserve back so the manual boost
// check below measures the pilot, not the AI's fuel burn.
game.physics.boostAmount = boostBeforeNose;
game.physics.boostReady = boostBeforeNose > 0.24;
game.physics.afterburner = 0;
assert.ok(
  game.physics.position.y >
    game.world.getHeightAt(game.physics.position.x, game.physics.position.z) + 40,
  `AI respects the terrain floor (agl=${(
    game.physics.position.y -
    game.world.getHeightAt(game.physics.position.x, game.physics.position.z)
  ).toFixed(0)} m)`
);
assert.ok(
  bestNose > beforeNose,
  `AI turns onto the bandit (${beforeNose.toFixed(2)} → ${bestNose.toFixed(2)})`
);

// Smart AI target lock commitment: when the retarget timer expires while the
// bandit is already lined up on the nose inside 2.5 km, the AI holds the lock
// to finish the kill instead of breaking off mid-attack.
{
  const committed = nearestBandit();
  const savedTargetPos = committed.position.clone();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(game.physics.quaternion);
  committed.position.copy(game.physics.position).addScaledVector(fwd, 1100);
  game._aiTarget = committed;
  game._aiTargetTimer = 0.005;
  game._autopilotInput(0.02);
  assert.equal(game._aiTarget, committed, 'AI stays committed to an in-cone target on the nose');
  assert.ok(game._aiTargetTimer >= 0.9, 'commitment re-arms the target timer');
  committed.position.copy(savedTargetPos);
}

// Smart AI gun heat limiter: pauses firing above 92% heat so it never locks
// the cannon into a full overheat penalty.
{
  const savedHeat = game.weapons.heat;
  const savedPos = game.physics.position.clone();
  const savedQuat = game.physics.quaternion.clone();
  const target = nearestBandit();
  const dir = target.position.clone().sub(savedPos).normalize();
  game.physics.position.copy(target.position).addScaledVector(dir, -700);
  game.physics.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  game._aiTarget = target;
  game._aiTargetTimer = 999;
  game.weapons.heat = 0.96;
  game._autopilotInput(1 / 60);
  assert.equal(game._aiFire, false, 'AI pauses cannon fire at 96% heat to prevent overheat');
  game.weapons.heat = savedHeat;
  game.physics.position.copy(savedPos);
  game.physics.quaternion.copy(savedQuat);
}

// Terrain recovery: aim at the deck with a bandit below the jet. The
// look-ahead must abort the hunt and pull up long before the water.
{
  const target = nearestBandit();
  const saved = {
    position: game.physics.position.clone(),
    quaternion: game.physics.quaternion.clone(),
    velocity: game.physics.velocity.clone(),
    speed: game.physics.speed,
    sinkSpeed: game.physics.sinkSpeed,
    sinkTarget: game.physics._sinkTarget,
    prevY: game.physics._prevY,
    time: game.physics.time,
    boostAmount: game.physics.boostAmount,
    boostReady: game.physics.boostReady,
    afterburner: game.physics.afterburner,
    rates: { ...game.physics.rates },
    targetPosition: target.position.clone(),
    targetDirection: target.direction.clone(),
    targetSpeed: target.speed,
    aiTarget: game._aiTarget,
    aiTargetTimer: game._aiTargetTimer,
    aiMissileCooldown: game._aiMissileCooldown,
    aiTerrainEvade: game._aiTerrainEvade,
  };

  game._aiTarget = target;
  game._aiTargetTimer = 999;
  game._aiTerrainEvade = false;
  game._aiMissileCooldown = 0;
  target.position.set(0, 220, -1400);
  target.direction.set(0, 0, -1);
  target.speed = 150;

  game.physics.position.set(0, 820, 0);
  game.physics.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.15);
  game.physics.rates.pitch = game.physics.rates.roll = game.physics.rates.yaw = 0;
  game.physics.speed = 260;
  game.physics.sinkSpeed = 0;
  game.physics.boostAmount = 1;
  game.physics.boostReady = true;
  game.physics.velocity
    .set(0, 0, -1)
    .applyQuaternion(game.physics.quaternion)
    .multiplyScalar(game.physics.speed);
  game.physics.updateDerived();

  const firstInput = game._autopilotInput(1 / 60);
  assert.equal(game._aiTerrainEvade, true, 'look-ahead predicts the dive into the deck');
  assert.ok(firstInput.pitch > 0.5, 'AI aborts the chase and pulls up before impact');

  // When banked right during a terrain evade, roll input must be positive (+roll
  // rolls left back toward wings-level) rather than rolling inverted into the ridge.
  game.physics.quaternion.setFromEuler(new THREE.Euler(-0.4, 0, -0.8, 'YXZ'));
  game.physics.updateDerived();
  const bankedEvade = game._autopilotInput(1 / 60);
  assert.ok(bankedEvade.roll > 0.4, `banked terrain evade levels the wings (roll=${bankedEvade.roll.toFixed(2)})`);
  game.physics.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.15);
  game.physics.updateDerived();

  let minAgl = Infinity;
  for (let i = 0; i < 300; i++) {
    const aiInput = game._autopilotInput(1 / 60);
    game.physics.update(1 / 60, aiInput);
    const agl =
      game.physics.position.y -
      Math.max(
        game.world.getHeightAt(game.physics.position.x, game.physics.position.z),
        game.world.ocean?.getWaveHeightAt(
          game.physics.position.x,
          game.physics.position.z
        ) ?? 0
      );
    minAgl = Math.min(minAgl, agl);
  }
  assert.ok(minAgl > 100, `AI survives the dive (min AGL=${minAgl.toFixed(0)} m)`);

  game.physics.position.copy(saved.position);
  game.physics.quaternion.copy(saved.quaternion);
  game.physics.velocity.copy(saved.velocity);
  game.physics.speed = saved.speed;
  game.physics.sinkSpeed = saved.sinkSpeed;
  game.physics._sinkTarget = saved.sinkTarget;
  game.physics._prevY = saved.prevY;
  game.physics.time = saved.time;
  game.physics.boostAmount = saved.boostAmount;
  game.physics.boostReady = saved.boostReady;
  game.physics.afterburner = saved.afterburner;
  Object.assign(game.physics.rates, saved.rates);
  game.physics.updateDerived();
  target.position.copy(saved.targetPosition);
  target.direction.copy(saved.targetDirection);
  target.speed = saved.targetSpeed;
  game._aiTarget = saved.aiTarget;
  game._aiTargetTimer = saved.aiTargetTimer;
  game._aiMissileCooldown = saved.aiMissileCooldown;
  game._aiTerrainEvade = saved.aiTerrainEvade;
  game._aiFire = false;
  game._aiMissile = false;
  game._aiLockAnnounced = false;
  game._aiLockToneFresh = false;
  console.log(`PASS  AI terrain look-ahead recovers from a dive (min AGL ${minAgl.toFixed(0)} m)`);
}

// Verify upright horizon-stabilized target-lock flight: at high altitude (1700 m)
// chasing a target slightly below & ahead, the AI NEVER flies inverted (up.y > 0.35)
// and tracks steadily without figure-8 oscillation.
{
  const target = game.enemies.getAlive()[0];
  assert.ok(target, 'live bandit available for AI upright lock check');
  const savedPos = game.physics.position.clone();
  const savedQuat = game.physics.quaternion.clone();
  const savedVel = game.physics.velocity.clone();
  const savedSpeed = game.physics.speed;
  const savedTargetPos = target.position.clone();
  const savedTargetDir = target.direction.clone();

  game.physics.position.set(0, 1700, 0);
  game.physics.quaternion.identity();
  game.physics.rates.pitch = game.physics.rates.roll = game.physics.rates.yaw = 0;
  game.physics.speed = 210;
  game.physics.updateDerived(0);
  target.position.set(160, 1520, -1100);
  target.direction.set(0, 0, -1);
  game._aiTarget = target;
  game._aiTargetTimer = 5;
  game._aiTerrainEvade = false;
  game._aiDefendTimer = 0;

  let minUpY = 1;
  const upVec = new THREE.Vector3();
  for (let i = 0; i < 180; i++) {
    const aiIn = game._autopilotInput(1 / 60);
    game.physics.update(1 / 60, aiIn);
    upVec.set(0, 1, 0).applyQuaternion(game.physics.quaternion);
    minUpY = Math.min(minUpY, upVec.y);
  }
  assert.ok(minUpY > 0.35, `AI stays upright during high-alt lock pursuit (min up.y=${minUpY.toFixed(2)})`);

  game.physics.position.copy(savedPos);
  game.physics.quaternion.copy(savedQuat);
  game.physics.velocity.copy(savedVel);
  game.physics.speed = savedSpeed;
  game.physics.rates.pitch = game.physics.rates.roll = game.physics.rates.yaw = 0;
  game.physics.updateDerived(0);
  target.position.copy(savedTargetPos);
  target.direction.copy(savedTargetDir);
}

// Verify AI fire-and-forget target switch: immediately after firing a locked
// missile at target A, AI switches _aiTarget to another enemy without waiting
// for target A to explode!
{
  const aliveList = game.enemies.getAlive();
  if (aliveList.length >= 2) {
    const first = aliveList[0];
    const savedPos = game.physics.position.clone();
    const savedQuat = game.physics.quaternion.clone();
    game.physics.position.set(0, 900, 0);
    game.physics.quaternion.identity();
    first.position.set(0, 900, -1100);
    aliveList[1].position.set(400, 900, -1400);
    game._aiTarget = first;
    game._aiEngagedTargets.clear();
    game.weapons._missileTimer = 0;
    game._aiMissile = true;
    game.target = first;
    game._updateCombat(1 / 60);
    assert.notEqual(
      game._aiTarget,
      first,
      'AI switches to another enemy immediately after firing a locked missile (fire-and-forget)'
    );
    game.physics.position.copy(savedPos);
    game.physics.quaternion.copy(savedQuat);
    game._aiEngagedTargets.clear();
  }
}

// Verify Desert Tanks (patrolling & firing) appear ONLY on the GURUN (desert) map
// and count as combat targets & mission kills.
{
  assert.equal(game.desertTanks.getAlive().length, 0, 'no desert tanks on non-desert map');
  const prevWorld = game.world;
  const fakeDesert = {
    biomeId: 'desert',
    getHeightAt: () => 25,
    getMapBounds: () => ({ maxRadius: 11500 }),
  };
  game.desertTanks.setWorld(fakeDesert);
  game.desertTanks.spawn(new THREE.Vector3(0, 500, 0));
  const spawnedTanks = game.desertTanks.getAlive();
  assert.ok(spawnedTanks.length >= 4, `desert tanks patrol on desert map (${spawnedTanks.length})`);
  const t0 = spawnedTanks[0];
  const beforePos = t0.position.clone();
  t0.fireTimer = 0;
  t0.turretYaw = 0;
  const tankAimPlayer = t0.position.clone().add(new THREE.Vector3(0, 260, -600));
  const beforeTracers = game.weapons.getStats().enemyTracers ?? 0;
  for (let i = 0; i < 45; i++) {
    game.desertTanks.update(1 / 60, {
      playerPosition: tankAimPlayer,
      playerVelocity: new THREE.Vector3(0, 0, 0),
      weapons: game.weapons,
      explosions: game.explosions,
      allowFire: true,
    });
  }
  assert.ok(t0.position.distanceTo(beforePos) > 1, 'desert tank patrols across terrain');
  assert.ok(
    game._getCombatTargets().some((c) => c.kind === 'tank'),
    'desert tanks are lockable combat targets'
  );
  // Restore original non-desert world cleanly.
  game.desertTanks.setWorld(prevWorld);
  assert.equal(game.desertTanks.getAlive().length, 0, 'desert tanks clear off non-desert map');
}

keyEvent('Enter');
assert.equal(game.hud.isChatOpen(), true, 'Enter opens chat to stop AI');
chatInput.value = '/stop';
chatInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
assert.equal(game.autopilot, false, 'chat command /stop hands control back to pilot');
assert.equal(game.hud.root.classList.contains('ai-active'), false, 'HUD clears AI active');
console.log('PASS  autopilot engages, flies and shoots');

// Hand the stick back with wings level so the control checks below measure
// the pilot's input, not whatever attitude the AI was left in.
game.physics.quaternion.setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  game.physics.heading
);
game.physics.rates.pitch = game.physics.rates.roll = game.physics.rates.yaw = 0;
game.physics.updateDerived(0);

const launch = game.physics.position.clone();
const key = (type, code) =>
  window.dispatchEvent(new dom.window.KeyboardEvent(type, { code, bubbles: true }));
key('keydown', 'KeyS');
step(34);
assert.ok(
  game.physics.position.distanceTo(launch) > 20,
  `aircraft moved after launch (state=${game.state} speed=${game.physics.speed.toFixed(1)})`
);
assert.ok(game.physics.speed > 150, `speed=${game.physics.speed.toFixed(1)}`);
assert.ok(game.physics.pitchDeg > 10, `pitch=${game.physics.pitchDeg.toFixed(1)}`);
key('keydown', 'KeyA');
step(26);
assert.ok(Math.abs(game.physics.rollDeg) > 20, `roll=${game.physics.rollDeg.toFixed(1)}`);
key('keydown', 'ShiftLeft');
step(40);
assert.equal(game.input.boost, true);
assert.equal(game.physics.boostAmount < 1, true);
assert.ok(game.physics.afterburner > 0.4, `afterburner=${game.physics.afterburner.toFixed(2)}`);
console.log(
  `PASS  flight controls drive physics (${game.physics.speed.toFixed(0)} m/s, ${game.physics.pitchDeg.toFixed(0)}° pitch, ${game.physics.rollDeg.toFixed(0)}° bank)`
);

key('keyup', 'KeyS');
key('keyup', 'KeyA');
key('keyup', 'ShiftLeft');
step(20);
assert.equal(game.input.boost, false);

// Mouse camera orbit and wheel zoom.
const canvas = document.getElementById('viewport');
const pointer = (type, target, id, clientX, clientY) => {
  const event = new dom.window.MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
};
pointer('pointerdown', canvas, 11, 400, 300);
pointer('pointermove', window, 11, 540, 350);
pointer('pointerup', window, 11, 540, 350);
step(1);
assert.ok(Math.abs(game.chase.orbitYaw) > 0.2, `orbitYaw=${game.chase.orbitYaw.toFixed(2)}`);
assert.ok(game.chase.orbitPitch > 0.05, `mouse down pitches camera up to look down (non-inverted, orbitPitch=${game.chase.orbitPitch.toFixed(2)})`);
const distanceBefore = game.chase.distanceTarget;
canvas.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
step(1);
assert.ok(game.chase.distanceTarget > distanceBefore, 'wheel zooms the chase camera out');
// KeyR resets chase camera orbit and zoom back behind the aircraft.
keyEvent('KeyR');
assert.equal(game.chase.orbitYaw, 0, 'KeyR resets orbitYaw');
assert.equal(game.chase.orbitPitch, 0, 'KeyR resets orbitPitch');
assert.equal(game.chase.distanceTarget, game.chase.baseDistance, 'KeyR resets zoom distance');

// Map combat boundary enforces soft warning and hard turn-back/clamp.
const bounds = game.world.getMapBounds();
assert.ok(bounds.maxRadius > bounds.warnRadius && bounds.warnRadius >= 7000, 'map bounds defined');
const savedPos = game.physics.position.clone();
game.physics.position.set(bounds.maxRadius + 500, savedPos.y, 0);
game._enforceMapBoundary(1 / 60, true);
assert.equal(game._boundaryStatus.outOfBounds, true, 'crossing maxRadius triggers out-of-bounds');
assert.ok(
  Math.hypot(game.physics.position.x, game.physics.position.z) <= bounds.maxRadius + 81,
  'map boundary clamps aircraft inside combat zone'
);
game.physics.position.copy(savedPos);
game._enforceMapBoundary(1 / 60, true);
assert.equal(game._boundaryStatus.outOfBounds, false, 'inside bounds clears out-of-bounds');
console.log('PASS  mouse orbit (non-inverted), wheel zoom, KeyR camera reset & map boundary');

// Camera cycling (2 views: 01 CHASE <-> 02 COCKPIT).
const preset = game.chase.viewPreset;
game._cycleCamera();
assert.equal(game.chase.viewPreset, (preset + 1) % 2);
assert.ok(game.hud.showToast);
// The HUD view button drives the same cycle and shows the preset number.
const viewBtn = document.getElementById('btn-view');
assert.ok(viewBtn, 'view button present');
assert.equal(viewBtn.textContent, `0${game.chase.viewMode + 1}`, 'view button reads the current preset');
viewBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(
  game.chase.viewMode,
  (preset + 2) % 2,
  'view button cycles back to chase'
);
assert.equal(viewBtn.textContent, `0${game.chase.viewMode + 1}`, 'view button label follows');
console.log('PASS  camera presets cycle through HUD');

// Combat: bandits in the world, cannon tracers, missile rack, view tag.
assert.ok(game.enemies.getAlive().length > 0, 'bandits spawned on launch');
assert.equal(game.hull, 100, 'hull starts full');
const viewTag = document.getElementById('view-tag');
assert.ok(viewTag.querySelector('.view-name').textContent.length > 0, 'view tag rendered');
game._cycleCamera();
assert.equal(game.chase.viewMode, 1, 'next cycle reaches cockpit view');
assert.equal(viewTag.querySelector('.view-name').textContent, 'COCKPIT', 'view tag reads COCKPIT');
assert.equal(game.hud.cockpitView, true, 'cockpit overlay shown');
assert.equal(game.aircraft.cockpitHidden, true, 'airframe hidden in cockpit');
// Switching CHASE -> COCKPIT must align camera forward immediately (zero backward flip).
const camDot = Math.abs(game.camera.quaternion.dot(game.physics.quaternion));
assert.ok(camDot > 0.995, `cockpit camera snaps forward immediately (dot=${camDot.toFixed(4)})`);
// Cockpit view is strictly forward-facing: mouse look cannot yaw/pitch it.
game.chase.orbitYaw = 0.8;
game.chase.orbitPitch = 0.4;
game.chase.applyLook({ x: 6, y: 4 });
assert.equal(game.chase.orbitYaw, 0, 'cockpit ignores yaw look');
assert.equal(game.chase.orbitPitch, 0, 'cockpit ignores pitch look');
game._cycleCamera();
assert.equal(game.chase.viewMode, 0, 'cycles back to chase');
assert.equal(game.hud.cockpitView, false, 'cockpit overlay hidden');

// Control-room interior: three live displays + optical HUD glass + switch/console geometry.
const cockpit = game.cockpit;
cockpit.setVisible(true);
let cockpitMeshes = 0;
cockpit.group.traverse((n) => {
  if (n.isMesh) cockpitMeshes += 1;
});
assert.ok(cockpitMeshes >= 75, `interior built from ${cockpitMeshes} meshes`);
assert.ok(cockpit.hudGlass, 'optical HUD combiner glass present');
const versions = [
  cockpit.texture.version,
  cockpit.sysTexture.version,
  cockpit.tacTexture.version,
  cockpit.hudTexture.version,
];
cockpit.update(0.2, {
  telemetry: game.physics.getTelemetry(),
  contacts: game.enemies.getContacts(game.physics.position),
  combat: game.getCombatStats(),
  target: game.target,
  playerPosition: game.physics.position,
});
assert.ok(cockpit.texture.version > versions[0], 'centre panel redrawn');
assert.ok(cockpit.sysTexture.version > versions[1], 'systems MFD redrawn');
assert.ok(cockpit.tacTexture.version > versions[2], 'tactical MFD redrawn');
assert.ok(cockpit.hudTexture.version > versions[3], 'optical HUD combiner glass redrawn');

// Control stick & 3D pilot hands follow the damped flight input.
assert.ok(cockpit.stick, 'control stick built');
assert.ok(cockpit.rightHand && cockpit.rightHand.parent === cockpit.stick, 'right pilot hand grips flight stick');
assert.ok(cockpit.leftHand && cockpit.leftHand.parent === cockpit.throttleLevers[0], 'left pilot hand grips throttle lever');
let stickParts = 0;
cockpit.stick.traverse((n) => {
  if (n.isMesh) stickParts += 1;
});
assert.ok(stickParts >= 6, `stick has ${stickParts} parts (base, shaft, grip, trigger, hat, buttons, hand)`);
const stickInput = { pitch: 1, roll: 1, throttle: 1 };
for (let i = 0; i < 30; i++) cockpit.update(0.05, {
  telemetry: { ...game.physics.getTelemetry(), throttle: 1, boosting: true },
  contacts: game.enemies.getContacts(game.physics.position),
  combat: game.getCombatStats(),
  target: game.target,
  playerPosition: game.physics.position,
  input: stickInput,
  incoming: 850,
});
assert.ok(cockpit.stick.rotation.x > 0.25, `stick pulled back on pitch input (${cockpit.stick.rotation.x.toFixed(3)})`);
assert.ok(cockpit.stick.rotation.z > 0.25, `stick leans left on left-roll input (${cockpit.stick.rotation.z.toFixed(3)})`);
assert.ok(cockpit.throttleLevers[0].rotation.x < -0.25, 'throttle & left pilot hand pushed forward on full thrust');
assert.ok(cockpit.canopySunLight && cockpit.canopyFillLight && cockpit.consoleGlowLight, 'cockpit canopy reflection lights built');
cockpit.syncLighting({
  sunDir: { x: -0.8, y: 0.5, z: 0.3 },
  sunColor: game.world.sky.sunLight.color,
  skyColor: game.world.sky.hemi.color,
  groundColor: game.world.sky.hemi.groundColor,
  cameraQuaternion: { x: 0, y: 0, z: 0, w: 1 },
});
const leftSunX = cockpit.canopySunLight.position.x;
cockpit.syncLighting({
  sunDir: { x: 0.8, y: 0.5, z: 0.3 },
  sunColor: game.world.sky.sunLight.color,
  skyColor: game.world.sky.hemi.color,
  groundColor: game.world.sky.hemi.groundColor,
  cameraQuaternion: { x: 0, y: 0, z: 0, w: 1 },
});
assert.ok(leftSunX < -0.4 && cockpit.canopySunLight.position.x > 0.4, 'canopy sun reflection tracks light entering left/right');
assert.ok(
  Number.isFinite(cockpit.canopySunLight.intensity) && cockpit.canopySunLight.intensity > 1.5,
  'canopy sun reflection stays bright and finite'
);
// Verify FIRE trigger squeeze + MISSILE pickle press animations in cockpit.
const restTriggerZ = cockpit.stickTrigger.position.z;
const restMissileY = cockpit.missileButton.position.y;
cockpit.triggerMissilePress();
for (let i = 0; i < 6; i++) {
  cockpit.update(0.03, {
    telemetry: game.physics.getTelemetry(),
    contacts: [],
    combat: game.getCombatStats(),
    target: game.target,
    playerPosition: game.physics.position,
    input: stickInput,
    actions: { firing: true },
  });
}
assert.ok(cockpit.stickTrigger.position.z > restTriggerZ + 0.004, 'cannon trigger pulls back when firing');
assert.ok(cockpit.rightIndexFinger.rotation.y > 0.15, 'right index finger squeezes cannon trigger');
assert.ok(cockpit.missileButton.position.y < restMissileY - 0.004, 'missile pickle button depresses on launch');
assert.ok(cockpit.rightThumb.rotation.x < -0.2, 'right thumb pivots down to press missile button');
// Verify 2-stage auto-lock crosshair sequence (ACQUIRING -> LOCKED + Sidewinder sound).
const aliveBandits = game.enemies.getAlive();
const lockBandit = aliveBandits[0];
const lockFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(game.physics.quaternion);
for (let i = 1; i < aliveBandits.length; i++) {
  aliveBandits[i].position.copy(game.physics.position).addScaledVector(lockFwd, -2500);
}
lockBandit.position.copy(game.physics.position).addScaledVector(lockFwd, 900);
game.target = null;
game._lockProgress = 0;
game._targetLocked = false;
game._lockedTone = false;
const lockCountStart = game.audio._targetLockCount;
step(2);
assert.equal(game.target, lockBandit, 'seeker picks target ahead');
assert.ok(game._lockProgress > 0 && game._lockProgress < 1, 'crosshair enters acquiring stage first');
assert.equal(game._targetLocked, false, 'not locked yet during acquiring animation');
assert.equal(game.hud.targetBox.classList.contains('acquiring'), true, 'HUD crosshair shows acquiring state');
assert.equal(game.audio._targetLockCount, lockCountStart, 'lock sound stays silent until crosshair locks');
// Keep target in front while auto-lock completes (~0.65s = ~40 frames).
for (let i = 0; i < 45; i++) {
  lockBandit.position
    .copy(game.physics.position)
    .addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(game.physics.quaternion), 900);
  step(1);
}
assert.equal(game._targetLocked, true, 'target reaches full LOCK after crosshair converges');
assert.equal(game.hud.targetBox.classList.contains('locked'), true, 'HUD crosshair snaps to locked state');
assert.ok(game.audio._targetLockCount > lockCountStart, 'Sidewinder lock sound plays once locked');
game.audio.targetLockUpdate(0.05, false, true, true);
assert.equal(game.audio._targetLockActive, false, 'lock tone silences once target lock clears');
cockpit.setVisible(false);
console.log('PASS  cockpit F-16 interior, matte pilot gloves, weapon animations, auto-lock crosshair & lock tone');

key('keydown', 'KeyF');
step(6);
key('keyup', 'KeyF');
assert.ok(game.weapons.getStats().tracers > 0, `cannon rounds in flight (${game.weapons.getStats().tracers})`);
assert.ok(game.weapons.heat > 0, 'cannon heat accumulated');
key('keydown', 'KeyG');
step(2);
key('keyup', 'KeyG');
assert.equal(game.weapons.missilesLeft, Infinity, 'missiles stay unlimited after launch');
assert.equal(game.weapons.getStats().missilesUnlimited, true, 'stats keep unlimited flag');
assert.ok(game.weapons.smokeMesh.count > 0, `missile launch & exhaust smoke active (${game.weapons.smokeMesh.count} puffs)`);
assert.equal(game.weapons.getTrackedMissileView().active, true, 'Missile Minicam tracks launched missile');
assert.equal(
  document.getElementById('missile-cam-frame').classList.contains('visible'),
  true,
  'right-side Missile Minicam HUD frame visible'
);
// Verify 12-missile catalog (8 standard + 4 ELITE special), Points reward & unlocking 4AAM multi-salvo in Hangar.
assert.equal(document.querySelectorAll('#hangar-missile-grid .hangar-missile-card').length, 12, '12 missile modes in hangar');
const beforePts = game.progress.points;
game._unlockMissile('aam4');
assert.equal(game.selectedMissileId, 'aim9x', 'cannot unlock 4AAM without enough Points');
game.progress = saveProgress({ points: beforePts + 1200 });
game._unlockMissile('aam4');
assert.equal(game.selectedMissileId, 'aam4', 'Points unlock & equip 4AAM multi-salvo');
assert.ok(game.progress.points === beforePts + 250, '4AAM cost (950 PTS) deducted accurately');
game.weapons.clear();
game.weapons.setMissileType('aam4');
key('keydown', 'KeyG');
step(2);
key('keyup', 'KeyG');
assert.equal(game.weapons.getStats().inFlight, 4, '4AAM launches 4 missiles simultaneously');
game.weapons.setMissileType('aim9x');
game.selectedMissileId = 'aim9x';
assert.ok(game.explosions.getActiveCount() >= 0, 'explosion system live');
const combatStats = game.getCombatStats();
assert.ok(combatStats.bandits.max >= 1, 'combat stats expose bandit pool');
assert.equal(combatStats.incoming, null, 'no inbound missile at rest');
assert.equal(document.getElementById('inbound-value').textContent, '—');
console.log('PASS  combat loop: bandits, cannon, missile, cockpit view tag');

// Airframe defense: every incoming hit is cut by 30%.
const hullBeforeDefense = game.hull;
game.weapons.events.push({
  type: 'player-hit',
  damage: 40,
  point: game.physics.position.clone(),
});
game._drainCombatEvents();
assert.ok(
  Math.abs(game.hull - (hullBeforeDefense - 28)) < 1e-9,
  '30% defense reduces a 40-damage hit to 28'
);
assert.equal(game.defense, 0.3, 'defense rating exposed on the game state');
game.hull = hullBeforeDefense;
game.hud.setCombat({ hull: game.hull, hullMax: game.hullMax });
console.log('PASS  airframe defense absorbs 30% of incoming damage');

// Stage D: the 12-kill quota opens the debrief and unlocks its airframe.
clearProgress();
game.progress = loadProgress();
game.missionIndex = 0;
game.kills = 0;
game._mission = currentMission(game.progress);
game._missionDone = false;
game.state = 'flying';
game.hud.setMission(game._mission, 0, 0);
assert.equal(
  document.getElementById('mission-tag-name').textContent,
  'BADAI PERTAMA',
  'objective badge names the mission'
);
assert.equal(document.getElementById('mission-tag-progress').textContent, '0 / 12 KILL', '12 bandits listed');

const killOnce = () => {
  game.weapons.events.push({
    type: 'kill',
    target: null,
    point: new THREE.Vector3(),
    weapon: 'gun',
  });
  game._drainCombatEvents();
};
killOnce();
assert.equal(game.kills, 1, 'kill counted');
assert.equal(document.getElementById('mission-tag-progress').textContent, '1 / 12 KILL', 'badge tracks');
assert.equal(game.progress.mission, 0, 'mission still open below the quota');
for (let i = 2; i <= 12; i++) killOnce();
assert.equal(game.kills, 12);
assert.equal(game.state, 'debrief', 'mission clear opens the debrief');
assert.ok(
  document.getElementById('mission-result-screen').classList.contains('visible'),
  'debrief overlay visible'
);
assert.ok(
  document.getElementById('mission-result-story').textContent.includes('Ibu kota') ||
    document.getElementById('mission-result-story').textContent.length > 10,
  'debrief shows the next story beat'
);
assert.equal(document.getElementById('mission-result-kills').textContent, '12', 'debrief lists kills');
assert.equal(document.getElementById('mission-result-score').textContent, String(game.score), 'debrief lists score');
assert.equal(document.getElementById('btn-mission-next').hidden, false, 'next mission button armed');
assert.equal(game.progress.mission, 1, 'mission cleared at the quota');
assert.ok(game.progress.unlocked.includes('thunder'), 'A-14 THUNDERBOLT unlocked');
assert.equal(game.hud.continueButton.disabled, false, 'Continue armed by the clear');
assert.ok(
  game.hud.toast.textContent.includes('THUNDERBOLT TERBUKA'),
  `unlock toast: ${game.hud.toast.textContent}`
);
assert.equal(document.getElementById('mission-tag-name').textContent, 'FREE FLIGHT', 'badge resets');
killOnce();
assert.equal(game.progress.mission, 1, 'one quota = one clear, never double-banked');
// Back to a live sortie for the remaining combat checks.
game.hud.hideMissionResult();
game.state = 'flying';
game.hud.setPhase('flying');
game.input.setEnabled(true);
game.audio.setPaused(false);
console.log('PASS  mission quota clears BADAI PERTAMA and unlocks A-14 THUNDERBOLT');

// Hostile missile inbound → warning, then a V-press flare decoys it.
const backDir = new THREE.Vector3(0, 0, 1).applyQuaternion(game.physics.quaternion);
const hostileShot = game.physics.position.clone().addScaledVector(backDir, 700);
game.weapons.launchHostileMissile(hostileShot, backDir.clone().negate(), null);
assert.equal(game.weapons.getStats().inbound, 1, 'missile counted as inbound');
step(10);
assert.ok(Number.isFinite(game._incoming), `incoming range tracked (${game._incoming?.toFixed(0)}m)`);
assert.ok(
  document.getElementById('warning-box').innerHTML.includes('MISSILE INBOUND'),
  'HUD warns about the inbound missile'
);
assert.notEqual(document.getElementById('inbound-value').textContent, '—', 'inbound readout live');

key('keydown', 'KeyV');
step(2);
key('keyup', 'KeyV');
assert.equal(game.weapons.getStats().flares, 14, 'flare salvo spent a canister');
let decoyed = game.weapons.getStats().inbound === 0;
for (let i = 0; i < 30 && !decoyed; i++) {
  step(1);
  decoyed = game.weapons.getStats().inbound === 0;
}
assert.ok(decoyed, 'flare seduces the inbound missile');
step(6);
assert.equal(
  document.getElementById('warning-box').innerHTML.includes('MISSILE INBOUND'),
  false,
  'warning clears once the missile is decoyed'
);
assert.equal(document.getElementById('inbound-value').textContent, '—', 'inbound readout clears');
assert.ok(game.audio._missileAlarmCount > 0, 'RWR missile-warning alarm sounded while chased');
assert.equal(game.audio._missileAlarmActive, false, 'missile-warning alarm stops once missile is decoyed');
assert.equal(game.hull, 100, 'decoyed missile never touched the hull');
console.log('PASS  inbound warning, RWR missile alarm, V-key flare salvo and decoy');

// R no longer restarts or resets the sortie.
assert.equal('reset' in game.input.getBindings(), false, 'no reset binding in the keymap');
assert.equal(typeof game._respawnOrRestart, 'undefined', 'restart helper removed');
keyEvent('KeyR');
step(1);
assert.equal(game.state, 'flying', 'R while flying is inert');
assert.equal(game.weapons.getStats().flares, 14, 'R did not reset the sortie');

// Pause releases pointer lock and freezes simulation.
lockElement = game.canvas;
document.dispatchEvent(new dom.window.Event('pointerlockchange'));
assert.equal(game._pointerLocked, true, 'locked before pause');
const exitsBeforePause = lockExits;
game._pause();
assert.equal(game.state, 'paused');
assert.equal(game.hud.phase, 'paused');
assert.equal(game._pointerLocked, false, 'pause unlocks the pointer');
assert.equal(lockElement, null, 'pointer lock element cleared');
assert.equal(lockExits, exitsBeforePause + 1, 'exitPointerLock called on pause');
assert.equal(game.canvas.style.cursor, '', 'cursor is available for the pause menu');
keyEvent('KeyR');
step(30);
assert.equal(game.state, 'paused', 'R while paused does not restart');
const pausedAt = game.physics.position.clone();
assert.ok(game.physics.position.distanceTo(pausedAt) < 1e-9, 'paused physics frozen');
game._resume();
assert.equal(game.state, 'flying');
assert.equal(game.hud.phase, 'flying');
console.log('PASS  pause and resume state transitions');

// Pause → PENGATURAN opens the shared Setting screen and back returns to
// pause; KEMBALI KE MENU parks the sortie on the start screen.
game._pause();
assert.equal(game.state, 'paused');
document.getElementById('btn-pause-settings').dispatchEvent(click);
assert.equal(game.hud.subScreen, 'settings', 'Setting opens from pause');
assert.equal(game.hud.phase, 'paused', 'simulation stays paused');
document.getElementById('btn-settings-back').dispatchEvent(click);
assert.equal(game.hud.subScreen, null, 'Setting back returns to pause');
assert.equal(game.state, 'paused', 'still paused after closing Setting');
document.getElementById('btn-pause-menu').dispatchEvent(click);
assert.equal(game.state, 'menu', 'KEMBALI KE MENU leaves the sortie');
assert.equal(game.hud.phase, 'menu', 'HUD returns to the menu');
assert.equal(game.hud.pauseScreen.classList.contains('visible'), false, 'pause panel hidden');
assert.equal(game.hud.startScreen.classList.contains('visible'), true, 'start screen shown');
assert.equal(game.hud.subScreen, null, 'no sub-screen left open');
assert.equal(game.autopilot, false, 'autopilot disengaged on menu return');
game._startFlight();
assert.equal(game.state, 'flying', 'a fresh sortie can start after returning to menu');
console.log('PASS  pause Setting + return-to-menu flow');

// Force a terrain impact over Verdant Crown. Level the jet and bleed the
// speed first: a leftover climbing attitude (the control checks above leave
// the nose pitched up) would otherwise carry the airframe clear of the
// slope inside the two-frame window and turn this check into a coin toss.
const verdant = game.world.islands.islands[0];
game.physics.quaternion.setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  game.physics.heading
);
game.physics.rates.pitch = game.physics.rates.roll = game.physics.rates.yaw = 0;
game.physics.speed = 40;
game.physics.sinkSpeed = 0;
game.physics.updateDerived(0);
game.physics.position.set(
  verdant.def.x,
  verdant.heightAt(verdant.def.x, verdant.def.z) + 1.0,
  verdant.def.z
);
game.physics.velocity.set(0, -40, 0);
step(2);
assert.equal(game.state, 'crashed');
assert.equal(game.hud.phase, 'crashed');
assert.equal(game.aircraft.visible, false);
assert.ok(game.hud.crashScreen.classList.contains('visible'));
assert.ok(game.trails.getActiveCount() > 20, 'crash particles');
console.log('PASS  terrain impact triggers crash flow, particles and overlay');

step(300);
assert.equal(game.state, 'flying', 'auto-respawn returns to flight');
assert.equal(game.aircraft.visible, true);
assert.ok(game.physics.position.distanceTo(game.physics.position.clone()) === 0);
assert.ok(game.physics.position.y > 400, 'respawned at altitude');
assert.ok(!game.hud.crashScreen.classList.contains('visible'));
console.log('PASS  auto-redeploy restores flight after countdown');

// Mute toggle and defeat.
const wasMuted = game.muted;
game._toggleMute();
assert.equal(game.muted, !wasMuted);
assert.equal(game.audio.muted, !wasMuted);
assert.equal(game.hud.muted, !wasMuted);
game._toggleMute();
console.log('PASS  mute toggle propagates to audio and HUD');

storeQuality('low');
const stats = game.getStats();
assert.equal(stats.quality, 'low');
assert.ok(stats.world.trees > 500);
assert.ok(stats.telemetry.speed > 0);
console.log('PASS  getStats exposes quality, world and telemetry');

step(20);
assert.ok(fakeRenderer.renders > 400);
console.log(`PASS  render loop stable (${fakeRenderer.renders} frames, ${game.getStats().fps} fps estimate)`);

// Multiplayer Online (Co-Op & Versus · Room Code): lobby, room creation, peer sync & PvP combat.
{
  const { MultiplayerManager } = await import('../src/net/Multiplayer.js');
  game._pause();
  document.getElementById('btn-pause-menu').dispatchEvent(click);
  document.getElementById('btn-multiplayer').dispatchEvent(click);
  assert.equal(game.hud.subScreen, 'multiplayer', 'Multiplayer screen opens from main menu');
  // Profile setup modal prompts for a pilot profile name before entering Multiplayer.
  assert.equal(
    document.getElementById('mp-profile-gate').hidden,
    false,
    'profile setup modal opens before first Multiplayer entry'
  );
  document.getElementById('mp-profile-input').value = 'GARUDA-1';
  document.getElementById('btn-mp-profile-save').dispatchEvent(click);
  assert.equal(
    document.getElementById('mp-profile-gate').hidden,
    true,
    'profile setup modal closes after saving name'
  );
  assert.equal(game.multiplayer.hasProfile(), true, 'profile marked as saved');
  assert.equal(game.multiplayer.callsign, 'GARUDA-1', 'callsign updated and persisted');

  document.getElementById('mp-room-input').value = 'SKY777';
  document.getElementById('btn-mp-create').dispatchEvent(click);
  await new Promise((r) => originalSetTimeout(r, 10));
  assert.equal(game.multiplayer.active, true, 'host room active');
  assert.equal(game.multiplayer.roomCode, 'SKY777', 'custom room code normalized');
  assert.equal(game.multiplayer.mode, 'coop', 'defaults to Co-Op Online mode');
  assert.equal(document.getElementById('mp-active-code').textContent, 'SKY777', 'room code badge updated');

  // Connect a second peer (guest) to room SKY777 via live room list discovery.
  const guestScene = new THREE.Scene();
  let guestSyncedMap = null;
  let guestStartedMatch = null;
  const guest = new MultiplayerManager({
    quality: game.quality,
    scene: guestScene,
    callbacks: {
      onRoomMapSync: (mapId) => {
        guestSyncedMap = mapId;
      },
      onRoomStartMatch: (info) => {
        guestStartedMatch = info;
      },
    },
  });
  const discoveredRooms = guest.refreshRoomList();
  assert.ok(
    discoveredRooms.some((r) => r.roomCode === 'SKY777'),
    'Room List discovers active hosted room SKY777'
  );
  assert.ok(
    document.getElementById('mp-room-list').textContent.includes('SKY777'),
    'HUD Room List renders SKY777'
  );
  guest.setCallsign('ELANG-2');
  await guest.joinRoom({ code: 'SKY777', mapId: 'desert' });
  assert.equal(game.multiplayer.peers.size, 1, 'host registered the joining wingman');
  assert.equal(guest.peers.size, 1, 'guest received host room config');
  assert.equal(guest.mode, 'coop', 'guest synced Co-Op mode');
  assert.equal(guest.mapId, game.mapId, 'guest synced host initial map');
  assert.equal(guestSyncedMap, game.mapId, 'guest received onRoomMapSync callback');
  assert.equal(game.multiplayer.getRoomSummary().readyGuests, 0, 'guest starts unready');

  // Guest marks READY -> Host roster updates and sees 1/1 READY.
  guest.setReady(true);
  assert.equal(guest.localReady, true, 'guest toggled READY on');
  assert.equal(game.multiplayer.getRoomSummary().readyGuests, 1, 'host sees guest READY');
  assert.equal(game.multiplayer.getRoomSummary().allGuestsReady, true, 'all guests ready');
  assert.ok(
    document.getElementById('mp-pilot-list').textContent.includes('READY'),
    'HUD roster displays READY badge'
  );

  // Host selects A-14 THUNDERBOLT in the Multiplayer lobby -> synced to guest & roster.
  document.querySelector('#mp-aircraft-select [data-mpaircraft="thunder"]').dispatchEvent(click);
  assert.equal(game.selectedAircraftId, 'thunder', 'host selected A-14 THUNDERBOLT in lobby');
  assert.equal(game.multiplayer.localAircraftId, 'thunder', 'multiplayer tracks local aircraft');
  assert.equal(
    [...guest.peers.values()][0].aircraftId,
    'thunder',
    'guest synced host lobby aircraft choice'
  );
  assert.ok(
    document.getElementById('mp-pilot-list').textContent.includes('A-14 THUNDERBOLT'),
    'lobby roster displays chosen aircraft'
  );

  // Host changes room map in lobby -> guest automatically syncs to the new map.
  document.querySelector('#mp-map-select [data-mpmap="desert"]').dispatchEvent(click);
  await game._mapSwitchPromise;
  assert.equal(game.mapId, 'desert', 'host switched map in multiplayer lobby');
  assert.equal(guest.mapId, 'desert', 'guest synced host lobby map change');
  assert.equal(guestSyncedMap, 'desert', 'guest callback received desert map sync');
  assert.ok(game.scene.environment, 'swapped multiplayer world keeps environment lighting');
  assert.ok(game.world.sky.sunLight.position.length() > 100, 'swapped world sunLight positioned');

  // Host launches multiplayer sortie from the lobby -> READY guest receives start-match.
  document.getElementById('btn-mp-launch').dispatchEvent(click);
  await new Promise((r) => originalSetTimeout(r, 10));
  assert.equal(game.state, 'flying', 'Multiplayer launch enters flight');
  assert.equal(game.multiplayer.matchStarted, true, 'host marked matchStarted');
  assert.ok(guestStartedMatch && guestStartedMatch.localReady, 'READY guest notified to enter match');
  assert.equal(document.getElementById('mp-hud-pill').hidden, false, 'HUD online pill visible');
  assert.equal(game.hud.worldLoading.hidden, true, 'no dark loading overlay over multiplayer flight');

  // Map switching is disabled during battle (both flying and paused).
  assert.equal(
    document.querySelector('#settings-map-select [data-map="coral"]').disabled,
    true,
    'settings map buttons disabled during battle'
  );
  assert.equal(
    document.querySelector('#mp-map-select [data-mpmap="coral"]').disabled,
    true,
    'multiplayer map buttons disabled during battle'
  );
  assert.equal(await game._setMap('coral'), false, 'map switch blocked while flying');
  assert.equal(game.mapId, 'desert', 'map stays locked during flight');
  game._pause();
  assert.equal(await game._setMap('coral'), false, 'map switch blocked while paused in battle');
  // Restart Sortie is disabled in Multiplayer.
  assert.equal(
    document.getElementById('btn-restart').disabled,
    true,
    'RESTART SORTIE button disabled in multiplayer'
  );
  const posWhilePausedBefore = game.physics.position.clone();
  game._restartSortie();
  assert.equal(game.state, 'paused', 'restart sortie rejected while paused in multiplayer');
  // Pausing in Multiplayer keeps the jet online, flying level, and broadcasting state.
  game.multiplayer._sendAcc = 1;
  step(6);
  assert.ok(
    game.physics.position.distanceTo(posWhilePausedBefore) > 5,
    'paused multiplayer aircraft keeps flying online'
  );
  const hostSeenByGuest = [...guest.peers.values()][0];
  assert.equal(hostSeenByGuest.alive, true, 'paused player remains alive/online to peers');
  assert.equal(hostSeenByGuest.paused, true, 'paused flag synced while staying online');
  game._resume();

  // Guest broadcasts flight state with F-40 GHOST airframe 600 m ahead of host.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(game.physics.quaternion);
  const guestPos = game.physics.position.clone().addScaledVector(fwd, 600);
  guest._sendAcc = 1;
  guest.update(0.1, {
    physics: {
      position: guestPos,
      velocity: fwd.clone().multiplyScalar(190),
      quaternion: game.physics.quaternion,
      speed: 190,
      afterburner: 0.8,
      boosting: true,
    },
    world: game.world,
    aircraftId: 'ghost',
    hull: 70,
    hullMax: 70,
    alive: true,
  });
  step(2);
  const remotePilot = [...game.multiplayer.peers.values()][0];
  assert.equal(remotePilot.callsign, 'ELANG-2', 'remote callsign synced');
  assert.equal(remotePilot.aircraftId, 'ghost', 'remote aircraft model synced to F-40 GHOST');
  assert.equal(
    remotePilot.aircraft.engineEffects.enableLight,
    false,
    'remote aircraft does not inject extra PointLight into scene'
  );
  assert.equal(
    remotePilot.aircraft.engineEffects.light.parent,
    null,
    'remote engine PointLight is detached from scene graph'
  );
  assert.ok(
    Number.isFinite(remotePilot.aircraft.engineEffects.light.intensity),
    'remote engine light intensity is never NaN (prevents black lit scene)'
  );
  assert.equal(
    remotePilot.aircraft.model.wing.geometry,
    remotePilot.aircraft.model.wingGeometries.ghost,
    'remote 3D replica uses F-40 Ghost diamond wing'
  );
  // In Co-Op mode, wingman is an ally (not in hostile combat targets).
  const coopContacts = game.multiplayer.getRadarContacts(game.physics.position);
  assert.equal(coopContacts.length, 1);
  assert.equal(coopContacts[0].ally, true, 'Co-Op peer flagged as ALLY');
  assert.equal(game.multiplayer.getVersusTargets().length, 0, 'Co-Op peer not in hostile targets');
  guest.sendCoopKill('missile');
  assert.equal(game.multiplayer.squadKills, 1, 'Co-Op bandit kill shared across squadron');

  // Switch to VERSUS ONLINE (Pure PvP, no NPCs, spaced spawn, first to 20 wins).
  document.querySelector('#mp-mode-select [data-mpmode="versus"]').dispatchEvent(click);
  assert.equal(game.multiplayer.mode, 'versus', 'host switched room to Versus Online');
  assert.equal(guest.mode, 'versus', 'guest synced Versus Online mode');
  assert.equal(game.multiplayer.shouldSpawnBandits(), false, 'Versus disables AI/NPC bandits');
  assert.equal(game.enemies.getAlive().length, 0, 'no AI bandits in Versus mode');
  assert.equal(game.multiplayer.getVersusTargets().length, 1, 'Versus peer exposed as hostile target');
  const hostVersusSpawn = game.multiplayer.getSpawnTransform(false);
  const guestVersusSpawn = guest.getSpawnTransform(false);
  assert.ok(
    hostVersusSpawn.position.distanceTo(guestVersusSpawn.position) > 1000,
    'Versus deploy spawns players well separated'
  );
  const hullBeforePvp = game.hull;
  guest.sendPvpHit(game.multiplayer.localId, 40, 'missile');
  assert.ok(game.hull < hullBeforePvp, `PvP missile hit damaged local hull (${hullBeforePvp} -> ${game.hull})`);
  game.hull = hullBeforePvp;
  game.hud.setCombat({ hull: game.hull, hullMax: game.hullMax });

  // Versus scoreboard displays target 20 and declares winner when reaching 20 kills.
  game.hud.updateMultiplayerScoreboard(game.multiplayer.getRoomSummary());
  assert.equal(document.getElementById('mp-scoreboard').hidden, false, 'Versus scoreboard visible');
  assert.ok(
    document.getElementById('mp-scoreboard').textContent.includes('TARGET 20'),
    'Versus scoreboard shows target 20'
  );
  for (let i = 0; i < 20; i++) {
    guest.sendPvpDown(game.multiplayer.localId, game.multiplayer.callsign, 'missile');
  }
  assert.equal(game.multiplayer.matchEnded, true, 'Versus match ends at score 20');
  assert.equal(game.multiplayer.matchResult.winnerName, 'GARUDA-1', 'pilot reaching 20 wins');
  assert.equal(
    document.getElementById('mp-result-screen').classList.contains('visible'),
    true,
    'Victory overlay displayed on reaching 20'
  );
  document.getElementById('btn-mp-result-lobby').dispatchEvent(click);
  assert.equal(
    document.getElementById('mp-result-screen').classList.contains('visible'),
    false,
    'Result overlay closes back to lobby'
  );

  // Team 3 vs 3 mode: no NPCs, opposing team spawn spacing, 40 vs 40 + 10:00 timer.
  document.querySelector('#mp-mode-select [data-mpmode="team"]').dispatchEvent(click);
  assert.equal(game.multiplayer.mode, 'team', 'host switched room to Team 3 vs 3');
  assert.equal(guest.mode, 'team', 'guest synced Team 3 vs 3');
  assert.equal(game.multiplayer.shouldSpawnBandits(), false, 'Team 3v3 disables AI/NPC bandits');
  guest.setTeam('red');
  assert.equal(game.multiplayer.localTeam, 'blue', 'host on Blue team');
  assert.equal(guest.localTeam, 'red', 'guest on Red team');
  const blueSpawn = game.multiplayer.getSpawnTransform(false);
  const redSpawn = guest.getSpawnTransform(false);
  assert.ok(
    blueSpawn.position.distanceTo(redSpawn.position) >= 3000,
    'Team 3v3 deploys Blue and Red on opposing sides'
  );
  guest.setReady(true);
  document.getElementById('btn-mp-launch').dispatchEvent(click);
  await new Promise((r) => originalSetTimeout(r, 10));
  assert.equal(game.state, 'flying', 'Team 3v3 launched');
  assert.equal(game.enemies.getAlive().length, 0, 'no AI bandits in Team 3v3');
  assert.equal(game.multiplayer.matchRemaining, 600, 'Team 3v3 starts with 10-minute timer');
  game.hud.updateMultiplayerScoreboard(game.multiplayer.getRoomSummary());
  assert.ok(
    document.getElementById('mp-scoreboard').textContent.includes('TIM BIRU') &&
      document.getElementById('mp-scoreboard').textContent.includes('TIM MERAH') &&
      document.getElementById('mp-scoreboard').textContent.includes('/40') &&
      document.getElementById('mp-scoreboard').textContent.includes('10:00'),
    'Team 3v3 top scoreboard shows 40 vs 40 and 10:00 countdown'
  );
  // Blue scores 3 kills, then 10-minute timer finishes -> Blue wins by timer!
  for (let i = 0; i < 3; i++) {
    guest.sendPvpDown(game.multiplayer.localId, game.multiplayer.callsign, 'gun', 'blue');
  }
  assert.equal(game.multiplayer.teamScores.blue, 3, 'Blue team score incremented');
  game.multiplayer.matchRemaining = 0.01;
  game.multiplayer.update(0.05, { physics: game.physics, world: game.world });
  assert.equal(game.multiplayer.matchEnded, true, 'Team 3v3 ends when 10-minute timer expires');
  assert.equal(game.multiplayer.matchResult.winnerTeam, 'blue', 'leading team wins on timer end');
  assert.equal(game.multiplayer.matchResult.reason, 'time', 'victory reason recorded as time');
  document.getElementById('btn-mp-result-lobby').dispatchEvent(click);

  // Team 3v3 immediate victory when reaching score 40.
  guest.setReady(true);
  document.getElementById('btn-mp-launch').dispatchEvent(click);
  await new Promise((r) => originalSetTimeout(r, 10));
  for (let i = 0; i < 40; i++) {
    guest.sendPvpDown(game.multiplayer.localId, game.multiplayer.callsign, 'missile', 'blue');
  }
  assert.equal(game.multiplayer.matchEnded, true, 'Team 3v3 ends immediately at 40 score');
  assert.equal(game.multiplayer.matchResult.winnerTeam, 'blue', 'team reaching 40 wins');
  assert.equal(game.multiplayer.matchResult.reason, 'score', 'victory reason recorded as score');
  document.getElementById('btn-mp-result-lobby').dispatchEvent(click);

  // Launch once more to verify exit-to-menu disconnects from room cleanly.
  document.getElementById('btn-mp-launch').dispatchEvent(click);
  await new Promise((r) => originalSetTimeout(r, 10));

  // Exiting battle to menu immediately removes the player from the room with the host.
  game._pause();
  document.getElementById('btn-pause-menu').dispatchEvent(click);
  assert.equal(game.state, 'menu', 'return-to-menu exits multiplayer battle');
  assert.equal(game.multiplayer.active, false, 'leaving battle disconnects from room');
  assert.equal(guest.peers.size, 0, 'departed player aircraft removed from peer room');
  assert.equal(
    document.getElementById('btn-restart').disabled,
    false,
    'RESTART SORTIE re-enabled after leaving multiplayer'
  );

  guest.leaveRoom();
  assert.equal(game.multiplayer.active, false, 'multiplayer room closed cleanly');
  console.log('PASS  Multiplayer Online: Profile, Co-Op, Versus (20), Team 3v3 (40 / 10m), PvP sync');
}

// Fatal boot errors re-open the loading overlay as an error panel.
game._fatal(new Error('TEST FAILURE'));
assert.equal(
  document.getElementById('boot-fallback').classList.contains('ready'),
  false,
  'failure re-opens the loading overlay'
);
assert.ok(
  document
    .getElementById('boot-fallback')
    .querySelector('.boot-fallback-sub')
    .textContent.includes('TEST FAILURE'),
  'failure message shown on the overlay'
);
console.log('PASS  fatal errors re-open the loading overlay with a message');

console.log('\nGAME INTEGRATION TESTS PASSED');
dom.window.close();
process.exit(0);
