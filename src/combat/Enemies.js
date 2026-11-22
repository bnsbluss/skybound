import * as THREE from 'three';
import { clamp, damp } from '../utils/math.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FWD_LOCAL = new THREE.Vector3(0, 0, -1);

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _bankAxis = new THREE.Vector3();
const _qBank = new THREE.Quaternion();
const _basis = new THREE.Matrix4();

/**
 * Bandit fighter: a compact low-poly jet with a patrol / engage / break
 * state machine, terrain avoidance, lead pursuit and burst cannon fire.
 */
function buildBanditTemplate() {
  const group = new THREE.Group();
  group.name = 'bandit';

  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x9d3a33, flatShading: true });
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x74302e, flatShading: true });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x27313d, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff7a2a,
    toneMapped: false,
    fog: false,
    transparent: true,
    opacity: 0.95,
  });

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.4, 8, 5), bodyMat);
  fuselage.geometry.rotateX(Math.PI / 2);
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.4, 5), bodyMat);
  nose.geometry.rotateX(-Math.PI / 2);
  nose.position.z = -5.1;
  group.add(nose);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 2.2), darkMat);
  canopy.position.set(0, 0.72, -1.7);
  group.add(canopy);

  const wingGeo = new THREE.BoxGeometry(6.6, 0.28, 3.6);
  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  leftWing.position.set(-3.5, -0.15, 1.1);
  leftWing.rotation.y = 0.42;
  group.add(leftWing);
  const rightWing = new THREE.Mesh(wingGeo, wingMat);
  rightWing.position.set(3.5, -0.15, 1.1);
  rightWing.rotation.y = -0.42;
  group.add(rightWing);

  const tailGeo = new THREE.BoxGeometry(0.24, 2.3, 2.5);
  const tailL = new THREE.Mesh(tailGeo, wingMat);
  tailL.position.set(-1.15, 1.05, 3.3);
  tailL.rotation.z = 0.34;
  group.add(tailL);
  const tailR = new THREE.Mesh(tailGeo, wingMat);
  tailR.position.set(1.15, 1.05, 3.3);
  tailR.rotation.z = -0.34;
  group.add(tailR);

  const stab = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.22, 1.7), wingMat);
  stab.position.set(0, 0.1, 3.7);
  group.add(stab);

  const glowGeo = new THREE.CircleGeometry(0.46, 6);
  const glowL = new THREE.Mesh(glowGeo, glowMat);
  glowL.position.set(-0.5, 0, 4.05);
  glowL.rotation.y = Math.PI;
  group.add(glowL);
  const glowR = new THREE.Mesh(glowGeo, glowMat);
  glowR.position.set(0.5, 0, 4.05);
  glowR.rotation.y = Math.PI;
  group.add(glowR);

  group.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });
  return group;
}

export class Enemies {
  constructor(scene, quality = {}) {
    this.scene = scene;
    this.quality = quality;
    this.maxAlive = Math.max(1, Math.round(quality.enemies ?? 3));
    this.events = [];
    this.kills = 0;
    this.losses = 0;
    this._respawnTimer = 0;
    this._nextId = 1;

    // Combat tuning.
    this.maxHealth = 40;
    this.cruiseSpeed = 178;
    this.combatSpeed = 236;
    this.turnRate = 0.8;
    // The bandits own a much wider slice of sky than the player's spawn
    // bubble: they patrol and engage well outside the old 2.8 km ring, so
    // the fight is hunted down on radar instead of starting on the nose.
    this.engageRange = 3600;
    this.fireRange = 1150;
    this.missileRange = 1750;
    this.hitRadius = 8;
    this.terrainClearance = 30;

    this.template = buildBanditTemplate();
    this.list = [];
    this._aliveList = [];
    this._contactsCache = [];
    const poolSize = this.maxAlive + 2;
    for (let i = 0; i < poolSize; i++) {
      const group = this.template.clone();
      group.visible = false;
      this.scene.add(group);
      this.list.push({
        id: this._nextId++,
        group,
        alive: false,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        direction: new THREE.Vector3(0, 0, -1),
        speed: this.cruiseSpeed,
        health: this.maxHealth,
        maxHealth: this.maxHealth,
        radius: this.hitRadius,
        state: 'patrol',
        stateTime: 0,
        waypoint: new THREE.Vector3(),
        hasWaypoint: false,
        fireTimer: 0,
        burst: 0,
        mslTimer: 0,
        smokeTimer: 0,
      });
    }
  }

