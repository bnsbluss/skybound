import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
    <canvas id="viewport"></canvas>
    <div id="ui-root"></div>
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

const {
  AIRCRAFT,
  getAircraft,
  defaultUnlockedIds,
  isUnlocked,
  unlockMissionIndex,
} = await import('../src/aircraft/AircraftCatalog.js');
const {
  MISSIONS,
  loadProgress,
  saveProgress,
  clearProgress,
  completeMission,
  currentMission,
} = await import('../src/core/Progress.js');
const { FlightPhysics, SPAWN } = await import('../src/aircraft/FlightPhysics.js');
const { Aircraft } = await import('../src/aircraft/Aircraft.js');
const { QUALITY_PRESETS } = await import('../src/core/Quality.js');
const { HUD } = await import('../src/hud/HUD.js');
const { InputManager, DEFAULT_BINDINGS } = await import('../src/controls/InputManager.js');

// --------------------------------------------------------------------------
// Catalogue: 9 airframes (5 classic + 4 Elite Superplanes), 2 open from start.
// --------------------------------------------------------------------------
assert.equal(AIRCRAFT.length, 9, 'nine airframes including 4 elite superplanes');
assert.deepEqual(defaultUnlockedIds(), ['wraith', 'sparrow'], 'two open by default');
assert.equal(isUnlocked('wraith', []), true, 'wraith never locks');
assert.equal(isUnlocked('titan', []), false, 'titan starts locked');
assert.equal(isUnlocked('titan', ['titan']), true, 'save can open titan');
assert.equal(unlockMissionIndex('thunder'), 0, 'thunder opens after mission 1');
assert.equal(unlockMissionIndex('ghost'), 1, 'ghost opens after mission 2');
assert.equal(unlockMissionIndex('titan'), 2, 'titan opens after mission 3');
assert.equal(unlockMissionIndex('morgan'), 3, 'ADFX-02 Morgan opens after mission 4');
assert.equal(unlockMissionIndex('wyvern'), 4, 'X-02S Strike Wyvern opens after mission 5');
assert.equal(unlockMissionIndex('nosferatu'), 5, 'CFA-44 Nosferatu opens after mission 6');
assert.equal(unlockMissionIndex('falken'), 6, 'ADF-01 FALKEN opens after mission 7');
assert.equal(unlockMissionIndex('sparrow'), null, 'sparrow has no gate');
for (const craft of AIRCRAFT) {
  assert.ok(craft.stats.speed > 0 && craft.stats.turn > 0 && craft.stats.hull >= 40, craft.id);
  assert.ok(typeof craft.livery.body === 'number' && craft.visual.scale > 0, `${craft.id} visuals`);
}
console.log('PASS  catalogue: 9 airframes (inc. 4 ELITE), 2 open, unlock gates');

// --------------------------------------------------------------------------
// Career save: defaults, persistence, sanitising, mission unlocks.
// --------------------------------------------------------------------------
clearProgress();
let career = loadProgress();
assert.equal(career.mission, 0, 'fresh career starts at mission 1');
assert.deepEqual(career.unlocked, ['wraith', 'sparrow'], 'fresh unlocks');
assert.equal(career.aircraft, 'wraith', 'fresh airframe');
assert.equal(currentMission(career).kills, 12, 'first mission objective: 12 bandits');
assert.equal(MISSIONS.length, 8, 'eight story missions');
assert.equal(new Set(MISSIONS.map((m) => m.map)).size, 4, 'story visits four different maps');

career = saveProgress({ aircraft: 'sparrow' });
assert.equal(loadProgress().aircraft, 'sparrow', 'airframe choice persists');

// Corrupted / hostile saves fall back to sane values.
window.localStorage.setItem('skybound.save', '{not json');
assert.equal(loadProgress().aircraft, 'wraith', 'corrupted save resets airframe');
assert.deepEqual(loadProgress().unlocked, ['wraith', 'sparrow'], 'corrupted save resets unlocks');

window.localStorage.setItem(
  'skybound.save',
  JSON.stringify({ mission: 99, aircraft: 'nope', unlocked: ['nope', 'ghost'], best: { score: -5 } })
);
career = loadProgress();
assert.equal(career.mission, MISSIONS.length, 'mission index clamped');
assert.equal(career.aircraft, 'wraith', 'unknown airframe rejected');
assert.deepEqual([...career.unlocked].sort(), ['ghost', 'sparrow', 'wraith'], 'unknown ids dropped');
assert.equal(career.best.score, 0, 'negative best score rejected');

