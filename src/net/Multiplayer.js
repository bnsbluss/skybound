import * as THREE from 'three';
import { Aircraft } from '../aircraft/Aircraft.js';
import { getAircraft } from '../aircraft/AircraftCatalog.js';
import { clamp, damp } from '../utils/math.js';

const ROOM_STORAGE_KEY = 'skybound.mp.rooms';
const ROOM_TTL_MS = 16000;

export const VERSUS_SCORE_LIMIT = 20;
export const TEAM_SCORE_LIMIT = 40;
export const TEAM_MATCH_DURATION = 600; // 10 minutes
export const TEAM_MAX_SIZE = 3; // 3 vs 3
const VALID_MODES = ['coop', 'versus', 'team'];

/**
 * In-memory message bus & room directory so multiple MultiplayerManager
 * instances in the same JS runtime (or automated tests) can discover rooms
 * and exchange packets by room code immediately.
 */
export const LOCAL_ROOM_HUB = {
  rooms: new Map(),
  directory: new Map(),
  directoryListeners: new Set(),
  subscribe(code, id, handler) {
    const key = normalizeRoomCode(code);
    if (!this.rooms.has(key)) this.rooms.set(key, new Map());
    this.rooms.get(key).set(id, handler);
  },
  unsubscribe(code, id) {
    const key = normalizeRoomCode(code);
    const room = this.rooms.get(key);
    if (!room) return;
    room.delete(id);
    if (room.size === 0) this.rooms.delete(key);
  },
  publish(code, senderId, packet) {
    const key = normalizeRoomCode(code);
    const room = this.rooms.get(key);
    if (!room) return;
    for (const [peerId, handler] of room.entries()) {
      if (peerId !== senderId) {
        handler(packet);
      }
    }
  },
  announceRoom(info) {
    const key = normalizeRoomCode(info?.roomCode);
    if (!key) return;
    this.directory.set(key, { ...info, roomCode: key, updatedAt: Date.now() });
    for (const fn of this.directoryListeners) fn();
  },
  removeRoom(code) {
    const key = normalizeRoomCode(code);
    if (!key) return;
    if (this.directory.delete(key)) {
      for (const fn of this.directoryListeners) fn();
    }
  },
  listRooms() {
    const now = Date.now();
    const out = [];
    for (const [key, entry] of this.directory.entries()) {
      if (now - (entry.updatedAt || 0) > ROOM_TTL_MS) {
        this.directory.delete(key);
      } else {
        out.push(entry);
      }
    }
    return out;
  },
};

const PEERJS_URLS = [
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
];

let peerJsLoadPromise = null;

/**
 * Dynamically loads PeerJS in the browser when hosted on GitHub Pages / HTTP(S)
 * so static deployments get full internet WebRTC P2P without a custom backend.
 */
function loadPeerJS() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerJsLoadPromise) return peerJsLoadPromise;

  // Skip external script loading inside JSDOM unit tests.
  if (navigator.userAgent?.includes('jsdom')) {
    return Promise.resolve(null);
  }

  peerJsLoadPromise = new Promise((resolve) => {
    let index = 0;
    const tryNext = () => {
      if (window.Peer) {
        resolve(window.Peer);
        return;
      }
      if (index >= PEERJS_URLS.length) {
        resolve(null);
        return;
      }
      const script = document.createElement('script');
      script.src = PEERJS_URLS[index++];
      script.async = true;
      script.onload = () => resolve(window.Peer || null);
      script.onerror = () => tryNext();
      document.head?.appendChild(script);
    };
    tryNext();
  });
  return peerJsLoadPromise;
}

export function normalizeRoomCode(code = '') {
  return String(code)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'SKY';
  for (let i = 0; i < 3; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function peerBrokerId(roomCode) {
  return `skybound-v21-room-${normalizeRoomCode(roomCode).toLowerCase()}`;
}

/**
 * Manages a remote player's 3D aircraft replica, dead-reckoning interpolation,
 * and combat target proxy in the active Three.js scene.
 */
class RemotePilot {
  constructor(id, quality, scene, info = {}) {
    this.id = id;
    this.quality = quality;
    this.scene = scene;
    this.callsign = info.callsign || `PILOT-${id.slice(-3).toUpperCase()}`;
    this.aircraftId = info.aircraftId || 'wraith';
    this.mode = info.mode || 'coop';
    this.team = info.team === 'red' ? 'red' : 'blue';
    this.alive = info.alive !== false;
    this.crashed = !this.alive;
    this.paused = !!info.paused;
    this.ready = !!info.ready;
    this.pvpScore = info.pvpScore ?? 0;
    this.hull = info.hull ?? 100;
    this.hullMax = info.hullMax ?? 100;
    this.score = info.score ?? 0;
    this.kills = info.kills ?? 0;
    this.lastSeen = 0;

    this.position = new THREE.Vector3(0, 520, 1500);
    this.targetPosition = new THREE.Vector3(0, 520, 1500);
    this.velocity = new THREE.Vector3(0, 0, -180);
    this.quaternion = new THREE.Quaternion();
    this.targetQuaternion = new THREE.Quaternion();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.speed = 180;
    this.throttle = 0.68;
    this.afterburner = 0;
    this.boosting = false;
    this.stalling = false;
    this.heading = 0;
    this.input = { pitch: 0, roll: 0, yaw: 0 };

    const craft = getAircraft(this.aircraftId);
    // Remote aircraft disable their engine PointLight so adding/removing peers
    // never mutates scene light count or poisons scene lighting.
    this.aircraft = new Aircraft(quality, craft, { enableLight: false });
    this.aircraft.root.name = `remote-aircraft-${id}`;
    this.scene.add(this.aircraft.root);
    this.scene.add(this.aircraft.shadow);

    // Combat proxy compatible with Weapons.js and Enemies.js target pickers.
    this.targetProxy = {
      id: this.id,
      isPlayer: true,
      remotePilot: this,
      name: this.callsign,
      enemy: true,
      alive: true,
      health: this.hull,
      maxHealth: this.hullMax,
      radius: 9.5,
      position: this.position,
      velocity: this.velocity,
      direction: this.direction,
      quaternion: this.quaternion,
      speed: this.speed,
    };
  }

  setVariant(aircraftId) {
    if (!aircraftId || aircraftId === this.aircraftId) return;
    this.aircraftId = aircraftId;
    this.aircraft.setVariant(getAircraft(aircraftId));
  }

  applyState(pkt, now) {
    this.lastSeen = now;
    if (pkt.callsign) {
      this.callsign = String(pkt.callsign).slice(0, 14);
      this.targetProxy.name = this.callsign;
    }
    if (pkt.aircraftId) this.setVariant(pkt.aircraftId);
    if (pkt.team === 'blue' || pkt.team === 'red') this.team = pkt.team;
    if (Array.isArray(pkt.p) && pkt.p.length === 3) {
      this.targetPosition.set(pkt.p[0], pkt.p[1], pkt.p[2]);
      if (this.position.distanceToSquared(this.targetPosition) > 900 * 900) {
        this.position.copy(this.targetPosition);
      }
    }
    if (Array.isArray(pkt.v) && pkt.v.length === 3) {
      this.velocity.set(pkt.v[0], pkt.v[1], pkt.v[2]);
    }
    if (Array.isArray(pkt.q) && pkt.q.length === 4) {
      this.targetQuaternion.set(pkt.q[0], pkt.q[1], pkt.q[2], pkt.q[3]).normalize();
    }
    if (Number.isFinite(pkt.spd)) this.speed = pkt.spd;
    if (Number.isFinite(pkt.thr)) this.throttle = clamp(pkt.thr, 0, 1);
    if (Number.isFinite(pkt.hull)) this.hull = pkt.hull;
    if (Number.isFinite(pkt.hullMax)) this.hullMax = pkt.hullMax;
    if (Number.isFinite(pkt.ab)) this.afterburner = clamp(pkt.ab, 0, 1);
    this.boosting = !!pkt.boost;
    this.alive = pkt.alive !== false;
    this.crashed = !this.alive;
    this.paused = !!pkt.paused;
    if (pkt.in) {
      this.input.pitch = pkt.in[0] || 0;
      this.input.roll = pkt.in[1] || 0;
      this.input.yaw = pkt.in[2] || 0;
    }
    if (Number.isFinite(pkt.kills)) this.kills = pkt.kills;
    if (Number.isFinite(pkt.score)) this.score = pkt.score;

    this.targetProxy.alive = this.alive;
    this.targetProxy.health = this.hull;
    this.targetProxy.maxHealth = this.hullMax;
    this.targetProxy.speed = this.speed;
  }

  update(dt, time, world) {
    // Dead-reckon along velocity, then blend smoothly toward target state.
    this.position.addScaledVector(this.velocity, dt);
    const alpha = 1 - Math.exp(-12 * dt);
    this.position.lerp(this.targetPosition, alpha);
    this.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-14 * dt));
    this.direction.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    this.heading = Math.atan2(this.direction.x, -this.direction.z);

    this.targetProxy.alive = this.alive;
    this.targetProxy.speed = this.speed;

    this.aircraft.setVisible(this.alive);
    if (this.alive && world) {
      this.aircraft.updateVisual(dt, this, this.input, time, world);
    }
  }

  reattach(scene) {
    this.scene = scene;
    scene.add(this.aircraft.root);
    scene.add(this.aircraft.shadow);
  }

  dispose() {
    this.aircraft.root.removeFromParent();
    this.aircraft.shadow.removeFromParent();
  }
}

