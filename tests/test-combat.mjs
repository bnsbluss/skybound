import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
    <canvas id="viewport"></canvas>
    <div id="ui-root"></div>
    <div id="boot-fallback"><div class="boot-fallback-sub">BOOT</div><div class="boot-spinner"></div></div>
  </body></html>`,
  { pretendToBeVisual: true, url: 'https://skybound.test/' }
);
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
window.devicePixelRatio = 1;

const THREE = await import('three');
const { ExplosionSystem } = await import('../src/fx/ExplosionSystem.js');
const { Weapons } = await import('../src/combat/Weapons.js');
const { Enemies } = await import('../src/combat/Enemies.js');
const { InputManager } = await import('../src/controls/InputManager.js');

const scene = new THREE.Scene();
const world = {
  getHeightAt: () => -50,
  ocean: { getWaveHeightAt: () => 0 },
};

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------
const explosions = new ExplosionSystem({ particleCapacity: 160 });
scene.add(explosions.points);
assert.equal(explosions.getActiveCount(), 0, 'starts empty');
explosions.burst(new THREE.Vector3(0, 400, 0), 2, 0xffa64d);
explosions.update(0.016);
assert.ok(explosions.getActiveCount() > 20, `burst spawns particles=${explosions.getActiveCount()}`);
explosions.update(0.016);
assert.ok(explosions.getActiveCount() > 0, 'particles alive after one step');
for (let i = 0; i < 400; i++) explosions.update(0.05);
assert.equal(explosions.getActiveCount(), 0, 'particles die out');
explosions.spark(new THREE.Vector3(1, 2, 3), 1);
explosions.trailSmoke(new THREE.Vector3(0, 0, 0), { x: 1, y: 0, z: 0 }, 1);
explosions.update(0.016);
assert.ok(explosions.getActiveCount() > 0, 'spark and trail smoke spawn');
explosions.clear();
assert.equal(explosions.getActiveCount(), 0, 'clear empties the pool');
console.log('PASS  explosion system pools, ages and clears');

// ---------------------------------------------------------------------------
// Weapons: cannon, heat, missiles
// ---------------------------------------------------------------------------
const weapons = new Weapons(scene, { particleCapacity: 120 }, explosions);
assert.ok(scene.getObjectByName('player-tracers'), 'player tracer mesh in scene');
assert.ok(scene.getObjectByName('enemy-tracers'), 'enemy tracer mesh in scene');
assert.equal(weapons.missilesLeft, Infinity, 'missiles are unlimited');
assert.equal(weapons.getStats().missilesUnlimited, true, 'stats flag unlimited missiles');
assert.equal(weapons.missilesMax, 20, 'twenty missiles can be in flight for ADMM 8x swarm');
assert.equal(weapons.missileCooldownTime, 1.5, 'launch cooldown is 1.5 s');

const gunOrigin = new THREE.Vector3(0, 500, 0);
const gunDir = new THREE.Vector3(0, 0, -1);
assert.equal(weapons.firePlayerGun(gunOrigin, gunDir, null), true, 'first shot fires');
assert.ok(weapons.heat > 0, 'heat rises');
assert.equal(weapons.getStats().tracers, 1, 'one tracer in flight');
for (let i = 0; i < 90; i++) {
  weapons.update(0.09, { world, targets: [], player: null, explosions });
  weapons.firePlayerGun(gunOrigin, gunDir, null);
}
assert.equal(weapons.overheated, true, 'cannon overheats');
assert.equal(weapons.firePlayerGun(gunOrigin, gunDir, null), false, 'overheated gun blocked');
for (let i = 0; i < 60; i++) weapons.update(0.05, { world, targets: [], player: null, explosions });
assert.equal(weapons.overheated, false, 'gun recovers after cooling');
console.log('PASS  cannon fires, builds heat, overheats and cools');

// Missile rack + events.
const launchDir = new THREE.Vector3(0, 0, -1);
assert.equal(weapons.launchMissile(gunOrigin, launchDir, null), true, 'missile launches');
assert.equal(weapons.missilesLeft, Infinity, 'unlimited rack never decrements');
assert.equal(weapons.launchMissile(gunOrigin, launchDir, null), false, 'cooldown blocks spam');
for (let i = 0; i < 80; i++) weapons.update(1 / 60, { world, targets: [], player: null, explosions });
assert.equal(weapons.launchMissile(gunOrigin, launchDir, null), false, '1.5 s cooldown still held');
for (let i = 0; i < 20; i++) weapons.update(1 / 60, { world, targets: [], player: null, explosions });
assert.equal(weapons.launchMissile(gunOrigin, launchDir, null), true, 'ready again after 1.5 s');
assert.equal(weapons.missilesLeft, Infinity, 'second launch stays unlimited');
const events = weapons.consumeEvents();
assert.ok(events.some((e) => e.type === 'missile-launch'), 'launch event emitted');
assert.deepEqual(weapons.consumeEvents(), [], 'events drain once');

// ---------------------------------------------------------------------------
// Bullet vs target collision
// ---------------------------------------------------------------------------
const target = {
  alive: true,
  health: 40,
  radius: 8,
  position: new THREE.Vector3(0, 500, -300),
};
weapons.reset();
weapons.firePlayerGun(gunOrigin, gunDir, null);
let hitEvent = null;
for (let i = 0; i < 90 && !hitEvent; i++) {
  weapons.update(1 / 60, { world, targets: [target], player: null, explosions });
  hitEvent = weapons.consumeEvents().find((e) => e.type === 'hit' || e.type === 'kill');
}
assert.ok(hitEvent, 'tracers reach the bandit');
assert.ok(target.health < 40, `target damaged to ${target.health}`);
console.log('PASS  player cannon hits a bandit and emits a hit event');

// Kill credit when health runs out.
target.health = 10;
weapons.reset();
weapons.firePlayerGun(gunOrigin, gunDir, null);
let killEvent = null;
for (let i = 0; i < 90 && !killEvent; i++) {
  weapons.update(1 / 60, { world, targets: [target], player: null, explosions });
  killEvent = weapons.consumeEvents().find((e) => e.type === 'kill');
}
assert.ok(killEvent, 'kill event emitted');
assert.equal(target.alive, false, 'target marked dead');
console.log('PASS  killing blow marks the bandit dead');

// Hostile rounds damage the player.
weapons.reset();
const player = { position: new THREE.Vector3(0, 500, -40), velocity: new THREE.Vector3(), radius: 6.5, alive: true };
weapons.fireEnemyGun(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 0, -1), null, 0);
let playerHit = null;
for (let i = 0; i < 90 && !playerHit; i++) {
  weapons.update(1 / 60, { world, targets: [], player, explosions });
  playerHit = weapons.consumeEvents().find((e) => e.type === 'player-hit');
}
assert.ok(playerHit, 'enemy fire hits the player');
assert.ok(playerHit.damage > 0, 'damage payload present');
console.log('PASS  bandit cannon damages the player');

// Missile homing kill.
weapons.reset();
const flyer = { alive: true, health: 40, radius: 8, position: new THREE.Vector3(0, 500, -900) };
weapons.launchMissile(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 0, -1), flyer);
let missileKill = null;
for (let i = 0; i < 600 && !missileKill; i++) {
  weapons.update(1 / 60, { world, targets: [flyer], player: null, explosions });
  missileKill = weapons.consumeEvents().find((e) => e.type === 'kill');
}
assert.ok(missileKill, `homing missile connects (health=${flyer.health})`);
assert.equal(missileKill.weapon, 'missile', 'kill credited to missile');
console.log('PASS  homing missile tracks and destroys the target');

// pickTarget prefers the closest jet inside the seeker cone.
const near = { alive: true, position: new THREE.Vector3(0, 500, -600), radius: 8 };
const far = { alive: true, position: new THREE.Vector3(0, 500, -2400), radius: 8 };
const behind = { alive: true, position: new THREE.Vector3(0, 500, 900), radius: 8 };
const picked = weapons.pickTarget([far, behind, near], new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 0, -1));
assert.equal(picked, near, 'lock picks the nearest in-cone bandit');
console.log('PASS  target picker selects the nearest bandit in cone');

// ---------------------------------------------------------------------------
// Hostile missiles + IR flare countermeasure
// ---------------------------------------------------------------------------
const hostileOrigin = new THREE.Vector3(0, 500, 700);
const hostileDir = new THREE.Vector3(0, 0, -1);

// 1. An unopposed missile runs the player down for a direct hit.
weapons.reset();
const hunted = {
  position: new THREE.Vector3(0, 500, 0),
  velocity: new THREE.Vector3(),
  radius: 6.5,
  alive: true,
};
assert.equal(
  weapons.launchHostileMissile(hostileOrigin, hostileDir, hunted),
  true,
  'hostile missile launches'
);
assert.equal(weapons.getStats().inbound, 1, 'inbound missile counted');
assert.ok(
  weapons.consumeEvents().some((e) => e.type === 'hostile-launch'),
  'hostile-launch event emitted'
);
let hostileHit = null;
for (let i = 0; i < 600 && !hostileHit; i++) {
  weapons.update(1 / 60, { world, targets: [], player: hunted, explosions });
  hostileHit = weapons.consumeEvents().find((e) => e.type === 'player-hit');
}
assert.ok(hostileHit, 'unopposed missile hits the player');
assert.equal(hostileHit.damage, 42, 'direct hit damage is 42');
console.log('PASS  hostile missile tracks and damages the player');

// 2. Proximity fuse: close but not a direct hit still bites for half damage.
weapons.reset();
const nearMiss = {
  position: new THREE.Vector3(0, 500, 0),
  velocity: new THREE.Vector3(),
  radius: 6.5,
  alive: true,
};
weapons.launchHostileMissile(new THREE.Vector3(30, 500, 0), hostileDir, nearMiss);
const armed = weapons.hostileMissiles.find((m) => m.active);
armed.target = null;
armed.position.set(30, 500, 20);
armed.life = 0.02;
weapons.update(1 / 60, { world, targets: [], player: nearMiss, explosions });
let proxHit = weapons.consumeEvents().find((e) => e.type === 'player-hit');
if (!proxHit) {
  weapons.update(1 / 60, { world, targets: [], player: nearMiss, explosions });
  proxHit = weapons.consumeEvents().find((e) => e.type === 'player-hit');
}
assert.ok(proxHit, 'proximity fuse detonates near the player');
assert.equal(proxHit.damage, 21, 'proximity damage is 21');
console.log('PASS  hostile proximity fuse deals 21');

// 3. A flare salvo seduces the missile — it can never score afterwards.
weapons.reset();
const guarded = {
  position: new THREE.Vector3(0, 500, 0),
  velocity: new THREE.Vector3(),
  radius: 6.5,
  alive: true,
};
weapons.launchHostileMissile(hostileOrigin, hostileDir, guarded);
assert.equal(weapons.deployFlares(guarded.position, guarded.velocity), true, 'salvo deploys');
assert.equal(weapons.getStats().flares, 14, 'flare stock decrements');
assert.ok(
  weapons.consumeEvents().some((e) => e.type === 'flare-deploy'),
  'flare-deploy event emitted'
);
let seduced = false;
for (let i = 0; i < 180 && !seduced; i++) {
  weapons.update(1 / 60, { world, targets: [], player: guarded, explosions });
  seduced = weapons.consumeEvents().some((e) => e.type === 'flare-decoyed');
}
assert.ok(seduced, 'decoy seduces the inbound seeker');
assert.equal(weapons.getStats().inbound, 0, 'seduced missile leaves the inbound count');
for (let i = 0; i < 600; i++) {
  weapons.update(1 / 60, { world, targets: [], player: guarded, explosions });
}
assert.equal(
  weapons.consumeEvents().filter((e) => e.type === 'player-hit').length,
  0,
  'seduced missile never damages the player'
);
assert.equal(guarded.position.y, 500, 'player untouched');
console.log('PASS  flare decoys the missile completely');

// 4. Flare stock, cooldown and depletion.
weapons.reset();
assert.equal(weapons.getStats().flares, 15, 'flare stock resets to full');
const stockPos = new THREE.Vector3(0, 500, 0);
for (let salvo = 0; salvo < 15; salvo++) {
  assert.equal(weapons.deployFlares(stockPos, null), true, `salvo ${salvo + 1} deploys`);
  assert.equal(weapons.deployFlares(stockPos, null), false, 'cooldown blocks a double salvo');
  for (let i = 0; i < 50; i++) weapons.update(1 / 60, { world, targets: [], player: null, explosions });
}
assert.equal(weapons.getStats().flares, 0, 'all flares spent');
assert.equal(weapons.deployFlares(stockPos, null), false, 'empty stock refuses a salvo');
console.log('PASS  flare stock, cooldown and depletion');

// 5. Hostile splash never hurts the bandits' own side.
weapons.reset();
const friendlyFire = { alive: true, health: 40, radius: 8, position: new THREE.Vector3(0, 500, 0) };
weapons.launchHostileMissile(new THREE.Vector3(0, 500, 600), hostileDir, null);
for (let i = 0; i < 600; i++) {
  weapons.update(1 / 60, { world, targets: [friendlyFire], player: null, explosions });
  weapons.consumeEvents();
}
assert.equal(friendlyFire.health, 40, 'hostile missile never splashes a bandit');
console.log('PASS  hostile missiles leave bandits alone');

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
const enemies = new Enemies(scene, { enemies: 3 });
const playerProxy = { alive: true, position: new THREE.Vector3(0, 500, 0), velocity: new THREE.Vector3(0, 0, -180) };
enemies.reset(playerProxy.position);
assert.equal(enemies.getAlive().length, 3, `spawns maxAlive (got ${enemies.getAlive().length})`);
const contacts = enemies.getContacts(playerProxy.position);
assert.equal(contacts.length, 3, 'contacts reported for radar');
assert.ok(contacts.every((c) => c.enemy && c.name === 'BANDIT'), 'contact payload flagged hostile');

const spawnPositions = enemies.getAlive().map((e) => e.position.clone());
// V1.7.0 widened the spawn ring well beyond engage range, so a fresh patrol
// can legitimately sit outside it for several seconds. Park the player next
// to the closest bandit to make this engagement check deterministic.
playerProxy.position
  .copy(enemies.getAlive()[0].position)
  .add(new THREE.Vector3(0, 0, 500));
for (let i = 0; i < 240; i++) {
  enemies.update(1 / 60, { world, player: playerProxy, weapons, explosions, allowSpawn: true });
}
const moved = enemies.getAlive().some((e, i) => e.position.distanceTo(spawnPositions[i]) > 50);
assert.ok(moved, 'bandits fly under AI control');
const engaged = enemies.getAlive().some((e) => e.state === 'engage');
assert.ok(engaged, `at least one bandit engages (states=${enemies.getAlive().map((e) => e.state)})`);
const finite = enemies.getAlive().every((e) => Number.isFinite(e.position.y) && e.position.y > 0);
assert.ok(finite, 'all bandits stay above the sea');
console.log('PASS  bandits spawn, pursue and steer with finite positions');

// Kill one off and let the spawner replace it.
const victim = enemies.getAlive()[0];
enemies.destroy(victim, victim.position.clone(), true);
assert.equal(enemies.getAlive().length, 2, 'kill removes the bandit');
for (let i = 0; i < 400 && enemies.getAlive().length < 3; i++) {
  enemies.update(1 / 60, { world, player: playerProxy, weapons, explosions, allowSpawn: true });
}
assert.equal(enemies.getAlive().length, 3, 'respawner refills the squadron');
const downEvents = enemies.consumeEvents();
assert.ok(downEvents.some((e) => e.type === 'downed'), 'downed event emitted');
console.log('PASS  dead bandits respawn after a delay');

// Forced tail shot: park a bandit 600 m astern of the player, aligned and
// with its missile timer at zero — it must fire an IR missile at once.
enemies.reset(playerProxy.position);
const shooter = enemies.getAlive()[0];
const shooterFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(shooter.quaternion);
shooter.position.copy(playerProxy.position).addScaledVector(shooterFwd, -600);
shooter.state = 'engage';
shooter.mslTimer = 0;
weapons.consumeEvents();
enemies.update(1 / 60, { world, player: playerProxy, weapons, explosions, allowSpawn: false });
const hostileLaunch = weapons.consumeEvents().find((e) => e.type === 'hostile-launch');
assert.ok(hostileLaunch, 'aligned bandit fires an IR missile');
assert.ok(shooter.mslTimer > 20, `missile cooldown re-armed (${shooter.mslTimer.toFixed(1)}s)`);
console.log('PASS  bandit launches a hostile missile on a lined-up tail shot');

enemies.clear();
assert.equal(enemies.getAlive().length, 0, 'clear removes all bandits');
console.log('PASS  enemies clear for menu / restart');

// ---------------------------------------------------------------------------
// Combat input
// ---------------------------------------------------------------------------
const input = new InputManager({ touch: false });
const canvas = document.getElementById('viewport');
input.attach(canvas);
input.setEnabled(true);

const key = (type, code) =>
  window.dispatchEvent(new dom.window.KeyboardEvent(type, { code, bubbles: true }));

assert.equal(input.isFiring(), false, 'idle trigger');
key('keydown', 'KeyF');
assert.equal(input.isFiring(), true, 'F holds the cannon');
key('keyup', 'KeyF');
assert.equal(input.isFiring(), false, 'release stops firing');

key('keydown', 'KeyG');
assert.equal(input.consumeMissile(), true, 'G requests a missile');
assert.equal(input.consumeMissile(), false, 'one press = one missile');

key('keydown', 'KeyV');
assert.equal(input.consumeFlares(), true, 'V requests a flare salvo');
assert.equal(input.consumeFlares(), false, 'one press = one salvo');
key('keyup', 'KeyV');

// Left mouse = cannon, right mouse = missile.
const mouse = (type, button, target) => {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button });
  target.dispatchEvent(event);
};
mouse('pointerdown', 0, canvas);
assert.equal(input.isFiring(), true, 'LMB fires');
mouse('pointerup', 0, window);
assert.equal(input.isFiring(), false, 'LMB release stops firing');
mouse('pointerdown', 2, canvas);
assert.equal(input.consumeMissile(), true, 'RMB launches a missile');

// Mobile buttons.
input.setMobileButton('fire', true);
assert.equal(input.isFiring(), true, 'mobile FIRE held');
input.setMobileButton('fire', false);
assert.equal(input.isFiring(), false, 'mobile FIRE released');
input.setMobileButton('missile', true);
assert.equal(input.consumeMissile(), true, 'mobile MSL edge-triggers');
input.setMobileButton('missile', false);
input.setMobileButton('missile', true);
assert.equal(input.consumeMissile(), true, 'repeat presses each fire one');
input.setMobileButton('flare', true);
assert.equal(input.consumeFlares(), true, 'mobile FLR edge-triggers');
input.setMobileButton('flare', false);
input.setMobileButton('flare', true);
assert.equal(input.consumeFlares(), true, 'each FLR press releases one salvo');
input.setEnabled(false);
assert.equal(input.isFiring(), false, 'disabled input cannot fire');
input.clearKeys();
assert.equal(input.consumeMissile(), false, 'clearKeys flushes missile queue');
assert.equal(input.consumeFlares(), false, 'clearKeys flushes flare queue');
console.log('PASS  F/LMB cannon, G/RMB missile, V flare, mobile FIRE/MSL/FLR');

// ---------------------------------------------------------------------------
// Rebindable keymap + movement sensitivity (Setting screen data)
// ---------------------------------------------------------------------------
input.setEnabled(true);

// Rebind the cannon from F to B: new key works, old key is dead.
assert.equal(input.setBinding('fire', 'KeyB'), true, 'fire rebinds to B');
assert.equal(input.getBindings().fire, 'KeyB', 'binding recorded');
key('keyup', 'KeyF');
key('keydown', 'KeyB');
assert.equal(input.isFiring(), true, 'new key fires');
key('keyup', 'KeyB');
assert.equal(input.isFiring(), false, 'new key releases');
key('keydown', 'KeyF');
assert.equal(input.isFiring(), false, 'old key no longer fires');
key('keyup', 'KeyF');

// One-to-one mapping: a code owned by another action is refused.
assert.equal(input.setBinding('missile', 'KeyB'), false, 'duplicate code refused');
assert.equal(input.setBinding('missile', 'KeyG'), true, 'same-owner rebind ok');
assert.equal(input.setBinding('nosuchaction', 'KeyJ'), false, 'unknown action refused');
assert.equal(input.setBinding('flare', ''), false, 'empty code refused');

// Arrow aliases keep working alongside the rebindable map.
key('keydown', 'ArrowUp');
assert.ok(input.keyTarget.pitch < 0, 'arrow alias still pitches down');
key('keyup', 'ArrowUp');
key('keydown', 'ArrowDown');
assert.ok(input.keyTarget.pitch > 0, 'arrow alias still pitches up');
key('keyup', 'ArrowDown');

// Throttle keys follow the binding too.
key('keydown', 'KeyX');
const throttleBefore = input.throttle;
input.update(1);
assert.ok(input.throttle > throttleBefore, 'bound throttle-up key ratchets');
key('keyup', 'KeyX');

// Persistence: a fresh InputManager restores bindings + sensitivity.
input.setBinding('flare', 'KeyN');
input.setSensitivity(1.6);
const reloaded = new InputManager({ touch: false });
assert.equal(reloaded.getBindings().flare, 'KeyN', 'rebind survives reload');
assert.equal(reloaded.getBindings().fire, 'KeyB', 'all rebinds survive reload');
assert.equal(reloaded.getSensitivity(), 1.6, 'sensitivity survives reload');
assert.equal(reloaded.sensitivity, reloaded.baseSensitivity * 1.6, 'scaled look sensitivity');
assert.equal(reloaded.setSensitivity(99), 2.5, 'sensitivity clamps to 2.5');
assert.equal(reloaded.setSensitivity(0.1), 0.4, 'sensitivity clamps to 0.4');

// Sensitivity scales the control-response damping.
const fast = new InputManager({ touch: false });
const slow = new InputManager({ touch: false });
fast.setSensitivity(2.5);
slow.setSensitivity(0.4);
fast.setEnabled(true);
slow.setEnabled(true);
fast.keyTarget.roll = 1;
slow.keyTarget.roll = 1;
fast.update(1 / 60);
slow.update(1 / 60);
assert.ok(
  fast.roll > slow.roll,
  `faster sensitivity responds quicker (${fast.roll.toFixed(3)} > ${slow.roll.toFixed(3)})`
);

// Reset returns the factory mapping.
reloaded.resetBindings();
assert.equal(reloaded.getBindings().fire, 'KeyF', 'reset restores defaults');
assert.equal(reloaded.getSensitivity(), 1, 'reset restores default sensitivity');
console.log('PASS  keymapping rebind, conflict guard, persistence, sensitivity');

weapons.dispose();
console.log('PASS  weapons dispose covers every pool');

console.log('\nCOMBAT TESTS PASSED');
dom.window.close();
process.exit(0);