// Mission chain: each clear unlocks one airframe and advances the campaign.
clearProgress();
let outcome = completeMission(loadProgress(), 0, { score: 1200, kills: 12 });
assert.deepEqual(outcome.unlocked, ['thunder'], 'mission 1 opens thunder');
assert.equal(outcome.progress.mission, 1, 'campaign advances');
assert.equal(outcome.progress.best.score, 1200, 'best score recorded');
assert.equal(currentMission(outcome.progress).id, 'city-siege', 'next mission queued');
assert.equal(currentMission(outcome.progress).map, 'city', 'mission 2 is set in the city');

outcome = completeMission(outcome.progress, 1, { score: 900, kills: 14 });
assert.deepEqual(outcome.unlocked, ['ghost'], 'mission 2 opens ghost');
assert.equal(outcome.progress.best.score, 1200, 'best score never drops');

outcome = completeMission(outcome.progress, 2, { kills: 16 });
assert.deepEqual(outcome.unlocked, ['titan'], 'mission 3 opens titan');
assert.equal(outcome.complete, false, 'campaign continues past mission 3');
assert.equal(currentMission(outcome.progress).id, 'mountain-wall', 'mission 4 queued');

// Replaying an old mission must never rewind or duplicate progress.
outcome = completeMission(outcome.progress, 1, { score: 50, kills: 1 });
assert.equal(outcome.progress.mission, 3, 'replay does not advance the story');
assert.equal(outcome.progress.best.score, 1200, 'replay does not lower the best score');

// Clear the remaining story missions one by one.
for (let index = 3; index < MISSIONS.length; index++) {
  outcome = completeMission(outcome.progress, index, { kills: MISSIONS[index].kills });
}
assert.equal(outcome.complete, true, 'campaign complete');
assert.equal(currentMission(outcome.progress), null, 'no mission left');
assert.equal(loadProgress().unlocked.length, 9, 'every airframe (inc. 4 Elite) open in the save');
assert.equal(isUnlocked('falken', loadProgress().unlocked), true, 'ADF-01 FALKEN usable after campaign');
assert.ok(loadProgress().unlockedMissiles.includes('tls'), 'ADF-01 FALKEN unlocks TLS-01 Laser');
assert.ok(loadProgress().unlockedMissiles.includes('admm'), 'CFA-44 Nosferatu unlocks ADMM 8x Swarm');
assert.ok(loadProgress().unlockedMissiles.includes('mpbm_morgan'), 'ADFX-02 Morgan unlocks MPBM-X Burst');
assert.ok(loadProgress().unlockedMissiles.includes('eml'), 'X-02S Strike Wyvern unlocks EML Arclight');
assert.equal(isUnlocked('titan', loadProgress().unlocked), true, 'titan usable after campaign');
console.log('PASS  career save: persist, sanitise, 8-mission unlocks');

// --------------------------------------------------------------------------
// FlightPhysics: catalogue stats bend speed and control rates.
// --------------------------------------------------------------------------
const base = new FlightPhysics();
assert.deepEqual(base.stats, { speed: 1, turn: 1, boost: 1, hull: 100 }, 'stock stats');
base.setStats({ speed: 9, turn: 0.1, boost: 3, hull: 5 });
assert.deepEqual(base.stats, { speed: 1.6, turn: 0.6, boost: 1.6, hull: 40 }, 'stats clamped');
base.setStats({});
assert.deepEqual(base.stats, { speed: 1, turn: 1, boost: 1, hull: 100 }, 'stats reset to stock');

function settleSpeed(stats) {
  const physics = new FlightPhysics();
  physics.setStats(stats);
  physics.reset(SPAWN);
  const input = { pitch: 0, roll: 0, yaw: 0, throttle: 1, boost: false, brake: false };
  for (let i = 0; i < 600; i++) physics.update(1 / 60, input);
  return physics.speed;
}

function settlePitchRate(stats) {
  const physics = new FlightPhysics();
  physics.setStats(stats);
  physics.reset(SPAWN);
  const input = { pitch: 0.6, roll: 0, yaw: 0, throttle: 0.7, boost: false, brake: false };
  for (let i = 0; i < 90; i++) physics.update(1 / 60, input);
  return Math.abs(physics.rates.pitch);
}

