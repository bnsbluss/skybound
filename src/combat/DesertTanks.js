import * as THREE from 'three';
import { clamp, damp } from '../utils/math.js';

const _toPlayer = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/**
 * Builds a low-poly desert Main Battle Tank (MBT) with sloped sand-camo hull,
 * armored tracks, independently rotating turret, 120mm cannon barrel & muzzle flash.
 */
function buildTankTemplate() {
  const group = new THREE.Group();
  group.name = 'desert-tank';

  const sandMat = new THREE.MeshLambertMaterial({ color: 0xc2a673, flatShading: true });
  const camoDarkMat = new THREE.MeshLambertMaterial({ color: 0x7a6544, flatShading: true });
  const treadMat = new THREE.MeshLambertMaterial({ color: 0x26231e, flatShading: true });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x3b3832, flatShading: true });
  const hostileMat = new THREE.MeshLambertMaterial({ color: 0xd64a32, flatShading: true });
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffb84d,
    toneMapped: false,
    fog: false,
    transparent: true,
    opacity: 0.92,
  });

  // Main armored chassis hull (scaled ~2.4× so clearly legible from jet altitudes).
  const hull = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.0, 14.2), sandMat);
  hull.position.set(0, 2.2, 0);
  group.add(hull);

  // Sloped front glacis armor plate & rear engine deck louver.
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1.4, 3.6), camoDarkMat);
  glacis.position.set(0, 2.6, -6.2);
  glacis.rotation.x = 0.42;
  group.add(glacis);

  const engineDeck = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.7, 4.4), camoDarkMat);
  engineDeck.position.set(0, 3.9, 4.2);
  group.add(engineDeck);

  // Heavy left & right armored treads + skirts.
  for (const side of [-1, 1]) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.5, 15.0), treadMat);
    tread.position.set(side * 4.4, 1.3, 0);
    group.add(tread);

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.5, 13.8), camoDarkMat);
    skirt.position.set(side * 5.45, 2.1, 0);
    group.add(skirt);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 2.6), hostileMat);
    stripe.position.set(side * 5.72, 2.4, -3.5);
    group.add(stripe);
  }

  // Independently rotating turret group.
  const turret = new THREE.Group();
  turret.name = 'turret';
  turret.position.set(0, 4.2, -0.4);
  group.add(turret);

  const turretBody = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.4, 7.6), sandMat);
  turretBody.position.set(0, 0.9, 0.4);
  turret.add(turretBody);

  const turretMantlet = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.5, 1.8), camoDarkMat);
  turretMantlet.position.set(0, 0.95, -3.6);
  turret.add(turretMantlet);

  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.65, 6), camoDarkMat);
  hatch.position.set(1.2, 2.35, 1.2);
  turret.add(hatch);

  const beacon = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.0), hostileMat);
  beacon.position.set(-1.3, 2.3, 0.9);
  turret.add(beacon);

  // Elevating cannon pivot + 120mm main barrel + muzzle flash.
  const gunPivot = new THREE.Group();
  gunPivot.name = 'gun-pivot';
  gunPivot.position.set(0, 1.05, -4.0);
  turret.add(gunPivot);

  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.42, 10.6, 7);
  barrelGeo.rotateX(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, gunMat);
  barrel.position.set(0, 0, -5.2);
  gunPivot.add(barrel);

  const muzzleFlash = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 0), flashMat);
  muzzleFlash.name = 'muzzle-flash';
  muzzleFlash.position.set(0, 0, -10.8);
  muzzleFlash.visible = false;
  gunPivot.add(muzzleFlash);

  group.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });
  return group;
}

/**
 * Patrolling & firing desert Main Battle Tank column — active exclusively on
 * the GURUN (desert) map. Counts as lockable / destroyable hostile targets and
 * contributes directly to desert mission kill objectives.
 */
