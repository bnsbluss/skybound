import * as THREE from 'three';
import { getMissile } from './MissileCatalog.js';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _sideVec = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _smokeColor = new THREE.Color();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FWD_AXIS = new THREE.Vector3(0, 0, -1);
const _dummy = new THREE.Object3D();

function makeMissileMesh(hostile = false) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.3, 3.4, 6),
    new THREE.MeshLambertMaterial({ color: hostile ? 0xbf5a4d : 0xd9dee6, flatShading: true })
  );
  body.geometry.rotateX(Math.PI / 2);
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 1.2, 6),
    new THREE.MeshLambertMaterial({ color: hostile ? 0xffd24a : 0xff5a44, flatShading: true })
  );
  nose.geometry.rotateX(-Math.PI / 2);
  nose.position.z = -2.3;
  group.add(nose);

  const finGeo = new THREE.BoxGeometry(0.9, 0.07, 0.8);
  const finMat = new THREE.MeshLambertMaterial({
    color: hostile ? 0x6e3a36 : 0x9aa4b2,
    flatShading: true,
  });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, 1.5);
    fin.rotation.z = angle;
    group.add(fin);
  }

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.5, 6),
    new THREE.MeshBasicMaterial({
      color: hostile ? 0xffd76a : 0xffb04a,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      fog: false,
    })
  );
  flame.geometry.rotateX(Math.PI / 2);
  flame.position.z = 2.6;
  flame.name = 'flame';
  group.add(flame);

  group.traverse((node) => {
    if (node.isMesh) node.castShadow = false;
  });
  return group;
}

/** IR flare decoy: a hot glowing pellet with an additive halo. */
function makeDecoyMesh() {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffe0a8, toneMapped: false, fog: false })
  );
  group.add(core);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xff9a3c,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
  );
  halo.name = 'halo';
  group.add(halo);

  group.traverse((node) => {
    if (node.isMesh) node.castShadow = false;
  });
  return group;
}

/**
 * Cannons, heat management, homing missiles, hostile bandit missiles, IR
 * flares and every projectile collision.
 *
 * The player and the bandits share one simulation so hits are resolved in a
 * single pass. Results come back as events through `consumeEvents()`, which
 * keeps the combat rules (score, hull damage, kill toasts) in the game loop.
 * Inbound missiles can be seduced away by `deployFlares()` decoys.
 */
export class Weapons {
  constructor(scene, quality = {}, explosions = null) {
    this.scene = scene;
    this.quality = quality;
    this.explosions = explosions;
    this.events = [];
    this._activeTargets = [];

    // --- Cannon -----------------------------------------------------------
    this.gunRate = 0.085;
    this.gunDamage = 14;
    this.gunSpeed = 950;
    this.gunSpread = 0.0055;
    this.gunLife = 1.5;
    this.heatPerShot = 0.03;
    this.coolRate = 0.16;
    this.heat = 0;
    this.overheated = false;
    this._gunTimer = 0;
    this._gunSide = 1;

    // --- Missiles ---------------------------------------------------------
    // Unlimited stock: the rail only limits how many birds can be in the air
    // at once and how fast the next one can be released (20 slots for ADMM 8×!).
    this.missilesMax = 20;
    this.missilesLeft = Infinity;
    this.missilesUnlimited = true;
    this.missileSpec = getMissile('aim9x');
    this.missileCooldownTime = this.missileSpec.cooldown;
    this._missileTimer = 0;
    this._trackedMissile = null;
    this._impactPoint = new THREE.Vector3();
    this._impactDir = new THREE.Vector3(0, 0, -1);
    this._impactCamTimer = 0;
    this._impactMissileName = this.missileSpec.code;
    this.smokeCapacity = 360;
    this.smokePuffs = [];
    this._smokeCursor = 0;

    // --- Hostile missiles (bandits → player) ------------------------------
    this.hostileMissilesMax = 4;
    this.hostileMissileDamage = 42;
    this.hostileMissileProximityDamage = 21;

    // --- Countermeasures --------------------------------------------------
    this.flaresMax = 15;
    this.flaresLeft = 15;
    this.flareCooldownTime = 0.7;
    this._flareTimer = 0;
    this.decoyLife = 7;
    this.decoyRange = 1000;
    this.decoys = [];

    this.playerCapacity = 72;
    this.enemyCapacity = 72;
    this.enemyGunSpeed = 520;
    this.enemyGunDamage = 8;

    this._buildPools();
    this.reset();
  }