const stockSpeed = settleSpeed({});
const fastSpeed = settleSpeed({ speed: 1.18 });
const slowSpeed = settleSpeed({ speed: 0.82 });
assert.ok(fastSpeed > stockSpeed + 10, `fast airframe quicker (${fastSpeed.toFixed(0)} > ${stockSpeed.toFixed(0)})`);
assert.ok(slowSpeed < stockSpeed - 10, `heavy airframe slower (${slowSpeed.toFixed(0)} < ${stockSpeed.toFixed(0)})`);

const stockRate = settlePitchRate({});
const nimbleRate = settlePitchRate({ turn: 1.15 });
const sluggishRate = settlePitchRate({ turn: 0.78 });
assert.ok(nimbleRate > stockRate + 0.01, 'nimble airframe rotates faster');
assert.ok(sluggishRate < stockRate - 0.01, 'heavy airframe rotates slower');
console.log('PASS  physics stats drive top speed and control rates');

// --------------------------------------------------------------------------
// Airframe visuals: livery, scale, canard and missile stores.
// --------------------------------------------------------------------------
const quality = QUALITY_PRESETS.low;
const ship = new Aircraft(quality, getAircraft('titan'));
assert.equal(ship.model.group.name, 'titan', 'group named after airframe');
assert.ok(Math.abs(ship.model.group.scale.x - 1.18) < 1e-6, 'titan is 18% larger');
assert.equal(ship.variantScale, 1.18, 'wingtip envelope follows scale');
assert.ok(Math.abs(ship._wingtipL.x + 7.45 * 1.18) < 1e-6, 'left wingtip scaled');
assert.equal(ship.model.canard.visible, true, 'titan keeps canards');
assert.equal(ship.model.missiles.visible, true, 'titan carries missiles');
assert.equal(ship.model.materials.body.color.getHex(), getAircraft('titan').livery.body, 'titan livery painted');
assert.equal(ship.model.wing.geometry, ship.model.wingGeometries.titan, 'titan uses flying-wing planform');
assert.equal(ship.model.variantFeatures.titan.visible, true, 'titan structural package visible');
assert.equal(ship.model.tailPlane.visible, false, 'titan tailless flying-wing hides horizontal tailplane');

ship.setVariant(getAircraft('ghost'));
assert.equal(ship.model.canard.visible, false, 'ghost drops canards');
assert.equal(ship.model.missiles.visible, false, 'ghost flies clean');
assert.equal(ship.model.materials.body.color.getHex(), getAircraft('ghost').livery.body, 'ghost livery painted');
assert.ok(Math.abs(ship.model.group.scale.x - 0.96) < 1e-6, 'ghost slightly smaller');
assert.equal(ship.model.wing.geometry, ship.model.wingGeometries.ghost, 'ghost uses diamond stealth wing');
assert.equal(ship.model.variantFeatures.ghost.visible, true, 'ghost stealth chine package visible');

ship.setVariant(getAircraft('sparrow'));
assert.equal(ship.model.wing.geometry, ship.model.wingGeometries.sparrow, 'sparrow uses forward-swept wing');
assert.equal(ship.model.variantFeatures.sparrow.visible, true, 'sparrow central dorsal fin visible');
assert.equal(ship.model.fins[0].visible, false, 'sparrow hides twin tail fins');

ship.setVariant(getAircraft('thunder'));
assert.equal(ship.model.wing.geometry, ship.model.wingGeometries.thunder, 'thunder uses straight attack wing');
assert.equal(ship.model.variantFeatures.thunder.visible, true, 'thunder dorsal turbofan pods & nose gun visible');

for (const eliteId of ['morgan', 'wyvern', 'nosferatu', 'falken']) {
  ship.setVariant(getAircraft(eliteId));
  assert.equal(ship.model.wing.geometry, ship.model.wingGeometries[eliteId], `${eliteId} uses signature wing`);
  assert.equal(ship.model.variantFeatures[eliteId].visible, true, `${eliteId} structural package visible`);
}