export class DesertTanks {
  constructor(scene, quality = {}) {
    this.scene = scene;
    this.quality = quality;
    this.maxAlive = Math.max(4, Math.min(8, Math.round((quality.enemies ?? 4) + 2)));
    this.maxHealth = 55;
    this.hitRadius = 11.5;
    this.fireRange = 2250;
    this.world = null;
    this.active = false;
    this.events = [];
    this.kills = 0;
    this._respawnTimer = 0;
    this._nextId = 9001;

    this.template = buildTankTemplate();
    this.list = [];
    this._aliveList = [];
    this._contactsCache = [];

    for (let i = 0; i < this.maxAlive; i++) {
      const group = this.template.clone();
      group.visible = false;
      this.scene.add(group);
      const turret = group.getObjectByName('turret');
      const gunPivot = group.getObjectByName('gun-pivot');
      const muzzleFlash = group.getObjectByName('muzzle-flash');
      this.list.push({
        id: this._nextId++,
        kind: 'tank',
        callsign: `TANK-${String(i + 1).padStart(2, '0')}`,
        group,
        turret,
        gunPivot,
        muzzleFlash,
        alive: false,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        direction: new THREE.Vector3(0, 0, -1),
        heading: 0,
        turretYaw: 0,
        gunPitch: 0.18,
        speed: 26,
        health: this.maxHealth,
        maxHealth: this.maxHealth,
        radius: this.hitRadius,
        waypoint: new THREE.Vector3(),
        fireTimer: 1.5 + i * 0.45,
        burstLeft: 0,
        burstDelay: 0,
        flashTimer: 0,
        smokeTimer: 0,
      });
    }
  }

  setWorld(world) {
    this.world = world;
    this.active = world?.biomeId === 'desert';
    if (!this.active) this.clear();
  }

  reattach(scene) {
    this.scene = scene;
    for (const tank of this.list) {
      if (tank.group.parent !== scene) scene.add(tank.group);
    }
  }

  getAlive() {
    this._aliveList.length = 0;
    if (!this.active) return this._aliveList;
    for (let i = 0; i < this.list.length; i++) {
      const t = this.list[i];
      if (t.alive) this._aliveList.push(t);
    }
    return this._aliveList;
  }

  getContacts(playerPosition) {
    this._contactsCache.length = 0;
    if (!this.active) return this._contactsCache;
    for (const t of this.list) {
      if (!t.alive) continue;
      this._contactsCache.push({
        id: t.id,
        kind: 'tank',
        callsign: t.callsign,
        x: t.position.x,
        y: t.position.y,
        z: t.position.z,
        dx: t.position.x - playerPosition.x,
        dz: t.position.z - playerPosition.z,
        heading: t.heading,
      });
    }
    return this._contactsCache;
  }

  consumeEvents() {
    if (!this.events.length) return [];
    const copy = this.events.slice();
    this.events.length = 0;
    return copy;
  }

  clear() {
    for (const t of this.list) {
      t.alive = false;
      t.group.visible = false;
      if (t.muzzleFlash) t.muzzleFlash.visible = false;
    }
    this.events.length = 0;
    this._respawnTimer = 0;
  }

  /** Spawns patrolling desert tanks around the player's forward desert sector. */
  spawn(playerPosition = new THREE.Vector3()) {
    this.clear();
    if (!this.active || !this.world) return;
    for (let i = 0; i < this.list.length; i++) {
      this._spawnOne(this.list[i], playerPosition, i);
    }
  }

  _pickDesertSpot(anchor, index = 0) {
    const bounds = this.world?.getMapBounds?.() ?? { maxRadius: 9500 };
    const safeR = Math.max(1800, (bounds.maxRadius || 9500) * 0.65);
    const angle = (index / Math.max(1, this.list.length)) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const dist = 1200 + Math.random() * 2400;
    let x = anchor.x + Math.sin(angle) * dist;
    let z = anchor.z - Math.cos(angle) * dist;
    const len = Math.hypot(x, z);
    if (len > safeR) {
      x = (x / len) * safeR;
      z = (z / len) * safeR;
    }
    const y = this.world ? this.world.getHeightAt(x, z) : 0;
    return { x, y, z };
  }

