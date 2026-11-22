import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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
window.devicePixelRatio = 2;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

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

const { QUALITY_PRESETS } = await import('../src/core/Quality.js');
const { World } = await import('../src/world/World.js');
const { FlightPhysics, SPAWN } = await import('../src/aircraft/FlightPhysics.js');
const { Aircraft } = await import('../src/aircraft/Aircraft.js');
const { ChaseCamera } = await import('../src/camera/ChaseCamera.js');
const { TrailSystem } = await import('../src/fx/TrailSystem.js');
const { InputManager } = await import('../src/controls/InputManager.js');

const quality = QUALITY_PRESETS[process.env.QUALITY || 'low'];
const world = new World(quality);
let progressSteps = 0;
await world.build(() => {
  progressSteps++;
});
console.log('PASS  world built through', progressSteps, 'progress steps');

const stats = world.getStats();
assert.equal(stats.islands, 15);
assert.ok(stats.trees > 500, `trees=${stats.trees}`);
assert.ok(stats.rocks > 10, `rocks=${stats.rocks}`);
assert.ok(stats.cloudPuffs >= 35, `clouds=${stats.cloudPuffs}`);
assert.ok(stats.islandTriangles > 10000, `triangles=${stats.islandTriangles}`);
console.log(
  `PASS  content: ${stats.islands} islands, ${stats.trees} trees, ${stats.rocks} rocks, ${stats.cloudPuffs} cloud puffs, ${stats.islandTriangles} island tris`
);

const scene = world.scene;
assert.ok(scene.getObjectByName('ocean'));
assert.ok(scene.getObjectByName('sky'));
assert.ok(scene.getObjectByName('clouds'));
assert.equal(world.clouds.coreMaterial.transparent, true, 'cloud core material is transparent');
assert.equal(world.clouds.coreMaterial.opacity, 0.5, 'cloud core material is 50% transparent');
assert.equal(world.clouds.shellMaterial.transparent, true, 'cloud outer vapor halo is transparent');
assert.equal(world.clouds.coreMaterial.flatShading, false, 'cloud core uses smooth cumulus shading');
assert.equal(scene.getObjectByName('trees-broadleaf')?.isInstancedMesh, true);
assert.equal(scene.getObjectByName('trees-pine')?.isInstancedMesh, true);
assert.equal(scene.getObjectByName('trees-palm')?.isInstancedMesh, true);
assert.ok(scene.getObjectByName('island-verdant'));
console.log('PASS  instanced vegetation and LOD island objects present');

// Sampler sanity over every island: finite heights and above-sea peaks.
for (const island of world.islands.islands) {
  let peak = -Infinity;
  for (let i = 0; i < 260; i++) {
    const a = (i / 260) * Math.PI * 2 * 5;
    const r = (i / 260) * island.def.radius;
    const [x, z] = island.toWorldXZ(Math.cos(a) * r, Math.sin(a) * r);
    const h = island.heightAt(x, z);
    assert.ok(Number.isFinite(h), `${island.def.id} height finite`);
    peak = Math.max(peak, h);
  }
  assert.ok(peak > 10, `${island.def.id} has land, peak=${peak.toFixed(1)}`);
}
console.log('PASS  all island height samplers finite and above water');

const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 32000);
camera.position.set(-150, 470, 1710);
const focus = new THREE.Vector3(-150, 460, 1700);
for (let i = 0; i < 30; i++) world.update(1 / 60, camera, focus);
assert.ok(Number.isFinite(world.ocean.uniforms.uTime.value));
assert.ok(world.getHeightAt(-320, -1520) > 50);
assert.ok(world.getSurfaceHeightAt(-320, -1520) >= world.getHeightAt(-320, -1520));
assert.ok(world.getAGL(-150, 460, 1700) > 400);
const contacts = world.getRadarContacts(-150, 1700, 7500);
assert.ok(contacts.length > 3, 'radar contacts');
console.log(`PASS  world update + sampler APIs (${contacts.length} radar contacts)`);