ship.setVariant(null);
assert.equal(ship.model.group.name, 'f-31-wraith', 'variant cleared restores stock name');
assert.equal(ship.model.canard.visible, true, 'canards back');
assert.equal(ship.model.missiles.visible, true, 'missiles back');
assert.equal(ship.model.group.scale.x, 1, 'stock scale back');
assert.equal(ship.model.materials.body.color.getHex(), 0xe9e6db, 'stock livery back');
console.log('PASS  airframe variants: livery, scale, stores');

// --------------------------------------------------------------------------
// Hull pools feed the weapon panel through hullMax.
// --------------------------------------------------------------------------
const hudCalls = [];
const hud = new HUD(
  {
    onStart: () => hudCalls.push('start'),
    onAircraftSelect: (id) => hudCalls.push(`select:${id}`),
    onAircraftLaunch: (id) => hudCalls.push(`launch:${id}`),
    onAircraftBack: () => hudCalls.push('back'),
  },
  { touch: false, qualityLabel: 'LOW' }
);

// Start button still reports New Game.
hud.startButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.deepEqual(hudCalls, ['start'], 'start button fires New Game');

// Open the hangar the way Game does.
hud.showAircraftSelect(true, { unlocked: ['wraith', 'sparrow'], selected: 'wraith', mission: 0 });
assert.equal(hud.hangarOpen, true, 'hangar open');
assert.ok(hud.hangarScreen.classList.contains('visible'), 'hangar screen visible');
assert.ok(!hud.startScreen.classList.contains('visible'), 'menu hidden behind hangar');

const cards = [...hud.hangarGrid.querySelectorAll('.hangar-card')];
assert.equal(cards.length, 9, 'one card per airframe (5 classic + 4 ELITE)');
assert.deepEqual(
  cards.filter((card) => !card.classList.contains('locked')).map((card) => card.dataset.aircraft),
  ['wraith', 'sparrow'],
  'exactly two cards unlocked'
);
assert.ok(cards[2].classList.contains('locked'), 'thunder locked');
assert.ok(cards[2].textContent.includes('TERKUNCI · MISI 1'), 'lock reason shows mission 1');
assert.ok(cards[4].textContent.includes('TERKUNCI · MISI 3'), 'titan gated by mission 3');
assert.ok(cards[8].classList.contains('elite'), 'ADF-01 FALKEN marked ELITE');
assert.equal(hud.hangarCount.textContent, '2 / 9', 'unlock counter');
assert.equal(hud.hangarMission.textContent, '01', 'next mission badge');
assert.equal(hud.hangarSelected, 'wraith', 'stock airframe preselected');
assert.equal(hud.hangarDetail.dataset.locked, '0', 'detail shows the open airframe');
assert.ok(hud.hangarDetail.textContent.includes('Balanced multirole'), 'blurb shown');
assert.ok(hud.hangarDetail.textContent.includes('KECEPATAN'), 'stat bars shown');
assert.equal(hud.hangarLaunch.disabled, false, 'launch armed');
assert.ok(hud.hangarLaunch.textContent.includes('TERBANG · F-31 WRAITH'), 'launch label mirrors pick');
console.log('PASS  hangar renders cards, locks and detail');

// Selecting another open airframe updates the sheet and reports back.
hud.selectAircraft('sparrow');
assert.equal(hud.hangarSelected, 'sparrow', 'selection stored');
assert.ok(
  hud.hangarGrid.querySelector('[data-aircraft="sparrow"]').classList.contains('active'),
  'active card highlighted'
);
assert.ok(!hud.hangarGrid.querySelector('[data-aircraft="wraith"]').classList.contains('active'),
  'previous card cleared');
assert.ok(hud.hangarDetail.textContent.includes('Quick and nimble'), 'sparrow blurb');
assert.ok(hud.hangarLaunch.textContent.includes('T-6 SPARROW'), 'launch label updated');
assert.ok(hudCalls.includes('select:sparrow'), 'selection callback fired');

// Clicking a locked card only shows the lock reason — never selects it.
cards[4].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.hangarSelected, 'sparrow', 'locked card cannot steal selection');
assert.equal(hud.hangarDetail.dataset.locked, '1', 'lock sheet shown');
assert.ok(hud.hangarDetail.textContent.includes('Misi 3'), 'lock sheet names the mission');
assert.ok(!hudCalls.includes('select:titan'), 'no selection callback for locked card');

