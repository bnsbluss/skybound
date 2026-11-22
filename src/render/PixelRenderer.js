import * as THREE from 'three';

/**
 * Pixel-art presentation pass.
 *
 * The 3D scene is rendered into a small render target (screen size divided by
 * `pixelScale`) and then blown up to the full drawing buffer with nearest-neighbour
 * sampling, which produces the chunky pixels of a retro title. A final ordered
 * (Bayer 4x4) dither + optional colour quantisation runs in the upscale shader
 * so gradients break into the checkerboard texture seen in classic pixel art.
 *
 * The UI is plain DOM, so it stays razor sharp on top of the pixelated world.
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uLevels;
  uniform float uDither;
  varying vec2 vUv;

  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }

  float bayer4(vec2 a) {
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
  }

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float b = bayer4(gl_FragCoord.xy);
    if (uLevels > 1.0) {
      // Ordered-dithered quantisation: colours step in bands but the eye
      // reads the transition as a dither pattern instead of a hard edge.
      c = floor(c * uLevels + b) / uLevels;
    } else if (uDither > 0.5) {
      c = clamp(c + (b - 0.5) * 0.05, 0.0, 1.0);
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class PixelRenderer {
  constructor(renderer, quality = {}) {
    this.renderer = renderer;
    this.target = null;
    this._size = new THREE.Vector2();
    this._cssSize = new THREE.Vector2();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uLevels: { value: 0 },
        uDither: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.setQuality(quality);
  }

  setQuality(quality) {
    const scale = Number(quality.pixelScale ?? 1);
    this.scale = Math.max(1, Math.round(Number.isFinite(scale) ? scale : 1));
    this.minRenderWidth = Math.max(360, Number(quality.minRenderWidth) || 760);
    this.effectiveScale = this.scale;
    const levels = Number(quality.colorLevels ?? 0);
    this.levels = Math.max(0, Number.isFinite(levels) ? levels : 0);
    this.dither = quality.dither !== false && this.scale > 1;
    if (this.material) {
      this.material.uniforms.uLevels.value = this.levels;
      this.material.uniforms.uDither.value = this.dither ? 1 : 0;
    }
  }

  /**
   * Block size in CSS pixels, but clamped so the internal buffer never falls
   * below `minRenderWidth` — small phone screens would otherwise render at a
   * quarter of their width and look mushy.
   */
  _effectiveScale(cssW) {
    if (this.scale <= 1) return 1;
    if (!Number.isFinite(cssW) || cssW <= 0) return this.scale;
    const minW = this.minRenderWidth;
    const fit = cssW / minW;
    return Math.max(1, Math.min(this.scale, fit));
  }

  _ensureTarget() {
    this.renderer.getDrawingBufferSize(this._size);
    const bufferW = Math.max(1, this._size.x);
    const bufferH = Math.max(1, this._size.y);

    // Block size is defined in CSS pixels so the look (and the cost) matches
    // across DPR 1 desktops and DPR 3 phones.
    let width = bufferW;
    let height = bufferH;
    if (typeof this.renderer.getSize === 'function') {
      this.renderer.getSize(this._cssSize);
      width = this._cssSize.x || bufferW;
      height = this._cssSize.y || bufferH;
    }
    this.effectiveScale = this._effectiveScale(width);
    const targetW = Math.min(bufferW, Math.max(1, Math.round(width / this.effectiveScale)));
    const targetH = Math.min(bufferH, Math.max(1, Math.round(height / this.effectiveScale)));

    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(targetW, targetH, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      this.target.texture.colorSpace = THREE.SRGBColorSpace;
      this.target.texture.name = 'pixel-target';
      this.material.uniforms.tDiffuse.value = this.target.texture;
    } else if (this.target.width !== targetW || this.target.height !== targetH) {
      this.target.setSize(targetW, targetH);
    }
    return this.target;
  }

  /** Renders the scene through the pixel pipeline (or straight when scale is 1). */
  render(scene, camera) {
    let scale = this.scale;
    if (scale > 1 && typeof this.renderer.getSize === 'function') {
      this.renderer.getSize(this._cssSize);
      scale = this._effectiveScale(this._cssSize.x);
    }
    const direct =
      scale <= 1 ||
      !scene ||
      !camera ||
      typeof this.renderer.setRenderTarget !== 'function' ||
      typeof this.renderer.getDrawingBufferSize !== 'function';

    if (direct) {
      if (scale <= 1) this.effectiveScale = 1;
      this.renderer.render(scene, camera);
      return;
    }

    this._ensureTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  getStats() {
    return {
      scale: this.scale,
      effectiveScale: Number((this.effectiveScale ?? this.scale).toFixed(2)),
      levels: this.levels,
      dither: this.dither,
      width: this.target ? this.target.width : 0,
      height: this.target ? this.target.height : 0,
    };
  }

  dispose() {
    if (this.target) this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.target = null;
  }
}
