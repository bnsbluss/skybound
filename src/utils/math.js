/**
 * Small, dependency-free math helpers shared across the simulator.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, value) {
  return (value - a) / (b - a);
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampAngle(current, target, lambda, dt) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

export function degToRad(deg) {
  return deg * DEG;
}

export function radToDeg(rad) {
  return rad * RAD;
}

export function pad(value, length = 2) {
  return String(Math.round(Math.abs(value))).padStart(length, '0');
}

export function formatSigned(value, length = 3) {
  const sign = value < 0 ? '-' : '+';
  return sign + String(Math.abs(Math.round(value))).padStart(length, '0');
}

export function moveTowards(a, b, amount) {
  if (Math.abs(b - a) <= amount) return b;
  return a + Math.sign(b - a) * amount;
}

/** Bilinear interpolation of a scalar field. */
export function bilinear(values, width, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = y0 * width + x0;
  const a = lerp(values[i00], values[i00 + 1], tx);
  const b = lerp(values[i00 + width], values[i00 + width + 1], tx);
  return lerp(a, b, ty);
}

export function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function formatClock(date = new Date()) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes()
  ).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
}

export function shortestAngle(from, to) {
  return wrapAngle(to - from);
}