// Launch + back buttons.
document.getElementById('btn-hangar-launch').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.deepEqual(
  hudCalls.filter((call) => call.startsWith('launch:')),
  ['launch:sparrow'],
  'launch callback carries the pick'
);
document.getElementById('btn-hangar-back').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.hangarOpen, false, 'back closes the hangar');
assert.ok(hud.startScreen.classList.contains('visible'), 'menu back on screen');
assert.ok(!hud.hangarScreen.classList.contains('visible'), 'hangar hidden');
assert.ok(hudCalls.includes('back'), 'back callback fired');

// Leaving the menu (launch / keyboard) always closes the hangar.
hud.showAircraftSelect(true, { unlocked: ['wraith', 'sparrow'], selected: 'wraith', mission: 1 });
assert.equal(hud.hangarOpen, true, 'hangar reopened');
assert.equal(hud.hangarMission.textContent, '02', 'mission badge follows the save');
hud.setPhase('flying');
assert.equal(hud.hangarOpen, false, 'flight closes the hangar');
assert.ok(!hud.hangarScreen.classList.contains('visible'), 'hangar hidden in flight');
hud.setPhase('menu');
assert.ok(hud.startScreen.classList.contains('visible'), 'menu returns');
assert.ok(!hud.hangarScreen.classList.contains('visible'), 'hangar stays closed');
console.log('PASS  hangar open / select / lock / launch / close flow');

// Weapon panel scales the hull bar by hullMax (140 hull = full bar at 140).
hud.setPhase('flying');
hud.setCombat({ hull: 140, hullMax: 140 });
hud._updateWeaponPanel();
assert.equal(hud.hullFill.style.width, '100%', 'full hull bar for the max pool');
assert.equal(hud.hullValue.textContent, '140', 'raw hull pool displayed');
assert.equal(hud.hullFill.classList.contains('critical'), false, 'full hull not critical');

hud.setCombat({ hull: 42, hullMax: 140 });
hud._updateWeaponPanel();
assert.equal(hud.hullFill.style.width, '30%', 'hull bar is a share of the pool');
assert.equal(hud.hullValue.textContent, '42', 'raw value shown');
assert.equal(hud.hullFill.classList.contains('critical'), true, '30% flagged critical');

hud.setCombat({ hull: 62, hullMax: 100 });
hud._updateWeaponPanel();
assert.equal(hud.hullFill.style.width, '62%', 'stock pool behaves like before');
assert.equal(hud.hullValue.textContent, '62', 'stock value unchanged');
console.log('PASS  hull bar honours hullMax');

// Mission badge: name + live kill counter, reset on free flight.
hud.setMission({ name: 'PATROL SEKTOR 07', kills: 3 }, 2);
assert.equal(hud.missionTagName.textContent, 'PATROL SEKTOR 07', 'mission name shown');
assert.equal(hud.missionTagProgress.textContent, '2 / 3 KILL', 'kill counter shown');
assert.equal(hud.missionTagProgress.classList.contains('done'), false, 'not done yet');
hud.setMission({ name: 'PATROL SEKTOR 07', kills: 3 }, 5);
assert.equal(hud.missionTagProgress.textContent, '3 / 3 KILL', 'counter clamps at the quota');
assert.equal(hud.missionTagProgress.classList.contains('done'), true, 'quota flagged');
hud.setMission(null);
assert.equal(hud.missionTagName.textContent, 'FREE FLIGHT', 'free flight resets the badge');
assert.equal(hud.missionTagProgress.textContent, '', 'counter cleared');
console.log('PASS  mission badge tracks the kill quota');

// --------------------------------------------------------------------------
// Stage C: 6-item main menu, campaign list, Setting, About, Exit, keymapping.
// --------------------------------------------------------------------------
hud.setPhase('menu');
hud.setReady({});
assert.equal(hud.menuButtons.length, 6, 'six menu items');
assert.deepEqual(
  hud.menuButtons.map((button) => button.id),
  ['btn-start', 'btn-missions', 'btn-continue', 'btn-settings', 'btn-about', 'btn-exit'],
  'menu order: New Game, Daftar Misi, Continue, Setting, About, Exit'
);
assert.ok(
  hud.menuButtons.every((button) => !button.disabled),
  'all menu items armed once ready'
);
assert.equal(
  hud.startButton.querySelector('.menu-label').textContent,
  'NEW GAME',
  'primary item reads NEW GAME'
);
assert.equal(
  document.getElementById('btn-missions').querySelector('.menu-label').textContent,
  'DAFTAR MISI',
  'story list is reachable from the menu'
);
console.log('PASS  main menu lists 6 armed items');