  getAlive() {
    this._aliveList.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.alive) this._aliveList.push(e);
    }
    return this._aliveList;
  }

  getContacts(playerPosition) {
    this._contactsCache.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive) continue;
      this._contactsCache.push({
        x: e.position.x,
        y: e.position.y,
        z: e.position.z,
        distance: Math.hypot(e.position.x - playerPosition.x, e.position.z - playerPosition.z),
        enemy: true,
        major: true,
        radius: 120,
        name: 'BANDIT',
      });
    }
    return this._contactsCache;
  }

  reset(playerPosition) {
    for (const e of this.list) {
      e.alive = false;
      e.group.visible = false;
      e.health = this.maxHealth;
    }
    this.events.length = 0;
    this.kills = 0;
    this.losses = 0;
    this._respawnTimer = 0;
    if (playerPosition) {
      for (let i = 0; i < this.maxAlive; i++) this.spawn(playerPosition);
    }
  }

  /** Places a fresh bandit on a ring around the player, inbound. */
  spawn(playerPosition) {
    const free = this.list.find((e) => !e.alive);
    if (!free) return null;
    const angle = Math.random() * Math.PI * 2;
    // Wide spawn ring: 3.2–5.2 km out. The tactical radar sweeps 7.5 km,
    // so every bandit is still visible — just not breathing down the neck.
    const radius = 3200 + Math.random() * 2000;
    const x = playerPosition.x + Math.cos(angle) * radius;
    const z = playerPosition.z + Math.sin(angle) * radius;
    const world = this._world;
    let y = playerPosition.y + (Math.random() - 0.35) * 500;
    if (world) {
      const ground = Math.max(
        world.getHeightAt(x, z),
        world.getWaveHeightAt ? world.getWaveHeightAt(x, z) : 0
      );
      const midGround = world.getHeightAt(
        (x + playerPosition.x) * 0.5,
        (z + playerPosition.z) * 0.5
      );
      y = Math.max(y, ground + 380, midGround + 260);
    }
    free.alive = true;
    free.position.set(x, y, z);
    free.health = this.maxHealth;
    free.speed = this.combatSpeed;
    free.state = 'engage';
    free.stateTime = 0;
    free.hasWaypoint = false;
    free.fireTimer = 0.6 + Math.random();
    free.burst = 0;
    free.mslTimer = 10 + Math.random() * 10;
    free.smokeTimer = 0;
    free.group.visible = true;
    free.group.position.copy(free.position);

    // Face the player on entry.
    _desired.subVectors(playerPosition, free.position).normalize();
    _fwd.copy(FWD_LOCAL);
    _right.crossVectors(_fwd, WORLD_UP).normalize();
    _up.crossVectors(_right, _fwd).normalize();
    _basis.makeBasis(_right, _up, _fwd.clone().negate());
    free.quaternion.setFromRotationMatrix(_basis);
    free.direction.copy(_fwd);
    free.group.quaternion.copy(free.quaternion);
    this.events.push({ type: 'spawn', target: free });
    return free;
  }

  destroy(target, point, credit = false) {
    if (!target.alive) return;
    target.alive = false;
    target.group.visible = false;
    this.events.push({ type: 'downed', target, point: point.clone(), credit });
  }

  update(dt, ctx) {
    const { world, player, weapons, explosions } = ctx;
    this._world = world;

    if (this._respawnTimer > 0) this._respawnTimer -= dt;
    const alive = this.getAlive().length;
    if (
      player &&
      player.alive &&
      alive < this.maxAlive &&
      this._respawnTimer <= 0 &&
      ctx.allowSpawn !== false
    ) {
      const spawned = this.spawn(player.position);
      if (spawned) this._respawnTimer = 3.2 + Math.random() * 2.5;
    }

    for (const e of this.list) {
      if (!e.alive) continue;
      this._updateEnemy(e, dt, { world, player, weapons, explosions });
    }
  }

  _updateEnemy(e, dt, ctx) {
    const { world, player, weapons, explosions } = ctx;
    e.stateTime += dt;
    e.fireTimer = Math.max(0, e.fireTimer - dt);
    e.mslTimer = Math.max(0, e.mslTimer - dt);

    const playerAlive = !!player && player.alive;
    const toPlayer = _tmp.subVectors(player.position, e.position);
    const distance = toPlayer.length();

    // --- State transitions -------------------------------------------------
    if (playerAlive && distance < this.engageRange && e.state === 'patrol') {
      e.state = 'engage';
      e.stateTime = 0;
    } else if ((!playerAlive || distance > this.engageRange * 1.4) && e.state !== 'patrol') {
      e.state = 'patrol';
      e.stateTime = 0;
      e.hasWaypoint = false;
    }

    const desired = _desired;
    if (e.state === 'engage') {
      if (distance < 340 && e.stateTime > 2) {
        e.state = 'break';
        e.stateTime = 0;
      } else {
        const leadTime = distance / (weapons?.enemyGunSpeed ?? 520);
        desired
          .copy(player.position)
          .addScaledVector(player.velocity, leadTime * 0.75)
          .sub(e.position)
          .normalize();
      }
    } else if (e.state === 'break') {
      desired.copy(e.position).sub(player.position).normalize();
      desired.y += 0.4;
      desired.normalize();
      if (e.stateTime > 3) {
        e.state = 'engage';
        e.stateTime = 0;
      }
    } else {
      if (!e.hasWaypoint || e.position.distanceTo(e.waypoint) < 320 || e.stateTime > 18) {
        this._pickWaypoint(e, world, player.position);
        e.stateTime = 0;
      }
      desired.subVectors(e.waypoint, e.position).normalize();
    }

    // --- Terrain avoidance -------------------------------------------------
    _fwd.copy(FWD_LOCAL).applyQuaternion(e.quaternion);
    const ground = Math.max(
      world.getHeightAt(e.position.x, e.position.z),
      world.getWaveHeightAt ? world.getWaveHeightAt(e.position.x, e.position.z) : 0
    );
    const aheadGround = Math.max(
      world.getHeightAt(
        e.position.x + _fwd.x * e.speed * 1.4,
        e.position.z + _fwd.z * e.speed * 1.4
      ),
      world.getHeightAt(
        e.position.x + _fwd.x * e.speed * 2.6,
        e.position.z + _fwd.z * e.speed * 2.6
      )
    );
    const agl = e.position.y - ground;
    const effectiveAgl = e.position.y - Math.max(ground, aheadGround);
    if (effectiveAgl < 280) {
      const pull = clamp((280 - effectiveAgl) / 260, 0, 1);
      desired.y = Math.max(desired.y, 0.2 * pull) + 1.3 * pull;
      desired.normalize();
    }
    if (e.position.y > 2400) {
      desired.y -= 0.5;
      desired.normalize();
    }

    // --- Steering with a coordinated bank ----------------------------------
    const steer = 1 - Math.exp(-this.turnRate * dt);
    _fwd.lerp(desired, steer).normalize();

    _right.crossVectors(_fwd, WORLD_UP);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, _fwd).normalize();

    const lateral = clamp(desired.dot(_right) * 1.8, -1, 1);
    const bank = lateral * 1.05;
    _bankAxis.copy(_fwd);
    _qBank.setFromAxisAngle(_bankAxis, bank);
    _right.applyQuaternion(_qBank);
    _up.applyQuaternion(_qBank);
    _back.copy(_fwd).negate();
    _basis.makeBasis(_right, _up, _back);
    e.quaternion.setFromRotationMatrix(_basis);
    e.quaternion.normalize();

    // --- Move ---------------------------------------------------------------
    const targetSpeed = e.state === 'engage' ? this.combatSpeed : this.cruiseSpeed;
    e.speed = damp(e.speed, targetSpeed, 0.8, dt);
    e.direction.copy(_fwd);
    e.position.addScaledVector(_fwd, e.speed * dt);
    e.position.y = Math.max(e.position.y, ground + this.terrainClearance);

    if (agl < this.terrainClearance + 4) {
      // Flew into the reef.
      const point = e.position.clone();
      explosions?.burst(point, 2.2, 0xffa64d);
      this.destroy(e, point, false);
      this.events.push({ type: 'terrain-crash', target: e, point });
      return;
    }

    e.group.position.copy(e.position);
    e.group.quaternion.copy(e.quaternion);

    // --- Damage smoke -------------------------------------------------------
    if (e.health < e.maxHealth * 0.6) {
      e.smokeTimer -= dt;
      if (e.smokeTimer <= 0) {
        e.smokeTimer = 0.1;
        _nose.copy(e.position).addScaledVector(_fwd, -3);
        explosions?.trailSmoke(_nose, { x: _fwd.x * e.speed, y: 0, z: _fwd.z * e.speed }, 1.1);
      }
    }

    // --- Guns ---------------------------------------------------------------
    if (
      e.state === 'engage' &&
      playerAlive &&
      weapons &&
      distance < this.fireRange &&
      e.fireTimer <= 0
    ) {
      const lead = distance / (weapons.enemyGunSpeed || 520);
      _aim
        .copy(player.position)
        .addScaledVector(player.velocity, lead * 0.8)
        .sub(e.position)
        .normalize();
      const alignment = _aim.dot(_fwd);
      if (alignment > 0.986) {
        _nose.copy(e.position).addScaledVector(_fwd, 7);
        const muzzle = { x: _fwd.x * e.speed, y: _fwd.y * e.speed, z: _fwd.z * e.speed };
        weapons.fireEnemyGun(_nose, _aim, muzzle, 0.018);
        this.events.push({ type: 'fire', target: e });
        e.burst += 1;
        if (e.burst >= 4) {
          e.burst = 0;
          e.fireTimer = 1.15 + Math.random() * 0.8;
        } else {
          e.fireTimer = 0.11;
        }
      } else {
        e.fireTimer = 0.35;
      }
    }

    // --- IR missiles -------------------------------------------------------
    // Bandits only shoot missiles with a tail (or close astern) chase inside
    // the seeker's envelope. Cooldown is long so the flare countermeasure
    // never feels spammed.
    if (
      e.state === 'engage' &&
      playerAlive &&
      weapons?.launchHostileMissile &&
      distance > 380 &&
      distance < this.missileRange &&
      e.mslTimer <= 0
    ) {
      const lead = distance / 300;
      _aim
        .copy(player.position)
        .addScaledVector(player.velocity, lead * 0.7)
        .sub(e.position)
        .normalize();
      if (_aim.dot(_fwd) > 0.985) {
        _nose.copy(e.position).addScaledVector(_fwd, 7);
        if (weapons.launchHostileMissile(_nose, _aim, player)) {
          e.mslTimer = 26 + Math.random() * 16;
        } else {
          e.mslTimer = 3;
        }
      } else {
        e.mslTimer = 1.4;
      }
    }
  }

  _pickWaypoint(e, world, playerPosition) {
    const angle = Math.random() * Math.PI * 2;
    // Patrol ring matches the spawn envelope (2.4–5.4 km) so bandits roam
    // the whole sector instead of tightening into a furball around the jet.
    const radius = 2400 + Math.random() * 3000;
    const x = playerPosition.x + Math.cos(angle) * radius;
    const z = playerPosition.z + Math.sin(angle) * radius;
    let y = 420 + Math.random() * 700;
    if (world) {
      const ground = Math.max(
        world.getHeightAt(x, z),
        world.getWaveHeightAt ? world.getWaveHeightAt(x, z) : 0
      );
      const midGround = world.getHeightAt(
        (x + playerPosition.x) * 0.5,
        (z + playerPosition.z) * 0.5
      );
      y = Math.max(y, ground + 380, midGround + 260);
    }
    e.waypoint.set(x, y, z);
    e.hasWaypoint = true;
  }

  consumeEvents() {
    if (!this.events.length) return [];
    const events = this.events;
    this.events = [];
    return events;
  }

  getStats() {
    return {
      alive: this.getAlive().length,
      max: this.maxAlive,
      kills: this.kills,
      losses: this.losses,
    };
  }

  clear() {
    for (const e of this.list) {
      e.alive = false;
      e.group.visible = false;
    }
    this.events.length = 0;
    this._respawnTimer = 0;
  }

  /** Moves the bandit meshes into a freshly generated world scene. */
  reattach(scene) {
    this.scene = scene;
    for (const e of this.list) scene.add(e.group);
  }

  /** Terrain sampler used when picking a safe spawn altitude. */
  setWorld(world) {
    this._world = world;
  }
}
