import * as THREE from 'three';

/**
 * First-person F-16C / Ace Combat style fighter-jet cockpit interior:
 *  - Wide unobstructed bubble canopy framed by a sleek stepped F-16 trapezoid
 *    glare-shield with procedural anti-glare stipple texture & ribbed side coaming.
 *  - Tall curved-top Wide-Angle Optical HUD Combiner Glass (768×768) with sharp
 *    glowing emerald symbology: top compass tape, left SPEED & right ALT tapes,
 *    dynamic pitch ladder, flight-path reticle, and FIRE / MISSILE FLARE! alert.
 *  - Authentic textured F-16 Integrated Control Panel (ICP) directly beneath
 *    the HUD: 6 labeled round metallic-rimmed mode buttons (COM1..A-G), 4×4
 *    labeled tactical keypad, knurled thumbwheels, and DCS switch.
 *  - Unobstructed Left RWR (Radar Warning Receiver) round emerald scope + 5
 *    illuminated threat warning buttons that flash red on inbound missiles.
 *  - Unobstructed Right glowing green DED (Data Entry Display) + Standby ADI
 *    horizon ball & engine/fuel readout directly underneath.
 *  - Sculpted 3D gloved fighter-pilot hands & Nomex forearms positioned clearly
 *    in the lower-left and lower-right foreground gripping the F-16 HOTAS
 *    side-stick and throttle lever, animated smoothly with flight inputs.
 *  - Real-time canopy light reflection rig reacting to sun direction, sky/ground
 *    biome palette, and banking/pitching orientation.
 */
const PANEL_W = 512;
const PANEL_H = 256;
const MFD = 256;
const HUD_GLASS = 768;

// Control stick: max tilt (rad) and how fast it follows the damped input.
const STICK_TILT = 0.32;
const STICK_SMOOTH = 14;

const GREEN = '#5fd29a';
const GREEN_BRIGHT = '#8ae4b8';
const GREEN_DIM = 'rgba(95, 210, 154, 0.4)';
const CYAN = '#6ec8d8';
const AMBER = '#d99e56';
const RED = '#d95348';

const CARDINALS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function makeScreen(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { canvas, ctx, texture };
}