// Campaign list: 8 cards, completed / active / locked states, story detail.
let selectedMission = null;
hud.callbacks.onMissionSelect = (index) => {
  selectedMission = index;
};
hud.renderCampaign({ mission: 1, unlocked: ['wraith', 'sparrow'], selected: 1, map: 'coral' });
const missionCards = Array.from(document.querySelectorAll('#mission-list .mission-card'));
assert.equal(missionCards.length, 8, 'eight mission cards');
assert.ok(missionCards[0].classList.contains('complete'), 'first mission completed');
assert.ok(missionCards[1].classList.contains('active'), 'second mission active');
assert.ok(missionCards[2].classList.contains('locked'), 'third mission still locked');
assert.equal(document.getElementById('campaign-progress').textContent, '02 / 08', 'campaign progress shown');
assert.ok(document.getElementById('campaign-detail').textContent.includes('LANGIT KOTA'), 'detail shows the selected mission');
assert.equal(hud.campaignLaunch.disabled, false, 'active mission can launch');
missionCards[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(selectedMission, 0, 'completed mission selectable for replay');
assert.equal(hud.campaignLaunch.querySelector('.launch-label').textContent, 'ULANG MISI', 'replay label');
missionCards[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(selectedMission, 0, 'locked mission cannot be selected');
const launchEvents = [];
hud.callbacks.onMissionLaunch = (index) => launchEvents.push(index);
hud.campaignLaunch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.deepEqual(launchEvents, [0], 'launch reports the selected mission');
hud.renderCampaign({ mission: 8, unlocked: ['wraith', 'sparrow', 'thunder', 'ghost', 'titan'], selected: 7 });
assert.equal(document.getElementById('campaign-progress').textContent, '08 / 08', 'completed campaign shows 8/8');
assert.ok(
  Array.from(document.querySelectorAll('#mission-list .mission-card')).every((card) => card.classList.contains('complete')),
  'every mission complete after the finale'
);
console.log('PASS  campaign list: 8 cards, progress, replay and locks');

// Continue only lights up when a career save exists.
hud.setContinueEnabled(false);
assert.equal(hud.continueButton.disabled, true, 'Continue dead without a save');
assert.ok(hud.continueButton.classList.contains('unavailable'), 'flagged unavailable');
hud.setContinueEnabled(true);
assert.equal(hud.continueButton.disabled, false, 'Continue armed with a save');
assert.ok(!hud.continueButton.classList.contains('unavailable'), 'flag cleared');
console.log('PASS  Continue toggles with the save');

// Setting screen: open, contents, close — only one sub-screen at a time.
document.getElementById('btn-settings').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.subScreen, 'settings', 'Setting opens');
assert.ok(hud.settingsScreen.classList.contains('visible'), 'settings visible');
assert.ok(!hud.startScreen.classList.contains('visible'), 'menu hidden');
assert.equal(hud.settingsScreen.getAttribute('aria-hidden'), 'false');
document.querySelectorAll('#settings-screen [data-quality]').forEach((button) => {
  assert.ok(['low', 'medium', 'high'].includes(button.dataset.quality), 'quality options');
});
assert.ok(document.getElementById('sens-slider'), 'sensitivity slider present');
assert.equal(document.getElementById('keymap-list').children.length, 0, 'keymap built on demand');
hud.setKeymap(DEFAULT_BINDINGS);
assert.equal(document.getElementById('keymap-list').children.length, 18, '18 rebindable rows');
assert.equal(
  document.querySelector('.keymap-row[data-row="fire"] .keycap').textContent,
  'F',
  'default binding shown'
);

// Sensitivity slider paints and reports.
const sensEvents = [];
hud.callbacks.onSensitivity = (value) => sensEvents.push(value);
const slider = document.getElementById('sens-slider');
slider.value = '1.6';
slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(document.getElementById('sens-value').textContent, '160%', 'slider readout');
assert.deepEqual(sensEvents, [1.6], 'sensitivity reported to the game');
document.getElementById('btn-sens-reset').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(document.getElementById('sens-value').textContent, '100%', 'reset readout');
assert.deepEqual(sensEvents, [1.6, 1], 'reset reported too');

// Keymapping rebind: success, conflict, cancel.
const input = new InputManager();
input.resetBindings();
hud.callbacks.onSetBinding = (action, code) => input.setBinding(action, code);
const key = (code) =>
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));