// Aircraft + engine effects + shadow + chase camera + trails.
const physics = new FlightPhysics();
physics.reset(SPAWN);
const aircraft = new Aircraft(quality);
scene.add(aircraft.root);
scene.add(aircraft.shadow);
const input = { pitch: 0.25, roll: 0.3, yaw: -0.2, throttle: 0.85, boost: true, brake: false };
for (let i = 0; i < 120; i++) {
  physics.update(1 / 60, input);
  aircraft.updateVisual(1 / 60, physics, input, i / 60, world);
}
assert.ok(aircraft.root.getObjectByName('fuselage'), 'fuselage');
assert.ok(aircraft.root.getObjectByName('wing'), 'wing');
assert.ok(aircraft.engineEffects.shockDiamonds.length === 4, 'shock diamonds');
assert.ok(aircraft.root.getObjectByName('missiles').isInstancedMesh, 'instanced missiles');
assert.ok(Number.isFinite(physics.position.x));
assert.ok(aircraft.shadow.visible === true || physics.position.y > 1350);
console.log('PASS  aircraft model, control surfaces, engine FX and shadow animate');

const chase = new ChaseCamera(camera, quality);
chase.snapTo(physics);
for (let i = 0; i < 120; i++) chase.update(1 / 60, physics, world);
assert.ok(camera.position.distanceTo(physics.position) > 8, 'chase camera distance');
assert.ok(Number.isFinite(camera.position.y), 'chase camera finite');
console.log('PASS  chase camera damping and terrain avoidance');

const trails = new TrailSystem(quality);
scene.add(trails.points);
for (let i = 0; i < 60; i++) {
  physics.update(1 / 60, { ...input, boost: i % 2 === 0 });
  aircraft.updateVisual(1 / 60, physics, input, 2 + i / 60, world);
  trails.update(1 / 60, aircraft, physics, world, true);
}
assert.ok(trails.getActiveCount() > 0, 'trail particles emitted');
assert.ok(trails.geometry.attributes.position.count === trails.capacity);
trails.burst(physics.position, 'water');
assert.ok(trails.getActiveCount() > 20, 'crash burst particles');
console.log(`PASS  particle trails (${trails.getActiveCount()} active of ${trails.capacity})`);

// Input plumbing smoke test (listeners attach to the jsdom canvas).
const controls = new InputManager({ touch: false });
controls.attach(document.getElementById('viewport'));
controls.setEnabled(true);
window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyS' }));
window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyA' }));
window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'ShiftLeft' }));
controls.update(0.1);
const flightInput = controls.getFlightInput();
assert.ok(flightInput.pitch > 0.2, `pitch=${flightInput.pitch}`);
assert.ok(flightInput.roll > 0.2, `roll=${flightInput.roll}`);
assert.equal(flightInput.boost, true);
window.dispatchEvent(new dom.window.KeyboardEvent('keyup', { code: 'KeyS' }));
window.dispatchEvent(new dom.window.KeyboardEvent('keyup', { code: 'KeyA' }));
window.dispatchEvent(new dom.window.KeyboardEvent('keyup', { code: 'ShiftLeft' }));
console.log('PASS  keyboard input maps to flight axes');

// Renderer-independent scene traversal: every mesh geometry is valid.
let meshes = 0;
scene.traverse((node) => {
  if (node.isMesh) {
    meshes++;
    const pos = node.geometry?.attributes?.position;
    assert.ok(pos && pos.count > 0, `mesh ${node.name || node.uuid} has geometry`);
    node.geometry.computeBoundingSphere();
    assert.ok(node.geometry.boundingSphere, `mesh ${node.name || node.uuid} bounding sphere`);
    assert.ok(Number.isFinite(node.geometry.boundingSphere.radius), `mesh ${node.name || node.uuid} sphere radius`);
  }
});
console.log(`PASS  scene traversal validated ${meshes} meshes`);

console.log('\nWORLD TESTS PASSED');
dom.window.close();