  _spawnOne(tank, anchor, index = 0) {
    const spot = this._pickDesertSpot(anchor, index);
    tank.alive = true;
    tank.health = this.maxHealth;
    tank.position.set(spot.x, spot.y + 1.2, spot.z);
    tank.heading = Math.random() * Math.PI * 2;
    tank.direction.set(-Math.sin(tank.heading), 0, -Math.cos(tank.heading)).normalize();
    tank.speed = 22 + Math.random() * 10;
    tank.turretYaw = 0;
    tank.gunPitch = 0.22;
    tank.fireTimer = 1.4 + Math.random() * 2.2;
    tank.burstLeft = 0;
    tank.burstDelay = 0;
    tank.flashTimer = 0;
    tank.smokeTimer = 0;
    const wp = this._pickDesertSpot(tank.position, index + 2);
    tank.waypoint.set(wp.x, wp.y, wp.z);
    tank.group.position.copy(tank.position);
    tank.group.rotation.set(0, tank.heading, 0);
    tank.quaternion.copy(tank.group.quaternion);
    tank.group.visible = true;
  }

  update(dt, { playerPosition, playerVelocity, weapons, explosions, allowFire = true } = {}) {
    if (!this.active || !this.world || dt <= 0) return;

    let aliveCount = 0;
    for (const tank of this.list) {
      if (!tank.alive) continue;
      if (tank.health <= 0) {
        tank.alive = false;
        tank.group.visible = false;
        if (tank.muzzleFlash) tank.muzzleFlash.visible = false;
        this.kills++;
        explosions?.burst(tank.position, 2.2);
        this.events.push({ type: 'tank-down', tank, position: tank.position.clone() });
        continue;
      }
      aliveCount++;

      // 1. Desert patrol steering between waypoints along the dune surface.
      const wx = tank.waypoint.x - tank.position.x;
      const wz = tank.waypoint.z - tank.position.z;
      const wDist = Math.hypot(wx, wz);
      if (wDist < 140) {
        const nextWp = this._pickDesertSpot(playerPosition ?? tank.position, Math.floor(Math.random() * 6));
        tank.waypoint.set(nextWp.x, nextWp.y, nextWp.z);
      } else {
        const wantHeading = Math.atan2(-wx, -wz);
        let diff = wantHeading - tank.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        tank.heading += clamp(diff, -0.55 * dt, 0.55 * dt);
      }

      tank.direction.set(-Math.sin(tank.heading), 0, -Math.cos(tank.heading));
      tank.position.x += tank.direction.x * tank.speed * dt;
      tank.position.z += tank.direction.z * tank.speed * dt;

      // Stay well inside the desert combat zone boundary.
      const bounds = this.world.getMapBounds?.();
      if (bounds) {
        const r = Math.hypot(tank.position.x, tank.position.z);
        if (r > bounds.maxRadius * 0.85) {
          const s = (bounds.maxRadius * 0.85) / r;
          tank.position.x *= s;
          tank.position.z *= s;
          tank.waypoint.set(0, 0, 0);
        }
      }

      // Terrain elevation + subtle dune slope pitch alignment.
      const groundY = this.world.getHeightAt(tank.position.x, tank.position.z);
      const aheadY = this.world.getHeightAt(
        tank.position.x + tank.direction.x * 10,
        tank.position.z + tank.direction.z * 10
      );
      const slopePitch = clamp(Math.atan2(aheadY - groundY, 10), -0.35, 0.35);
      tank.position.y = groundY + 1.2;
      tank.group.position.copy(tank.position);
      tank.group.rotation.set(slopePitch, tank.heading, 0, 'YXZ');
      tank.quaternion.copy(tank.group.quaternion);

      // Smoke plume if damaged below half armor.
      if (tank.health < this.maxHealth * 0.55 && explosions) {
        tank.smokeTimer -= dt;
        if (tank.smokeTimer <= 0) {
          tank.smokeTimer = 0.14;
          explosions.trailSmoke(tank.position, { x: 0, y: 1, z: 0 }, 1.2);
        }
      }

      // Muzzle flash fade-out.
      if (tank.flashTimer > 0) {
        tank.flashTimer -= dt;
        if (tank.muzzleFlash) tank.muzzleFlash.visible = tank.flashTimer > 0;
      }

      // 2. Turret tracking & anti-air cannon fire at the player when in range.
      if (playerPosition && allowFire && weapons) {
        _toPlayer.subVectors(playerPosition, tank.position);
        const dist = _toPlayer.length();
        if (dist < this.fireRange && dist > 90) {
          // Lead moving player gently so tracers arc realistically across the sky.
          const leadT = clamp(dist / 640, 0.1, 1.4);
          _aim.copy(playerPosition);
          if (playerVelocity) _aim.addScaledVector(playerVelocity, leadT * 0.55);
          _aim.sub(tank.position);
          const aimDist = _aim.length() || 1;
          const worldYaw = Math.atan2(-_aim.x, -_aim.z);
          let relYaw = worldYaw - tank.heading;
          while (relYaw > Math.PI) relYaw -= Math.PI * 2;
          while (relYaw < -Math.PI) relYaw += Math.PI * 2;
          let yawDelta = relYaw - tank.turretYaw;
          while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
          while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
          tank.turretYaw += clamp(yawDelta, -1.6 * dt, 1.6 * dt);

          const wantPitch = clamp(Math.asin(clamp(_aim.y / aimDist, -0.1, 0.92)), 0.05, 1.05);
          tank.gunPitch = damp(tank.gunPitch, wantPitch, 5, dt);

          if (tank.turret) tank.turret.rotation.y = tank.turretYaw;
          if (tank.gunPivot) tank.gunPivot.rotation.x = tank.gunPitch;

          // Fire 3-round flak / cannon tracer bursts when turret is aligned!
          const aligned = Math.abs(yawDelta) < 0.24;
          if (tank.burstLeft > 0) {
            tank.burstDelay -= dt;
            if (tank.burstDelay <= 0) {
              tank.burstLeft--;
              tank.burstDelay = 0.19;
              const aimDir = _fwd.copy(_aim).divideScalar(aimDist);
              // Small realistic flak spread.
              aimDir.x += (Math.random() - 0.5) * 0.055;
              aimDir.y += (Math.random() - 0.5) * 0.055;
              aimDir.z += (Math.random() - 0.5) * 0.055;
              aimDir.normalize();
              _muzzle.copy(tank.position).add(new THREE.Vector3(0, 5.4, 0)).addScaledVector(aimDir, 9.5);
              weapons.fireEnemyGun(_muzzle, aimDir);
              tank.flashTimer = 0.09;
              if (tank.muzzleFlash) tank.muzzleFlash.visible = true;
            }
          } else {
            tank.fireTimer -= dt;
            if (tank.fireTimer <= 0 && aligned) {
              tank.burstLeft = 3;
              tank.burstDelay = 0;
              tank.fireTimer = 2.6 + Math.random() * 1.8;
            }
          }
        }
      }
    }

    // Respawn destroyed tanks so the desert patrol keeps rolling.
    if (aliveCount < this.maxAlive) {
      this._respawnTimer += dt;
      if (this._respawnTimer >= 5.5) {
        this._respawnTimer = 0;
        const dead = this.list.find((t) => !t.alive);
        if (dead) {
          this._spawnOne(dead, playerPosition ?? new THREE.Vector3(), Math.floor(Math.random() * this.list.length));
        }
      }
    }
  }

  dispose() {
    for (const t of this.list) {
      this.scene?.remove(t.group);
    }
    this.list.length = 0;
  }
}
