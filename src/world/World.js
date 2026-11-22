import * as THREE from 'three';
import { Sky } from './Sky.js';
import { Ocean } from './Ocean.js';
import { IslandField } from './IslandField.js';
import { Clouds } from './Clouds.js';
import { BIOMES } from './Biomes.js';

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
  'aoMap',
  'lightMap',
];

/**
 * One complete map: sky, lighting, terrain, props, clouds and — for the coral
 * map only — the ocean. Land maps (city / desert / mountain) hide the ocean
 * and lay a huge ground sheet under the mainland so no water is ever visible.
 */
export class World {
  constructor(quality, biome = BIOMES.coral) {
    this.quality = quality;
    this.biome = biome;
    this.land = !!biome.land;
    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.time = 0;

    this.sky = new Sky(quality);
    this.sky.setBiome(biome);
    this.scene.add(this.sky.group);
    this.scene.add(this.sky.hemi);
    this.scene.add(this.sky.sunLight);
    this.scene.add(this.sky.sunLight.target);

    this.ocean = new Ocean(quality);
    this.ocean.setBiome(biome);
    this.ocean.mesh.visible = !this.land;
    this.scene.add(this.ocean.mesh);

    // A single enormous ground sheet fills the horizon on land maps. It sits
    // just under sea level so the analytic terrain edge disappears below it.
    this.ground = null;
    if (this.land) {
      const size = Math.max(80000, (quality.oceanSize ?? 24000) * 3);
      const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshLambertMaterial({
        color: biome.groundColor ?? 0x6d7a4f,
        flatShading: true,
      });
      this.ground = new THREE.Mesh(geometry, material);
      this.ground.name = 'land-plane';
      this.ground.position.y = -0.8;
      this.ground.receiveShadow = false;
      this.scene.add(this.ground);
    }

    this.islands = new IslandField(quality, biome);
    this.scene.add(this.islands.group);

    this.clouds = new Clouds(quality);
    this.scene.add(this.clouds.group);

    this.scene.fog = new THREE.Fog(
      this.sky.fogColor.getHex(),
      quality.fogNear ?? 1500,
      quality.fogFar ?? 11000
    );
    if (!this.land) {
      this.ocean.setFog(this.sky.fogColor, quality.fogNear ?? 1500, quality.fogFar ?? 11000);
      this.ocean.setIslands(this.islands.islands);
    }

    this._focus = new THREE.Vector3();
  }

  /** Human-readable map name for the loading screen / HUD. */
  get mapLabel() {
    return this.biome?.label ?? 'CORAL';
  }

  /**
   * Playable combat zone boundary radii (metres from origin).
   * Crossing `warnRadius` triggers a HUD warning; reaching `maxRadius` steers
   * the aircraft back into the combat zone so nobody can fly out of the map.
   */
  getMapBounds() {
    const id = this.biome?.id ?? 'coral';
    if (id === 'mountain') return { warnRadius: 10600, maxRadius: 12000 };
    if (id === 'desert') return { warnRadius: 10200, maxRadius: 11500 };
    if (id === 'city') return { warnRadius: 9200, maxRadius: 10500 };
    return { warnRadius: 7200, maxRadius: 8500 };
  }

  async build(onProgress = () => {}) {
    onProgress(0.04, this.land ? 'SHAPING MAINLAND' : 'FORMING OCEAN');
    if (!this.land) this.ocean.setIslands(this.islands.islands);
    await this.islands.build(onProgress);
    onProgress(0.98, 'CALIBRATING ATMOSPHERE');
    await new Promise((resolve) => setTimeout(resolve, 30));
    onProgress(1, 'READY FOR LAUNCH');
  }

  update(dt, camera, focusPosition) {
    this.time += dt;
    this._focus.copy(focusPosition || camera.position);
    this.sky.update(dt, camera, this._focus);
    if (!this.land) {
      this.ocean.update(dt, camera);
      this.ocean.setSun(this.sky.getSunDirection(), this.sky.uniforms.uSunColor.value);
    }
    this.clouds.update(dt);
    this.islands.update(camera, dt, this._focus);

    // Keep the scene fog colour locked to the sky at the horizon.
    if (this.scene.fog) {
      this.scene.fog.color.copy(this.sky.fogColor);
    }
  }

  /** Terrain height at sea level (0) or above. */
  getHeightAt(x, z) {
    return this.islands.getHeightAt(x, z);
  }

  /** Wave height: always flat ground on land maps. */
  getWaveHeightAt(x, z) {
    if (this.land) return 0;
    return this.ocean.getWaveHeightAt(x, z);
  }

  /** Height including the animated swell — used by the chase camera. */
  getSurfaceHeightAt(x, z) {
    const terrain = this.islands.getHeightAt(x, z);
    if (this.land) return Math.max(0, terrain);
    return Math.max(terrain, this.ocean.getWaveHeightAt(x, z) + 0.4);
  }

  getAGL(x, y, z) {
    return y - Math.max(0, this.islands.getHeightAt(x, z));
  }

  getIslandAt(x, z) {
    return this.islands.getIslandAt(x, z);
  }

  getRadarContacts(x, z, range) {
    // A mainland fills the whole scope: there is no coastline contact to plot,
    // so land radars show only aircraft.
    if (this.land) return [];
    return this.islands.getRadarContacts(x, z, range);
  }

  getSunDirection() {
    return this.sky.getSunDirection();
  }

  getStats() {
    return {
      islands: this.islands.islands.length,
      land: this.land,
      trees: this.islands.stats.trees,
      structures: this.islands.stats.structures,
      rocks: this.islands.stats.rocks,
      traffic: this.islands.city?.stats.cars ?? 0,
      bridges: this.islands.city?.stats.bridges ?? 0,
      cloudPuffs: this.clouds.puffs.length,
      islandTriangles: Math.round(this.islands.stats.triangles),
    };
  }

  /** Drops every GPU resource owned by this world (geometry, maps, materials). */
  dispose() {
    this.islands.dispose();
    const geometries = new Set();
    const materials = new Set();
    this.scene.traverse((node) => {
      if (node === this.islands.group) return;
      if (node.geometry) geometries.add(node.geometry);
      if (Array.isArray(node.material)) {
        for (const material of node.material) materials.add(material);
      } else if (node.material) {
        materials.add(node.material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      for (const slot of TEXTURE_SLOTS) material[slot]?.dispose?.();
      material.dispose();
    }
    this.sky?.sunLight?.shadow?.dispose?.();
    this.scene.clear();
    this.scene.environment = null;
  }
}
