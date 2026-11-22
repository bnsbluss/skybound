import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, smoothstep } from '../utils/math.js';
import { paintGeometry, transformGeometry } from '../utils/geometry.js';
import { glowTexture } from '../utils/textures.js';

const BODY_COLOR = 0xe9e6db;
const BODY_DARK = 0x25343d;
const ACCENT = 0xff7a3d;
const ACCENT_CYAN = 0x2fe0d0;

function makeMaterials() {
  return {
    body: new THREE.MeshStandardMaterial({
      color: BODY_COLOR,
      roughness: 0.58,
      metalness: 0.18,
      flatShading: true,
    }),
    bodyShadow: new THREE.MeshStandardMaterial({
      color: 0xc9c6bb,
      roughness: 0.63,
      metalness: 0.16,
      flatShading: true,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: BODY_DARK,
      roughness: 0.52,
      metalness: 0.35,
      flatShading: true,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: ACCENT,
      roughness: 0.48,
      metalness: 0.15,
      flatShading: true,
    }),
    cyan: new THREE.MeshStandardMaterial({
      color: ACCENT_CYAN,
      roughness: 0.4,
      metalness: 0.2,
      emissive: 0x0b5c55,
      emissiveIntensity: 0.45,
      flatShading: true,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x5c666d,
      roughness: 0.35,
      metalness: 0.82,
      flatShading: true,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0b2b35,
      roughness: 0.12,
      metalness: 0.7,
      emissive: 0x0a3d45,
      emissiveIntensity: 0.35,
      flatShading: false,
    }),
  };
}

function addTriangleOutward(target, a, b, c, interior) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  const cz = (a.z + b.z + c.z) / 3;
  const dot = nx * (cx - interior.x) + ny * (cy - interior.y) + nz * (cz - interior.z);
  if (dot < 0) {
    target.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
  } else {
    target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
}

