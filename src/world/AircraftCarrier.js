import * as THREE from 'three';

/**
 * 3D Nuclear Aircraft Carrier (CVN-07 SKYBOUND) for New Game catapult takeoffs.
 * Faces North (-Z): jet starts aft at z = +58 behind the bow, accelerates down
 * the 170 m steam catapult lane past the starboard island, and lifts off the
 * bow at z = -115.
 */
function makeDeckTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Dark weathered non-skid flight deck asphalt.
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(0, 0, 512, 1024);

    // Subtle tire-scuff & non-skid grain bands.
    ctx.fillStyle = 'rgba(20, 24, 28, 0.25)';
    for (let y = 0; y < 1024; y += 32) {
      ctx.fillRect(0, y, 512, 14);
    }

    // Crisp white & red deck perimeter safety lines.
    ctx.strokeStyle = '#d9e0e6';
    ctx.lineWidth = 10;
    ctx.strokeRect(26, 20, 460, 984);

    // Center dashed yellow CAT-1 steam catapult runway line.
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 8;
    if (ctx.setLineDash) ctx.setLineDash([36, 26]);
    ctx.beginPath();
    ctx.moveTo(212, 920);
    ctx.lineTo(212, 46);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);

    // Flanking white catapult shuttle rails.
    ctx.strokeStyle = 'rgba(220, 232, 240, 0.72)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(126, 910);
    ctx.lineTo(126, 54);
    ctx.moveTo(298, 910);
    ctx.lineTo(298, 54);
    ctx.stroke();

    // Arresting cables across aft landing deck.
    ctx.strokeStyle = '#181c20';
    ctx.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      const y = 780 + i * 36;
      ctx.beginPath();
      ctx.moveTo(52, y);
      ctx.lineTo(372, y);
      ctx.stroke();
    }

    // Large painted hull number "07" at the bow.
    ctx.fillStyle = '#eef3f7';
    ctx.font = '700 108px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('07', 212, 192);

    // Yellow hazard chevrons around jet blast deflector slot.
    ctx.fillStyle = '#e8b339';
    ctx.fillRect(156, 738, 112, 14);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class AircraftCarrier {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'aircraft-carrier';
    this.deckHeight = 18;
    this.deckLength = 246;
    this.deckWidth = 58;
    this.jbd = null;
    this.radarDish = null;
    this._steamPuffs = [];
    this._steamCursor = 0;
    this._steamAcc = 0;
    this._dummy = new THREE.Object3D();
    this._deckTex = null;

    this._build();
  }

  _build() {
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x4b5661, flatShading: true });
    const darkHullMat = new THREE.MeshLambertMaterial({ color: 0x353f48, flatShading: true });
    const waterlineMat = new THREE.MeshLambertMaterial({ color: 0x7a302b, flatShading: true });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a303d, flatShading: true });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0xe6b53c, flatShading: true });
    const lampWarm = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
    const lampRed = new THREE.MeshBasicMaterial({ color: 0xff5a4a, toneMapped: false });

    // Lower crimson waterline hull & armored grey main hull.
    const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(36, 8, 224), waterlineMat);
    lowerHull.position.set(0, 1, 2);
    this.group.add(lowerHull);

    const upperHull = new THREE.Mesh(new THREE.BoxGeometry(44, 13, 232), hullMat);
    upperHull.position.set(0, 10.5, 0);
    this.group.add(upperHull);

    // Flush tapered naval bow prow strictly underneath the flight deck (y <= 15.8)
    // so nothing ever protrudes above the flight deck or sticks out sideways.
    const upperBowShape = new THREE.Shape();
    upperBowShape.moveTo(-22, 0);
    upperBowShape.lineTo(22, 0);
    upperBowShape.lineTo(14, 7.5);
    upperBowShape.lineTo(-14, 7.5);
    upperBowShape.closePath();
    const upperBowGeo = new THREE.ExtrudeGeometry(upperBowShape, {
      depth: 14.2,
      bevelEnabled: false,
    });
    upperBowGeo.rotateX(-Math.PI / 2);
    const upperBow = new THREE.Mesh(upperBowGeo, hullMat);
    upperBow.position.set(0, 1.5, -115.5);
    this.group.add(upperBow);

    const lowerBowShape = new THREE.Shape();
    lowerBowShape.moveTo(-18, 0);
    lowerBowShape.lineTo(18, 0);
    lowerBowShape.lineTo(8, 11.5);
    lowerBowShape.lineTo(-8, 11.5);
    lowerBowShape.closePath();
    const lowerBowGeo = new THREE.ExtrudeGeometry(lowerBowShape, {
      depth: 7.4,
      bevelEnabled: false,
    });
    lowerBowGeo.rotateX(-Math.PI / 2);
    const lowerBow = new THREE.Mesh(lowerBowGeo, waterlineMat);
    lowerBow.position.set(0, -2.8, -109.5);
    this.group.add(lowerBow);

    // Wide textured asphalt flight deck (top surface sits at y = this.deckHeight).
    this._deckTex = makeDeckTexture();
    const deckMat = new THREE.MeshLambertMaterial({ map: this._deckTex, flatShading: false });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(this.deckWidth, 2.2, this.deckLength), deckMat);
    deck.position.set(0, this.deckHeight - 1.1, 0);
    this.group.add(deck);

    // Side catwalks & safety sponsons flanking the flight deck.
    for (const side of [-1, 1]) {
      const sponson = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 200), darkHullMat);
      sponson.position.set(side * (this.deckWidth / 2 + 1.5), this.deckHeight - 2.6, 6);
      this.group.add(sponson);

      // Deck edge landing guidance lights.
      for (let z = -110; z <= 105; z += 22) {
        const bulb = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.7, 0.9),
          z < -80 ? lampRed : lampWarm
        );
        bulb.position.set(side * (this.deckWidth / 2 - 1.2), this.deckHeight + 0.35, z);
        this.group.add(bulb);
      }
    }

    // Hinged Jet Blast Deflector (JBD) directly behind the catapult start spot.
    this.jbd = new THREE.Mesh(new THREE.BoxGeometry(15, 4.8, 1.4), accentMat);
    this.jbd.position.set(-4.5, this.deckHeight + 1.8, 71);
    this.jbd.rotation.x = 0.52;
    this.group.add(this.jbd);

    // Starboard Island Superstructure (Bridge, Air-Boss tower, Radar Mast).
    const islandX = 21.5;
    const islandZ = 14;
    const islandBase = new THREE.Mesh(new THREE.BoxGeometry(11.5, 16, 42), hullMat);
    islandBase.position.set(islandX, this.deckHeight + 8, islandZ);
    this.group.add(islandBase);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(13.2, 6, 26), darkHullMat);
    bridge.position.set(islandX - 0.8, this.deckHeight + 18.5, islandZ - 4);
    this.group.add(bridge);

    const bridgeGlass = new THREE.Mesh(new THREE.BoxGeometry(13.6, 2.2, 22), glassMat);
    bridgeGlass.position.set(islandX - 0.8, this.deckHeight + 19.2, islandZ - 4);
    this.group.add(bridgeGlass);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 18, 6), darkHullMat);
    mast.position.set(islandX, this.deckHeight + 30, islandZ - 2);
    this.group.add(mast);

    this.radarDish = new THREE.Mesh(new THREE.BoxGeometry(9.5, 2.2, 0.9), accentMat);
    this.radarDish.position.set(islandX, this.deckHeight + 36, islandZ - 2);
    this.group.add(this.radarDish);

    const mastBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.95, 8, 6), lampRed);
    mastBeacon.position.set(islandX, this.deckHeight + 39.6, islandZ - 2);
    this.group.add(mastBeacon);

    // Animated steam catapult vapor puffs along the launch track.
    const steamGeo = new THREE.IcosahedronGeometry(1, 0);
    const steamMat = new THREE.MeshBasicMaterial({
      color: 0xeaf4f8,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.steamMesh = new THREE.InstancedMesh(steamGeo, steamMat, 64);
    this.steamMesh.name = 'carrier-catapult-steam';
    this.steamMesh.frustumCulled = false;
    this.steamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.steamMesh.count = 0;
    this.steamMesh.visible = false;
    this.group.add(this.steamMesh);
    for (let i = 0; i < 64; i++) {
      this._steamPuffs.push({
        active: false,
        age: 0,
        maxAge: 1.4,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }

    this.group.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = false;
        n.receiveShadow = false;
      }
    });
  }

  /** Places the carrier cleanly at world `(x, baseY, z)` facing North (-Z). */
  placeAt(x, baseY, z) {
    this.group.position.set(x, baseY, z);
    this.group.visible = true;
  }

  /** World-space jet start position, bow liftoff point, and deck surface height. */
  getLaunchAnchor() {
    const base = this.group.position;
    const deckY = base.y + this.deckHeight;
    return {
      deckY,
      start: new THREE.Vector3(base.x - 4.5, deckY + 2.6, base.z + 56),
      bow: new THREE.Vector3(base.x - 4.5, deckY + 2.6, base.z - 118),
    };
  }

  /** Sets Jet Blast Deflector raised (1 = armed for catapult) or flat (0 = clear). */
  setBlastDeflector(raised) {
    if (!this.jbd) return;
    this.jbd.rotation.x = raised ? 0.52 : 1.54;
    this.jbd.position.y = this.deckHeight + (raised ? 1.8 : 0.3);
  }

  update(dt, steamActive = false, jetLocalZ = 56) {
    if (this.radarDish) {
      this.radarDish.rotation.y += dt * 1.4;
    }

    if (steamActive) {
      this._steamAcc += dt;
      if (this._steamAcc >= 0.045) {
        this._steamAcc = 0;
        const puff = this._steamPuffs[this._steamCursor];
        this._steamCursor = (this._steamCursor + 1) % this._steamPuffs.length;
        puff.active = true;
        puff.age = 0;
        puff.maxAge = 1.1 + Math.random() * 0.5;
        puff.pos.set(
          -4.5 + (Math.random() - 0.5) * 6,
          this.deckHeight + 0.8,
          THREE.MathUtils.clamp(jetLocalZ + (Math.random() - 0.5) * 28, -110, 64)
        );
        puff.vel.set((Math.random() - 0.5) * 7, 3.8 + Math.random() * 2.5, (Math.random() - 0.5) * 5);
      }
    }

    let count = 0;
    for (let i = 0; i < this._steamPuffs.length; i++) {
      const p = this._steamPuffs[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      const t = p.age / p.maxAge;
      p.pos.addScaledVector(p.vel, dt);
      const s = (1.1 + t * 4.4) * (t > 0.7 ? Math.max(0.05, 1 - (t - 0.7) / 0.3) : 1);
      this._dummy.position.copy(p.pos);
      this._dummy.rotation.set(t * 1.5 + i, t, 0);
      this._dummy.scale.setScalar(s);
      this._dummy.updateMatrix();
      this.steamMesh.setMatrixAt(count, this._dummy.matrix);
      count++;
    }
    this.steamMesh.count = count;
    this.steamMesh.visible = count > 0;
    if (count > 0) this.steamMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this._deckTex?.dispose?.();
    this.group.traverse((n) => {
      if (n.isMesh) {
        n.geometry?.dispose?.();
        n.material?.dispose?.();
      }
    });
  }
}
