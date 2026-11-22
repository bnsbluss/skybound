import * as THREE from 'three';

const cache = new Map();

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** Soft white particle puff (colour is supplied by the particle shader). */
export function smokeTexture() {
  if (cache.has('smoke')) return cache.get('smoke');
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.03, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('smoke', tex);
  return tex;
}

/** Hot additive glow. */
export function glowTexture() {
  if (cache.has('glow')) return cache.get('glow');
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,240,205,0.95)');
  g.addColorStop(0.4, 'rgba(255,160,70,0.38)');
  g.addColorStop(0.75, 'rgba(255,100,30,0.08)');
  g.addColorStop(1, 'rgba(255,70,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('glow', tex);
  return tex;
}

/** Soft elliptical drop shadow used to ground the aircraft visually. */
export function shadowTexture() {
  if (cache.has('shadow')) return cache.get('shadow');
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,12,18,0.62)');
  g.addColorStop(0.5, 'rgba(0,12,18,0.35)');
  g.addColorStop(1, 'rgba(0,12,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('shadow', tex);
  return tex;
}
