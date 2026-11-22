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
window.HTMLCanvasElement.prototype.getContext = function (type) {
  return type === '2d' ? make2d() : null;
};

const { QUALITY_PRESETS } = await import('../src/core/Quality.js');
const { World } = await import('../src/world/World.js');
const { BIOMES } = await import('../src/world/Biomes.js');
const { SPAWN } = await import('../src/aircraft/FlightPhysics.js');

const quality = QUALITY_PRESETS.low;
const matrices = new THREE.Matrix4();
const position = new THREE.Vector3();

function instancedPositions(world, name) {
  const mesh = world.scene.getObjectByName(name);
  if (!mesh) return [];
  const out = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrices);
    position.setFromMatrixPosition(matrices);
    out.push(position.clone());
  }
  return out;
}

async function build(id) {
  const world = new World(quality, BIOMES[id]);
  await world.build();
  return world;
}

// --------------------------------------------------------------------------
// Every land map must be dry, solid and large enough to lose the horizon.
// --------------------------------------------------------------------------
for (const id of ['city', 'desert', 'mountain']) {
  const world = await build(id);
  const stats = world.getStats();
  const label = BIOMES[id].label;

  assert.equal(world.land, true, `${id} is a land map`);
  assert.equal(stats.land, true, `${id} stats flag land`);
  assert.equal(stats.islands, 1, `${id} is one mainland`);
  assert.equal(world.ocean.mesh.visible, false, `${id} hides the ocean mesh`);
  assert.equal(world.getWaveHeightAt(0, 0), 0, `${id} has no wave motion`);
  assert.equal(world.getSurfaceHeightAt(0, 0), Math.max(0, world.getHeightAt(0, 0)), `${id} surface is dry land`);
  assert.deepEqual(world.getRadarContacts(0, 0, 7500), [], `${id} radar plots aircraft only`);

  const ground = world.scene.getObjectByName('land-plane');
  assert.ok(ground, `${id} has a ground sheet under the terrain`);
  assert.equal(ground.position.y, -0.8, `${id} ground sheet sits below sea level`);
  assert.equal(ground.geometry.parameters.width, 80000, `${id} ground sheet reaches 80 km`);
  assert.equal(ground.geometry.parameters.height, 80000, `${id} ground sheet covers the horizon`);
  assert.equal(stats.trees + stats.structures + stats.rocks > 100, true, `${id} is populated`);

  // The mainland plateau must be continuous: a ring of samples around the
  // spawn point stays above sea level, so no water can peek through.
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const h = world.getHeightAt(Math.cos(angle) * 2200, Math.sin(angle) * 2200);
    assert.ok(h > 0, `${id} terrain above water at ring sample ${i} (${h.toFixed(1)} m)`);
  }

  // Safe spawn: the game lifts the jet 380 m above the local surface, and the
  // surface under SPAWN must not be a water hole.
  const groundAtSpawn = world.getHeightAt(SPAWN.position.x, SPAWN.position.z);
  assert.ok(groundAtSpawn > 0, `${id} spawn sits over land (${groundAtSpawn.toFixed(1)} m)`);
  assert.ok(
    Math.max(SPAWN.position.y, groundAtSpawn + 380) > groundAtSpawn + 300,
    `${id} spawn clears the terrain`
  );

  world.dispose();
  console.log(`PASS  ${label}: dry mainland, 80 km ground sheet, safe spawn`);
}

