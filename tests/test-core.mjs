import * as THREE from 'three';
import { createIsland, ISLAND_BLUEPRINTS, createArchipelago } from '../src/utils/terrain.js';
import { FlightPhysics, SPAWN } from '../src/aircraft/FlightPhysics.js';
import { mulberry32 } from '../src/utils/noise.js';

let failures = 0;
const check = (name, cond, extra='') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
};

console.log('\n--- Island sampler ---');
for (const def of ISLAND_BLUEPRINTS) {
  const isl = createIsland(def);
  let maxH = -999, minH = 999;
  for (let i = 0; i < 2000; i++) {
    const a = (i / 2000) * Math.PI * 2 * 7;
    const r = (i / 2000) * def.radius * 1.2;
    const x = def.x + Math.cos(a) * r;
    const z = def.z + Math.sin(a) * r;
    const h = isl.heightAt(x, z);
    maxH = Math.max(maxH, h);
    minH = Math.min(minH, h);
  }
  const ratios = isl.coastSamples.map(s => s.ratio);
  const ratioRange = `${Math.min(...ratios).toFixed(2)}-${Math.max(...ratios).toFixed(2)}`;
  console.log(`${def.id.padEnd(9)} peak=${maxH.toFixed(0).padStart(4)} coastRatio=${isl.coastRatio.toFixed(2)} (${ratioRange}) coastR=${isl.coastRadius.toFixed(0)}`);
  check(`  ${def.id}: max height sane`, maxH > 10 && maxH < def.peak * 1.5, `max=${maxH.toFixed(1)} target=${def.peak}`);
  check(`  ${def.id}: coast ratio sane`, isl.coastRatio > 0.65 && isl.coastRatio < 1.05, isl.coastRatio.toFixed(2));
}

console.log('\n--- Spawn clearance ---');
const arch = createArchipelago();
const spawnGround = Math.max(0, ...arch.map(i => i.heightAt(SPAWN.position.x, SPAWN.position.z)));
check('spawn is well above terrain', SPAWN.position.y > spawnGround + 100, `ground=${spawnGround.toFixed(1)}`);
check('spawn island is visible ahead', arch[0].heightAt(arch[0].def.x, arch[0].def.z) > 50, `peak=${arch[0].heightAt(arch[0].def.x, arch[0].def.z).toFixed(0)}`);

console.log('\n--- Flight physics ---');
const phys = new FlightPhysics();
check('starts at spawn altitude', Math.abs(phys.position.y - SPAWN.position.y) < 0.01);
const level = {pitch:0, roll:0, yaw:0, boost:false, brake:false, throttle:0.68};
for (let i = 0; i < 600; i++) phys.update(1/60, level);
check('level flight holds altitude', Math.abs(phys.position.y - SPAWN.position.y) < 12, `y=${phys.position.y.toFixed(1)}`);
check('level flight accelerates to cruise', phys.speed > 150 && phys.speed < 240, `speed=${phys.speed.toFixed(1)} m/s`);
check('stays wings-level', Math.abs(phys.rollDeg) < 6, `roll=${phys.rollDeg.toFixed(1)}`);
check('heading roughly north', phys.headingDeg < 10 || phys.headingDeg > 350, `hdg=${phys.headingDeg.toFixed(1)}`);

phys.reset();
const pull = {pitch:1, roll:0, yaw:0, boost:false, brake:false, throttle:0.8};
for (let i = 0; i < 90; i++) phys.update(1/60, pull);
check('S/pitch-up climbs', phys.pitchDeg > 10, `pitch=${phys.pitchDeg.toFixed(1)}°`);
check('pulling g loads the aircraft', phys.gForce > 1.2, `g=${phys.gForce.toFixed(2)}`);

phys.reset();
const boost = {pitch:0, roll:0, yaw:0, boost:true, brake:false, throttle:1};
for (let i = 0; i < 240; i++) phys.update(1/60, boost);
check('afterburner increases speed', phys.speed > 300, `speed=${phys.speed.toFixed(1)}`);
check('boost reserve drains steadily and lasts longer', phys.boostAmount < 0.65 && phys.boostAmount > 0.35, `boost=${phys.boostAmount.toFixed(2)}`);
check('boost visual signal active', phys.boosting && phys.afterburner > 0.9);
// Higher boost-stat airframe (e.g. Elite jet) drains slower and recharges faster.
const elitePhys = new FlightPhysics();
elitePhys.setStats({ speed: 1.48, turn: 1.46, boost: 1.55, hull: 135 });
elitePhys.reset();
for (let i = 0; i < 240; i++) elitePhys.update(1/60, boost);
check('high-boost airframe retains more afterburner reserve', elitePhys.boostAmount > phys.boostAmount, `elite=${elitePhys.boostAmount.toFixed(2)} stock=${phys.boostAmount.toFixed(2)}`);
const stockBeforeRecharge = phys.boostAmount;
const eliteBeforeRecharge = elitePhys.boostAmount;
for (let i = 0; i < 60; i++) {
  phys.update(1/60, level);
  elitePhys.update(1/60, level);
}
check(
  'high-boost airframe recharges faster',
  (elitePhys.boostAmount - eliteBeforeRecharge) > (phys.boostAmount - stockBeforeRecharge),
  `eliteGain=${(elitePhys.boostAmount - eliteBeforeRecharge).toFixed(2)} stockGain=${(phys.boostAmount - stockBeforeRecharge).toFixed(2)}`
);

phys.reset();
const brake = {pitch:0, roll:0, yaw:0, boost:false, brake:true, throttle:0.2};
for (let i = 0; i < 600; i++) phys.update(1/60, brake);
check('airbrake bleeds speed', phys.speed < 100, `speed=${phys.speed.toFixed(1)}`);

phys.reset();
const roll = {pitch:0, roll:1, yaw:0, boost:false, brake:false, throttle:0.7};
for (let i = 0; i < 60; i++) phys.update(1/60, roll);
check('A/roll-left banks left', phys.rollDeg > 10, `bank=${phys.rollDeg.toFixed(1)}°`);
const startHeading = phys.headingDeg;
for (let i = 0; i < 240; i++) phys.update(1/60, level);
check('banked flight turns the jet', Math.abs(((phys.headingDeg - startHeading + 540) % 360) - 180) > 8, `hdg ${startHeading.toFixed(0)} -> ${phys.headingDeg.toFixed(0)}`);

check('quaternion stays normalized', Math.abs(phys.quaternion.length() - 1) < 1e-6);
check('velocity is finite', [phys.velocity.x, phys.velocity.y, phys.velocity.z].every(Number.isFinite));

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures ? 1 : 0);