/**
 * Room-Code Online Multiplayer controller supporting two modes:
 *  - 'coop'  : Co-Op Squadron vs AI Bandits (shared sector, allied radar, squad kills)
 *  - 'versus': Versus PvP Dogfight (All Mode: player vs player with optional AI bandits)
 *
 * Works on static hosting / GitHub Pages (github.io) via PeerJS WebRTC P2P,
 * plus BroadcastChannel for local multi-tab testing and LOCAL_ROOM_HUB for tests.
 */
export class MultiplayerManager {
  constructor(options = {}) {
    this.quality = options.quality;
    this.scene = options.scene;
    this.callbacks = options.callbacks || {};

    this.localId = `p-${Math.random().toString(36).slice(2, 9)}`;
    this.profileSet = this._hasSavedProfile();
    this.callsign = this._loadCallsign();
    this.localAircraftId = getAircraft(options.aircraftId || 'wraith').id;
    this.localTeam = 'blue';
    this.active = false;
    this.isHost = false;
    this.hostId = null;
    this.roomCode = '';
    this.mode = 'coop'; // 'coop' | 'versus' | 'team'
    this.allowBandits = false; // Only Co-Op spawns AI bandits; Versus & Team 3v3 are pure PvP
    this.mapId = 'coral';
    this.localReady = false;
    this.matchStarted = false;
    this.matchEnded = false;
    this.matchResult = null;
    this.matchDuration = TEAM_MATCH_DURATION;
    this.matchRemaining = TEAM_MATCH_DURATION;
    this.status = 'OFFLINE';
    this.transport = 'none';

    this.peers = new Map(); // peerId -> RemotePilot
    this.squadKills = 0;
    this.pvpScores = new Map(); // pilotId -> PvP kill score
    this.teamScores = { blue: 0, red: 0 };

    this._bc = null;
    this._lobbyBc = null;
    this._discoveredRooms = new Map(); // roomCode -> room listing
    this._announceTimer = null;
    this._peer = null;
    this._conns = new Map(); // peerId -> PeerJS DataConnection
    this._connPeerIds = new Map(); // conn.peer -> remote pilotId
    this._hostConn = null;
    this._sendAcc = 0;
    this._time = 0;
    this._msgSeq = 0;
    this._seenMsgIds = new Set();

    this._onHubDirectoryChange = () => this._notifyRoomList();
    LOCAL_ROOM_HUB.directoryListeners.add(this._onHubDirectoryChange);
    this._initLobbyDiscovery();
  }

  _hasSavedProfile() {
    try {
      const flag = window.localStorage?.getItem('skybound.profileSet') === '1';
      const saved = window.localStorage?.getItem('skybound.callsign');
      return !!(flag && saved && saved.trim().length >= 2);
    } catch {
      return false;
    }
  }

  hasProfile() {
    return !!this.profileSet;
  }

  _loadCallsign() {
    try {
      const saved = window.localStorage?.getItem('skybound.callsign');
      if (saved && saved.trim()) return saved.trim().toUpperCase().slice(0, 12);
    } catch {
      /* ignore */
    }
    return `ACE-${Math.floor(10 + Math.random() * 89)}`;
  }