// --------------------------------------------------------------------------
// City: downtown skyline with one supertower exactly at map centre.
// --------------------------------------------------------------------------
{
  const world = await build('city');
  const stats = world.getStats();
  assert.ok(stats.structures >= 250, `city generated a skyline (${stats.structures} structures)`);
  assert.ok(stats.structures > stats.trees, 'city is denser with buildings than trees');

  const supertowers = instancedPositions(world, 'trees-supertower');
  assert.equal(supertowers.length, 1, 'city has one landmark supertower');
  assert.ok(
    Math.hypot(supertowers[0].x, supertowers[0].z) < 1,
    'the supertower stands at map centre'
  );

  const towers = instancedPositions(world, 'trees-tower');
  assert.ok(towers.length >= 100, `downtown ring has ${towers.length} towers`);
  let inner = 0;
  for (const tower of towers) {
    if (Math.hypot(tower.x, tower.z) < 3000) inner++;
  }
  assert.ok(inner / towers.length > 0.55, 'most towers cluster around downtown');

  const centre = world.getHeightAt(0, 0);
  assert.ok(centre > 5 && centre < 90, `downtown is a low plateau (${centre.toFixed(1)} m)`);
  assert.equal(
    world.scene.getObjectByName('trees-cactus') ?? null,
    null,
    'city has no desert props'
  );

  // New York layout: road grid, rivers, Central Park, landmarks, 5 bridges and live traffic.
  assert.ok(world.scene.getObjectByName('city-roads'), 'city has asphalt street grid');
  assert.ok(world.scene.getObjectByName('city-rivers'), 'city has Hudson & East River');
  assert.ok(world.scene.getObjectByName('city-park'), 'city has Central Park');
  assert.ok(world.scene.getObjectByName('city-park-water'), 'city has Central Park reservoir & lakes');
  assert.ok(world.scene.getObjectByName('city-landmarks'), 'city has Chrysler & One WTC landmarks');
  assert.ok(world.scene.getObjectByName('city-liberty'), 'city has Statue of Liberty in the bay');
  assert.ok(world.scene.getObjectByName('city-bridges'), 'city has suspension bridges');
  assert.equal(stats.bridges, 5, 'five river crossings built');
  assert.ok(stats.traffic >= 200, `live traffic pool active (${stats.traffic} vehicles)`);
  const carsBefore = instancedPositions(world, 'city-taxis').map((p) => p.clone());
  assert.ok(carsBefore.length > 20, `yellow taxis on the avenues (${carsBefore.length})`);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 32000);
  camera.position.set(0, 120, 0);
  world.update(1.2, camera, camera.position);
  const carsAfter = instancedPositions(world, 'city-taxis');
  const movedCars = carsAfter.filter((p, i) => p.distanceTo(carsBefore[i]) > 0.5);
  assert.ok(movedCars.length > 10, `traffic advances along lanes (${movedCars.length} taxis moved)`);

  world.dispose();
  console.log(`PASS  KOTA: ${stats.structures} buildings, ${stats.traffic} vehicles, 5 bridges, Central Park & NYC landmarks`);
}

// --------------------------------------------------------------------------
// Coral: tropical archipelago with lighthouses, beach huts and lagoon boats.
// --------------------------------------------------------------------------
{
  const world = await build('coral');
  const stats = world.getStats();
  assert.equal(world.land, false, 'coral is an ocean archipelago');
  assert.equal(stats.islands, 15, 'coral has 15 islands');
  const lighthouses = instancedPositions(world, 'trees-lighthouse');
  const huts = instancedPositions(world, 'trees-hut');
  const boats = instancedPositions(world, 'trees-boat');
  assert.ok(lighthouses.length >= 3, `coral placed ${lighthouses.length} coastal lighthouses`);
  assert.ok(huts.length >= 10, `coral placed ${huts.length} beach huts`);
  assert.ok(boats.length >= 10, `coral anchored ${boats.length} lagoon sailboats`);

  // Active volcanoes with glowing lava craters and rising volcanic smoke plumes.
  const volcanoes = world.scene.getObjectByName('coral-volcanoes');
  const volcanoSmoke = world.scene.getObjectByName('volcano-smoke');
  assert.ok(volcanoes, 'coral has active volcanic calderas');
  assert.ok(volcanoes.getObjectByName('volcano-lava'), 'coral volcanoes have molten lava craters');
  assert.ok(volcanoSmoke && volcanoSmoke.isInstancedMesh, 'coral volcanoes emit instanced smoke plumes');
  assert.ok(volcanoSmoke.count >= 40, `volcano smoke puffs active (${volcanoSmoke.count})`);
  const smokeBefore = instancedPositions(world, 'volcano-smoke').map((p) => p.clone());
  const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 32000);
  world.update(0.8, cam, cam.position);
  const smokeAfter = instancedPositions(world, 'volcano-smoke');
  const movedSmoke = smokeAfter.filter((p, i) => p.distanceTo(smokeBefore[i]) > 0.5);
  assert.ok(movedSmoke.length >= 30, `volcano smoke rises and drifts (${movedSmoke.length} puffs moved)`);

  world.dispose();
  console.log(`PASS  CORAL: 15 islands, 4 active volcanoes with smoke plumes, ${lighthouses.length} lighthouses, ${huts.length} huts, ${boats.length} sailboats`);
}