function buildFuselageGeometry() {
  const sections = [
    { z: -10.2, rx: 0.04, ry: 0.04, cy: 0.16 },
    { z: -9.4, rx: 0.38, ry: 0.3, cy: 0.12 },
    { z: -8.0, rx: 0.72, ry: 0.52, cy: 0.06 },
    { z: -6.0, rx: 0.94, ry: 0.67, cy: 0.02 },
    { z: -3.5, rx: 1.14, ry: 0.82, cy: 0.0 },
    { z: -1.0, rx: 1.28, ry: 0.9, cy: 0.0 },
    { z: 1.8, rx: 1.26, ry: 0.88, cy: 0.03 },
    { z: 4.2, rx: 1.05, ry: 0.78, cy: 0.06 },
    { z: 6.2, rx: 0.82, ry: 0.66, cy: 0.1 },
    { z: 7.6, rx: 0.64, ry: 0.56, cy: 0.12 },
    { z: 8.3, rx: 0.54, ry: 0.48, cy: 0.1 },
  ];
  const sides = 8;
  const rings = sections.map((sec, si) => {
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 8;
      ring.push({
        x: Math.cos(a) * sec.rx,
        y: Math.sin(a) * sec.ry + sec.cy,
        z: sec.z,
      });
    }
    return ring;
  });

  const pos = [];
  for (let s = 0; s < sections.length - 1; s++) {
    const a = rings[s];
    const b = rings[s + 1];
    for (let i = 0; i < sides; i++) {
      const i2 = (i + 1) % sides;
      const interior = {
        x: 0,
        y: (sections[s].cy + sections[s + 1].cy) * 0.5,
        z: (sections[s].z + sections[s + 1].z) * 0.5,
      };
      addTriangleOutward(pos, a[i], b[i], b[i2], interior);
      addTriangleOutward(pos, a[i], b[i2], a[i2], interior);
    }
  }

  // Nose cone cap.
  const noseTip = { x: 0, y: sections[0].cy, z: sections[0].z - 0.5 };
  const first = rings[0];
  for (let i = 0; i < sides; i++) {
    const i2 = (i + 1) % sides;
    addTriangleOutward(pos, noseTip, first[i], first[i2], { x: 0, y: 0, z: sections[0].z + 0.4 });
  }

  // Tail cap.
  const tailCenter = { x: 0, y: sections[sections.length - 1].cy, z: sections[sections.length - 1].z };
  const last = rings[rings.length - 1];
  for (let i = 0; i < sides; i++) {
    const i2 = (i + 1) % sides;
    addTriangleOutward(pos, tailCenter, last[i2], last[i], { x: 0, y: 0, z: tailCenter.z - 1.0 });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function extrudedPlanform(points, thickness = 0.22, bevel = 0.05) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function buildMissileGeometry() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.115, 0.135, 2.8, 6, 1).toNonIndexed();
  transformGeometry(body, { x: 0, y: 0, z: 0.1 }, { x: Math.PI / 2, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
  parts.push(paintGeometry(body, new THREE.Color(0xe8e2d4)));

  const tip = new THREE.ConeGeometry(0.115, 0.55, 6, 1).toNonIndexed();
  transformGeometry(tip, { x: 0, y: 0, z: -1.58 }, { x: -Math.PI / 2, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
  parts.push(paintGeometry(tip, new THREE.Color(ACCENT)));

  for (let i = 0; i < 4; i++) {
    const fin = new THREE.BoxGeometry(0.36, 0.02, 0.42).toNonIndexed();
    const a = (i / 4) * Math.PI * 2;
    transformGeometry(
      fin,
      { x: Math.cos(a) * 0.19, y: Math.sin(a) * 0.19 + 0.0, z: 0.9 },
      { x: 0, y: 0, z: a },
      { x: 1, y: 1, z: 1 }
    );
    parts.push(paintGeometry(fin, new THREE.Color(0x5a6064)));
  }
  return mergeGeometries(parts, false);
}

export class AircraftModel {
  constructor(quality, variant = null) {
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'f-31-wraith';
    this.materials = makeMaterials();
    this.time = 0;
    this.elevonAngle = 0;
    this.finAngle = 0;
    this.variant = null;

    this._buildFuselage();
    this._buildWings();
    this._buildTail();
    this._buildCanopy();
    this._buildEngineAndIntakes();
    this._buildDetails();
    this._buildLights();
    this._buildShadowMesh();

    this.modelBaseY = 0;

    this.applyVariant(variant);
  }

  /**
   * Recolour / reshape the airframe for a catalogue entry: paint scheme,
   * overall scale and which stores hang off the wings.
   * @param {{id?:string,livery?:object,visual?:object}|null} variant
   */
  applyVariant(variant = null) {
    const v = variant ?? {};
    this.variant = v.id ? v : null;
    const livery = v.livery ?? {};
    const visual = v.visual ?? {};

    this.materials.body.color.set(livery.body ?? BODY_COLOR);
    this.materials.bodyShadow.color.set(livery.body ?? BODY_COLOR).multiplyScalar(0.85);
    this.materials.dark.color.set(livery.dark ?? BODY_DARK);
    this.materials.accent.color.set(livery.accent ?? ACCENT);
    this.materials.cyan.color.set(livery.cyan ?? ACCENT_CYAN);

    this.group.scale.setScalar(visual.scale ?? 1);
    if (this.canard) this.canard.visible = visual.canard !== false;
    if (this.missiles) this.missiles.visible = visual.missiles !== false;
    const id = v.id ?? 'wraith';
    this.group.name = v.id ?? 'f-31-wraith';

    // Swap wing planform geometry and airframe-specific structural packages
    // so each aircraft name has its own distinct 3D silhouette in flight.
    if (this.wing && this.wingGeometries?.[id]) {
      this.wing.geometry = this.wingGeometries[id];
    }
    if (this.tailPlane) {
      this.tailPlane.visible = id !== 'titan';
    }
    if (this.fins?.length === 2) {
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const fin = this.fins[i];
        if (id === 'sparrow') {
          fin.visible = false;
        } else if (id === 'thunder') {
          // A-14 Thunderbolt: upright twin H-tail fins at the horizontal tail tips.
          fin.visible = true;
          fin.position.set(side * 2.85, 0.25, 5.85);
          fin.rotation.z = 0;
        } else if (id === 'ghost') {
          // F-40 Ghost: wide-canted low-observable stealth V-tail.
          fin.visible = true;
          fin.position.set(side * 1.18, 0.46, 5.35);
          fin.rotation.z = -side * 0.52;
        } else if (id === 'titan') {
          // B-2 Titan: compact outward-canted flying-wing rudders.
          fin.visible = true;
          fin.position.set(side * 2.15, 0.42, 4.8);
          fin.rotation.z = -side * 0.36;
        } else if (id === 'wyvern') {
          // X-02S Strike Wyvern: sharply canted low-observable stealth V-tail.
          fin.visible = true;
          fin.position.set(side * 1.28, 0.44, 5.45);
          fin.rotation.z = -side * 0.62;
        } else if (id === 'nosferatu') {
          // CFA-44 Nosferatu: twin outward-canted wide-spaced tails.
          fin.visible = true;
          fin.position.set(side * 1.55, 0.48, 5.35);
          fin.rotation.z = -side * 0.34;
        } else if (id === 'morgan') {
          // ADFX-02 Morgan: tall outward-angled experimental twin fins.
          fin.visible = true;
          fin.position.set(side * 1.32, 0.56, 5.4);
          fin.rotation.z = -side * 0.28;
        } else if (id === 'falken') {
          // ADF-01 FALKEN: signature wide-set outward dorsal stabilizers.
          fin.visible = true;
          fin.position.set(side * 1.65, 0.52, 5.25);
          fin.rotation.z = -side * 0.38;
        } else {
          // F-31 Wraith: standard canted twin air-superiority tails.
          fin.visible = true;
          fin.position.set(side * 1.0, 0.52, 5.2);
          fin.rotation.z = -side * 0.22;
        }
      }
    }
    if (this.variantFeatures) {
      for (const [key, group] of Object.entries(this.variantFeatures)) {
        group.visible = key === id;
      }
    }
    return this;
  }

  _addMesh(geometry, material, parent = this.group) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = this.quality.shadows;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }

  _buildFuselage() {
    const fuselage = this._addMesh(buildFuselageGeometry(), this.materials.body);
    fuselage.name = 'fuselage';

    // Dark dorsal spine with a glowing service line.
    const spine = new THREE.BoxGeometry(0.52, 0.15, 5.2);
    const spineMesh = this._addMesh(spine, this.materials.dark, this.group);
    spineMesh.position.set(0, 0.84, 1.2);
    spineMesh.rotation.x = -0.025;

    const spineAccent = new THREE.BoxGeometry(0.16, 0.03, 4.6);
    const accentMesh = this._addMesh(spineAccent, this.materials.cyan, this.group);
    accentMesh.position.set(0, 0.93, 1.0);

    // Nose pitot.
    const pitot = new THREE.CylinderGeometry(0.025, 0.045, 1.7, 5, 1);
    pitot.rotateX(Math.PI / 2);
    const pitotMesh = this._addMesh(pitot, this.materials.metal, this.group);
    pitotMesh.position.set(0, 0.16, -11.0);

    // Anti-glare panel.
    const glare = new THREE.BoxGeometry(0.9, 0.04, 1.5);
    const glareMesh = this._addMesh(glare, this.materials.dark, this.group);
    glareMesh.position.set(0, 0.82, -5.45);
    glareMesh.rotation.x = -0.05;

    // Side stripes.
    for (const side of [-1, 1]) {
      const stripe = new THREE.BoxGeometry(0.035, 0.16, 3.4);
      const stripeMesh = this._addMesh(stripe, this.materials.accent, this.group);
      stripeMesh.position.set(side * 1.23, 0.22, -1.35);
      stripeMesh.rotation.y = side * 0.035;
    }

    // Belly dark plate helps the silhouette read from below.
    const belly = new THREE.BoxGeometry(1.2, 0.12, 5.2);
    const bellyMesh = this._addMesh(belly, this.materials.bodyShadow, this.group);
    bellyMesh.position.set(0, -0.78, 0.2);
  }

  _buildWings() {
    // Distinct wing planforms for all 5 aircraft so every airframe name has a
    // unique silhouette from every camera angle:
    //  - wraith : swept trapezoid-delta multirole fighter
    //  - sparrow: forward-swept agile light interceptor (X-29 / Su-47 style)
    //  - thunder: straight broad high-lift armored A-10 ground-attack wing
    //  - ghost  : faceted diamond stealth wing with serrated trailing edge
    //  - titan  : wide B-2 flying-wing heavy fortress with W-sawtooth rear edge
    const planforms = {
      wraith: [
        [0, -3.1],
        [7.7, 1.4],
        [7.35, 2.28],
        [1.15, 4.5],
        [-1.15, 4.5],
        [-7.35, 2.28],
        [-7.7, 1.4],
      ],
      sparrow: [
        [0, -1.5],
        [2.2, 0.4],
        [7.35, -1.65],
        [7.55, -0.75],
        [2.1, 3.6],
        [-2.1, 3.6],
        [-7.55, -0.75],
        [-7.35, -1.65],
        [-2.2, 0.4],
      ],
      thunder: [
        [0, -1.6],
        [8.4, -1.15],
        [8.45, 0.75],
        [7.75, 1.55],
        [1.4, 2.1],
        [-1.4, 2.1],
        [-7.75, 1.55],
        [-8.45, 0.75],
        [-8.4, -1.15],
      ],
      ghost: [
        [0, -5.2],
        [7.65, 1.15],
        [5.1, 4.65],
        [2.45, 3.15],
        [0, 4.95],
        [-2.45, 3.15],
        [-5.1, 4.65],
        [-7.65, 1.15],
      ],
      titan: [
        [0, -6.6],
        [9.3, 1.9],
        [8.4, 4.8],
        [5.2, 3.15],
        [2.5, 5.35],
        [0, 3.55],
        [-2.5, 5.35],
        [-5.2, 3.15],
        [-8.4, 4.8],
        [-9.3, 1.9],
      ],
      // ADFX-02 MORGAN: dramatic Belkan forward-swept wings with wide clipped roots
      morgan: [
        [0, -2.4],
        [2.3, 0.2],
        [8.25, -2.15],
        [8.6, -1.05],
        [3.15, 3.85],
        [1.45, 4.6],
        [-1.45, 4.6],
        [-3.15, 3.85],
        [-8.6, -1.05],
        [-8.25, -2.15],
        [-2.3, 0.2],
      ],
      // X-02S STRIKE WYVERN: switchblade forward-swept stealth wings with outer crank
      wyvern: [
        [0, -3.6],
        [3.4, -0.5],
        [8.3, -2.4],
        [8.55, -1.35],
        [4.1, 2.7],
        [1.55, 4.4],
        [-1.55, 4.4],
        [-4.1, 2.7],
        [-8.55, -1.35],
        [-8.3, -2.4],
        [-3.4, -0.5],
      ],
      // CFA-44 NOSFERATU: wide cranked-arrow stealth delta with extended tips
      nosferatu: [
        [0, -4.4],
        [4.2, -0.8],
        [8.95, 2.1],
        [8.45, 3.25],
        [4.35, 3.3],
        [2.0, 4.9],
        [-2.0, 4.9],
        [-4.35, 3.3],
        [-8.45, 3.25],
        [-8.95, 2.1],
        [-4.2, -0.8],
      ],
      // ADF-01 FALKEN: iconic dagger forward-swept wings with deep inner strakes
      falken: [
        [0, -4.1],
        [2.55, -0.35],
        [8.45, -2.85],
        [8.7, -1.55],
        [3.45, 3.4],
        [1.8, 4.85],
        [-1.8, 4.85],
        [-3.45, 3.4],
        [-8.7, -1.55],
        [-8.45, -2.85],
        [-2.55, -0.35],
      ],
    };

    this.wingGeometries = {
      wraith: extrudedPlanform(planforms.wraith, 0.24, 0.055),
      sparrow: extrudedPlanform(planforms.sparrow, 0.21, 0.045),
      thunder: extrudedPlanform(planforms.thunder, 0.32, 0.07),
      ghost: extrudedPlanform(planforms.ghost, 0.2, 0.04),
      titan: extrudedPlanform(planforms.titan, 0.34, 0.075),
      morgan: extrudedPlanform(planforms.morgan, 0.23, 0.05),
      wyvern: extrudedPlanform(planforms.wyvern, 0.2, 0.045),
      nosferatu: extrudedPlanform(planforms.nosferatu, 0.22, 0.05),
      falken: extrudedPlanform(planforms.falken, 0.22, 0.048),
    };
    const wing = this._addMesh(this.wingGeometries.wraith, this.materials.body);
    wing.position.y = 0.12;
    wing.name = 'wing';
    this.wing = wing;

    // Leading-edge accent slivers.
    for (const side of [-1, 1]) {
      const sliver = new THREE.BoxGeometry(3.2, 0.05, 0.12);
      const sliverMesh = this._addMesh(sliver, this.materials.accent, this.group);
      sliverMesh.position.set(side * 4.4, 0.16, -0.15);
      sliverMesh.rotation.y = side * 0.44;
    }

    // Animated elevons.
    this.elevons = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 3.7, 0.11, 3.2);
      const elevon = new THREE.Mesh(
        new THREE.BoxGeometry(3.1, 0.09, 0.72),
        this.materials.bodyShadow
      );
      elevon.position.z = 0.36;
      elevon.castShadow = this.quality.shadows;
      pivot.add(elevon);
      this.group.add(pivot);
      this.elevons.push({ pivot, side });
    }

    // Canards.
    const canardPoints = [
      [0, -0.6],
      [2.6, 0.0],
      [2.4, 0.35],
      [0.4, 1.05],
      [-2.4, 0.35],
      [-2.6, 0.0],
    ];
    const canard = extrudedPlanform(canardPoints, 0.12, 0.035);
    const canardMesh = this._addMesh(canard, this.materials.body);
    canardMesh.position.set(0, 0.35, -5.4);
    this.canard = canardMesh;

    // Wingtip rails and missiles.
    const missileGeo = buildMissileGeometry();
    const missileMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.35,
      flatShading: true,
    });
    const missilePositions = [
      [-6.85, -0.02, 1.2],
      [6.85, -0.02, 1.2],
      [-3.35, -0.42, 1.3],
      [3.35, -0.42, 1.3],
    ];
    const missiles = new THREE.InstancedMesh(missileGeo, missileMat, missilePositions.length);
    missiles.name = 'missiles';
    missiles.castShadow = this.quality.shadows;
    const dummy = new THREE.Object3D();
    missilePositions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      missiles.setMatrixAt(i, dummy.matrix);
    });
    missiles.instanceMatrix.needsUpdate = true;
    this.group.add(missiles);
    this.missiles = missiles;

    for (const side of [-1, 1]) {
      const rail = new THREE.BoxGeometry(0.18, 0.08, 1.6);
      const railMesh = this._addMesh(rail, this.materials.dark, this.group);
      railMesh.position.set(side * 6.85, 0.1, 1.0);
    }
  }

  _buildTail() {
    // Horizontal stabilators.
    const tailPoints = [
      [0, -0.8],
      [3.4, 0.2],
      [3.15, 0.72],
      [0.4, 1.35],
      [-3.15, 0.72],
      [-3.4, 0.2],
    ];
    const tailGeo = extrudedPlanform(tailPoints, 0.16, 0.04);
    const tail = this._addMesh(tailGeo, this.materials.body);
    tail.position.set(0, 0.18, 6.1);
    this.tailPlane = tail;

    this.fins = [];
    const finProfile = [
      [0, 0],
      [0.28, 3.4],
      [1.15, 3.45],
      [2.6, 0],
    ];
    const finShape = new THREE.Shape();
    finShape.moveTo(finProfile[0][0], finProfile[0][1]);
    for (let i = 1; i < finProfile.length; i++) finShape.lineTo(finProfile[i][0], finProfile[i][1]);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 1,
      steps: 1,
    });
    finGeo.rotateY(-Math.PI / 2);
    finGeo.translate(0.08, 0, 0);

    for (const side of [-1, 1]) {
      const finGroup = new THREE.Group();
      finGroup.position.set(side * 1.0, 0.52, 5.2);
      finGroup.rotation.z = -side * 0.22;
      const fin = new THREE.Mesh(finGeo, this.materials.body);
      fin.castShadow = this.quality.shadows;
      finGroup.add(fin);

      const tipCap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.9), this.materials.accent);
      tipCap.position.set(0, 3.12, 0.75);
      tipCap.castShadow = this.quality.shadows;
      finGroup.add(tipCap);

      this.group.add(finGroup);
      this.fins.push(finGroup);
    }
  }

  _buildCanopy() {
    const canopyGeo = new THREE.SphereGeometry(1, 14, 9);
    canopyGeo.scale(0.72, 0.56, 1.85);
    const canopy = this._addMesh(canopyGeo, this.materials.glass);
    canopy.position.set(0, 0.76, -3.75);
    canopy.name = 'canopy';

    const sillGeo = new THREE.BoxGeometry(1.25, 0.08, 2.5);
    const sill = this._addMesh(sillGeo, this.materials.dark);
    sill.position.set(0, 0.67, -3.7);

    // Canopy frame spine.
    const frame = new THREE.BoxGeometry(0.09, 0.07, 3.1);
    const frameMesh = this._addMesh(frame, this.materials.bodyShadow);
    frameMesh.position.set(0, 1.22, -3.8);

    for (const side of [-1, 1]) {
      const rail = new THREE.BoxGeometry(0.1, 0.07, 2.3);
      const railMesh = this._addMesh(rail, this.materials.bodyShadow);
      railMesh.position.set(side * 0.7, 0.94, -3.75);
    }
  }

  _buildEngineAndIntakes() {
    // Twin under-wing intakes.
    for (const side of [-1, 1]) {
      const intakeBody = new THREE.CylinderGeometry(0.42, 0.55, 3.6, 6, 1);
      intakeBody.rotateX(Math.PI / 2);
      const intake = this._addMesh(intakeBody, this.materials.body);
      intake.position.set(side * 1.62, -0.34, 2.55);

      const lip = new THREE.TorusGeometry(0.44, 0.07, 4, 8);
      const lipMesh = this._addMesh(lip, this.materials.dark);
      lipMesh.position.set(side * 1.62, -0.34, 0.76);
      lipMesh.rotation.z = 0.0;

      const opening = new THREE.CircleGeometry(0.38, 8);
      opening.rotateY(Math.PI);
      const openingMesh = this._addMesh(opening, this.materials.glass);
      openingMesh.position.set(side * 1.62, -0.34, 0.75);

      const intakeStripe = new THREE.BoxGeometry(0.08, 0.1, 2.2);
      const stripeMesh = this._addMesh(intakeStripe, this.materials.accent);
      stripeMesh.position.set(side * 2.08, -0.15, 2.6);
    }

    // Primary exhaust bell.
    const exhaust = new THREE.CylinderGeometry(0.5, 0.68, 1.5, 10, 1, true);
    exhaust.rotateX(Math.PI / 2);
    const exhaustMesh = this._addMesh(exhaust, this.materials.metal);
    exhaustMesh.position.set(0, 0.1, 8.3);

    const innerExhaust = new THREE.CircleGeometry(0.44, 12);
    innerExhaust.rotateY(Math.PI);
    const innerMesh = this._addMesh(innerExhaust, this.materials.dark);
    innerMesh.position.set(0, 0.1, 9.06);

    const heatRing = new THREE.TorusGeometry(0.52, 0.035, 4, 12);
    const heatMesh = this._addMesh(heatRing, this.materials.accent);
    heatMesh.position.set(0, 0.1, 9.0);
  }

  _buildDetails() {
    // Dorsal antenna blade.
    const antenna = new THREE.BoxGeometry(0.05, 0.38, 0.7);
    const antennaMesh = this._addMesh(antenna, this.materials.dark);
    antennaMesh.position.set(0, 1.05, 0.1);
    antennaMesh.rotation.x = -0.18;

    // Various vents on the spine.
    for (const z of [2.9, 4.1]) {
      const vent = new THREE.BoxGeometry(0.36, 0.04, 0.32);
      const ventMesh = this._addMesh(vent, this.materials.dark);
      ventMesh.position.set(0, 0.93, z);
    }

    // Refuelling probe.
    const probe = new THREE.CylinderGeometry(0.03, 0.03, 1.0, 5);
    probe.rotateZ(Math.PI / 2);
    const probeMesh = this._addMesh(probe, this.materials.metal);
    probeMesh.position.set(1.25, 0.55, -1.5);
    probeMesh.rotation.y = -0.12;

    // Small triangular wing markings in cyan.
    for (const side of [-1, 1]) {
      const mark = new THREE.ConeGeometry(0.35, 0.75, 3);
      mark.rotateX(Math.PI / 2);
      const markMesh = this._addMesh(mark, this.materials.cyan);
      markMesh.position.set(side * 3.2, 0.16, 2.0);
      markMesh.scale.y = 0.15;
    }

    this._buildVariantFeatures();
  }

  /**
   * Builds unique 3D structural packages for each of the 5 named aircraft so
   * every airframe looks distinct in flight:
   *  - sparrow: single tall central vertical tail fin + forward-swept strakes
   *  - thunder: twin high-mounted dorsal turbofan nacelles + nose rotary cannon + wing pods
   *  - ghost  : faceted stealth chine ridge + flush stealth nozzle shroud
   *  - titan  : blended flying-wing dorsal hump + twin dual-exhaust armored nacelles
   */
  _buildVariantFeatures() {
    this.variantFeatures = {
      wraith: new THREE.Group(),
      sparrow: new THREE.Group(),
      thunder: new THREE.Group(),
      ghost: new THREE.Group(),
      titan: new THREE.Group(),
      morgan: new THREE.Group(),
      wyvern: new THREE.Group(),
      nosferatu: new THREE.Group(),
      falken: new THREE.Group(),
    };
    for (const [id, grp] of Object.entries(this.variantFeatures)) {
      grp.name = `variant-${id}`;
      grp.visible = id === 'wraith';
      this.group.add(grp);
    }

    // --- T-6 SPARROW (Light Interceptor: single tall central tail fin & ventral strakes) ---
    {
      const g = this.variantFeatures.sparrow;
      const finProfile = [
        [0, 0],
        [0.45, 4.1],
        [1.45, 4.15],
        [3.1, 0],
      ];
      const shape = new THREE.Shape();
      shape.moveTo(finProfile[0][0], finProfile[0][1]);
      for (let i = 1; i < finProfile.length; i++) shape.lineTo(finProfile[i][0], finProfile[i][1]);
      shape.closePath();
      const finGeo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.18,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.03,
        bevelSegments: 1,
        steps: 1,
      });
      finGeo.rotateY(-Math.PI / 2);
      finGeo.translate(0.09, 0, 0);
      const centerFin = this._addMesh(finGeo, this.materials.body, g);
      centerFin.position.set(0, 0.65, 4.8);

      const finTip = this._addMesh(new THREE.BoxGeometry(0.22, 0.55, 1.05), this.materials.accent, g);
      finTip.position.set(0, 4.5, 5.75);

      for (const side of [-1, 1]) {
        const pod = this._addMesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6), this.materials.accent, g);
        pod.rotation.x = Math.PI / 2;
        pod.position.set(side * 7.45, 0.14, -1.1);
      }
    }

    // --- A-14 THUNDERBOLT (Ground Attack: twin dorsal turbofan pods + rotary nose cannon) ---
    {
      const g = this.variantFeatures.thunder;
      for (const side of [-1, 1]) {
        // High-mounted A-10 style turbofan engine nacelle.
        const podGeo = new THREE.CylinderGeometry(0.68, 0.62, 3.4, 10);
        podGeo.rotateX(Math.PI / 2);
        const pod = this._addMesh(podGeo, this.materials.body, g);
        pod.position.set(side * 1.75, 1.15, 3.85);

        const cowlGeo = new THREE.TorusGeometry(0.66, 0.08, 5, 12);
        const cowl = this._addMesh(cowlGeo, this.materials.dark, g);
        cowl.position.set(side * 1.75, 1.15, 2.15);

        const fanGeo = new THREE.CircleGeometry(0.6, 10);
        fanGeo.rotateY(Math.PI);
        const fan = this._addMesh(fanGeo, this.materials.metal, g);
        fan.position.set(side * 1.75, 1.15, 2.13);

        const pylon = this._addMesh(new THREE.BoxGeometry(0.95, 0.22, 1.8), this.materials.dark, g);
        pylon.position.set(side * 1.1, 0.85, 3.9);
        pylon.rotation.z = side * 0.45;

        // Underwing heavy rocket / ordinance pods.
        const ordGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.4, 8);
        ordGeo.rotateX(Math.PI / 2);
        const ord = this._addMesh(ordGeo, this.materials.dark, g);
        ord.position.set(side * 5.1, -0.34, 0.2);
      }
      // GAU-8 style heavy nose gatling cannon barrel under the chin.
      const gunGeo = new THREE.CylinderGeometry(0.18, 0.22, 2.3, 8);
      gunGeo.rotateX(Math.PI / 2);
      const gun = this._addMesh(gunGeo, this.materials.metal, g);
      gun.position.set(0, -0.38, -9.8);
    }

    // --- F-40 GHOST (Stealth Fighter: angular chine deck + serrated stealth exhaust shroud) ---
    {
      const g = this.variantFeatures.ghost;
      const deckPoints = [
        [0, -6.8],
        [2.3, -1.2],
        [2.6, 4.8],
        [0, 6.8],
        [-2.6, 4.8],
        [-2.3, -1.2],
      ];
      const deckGeo = extrudedPlanform(deckPoints, 0.34, 0.08);
      const deck = this._addMesh(deckGeo, this.materials.dark, g);
      deck.position.set(0, 0.32, 0.4);

      const shroud = this._addMesh(new THREE.BoxGeometry(1.75, 0.48, 1.9), this.materials.dark, g);
      shroud.position.set(0, 0.14, 8.2);
    }

    // --- B-2 TITAN (Heavy Fighter / Flying Fortress: blended dorsal hump + twin dual-nozzle nacelles) ---
    {
      const g = this.variantFeatures.titan;
      const humpPoints = [
        [0, -5.8],
        [3.4, -0.5],
        [3.1, 4.6],
        [0, 5.8],
        [-3.1, 4.6],
        [-3.4, -0.5],
      ];
      const humpGeo = extrudedPlanform(humpPoints, 0.62, 0.16);
      const hump = this._addMesh(humpGeo, this.materials.bodyShadow, g);
      hump.position.set(0, 0.28, 0.3);

      for (const side of [-1, 1]) {
        const nacelleGeo = new THREE.BoxGeometry(1.15, 0.58, 4.2);
        const nacelle = this._addMesh(nacelleGeo, this.materials.dark, g);
        nacelle.position.set(side * 2.1, 0.48, 2.8);

        const nozzleGeo = new THREE.CylinderGeometry(0.36, 0.46, 1.2, 8);
        nozzleGeo.rotateX(Math.PI / 2);
        const nozzle = this._addMesh(nozzleGeo, this.materials.metal, g);
        nozzle.position.set(side * 2.1, 0.42, 5.1);
      }
    }

    // --- ADFX-02 MORGAN (Belkan Elite: dorsal TLS/ECM tactical pod + crimson solo-wing accent) ---
    {
      const g = this.variantFeatures.morgan;
      // Iconic dorsal Tactical Laser / ECM pod mounted behind the cockpit.
      const dorsalPod = this._addMesh(new THREE.BoxGeometry(0.92, 0.56, 4.6), this.materials.dark, g);
      dorsalPod.position.set(0, 1.15, 0.9);
      const podLens = this._addMesh(new THREE.CylinderGeometry(0.22, 0.28, 1.0, 8), this.materials.accent, g);
      podLens.rotation.x = Math.PI / 2;
      podLens.position.set(0, 1.18, -1.6);
      // Iconic crimson right-wing Solo Wing Pixy accent plate.
      const soloWing = this._addMesh(new THREE.BoxGeometry(4.4, 0.09, 1.8), this.materials.accent, g);
      soloWing.position.set(5.1, 0.25, -0.35);
      soloWing.rotation.y = 0.34;
    }

    // --- X-02S STRIKE WYVERN (Erusean Elite: conformal stealth spine + ventral EML railgun) ---
    {
      const g = this.variantFeatures.wyvern;
      const spineFairing = this._addMesh(new THREE.BoxGeometry(1.3, 0.34, 6.2), this.materials.dark, g);
      spineFairing.position.set(0, 0.72, 1.4);
      // Ventral Arclight Electromagnetic Railgun twin rails + cyan capacitor glow.
      for (const side of [-1, 1]) {
        const rail = this._addMesh(new THREE.BoxGeometry(0.14, 0.22, 5.2), this.materials.metal, g);
        rail.position.set(side * 0.26, -0.92, -1.2);
      }
      const railCore = this._addMesh(new THREE.BoxGeometry(0.22, 0.14, 4.8), this.materials.cyan, g);
      railCore.position.set(0, -0.92, -1.35);
    }

    // --- CFA-44 NOSFERATU (Estovakian Elite: twin dorsal ADMM weapon bay blisters + chine strakes) ---
    {
      const g = this.variantFeatures.nosferatu;
      for (const side of [-1, 1]) {
        // Twin dorsal All-Direction Multi-Purpose Missile (ADMM) internal bay pods.
        const admmBay = this._addMesh(new THREE.BoxGeometry(0.95, 0.44, 4.4), this.materials.dark, g);
        admmBay.position.set(side * 1.22, 0.78, 1.15);
        const admmTrim = this._addMesh(new THREE.BoxGeometry(0.22, 0.08, 3.8), this.materials.accent, g);
        admmTrim.position.set(side * 1.22, 1.02, 1.15);
        // Forward-extending wingtip crank strakes.
        const winglet = this._addMesh(new THREE.BoxGeometry(0.16, 0.68, 1.45), this.materials.accent, g);
        winglet.position.set(side * 8.65, 0.36, 2.55);
        winglet.rotation.z = -side * 0.42;
      }
    }

    // --- ADF-01 FALKEN (Grunder Apex Elite: armored COFFIN canopy shell + split-nose TLS + ventral fins) ---
    {
      const g = this.variantFeatures.falken;
      // Armored COFFIN nose fairing covering the forward fuselage with glowing optical slits.
      const coffinShell = this._addMesh(new THREE.BoxGeometry(1.42, 0.54, 4.4), this.materials.dark, g);
      coffinShell.position.set(0, 0.96, -3.55);
      coffinShell.rotation.x = 0.06;
      const coffinSensor = this._addMesh(new THREE.BoxGeometry(1.18, 0.1, 1.9), this.materials.cyan, g);
      coffinSensor.position.set(0, 1.22, -4.45);
      // Iconic split-nose TLS Tactical Laser emitter pod.
      const tlsEmitter = this._addMesh(new THREE.CylinderGeometry(0.26, 0.34, 2.6, 8), this.materials.accent, g);
      tlsEmitter.rotation.x = Math.PI / 2;
      tlsEmitter.position.set(0, 0.24, -9.85);
      // Signature twin ventral stabilizer fins beneath the engines.
      for (const side of [-1, 1]) {
        const vFin = this._addMesh(new THREE.BoxGeometry(0.16, 1.35, 2.4), this.materials.dark, g);
        vFin.position.set(side * 1.45, -0.78, 5.1);
        vFin.rotation.z = side * 0.42;
      }
    }
  }

  _buildLights() {
    const tex = glowTexture();
    const makeLight = (color, scale) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          color,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      sprite.scale.setScalar(scale);
      return sprite;
    };

    this.navLights = {};
    const left = makeLight(0xff3b3b, 1.0);
    left.position.set(-7.45, 0.2, 1.8);
    const right = makeLight(0x3bff8e, 1.0);
    right.position.set(7.45, 0.2, 1.8);
    const tail = makeLight(0xeaffff, 0.85);
    tail.position.set(0, 0.75, 8.6);
    this.group.add(left, right, tail);
    this.navLights = { left, right, tail };

    // Fuselage formation lights.
    for (const side of [-1, 1]) {
      const dot = makeLight(0x74fff0, 0.5);
      dot.position.set(side * 1.35, 0.35, 4.6);
      this.group.add(dot);
    }
  }

  _buildShadowMesh() {
    // A tiny dark contact shadow under the jet. It is repositioned in world
    // space by Aircraft.updateShadow(); separate from the model transform.
  }

  update(dt, physics, input, time) {
    this.time = time;
    const speedT = clamp((physics.speed - 60) / 220, 0, 1);

    // Control surfaces follow actual pitch/roll rates with a little lag.
    const pitchCmd = clamp((input?.pitch || 0) * 0.45, -0.45, 0.45);
    const rollCmd = clamp((input?.roll || 0) * 0.42, -0.42, 0.42);
    const elevonTarget = -pitchCmd;
    this.elevonAngle = damp(this.elevonAngle, elevonTarget, 12, dt);
    for (const { pivot, side } of this.elevons) {
      const rollDeflection = rollCmd * side;
      pivot.rotation.x = this.elevonAngle + rollDeflection;
    }

    const finTarget = clamp((input?.yaw || 0) * 0.22, -0.22, 0.22);
    this.finAngle = damp(this.finAngle, finTarget, 8, dt);
    for (const fin of this.fins) fin.rotation.y = this.finAngle;

    // Engine vibration / high-speed buffet.
    const buffet = physics.stalling ? 0.018 : 0.003;
    const jitter = Math.sin(time * 53.0) * buffet + Math.sin(time * 31.1) * buffet * 0.5;
    this.group.position.y = this.modelBaseY + jitter * (1 + speedT * 2.0);
    this.group.rotation.z = Math.sin(time * 47.0) * 0.001 * speedT;

    // Navigation light blink cycle.
    const blink = (time % 1.6) < 0.14 || ((time + 0.5) % 1.6) < 0.1;
    if (this.navLights.tail) this.navLights.tail.material.opacity = blink ? 1 : 0.06;
    if (this.navLights.left) this.navLights.left.material.opacity = 0.6 + 0.4 * Math.sin(time * 5.0);
    if (this.navLights.right) this.navLights.right.material.opacity = 0.6 + 0.4 * Math.sin(time * 5.0 + 1.2);

    // Canopy shimmer.
    const glass = this.materials.glass;
    glass.emissiveIntensity = 0.3 + Math.sin(time * 0.9) * 0.06;
  }
}