  setCallsign(name) {
    const clean = String(name || '')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 12);
    if (!clean) return this.callsign;
    this.callsign = clean;
    this.profileSet = true;
    try {
      window.localStorage?.setItem('skybound.callsign', this.callsign);
      window.localStorage?.setItem('skybound.profileSet', '1');
    } catch {
      /* ignore */
    }
    return this.callsign;
  }

  isPvpMode() {
    return this.mode === 'versus' || this.mode === 'team';
  }

  setMode(mode) {
    if (VALID_MODES.includes(mode)) {
      this.mode = mode;
      // Versus and Team 3v3 are strictly pure PvP (no AI/NPC bandits).
      this.allowBandits = mode === 'coop';
      if (mode === 'team') {
        this._ensureBalancedTeams();
      }
      if (this.active && this.isHost) {
        this._broadcastRoomConfig();
        this._announceRoom();
      }
      this._notifyStatus();
    }
  }

  setAllowBandits(allow) {
    // Only Co-Op allows AI bandits; Versus & Team 3v3 always disable NPCs.
    this.allowBandits = this.mode === 'coop' ? !!allow : false;
    if (this.active && this.isHost) {
      this._broadcastRoomConfig();
      this._announceRoom();
    }
    this._notifyStatus();
  }

  /** Selects the local pilot's team ('blue' | 'red') for Team 3 vs 3 mode. */
  setTeam(team) {
    if (team !== 'blue' && team !== 'red') return false;
    if (team === this.localTeam) return true;
    let count = 0;
    for (const pilot of this.peers.values()) {
      if (pilot.team === team) count += 1;
    }
    if (count >= TEAM_MAX_SIZE) return false;
    this.localTeam = team;
    if (this.active) {
      this._sendPacket({
        type: 'team',
        callsign: this.callsign,
        team: this.localTeam,
      });
      if (this.isHost) this._broadcastRoomConfig();
    }
    this._notifyStatus();
    return true;
  }

  _pickBalancedTeam() {
    let blue = this.localTeam === 'blue' ? 1 : 0;
    let red = this.localTeam === 'red' ? 1 : 0;
    for (const pilot of this.peers.values()) {
      if (pilot.team === 'red') red += 1;
      else blue += 1;
    }
    if (blue <= red && blue < TEAM_MAX_SIZE) return 'blue';
    if (red < TEAM_MAX_SIZE) return 'red';
    return 'blue';
  }

  _ensureBalancedTeams() {
    let blue = this.localTeam === 'blue' ? 1 : 0;
    let red = this.localTeam === 'red' ? 1 : 0;
    for (const pilot of this.peers.values()) {
      if (pilot.team === 'red') {
        if (red >= TEAM_MAX_SIZE && blue < TEAM_MAX_SIZE) {
          pilot.team = 'blue';
          blue += 1;
        } else {
          red += 1;
        }
      } else if (blue >= TEAM_MAX_SIZE && red < TEAM_MAX_SIZE) {
        pilot.team = 'red';
        red += 1;
      } else {
        blue += 1;
      }
    }
  }

  resetMatchState() {
    this.pvpScores.clear();
    this.pvpScores.set(this.localId, 0);
    for (const pilot of this.peers.values()) {
      pilot.pvpScore = 0;
      this.pvpScores.set(pilot.id, 0);
    }
    this.teamScores = { blue: 0, red: 0 };
    this.matchDuration = TEAM_MATCH_DURATION;
    this.matchRemaining = TEAM_MATCH_DURATION;
    this.matchEnded = false;
    this.matchResult = null;
  }

  /** Updates the active room map and broadcasts it to all guests when hosting. */
  setMap(mapId) {
    if (!mapId) return;
    this.mapId = mapId;
    if (this.active && this.isHost) {
      this._broadcastRoomConfig();
      this._announceRoom();
    }
    this._notifyStatus();
  }

  /** Updates the local pilot's chosen airframe and syncs it to the room roster. */
  setAircraftId(aircraftId) {
    const craft = getAircraft(aircraftId);
    this.localAircraftId = craft.id;
    if (this.active) {
      this._sendPacket({
        type: 'aircraft',
        callsign: this.callsign,
        aircraftId: this.localAircraftId,
      });
      if (this.isHost) this._broadcastRoomConfig();
    }
    this._notifyStatus();
    return this.localAircraftId;
  }

  /**
   * Toggles or sets Guest READY state in the room lobby.
   * When the Host has already started the match, pressing READY lets the guest
   * enter the active sortie immediately.
   */
  setReady(ready) {
    if (!this.active) return false;
    if (this.isHost) {
      this.localReady = true;
      this._notifyStatus();
      return true;
    }
    this.localReady = !!ready;
    this._sendPacket({
      type: 'ready',
      callsign: this.callsign,
      aircraftId: this.localAircraftId,
      ready: this.localReady,
    });
    this._notifyStatus();
    if (this.localReady && this.matchStarted) {
      this.callbacks.onRoomStartMatch?.({
        mapId: this.mapId,
        mode: this.mode,
        allowBandits: this.allowBandits,
        localReady: true,
      });
    }
    return this.localReady;
  }

  toggleReady() {
    return this.setReady(!this.localReady);
  }

  /**
   * Host-only trigger to start the multiplayer match for the entire room.
   * Resets match scores & timer and notifies READY guests to deploy.
   */
  startMatch() {
    if (!this.active || !this.isHost) return false;
    this.resetMatchState();
    this.matchStarted = true;
    this.localReady = true;
    this._sendPacket({
      type: 'start-match',
      callsign: this.callsign,
      aircraftId: this.localAircraftId,
      team: this.localTeam,
      mode: this.mode,
      mapId: this.mapId,
      allowBandits: this.shouldSpawnBandits(),
      squadKills: this.squadKills,
      teamScores: { ...this.teamScores },
      pvpScores: Object.fromEntries(this.pvpScores),
      matchRemaining: this.matchRemaining,
      peersTeam: this._collectPeersTeam(),
    });
    this._announceRoom();
    this._notifyStatus();
    return true;
  }

  /** Initializes multi-tab + localStorage room discovery for the Room List menu. */
  _initLobbyDiscovery() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this._lobbyBc = new BroadcastChannel('skybound-v21-lobby');
        this._lobbyBc.onmessage = (event) => {
          const msg = event?.data;
          if (!msg || msg.senderId === this.localId) return;
          if (msg.type === 'room-announce' && msg.room?.roomCode) {
            const code = normalizeRoomCode(msg.room.roomCode);
            this._discoveredRooms.set(code, { ...msg.room, roomCode: code, updatedAt: Date.now() });
            this._notifyRoomList();
          } else if (msg.type === 'room-close' && msg.roomCode) {
            const code = normalizeRoomCode(msg.roomCode);
            this._discoveredRooms.delete(code);
            this._notifyRoomList();
          } else if (msg.type === 'room-discover') {
            if (this.active && this.isHost) this._announceRoom();
          }
        };
      } catch {
        this._lobbyBc = null;
      }
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const cleanupOnExit = () => {
        if (this.active) {
          this.leaveRoom(true);
        }
      };
      window.addEventListener('beforeunload', cleanupOnExit);
      window.addEventListener('pagehide', cleanupOnExit);
    }
  }

  _readStorageRooms() {
    try {
      const raw = window.localStorage?.getItem(ROOM_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  _writeStorageRooms(mapObj) {
    try {
      window.localStorage?.setItem(ROOM_STORAGE_KEY, JSON.stringify(mapObj));
    } catch {
      /* ignore */
    }
  }

  _announceRoom() {
    if (!this.active || !this.isHost || !this.roomCode) return;
    const entry = {
      roomCode: this.roomCode,
      hostId: this.localId,
      hostCallsign: this.callsign,
      mode: this.mode,
      mapId: this.mapId,
      allowBandits: this.allowBandits,
      totalPilots: this.peers.size + 1,
      matchStarted: this.matchStarted,
      updatedAt: Date.now(),
    };
    LOCAL_ROOM_HUB.announceRoom(entry);
    const stored = this._readStorageRooms();
    stored[this.roomCode] = entry;
    // Prune stale entries while writing.
    const now = Date.now();
    for (const key of Object.keys(stored)) {
      if (now - (stored[key]?.updatedAt || 0) > ROOM_TTL_MS) {
        delete stored[key];
      }
    }
    this._writeStorageRooms(stored);
    if (this._lobbyBc) {
      try {
        this._lobbyBc.postMessage({
          type: 'room-announce',
          senderId: this.localId,
          room: entry,
        });
      } catch {
        /* ignore */
      }
    }
  }

  _removeRoomAnnouncement(code) {
    const clean = normalizeRoomCode(code);
    if (!clean) return;
    LOCAL_ROOM_HUB.removeRoom(clean);
    const stored = this._readStorageRooms();
    if (stored[clean]) {
      delete stored[clean];
      this._writeStorageRooms(stored);
    }
    if (this._lobbyBc) {
      try {
        this._lobbyBc.postMessage({
          type: 'room-close',
          senderId: this.localId,
          roomCode: clean,
        });
      } catch {
        /* ignore */
      }
    }
  }

  /** Requests active hosts to re-announce and returns the current room list. */
  refreshRoomList() {
    if (this._lobbyBc) {
      try {
        this._lobbyBc.postMessage({ type: 'room-discover', senderId: this.localId });
      } catch {
        /* ignore */
      }
    }
    const list = this.getAvailableRooms();
    this._notifyRoomList(list);
    return list;
  }

  /** Merges live room announcements from in-memory hub, BroadcastChannel, and localStorage. */
  getAvailableRooms() {
    const now = Date.now();
    const merged = new Map();

    const add = (entry) => {
      if (!entry?.roomCode) return;
      if (now - (entry.updatedAt || 0) > ROOM_TTL_MS) return;
      const code = normalizeRoomCode(entry.roomCode);
      const prev = merged.get(code);
      if (!prev || (entry.updatedAt || 0) >= (prev.updatedAt || 0)) {
        merged.set(code, {
          ...entry,
          roomCode: code,
          isOwnRoom: this.active && this.roomCode === code,
        });
      }
    };

    for (const entry of LOCAL_ROOM_HUB.listRooms()) add(entry);
    for (const [code, entry] of this._discoveredRooms.entries()) {
      if (now - (entry.updatedAt || 0) > ROOM_TTL_MS) {
        this._discoveredRooms.delete(code);
      } else {
        add(entry);
      }
    }
    const stored = this._readStorageRooms();
    for (const entry of Object.values(stored)) add(entry);

    return [...merged.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  _notifyRoomList(list = null) {
    this.callbacks.onRoomListChange?.(list ?? this.getAvailableRooms());
  }

  /** Whether AI bandits should spawn in the current session (Co-Op only; never in Versus/Team). */
  shouldSpawnBandits() {
    if (!this.active) return true;
    return this.mode === 'coop';
  }

  /**
   * Create and host a room with a 6-character Room Code.
   */
  async createRoom({ code, mode = this.mode, mapId = 'coral', allowBandits = this.allowBandits } = {}) {
    this.leaveRoom(true);
    this.roomCode = normalizeRoomCode(code) || generateRoomCode();
    this.mode = VALID_MODES.includes(mode) ? mode : 'coop';
    this.mapId = mapId || 'coral';
    this.allowBandits = this.mode === 'coop';
    this.isHost = true;
    this.hostId = this.localId;
    this.localTeam = 'blue';
    this.active = true;
    this.localReady = true;
    this.matchStarted = false;
    this.squadKills = 0;
    this.resetMatchState();
    this.status = `HOSTING · ROOM ${this.roomCode}`;
    this.transport = 'local';

    this._openLocalChannels(this.roomCode);
    this._announceRoom();
    if (!navigator.userAgent?.includes('jsdom')) {
      this._announceTimer = setInterval(() => this._announceRoom(), 2500);
      this._announceTimer?.unref?.();
    }
    this._notifyStatus();
    this._notifyRoomList();

    // Start WebRTC PeerJS broker registration in the background for internet play.
    const PeerClass = await loadPeerJS();
    if (PeerClass && this.active && this.isHost) {
      this._initHostWebRTC(PeerClass, this.roomCode);
    }
    return this.roomCode;
  }

  /**
   * Join an existing Room Code as a client.
   */
  async joinRoom({ code, mode, mapId } = {}) {
    const clean = normalizeRoomCode(code);
    if (!clean || clean.length < 3) {
      this.status = 'KODE ROOM TIDAK VALID';
      this._notifyStatus();
      return false;
    }
    this.leaveRoom(true);
    this.roomCode = clean;
    if (VALID_MODES.includes(mode)) this.mode = mode;
    if (mapId) this.mapId = mapId;
    this.isHost = false;
    this.hostId = null;
    this.active = true;
    this.localReady = false;
    this.matchStarted = false;
    this.squadKills = 0;
    this.resetMatchState();
    this.status = `MENYAMBUNG KE ${this.roomCode}...`;
    this.transport = 'local';

    this._openLocalChannels(this.roomCode);
    this._sendPacket({
      type: 'join',
      senderId: this.localId,
      callsign: this.callsign,
      aircraftId: this.localAircraftId,
      team: this.localTeam,
      ready: this.localReady,
    });
    this._notifyStatus();
    this._notifyRoomList();

    const PeerClass = await loadPeerJS();
    if (PeerClass && this.active && !this.isHost) {
      this._initClientWebRTC(PeerClass, this.roomCode);
    }
    return true;
  }

  leaveRoom(silent = false) {
    if (this._announceTimer) {
      clearInterval(this._announceTimer);
      this._announceTimer = null;
    }
    if (this.active && this.isHost && this.roomCode) {
      this._removeRoomAnnouncement(this.roomCode);
    }
    if (this.active) {
      this._sendPacket({ type: 'leave', senderId: this.localId });
    }
    if (this.roomCode) {
      LOCAL_ROOM_HUB.unsubscribe(this.roomCode, this.localId);
    }
    if (this._bc) {
      try {
        this._bc.close();
      } catch {
        /* ignore */
      }
      this._bc = null;
    }
    for (const conn of this._conns.values()) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }
    this._conns.clear();
    this._connPeerIds.clear();
    if (this._hostConn) {
      try {
        this._hostConn.close();
      } catch {
        /* ignore */
      }
      this._hostConn = null;
    }
    if (this._peer) {
      try {
        this._peer.destroy();
      } catch {
        /* ignore */
      }
      this._peer = null;
    }
    for (const pilot of this.peers.values()) {
      pilot.dispose();
    }
    this.peers.clear();
    this.active = false;
    this.isHost = false;
    this.hostId = null;
    this.roomCode = '';
    this.localReady = false;
    this.matchStarted = false;
    this.matchEnded = false;
    this.matchResult = null;
    this.pvpScores.clear();
    this.teamScores = { blue: 0, red: 0 };
    this.matchRemaining = TEAM_MATCH_DURATION;
    this.status = 'OFFLINE';
    this.transport = 'none';
    if (!silent) {
      this._notifyStatus();
      this._notifyRoomList();
    }
  }

  _openLocalChannels(code) {
    // 1. In-memory hub (instant same-page / automated test communication).
    LOCAL_ROOM_HUB.subscribe(code, this.localId, (pkt) => this._onPacket(pkt));

    // 2. BroadcastChannel (instant multi-tab communication in the same browser).
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this._bc = new BroadcastChannel(`skybound-v21-room-${code}`);
        this._bc.onmessage = (event) => {
          if (event?.data && event.data.senderId !== this.localId) {
            this._onPacket(event.data);
          }
        };
      } catch {
        this._bc = null;
      }
    }
  }

  _initHostWebRTC(PeerClass, code) {
    try {
      const peer = new PeerClass(peerBrokerId(code), {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      });
      this._peer = peer;
      peer.on('open', () => {
        if (!this.active) return;
        this.transport = 'webrtc';
        this.status = `ONLINE (P2P) · ROOM ${this.roomCode}`;
        this._notifyStatus();
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          this._conns.set(conn.peer, conn);
          conn.send({
            type: 'room-config',
            senderId: this.localId,
            callsign: this.callsign,
            aircraftId: this.localAircraftId,
            mode: this.mode,
            mapId: this.mapId,
            allowBandits: this.allowBandits,
            squadKills: this.squadKills,
            matchStarted: this.matchStarted,
            peersReady: this._collectPeersReady(),
          });
          this._notifyStatus();
        });
        conn.on('data', (data) => {
          if (!data || typeof data !== 'object') return;
          if (data.senderId && data.senderId !== this.localId) {
            this._connPeerIds.set(conn.peer, data.senderId);
          }
          this._onPacket(data);
          // Host relays packets to all other WebRTC clients in the room.
          for (const [id, other] of this._conns.entries()) {
            if (id !== conn.peer && other.open) {
              other.send(data);
            }
          }
        });
        conn.on('close', () => {
          this._conns.delete(conn.peer);
          const departedId = this._connPeerIds.get(conn.peer);
          this._connPeerIds.delete(conn.peer);
          if (departedId) {
            const pilot = this.peers.get(departedId);
            if (pilot) {
              pilot.dispose();
              this.peers.delete(departedId);
              this.callbacks.onPeerLeave?.(pilot);
              this._sendPacket({ type: 'leave', senderId: departedId });
              this._announceRoom();
            }
          }
          this._notifyStatus();
        });
      });
      peer.on('error', () => {
        // Fallback to BroadcastChannel / local channel remains active.
      });
    } catch {
      /* ignore WebRTC init failure in restricted environments */
    }
  }

  _initClientWebRTC(PeerClass, code) {
    try {
      const peer = new PeerClass({
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      });
      this._peer = peer;
      peer.on('open', () => {
        if (!this.active) return;
        const conn = peer.connect(peerBrokerId(code), { reliable: true });
        this._hostConn = conn;
        conn.on('open', () => {
          this.transport = 'webrtc';
          this.status = `TERHUBUNG · ROOM ${this.roomCode}`;
          conn.send({
            type: 'join',
            senderId: this.localId,
            callsign: this.callsign,
            aircraftId: this.localAircraftId,
            ready: this.localReady,
          });
          this._notifyStatus();
        });
        conn.on('data', (data) => {
          if (data && typeof data === 'object') this._onPacket(data);
        });
        conn.on('close', () => {
          if (this.active && !this.isHost) {
            this.status = `HOST TERPUTUS · ROOM ${this.roomCode}`;
            this._notifyStatus();
          }
        });
      });
      peer.on('error', () => {
        /* local BroadcastChannel remains active */
      });
    } catch {
      /* ignore */
    }
  }

  _sendPacket(packet) {
    if (!this.active || !this.roomCode) return;
    const payload = {
      ...packet,
      senderId: this.localId,
      roomCode: this.roomCode,
      msgId: packet.msgId || `${this.localId}:${++this._msgSeq}`,
    };
    LOCAL_ROOM_HUB.publish(this.roomCode, this.localId, payload);
    if (this._bc) {
      try {
        this._bc.postMessage(payload);
      } catch {
        /* ignore */
      }
    }
    if (this.isHost) {
      for (const conn of this._conns.values()) {
        if (conn.open) conn.send(payload);
      }
    } else if (this._hostConn?.open) {
      this._hostConn.send(payload);
    }
  }

  _collectPeersReady() {
    const out = {};
    for (const [id, pilot] of this.peers.entries()) {
      out[id] = !!pilot.ready;
    }
    return out;
  }

  _collectPeersTeam() {
    const out = { [this.localId]: this.localTeam };
    for (const [id, pilot] of this.peers.entries()) {
      out[id] = pilot.team || 'blue';
    }
    return out;
  }

  _broadcastRoomConfig() {
    this._sendPacket({
      type: 'room-config',
      callsign: this.callsign,
      aircraftId: this.localAircraftId,
      team: this.localTeam,
      mode: this.mode,
      mapId: this.mapId,
      allowBandits: this.shouldSpawnBandits(),
      squadKills: this.squadKills,
      matchStarted: this.matchStarted,
      matchEnded: this.matchEnded,
      matchRemaining: Math.round(this.matchRemaining),
      teamScores: { ...this.teamScores },
      pvpScores: Object.fromEntries(this.pvpScores),
      peersReady: this._collectPeersReady(),
      peersTeam: this._collectPeersTeam(),
    });
  }

  _getOrCreatePeer(peerId, info = {}) {
    if (!peerId || peerId === this.localId) return null;
    let pilot = this.peers.get(peerId);
    if (!pilot) {
      pilot = new RemotePilot(peerId, this.quality, this.scene, {
        ...info,
        mode: this.mode,
      });
      this.peers.set(peerId, pilot);
      this.callbacks.onPeerJoin?.(pilot);
      this._notifyStatus();
    }
    return pilot;
  }

  _onPacket(pkt) {
    if (!this.active || !pkt || pkt.senderId === this.localId) return;
    if (pkt.msgId) {
      if (this._seenMsgIds.has(pkt.msgId)) return;
      this._seenMsgIds.add(pkt.msgId);
      if (this._seenMsgIds.size > 300) {
        const first = this._seenMsgIds.values().next().value;
        this._seenMsgIds.delete(first);
      }
    }

    if (pkt.type === 'join') {
      const assignedTeam =
        this.isHost && this.mode === 'team'
          ? this._pickBalancedTeam()
          : pkt.team === 'red'
            ? 'red'
            : 'blue';
      const pilot = this._getOrCreatePeer(pkt.senderId, {
        callsign: pkt.callsign,
        aircraftId: pkt.aircraftId,
        team: assignedTeam,
        ready: !!pkt.ready,
      });
      if (pilot) {
        if (pkt.aircraftId) pilot.setVariant(pkt.aircraftId);
        if (typeof pkt.ready === 'boolean') pilot.ready = pkt.ready;
        if (this.isHost && this.mode === 'team') pilot.team = assignedTeam;
      }
      if (this.isHost) {
        this.status = `ONLINE · ${this.peers.size + 1} PILOT DI ROOM ${this.roomCode}`;
        this._broadcastRoomConfig();
        this._announceRoom();
      }
      if (pilot) this._notifyStatus();
      return;
    }

    if (pkt.type === 'aircraft') {
      const pilot = this._getOrCreatePeer(pkt.senderId, {
        callsign: pkt.callsign,
        aircraftId: pkt.aircraftId,
      });
      if (pilot && pkt.aircraftId) {
        pilot.setVariant(pkt.aircraftId);
        this._notifyStatus();
      }
      return;
    }

    if (pkt.type === 'team') {
      const pilot = this._getOrCreatePeer(pkt.senderId, {
        callsign: pkt.callsign,
        team: pkt.team,
      });
      if (pilot && (pkt.team === 'blue' || pkt.team === 'red')) {
        pilot.team = pkt.team;
        if (this.isHost) this._broadcastRoomConfig();
        this._notifyStatus();
      }
      return;
    }

    if (pkt.type === 'ready') {
      const pilot = this._getOrCreatePeer(pkt.senderId, {
        callsign: pkt.callsign,
        aircraftId: pkt.aircraftId,
        ready: !!pkt.ready,
      });
      if (pilot) {
        if (pkt.aircraftId) pilot.setVariant(pkt.aircraftId);
        pilot.ready = !!pkt.ready;
        this.callbacks.onPeerReady?.(pilot, pilot.ready);
        if (this.isHost) {
          this._broadcastRoomConfig();
          this._announceRoom();
        }
        this._notifyStatus();
      }
      return;
    }

    if (pkt.type === 'leave') {
      const pilot = this.peers.get(pkt.senderId);
      if (pilot) {
        pilot.dispose();
        this.peers.delete(pkt.senderId);
        this.callbacks.onPeerLeave?.(pilot);
        if (this.isHost) this._announceRoom();
        this._notifyStatus();
      }
      return;
    }

    if (pkt.type === 'room-config') {
      const hostPilot = this._getOrCreatePeer(pkt.senderId, {
        callsign: pkt.callsign,
        aircraftId: pkt.aircraftId,
        team: pkt.team || 'blue',
        ready: true,
      });
      if (hostPilot) {
        hostPilot.ready = true;
        if (pkt.aircraftId) hostPilot.setVariant(pkt.aircraftId);
        if (pkt.team === 'blue' || pkt.team === 'red') hostPilot.team = pkt.team;
      }
      this.hostId = pkt.senderId;
      const prevMode = this.mode;
      if (VALID_MODES.includes(pkt.mode)) this.mode = pkt.mode;
      this.allowBandits = this.mode === 'coop';
      if (typeof pkt.matchStarted === 'boolean') this.matchStarted = pkt.matchStarted;
      if (typeof pkt.matchEnded === 'boolean') this.matchEnded = pkt.matchEnded;
      if (Number.isFinite(pkt.squadKills)) {
        this.squadKills = Math.max(this.squadKills, pkt.squadKills);
      }
      this._syncScoresFromPacket(pkt);
      if (pkt.peersReady && typeof pkt.peersReady === 'object') {
        for (const [pid, isReady] of Object.entries(pkt.peersReady)) {
          const peerPilot = this.peers.get(pid);
          if (peerPilot) peerPilot.ready = !!isReady;
        }
      }
      if (pkt.peersTeam && typeof pkt.peersTeam === 'object') {
        for (const [pid, t] of Object.entries(pkt.peersTeam)) {
          if (t !== 'blue' && t !== 'red') continue;
          if (pid === this.localId) this.localTeam = t;
          else {
            const peerPilot = this.peers.get(pid);
            if (peerPilot) peerPilot.team = t;
          }
        }
      }
      if (pkt.mapId && !this.isHost) {
        this.mapId = pkt.mapId;
        this.callbacks.onRoomMapSync?.(pkt.mapId);
      }
      if (this.mode !== prevMode) {
        this.callbacks.onRoomModeSync?.(this.mode);
      }
      this.status = this.matchStarted
        ? `PERTARUNGAN AKTIF · TEKAN READY · ROOM ${this.roomCode}`
        : `TERHUBUNG · ROOM ${this.roomCode}`;
      this._notifyStatus();
      return;
    }

    if (pkt.type === 'start-match') {
      if (this.isHost) return;
      const hostPilot = this._getOrCreatePeer(pkt.senderId, {
        callsign: pkt.callsign,
        aircraftId: pkt.aircraftId,
        team: pkt.team || 'blue',
        ready: true,
      });
      if (hostPilot) {
        hostPilot.ready = true;
        if (pkt.aircraftId) hostPilot.setVariant(pkt.aircraftId);
        if (pkt.team === 'blue' || pkt.team === 'red') hostPilot.team = pkt.team;
      }
      this.hostId = pkt.senderId;
      this.resetMatchState();
      this.matchStarted = true;
      const prevMode = this.mode;
      if (VALID_MODES.includes(pkt.mode)) this.mode = pkt.mode;
      this.allowBandits = this.mode === 'coop';
      this._syncScoresFromPacket(pkt);
      if (pkt.peersTeam && typeof pkt.peersTeam === 'object') {
        for (const [pid, t] of Object.entries(pkt.peersTeam)) {
          if (t !== 'blue' && t !== 'red') continue;
          if (pid === this.localId) this.localTeam = t;
          else {
            const peerPilot = this.peers.get(pid);
            if (peerPilot) peerPilot.team = t;
          }
        }
      }
      if (pkt.mapId) {
        this.mapId = pkt.mapId;
        this.callbacks.onRoomMapSync?.(pkt.mapId);
      }
      if (this.mode !== prevMode) {
        this.callbacks.onRoomModeSync?.(this.mode);
      }
      this.status = this.localReady
        ? `MEMULAI PERTARUNGAN · ROOM ${this.roomCode}`
        : `HOST MEMULAI · TEKAN READY UNTUK MASUK`;
      this._notifyStatus();
      this.callbacks.onRoomStartMatch?.({
        mapId: this.mapId,
        mode: this.mode,
        allowBandits: this.shouldSpawnBandits(),
        localReady: this.localReady,
      });
      return;
    }

    if (pkt.type === 'match-over') {
      if (pkt.result && !this.matchEnded) {
        this._finishMatch(pkt.result, false);
      }
      return;
    }

    if (pkt.type === 'state') {
      const pilot = this._getOrCreatePeer(pkt.senderId, {
        callsign: pkt.callsign,
        aircraftId: pkt.aircraftId,
        team: pkt.team,
      });
      if (pilot) {
        pilot.applyState(pkt, this._time);
        if (this.status.startsWith('MENYAMBUNG')) {
          this.status = `TERHUBUNG · ROOM ${this.roomCode}`;
          this._notifyStatus();
        }
      }
      // Fallback sync from Host's state packets in case initial room-config was missed.
      if (!this.isHost && pkt.host) {
        this.hostId = pkt.senderId;
        if (pilot) pilot.ready = true;
        let configChanged = false;
        if (VALID_MODES.includes(pkt.mode) && pkt.mode !== this.mode) {
          this.mode = pkt.mode;
          this.allowBandits = this.mode === 'coop';
          this.callbacks.onRoomModeSync?.(this.mode);
          configChanged = true;
        }
        if (pkt.mapId && pkt.mapId !== this.mapId) {
          this.mapId = pkt.mapId;
          this.callbacks.onRoomMapSync?.(pkt.mapId);
          configChanged = true;
        }
        this._syncScoresFromPacket(pkt);
        if (pkt.matchStarted && !this.matchStarted && !pkt.matchEnded) {
          this.matchStarted = true;
          configChanged = true;
          if (this.localReady) {
            this.callbacks.onRoomStartMatch?.({
              mapId: this.mapId,
              mode: this.mode,
              allowBandits: this.shouldSpawnBandits(),
              localReady: true,
            });
          }
        }
        if (configChanged) this._notifyStatus();
      }
      return;
    }

    if (pkt.type === 'pvp-hit') {
      if (this.isPvpMode() && !this.matchEnded && pkt.targetId === this.localId) {
        // Prevent friendly fire in Team 3 vs 3 mode.
        if (this.mode === 'team' && pkt.attackerTeam && pkt.attackerTeam === this.localTeam) {
          return;
        }
        this.callbacks.onLocalPvpHit?.({
          damage: Number(pkt.damage) || 14,
          weapon: pkt.weapon || 'gun',
          attackerId: pkt.senderId,
          attackerCallsign: pkt.attackerCallsign || 'RIVAL',
          attackerTeam: pkt.attackerTeam || 'blue',
        });
      }
      return;
    }

    if (pkt.type === 'pvp-down') {
      const victim = this.peers.get(pkt.victimId);
      if (victim) victim.alive = false;
      this.recordPvpKill({
        killerId: pkt.killerId,
        killerCallsign: pkt.killerCallsign || 'PILOT',
        killerTeam: pkt.killerTeam,
        victimId: pkt.victimId,
        victimCallsign: pkt.victimCallsign || victim?.callsign || 'PILOT',
        weapon: pkt.weapon || 'missile',
      });
      this.callbacks.onPvpKillFeed?.({
        victimId: pkt.victimId,
        victimCallsign: pkt.victimCallsign || victim?.callsign || 'PILOT',
        killerId: pkt.killerId,
        killerCallsign: pkt.killerCallsign || 'PILOT',
        killerTeam: pkt.killerTeam,
        weapon: pkt.weapon || 'missile',
      });
      return;
    }

    if (pkt.type === 'coop-kill') {
      this.squadKills += 1;
      this.callbacks.onCoopKill?.({
        killerCallsign: pkt.callsign || 'WINGMAN',
        weapon: pkt.weapon || 'missile',
        squadKills: this.squadKills,
      });
      this._notifyStatus();
      return;
    }

    if (pkt.type === 'peer-weapon') {
      const pilot = this.peers.get(pkt.senderId);
      if (pilot) {
        this.callbacks.onPeerWeapon?.(pilot, pkt);
      }
    }
  }

  _syncScoresFromPacket(pkt) {
    if (!pkt) return;
    if (Number.isFinite(pkt.matchRemaining)) {
      this.matchRemaining = clamp(pkt.matchRemaining, 0, this.matchDuration);
    }
    if (pkt.teamScores && typeof pkt.teamScores === 'object') {
      if (Number.isFinite(pkt.teamScores.blue)) {
        this.teamScores.blue = Math.max(this.teamScores.blue, pkt.teamScores.blue);
      }
      if (Number.isFinite(pkt.teamScores.red)) {
        this.teamScores.red = Math.max(this.teamScores.red, pkt.teamScores.red);
      }
    }
    if (pkt.pvpScores && typeof pkt.pvpScores === 'object') {
      for (const [pid, val] of Object.entries(pkt.pvpScores)) {
        if (!Number.isFinite(val)) continue;
        const next = Math.max(this.pvpScores.get(pid) || 0, val);
        this.pvpScores.set(pid, next);
        const p = this.peers.get(pid);
        if (p) p.pvpScore = next;
      }
    }
  }

  /**
   * Records a PvP kill in Versus (target 20) or Team 3 vs 3 (target 40),
   * updates scores, and finishes the match when a victory condition is met.
   */
  recordPvpKill({ killerId, killerCallsign, killerTeam, victimId, victimCallsign, weapon }) {
    if (!this.active || !this.isPvpMode() || this.matchEnded) return;
    const id = killerId || 'unknown';
    const nextScore = (this.pvpScores.get(id) || 0) + 1;
    this.pvpScores.set(id, nextScore);
    const killerPilot = this.peers.get(id);
    if (killerPilot) killerPilot.pvpScore = nextScore;

    if (this.mode === 'team') {
      const team =
        killerTeam === 'blue' || killerTeam === 'red'
          ? killerTeam
          : id === this.localId
            ? this.localTeam
            : killerPilot?.team || 'blue';
      this.teamScores[team] = (this.teamScores[team] || 0) + 1;
      if (this.teamScores[team] >= TEAM_SCORE_LIMIT) {
        this._finishMatch(
          {
            mode: 'team',
            winnerType: 'team',
            winnerTeam: team,
            winnerName: team === 'blue' ? 'TIM BIRU' : 'TIM MERAH',
            reason: 'score',
            teamScores: { ...this.teamScores },
            matchRemaining: Math.max(0, Math.round(this.matchRemaining)),
            standings: this._buildStandings(),
          },
          true
        );
        return;
      }
    } else if (this.mode === 'versus' && nextScore >= VERSUS_SCORE_LIMIT) {
      const winnerName =
        killerCallsign || (id === this.localId ? this.callsign : killerPilot?.callsign || 'PILOT');
      this._finishMatch(
        {
          mode: 'versus',
          winnerType: 'pilot',
          winnerId: id,
          winnerName,
          winnerScore: nextScore,
          reason: 'score',
          standings: this._buildStandings(),
        },
        true
      );
      return;
    }

    this._notifyStatus();
  }

  _buildStandings() {
    const rows = [
      {
        id: this.localId,
        callsign: this.callsign,
        team: this.localTeam,
        aircraftId: this.localAircraftId,
        score: this.pvpScores.get(this.localId) || 0,
        isLocal: true,
      },
    ];
    for (const pilot of this.peers.values()) {
      rows.push({
        id: pilot.id,
        callsign: pilot.callsign,
        team: pilot.team || 'blue',
        aircraftId: pilot.aircraftId,
        score: this.pvpScores.get(pilot.id) ?? pilot.pvpScore ?? 0,
        isLocal: false,
      });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  _finishMatch(result, broadcast = true) {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.matchStarted = false;
    this.matchResult = result;
    if (broadcast) {
      this._sendPacket({ type: 'match-over', result });
    }
    if (this.isHost) this._announceRoom();
    this._notifyStatus();
    this.callbacks.onMatchOver?.(result);
  }

  /**
   * Computes spaced-out deploy & respawn coordinates so players never spawn
   * on top of one another:
   *  - Team 3v3: opposing wings 3.6 km apart (South vs North) with 420 m spacing
   *  - Solo Versus: wide 1.5 km arena ring facing inward; respawn picks point
   *    farthest from live enemies
   *  - Co-Op: clean side-by-side squadron formation
   */
  getSpawnTransform(isRespawn = false) {
    const allIds = [this.localId, ...this.peers.keys()].sort();
    const mySlot = Math.max(0, allIds.indexOf(this.localId));

    if (this.mode === 'team') {
      const teamIds = [this.localId, ...this.peers.keys()]
        .filter((id) =>
          id === this.localId ? this.localTeam === this.localTeam : (this.peers.get(id)?.team || 'blue') === this.localTeam
        )
        .sort();
      const teamSlot = Math.max(0, teamIds.indexOf(this.localId));
      const lateralOffsets = [0, -420, 420, -840, 840];
      const x = lateralOffsets[teamSlot % lateralOffsets.length] ?? 0;
      const isBlue = this.localTeam !== 'red';
      const z = isBlue ? 1800 : -1800;
      const heading = isBlue ? 0 : Math.PI;
      return {
        position: new THREE.Vector3(x, 560, z),
        heading,
        speed: 190,
      };
    }

    if (this.mode === 'versus') {
      const radius = 1550;
      const candidates = [];
      const count = isRespawn ? 8 : Math.max(allIds.length, 4);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;
        // Face inward toward (0, 0).
        const heading = Math.atan2(-x, z);
        candidates.push({ x, z, heading });
      }
      let chosen = candidates[mySlot % candidates.length];
      if (isRespawn && this.peers.size > 0) {
        let bestDist = -1;
        for (const c of candidates) {
          let minEnemyDist = Infinity;
          for (const pilot of this.peers.values()) {
            if (!pilot.alive) continue;
            const d = Math.hypot(c.x - pilot.position.x, c.z - pilot.position.z);
            if (d < minEnemyDist) minEnemyDist = d;
          }
          if (minEnemyDist > bestDist) {
            bestDist = minEnemyDist;
            chosen = c;
          }
        }
      }
      return {
        position: new THREE.Vector3(chosen.x, 560, chosen.z),
        heading: chosen.heading,
        speed: 190,
      };
    }

    // Co-Op squadron formation spacing.
    const wingOffsets = [0, -190, 190, -380, 380];
    const x = wingOffsets[mySlot % wingOffsets.length] ?? 0;
    const z = 1500 + Math.floor(mySlot / 2) * 140;
    return {
      position: new THREE.Vector3(x, 520, z),
      heading: 0,
      speed: 185,
    };
  }

  /** Broadcasts a hit scored by the local player on a remote Versus / Team enemy. */
  sendPvpHit(targetPeerId, damage, weapon = 'gun') {
    if (!this.active || !this.isPvpMode() || this.matchEnded) return;
    this._sendPacket({
      type: 'pvp-hit',
      targetId: targetPeerId,
      damage,
      weapon,
      attackerCallsign: this.callsign,
      attackerTeam: this.localTeam,
    });
  }

  /** Broadcasts that the local player was shot down by a remote Versus / Team enemy. */
  sendPvpDown(killerId, killerCallsign, weapon = 'missile', killerTeam = null) {
    if (!this.active || !this.isPvpMode() || this.matchEnded) return;
    const resolvedTeam =
      killerTeam || this.peers.get(killerId)?.team || (this.localTeam === 'blue' ? 'red' : 'blue');
    this._sendPacket({
      type: 'pvp-down',
      victimId: this.localId,
      victimCallsign: this.callsign,
      killerId,
      killerCallsign,
      killerTeam: resolvedTeam,
      weapon,
    });
    this.recordPvpKill({
      killerId,
      killerCallsign,
      killerTeam: resolvedTeam,
      victimId: this.localId,
      victimCallsign: this.callsign,
      weapon,
    });
  }

  /** Broadcasts a bandit kill in Co-Op mode so the whole squadron gets credit. */
  sendCoopKill(weapon = 'missile') {
    if (!this.active || this.mode !== 'coop') return;
    this.squadKills += 1;
    this._sendPacket({
      type: 'coop-kill',
      callsign: this.callsign,
      weapon,
      squadKills: this.squadKills,
    });
    this._notifyStatus();
  }

  /** Broadcasts a weapon launch (cannon burst or missile launch) to peers. */
  sendWeaponEvent(kind, origin, direction, targetId = null) {
    if (!this.active) return;
    this._sendPacket({
      type: 'peer-weapon',
      kind,
      o: [origin.x, origin.y, origin.z],
      d: [direction.x, direction.y, direction.z],
      targetId,
    });
  }

  /**
   * Called each frame during flight to broadcast local state at 18 Hz and
   * advance all remote aircraft replicas at 60 FPS.
   */
  update(dt, localState) {
    if (!this.active) return;
    this._time += dt;

    // 10-minute match countdown for Team 3 vs 3 mode.
    if (this.mode === 'team' && this.matchStarted && !this.matchEnded) {
      this.matchRemaining = Math.max(0, this.matchRemaining - dt);
      if (this.matchRemaining <= 0 && this.isHost) {
        const blue = this.teamScores.blue || 0;
        const red = this.teamScores.red || 0;
        const winnerTeam = blue > red ? 'blue' : red > blue ? 'red' : 'draw';
        const winnerName =
          winnerTeam === 'blue' ? 'TIM BIRU' : winnerTeam === 'red' ? 'TIM MERAH' : 'SERI (DRAW)';
        this._finishMatch(
          {
            mode: 'team',
            winnerType: winnerTeam === 'draw' ? 'draw' : 'team',
            winnerTeam,
            winnerName,
            reason: 'time',
            teamScores: { ...this.teamScores },
            matchRemaining: 0,
            standings: this._buildStandings(),
          },
          true
        );
      }
    }

    for (const [id, pilot] of this.peers.entries()) {
      if (this._time - pilot.lastSeen > 18 && pilot.lastSeen > 0) {
        pilot.dispose();
        this.peers.delete(id);
        this._notifyStatus();
        continue;
      }
      pilot.update(dt, this._time, localState?.world);
    }

    if (!localState?.physics) return;
    this._sendAcc += dt;
    if (this._sendAcc < 1 / 18) return;
    this._sendAcc = 0;

    const p = localState.physics.position;
    const v = localState.physics.velocity;
    const q = localState.physics.quaternion;
    const inp = localState.input || { pitch: 0, roll: 0, yaw: 0 };

    this._sendPacket({
      type: 'state',
      callsign: this.callsign,
      aircraftId: localState.aircraftId || this.localAircraftId || 'wraith',
      team: this.localTeam,
      host: this.isHost,
      paused: !!localState.paused,
      ...(this.isHost
        ? {
            mapId: this.mapId,
            mode: this.mode,
            allowBandits: this.shouldSpawnBandits(),
            matchStarted: this.matchStarted,
            matchEnded: this.matchEnded,
            matchRemaining: Math.round(this.matchRemaining),
            teamScores: { ...this.teamScores },
            pvpScores: Object.fromEntries(this.pvpScores),
          }
        : {}),
      p: [
        Math.round(p.x * 10) / 10,
        Math.round(p.y * 10) / 10,
        Math.round(p.z * 10) / 10,
      ],
      v: [
        Math.round(v.x * 10) / 10,
        Math.round(v.y * 10) / 10,
        Math.round(v.z * 10) / 10,
      ],
      q: [
        Math.round(q.x * 1000) / 1000,
        Math.round(q.y * 1000) / 1000,
        Math.round(q.z * 1000) / 1000,
        Math.round(q.w * 1000) / 1000,
      ],
      spd: Math.round(localState.physics.speed),
      thr: Math.round((localState.physics.throttle ?? 0.68) * 100) / 100,
      hull: Math.round(localState.hull ?? 100),
      hullMax: Math.round(localState.hullMax ?? 100),
      ab: Math.round((localState.physics.afterburner || 0) * 100) / 100,
      boost: !!localState.physics.boosting,
      alive: localState.alive !== false,
      kills: localState.kills ?? 0,
      score: localState.score ?? 0,
      in: [
        Math.round((inp.pitch || 0) * 100) / 100,
        Math.round((inp.roll || 0) * 100) / 100,
        Math.round((inp.yaw || 0) * 100) / 100,
      ],
    });
  }

  /**
   * Returns hostile target proxies for remote players in VERSUS or TEAM 3v3
   * mode (excluding same-team allies in Team mode).
   */
  getVersusTargets() {
    if (!this.active || !this.isPvpMode()) return [];
    const out = [];
    for (const pilot of this.peers.values()) {
      if (!pilot.alive) continue;
      if (this.mode === 'team' && pilot.team === this.localTeam) continue;
      out.push(pilot.targetProxy);
    }
    return out;
  }

  /**
   * Returns radar contacts for all remote players (allied in Co-Op / same team,
   * hostile in Versus / opposing team).
   */
  getRadarContacts(playerPosition) {
    if (!this.active || !this.peers.size) return [];
    const out = [];
    for (const pilot of this.peers.values()) {
      if (!pilot.alive) continue;
      const dx = pilot.position.x - playerPosition.x;
      const dz = pilot.position.z - playerPosition.z;
      const distance = Math.hypot(dx, dz);
      const isHostile =
        this.mode === 'versus' || (this.mode === 'team' && pilot.team !== this.localTeam);
      out.push({
        id: pilot.id,
        x: pilot.position.x,
        y: pilot.position.y,
        z: pilot.position.z,
        distance,
        height: pilot.position.y,
        radius: 10,
        name: isHostile ? `VS · ${pilot.callsign}` : `ALLY · ${pilot.callsign}`,
        callsign: pilot.callsign,
        aircraftId: pilot.aircraftId,
        team: pilot.team || 'blue',
        hull: pilot.hull,
        hullMax: pilot.hullMax,
        enemy: isHostile,
        ally: !isHostile,
        isPlayer: true,
        position: pilot.position,
      });
    }
    return out;
  }

  reattach(scene) {
    this.scene = scene;
    for (const pilot of this.peers.values()) {
      pilot.reattach(scene);
    }
  }

  getRoomSummary() {
    const pilots = [
      {
        id: this.localId,
        callsign: this.callsign,
        isLocal: true,
        isHost: this.isHost,
        ready: this.isHost ? true : this.localReady,
        aircraftId: this.localAircraftId,
        team: this.localTeam,
        pvpScore: this.pvpScores.get(this.localId) || 0,
      },
    ];
    let guestCount = 0;
    let readyGuests = 0;
    let blueCount = this.localTeam === 'blue' ? 1 : 0;
    let redCount = this.localTeam === 'red' ? 1 : 0;
    for (const pilot of this.peers.values()) {
      const pilotIsHost = pilot.id === this.hostId;
      const pilotReady = pilotIsHost ? true : !!pilot.ready;
      const pilotTeam = pilot.team === 'red' ? 'red' : 'blue';
      if (pilotTeam === 'red') redCount += 1;
      else blueCount += 1;
      if (!pilotIsHost) {
        guestCount += 1;
        if (pilotReady) readyGuests += 1;
      }
      pilots.push({
        id: pilot.id,
        callsign: pilot.callsign,
        isLocal: false,
        isHost: pilotIsHost,
        ready: pilotReady,
        aircraftId: pilot.aircraftId,
        team: pilotTeam,
        pvpScore: this.pvpScores.get(pilot.id) ?? pilot.pvpScore ?? 0,
        hull: pilot.hull,
        hullMax: pilot.hullMax,
        kills: pilot.kills,
        score: pilot.score,
        alive: pilot.alive,
      });
    }
    return {
      active: this.active,
      isHost: this.isHost,
      profileSet: this.profileSet,
      callsign: this.callsign,
      roomCode: this.roomCode,
      mode: this.mode,
      allowBandits: this.shouldSpawnBandits(),
      mapId: this.mapId,
      localTeam: this.localTeam,
      localReady: this.isHost ? true : this.localReady,
      localPvpScore: this.pvpScores.get(this.localId) || 0,
      matchStarted: this.matchStarted,
      matchEnded: this.matchEnded,
      matchResult: this.matchResult,
      matchRemaining: Math.max(0, Math.round(this.matchRemaining)),
      scoreLimit: this.mode === 'team' ? TEAM_SCORE_LIMIT : VERSUS_SCORE_LIMIT,
      teamScores: { ...this.teamScores },
      teamCounts: { blue: blueCount, red: redCount },
      standings: this._buildStandings(),
      guestCount,
      readyGuests,
      allGuestsReady: guestCount === 0 || readyGuests === guestCount,
      status: this.status,
      transport: this.transport,
      peerCount: this.peers.size,
      totalPilots: pilots.length,
      squadKills: this.squadKills,
      pilots,
    };
  }

  _notifyStatus() {
    this.callbacks.onStatusChange?.(this.getRoomSummary());
  }
}