  _buildPools() {
    const tracerGeo = new THREE.BoxGeometry(0.42, 0.42, 7);

    this.playerBullets = new THREE.InstancedMesh(
      tracerGeo,
      new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false, fog: false }),
      this.playerCapacity
    );
    this.playerBullets.name = 'player-tracers';
    this.playerBullets.frustumCulled = false;
    this.playerBullets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.playerBullets);

    this.enemyBullets = new THREE.InstancedMesh(
      tracerGeo,
      new THREE.MeshBasicMaterial({ color: 0xff5533, toneMapped: false, fog: false }),
      this.enemyCapacity
    );
    this.enemyBullets.name = 'enemy-tracers';
    this.enemyBullets.frustumCulled = false;
    this.enemyBullets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.enemyBullets);

    this.bulletPools = [
      { list: this._makeBullets(this.playerCapacity), mesh: this.playerBullets, hostile: false },
      { list: this._makeBullets(this.enemyCapacity), mesh: this.enemyBullets, hostile: true },
    ];

    this.missiles = [];
    for (let i = 0; i < this.missilesMax; i++) {
      const group = makeMissileMesh();
      group.visible = false;
      this.scene.add(group);
      this.missiles.push({
        active: false,
        hostile: false,
        group,
        flame: group.getObjectByName('flame'),
        position: new THREE.Vector3(),
        direction: new THREE.Vector3(0, 0, -1),
        target: null,
        speed: 350,
        maxSpeed: 760,
        accel: 210,
        turn: 3.4,
        damage: 100,
        pvpDamage: 48,
        blastRadius: 12,
        smokeColor: 0xe6edf2,
        code: 'AIM-9X',
        smokeAcc: 0,
        life: 0,
      });
    }

    // Bandit missiles share the machinery but hunt the player instead.
    this.hostileMissiles = [];
    for (let i = 0; i < this.hostileMissilesMax; i++) {
      const group = makeMissileMesh(true);
      group.visible = false;
      this.scene.add(group);
      this.hostileMissiles.push({
        active: false,
        hostile: true,
        decoyed: false,
        group,
        flame: group.getObjectByName('flame'),
        position: new THREE.Vector3(),
        direction: new THREE.Vector3(0, 0, -1),
        target: null,
        speed: 300,
        maxSpeed: 540,
        accel: 90,
        turn: 2.1,
        damage: 42,
        blastRadius: 14,
        smokeColor: 0xdad5cc,
        code: 'HOSTILE',
        smokeAcc: 0,
        life: 0,
      });
    }
    // One list so a single update pass flies both pools.
    this._missilePools = [this.missiles, this.hostileMissiles];

    // Billowing instanced smoke trail & launch ignition plume pool for missiles.
    const smokeGeo = new THREE.IcosahedronGeometry(1, 0);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, this.smokeCapacity);
    this.smokeMesh.name = 'missile-smoke';
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeMesh.count = 0;
    this.smokeMesh.visible = false;
    this.scene.add(this.smokeMesh);
    for (let i = 0; i < this.smokeCapacity; i++) {
      this.smokePuffs.push({
        active: false,
        age: 0,
        maxAge: 1.35,
        startScale: 0.75,
        endScale: 3.8,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(0xe6edf2),
      });
    }

    // IR flare decoys: hot pellets that seduce an inbound seeker. The pool
    // holds the full stock (15 canisters × 4 pellets) so no salvo is ever
    // swallowed.
    for (let i = 0; i < this.flaresMax * 4; i++) {
      const group = makeDecoyMesh();
      group.visible = false;
      this.scene.add(group);
      this.decoys.push({
        active: false,
        alive: false,
        isDecoy: true,
        radius: 7,
        life: 0,
        group,
        halo: group.getObjectByName('halo'),
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
      });
    }
  }

  _makeBullets(count) {
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        active: false,
        position: new THREE.Vector3(),
        direction: new THREE.Vector3(0, 0, -1),
        speed: 0,
        life: 0,
        damage: 0,
      });
    }
    return list;
  }

  reset() {
    for (const pool of this.bulletPools) {
      for (const b of pool.list) b.active = false;
      pool.mesh.count = 0;
    }
    for (const m of this.missiles) {
      m.active = false;
      m.group.visible = false;
      m.target = null;
    }
    for (const m of this.hostileMissiles) {
      m.active = false;
      m.group.visible = false;
      m.target = null;
      m.decoyed = false;
    }
    for (const d of this.decoys) {
      d.active = false;
      d.alive = false;
      d.group.visible = false;
    }
    for (const p of this.smokePuffs) p.active = false;
    if (this.smokeMesh) {
      this.smokeMesh.count = 0;
      this.smokeMesh.visible = false;
    }
    this._trackedMissile = null;
    this._impactCamTimer = 0;
    this.heat = 0;
    this.overheated = false;
    this._gunTimer = 0;
    this._missileTimer = 0;
    this._flareTimer = 0;
    this.missilesLeft = Infinity;
    this.flaresLeft = this.flaresMax;
    this.events.length = 0;
  }

  /** Equips one of the 8 catalogued missile modes (speed, turn, salvo, blast). */
  setMissileType(id) {
    const spec = getMissile(id);
    this.missileSpec = spec;
    this.missileCooldownTime = spec.cooldown;
    return spec;
  }

  /** Spawns one billowing exhaust / launch-ignition smoke puff from the ring buffer. */
  _spawnSmoke(pos, vel, startScale, endScale, maxAge, colorHex) {
    if (!this.smokePuffs.length) return;
    const puff = this.smokePuffs[this._smokeCursor];
    this._smokeCursor = (this._smokeCursor + 1) % this.smokeCapacity;
    puff.active = true;
    puff.age = 0;
    puff.maxAge = maxAge;
    puff.startScale = startScale;
    puff.endScale = endScale;
    puff.position.copy(pos);
    puff.velocity.copy(vel);
    puff.color.setHex(colorHex);
  }

  /** Returns live telemetry for the right-side Missile Minicam (PIP) overlay. */
  getTrackedMissileView() {
    if (this._trackedMissile && this._trackedMissile.active) {
      const m = this._trackedMissile;
      const target = m.target && m.target.alive ? m.target : null;
      const range = target ? m.position.distanceTo(target.position) : null;
      return {
        active: true,
        impact: false,
        position: m.position,
        direction: m.direction,
        target,
        range,
        missileName: m.code || this.missileSpec.code,
      };
    }
    if (this._impactCamTimer > 0) {
      return {
        active: true,
        impact: true,
        position: this._impactPoint,
        direction: this._impactDir,
        target: null,
        range: 0,
        missileName: this._impactMissileName || this.missileSpec.code,
      };
    }
    return { active: false, impact: false };
  }

  clear() {
    this.reset();
  }

  getStats() {
    return {
      heat: this.heat,
      overheated: this.overheated,
      missiles: this.missilesLeft,
      missilesMax: this.missilesMax,
      missilesUnlimited: this.missilesUnlimited,
      missileId: this.missileSpec?.id ?? 'aim9x',
      missileCode: this.missileSpec?.code ?? 'AIM-9X',
      missileName: this.missileSpec?.name ?? 'AIM-9X SIDEWINDER',
      inFlight: this.missiles.filter((m) => m.active).length,
      flares: this.flaresLeft,
      flaresMax: this.flaresMax,
      inbound: this.hostileMissiles.filter((m) => m.active && !m.decoyed).length,
      tracers: this.bulletPools.reduce(
        (sum, pool) => sum + pool.list.reduce((n, b) => n + (b.active ? 1 : 0), 0),
        0
      ),
    };
  }

  consumeEvents() {
    if (!this.events.length) return [];
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Player cannon. `origin` and `direction` are world-space. */
  firePlayerGun(origin, direction, shooterVelocity) {
    if (this._gunTimer > 0 || this.overheated) return false;
    this._gunTimer = this.gunRate;
    this._gunSide = -this._gunSide;
    this.heat = Math.min(1.1, this.heat + this.heatPerShot);
    if (this.heat >= 1) this.overheated = true;

    _origin.copy(origin);
    _dir.copy(direction);
    if (this.gunSpread > 0) {
      _dir.x += (Math.random() - 0.5) * this.gunSpread * 2;
      _dir.y += (Math.random() - 0.5) * this.gunSpread * 2;
      _dir.z += (Math.random() - 0.5) * this.gunSpread * 2;
      _dir.normalize();
    }
    this._spawnBullet(0, _origin, _dir, this.gunSpeed, this.gunLife, this.gunDamage, shooterVelocity, 0.45);
    return true;
  }

  /** Bandit cannon. Same pool machinery, hostile flag decides what it can hit. */
  fireEnemyGun(origin, direction, shooterVelocity, spread = 0.02) {
    _origin.copy(origin);
    _dir.copy(direction);
    _dir.x += (Math.random() - 0.5) * spread * 2;
    _dir.y += (Math.random() - 0.5) * spread * 2;
    _dir.z += (Math.random() - 0.5) * spread * 2;
    _dir.normalize();
    this._spawnBullet(1, _origin, _dir, this.enemyGunSpeed, 2.2, this.enemyGunDamage, shooterVelocity, 0.3);
  }

  _spawnBullet(poolIndex, origin, direction, speed, life, damage, shooterVelocity, inherit) {
    const pool = this.bulletPools[poolIndex];
    const bullet = pool.list.find((b) => !b.active);
    if (!bullet) return false;
    bullet.active = true;
    bullet.position.copy(origin);
    bullet.direction.copy(direction);
    bullet.speed = speed;
    bullet.life = life;
    bullet.damage = damage;
    if (shooterVelocity) {
      bullet.position.addScaledVector(shooterVelocity, 0.02);
      bullet.direction
        .multiplyScalar(speed)
        .addScaledVector(shooterVelocity, inherit)
        .normalize();
    }
    return true;
  }

  /**
   * Launches one or a multi-missile salvo (per `this.missileSpec`) with an
   * ignition flash + billowing launch smoke cloud at the pylon.
   */
  launchMissile(origin, direction, target = null, allTargets = null) {
    if (this._missileTimer > 0) return false;
    const spec = this.missileSpec ?? getMissile('aim9x');
    const salvo = Math.max(1, spec.salvo || 1);

    const available = [];
    for (const m of this.missiles) {
      if (!m.active) available.push(m);
      if (available.length >= salvo) break;
    }
    if (!available.length) return false;

    this._missileTimer = spec.cooldown ?? this.missileCooldownTime;
    const baseDir = _dir.copy(direction).normalize();
    _sideVec.crossVectors(baseDir, _upAxis);
    if (_sideVec.lengthSq() < 1e-4) _sideVec.set(1, 0, 0);
    else _sideVec.normalize();

    // Build per-missile target assignment for multi-salvo modes (4AAM / HYDRA / X-02).
    const lockPool = [];
    if (target && target.alive) lockPool.push(target);
    if (salvo > 1 && Array.isArray(allTargets)) {
      for (const cand of allTargets) {
        if (!cand || !cand.alive || cand === target) continue;
        _delta.subVectors(cand.position, origin);
        const dist = _delta.length();
        if (dist > (spec.lockRange || 3400)) continue;
        _delta.divideScalar(dist || 1);
        if (baseDir.dot(_delta) > 0.55) lockPool.push(cand);
        if (lockPool.length >= salvo) break;
      }
    }

    let firstLaunched = null;
    for (let i = 0; i < available.length; i++) {
      const missile = available[i];
      const lateral = available.length > 1 ? (i - (available.length - 1) / 2) * 2.2 : 0;
      const spreadYaw = available.length > 1 ? (i - (available.length - 1) / 2) * 0.045 : 0;
      const spreadPitch = available.length > 2 ? ((i % 2) - 0.5) * 0.025 : 0;

      missile.active = true;
      missile.position.copy(origin).addScaledVector(_sideVec, lateral);
      missile.direction
        .copy(baseDir)
        .addScaledVector(_sideVec, spreadYaw)
        .addScaledVector(_upAxis, spreadPitch)
        .normalize();
      missile.target = lockPool.length ? lockPool[i % lockPool.length] : null;
      missile.speed = spec.speed ?? 350;
      missile.maxSpeed = spec.maxSpeed ?? 760;
      missile.accel = spec.accel ?? 210;
      missile.turn = spec.turn ?? 3.4;
      missile.life = spec.life ?? 6.8;
      missile.damage = spec.damage ?? 100;
      missile.pvpDamage = spec.pvpDamage ?? 48;
      missile.blastRadius = spec.blastRadius ?? 12;
      missile.smokeColor = spec.smokeColor ?? 0xe6edf2;
      missile.code = spec.code ?? 'AIM-9X';
      missile.smokeAcc = 0;
      missile.group.visible = true;
      missile.group.position.copy(missile.position);
      _quaternion.setFromUnitVectors(FWD_AXIS, missile.direction);
      missile.group.quaternion.copy(_quaternion);
      if (missile.flame) {
        missile.flame.visible = true;
        missile.flame.material?.color?.setHex(spec.flameColor ?? 0xffb24c);
      }
      if (!firstLaunched) firstLaunched = missile;

      // Launch ignition smoke puff cloud & fiery spark right at the wing pylon!
      const puffCount = available.length > 2 ? 3 : 6;
      for (let p = 0; p < puffCount; p++) {
        _offset.set(
          (Math.random() - 0.5) * 10 - missile.direction.x * (18 + p * 7),
          (Math.random() - 0.5) * 8 - missile.direction.y * (18 + p * 7),
          (Math.random() - 0.5) * 10 - missile.direction.z * (18 + p * 7)
        );
        this._spawnSmoke(
          missile.position,
          _offset,
          1.2 + Math.random() * 0.6,
          4.8 + Math.random() * 2.2,
          0.95 + Math.random() * 0.45,
          p < 2 ? spec.flameColor ?? 0xffc670 : spec.smokeColor ?? 0xe6edf2
        );
      }
    }

    if (firstLaunched) {
      this._trackedMissile = firstLaunched;
      this._impactCamTimer = 0;
      this._impactMissileName = spec.code ?? 'AIM-9X';
    }
    this.explosions?.spark?.(origin, 2.4);
    this.events.push({
      type: 'missile-launch',
      point: origin.clone(),
      missileId: spec.id,
      salvo: available.length,
    });
    return true;
  }

  /**
   * Bandit IR missile at `target` (the player proxy). Shares the flight
   * model with player missiles but only ever hunts the player or a decoy.
   */
  launchHostileMissile(origin, direction, target = null) {
    const missile = this.hostileMissiles.find((m) => !m.active);
    if (!missile) return false;

    missile.active = true;
    missile.decoyed = false;
    missile.position.copy(origin);
    missile.direction.copy(direction).normalize();
    missile.target = target && target.alive ? target : null;
    missile.speed = 300;
    missile.life = 9;
    missile.group.visible = true;
    missile.group.position.copy(missile.position);
    if (missile.flame) missile.flame.visible = true;
    this.events.push({ type: 'hostile-launch', point: origin.clone() });
    return true;
  }

  /**
   * Salvo of four IR decoys around the aircraft. Each active decoy inside
   * `decoyRange` pulls an inbound missile off the player — a seduced missile
   * can never score a hit (`flare-decoyed` event marks the lock-on).
   */
  deployFlares(origin, velocity = null) {
    if (this.flaresLeft <= 0 || this._flareTimer > 0) return false;
    // The pool must hold a whole salvo before the stock is spent.
    if (!this.decoys.some((d) => !d.active)) return false;
    this.flaresLeft -= 1;
    this._flareTimer = this.flareCooldownTime;

    let deployed = 0;
    for (let i = 0; i < 4; i++) {
      const decoy = this.decoys.find((d) => !d.active);
      if (!decoy) break;
      decoy.active = true;
      decoy.alive = true;
      decoy.life = this.decoyLife;
      decoy.position.copy(origin);
      decoy.position.x += (Math.random() - 0.5) * 7;
      decoy.position.y += (Math.random() - 0.5) * 4 - 1.5;
      decoy.position.z += (Math.random() - 0.5) * 7;
      decoy.velocity.set(0, 0, 0);
      if (velocity) decoy.velocity.addScaledVector(velocity, 0.35);
      decoy.velocity.x += (Math.random() - 0.5) * 26;
      decoy.velocity.y -= 8 + Math.random() * 9;
      decoy.velocity.z += (Math.random() - 0.5) * 26;
      decoy.group.visible = true;
      decoy.group.position.copy(decoy.position);
      deployed += 1;
    }
    if (!deployed) return false;
    this.events.push({ type: 'flare-deploy', point: origin.clone(), count: deployed });
    return true;
  }

  /** Distance to the closest missile still chasing `position` (null = safe). */
  getIncoming(position) {
    let best = null;
    for (const m of this.hostileMissiles) {
      if (!m.active || m.decoyed) continue;
      const distance = m.position.distanceTo(position);
      if (best === null || distance < best) best = distance;
    }
    return best;
  }

  /** Nearest live decoy around `position` within the seeker seduce range. */
  _nearestDecoy(position) {
    let best = null;
    let bestDistance = this.decoyRange;
    for (const d of this.decoys) {
      if (!d.active || !d.alive) continue;
      const distance = d.position.distanceTo(position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = d;
      }
    }
    return best;
  }

  /** Nearest target inside the seeker cone — used for the lock and the HUD. */
  pickTarget(targets, origin, forward, maxRange = 2800, maxAngle = 0.88) {
    let best = null;
    let bestScore = Infinity;
    for (const target of targets) {
      if (!target.alive) continue;
      _delta.subVectors(target.position, origin);
      const distance = _delta.length();
      if (distance > maxRange) continue;
      _delta.divideScalar(distance || 1);
      const dot = _delta.dot(forward);
      if (dot < maxAngle) continue;
      const score = distance * (2 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = target;
      }
    }
    return best;
  }

  update(dt, ctx) {
    if (dt > 0) {
      this._gunTimer = Math.max(0, this._gunTimer - dt);
      this._missileTimer = Math.max(0, this._missileTimer - dt);
      this._flareTimer = Math.max(0, this._flareTimer - dt);
      this._impactCamTimer = Math.max(0, this._impactCamTimer - dt);
      this.heat = Math.max(0, this.heat - this.coolRate * dt);
      if (this.overheated && this.heat <= 0.35) this.overheated = false;
    }

    const { world, targets, player, explosions } = ctx;
    const fx = explosions || this.explosions;

    this._updateBullets(dt, world, targets, player, fx);
    this._updateDecoys(dt);
    this._updateMissiles(dt, world, targets, player, fx);
    this._updateSmoke(dt);
    this._writeBulletInstances();
  }

  /** IR decoys arc away, burn bright then wink out — and drop their lock. */
  _updateDecoys(dt) {
    if (dt <= 0) return;
    for (const decoy of this.decoys) {
      if (!decoy.active) continue;
      decoy.life -= dt;
      if (decoy.life <= 0) {
        decoy.active = false;
        decoy.alive = false;
        decoy.group.visible = false;
        continue;
      }
      decoy.velocity.y -= 14 * dt;
      decoy.velocity.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
      decoy.position.addScaledVector(decoy.velocity, dt);
      decoy.group.position.copy(decoy.position);
      if (decoy.halo) {
        const pulse = 0.9 + Math.sin(decoy.life * 14) * 0.18;
        decoy.halo.scale.setScalar(pulse);
        decoy.halo.material.opacity = 0.18 + (decoy.life / this.decoyLife) * 0.2;
      }
    }
  }

  _updateBullets(dt, world, targets, player, fx) {
    if (dt <= 0) return;

    for (let poolIndex = 0; poolIndex < this.bulletPools.length; poolIndex++) {
      const pool = this.bulletPools[poolIndex];
      const hostile = pool.hostile;

      for (const bullet of pool.list) {
        if (!bullet.active) continue;
        bullet.life -= dt;
        bullet.position.addScaledVector(bullet.direction, bullet.speed * dt);

        if (bullet.life <= 0) {
          bullet.active = false;
          continue;
        }

        if (hostile) {
          if (!player || !player.alive) continue;
          _delta.subVectors(bullet.position, player.position);
          if (_delta.lengthSq() <= player.radius * player.radius) {
            bullet.active = false;
            this.events.push({
              type: 'player-hit',
              damage: bullet.damage,
              point: bullet.position.clone(),
            });
            fx?.spark(bullet.position, 1.2);
          }
          continue;
        }

        for (const target of targets) {
          if (!target.alive) continue;
          _delta.subVectors(bullet.position, target.position);
          const radius = target.radius + 1.5;
          if (_delta.lengthSq() > radius * radius) continue;
          bullet.active = false;
          target.health -= bullet.damage;
          const point = bullet.position.clone();
          fx?.spark(point, 1.4);
          if (target.health <= 0) {
            target.alive = false;
            this.events.push({ type: 'kill', target, point, weapon: 'gun' });
          } else {
            this.events.push({
              type: 'hit',
              target,
              damage: bullet.damage,
              point,
              weapon: 'gun',
            });
          }
          break;
        }
      }
    }
  }

  _updateMissiles(dt, world, targets, player, fx) {
    if (dt <= 0) return;
    this._activeTargets = targets;

    for (const pool of this._missilePools) {
      for (const missile of pool) {
        if (!missile.active) continue;
        missile.life -= dt;
        if (missile.hostile) {
          this._updateHostileSeeker(missile, player);
        } else {
          const maxSpd = missile.maxSpeed ?? 760;
          const accel = missile.accel ?? 210;
          missile.speed = Math.min(maxSpd, missile.speed + accel * dt);
        }

        const target = missile.target;
        if (target && target.alive) {
          _delta.subVectors(target.position, missile.position);
          const distance = _delta.length() || 1;
          if (!missile.hostile && target.direction && target.speed) {
            const leadTime = Math.min(distance / Math.max(missile.speed, 300), 1.2);
            _delta.addScaledVector(target.direction, target.speed * leadTime * 0.72);
          }
          _delta.normalize();
          const turnRate = missile.hostile ? 2.1 : missile.turn ?? 3.4;
          const turn = 1 - Math.exp(-turnRate * dt);
          missile.direction.lerp(_delta, turn).normalize();
          const fuseRadius = (target.radius || 7) + (missile.blastRadius ? Math.min(18, missile.blastRadius * 0.65) : 8);
          if (distance < fuseRadius) {
            this._detonate(missile, target, player, fx, true);
            continue;
          }
        }

        missile.position.addScaledVector(missile.direction, missile.speed * dt);

        // Emit continuous billowing exhaust smoke trail behind every flying missile.
        missile.smokeAcc = (missile.smokeAcc || 0) + dt;
        const smokeInterval = missile.hostile ? 0.032 : 0.018;
        if (missile.smokeAcc >= smokeInterval) {
          missile.smokeAcc = 0;
          _origin.copy(missile.position).addScaledVector(missile.direction, -2.7);
          _offset.set(
            (Math.random() - 0.5) * 4.5 - missile.direction.x * 8,
            (Math.random() - 0.5) * 4.5 - missile.direction.y * 8 + 1.2,
            (Math.random() - 0.5) * 4.5 - missile.direction.z * 8
          );
          this._spawnSmoke(
            _origin,
            _offset,
            missile.hostile ? 0.65 : 0.8,
            missile.hostile ? 2.8 : 3.9,
            missile.hostile ? 1.05 : 1.45,
            missile.smokeColor ?? 0xe6edf2
          );
        }

        if (missile.life <= 0) {
          this._detonate(missile, null, player, fx, false);
          continue;
        }

        // Terrain / sea fuse.
        if (world) {
          const ground = world.getHeightAt(missile.position.x, missile.position.z);
          const water = world.getWaveHeightAt
            ? world.getWaveHeightAt(missile.position.x, missile.position.z)
            : 0;
          if (missile.position.y <= Math.max(ground, water)) {
            this._detonate(missile, null, player, fx, false);
            continue;
          }
        }

        // Splash damage against nearby bandits even without a lock. Hostile
        // missiles never hurt the bandits' own side.
        if (!missile.hostile) {
          for (const candidate of targets) {
            if (!candidate.alive || candidate === missile.target) continue;
            _delta.subVectors(candidate.position, missile.position);
            if (_delta.lengthSq() < (candidate.radius + 10) ** 2) {
              candidate.health -= 60;
              if (candidate.health <= 0) {
                candidate.alive = false;
                this.events.push({
                  type: 'kill',
                  target: candidate,
                  point: missile.position.clone(),
                  weapon: 'missile',
                });
              }
              break;
            }
          }
        }

        missile.group.position.copy(missile.position);
        _quaternion.setFromUnitVectors(FWD_AXIS, missile.direction);
        missile.group.quaternion.copy(_quaternion);
        if (missile.flame) {
          const flicker = 0.85 + Math.random() * 0.35;
          missile.flame.scale.set(flicker, flicker, 1 + Math.random() * 0.4);
        }
      }
    }
  }

  /**
   * Seeker logic for bandit missiles: a live decoy inside the countermeasure
   * envelope seduces the missile (`flare-decoyed`); when that decoy burns out
   * the seeker re-acquires the player.
   */
  _updateHostileSeeker(missile, player) {
    if (missile.decoyed) {
      const decoy = missile.decoy;
      if (decoy && decoy.active && decoy.alive) {
        missile.target = decoy;
        return;
      }
      missile.decoyed = false;
      missile.decoy = null;
    }

    const decoy = this._nearestDecoy(missile.position);
    if (decoy) {
      missile.decoyed = true;
      missile.decoy = decoy;
      missile.target = decoy;
      this.events.push({ type: 'flare-decoyed', point: missile.position.clone() });
      return;
    }

    missile.target = player && player.alive ? player : null;
  }

  _detonate(missile, directTarget, player, fx, scored) {
    const hostile = !!missile.hostile;
    const wasDecoyed = !!missile.decoyed;
    const blastRadius = missile.blastRadius ?? 12;
    const dmgBase = missile.damage ?? 100;
    const pvpDmgBase = missile.pvpDamage ?? 48;
    const wasTracked = !hostile && missile === this._trackedMissile;
    missile.active = false;
    missile.group.visible = false;
    missile.target = null;
    missile.decoyed = false;
    missile.decoy = null;
    const point = missile.position.clone();
    if (wasTracked) {
      this._trackedMissile = null;
      this._impactPoint.copy(point);
      this._impactDir.copy(missile.direction);
      this._impactCamTimer = 0.75;
      this._impactMissileName = missile.code || this.missileSpec?.code || 'AIM-9X';
    }
    const burstScale = hostile ? 1.5 : blastRadius >= 36 ? 3.8 : blastRadius >= 20 ? 2.4 : 1.75;
    fx?.burst(point, burstScale, hostile ? 0xffcf7a : blastRadius >= 36 ? 0x7cf5ff : 0xffa64d);
    this.events.push({ type: 'detonate', point, scored: !!scored, hostile });

    // --- Hostile missile ---------------------------------------------------
    if (hostile) {
      // A seduced missile detonates harmlessly away from the aircraft.
      if (wasDecoyed) return;

      if (directTarget && directTarget === player && player && player.alive) {
        this.events.push({
          type: 'player-hit',
          damage: this.hostileMissileDamage,
          point,
        });
        return;
      }

      // Proximity fuse: close but not a direct hit still bites.
      if (player && player.alive) {
        _delta.subVectors(player.position, point);
        if (_delta.lengthSq() < 45 * 45) {
          this.events.push({
            type: 'player-hit',
            damage: this.hostileMissileProximityDamage,
            point,
          });
        }
      }
      return;
    }

    // --- Player missile ----------------------------------------------------
    if (directTarget && directTarget.alive) {
      const dmg = directTarget.isPlayer ? pvpDmgBase : dmgBase;
      directTarget.health -= dmg;
      if (directTarget.health <= 0) {
        directTarget.alive = false;
        this.events.push({
          type: 'kill',
          target: directTarget,
          damage: dmg,
          point,
          weapon: 'missile',
        });
      } else {
        this.events.push({
          type: 'hit',
          target: directTarget,
          damage: dmg,
          point,
          weapon: 'missile',
        });
      }
      // Large shockwave warheads (MPBM / HARM) also splash neighbouring bandits!
      if (blastRadius >= 20) {
        for (const candidate of this._activeTargets || []) {
          if (!candidate.alive || candidate === directTarget) continue;
          _delta.subVectors(candidate.position, point);
          if (_delta.lengthSq() > (candidate.radius + blastRadius) ** 2) continue;
          const splash = candidate.isPlayer ? Math.round(pvpDmgBase * 0.65) : Math.round(dmgBase * 0.7);
          candidate.health -= splash;
          if (candidate.health <= 0) {
            candidate.alive = false;
            this.events.push({ type: 'kill', target: candidate, damage: splash, point, weapon: 'missile' });
          } else {
            this.events.push({ type: 'hit', target: candidate, damage: splash, point, weapon: 'missile' });
          }
        }
      }
      return;
    }

    if (scored) return;

    // Unlocked detonation: splash anything inside blast radius.
    const splashRange = Math.max(30, blastRadius);
    for (const target of this._activeTargets || []) {
      if (!target.alive) continue;
      _delta.subVectors(target.position, point);
      if (_delta.lengthSq() > (target.radius + splashRange) ** 2) continue;
      const splashDmg = target.isPlayer ? Math.round(pvpDmgBase * 0.7) : Math.round(dmgBase * 0.75);
      target.health -= splashDmg;
      if (target.health <= 0) {
        target.alive = false;
        this.events.push({ type: 'kill', target, damage: splashDmg, point, weapon: 'missile' });
      }
    }

    if (player && player.alive) {
      _delta.subVectors(player.position, point);
      if (_delta.lengthSq() < 40 * 40) {
        this.events.push({ type: 'player-hit', damage: 26, point });
      }
    }
  }

  /** Expands and fades missile exhaust smoke puffs in a single instanced pass. */
  _updateSmoke(dt) {
    if (!this.smokeMesh) return;
    let count = 0;
    const stepDt = Math.max(0, dt);
    for (let i = 0; i < this.smokePuffs.length; i++) {
      const p = this.smokePuffs[i];
      if (!p.active) continue;
      p.age += stepDt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      const t = p.age / p.maxAge;
      p.position.addScaledVector(p.velocity, stepDt);
      p.velocity.multiplyScalar(Math.max(0, 1 - 1.8 * stepDt));
      const radius = p.startScale + (p.endScale - p.startScale) * Math.pow(t, 0.72);
      const shrinkEnd = t > 0.7 ? Math.max(0.05, 1 - (t - 0.7) / 0.3) : 1;
      _dummy.position.copy(p.position);
      _dummy.rotation.set(t * 2.1 + i, t * 1.4, 0);
      _dummy.scale.setScalar(radius * shrinkEnd);
      _dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(count, _dummy.matrix);
      _smokeColor.copy(p.color).lerp(_smokeColor.setHex(0xffffff), 0).copy(p.color).multiplyScalar(1 - t * 0.25);
      this.smokeMesh.setColorAt(count, _smokeColor);
      count++;
    }
    this.smokeMesh.count = count;
    this.smokeMesh.visible = count > 0;
    if (count > 0) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
      if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    }
  }

  _writeBulletInstances() {
    for (const pool of this.bulletPools) {
      let count = 0;
      for (const bullet of pool.list) {
        if (!bullet.active) continue;
        _quaternion.setFromUnitVectors(Z_AXIS, bullet.direction);
        _dummy.position.copy(bullet.position);
        _dummy.quaternion.copy(_quaternion);
        _dummy.scale.copy(_scale);
        _dummy.updateMatrix();
        pool.mesh.setMatrixAt(count, _dummy.matrix);
        count++;
      }
      pool.mesh.count = count;
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.mesh.visible = count > 0;
    }
  }

  /** Moves every projectile mesh into a freshly generated world scene. */
  reattach(scene) {
    this.scene = scene;
    scene.add(this.playerBullets);
    scene.add(this.enemyBullets);
    if (this.smokeMesh) scene.add(this.smokeMesh);
    for (const missile of this.missiles) scene.add(missile.group);
    for (const missile of this.hostileMissiles) scene.add(missile.group);
    for (const decoy of this.decoys) scene.add(decoy.group);
  }

  dispose() {
    for (const pool of this.bulletPools) {
      pool.mesh.geometry.dispose();
      pool.mesh.material.dispose();
      this.scene.remove(pool.mesh);
    }
    if (this.smokeMesh) {
      this.smokeMesh.geometry.dispose();
      this.smokeMesh.material.dispose();
      this.scene.remove(this.smokeMesh);
    }
    for (const missile of this.missiles.concat(this.hostileMissiles)) {
      missile.group.traverse((node) => {
        if (node.isMesh) {
          node.geometry.dispose();
          node.material.dispose();
        }
      });
      this.scene.remove(missile.group);
    }
    for (const decoy of this.decoys) {
      decoy.group.traverse((node) => {
        if (node.isMesh) {
          node.geometry.dispose();
          node.material.dispose();
        }
      });
      this.scene.remove(decoy.group);
    }
  }
}
