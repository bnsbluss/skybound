import * as THREE from 'three';
import { DEG } from '../utils/math.js';

function makeGlowTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,252,232,1)');
  g.addColorStop(0.08, 'rgba(255,244,205,0.95)');
  g.addColorStop(0.22, 'rgba(255,220,150,0.42)');
  g.addColorStop(0.5, 'rgba(255,195,110,0.12)');
  g.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uMidColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uHazeColor;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y, -0.25, 1.0);

    float midT = smoothstep(-0.015, 0.25, h);
    float topT = smoothstep(0.16, 0.85, h);
    vec3 sky = mix(uHorizonColor, uMidColor, midT);
    sky = mix(sky, uTopColor, topT);

    // Warm band hugging the horizon.
    float horizonBand = exp(-abs(h - 0.015) * 55.0);
    sky = mix(sky, uSunColor, horizonBand * 0.09);

    float sunD = max(dot(dir, uSunDir), 0.0);
    float disc = smoothstep(0.99955, 0.99985, sunD);
    float halo = pow(sunD, 26.0);
    float wideHalo = pow(sunD, 5.0);
    sky += uSunColor * disc * 5.0;
    sky += uSunColor * halo * 0.36;
    sky += uSunColor * wideHalo * 0.085 * (1.0 - topT * 0.45);

    // Distant haze thickens at the horizon.
    float haze = exp(-max(h, 0.0) * 16.0) * 0.5;
    sky = mix(sky, uHazeColor, clamp(haze * (1.0 - disc), 0.0, 0.55));

    // Very light high cirrus for scale.
    float cirrus = smoothstep(0.55, 0.9, h) * (1.0 - smoothstep(0.85, 1.0, h));
    float streak = sin(dir.x * 17.0 + dir.z * 7.0 + h * 12.0) * 0.5 + 0.5;
    streak *= sin(dir.x * 9.0 - dir.z * 19.0 + 1.7) * 0.5 + 0.5;
    sky += uHorizonColor * cirrus * streak * 0.028;

    // Dither against 8-bit banding.
    float d = hash12(gl_FragCoord.xy) - 0.5;
    sky += d / 255.0;

    gl_FragColor = vec4(max(sky, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(quality) {
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.group.renderOrder = -100;

    this.radius = 18000;
    this.sunDir = new THREE.Vector3(-0.56, 0.52, -0.45).normalize();
    this.baseAzimuth = DEG * -129;
    this.baseElevation = DEG * 31;

    this.uniforms = {
      uTopColor: { value: new THREE.Color(0x2e7fda) },
      uMidColor: { value: new THREE.Color(0x7fd5ef) },
      uHorizonColor: { value: new THREE.Color(0xd2f1f2) },
      uSunColor: { value: new THREE.Color(0xffe4b0) },
      uHazeColor: { value: new THREE.Color(0xc7e9ee) },
      uSunDir: { value: this.sunDir.clone() },
    };

    const geometry = new THREE.SphereGeometry(this.radius, 48, 24);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
    });
    this.dome = new THREE.Mesh(geometry, material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    this.group.add(this.dome);

    const glowTexture = makeGlowTexture();
    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xfff1c4,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
      })
    );
    this.sunSprite.scale.setScalar(3200);
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(this.radius * 0.92);
    this.sunSprite.renderOrder = -50;
    this.group.add(this.sunSprite);

    // Lights live outside the sky group so their targets can follow the jet.
    this.hemi = new THREE.HemisphereLight(0xbdeeff, 0x3d7a68, 0.95);
    this.hemi.name = 'hemi-light';

    this.sunLight = new THREE.DirectionalLight(0xfff0d2, 2.65);
    this.sunLight.name = 'sun-light';
    this.sunLight.position.copy(this.sunDir).multiplyScalar(1700);
    this.sunLight.castShadow = !!quality.shadows;
    if (quality.shadows) {
      const shadowSize = quality.shadowMapSize ?? 2048;
      this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
      this.sunLight.shadow.camera.left = -650;
      this.sunLight.shadow.camera.right = 650;
      this.sunLight.shadow.camera.top = 650;
      this.sunLight.shadow.camera.bottom = -650;
      this.sunLight.shadow.camera.near = 1;
      this.sunLight.shadow.camera.far = 4200;
      this.sunLight.shadow.bias = -0.0004;
      this.sunLight.shadow.normalBias = 1.6;
      this.sunLight.shadow.camera.updateProjectionMatrix();
    }
    this.sunLight.target.name = 'sun-target';

    this.time = 0;
    this._shadowAnchor = new THREE.Vector3();
    this._solarAcc = 0;
  }

  get fogColor() {
    return this.uniforms.uHazeColor.value;
  }

  getAmbientColor() {
    return this.uniforms.uHorizonColor.value;
  }

  /** Re-tints the atmosphere (and the lights) for the active world map. */
  setBiome(biome) {
    const sky = biome?.sky;
    if (!sky) return;
    this.uniforms.uTopColor.value.set(sky.top);
    this.uniforms.uMidColor.value.set(sky.mid);
    this.uniforms.uHorizonColor.value.set(sky.horizon);
    this.uniforms.uHazeColor.value.set(sky.haze);
    this.uniforms.uSunColor.value.set(sky.sun);
    this.hemi.color.set(sky.hemiSky);
    this.hemi.groundColor.set(sky.hemiGround);
    this.sunLight.color.set(sky.sunColor);
    this.sunSprite.material.color.set(sky.sun);
  }

  update(dt, camera, focusPosition) {
    this.time += dt;
    this.group.position.copy(camera.position);

    this._solarAcc += dt;
    if (this._solarAcc >= 0.25 || this.time === dt) {
      this._solarAcc = 0;
      // Barely perceptible solar drift keeps the lighting alive without turning
      // a free-flight session into an unpredictable day/night cycle.
      const drift = Math.sin(this.time * 0.0035) * DEG * 1.3;
      const az = this.baseAzimuth + drift;
      const el = this.baseElevation + Math.sin(this.time * 0.0021 + 1.2) * DEG * 0.7;
      this.sunDir.set(
        Math.sin(az) * Math.cos(el),
        Math.sin(el),
        Math.cos(az) * Math.cos(el)
      ).normalize();
      this.uniforms.uSunDir.value.copy(this.sunDir);
      this.sunSprite.position.copy(this.sunDir).multiplyScalar(this.radius * 0.92);
    }

    if (focusPosition && focusPosition.distanceToSquared(this._shadowAnchor) > 16) {
      this.sunLight.position.copy(focusPosition).addScaledVector(this.sunDir, 1700);
      this.sunLight.target.position.copy(focusPosition);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.updateMatrixWorld();
      this._shadowAnchor.copy(focusPosition);
    }
  }

  getSunDirection() {
    return this.sunDir;
  }
}
