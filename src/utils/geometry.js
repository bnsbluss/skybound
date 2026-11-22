import * as THREE from 'three';

/**
 * Paints every vertex of a geometry with a flat colour. Used before merging
 * low-poly prop parts into a single material/draw call.
 */
/**
 * Returns a non-indexed copy (or the original if it is already flattened).
 * Merging requires every input geometry to agree on having an index attribute.
 */
export function flattenGeometry(geometry) {
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

export function paintGeometry(geometry, color) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = c.r;
    array[i * 3 + 1] = c.g;
    array[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

export function transformGeometry(geometry, position, rotation, scale) {
  const matrix = new THREE.Matrix4();
  const euler = new THREE.Euler(
    rotation?.x || 0,
    rotation?.y || 0,
    rotation?.z || 0
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scl = new THREE.Vector3(
    scale?.x ?? 1,
    scale?.y ?? 1,
    scale?.z ?? 1
  );
  matrix.compose(
    new THREE.Vector3(position?.x || 0, position?.y || 0, position?.z || 0),
    quat,
    scl
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** Adds soft vertical colour variation to an existing painted geometry. */
export function tintGeometryByHeight(geometry, lowColor, highColor, minY, maxY) {
  if (!geometry.attributes.color) return geometry;
  const color = geometry.attributes.color;
  const pos = geometry.attributes.position;
  const low = new THREE.Color(lowColor);
  const high = new THREE.Color(highColor);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - minY) / (maxY - minY), 0, 1);
    const c = low.clone().lerp(high, t);
    color.setXYZ(i, c.r, c.g, c.b);
  }
  color.needsUpdate = true;
  return geometry;
}

/** Ensures triangles face upward / away from the terrain centre. */
export function upwardWinding(a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const ny = abz * acx - abx * acz;
  return ny >= 0;
}
