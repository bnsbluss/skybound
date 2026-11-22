import * as THREE from 'three';

const ISLAND_COUNT = 10;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOffset;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vWaveH;
  varying float vViewDist;

  float waveHeight(vec2 p, float t) {
    float h = 0.0;
    h += sin(dot(p, vec2(0.0130, 0.0100)) + t * 0.42) * 1.35;
    h += sin(dot(p, vec2(-0.0290, 0.0250)) + t * 0.81) * 0.62;
    h += sin(dot(p, vec2(0.0520, -0.0410)) + t * 1.28) * 0.24;
    h += sin(dot(p, vec2(0.1100, 0.0710)) + t * 2.05) * 0.075;
    return h;
  }

  void main() {
    vec2 world = position.xz + uOffset;
    float h = waveHeight(world, uTime);
    float e = 2.0;
    float hx = waveHeight(world + vec2(e, 0.0), uTime) - waveHeight(world - vec2(e, 0.0), uTime);
    float hz = waveHeight(world + vec2(0.0, e), uTime) - waveHeight(world - vec2(0.0, e), uTime);

    vec3 wp = vec3(world.x, h, world.y);
    vWorldPos = wp;
    vWaveH = h;
    vNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));

    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vViewDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  #define ISLAND_COUNT ${ISLAND_COUNT}
  uniform float uTime;
  uniform vec3 uDeepColor;
  uniform vec3 uMidColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uFoamColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec4 uIslandA[ISLAND_COUNT]; // x, z, cos(rotation), sin(rotation)
  uniform vec4 uIslandB[ISLAND_COUNT]; // radiusX, radiusZ, coastRatio, seed

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vWaveH;
  varying float vViewDist;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm2(vec2 p) {
    float n = noise2(p) * 0.65;
    n += noise2(p * 2.07 + 11.3) * 0.35;
    return n;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec2 p = vWorldPos.xz;
    float dist = vViewDist;
    float t = uTime;

    // Fine wind ripples fade out with distance to keep the horizon clean.
    float detailFade = 1.0 - smoothstep(800.0, 5200.0, dist);
    vec2 ripple = vec2(
      sin(p.x * 0.34 + p.y * 0.08 + t * 2.2) + sin(p.x * 0.11 - p.y * 0.19 + t * 1.1),
      cos(p.y * 0.31 - t * 1.8) + cos(p.y * 0.14 + p.x * 0.17 - t * 1.35)
    ) * 0.018 * detailFade;
    N = normalize(N + vec3(ripple.x, 0.0, ripple.y));

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - clamp(dot(N, viewDir), 0.0, 1.0), 3.2);

    float waveT = smoothstep(-1.2, 1.6, vWaveH);
    vec3 water = mix(uDeepColor, uMidColor, 0.28 + waveT * 0.5);
    water = mix(water, uSkyColor, clamp(fresnel * 0.6 + 0.08, 0.0, 0.72));

    // Whitecaps on the tallest crests.
    float crestNoise = fbm2(p * 0.032 + vec2(t * 0.045, -t * 0.031));
    float crest = smoothstep(0.98, 1.75, vWaveH + crestNoise * 0.9 - 0.2);
    water = mix(water, uFoamColor, crest * 0.28 * detailFade);

    // ---------------------------------------------------------------------
    // Lagoon tint + animated surf around every major island.
    // ---------------------------------------------------------------------
    float shallowMask = 0.0;
    float foamMask = 0.0;
    float surfLine = 0.0;
    for (int i = 0; i < ISLAND_COUNT; i++) {
      vec4 A = uIslandA[i];
      vec4 B = uIslandB[i];
      vec2 delta = p - A.xy;
      // Inverse island rotation.
      vec2 lp = vec2(delta.x * A.z - delta.y * A.w, delta.x * A.w + delta.y * A.z);
      if (B.x < 1.0) continue;
      vec2 rp = vec2(lp.x / B.x, lp.y / B.y);
      float q = length(rp);
      if (q > 1.28) continue;
      float coast = B.z;
      float angle = atan(lp.y, lp.x);

      // Irregular, breathing coastline.
      float coastWobble =
        sin(angle * 17.0 + B.w * 3.1) * 0.010 +
        sin(angle * 7.0 - B.w * 1.7 + t * 0.23) * 0.006;
      float shore = coast + coastWobble;

      float lagoon = 1.0 - smoothstep(shore - 0.015, shore + 0.34, q);
      shallowMask = max(shallowMask, lagoon);

      float band = abs(q - shore);
      float foam = 1.0 - smoothstep(0.001, 0.034, band);
      foam *= 0.55 + 0.45 * sin(angle * 43.0 + t * 2.2 + B.w * 9.0);
      foam = clamp(foam, 0.0, 1.0);
      foamMask = max(foamMask, foam);

      float surf = abs(q - (shore + 0.036 + 0.008 * sin(t * 0.9 + angle * 5.0)));
      surfLine = max(surfLine, (1.0 - smoothstep(0.0, 0.012, surf)) * 0.55);
    }

    vec3 lagoonColor = mix(uShallowColor, uFoamColor, 0.06);
    water = mix(water, lagoonColor, shallowMask * 0.52);
    water = mix(water, uFoamColor, (foamMask * 0.82 + surfLine * 0.32) * clamp(1.0 - dist / 9000.0, 0.0, 1.0));

    // ---------------------------------------------------------------------
    // Sunlight.
    // ---------------------------------------------------------------------
    vec3 H = normalize(uSunDir + viewDir);
    float ndh = max(dot(N, H), 0.0);
    float spec = pow(ndh, 420.0) * 2.8;
    float broadGlint = pow(ndh, 42.0) * 0.36;
    float horizonGlitter = pow(max(dot(reflect(-uSunDir, N), viewDir), 0.0), 90.0) * 0.35;
    water += uSunColor * (spec + broadGlint + horizonGlitter) * (0.55 + waveT * 0.45);

    // Sky light at glancing angles gives the water its turquoise edge.
    water += uSkyColor * pow(1.0 - clamp(N.y, 0.0, 1.0), 2.0) * 0.35;

    // Distance fog matched to the sky haze.
    float fogFactor = smoothstep(uFogNear, uFogFar, dist);
    water = mix(water, uFogColor, fogFactor);

    // Aerial perspective warms the far water slightly.
    float haze = smoothstep(uFogNear * 1.4, uFogFar, dist);
    water = mix(water, uFogColor * 1.02, haze * 0.16);

    gl_FragColor = vec4(water, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Ocean {
  constructor(quality) {
    this.quality = quality;
    this.time = 0;
    this.offset = new THREE.Vector2();
    this.geometry = new THREE.PlaneGeometry(
      quality.oceanSize ?? 24000,
      quality.oceanSize ?? 24000,
      quality.oceanSegments ?? 200,
      quality.oceanSegments ?? 200
    );
    this.geometry.rotateX(-Math.PI / 2);

    const emptyA = Array.from({ length: ISLAND_COUNT }, () => new THREE.Vector4(999999, 999999, 1, 0));
    const emptyB = Array.from({ length: ISLAND_COUNT }, () => new THREE.Vector4(0, 0, 0, 0));

    this.uniforms = {
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector2() },
      uDeepColor: { value: new THREE.Color(0x0a6987) },
      uMidColor: { value: new THREE.Color(0x1ea7ae) },
      uShallowColor: { value: new THREE.Color(0x58e5cf) },
      uSkyColor: { value: new THREE.Color(0x8ad9ee) },
      uFoamColor: { value: new THREE.Color(0xf4fffa) },
      uSunColor: { value: new THREE.Color(0xfff2c9) },
      uSunDir: { value: new THREE.Vector3(-0.56, 0.52, -0.45).normalize() },
      uFogColor: { value: new THREE.Color(0xc7e9ee) },
      uFogNear: { value: 1300 },
      uFogFar: { value: 11000 },
      uIslandA: { value: emptyA },
      uIslandB: { value: emptyB },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.FrontSide,
      fog: false,
      toneMapped: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = -10;
  }

  setIslands(islands) {
    const majors = islands
      .filter((i) => i.def.major)
      .sort((a, b) => b.coastRadius - a.coastRadius)
      .slice(0, ISLAND_COUNT);

    const A = this.uniforms.uIslandA.value;
    const B = this.uniforms.uIslandB.value;
    for (let i = 0; i < ISLAND_COUNT; i++) {
      const island = majors[i];
      if (!island) {
        A[i].set(999999, 999999, 1, 0);
        B[i].set(0, 0, 0, 0);
        continue;
      }
      const def = island.def;
      const cos = Math.cos(def.rotation);
      const sin = Math.sin(def.rotation);
      A[i].set(def.x, def.z, cos, sin);
      B[i].set(
        def.radius * def.elongation,
        def.radius,
        island.coastRatio,
        (def.seed % 997) / 97
      );
    }
  }

  setSun(direction, color) {
    this.uniforms.uSunDir.value.copy(direction);
    if (color) this.uniforms.uSunColor.value.copy(color);
  }

  setFog(color, near, far) {
    this.uniforms.uFogColor.value.copy(color);
    this.uniforms.uFogNear.value = near;
    this.uniforms.uFogFar.value = far;
  }

  /** Re-tints the water for the active world map. */
  setBiome(biome) {
    const ocean = biome?.ocean;
    if (!ocean) return;
    this.uniforms.uDeepColor.value.set(ocean.deep);
    this.uniforms.uMidColor.value.set(ocean.mid);
    this.uniforms.uShallowColor.value.set(ocean.shallow);
    this.uniforms.uSkyColor.value.set(ocean.sky);
    this.uniforms.uFoamColor.value.set(ocean.foam);
  }

  update(dt, camera) {
    this.time += dt;
    // Snap the ocean sheet to a coarse grid so vertices do not shimmer as the
    // camera moves. The waves themselves are evaluated in world space.
    const snap = 64;
    this.offset.set(
      Math.round(camera.position.x / snap) * snap,
      Math.round(camera.position.z / snap) * snap
    );
    this.uniforms.uTime.value = this.time;
    this.uniforms.uOffset.value.copy(this.offset);
  }

  getWaveHeightAt(x, z) {
    // Mirrors the dominant shader swell for gameplay/camera purposes.
    const p = x * 0.013 + z * 0.01;
    const p2 = x * -0.029 + z * 0.025;
    return Math.sin(p + this.time * 0.42) * 1.35 + Math.sin(p2 + this.time * 0.81) * 0.62;
  }
}