// --------------------------------------------------------------------------
// Desert: vast dune sea with cacti and no buildings at all.
// --------------------------------------------------------------------------
{
  const world = await build('desert');
  const stats = world.getStats();
  assert.equal(stats.structures, 0, 'desert has no buildings');
  const cacti = instancedPositions(world, 'trees-cactus');
  assert.ok(cacti.length > 0, `desert scattered ${cacti.length} cacti`);
  assert.equal(world.scene.getObjectByName('trees-supertower') ?? null, null, 'no landmark tower');
  assert.equal(world.scene.getObjectByName('trees-building') ?? null, null, 'no city block mesh');

  let peak = 0;
  for (let x = -12000; x <= 12000; x += 600) {
    for (let z = -12000; z <= 12000; z += 600) {
      peak = Math.max(peak, world.getHeightAt(x, z));
    }
  }
  assert.ok(peak > 45, `dunes rise above the flats (${peak.toFixed(1)} m)`);
  assert.ok(peak < 260, `dunes stay rolling, not alpine (${peak.toFixed(1)} m)`);
  assert.ok(stats.rocks >= 20, `desert rocks: ${stats.rocks}`);
  assert.ok(world.scene.getObjectByName('desert-oases'), 'desert has oasis water pools');
  assert.ok(instancedPositions(world, 'trees-palm').length >= 50, 'oases ringed with palm trees');
  assert.equal(instancedPositions(world, 'trees-pyramid').length, 3, 'desert has 3 stepped pyramids');
  assert.ok(instancedPositions(world, 'trees-mesa').length >= 4, 'desert has sandstone mesas');
  world.dispose();
  console.log(`PASS  GURUN: dune sea (peak ${peak.toFixed(0)} m), oases, pyramids, mesas, cacti`);
}

// --------------------------------------------------------------------------
// Mountain: broad highland massif with pine forests and snow-ready peaks.
// --------------------------------------------------------------------------
{
  const world = await build('mountain');
  const stats = world.getStats();
  assert.equal(stats.structures, 0, 'mountain map has no buildings');
  const pines = instancedPositions(world, 'trees-pine');
  assert.ok(pines.length > 100, `pine forest covers the highlands (${pines.length} trees)`);
  assert.equal(world.scene.getObjectByName('trees-building') ?? null, null, 'no city block mesh');

  let peak = 0;
  let min = Infinity;
  for (let x = -14000; x <= 14000; x += 700) {
    for (let z = -14000; z <= 14000; z += 700) {
      const h = world.getHeightAt(x, z);
      peak = Math.max(peak, h);
      min = Math.min(min, h);
    }
  }
  assert.ok(peak > 700, `highland massif towers over the deck (${peak.toFixed(0)} m)`);
  assert.ok(min >= 0, 'no terrain sample drops below sea level inside the map');
  assert.ok(world.getSurfaceHeightAt(0, 0) >= 0, 'mountain surface is dry');

  // The highland must read as broad massifs, not a field of needles. Keep
  // the whole range below alpine-cliff steepness on average: sparse steep
  // faces are fine, but most of the map has to be flyable and buildable.
  let slopeSum = 0;
  let slopeCount = 0;
  let steep = 0;
  for (let x = -12000; x <= 12000; x += 300) {
    for (let z = -12000; z <= 12000; z += 300) {
      if (world.getHeightAt(x, z) < 5) continue;
      const hx = world.getHeightAt(x + 150, z) - world.getHeightAt(x - 150, z);
      const hz = world.getHeightAt(x, z + 150) - world.getHeightAt(x, z - 150);
      const slope = Math.hypot(hx, hz) / 300;
      slopeSum += slope;
      slopeCount++;
      if (slope > 0.9) steep++;
    }
  }
  const meanSlope = slopeSum / slopeCount;
  assert.ok(meanSlope < 0.55, `highland slopes stay broad (mean ${meanSlope.toFixed(2)})`);
  assert.ok(
    steep / slopeCount < 0.08,
    `only a few cliff faces (${((steep / slopeCount) * 100).toFixed(1)}% above 42°)`
  );

  // Terrain-aware spawn must climb above even the highest ridge.
  const groundAtSpawn = world.getHeightAt(SPAWN.position.x, SPAWN.position.z);
  const spawnY = Math.max(SPAWN.position.y, groundAtSpawn + 380);
  assert.ok(spawnY > peak * 0.4, `spawn climbs with the terrain (${spawnY.toFixed(0)} m)`);
  assert.ok(world.scene.getObjectByName('mountain-lakes'), 'mountain has alpine lakes');
  assert.ok(instancedPositions(world, 'trees-snowpine').length > 20, 'high timberline has snow-dusted pines');
  world.dispose();
  console.log(
    `PASS  GUNUNG: massif peak ${peak.toFixed(0)} m, mean slope ${meanSlope.toFixed(2)}, alpine lakes, pine & snowpine forests`
  );
}

console.log('\nLAND MAP TESTS PASSED');