/** Procedural anti-glare matte aircraft cockpit texture with seams & bolts. */
function makeDashGrainTexture() {
  const { canvas, ctx, texture } = makeScreen(256, 256);
  if (ctx) {
    ctx.fillStyle = '#20262e';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle matte pebble grain.
    for (let i = 0; i < 1400; i++) {
      const x = (i * 73) % 256;
      const y = (i * 137 + Math.floor(i / 4) * 19) % 256;
      const bright = i % 3 === 0;
      ctx.fillStyle = bright ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.09)';
      ctx.fillRect(x, y, 2, 2);
    }

    // Crisp panel seams & subtle bevel highlight.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 248, 248);
    ctx.beginPath();
    ctx.moveTo(0, 128);
    ctx.lineTo(256, 128);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(180,210,235,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(6, 6, 244, 244);

    // Recessed aviation fastener rivets.
    const bolts = [
      [16, 16],
      [240, 16],
      [16, 118],
      [240, 118],
      [16, 140],
      [240, 140],
      [16, 240],
      [240, 240],
    ];
    for (const [bx, by] of bolts) {
      ctx.beginPath();
      ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#13181e';
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,215,235,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Procedural Nomex flight-suit / tactical leather micro-weave texture. */
function makeFabricTexture(baseHex, lineHex) {
  const { ctx, texture } = makeScreen(128, 128);
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = lineHex;
    ctx.lineWidth = 1;
    for (let i = -128; i < 256; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + 128, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
    }
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Procedural high-res F-16 Integrated Control Panel (ICP) faceplate texture. */
function makeIcpFaceTexture() {
  const { ctx, texture } = makeScreen(512, 512);
  if (ctx) {
    ctx.fillStyle = '#13181e';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle vertical metal brush bands & dark recessed keypad well.
    ctx.fillStyle = '#1a2028';
    ctx.fillRect(14, 14, 484, 484);
    ctx.strokeStyle = 'rgba(175,205,225,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, 484, 484);

    // Recessed bay under the 6 round buttons.
    ctx.fillStyle = '#0e1318';
    roundRectPath(ctx, 28, 28, 456, 98, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,175,200,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Recessed bay around the 4×4 keypad.
    ctx.fillStyle = '#0d1116';
    roundRectPath(ctx, 96, 142, 320, 290, 8);
    ctx.fill();
    ctx.stroke();

    // Authentic white aviation stencil legends on left & right thumbwheel columns.
    ctx.fillStyle = '#dbe7f2';
    ctx.font = '700 16px monospace';
    ctx.textAlign = 'center';
    const leftLabels = [
      ['SYM', 175],
      ['OFF', 238],
      ['ICP', 284],
      ['BRT', 345],
      ['NORM', 452],
    ];
    for (const [txt, y] of leftLabels) ctx.fillText(txt, 54, y);

    const rightLabels = [
      ['RET', 172],
      ['DEPR', 194],
      ['FLIR', 284],
      ['GAIN', 345],
      ['CONT', 410],
    ];
    for (const [txt, y] of rightLabels) ctx.fillText(txt, 458, y);

    // Bottom DRIFT C/O legend strip.
    ctx.fillStyle = '#a8c0d4';
    ctx.font = '700 15px monospace';
    ctx.fillText('DRIFT C/O   ·   WARN RESET', 256, 474);

    // Small muted green mode dots.
    ctx.fillStyle = '#3d9c70';
    for (const [dx, dy] of [
      [54, 146],
      [458, 146],
      [152, 452],
      [360, 452],
    ]) {
      ctx.beginPath();
      ctx.arc(dx, dy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  texture.needsUpdate = true;
  return texture;
}

/** Crisp textured cap for an individual ICP round mode button or keypad key. */
function makeKeycapTexture(mainText, subText = '', variant = 'silver') {
  const { ctx, texture } = makeScreen(128, 128);
  if (ctx) {
    if (variant === 'round') {
      ctx.fillStyle = '#1b222a';
      ctx.fillRect(0, 0, 128, 128);
      ctx.beginPath();
      ctx.arc(64, 64, 56, 0, Math.PI * 2);
      ctx.fillStyle = '#202832';
      ctx.fill();
      ctx.strokeStyle = '#cfe0ee';
      ctx.lineWidth = 6;
      ctx.stroke();

      ctx.fillStyle = '#f0f7ff';
      ctx.font = '700 30px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(mainText, 64, 74);
    } else {
      const isSilver = variant === 'silver';
      ctx.fillStyle = isSilver ? '#9aa8b6' : '#262f3a';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = isSilver ? '#dce7f2' : '#536475';
      ctx.lineWidth = 6;
      ctx.strokeRect(5, 5, 118, 118);

      // Inner bevel highlight.
      ctx.strokeStyle = isSilver ? 'rgba(20,30,40,0.35)' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(11, 11, 106, 106);

      ctx.textAlign = 'center';
      ctx.fillStyle = isSilver ? '#121820' : '#eaf4ff';
      if (subText) {
        ctx.font = '700 24px monospace';
        ctx.fillText(subText, 64, 48);
        ctx.font = '700 42px monospace';
        ctx.fillText(mainText, 64, 100);
      } else {
        ctx.font = '700 34px monospace';
        ctx.fillText(mainText, 64, 76);
      }
    }
  }
  texture.needsUpdate = true;
  return texture;
}

/** Artificial Horizon (ADI) ball with crisp sky/ground, pitch rungs & bezel. */
function drawADI(ctx, cx, cy, r, pitchDeg = 0, rollDeg = 0) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  const rollRad = (rollDeg * Math.PI) / 180;
  const pitchPx = THREE.MathUtils.clamp(pitchDeg, -45, 45) * (r / 32);

  ctx.translate(cx, cy);
  ctx.rotate(rollRad);

  ctx.fillStyle = '#145a82';
  ctx.fillRect(-r * 2, -r * 2 + pitchPx, r * 4, r * 2);
  ctx.fillStyle = '#4e3522';
  ctx.fillRect(-r * 2, pitchPx, r * 4, r * 2);
  ctx.strokeStyle = '#ecfff6';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-r * 1.4, pitchPx);
  ctx.lineTo(r * 1.4, pitchPx);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(235, 255, 246, 0.9)';
  ctx.lineWidth = 1.6;
  for (let deg = -30; deg <= 30; deg += 10) {
    if (deg === 0) continue;
    const py = pitchPx - deg * (r / 32);
    if (Math.abs(py) > r - 8) continue;
    const w = deg % 20 === 0 ? 22 : 12;
    ctx.beginPath();
    ctx.moveTo(-w, py);
    ctx.lineTo(-5, py);
    ctx.moveTo(5, py);
    ctx.lineTo(w, py);
    ctx.stroke();
  }
  ctx.restore();

  // Fixed yellow-white aircraft reference symbol + crisp white outer compass ring.
  ctx.save();
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(cx - 24, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.lineTo(cx - 4, cy + 7);
  ctx.moveTo(cx + 24, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.lineTo(cx + 4, cy + 7);
  ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.8, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.strokeStyle = i % 3 === 0 ? '#eef7ff' : 'rgba(210, 235, 245, 0.5)';
    ctx.lineWidth = i % 3 === 0 ? 2.2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#9db4c6';
  ctx.stroke();
  ctx.restore();
}

/** Curved-top F-16 wide-angle HUD combiner glass shape. */
function makeHudCombinerGeometry(width = 0.62, height = 0.49, arch = 0.088) {
  const hw = width / 2;
  const hh = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh - arch);
  shape.quadraticCurveTo(0, hh + arch, -hw, hh - arch);
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 28);
  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uvs[i * 2] = (x + hw) / width;
    uvs[i * 2 + 1] = (y + hh) / (height + arch * 0.45);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

export class Cockpit {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'cockpit';
    this.group.visible = false;
    this.visible = false;
    this.time = 0;
    this._drawAcc = 0;
    this.stick = null;
    this.stickTrigger = null;
    this.missileButton = null;
    this._missileBtnMat = null;
    this.flareSwitch = null;
    this.rightHand = null;
    this.rightIndexFinger = null;
    this.rightThumb = null;
    this.leftHand = null;
    this.leftThumb = null;
    this._fireAnim = 0;
    this._missilePressTimer = 0;
    this._missilePressAnim = 0;
    this._flarePressTimer = 0;
    this._flarePressAnim = 0;
    this.throttleLevers = [];
    this._warningLamps = [];
    this._litMaterials = [];
    this._staticTextures = [];
    this._glassTintMat = null;
    this.canopySunLight = null;
    this.canopyFillLight = null;
    this.consoleGlowLight = null;

    // Reusable scratch objects for real-time canopy sun/sky reflection lighting.
    this._localSun = new THREE.Vector3(-0.42, 0.68, 0.6);
    this._invCamQuat = new THREE.Quaternion();
    this._bounceColor = new THREE.Color();
    this._sunTint = new THREE.Color(0xfff1d4);
    this._skyTint = new THREE.Color(0x9edcff);
    this._groundTint = new THREE.Color(0x4a7f70);
    this._specTint = new THREE.Color();
    this._neutralSun = new THREE.Color(0xedf0f2);
    this._neutralSky = new THREE.Color(0xdde4ea);

    const main = makeScreen(PANEL_W, PANEL_H);
    this.canvas = main.canvas;
    this.ctx = main.ctx;
    this.texture = main.texture;

    const sys = makeScreen(MFD, MFD);
    this.sysCanvas = sys.canvas;
    this.sysCtx = sys.ctx;
    this.sysTexture = sys.texture;

    const tac = makeScreen(MFD, MFD);
    this.tacCanvas = tac.canvas;
    this.tacCtx = tac.ctx;
    this.tacTexture = tac.texture;

    const hudGlass = makeScreen(HUD_GLASS, HUD_GLASS);
    this.hudCanvas = hudGlass.canvas;
    this.hudCtx = hudGlass.ctx;
    this.hudTexture = hudGlass.texture;

    this._build();
    this._draw(null);
  }

  _trackTex(tex) {
    this._staticTextures.push(tex);
    return tex;
  }

  _mat(color, extra = {}) {
    const {
      bounceScale = 1,
      specular = 0x5c7288,
      shininess = 46,
      flatShading = false,
      matte = false,
      ...rest
    } = extra;
    const mat = new THREE.MeshPhongMaterial({
      color,
      specular,
      shininess,
      emissive: new THREE.Color(0x0c141c),
      emissiveIntensity: 0.05 * bounceScale,
      flatShading,
      ...rest,
    });
    this._litMaterials.push({
      mat,
      baseSpecular: new THREE.Color(specular),
      bounceScale,
      matte,
    });
    return mat;
  }

  _screenMat(texture, extra = {}) {
    return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, fog: false, ...extra });
  }

  _lamp(color) {
    return new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false });
  }

  /** Shared matte fighter-pilot Nomex flight-glove & suit materials (zero chrome glare). */
  _makePilotGloveMaterials(nomexTex, suitTex) {
    return {
      nomex: this._mat(0x4d5746, {
        map: nomexTex,
        shininess: 6,
        specular: 0x1a1e18,
        bounceScale: 0.65,
        matte: true,
      }),
      leather: this._mat(0x2b2d2f, {
        shininess: 10,
        specular: 0x1f2123,
        bounceScale: 0.55,
        matte: true,
      }),
      knuckle: this._mat(0x3b4237, {
        map: nomexTex,
        shininess: 11,
        specular: 0x222620,
        bounceScale: 0.6,
        matte: true,
      }),
      suit: this._mat(0x434d3d, {
        map: suitTex,
        shininess: 5,
        specular: 0x161a14,
        bounceScale: 0.65,
        matte: true,
      }),
      cuff: this._mat(0x232629, {
        shininess: 7,
        specular: 0x1b1e20,
        bounceScale: 0.55,
        matte: true,
      }),
      watchCase: this._mat(0x3e454b, {
        shininess: 22,
        specular: 0x495259,
        bounceScale: 0.7,
        matte: true,
      }),
    };
  }

  /**
   * Anatomical matte gloved Right Hand gripping the vertical F-16 HOTAS stick,
   * with articulated index finger (squeezes cannon trigger) and articulated
   * thumb (presses red top missile pickle button).
   */
  _buildRightStickHand(m) {
    const hand = new THREE.Group();
    hand.name = 'pilot-right-hand';

    // Contoured back-of-hand (metacarpal) + padded leather palm wrap.
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.056, 14, 12), m.nomex);
    back.scale.set(0.84, 1.08, 0.94);
    back.position.set(0.024, -0.002, 0.022);
    hand.add(back);

    const palmPad = new THREE.Mesh(new THREE.SphereGeometry(0.044, 12, 10), m.leather);
    palmPad.scale.set(0.76, 1.02, 0.85);
    palmPad.position.set(0.008, -0.012, 0.016);
    hand.add(palmPad);

    // Padded thumb muscle (thenar) cradling the back-left of the stick grip.
    const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), m.nomex);
    thenar.scale.set(0.9, 1.15, 0.9);
    thenar.position.set(-0.014, 0.008, 0.03);
    hand.add(thenar);

    // Stitched matte leather knuckle pad across the outer knuckle ridge.
    const knucklePatch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.095, 0.036), m.knuckle);
    knucklePatch.position.set(0.048, 0.004, 0.008);
    knucklePatch.rotation.z = -0.08;
    hand.add(knucklePatch);

    // Articulated Index Finger (pivoted at index knuckle -> squeezes red cannon trigger).
    const idxPivot = new THREE.Group();
    idxPivot.name = 'pilot-right-index';
    idxPivot.position.set(0.034, 0.036, 0.002);
    hand.add(idxPivot);

    const idxKnuckle = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), m.knuckle);
    idxPivot.add(idxKnuckle);

    const idxProx = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.046, 8), m.nomex);
    idxProx.rotation.x = Math.PI / 2;
    idxProx.rotation.z = 0.24;
    idxProx.position.set(-0.007, -0.002, -0.023);
    idxPivot.add(idxProx);

    const idxMid = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), m.leather);
    idxMid.position.set(-0.015, -0.004, -0.045);
    idxPivot.add(idxMid);

    const idxDist = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0105, 0.032, 8), m.leather);
    idxDist.rotation.z = Math.PI / 2 + 0.14;
    idxDist.position.set(-0.029, -0.005, -0.046);
    idxPivot.add(idxDist);

    const idxTip = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 8, 6), m.leather);
    idxTip.position.set(-0.044, -0.006, -0.044);
    idxPivot.add(idxTip);
    this.rightIndexFinger = idxPivot;

    // Lower 3 curled fingers (middle, ring, pinky) gripping the stick shaft.
    for (let i = 0; i < 3; i++) {
      const fy = 0.01 - i * 0.024;
      const scale = 1 - i * 0.07;
      const kJoint = new THREE.Mesh(new THREE.SphereGeometry(0.0125 * scale, 8, 8), m.knuckle);
      kJoint.position.set(0.036, fy, 0.004);
      hand.add(kJoint);

      const seg1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0105 * scale, 0.0115 * scale, 0.044 * scale, 8),
        m.nomex
      );
      seg1.rotation.x = Math.PI / 2;
      seg1.rotation.z = 0.34;
      seg1.position.set(0.022, fy, -0.018);
      hand.add(seg1);

      const midJoint = new THREE.Mesh(new THREE.SphereGeometry(0.0105 * scale, 8, 6), m.leather);
      midJoint.position.set(0.006, fy, -0.036);
      hand.add(midJoint);

      const seg2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.009 * scale, 0.01 * scale, 0.03 * scale, 8),
        m.leather
      );
      seg2.rotation.z = Math.PI / 2;
      seg2.position.set(-0.009, fy, -0.037);
      hand.add(seg2);
    }

    // Articulated Right Thumb pivoted over the top red missile pickle button.
    const thumbPivot = new THREE.Group();
    thumbPivot.name = 'pilot-right-thumb';
    thumbPivot.position.set(-0.022, 0.044, 0.024);
    hand.add(thumbPivot);

    const tBase = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), m.nomex);
    thumbPivot.add(tBase);

    const tSeg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.044, 8), m.nomex);
    tSeg1.rotation.x = -0.92;
    tSeg1.rotation.z = -0.32;
    tSeg1.position.set(0.007, 0.016, -0.016);
    thumbPivot.add(tSeg1);

    const tPad = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 8, 8), m.leather);
    tPad.scale.set(1.05, 0.85, 1.15);
    tPad.position.set(0.014, 0.026, -0.033);
    thumbPivot.add(tPad);
    this.rightThumb = thumbPivot;

    // Matte Velcro wrist cuff + Olive Nomex flight-suit forearm (safely behind camera.near).
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 0.068, 12), m.cuff);
    wrist.rotation.x = Math.PI / 2 - 0.18;
    wrist.rotation.z = 0.18;
    wrist.position.set(0.036, -0.02, 0.088);
    hand.add(wrist);

    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.02, 12), m.leather);
    strap.rotation.x = Math.PI / 2 - 0.18;
    strap.rotation.z = 0.18;
    strap.position.set(0.034, -0.016, 0.072);
    hand.add(strap);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.06, 0.26, 12), m.suit);
    forearm.rotation.x = Math.PI / 2 - 0.45;
    forearm.rotation.z = 0.44;
    forearm.position.set(0.095, -0.075, 0.155);
    hand.add(forearm);

    return hand;
  }

  /**
   * Anatomical matte gloved Left Hand resting horizontally palm-down over the
   * F-16 throttle grip, with articulated fingers and thumb over the flare switch.
   */
  _buildLeftThrottleHand(m) {
    const hand = new THREE.Group();
    hand.name = 'pilot-left-hand';

    // Horizontal palm-down back-of-hand resting over the throttle bar.
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.056, 14, 12), m.nomex);
    back.scale.set(1.08, 0.54, 1.0);
    back.position.set(0.0, 0.028, 0.015);
    hand.add(back);

    const palmUnder = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), m.leather);
    palmUnder.scale.set(1.04, 0.42, 0.92);
    palmUnder.position.set(0.0, 0.014, 0.01);
    hand.add(palmUnder);

    // Matte leather knuckle armor across the front knuckle ridge.
    const knuckleBar = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.02, 0.026), m.knuckle);
    knuckleBar.position.set(0.0, 0.036, -0.024);
    hand.add(knuckleBar);

    // 4 sculpted multi-segment fingers curving neatly over the front edge of the throttle.
    for (let i = 0; i < 4; i++) {
      const fx = -0.034 + i * 0.023;
      const scale = i === 0 ? 0.88 : i === 3 ? 0.96 : 1.0;

      const kJoint = new THREE.Mesh(new THREE.SphereGeometry(0.012 * scale, 8, 8), m.knuckle);
      kJoint.position.set(fx, 0.032, -0.03);
      hand.add(kJoint);

      const seg1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0105 * scale, 0.0115 * scale, 0.034 * scale, 8),
        m.nomex
      );
      seg1.rotation.x = 0.65;
      seg1.position.set(fx, 0.02, -0.044);
      hand.add(seg1);

      const seg2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0095 * scale, 0.0105 * scale, 0.028 * scale, 8),
        m.leather
      );
      seg2.rotation.x = -0.18;
      seg2.position.set(fx, -0.004, -0.048);
      hand.add(seg2);

      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0095 * scale, 8, 6), m.leather);
      tip.position.set(fx, -0.017, -0.044);
      hand.add(tip);
    }

    // Articulated Left Thumb on the inner side resting over the throttle flare button.
    const thumbPivot = new THREE.Group();
    thumbPivot.name = 'pilot-left-thumb';
    thumbPivot.position.set(0.048, 0.018, 0.012);
    hand.add(thumbPivot);

    const tBase = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), m.nomex);
    thumbPivot.add(tBase);

    const tSeg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.04, 8), m.nomex);
    tSeg.rotation.x = Math.PI / 2 + 0.18;
    tSeg.rotation.z = -0.22;
    tSeg.position.set(0.006, -0.004, -0.02);
    thumbPivot.add(tSeg);

    const tPad = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 8, 8), m.leather);
    tPad.position.set(0.009, -0.008, -0.039);
    thumbPivot.add(tPad);
    this.leftThumb = thumbPivot;

    // Matte wrist cuff, tactical low-glare pilot watch & Nomex sleeve.
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.046, 0.068, 12), m.cuff);
    wrist.rotation.x = Math.PI / 2 - 0.15;
    wrist.rotation.z = -0.15;
    wrist.position.set(-0.026, 0.012, 0.088);
    hand.add(wrist);

    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 12), m.leather);
    strap.rotation.x = Math.PI / 2 - 0.15;
    strap.rotation.z = -0.15;
    strap.position.set(-0.024, 0.015, 0.072);
    hand.add(strap);

    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.01, 14), m.watchCase);
    bezel.position.set(-0.022, 0.052, 0.076);
    hand.add(bezel);

    const watchFace = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.012, 12),
      this._lamp(0x1c3a30)
    );
    watchFace.position.set(-0.022, 0.053, 0.076);
    hand.add(watchFace);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.06, 0.26, 12), m.suit);
    forearm.rotation.x = Math.PI / 2 - 0.44;
    forearm.rotation.z = -0.44;
    forearm.position.set(-0.088, -0.052, 0.155);
    hand.add(forearm);

    return hand;
  }

  _build() {
    const dashTex = this._trackTex(makeDashGrainTexture());
    const icpTex = this._trackTex(makeIcpFaceTexture());
    const gloveTex = this._trackTex(makeFabricTexture('#525d4a', 'rgba(22,26,20,0.32)'));
    const suitTex = this._trackTex(makeFabricTexture('#45503f', 'rgba(20,24,18,0.32)'));
    const pilotMats = this._makePilotGloveMaterials(gloveTex, suitTex);

    // Balanced dark-graphite cockpit materials with controlled natural sheen
    // (no blown-out specular glare or over-saturated chroma).
    const coaming = this._mat(0x272d34, {
      map: dashTex,
      shininess: 24,
      specular: 0x566472,
      bounceScale: 0.85,
    });
    const bulkhead = this._mat(0x1b2026, {
      map: dashTex,
      shininess: 18,
      specular: 0x424d58,
      bounceScale: 0.8,
    });
    const darkMetal = this._mat(0x21272e, { shininess: 42, specular: 0x677584 });
    const gunmetal = this._mat(0x353e47, { shininess: 54, specular: 0x8494a4 });
    const alloy = this._mat(0x4f5a65, { shininess: 68, specular: 0xa2b2c2 });
    const rubber = this._mat(0x171b20, { shininess: 14, specular: 0x38414a, bounceScale: 0.7 });
    const keyRim = this._mat(0xadb8c2, { shininess: 48, specular: 0xbecad4, bounceScale: 0.95 });
    const icpFaceMat = this._mat(0xffffff, {
      map: icpTex,
      shininess: 14,
      specular: 0x333c44,
      bounceScale: 0.85,
    });

    // --- Dynamic Canopy-Entry & Instrument Bounce Lights --------------------
    // Natural neutral-daylight canopy illumination with gentle green console fill
    // (no blinding neon hotspot over the ICP buttons).
    this.canopySunLight = new THREE.PointLight(0xf6f0e4, 1.45, 6.5, 1.45);
    this.canopySunLight.name = 'cockpit-canopy-sun';
    this.canopySunLight.position.set(-0.55, 1.05, 0.45);
    this.group.add(this.canopySunLight);

    this.canopyFillLight = new THREE.PointLight(0xc2dce8, 0.68, 5.6, 1.5);
    this.canopyFillLight.name = 'cockpit-canopy-sky-bounce';
    this.canopyFillLight.position.set(0.2, 0.55, 0.55);
    this.group.add(this.canopyFillLight);

    this.consoleGlowLight = new THREE.PointLight(0x64a886, 0.055, 2.2, 1.7);
    this.consoleGlowLight.name = 'cockpit-instrument-bounce';
    this.consoleGlowLight.position.set(0, -0.26, -0.52);
    this.group.add(this.consoleGlowLight);

    // --- F-16 Wide-Angle Curved-Top Optical HUD Combiner Glass --------------
    // Low flush projector base tucked strictly beneath the combiner glass so
    // nothing ever sticks up or blocks the HUD projection.
    const projectorBase = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.024, 0.14), darkMetal);
    projectorBase.position.set(0, -0.158, -1.015);
    this.group.add(projectorBase);

    const lensRing = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.098, 0.016, 18), gunmetal);
    lensRing.position.set(0, -0.144, -1.025);
    this.group.add(lensRing);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.072, 0.072, 0.018, 18),
      this._lamp(0x10382b)
    );
    lens.position.set(0, -0.142, -1.025);
    this.group.add(lens);

    // Tall sleek tapered HUD combiner side stanchions + subtle dark-emerald edge.
    for (const side of [-1, 1]) {
      const stanchion = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.49, 0.085), darkMetal);
      stanchion.position.set(side * 0.312, 0.1, -1.03);
      stanchion.rotation.z = side * 0.032;
      stanchion.rotation.x = -0.05;
      this.group.add(stanchion);

      const bevelEdge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.47, 0.022), gunmetal);
      bevelEdge.position.set(side * 0.296, 0.1, -0.995);
      bevelEdge.rotation.z = side * 0.032;
      bevelEdge.rotation.x = -0.05;
      this.group.add(bevelEdge);

      // Subtle dark-emerald optical glass thickness strip (low chroma, not neon).
      const edgeGlow = new THREE.Mesh(
        new THREE.BoxGeometry(0.004, 0.44, 0.006),
        this._lamp(0x287858)
      );
      edgeGlow.position.set(side * 0.289, 0.105, -1.01);
      edgeGlow.rotation.z = side * 0.032;
      edgeGlow.rotation.x = -0.05;
      this.group.add(edgeGlow);

      // Two machined fastener bolts per stanchion.
      for (const by of [-0.08, 0.26]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 8), alloy);
        bolt.rotation.x = Math.PI / 2;
        bolt.position.set(side * 0.315, by, -0.985);
        this.group.add(bolt);
      }

      // Slim sculpted twin AoA / Indexer horns with muted tactical LEDs.
      const horn = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.13, 0.032), rubber);
      horn.position.set(side * 0.395, -0.1, -1.02);
      this.group.add(horn);

      const hornCap = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.018, 0.036), gunmetal);
      hornCap.position.set(side * 0.395, -0.034, -1.02);
      this.group.add(hornCap);

      const aoaColors = [0x2f7d58, 0x8f6b36, 0x853530];
      for (let k = 0; k < 3; k++) {
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.011, 0.013, 0.006),
          this._lamp(aoaColors[k])
        );
        led.position.set(side * 0.395, -0.062 - k * 0.026, -1.003);
        this.group.add(led);
      }
    }

    // Razor-thin curved arch rim across the top of the HUD combiner glass.
    const archCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.305, 0.34, -1.045),
      new THREE.Vector3(0, 0.445, -1.055),
      new THREE.Vector3(0.305, 0.34, -1.045)
    );
    const topArch = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 28, 0.0085, 8, false), rubber);
    this.group.add(topArch);

    // Optical combiner glass plane with razor-sharp collimated green HUD.
    this.hudGlass = new THREE.Mesh(
      makeHudCombinerGeometry(0.59, 0.48, 0.088),
      this._screenMat(this.hudTexture, {
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.hudGlass.name = 'cockpit-hud-glass';
    this.hudGlass.position.set(0, 0.115, -1.025);
    this.hudGlass.rotation.x = -0.05;
    this.group.add(this.hudGlass);

    // Crystal-clear dark-emerald anti-reflective coating (subtle, never milky!).
    this._glassTintMat = new THREE.MeshBasicMaterial({
      color: 0x05281e,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      fog: false,
    });
    const glassTint = new THREE.Mesh(
      makeHudCombinerGeometry(0.585, 0.475, 0.086),
      this._glassTintMat
    );
    glassTint.position.set(0, 0.115, -1.03);
    glassTint.rotation.x = -0.05;
    this.group.add(glassTint);

    // --- Authentic F-16 Trapezoid Glare-Shield & Unobstructed Instrument Bay -
    // Center brow directly beneath HUD; flat horizontal shelves directly over
    // left RWR and right DED; steep 46° outer wings dropping cleanly into the
    // lower corners so the side sky stays 100% open & unobstructed!
    const centerBrow = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.036, 0.32), coaming);
    centerBrow.position.set(0, -0.175, -0.99);
    centerBrow.rotation.x = 0.08;
    this.group.add(centerBrow);

    const centerLip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.016, 0.035), gunmetal);
    centerLip.position.set(0, -0.175, -0.845);
    this.group.add(centerLip);

    // Main dark recessed instrument bulkhead behind ICP, RWR, DED & Standby.
    const mainBulkhead = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.48, 0.16), bulkhead);
    mainBulkhead.position.set(0, -0.43, -1.01);
    this.group.add(mainBulkhead);

    // Lower cockpit tub & console skirts tucked strictly below the dashboard.
    const lowerTub = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.24, 0.72), rubber);
    lowerTub.position.set(0, -0.68, -0.76);
    this.group.add(lowerTub);

    for (const side of [-1, 1]) {
      // Horizontal glare-shield shelf cleanly ABOVE the RWR (left) & DED (right).
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.034, 0.3), coaming);
      shelf.position.set(side * 0.44, -0.205, -0.99);
      shelf.rotation.z = -side * 0.05;
      shelf.rotation.x = 0.08;
      this.group.add(shelf);

      const shelfLip = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.014, 0.028), gunmetal);
      shelfLip.position.set(side * 0.44, -0.205, -0.855);
      shelfLip.rotation.z = -side * 0.05;
      this.group.add(shelfLip);

      // Sleek 46° outer sloped wing dropping down toward bottom screen corners.
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.045, 0.34), coaming);
      wing.position.set(side * 0.79, -0.4, -0.95);
      wing.rotation.z = -side * 0.8;
      wing.rotation.x = 0.1;
      this.group.add(wing);

      const wingEdge = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.016, 0.032), gunmetal);
      wingEdge.position.set(side * 0.785, -0.4, -0.8);
      wingEdge.rotation.z = -side * 0.8;
      this.group.add(wingEdge);

      // Segmented dark louver/bolster pads along outer sloped edge (F-16 detail).
      for (let r = 0; r < 6; r++) {
        const t = r / 5;
        const rx = side * (0.64 + t * 0.3);
        const ry = -0.26 - t * 0.31;
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 0.09), darkMetal);
        rib.position.set(rx, ry, -0.84);
        rib.rotation.z = -side * 0.8;
        this.group.add(rib);
      }

      // Low outer side console deck kept cleanly outside the instrument bays.
      const sideConsole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.56), bulkhead);
      sideConsole.position.set(side * 0.76, -0.65, -0.68);
      sideConsole.rotation.z = -side * 0.12;
      this.group.add(sideConsole);
    }

    // --- Center F-16 Integrated Control Panel (ICP) with Textured Labels ----
    const icpBody = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.38, 0.09), darkMetal);
    icpBody.position.set(0, -0.38, -0.945);
    icpBody.rotation.x = -0.06;
    this.group.add(icpBody);

    const icpFace = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.355), icpFaceMat);
    icpFace.position.set(0, -0.38, -0.896);
    icpFace.rotation.x = -0.06;
    this.group.add(icpFace);

    // Top row: 6 round metallic-rimmed mode buttons with crisp matte labels.
    const modeLabels = ['COM1', 'COM2', 'IFF', 'LIST', 'A-A', 'A-G'];
    for (let i = 0; i < 6; i++) {
      const bx = -0.175 + i * 0.07;
      const by = -0.245;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.025, 0.016, 16), keyRim);
      rim.rotation.x = Math.PI / 2 - 0.06;
      rim.position.set(bx, by, -0.888);
      this.group.add(rim);

      const capTex = this._trackTex(makeKeycapTexture(modeLabels[i], '', 'round'));
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(0.02, 16),
        this._mat(0xffffff, { map: capTex, shininess: 14, specular: 0x303840, bounceScale: 0.9 })
      );
      cap.position.set(bx, by, -0.879);
      cap.rotation.x = -0.06;
      this.group.add(cap);
    }

    // Central 4×3 textured F-16 ICP keypad (matte aviation plastic, zero glare).
    const keyGrid = [
      ['1', 'T-ILS', 'silver'],
      ['2', 'ALOW', 'silver'],
      ['3', '', 'silver'],
      ['RCL', '', 'silver'],
      ['4', 'STPT', 'silver'],
      ['5', 'CRUS', 'silver'],
      ['6', 'TIME', 'silver'],
      ['ENTR', '', 'dark'],
      ['7', 'MARK', 'dark'],
      ['8', 'FIX', 'dark'],
      ['9', 'A-CAL', 'dark'],
      ['0', 'M-SEL', 'dark'],
    ];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const [mainTxt, subTxt, style] = keyGrid[row * 4 + col];
        const isAction = col === 3;
        const kw = isAction ? 0.048 : 0.042;
        const kh = 0.044;
        const kx = -0.108 + col * 0.068;
        const ky = -0.32 - row * 0.056;
        const kz = -0.888 + row * 0.003;

        const keyBox = new THREE.Mesh(
          new THREE.BoxGeometry(kw, kh, 0.018),
          style === 'silver' ? gunmetal : darkMetal
        );
        keyBox.position.set(kx, ky, kz);
        keyBox.rotation.x = -0.06;
        this.group.add(keyBox);

        const capTex = this._trackTex(makeKeycapTexture(mainTxt, subTxt, style));
        const keyTop = new THREE.Mesh(
          new THREE.PlaneGeometry(kw * 0.94, kh * 0.94),
          this._mat(0xffffff, { map: capTex, shininess: 12, specular: 0x2a323a, bounceScale: 0.85 })
        );
        keyTop.position.set(kx, ky, kz + 0.01);
        keyTop.rotation.x = -0.06;
        this.group.add(keyTop);
      }
    }

    // Left & right knurled ICP thumbwheels + lower 4-way DCS switch.
    for (const side of [-1, 1]) {
      for (const wy of [-0.34, -0.45]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.046, 12), gunmetal);
        wheel.position.set(side * 0.195, wy, -0.888);
        this.group.add(wheel);
      }
    }
    const dcsBase = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.018, 12), darkMetal);
    dcsBase.rotation.x = Math.PI / 2;
    dcsBase.position.set(-0.115, -0.5, -0.888);
    this.group.add(dcsBase);
    const dcsHat = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.014), alloy);
    dcsHat.position.set(-0.115, -0.5, -0.876);
    this.group.add(dcsHat);

    // --- Left Instrument Bay: 100% Coplanar Unobstructed Round RWR ----------
    const rwrX = -0.41;
    const rwrY = -0.35;
    const rwrZ = -0.92;
    const rwrBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.118, 0.036, 24), gunmetal);
    rwrBezel.rotation.x = Math.PI / 2 - 0.06;
    rwrBezel.position.set(rwrX, rwrY, rwrZ);
    this.group.add(rwrBezel);

    this.tacScreen = new THREE.Mesh(
      new THREE.CircleGeometry(0.098, 28),
      this._screenMat(this.tacTexture)
    );
    this.tacScreen.name = 'cockpit-rwr-scope';
    this.tacScreen.position.set(rwrX, rwrY, rwrZ + 0.022);
    this.tacScreen.rotation.x = -0.06;
    this.group.add(this.tacScreen);

    // Four machined bolts around the RWR bezel.
    for (const [ox, oy] of [
      [-0.095, 0.095],
      [0.095, 0.095],
      [-0.095, -0.095],
      [0.095, -0.095],
    ]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 8), alloy);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(rwrX + ox, rwrY + oy, rwrZ + 0.016);
      this.group.add(bolt);
    }

    // 5 muted tactical CMDS / threat warning annunciators (flash red on missile!).
    this._warningLamps = [];
    const warnColors = [0x6e2b26, 0x735228, 0x265e46, 0x265e46, 0x2b5663];
    warnColors.forEach((baseHex, i) => {
      const mat = this._lamp(baseHex);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.034, 0.016), darkMetal);
      frame.position.set(-0.54 + i * 0.064, -0.5, -0.915);
      this.group.add(frame);

      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.022, 0.012), mat);
      lamp.position.set(-0.54 + i * 0.064, -0.5, -0.904);
      this.group.add(lamp);
      this._warningLamps.push({ mesh: lamp, material: mat, baseHex, index: i });
    });

    // --- Right Instrument Bay: 100% Unobstructed DED + Standby ADI Panel ----
    const dedX = 0.43;
    const dedY = -0.295;
    const dedZ = -0.92;
    const dedBezel = new THREE.Mesh(new THREE.BoxGeometry(0.325, 0.125, 0.038), gunmetal);
    dedBezel.position.set(dedX, dedY, dedZ);
    dedBezel.rotation.x = -0.06;
    this.group.add(dedBezel);

    this.sysScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.295, 0.098),
      this._screenMat(this.sysTexture)
    );
    this.sysScreen.name = 'cockpit-ded-display';
    this.sysScreen.position.set(dedX, dedY, dedZ + 0.022);
    this.sysScreen.rotation.x = -0.06;
    this.group.add(this.sysScreen);

    // Directly below the DED: Standby ADI Horizon Ball + Fuel/Engine Display.
    const stbyBezel = new THREE.Mesh(new THREE.BoxGeometry(0.325, 0.175, 0.038), darkMetal);
    stbyBezel.position.set(dedX, -0.455, dedZ + 0.005);
    stbyBezel.rotation.x = -0.06;
    this.group.add(stbyBezel);

    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.298, 0.15),
      this._screenMat(this.texture)
    );
    this.screen.name = 'cockpit-standby-panel';
    this.screen.position.set(dedX, -0.455, dedZ + 0.026);
    this.screen.rotation.x = -0.06;
    this.group.add(this.screen);

    // --- Left Throttle Quadrant + Sculpted 3D Left Pilot Hand ---------------
    // Positioned cleanly in outer lower-left foreground so zero panels are blocked.
    this.throttleLevers = [];
    const thrTrack = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.035, 0.28), darkMetal);
    thrTrack.position.set(-0.62, -0.56, -0.7);
    this.group.add(thrTrack);

    const thrPivot = new THREE.Group();
    thrPivot.name = 'throttle-lever';
    thrPivot.position.set(-0.62, -0.57, -0.7);
    this.group.add(thrPivot);

    const thrArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.17, 10), alloy);
    thrArm.position.set(0, 0.085, 0);
    thrPivot.add(thrArm);

    const thrGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.125, 12), darkMetal);
    thrGrip.rotation.z = Math.PI / 2;
    thrGrip.position.set(0.01, 0.175, 0);
    thrPivot.add(thrGrip);

    // Amber countermeasure / flare dispense switch on the inner throttle side.
    this.flareSwitch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.012, 0.016, 10),
      this._mat(0xb87b2d, { shininess: 18, specular: 0x453520, matte: true })
    );
    this.flareSwitch.name = 'throttle-flare-switch';
    this.flareSwitch.rotation.z = Math.PI / 2;
    this.flareSwitch.position.set(0.072, 0.184, -0.022);
    thrPivot.add(this.flareSwitch);

    this.leftHand = this._buildLeftThrottleHand(pilotMats);
    this.leftHand.position.set(0.01, 0.184, 0.008);
    this.leftHand.rotation.x = 0.14;
    thrPivot.add(this.leftHand);
    this.throttleLevers.push(thrPivot);

    // Secondary detent slider beside main throttle lever.
    const subThr = new THREE.Group();
    subThr.position.set(-0.69, -0.57, -0.7);
    this.group.add(subThr);
    const subArm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.026), darkMetal);
    subArm.position.set(0, 0.07, 0);
    subThr.add(subArm);
    this.throttleLevers.push(subThr);

    // --- Right F-16 HOTAS Side-Stick + Sculpted 3D Right Pilot Hand ---------
    // Positioned cleanly in outer lower-right foreground beside the Standby ADI.
    this.stick = new THREE.Group();
    this.stick.name = 'flight-stick';
    this.stick.position.set(0.62, -0.57, -0.7);
    this.group.add(this.stick);

    const stickBase = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.078, 0.06, 14), rubber);
    stickBase.position.set(0, -0.02, 0);
    this.stick.add(stickBase);

    const stickShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.15, 10), gunmetal);
    stickShaft.position.set(0, 0.075, 0);
    this.stick.add(stickShaft);

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.135, 12), rubber);
    grip.position.set(0, 0.185, 0);
    this.stick.add(grip);

    // Animated two-stage red cannon trigger at front of stick grip.
    this.stickTrigger = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.036, 0.022),
      this._mat(0x9b3128, { shininess: 18, specular: 0x442420, matte: true })
    );
    this.stickTrigger.name = 'stick-fire-trigger';
    this.stickTrigger.position.set(-0.004, 0.214, -0.041);
    this.stick.add(this.stickTrigger);

    // Stick head collar + animated red MISSILE pickle button under pilot's thumb!
    const stickHead = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.028, 12), darkMetal);
    stickHead.position.set(0, 0.252, -0.004);
    this.stick.add(stickHead);

    const pickleCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.012, 12), gunmetal);
    pickleCollar.position.set(-0.006, 0.268, -0.01);
    this.stick.add(pickleCollar);

    this._missileBtnMat = this._mat(0xa83028, { shininess: 22, specular: 0x48201c, matte: true });
    this.missileButton = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.018, 12),
      this._missileBtnMat
    );
    this.missileButton.name = 'stick-missile-button';
    this.missileButton.position.set(-0.006, 0.275, -0.01);
    this.stick.add(this.missileButton);

    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.013, 0.018, 10), gunmetal);
    hat.position.set(0.018, 0.272, 0.004);
    this.stick.add(hat);

    for (let i = 0; i < 3; i++) {
      const sideBtn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.009, 0.009, 0.012, 8),
        i === 0 ? this._lamp(0x2e6b50) : gunmetal
      );
      sideBtn.rotation.z = Math.PI / 2;
      sideBtn.position.set(-0.033, 0.23 - i * 0.03, 0);
      this.stick.add(sideBtn);
    }

    // Pilot's sculpted matte gloved right hand & forearm gripping the HOTAS stick!
    this.rightHand = this._buildRightStickHand(pilotMats);
    this.rightHand.position.set(0.006, 0.184, 0.008);
    this.stick.add(this.rightHand);

    this.group.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
        node.frustumCulled = false;
      }
    });
  }

  setVisible(visible) {
    this.visible = !!visible;
    this.group.visible = this.visible;
  }

  /** Triggers the right-thumb press animation on the HOTAS missile pickle button. */
  triggerMissilePress() {
    this._missilePressTimer = 0.36;
  }

  /** Triggers the left-thumb press animation on the throttle flare button. */
  triggerFlarePress() {
    this._flarePressTimer = 0.3;
  }

  /**
   * @param {number} dt
   * @param {{telemetry: object, contacts: Array, combat: object, target: object, input: object, incoming?: number|null, lighting?: object, actions?: {firing?: boolean}}} data
   */
  update(dt, data) {
    if (!this.visible) return;
    this.time += dt;
    const incoming = data?.incoming ?? data?.combat?.incoming;
    this._updateStickAndHands(dt, data?.input, data?.telemetry, data?.actions);
    this._updateWarningLamps(incoming);
    this._updateCanopyLighting(data?.lighting, incoming);
    this._drawAcc += dt;
    if (this._drawAcc < 1 / 14) return;
    this._drawAcc = 0;
    this._draw(data);
  }

  /** Syncs canopy light reflection immediately (e.g. when entering cockpit view). */
  syncLighting(lighting, incoming = null) {
    this._updateCanopyLighting(lighting, incoming);
  }

  /**
   * Adapts cockpit lighting & specular reflections to the real sunlight and
   * sky dome entering through the bubble canopy as the jet banks, pitches, or
   * switches maps — keeping crisp contrast instead of chalky grey washout.
   */
  _updateCanopyLighting(lighting, incoming = null) {
    if (!this.canopySunLight || !this.canopyFillLight) return;

    const sunDir = lighting?.sunDir;
    const camQuat = lighting?.cameraQuaternion;
    if (
      sunDir &&
      Number.isFinite(sunDir.x) &&
      Number.isFinite(sunDir.y) &&
      Number.isFinite(sunDir.z)
    ) {
      this._localSun.copy(sunDir);
      if (camQuat && Number.isFinite(camQuat.w)) {
        this._invCamQuat.copy(camQuat).invert();
        this._localSun.applyQuaternion(this._invCamQuat);
      }
      if (this._localSun.lengthSq() > 1e-6) this._localSun.normalize();
      else this._localSun.set(-0.42, 0.68, 0.6).normalize();
    } else {
      this._localSun.set(-0.42, 0.68, 0.6).normalize();
    }

    if (lighting?.sunColor) this._sunTint.copy(lighting.sunColor);
    else this._sunTint.setHex(0xf6f0e4);
    this._sunTint.lerp(this._neutralSun, 0.35);

    if (lighting?.skyColor) this._skyTint.copy(lighting.skyColor);
    else this._skyTint.setHex(0xc2dce8);
    this._skyTint.lerp(this._neutralSky, 0.42);

    if (lighting?.groundColor) this._groundTint.copy(lighting.groundColor);
    else this._groundTint.setHex(0x5a706a);

    const sx = this._localSun.x;
    const sy = this._localSun.y;
    const sz = this._localSun.z;

    // Direct sun-entry light tracks the real sun across the bubble canopy.
    const lx = THREE.MathUtils.clamp(sx * 1.35, -1.2, 1.2);
    const ly = THREE.MathUtils.clamp(0.75 + sy * 0.65, 0.35, 1.38);
    const lz = THREE.MathUtils.clamp(0.32 + sz * 0.55, -0.15, 0.85);
    this.canopySunLight.position.set(lx, ly, lz);

    const directExposure = THREE.MathUtils.clamp(sy * 0.55 + sz * 0.45 + 0.52, 0, 1);
    const sunMix = THREE.MathUtils.clamp(0.55 + directExposure * 0.45, 0.55, 1);
    this.canopySunLight.color.copy(this._skyTint).lerp(this._sunTint, sunMix);
    this.canopySunLight.intensity = 1.52 + directExposure * 0.7;

    // Gentle neutral sky/ground bounce so shaded crevices stay readable without chroma cast.
    const invertBlend = THREE.MathUtils.clamp(-sy * 0.65, 0, 0.55);
    this.canopyFillLight.color.copy(this._skyTint).lerp(this._groundTint, invertBlend);
    this.canopyFillLight.position.set(-lx * 0.4, 0.55 + Math.max(0, sy) * 0.2, 0.55);
    this.canopyFillLight.intensity = 0.62 + (1 - invertBlend) * 0.22;

    // Very soft instrument bounce (zero blown-out green glare on ICP buttons;
    // shifts subtly to warm red pulse only during active missile warning).
    if (this.consoleGlowLight) {
      const threat = Number.isFinite(incoming);
      const pulse = Math.sin(this.time * 16) * 0.5 + 0.5;
      if (threat) {
        this.consoleGlowLight.color.setHex(pulse > 0.5 ? 0xd9483e : 0xd4964c);
        this.consoleGlowLight.intensity = 0.14 + pulse * 0.16;
      } else {
        this.consoleGlowLight.color.setHex(0x64a886);
        this.consoleGlowLight.intensity = 0.055;
      }
    }

    // Subtle ambient sky tint & natural low-chroma specular highlights.
    // Matte fabrics & pilot flight gloves stay strictly non-chrome under sunlight.
    this._bounceColor.copy(this._skyTint).lerp(this._sunTint, 0.35 + directExposure * 0.2);
    const bounceStrength = 0.04 + directExposure * 0.025;
    for (let i = 0; i < this._litMaterials.length; i++) {
      const entry = this._litMaterials[i];
      entry.mat.emissive.copy(this._bounceColor);
      entry.mat.emissiveIntensity = bounceStrength * entry.bounceScale;
      if (entry.matte) {
        entry.mat.specular.copy(entry.baseSpecular);
      } else {
        this._specTint.copy(entry.baseSpecular).lerp(this._sunTint, 0.15 + directExposure * 0.12);
        entry.mat.specular.copy(this._specTint);
      }
    }

    // Crystal-clear dark-emerald combiner glass with delicate angle-based tint.
    if (this._glassTintMat) {
      const frontGlint = THREE.MathUtils.clamp(-sz * 0.5 + sy * 0.2 + 0.12, 0, 1);
      this._glassTintMat.color.setHex(0x062018).lerp(this._skyTint, 0.08 + frontGlint * 0.08);
      this._glassTintMat.opacity = 0.045 + frontGlint * 0.035;
    }
  }

  /**
   * Control stick, throttle levers, and both anatomical 3D pilot hands follow
   * flight input plus weapon trigger (FIRE), missile pickle button, and flare
   * switch press animations.
   */
  _updateStickAndHands(dt, input, telemetry, actions) {
    if (!this.stick) return;
    const pitch = THREE.MathUtils.clamp(input?.pitch ?? 0, -1, 1);
    const roll = THREE.MathUtils.clamp(input?.roll ?? 0, -1, 1);
    const k = 1 - Math.exp(-STICK_SMOOTH * dt);

    // Stick & right hand tilt smoothly with pitch (pull back/push forward) & roll.
    this.stick.rotation.x += (pitch * STICK_TILT - this.stick.rotation.x) * k;
    this.stick.rotation.z += (roll * STICK_TILT - this.stick.rotation.z) * k;

    // --- Cannon FIRE animation: index finger squeezes red trigger -----------
    const firing = !!(actions?.firing ?? input?.fire);
    const fireTarget = firing ? 1 : 0;
    const fk = 1 - Math.exp(-26 * dt);
    this._fireAnim += (fireTarget - this._fireAnim) * fk;
    const recoil = firing ? Math.sin(this.time * 72) * 0.0025 : 0;

    if (this.rightIndexFinger) {
      this.rightIndexFinger.rotation.y = this._fireAnim * 0.28;
      this.rightIndexFinger.rotation.x = this._fireAnim * 0.12 + recoil * 10;
    }
    if (this.stickTrigger) {
      this.stickTrigger.position.z = -0.041 + this._fireAnim * 0.009 + recoil * 0.4;
      this.stickTrigger.rotation.x = this._fireAnim * 0.28;
    }

    // --- MISSILE pickle animation: right thumb presses red top button -------
    if (this._missilePressTimer > 0) {
      this._missilePressTimer = Math.max(0, this._missilePressTimer - dt);
    }
    const mslTarget = this._missilePressTimer > 0.12 ? 1 : 0;
    const mk = 1 - Math.exp(-28 * dt);
    this._missilePressAnim += (mslTarget - this._missilePressAnim) * mk;

    if (this.rightThumb) {
      this.rightThumb.rotation.x = -this._missilePressAnim * 0.42;
      this.rightThumb.rotation.z = this._missilePressAnim * 0.22;
      this.rightThumb.position.y = 0.044 - this._missilePressAnim * 0.008;
    }
    if (this.missileButton) {
      this.missileButton.position.y = 0.275 - this._missilePressAnim * 0.01;
    }
    if (this._missileBtnMat) {
      this._missileBtnMat.color.setHex(this._missilePressAnim > 0.35 ? 0xe04a38 : 0xa83028);
    }

    // --- FLARE switch animation: left thumb presses inner throttle switch ---
    if (this._flarePressTimer > 0) {
      this._flarePressTimer = Math.max(0, this._flarePressTimer - dt);
    }
    const flrTarget = this._flarePressTimer > 0.1 ? 1 : 0;
    this._flarePressAnim += (flrTarget - this._flarePressAnim) * mk;

    if (this.leftThumb) {
      this.leftThumb.rotation.z = -this._flarePressAnim * 0.28;
      this.leftThumb.position.x = 0.048 + this._flarePressAnim * 0.008;
    }
    if (this.flareSwitch) {
      this.flareSwitch.position.x = 0.072 - this._flarePressAnim * 0.007;
    }

    // Subtle flight & cannon recoil vibration on right hand.
    if (this.rightHand) {
      const gLoad = telemetry?.gForce ?? 1;
      const vib = Math.sin(this.time * 38) * 0.0016 * Math.min(2.5, Math.abs(gLoad));
      this.rightHand.position.y = 0.184 + vib + recoil * 0.6;
    }

    // Throttle levers & left hand slide forward with throttle / afterburner.
    const thr = THREE.MathUtils.clamp(
      telemetry?.boosting ? 1 : telemetry?.throttle ?? input?.throttle ?? 0.68,
      0,
      1
    );
    const targetRot = 0.24 - thr * 0.64;
    for (const lever of this.throttleLevers) {
      lever.rotation.x += (targetRot - lever.rotation.x) * k;
    }
  }

  /** Flashes cockpit threat warning lamps red when a missile is chasing the jet. */
  _updateWarningLamps(incoming) {
    const threat = Number.isFinite(incoming);
    const fastBlink = Math.floor(this.time * (incoming < 700 ? 12 : 6)) % 2 === 0;
    for (const item of this._warningLamps) {
      if (threat && item.index <= 1) {
        item.material.color.setHex(fastBlink ? 0xff2c24 : 0x3b0907);
      } else {
        item.material.color.setHex(item.baseHex);
      }
    }
  }

  /** Right-lower Standby Panel: Crisp Round ADI Horizon Ball + Fuel/Hull/Status. */
  _draw(data) {
    const ctx = this.ctx;
    const w = PANEL_W;
    const h = PANEL_H;
    const telemetry = data?.telemetry;
    const combat = data?.combat;

    ctx.fillStyle = '#0c1116';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(130, 175, 195, 0.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Left half: crisp F-16 round standby Artificial Horizon (ADI) gauge.
    drawADI(ctx, 128, 128, 96, telemetry ? telemetry.pitch : 0, telemetry ? telemetry.roll : 0);

    // Right half: digital FUEL / FLOW / THR / HULL / FLR mini-gauges.
    const sx = 258;
    ctx.fillStyle = '#071512';
    ctx.fillRect(sx - 10, 18, w - sx - 8, h - 36);
    ctx.strokeStyle = 'rgba(109, 255, 184, 0.34)';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 10, 18, w - sx - 8, h - 36);

    ctx.textAlign = 'left';
    const hull = combat ? Math.max(0, Math.min(100, combat.hull)) : 100;
    const thr = Math.round((telemetry?.throttle ?? 0.68) * 100);
    const kts = Math.round(telemetry?.speedKts ?? 0);

    ctx.font = '700 18px monospace';
    ctx.fillStyle = '#8ad8b8';
    ctx.fillText('FUEL FLOW', sx, 48);
    ctx.fillStyle = GREEN_BRIGHT;
    ctx.font = '700 22px monospace';
    ctx.fillText(`${String(thr * 42).padStart(4, '0')} PPH`, sx, 76);

    ctx.font = '700 17px monospace';
    ctx.fillStyle = '#8ad8b8';
    ctx.fillText('HULL', sx, 114);
    ctx.fillStyle = '#0c2720';
    ctx.fillRect(sx + 62, 98, 150, 18);
    ctx.fillStyle = hull <= 30 ? RED : GREEN;
    ctx.fillRect(sx + 62, 98, (150 * hull) / 100, 18);

    ctx.fillStyle = '#8ad8b8';
    ctx.fillText(`FLR  ${String(combat?.flares ?? 15).padStart(2, '0')}`, sx, 156);
    ctx.fillStyle = GREEN_BRIGHT;
    ctx.fillText(`IAS  ${String(kts).padStart(3, ' ')} KT`, sx, 192);
    ctx.fillStyle = AMBER;
    ctx.fillText(`KILL ${String(combat?.kills ?? 0).padStart(2, '0')}`, sx, 224);

    this.texture.needsUpdate = true;
    this._drawDED(data);
    this._drawRWR(data);
    this._drawHudCombiner(data);
  }

  /**
   * Tall F-16 Wide-Angle Optical HUD Combiner projection (768×768) with
   * crisp emerald glow: top heading tape (SE 155 S), left SPEED tape, right
   * ALT tape, dynamic pitch ladder (+5/-5), reticle, and FIRE / FLARE! box.
   */
  _drawHudCombiner(data) {
    const ctx = this.hudCtx;
    if (!ctx) return;
    const s = HUD_GLASS;
    const cx = s / 2;
    const cy = s * 0.53;
    const telemetry = data?.telemetry;
    const combat = data?.combat;
    const hasTarget = !!data?.target;
    const lockProg =
      typeof data?.lockProgress === 'number' && Number.isFinite(data.lockProgress)
        ? THREE.MathUtils.clamp(data.lockProgress, 0, 1)
        : hasTarget
          ? 1
          : 0;
    const locked = hasTarget && lockProg >= 1;
    const acquiring = hasTarget && lockProg > 0 && lockProg < 1;
    const incoming = data?.incoming ?? combat?.incoming;
    const hasMissile = Number.isFinite(incoming);

    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.shadowColor = 'rgba(72, 195, 138, 0.42)';
    ctx.shadowBlur = 3;

    // --- Top compass heading tape (SE 155 S style) -------------------------
    const hdg = telemetry ? Math.round(((telemetry.heading % 360) + 360) % 360) : 0;
    const cardIdx = Math.round(hdg / 45) % 8;
    const prevCard = CARDINALS_8[(cardIdx + 7) % 8];
    const nextCard = CARDINALS_8[(cardIdx + 1) % 8];

    ctx.fillStyle = GREEN_BRIGHT;
    ctx.strokeStyle = GREEN_BRIGHT;
    ctx.font = '700 34px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${prevCard}   ${String(hdg).padStart(3, '0')}   ${nextCard}`, cx, 134);

    // Compass tick dots under heading readout.
    for (let i = -5; i <= 5; i++) {
      const tx = cx + i * 34;
      const th = i === 0 ? 16 : 9;
      ctx.fillRect(tx - 2.5, 152, 5, th);
    }

    // --- Left SPEED tape & boxed value -------------------------------------
    const kts = telemetry ? Math.round(telemetry.speedKts) : 0;
    ctx.strokeStyle = GREEN_BRIGHT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(116, cy - 172);
    ctx.lineTo(116, cy + 172);
    ctx.stroke();
    for (let i = -10; i <= 10; i++) {
      const ty = cy + i * 16.5;
      const len = i % 5 === 0 ? 22 : 11;
      ctx.beginPath();
      ctx.moveTo(116, ty);
      ctx.lineTo(116 + len, ty);
      ctx.stroke();
    }
    ctx.font = '700 24px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = GREEN;
    ctx.fillText('SPEED', 16, cy - 26);
    ctx.lineWidth = 2.8;
    ctx.strokeRect(14, cy - 16, 94, 42);
    ctx.font = '700 31px monospace';
    ctx.fillStyle = GREEN_BRIGHT;
    ctx.fillText(String(kts).padStart(4, ' '), 20, cy + 16);

    // --- Right ALT tape & boxed value --------------------------------------
    const alt = telemetry ? Math.round(telemetry.altitude) : 0;
    ctx.strokeStyle = GREEN_BRIGHT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s - 116, cy - 172);
    ctx.lineTo(s - 116, cy + 172);
    ctx.stroke();
    for (let i = -10; i <= 10; i++) {
      const ty = cy + i * 16.5;
      const len = i % 5 === 0 ? 22 : 11;
      ctx.beginPath();
      ctx.moveTo(s - 116, ty);
      ctx.lineTo(s - 116 - len, ty);
      ctx.stroke();
    }
    ctx.font = '700 24px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = GREEN;
    ctx.fillText('ALT', s - 16, cy - 26);
    ctx.lineWidth = 2.8;
    ctx.strokeRect(s - 108, cy - 16, 94, 42);
    ctx.font = '700 31px monospace';
    ctx.fillStyle = GREEN_BRIGHT;
    ctx.fillText(String(alt).padStart(4, ' '), s - 20, cy + 16);

    // --- Center dynamic pitch ladder (+5 / 0 / -5) & flight-path marker ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(146, 188, s - 292, 405);
    ctx.clip();
    ctx.translate(cx, cy);
    const rollRad = ((telemetry?.roll ?? 0) * Math.PI) / 180;
    const pitchPx = THREE.MathUtils.clamp(telemetry?.pitch ?? 0, -35, 35) * 6.2;
    ctx.rotate(rollRad);

    ctx.strokeStyle = GREEN_BRIGHT;
    ctx.fillStyle = GREEN_BRIGHT;
    ctx.lineWidth = 3;
    ctx.font = '700 24px monospace';

    // Horizon line (0 deg).
    ctx.beginPath();
    ctx.moveTo(-168, pitchPx);
    ctx.lineTo(-42, pitchPx);
    ctx.moveTo(42, pitchPx);
    ctx.lineTo(168, pitchPx);
    ctx.stroke();

    for (const deg of [5, 10, -5, -10]) {
      const py = pitchPx - deg * 16.5;
      const tickDir = deg > 0 ? 15 : -15;
      if (deg < 0) ctx.setLineDash([12, 8]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(-132, py);
      ctx.lineTo(-54, py);
      ctx.lineTo(-54, py + tickDir);
      ctx.moveTo(132, py);
      ctx.lineTo(54, py);
      ctx.lineTo(54, py + tickDir);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'right';
      ctx.fillText(String(deg), -138, py + 8);
      ctx.textAlign = 'left';
      ctx.fillText(String(deg), 138, py + 8);
    }
    ctx.restore();

    // Fixed flight-path marker & boresight reticle in center.
    ctx.strokeStyle = GREEN_BRIGHT;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.moveTo(cx - 44, cy);
    ctx.lineTo(cx - 18, cy);
    ctx.moveTo(cx + 18, cy);
    ctx.lineTo(cx + 44, cy);
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx, cy - 34);
    ctx.stroke();

    // --- Bottom status box: FIRE (locked), SEEKING (acquiring), or MISSILE FLARE!
    const blink = Math.floor(this.time * 8) % 2 === 0;
    ctx.textAlign = 'center';
    if (hasMissile) {
      ctx.shadowColor = 'rgba(255, 65, 50, 0.95)';
      ctx.fillStyle = blink ? RED : AMBER;
      ctx.strokeStyle = blink ? RED : AMBER;
      ctx.lineWidth = 4;
      ctx.strokeRect(cx - 168, s - 96, 336, 54);
      ctx.font = '700 32px monospace';
      ctx.fillText('MISSILE · FLARE!', cx, s - 58);
    } else if (locked) {
      ctx.fillStyle = GREEN_BRIGHT;
      ctx.strokeStyle = GREEN_BRIGHT;
      ctx.lineWidth = 3.5;
      ctx.strokeRect(cx - 108, s - 94, 216, 48);
      ctx.font = '700 30px monospace';
      ctx.fillText('LOCK · FIRE', cx, s - 59);
    } else if (acquiring) {
      ctx.fillStyle = AMBER;
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 2.8;
      ctx.strokeRect(cx - 118, s - 94, 236, 48);
      ctx.fillRect(cx - 110, s - 56, 220 * lockProg, 6);
      ctx.font = '700 24px monospace';
      ctx.fillText(`SEEKING ${Math.round(lockProg * 100)}%`, cx, s - 66);
    } else {
      ctx.fillStyle = GREEN;
      ctx.font = '700 24px monospace';
      ctx.fillText('A-A · MASTER ARM', cx, s - 62);
    }

    ctx.restore();
    this.hudTexture.needsUpdate = true;
  }

  /** Shared glowing emerald radar scope used by the left glare-shield RWR. */
  _drawScope(ctx, radX, radY, radR, data, blipSize) {
    const telemetry = data?.telemetry;
    const contacts = data?.contacts ?? [];
    const incoming = data?.incoming ?? data?.combat?.incoming;
    const hasMissile = Number.isFinite(incoming);

    ctx.save();
    ctx.beginPath();
    ctx.arc(radX, radY, radR, 0, Math.PI * 2);
    ctx.fillStyle = '#031912';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = hasMissile && Math.floor(this.time * 8) % 2 === 0 ? RED : GREEN;
    ctx.stroke();
    ctx.clip();

    ctx.strokeStyle = 'rgba(109, 255, 184, 0.32)';
    ctx.lineWidth = 1.6;
    for (const f of [0.35, 0.68]) {
      ctx.beginPath();
      ctx.arc(radX, radY, radR * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(radX - radR, radY);
    ctx.lineTo(radX + radR, radY);
    ctx.moveTo(radX, radY - radR);
    ctx.lineTo(radX, radY + radR);
    ctx.stroke();

    const sweep = this.time * 1.8;
    const grad = ctx.createLinearGradient
      ? ctx.createLinearGradient(
          radX,
          radY,
          radX + Math.cos(sweep) * radR,
          radY + Math.sin(sweep) * radR
        )
      : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(109, 255, 184, 0.04)');
      grad.addColorStop(1, 'rgba(109, 255, 184, 0.72)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(radX, radY);
      ctx.lineTo(radX + Math.cos(sweep) * radR, radY + Math.sin(sweep) * radR);
      ctx.stroke();
    }

    const heading = ((telemetry ? telemetry.heading : 0) * Math.PI) / 180;
    for (const c of contacts) {
      const bearing = Math.atan2(c.x, -c.z);
      const rel = bearing - heading;
      const dist = Math.min(1, (c.distance ?? 0) / 7500);
      const bx = radX + Math.sin(rel) * dist * radR;
      const by = radY - Math.cos(rel) * dist * radR;
      ctx.fillStyle = c.ally ? CYAN : RED;
      ctx.fillRect(bx - blipSize / 2, by - blipSize / 2, blipSize, blipSize);
    }

    if (hasMissile && Math.floor(this.time * 10) % 2 === 0) {
      ctx.fillStyle = RED;
      ctx.font = '700 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('M!', radX, radY - radR * 0.42);
    }

    ctx.fillStyle = GREEN_BRIGHT;
    ctx.beginPath();
    ctx.moveTo(radX, radY - 9);
    ctx.lineTo(radX + 6, radY + 6);
    ctx.lineTo(radX, radY + 2);
    ctx.lineTo(radX - 6, radY + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Right Glare-Shield Glowing Emerald DED (Data Entry Display). */
  _drawDED(data) {
    const ctx = this.sysCtx;
    const s = MFD;
    const telemetry = data?.telemetry;
    const combat = data?.combat;
    const incoming = data?.incoming ?? combat?.incoming;
    const hasMissile = Number.isFinite(incoming);

    ctx.fillStyle = '#021a0d';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = hasMissile ? RED : 'rgba(109, 255, 184, 0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, s - 8, s - 8);

    const blink = Math.floor(this.time * 8) % 2 === 0;
    if (hasMissile) {
      ctx.fillStyle = blink ? RED : AMBER;
      ctx.font = '700 26px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('! MISSILE !', s / 2, 72);
      ctx.font = '700 22px monospace';
      ctx.fillText(`RNG ${Math.round(incoming)} M`, s / 2, 126);
      ctx.fillStyle = GREEN_BRIGHT;
      ctx.fillText('PRESS [V] FLARE', s / 2, 182);
      ctx.font = '700 18px monospace';
      ctx.fillText(`FLR REM: ${combat?.flares ?? 0}`, s / 2, 226);
    } else {
      ctx.fillStyle = GREEN_BRIGHT;
      ctx.font = '700 19px monospace';
      ctx.textAlign = 'left';
      const thr = Math.round((telemetry?.throttle ?? 0.68) * 100);
      const g = (telemetry?.gForce ?? 1).toFixed(1);
      ctx.fillText('LIST         3', 14, 42);
      ctx.fillText('1DEST 2BNGO 3VIP', 14, 88);
      ctx.fillText('4NAV  5MAN  6INS', 14, 134);
      ctx.fillText(`7CMDS 8FLR:${String(combat?.flares ?? 15).padStart(2, '0')}`, 14, 180);
      ctx.fillStyle = GREEN;
      ctx.fillText(`THR ${String(thr).padStart(3, ' ')}%  G ${g}`, 14, 226);
    }

    this.sysTexture.needsUpdate = true;
  }

  /** Left Glare-Shield Round RWR (Radar Warning Receiver) Scope. */
  _drawRWR(data) {
    const ctx = this.tacCtx;
    const s = MFD;
    ctx.fillStyle = '#031710';
    ctx.fillRect(0, 0, s, s);
    this._drawScope(ctx, s / 2, s / 2, s * 0.45, data, 12);
    this.tacTexture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.sysTexture?.dispose();
    this.tacTexture?.dispose();
    this.hudTexture?.dispose();
    for (const tex of this._staticTextures) tex.dispose();
    this.group.traverse((node) => {
      if (node.isMesh) {
        node.geometry.dispose();
        node.material.dispose();
      }
    });
  }
}