const fireCap = document.querySelector('.keymap-row[data-row="fire"] .keycap');
fireCap.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud._rebindAction, 'fire', 'rebind armed');
assert.ok(fireCap.classList.contains('listening'), 'row highlighted');
key('KeyJ');
assert.equal(hud._rebindAction, null, 'rebind finished');
assert.equal(input.getBindings().fire, 'KeyJ', 'binding applied');
assert.equal(fireCap.textContent, 'J', 'keycap repainted');
assert.ok(document.getElementById('keymap-note').textContent.includes('TERSIMPAN'), 'success note');

fireCap.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
key('KeyW'); // already owned by pitchDown
assert.equal(input.getBindings().fire, 'KeyJ', 'conflicting key rejected');
assert.ok(document.getElementById('keymap-note').textContent.includes('TIDAK BOLEH DUPLIKAT'), 'conflict note');

fireCap.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
key('Escape');
assert.equal(hud._rebindAction, null, 'Escape cancels the rebind');
assert.ok(document.getElementById('keymap-note').textContent.includes('DIBATALKAN'), 'cancel note');
console.log('PASS  Setting: sensitivity + keymap rebind (ok/conflict/cancel)');

// Reset keymapping restores defaults.
hud.callbacks.onKeymapReset = () => {
  input.resetBindings();
  hud.setKeymap(input.getBindings());
};
document.getElementById('btn-keymap-reset').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(input.getBindings().fire, DEFAULT_BINDINGS.fire, 'reset restores defaults');
assert.equal(fireCap.textContent, 'F', 'keymap repainted after reset');

document.getElementById('btn-settings-back').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.subScreen, null, 'Setting closes');
assert.ok(hud.startScreen.classList.contains('visible'), 'menu back');
assert.ok(!hud.settingsScreen.classList.contains('visible'), 'settings hidden');
console.log('PASS  Setting screen open / close');

// About screen carries the creator credit.
document.getElementById('btn-about').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.subScreen, 'about', 'About opens');
assert.ok(hud.aboutScreen.classList.contains('visible'), 'about visible');
const aboutText = hud.aboutScreen.textContent;
assert.ok(aboutText.includes('HeavyRain AKA Ziky Andeska'), 'creator credit');
assert.ok(aboutText.includes('THREE.JS 0.169'), 'engine credit');
document.getElementById('btn-about-back').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.subScreen, null, 'About closes');
assert.ok(!hud.aboutScreen.classList.contains('visible'), 'about hidden');
console.log('PASS  About screen credit + close');

// Exit screen: open, back, and only one sub-screen at a time.
document.getElementById('btn-exit').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.subScreen, 'exit', 'Exit opens');
assert.ok(hud.exitScreen.classList.contains('visible'), 'exit visible');
assert.ok(hud.exitScreen.textContent.includes('TERIMA'), 'farewell panel');
document.getElementById('btn-settings').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(hud.subScreen, 'settings', 'opening Setting replaces Exit');
assert.ok(!hud.exitScreen.classList.contains('visible'), 'exit screen swapped out');
document.getElementById('btn-settings-back').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

// Escape-from-keyboard path closes whichever sub-screen is open (Game side
// is exercised in test-game; here we verify the HUD primitive).
hud.showExit(true);
hud.closeSubScreen('about'); // wrong name → ignored
assert.equal(hud.subScreen, 'exit', 'closeSubScreen ignores a mismatched name');
hud.closeSubScreen();
assert.equal(hud.subScreen, null, 'closeSubScreen() closes the active one');
console.log('PASS  Exit screen + exclusive sub-screen handling');

// Leaving the menu always collapses sub-screens.
hud.showSettings(true);
hud.setPhase('flying');
assert.equal(hud.subScreen, null, 'flight closes sub-screens');
assert.ok(!hud.settingsScreen.classList.contains('visible'), 'settings hidden in flight');

console.log('CAREER / HANGAR TESTS PASSED');
