import * as THREE from 'three';
import { World } from '../world/World.js';
import { FlightPhysics, SPAWN } from '../aircraft/FlightPhysics.js';
import { Aircraft } from '../aircraft/Aircraft.js';
import { Cockpit } from '../aircraft/Cockpit.js';
import { ChaseCamera } from '../camera/ChaseCamera.js';
import { TrailSystem } from '../fx/TrailSystem.js';
import { ExplosionSystem } from '../fx/ExplosionSystem.js';
import { Weapons } from '../combat/Weapons.js';
import { getMissile, isMissileUnlocked } from '../combat/MissileCatalog.js';
import { AircraftCarrier } from '../world/AircraftCarrier.js';
import { Enemies } from '../combat/Enemies.js';
import { DesertTanks } from '../combat/DesertTanks.js';
import { InputManager } from '../controls/InputManager.js';
import { getAircraft } from '../aircraft/AircraftCatalog.js';
import {
  MISSIONS,
  loadProgress,
  saveProgress,
  resetMissionsForNewGame,
  isMissionPlayable,
  missionAt,
  missionObjective,
  completeMission,
  awardPoints,
  unlockMissile,
} from './Progress.js';
import { MobileControls } from '../controls/MobileControls.js';
import { HUD } from '../hud/HUD.js';
import { AudioSystem } from './AudioSystem.js';
import { MultiplayerManager } from '../net/Multiplayer.js';
import { PixelRenderer } from '../render/PixelRenderer.js';
import { applyQualityParam, qualityPixelRatio, resolveQuality, storeQuality } from './Quality.js';
import { getBiome, resolveBiome, storeBiome, BIOME_IDS } from '../world/Biomes.js';
import { clamp, isTouchDevice, pad } from '../utils/math.js';
import { fullscreenApi } from '../utils/fullscreen.js';

const MENU_SPAWN = {
  position: new THREE.Vector3(180, 560, 1980),
  heading: THREE.MathUtils.degToRad(-6),
  speed: 158,
};

const _fwdVec = new THREE.Vector3();
const _rightVec = new THREE.Vector3();
const _upVec = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

// Autopilot scratch vectors (reused every frame, never allocated).
const _aiAim = new THREE.Vector3();
const _aiToTarget = new THREE.Vector3();
const _aiFwd = new THREE.Vector3();
const _aiRight = new THREE.Vector3();
const _aiUp = new THREE.Vector3();
const _aiLockVec = new THREE.Vector3();
const _aiTv = new THREE.Vector3();
const _aiGunB = new THREE.Vector3();
const _aiGunQ = new THREE.Vector3();
const _aiGunDir = new THREE.Vector3();
const _aiDir = new THREE.Vector3();
const _leadPos = new THREE.Vector3();

// Autopilot tuning. Once a bandit is inside the seeker cone the AI fires
// immediately — no lock-hold delay — while the lock tone still announces
// the shot. Targets are re-rolled periodically so the AI hunts the sector
// instead of permanently shadowing the contact the threat arrow points at.
const AI_LOCK_CONE = 0.94;
const AI_LOCK_RANGE = 2600;
// Target selection is scored (alignment, range, stickiness) and re-evaluated
// every second instead of rolling a random bandit.
const AI_RETARGET_TIME = 1;
// Gun ballistics shared with Weapons: muzzle speed and how much of the
// shooter's own velocity the round inherits.
const GUN_SPEED = 950;
const GUN_INHERIT = 0.45;
// Terrain protection. The AI samples its projected flight path seconds ahead
// and aborts the hunt when any sample gets close to the deck; a hysteresis
// window keeps it climbing until the path is genuinely clear.
const AI_TERRAIN_LOOKAHEAD = [0.6, 1.2, 2.0, 2.8, 3.6, 4.6];
const AI_TERRAIN_MARGIN = 140;
const AI_TERRAIN_ESCAPE_AGL = 330;
const AI_TERRAIN_CLEAR_AGL = 620;
const AI_TERRAIN_CLEAR_MARGIN = 430;
// An inbound hostile bird inside this range gets an automatic flare salvo.
const AI_FLARE_RANGE = 1600;
// Professional throttle management: the AI matches the bandit's energy at
// close range, brakes instead of overshooting, and only lights the burner
// when it is genuinely far, slow or recovering from a terrain escape.
const AI_SPEED_BANDS = {
  chase: 2600,
  close: 1100,
  saddle: 650,
  guns: 320,
};

function createEnvironmentTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#3e92e4');
  sky.addColorStop(0.34, '#8adcf0');
  sky.addColorStop(0.48, '#d9f3f2');
  sky.addColorStop(0.52, '#b9e7e4');
  sky.addColorStop(0.56, '#1d8fa2');
  sky.addColorStop(1, '#075367');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 256);

  const glow = ctx.createRadialGradient(150, 96, 0, 150, 96, 150);
  glow.addColorStop(0, 'rgba(255,245,215,0.95)');
  glow.addColorStop(0.25, 'rgba(255,225,168,0.35)');
  glow.addColorStop(1, 'rgba(255,210,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export class Game {
  constructor() {
    this.canvas = document.getElementById('viewport');
    if (!this.canvas) throw new Error('Missing #viewport canvas');

    this.touch = isTouchDevice();
    this.quality = resolveQuality();
    this.state = 'boot';
    this.ready = false;

    this.lastTime = performance.now();
    this.menuTime = 0;
    this.sessionTime = 0;
    this.time = 0;
    this._respawnTimer = 0;
    this._toastTimer = 0;
    this._wasFlyingBeforeHide = false;

    this.muted = false;
    try {
      this.muted = window.localStorage.getItem('skybound.muted') === '1';
    } catch {
      /* ignore */
    }
    this.hudSide = 'left';
    this.buttonLayout = 'center';
    this.gyroOn = false;
    this.autoLock = false;
    this.autopilot = false;
    this.biome = resolveBiome();
    this.mapId = this.biome.id;
    // Per-frame autopilot intent, consumed by the combat step.
    this._aiFire = false;
    this._aiMissile = false;
    this._aiFlare = false;
    this._aiMissileCooldown = 0;
    // Autopilot target: picked at random from the live bandits and held for
    // a few seconds before the AI re-rolls.
    this._aiTarget = null;
    this._aiTargetTimer = 0;
    // Fire-and-forget engagement memory: enemies that already have an AI missile
    // inbound are deprioritized for ~5.5 s so the AI switches targets immediately.
    this._aiEngagedTargets = new Map();
    this._aiDefendTimer = 0;
    this._aiDefendCooldown = 0;
    this._aiDefendSide = 1;
    // Sticky terrain-recovery flag (hysteresis prevents terrain-avoidance
    // chatter while the AI is pulling out of a dive).
    this._aiTerrainEvade = false;
    // Airframe defense: incoming damage is cut by 30%.
    this.defense = 0.3;
    // Auto-lock state for the AI seeker.
    this._aiLockAnnounced = false;
    this._aiLockToneFresh = false;
    this.uiScale = this.touch ? 1 : 1.1;
    try {
      this.hudSide = window.localStorage.getItem('skybound.hudSide') || 'left';
      this.buttonLayout = window.localStorage.getItem('skybound.buttonLayout') || 'center';
      this.gyroOn = window.localStorage.getItem('skybound.gyro') === '1';
      this.autoLock = window.localStorage.getItem('skybound.autoLock') === '1';
      const savedScale = Number(window.localStorage.getItem('skybound.uiScale'));
      if (Number.isFinite(savedScale) && savedScale >= 0.8 && savedScale <= 1.6) {
        this.uiScale = savedScale;
      }
    } catch {
      /* ignore */
    }

    // Career save: which mission is next and which airframes/missiles are open.
    this.progress = loadProgress();
    this.selectedAircraftId = this.progress.aircraft;
    this.selectedMissileId = this.progress.missile || 'aim9x';
    this.missionIndex = Math.min(this.progress.mission, Math.max(0, MISSIONS.length - 1));
    this._campaignSelected = this.missionIndex;
    this.carrier = null;
    this._carrierLaunch = null;
    this._pendingCarrierLaunch = false;
    this.missileCam = null;
    this._mCamPos = new THREE.Vector3();
    this._mCamLook = new THREE.Vector3();
    this._mCamSide = new THREE.Vector3();
    this._mCamUp = new THREE.Vector3(0, 1, 0);
    this._mCamEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._switchingMap = false;
    this._pendingMapSync = null;
    this._launchAfterMapSwitch = false;
    this._mpMapSynced = true;
    this.environmentTexture = null;

    this._perf = { acc: 0, frames: 0, scale: 1, runtime: 0, cooldown: 0 };
    this._fps = 60;
    this._crashSurface = 'water';

    this._loop = this._loop.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onFullscreenChange = this._onFullscreenChange.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._fullscreen = fullscreenApi();
    this._incoming = null;
    this._pointerLocked = false;
    this._escapeGuardUntil = 0;
    this._boundaryStatus = null;
    this._boundaryToastAt = -10;
    this._boundaryMat = new THREE.Matrix4();
    this._boundaryQuat = new THREE.Quaternion();
    this._boundaryCenter = new THREE.Vector3();
    this._boundaryUp = new THREE.Vector3(0, 1, 0);
  }

  async boot() {
    this._createRenderer();
    this._createPixelPipeline();
    this._createHUD();
    this._createCamera();

    this.hud.setProgress(0.02, 'CONSTRUCTING ARCHIPELAGO');
    this.world = new World(this.quality, this.biome);
    this.scene = this.world.scene;
    this.environmentTexture = createEnvironmentTexture();
    this.scene.environment = this.environmentTexture;
    if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.55;

    this._createInput();
    this._bindWindowEvents();
    this._createAudio();

    await this.world.build((progress, label) => {
      this.hud.setProgress(progress, label);
    });

    this._createFlightSystems();
    this._prepareMenu();

    this.hud.setQuality(this.quality.name);
    this.hud.setCameraMode(0);
    this.hud.setMuted(this.muted);
    this.hud.setHudSide(this.hudSide);
    this.hud.setButtonLayout(this.buttonLayout);
    this.mobile?.setButtonLayout(this.buttonLayout);
    this.hud.setGyro(this.gyroOn ? 'on' : 'off');
    this.hud.setUiScale(this.uiScale);
    this.hud.setAutoLock(this.autoLock);
    this.hud.setAutopilot(this.autopilot);
    this.hud.setMap(this.biome.id);
    if (this.gyroOn) {
      // Restoring a saved preference: Android needs no prompt, iOS will ask
      // again on the first tap of the GIRO row if this call is refused.
      this.input.enableGyro().then((ok) => {
        if (ok) return;
        this.gyroOn = false;
        this.hud.setGyro('off');
        this.hud.showToast('GIRO MENUNGGU IZIN · BUKA JEDA LALU HIDUPKAN');
      });
    }
    this.audio.setMuted(this.muted);
    this.hud.setReady(this._worldFacts());
    this.hud.setKeymap(this.input.getBindings());
    this.hud.setSensitivity(this.input.getSensitivity());
    this.hud.setContinueEnabled(this._hasSave());

    this.ready = true;
    this.state = 'menu';
    this.lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }

  _createRenderer() {
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: q.antialias,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(qualityPixelRatio(q));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = !!q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;
  }

  _createPixelPipeline() {
    this.pixel = new PixelRenderer(this.renderer, this.quality);
  }

  _createCamera() {
    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.5,
      32000
    );
    this.camera.position.set(0, 600, 2600);
    this.chase = new ChaseCamera(this.camera, this.quality);
    this.missileCam = new THREE.PerspectiveCamera(56, 248 / 156, 0.5, 22000);
  }

  _createHUD() {
    this.hud = new HUD(
      {
        onStart: () =>
          this.hud.showAircraftSelect(true, {
            unlocked: this.progress.unlocked,
            selected: this.selectedAircraftId,
            mission: this.progress.mission,
            points: this.progress.points,
            unlockedMissiles: this.progress.unlockedMissiles,
            selectedMissile: this.selectedMissileId,
          }),
        onContinue: () => this._continueGame(),
        onMissions: () => this._openCampaign(),
        onMissionSelect: (index) => {
          this._campaignSelected = index;
        },
        onMissionLaunch: (index) => this._launchMission(index),
        onMissionNext: () => this._launchMission(this.progress.mission),
        onMissionMenu: () => this._missionToMenu(),
        onExitConfirm: () => this._exitGame(),
        onSensitivity: (value) => this.input.setSensitivity(value),
        onKeymapReset: () => {
          this.input.resetBindings();
          this.hud.setKeymap(this.input.getBindings());
          this.hud.setSensitivity(this.input.getSensitivity());
          this.hud.showToast('KEYMAPPING & SENSITIF DIRESET');
        },
        onSetBinding: (action, code) => this.input.setBinding(action, code),
        onAircraftSelect: (id) => {
          this.selectedAircraftId = id;
          const craft = getAircraft(id);
          if (
            craft?.specialMissile &&
            isMissileUnlocked(craft.specialMissile, this.progress.unlockedMissiles)
          ) {
            this.selectedMissileId = craft.specialMissile;
            this.weapons?.setMissileType(craft.specialMissile);
            this.hud.renderHangarMissiles({
              points: this.progress.points,
              unlockedMissiles: this.progress.unlockedMissiles,
              selectedMissile: this.selectedMissileId,
            });
          }
        },
        onAircraftLaunch: (id) => this._launchAircraft(id),
        onAircraftBack: () => this.hud.showAircraftSelect(false),
        onMissileSelect: (id) => this._selectMissile(id),
        onMissileUnlock: (id) => this._unlockMissile(id),
        onPause: () => this._togglePause(),
        onResume: () => this._resume(),
        onRestart: () => this._restartSortie(),
        onReturnToMenu: () => this._returnToMenu(),
        onRespawn: () => this._respawn(),
        onHelp: () => this._toggleHelp(),
        onHelpClose: () => this._toggleHelp(false),
        onMute: () => this._toggleMute(),
        onCamera: () => this._cycleCamera(),
        onFullscreen: () => this._toggleFullscreen(),
        onHudSide: (side) => this._setHudSide(side),
        onButtonLayout: (layout) => this._setButtonLayout(layout),
        onGyro: (value) => this._setGyro(value),
        onHudEdit: (value) => this._setHudEdit(value),
        onHudReset: () => this._resetHudLayout(),
        onQuality: (name) => this._changeQuality(name),
        onUiScale: (value) => this._setUiScale(value),
        onAutoLock: (value) => this._setAutoLock(value),
        onAutoLockToggle: () => this._toggleAutoLock(),
        onAutopilotToggle: () => this._toggleAutopilot(),
        onChatSubmit: (text) => this._handleChatSubmit(text),
        onChatClose: () => this._closeFlightChat(),
        onMap: (value) => this._setMap(value),
        onGyroCalibrate: () => this._calibrateGyro(),
        onMultiplayerOpen: () => this._openMultiplayer(),
        onMultiplayerCreate: (code) => this._createMultiplayerRoom(code),
        onMultiplayerJoin: (code) => this._joinMultiplayerRoom(code),
        onMultiplayerCopy: () => this._copyMultiplayerCode(),
        onMultiplayerLeave: () => this._leaveMultiplayerRoom(),
        onMultiplayerLaunch: () => this._launchMultiplayerSortie(),
        onMultiplayerReady: () => this._toggleMultiplayerReady(),
        onMultiplayerRefreshRooms: () => this._refreshMultiplayerRooms(true),
        onMultiplayerAircraft: (id) => this._setMultiplayerAircraft(id),
        onMultiplayerTeam: (team) => this._setMultiplayerTeam(team),
        onMultiplayerProfileSave: (name) => this._saveMultiplayerProfile(name),
        onMultiplayerResultLobby: () => this._multiplayerResultToLobby(),
        onMultiplayerResultMenu: () => this._multiplayerResultToMenu(),
        onMultiplayerCallsign: (name) => {
          this.multiplayer?.setCallsign(name);
          this.hud.setMultiplayerStatus(this.multiplayer?.getRoomSummary());
        },
        onMultiplayerMode: (mode) => {
          this.multiplayer?.setMode(mode);
          if (this.multiplayer?.isPvpMode()) {
            this.enemies?.clear();
          }
          this.hud.setMultiplayerStatus(this.multiplayer?.getRoomSummary());
        },
        onMultiplayerBandits: (allow) => {
          this.multiplayer?.setAllowBandits(allow);
          if (!this.multiplayer?.shouldSpawnBandits()) {
            this.enemies?.clear();
          }
          this.hud.setMultiplayerStatus(this.multiplayer?.getRoomSummary());
        },
      },
      {
        touch: this.touch,
        qualityLabel: this.quality.label,
        uiScale: this.uiScale,
        autoLock: this.autoLock,
      }
    );
    this.hud.setPhase('menu');
    this.hud.setProgress(0.01, 'INITIALISING FLIGHT SYSTEMS');
  }

  _createInput() {
    this.input = new InputManager({ touch: this.touch });
    this.input.attach(this.canvas);
    this.input.setEnabled(false);

    this.mobile = this.touch
      ? new MobileControls(this.input, {
          enabled: false,
          onCamera: () => this._cycleCamera(),
        })
      : null;
    if (this.touch) document.body.classList.add('touch-device');
    // The action cluster exists only now, so (re)bind the HUD drag targets.
    this.hud?._initHudDrag();
    this.hud?.applyHudPositions();
  }

  _createAudio() {
    this.audio = new AudioSystem();
  }

  _createFlightSystems() {
    this.physics = new FlightPhysics();
    this.aircraft = new Aircraft(this.quality, getAircraft(this.selectedAircraftId));
    this.scene.add(this.aircraft.root);
    this.scene.add(this.aircraft.shadow);

    this.trails = new TrailSystem(this.quality);
    this.trails.setPixelRatio(this.renderer.getPixelRatio());
    this.scene.add(this.trails.points);

    this.explosions = new ExplosionSystem(this.quality);
    this.scene.add(this.explosions.points);
    this.weapons = new Weapons(this.scene, this.quality, this.explosions);
    this.weapons.setMissileType(this.selectedMissileId);
    this.carrier = new AircraftCarrier();
    this.carrier.group.visible = false;
    this.scene.add(this.carrier.group);
    this.enemies = new Enemies(this.scene, this.quality);
    this.enemies.setWorld(this.world);
    this.desertTanks = new DesertTanks(this.scene, this.quality);
    this.desertTanks.setWorld(this.world);

    // Real cockpit interior rides the camera, so it inherits shake and look.
    this.cockpit = new Cockpit();
    this.scene.add(this.camera);
    this.camera.add(this.cockpit.group);

    this.multiplayer = new MultiplayerManager({
      quality: this.quality,
      scene: this.scene,
      aircraftId: this.selectedAircraftId,
      callbacks: {
        onStatusChange: (summary) => {
          this.hud?.setMultiplayerStatus(summary);
        },
        onRoomListChange: (rooms) => {
          this.hud?.setMultiplayerRoomList(rooms);
        },
        onPeerJoin: (pilot) => {
          this.audio?.uiBlip(860, 0.08);
          this.hud?.showToast(`PILOT BERGABUNG · ${pilot.callsign}`);
        },
        onPeerReady: (pilot, ready) => {
          this.audio?.uiBlip(ready ? 920 : 500, 0.06);
          this.hud?.showToast(`${pilot.callsign} · ${ready ? 'SIAP (READY)' : 'BELUM READY'}`);
        },
        onPeerLeave: (pilot) => {
          this.audio?.uiBlip(420, 0.06);
          this.hud?.showToast(`PILOT KELUAR · ${pilot.callsign}`);
        },
        onRoomStartMatch: (info) => {
          this._onHostStartMatch(info);
        },
        onRoomMapSync: (mapId) => {
          if (!mapId) return;
          if (mapId === this.mapId) {
            this._mpMapSynced = true;
            this.hud?.setMap(this.mapId);
            return;
          }
          // Allow map sync in lobby, or once on initial connection if the guest
          // launched before the host's first room-config arrived. Mid-battle
          // map switches are disabled once synced.
          if (this._isInBattle() && this._mpMapSynced) return;
          this._mpMapSynced = true;
          this._setMap(mapId, { silent: false, force: true });
        },
        onRoomModeSync: (mode) => {
          const label =
            mode === 'team'
              ? 'TIM 3 VS 3 (40 SKOR · 10 MENIT)'
              : mode === 'versus'
                ? 'VERSUS PvP (TARGET 20)'
                : 'CO-OP ONLINE';
          if (mode === 'versus' || mode === 'team') this.enemies?.clear();
          this.hud?.showToast(`MODE ROOM · ${label}`);
        },
        onMatchOver: (result) => {
          this._onMultiplayerMatchOver(result);
        },
        onLocalPvpHit: ({ damage, weapon, attackerId, attackerCallsign, attackerTeam }) => {
          const onlineActive = this.state === 'flying' || (this.state === 'paused' && this.multiplayer?.active);
          if (!onlineActive || this.multiplayer?.matchEnded) return;
          const actual = damage * (1 - this.defense);
          this.hull = Math.max(0, this.hull - actual);
          this.audio?.hullHit();
          this.chase?.addCrashShake(0.38);
          this.hud?.flash('hit');
          this.hud?.setCombat({ hull: this.hull, hullMax: this.hullMax });
          if (this.hull <= 0) {
            this.multiplayer?.sendPvpDown(attackerId, attackerCallsign, weapon, attackerTeam);
            if (!this.multiplayer?.matchEnded) {
              this._crash('shotdown');
            }
          }
        },
        onPvpKillFeed: ({ victimCallsign, killerId, killerCallsign, weapon }) => {
          const isMe = killerId === this.multiplayer?.localId;
          if (isMe) {
            this.kills += 1;
            const pts = weapon === 'missile' ? 300 : 200;
            this.score += pts;
            this.hud?.showToast(`PVP KILL · ${victimCallsign} · +1 SKOR`);
          } else {
            this.hud?.showToast(`${killerCallsign} ➔ ${victimCallsign} (${weapon.toUpperCase()})`);
          }
          this.hud?.updateMultiplayerScoreboard(this.multiplayer?.getRoomSummary());
        },
        onCoopKill: ({ killerCallsign, squadKills }) => {
          this.hud?.showToast(`SQUAD KILL · ${killerCallsign} · TOTAL ${squadKills}`);
        },
        onPeerWeapon: (pilot, pkt) => {
          const onlineActive = this.state === 'flying' || (this.state === 'paused' && this.multiplayer?.active);
          if (!onlineActive || !pkt.o || !pkt.d) return;
          const origin = new THREE.Vector3(pkt.o[0], pkt.o[1], pkt.o[2]);
          const dir = new THREE.Vector3(pkt.d[0], pkt.d[1], pkt.d[2]).normalize();
          const isHostile =
            this.multiplayer?.mode === 'versus' ||
            (this.multiplayer?.mode === 'team' && pilot.team !== this.multiplayer.localTeam);
          if (pkt.kind === 'gun') {
            if (isHostile) {
              this.weapons.fireEnemyGun(origin, dir);
            } else {
              this.weapons.firePlayerGun(origin, dir, pilot.velocity);
            }
          } else if (pkt.kind === 'missile') {
            if (isHostile && pkt.targetId === this.multiplayer.localId) {
              this.weapons.launchHostileMissile(origin, dir, {
                position: this.physics.position,
                velocity: this.physics.velocity,
                radius: 6.5,
                alive: true,
              });
            }
          }
        },
      },
    });
    this.hud.setMultiplayerStatus(this.multiplayer.getRoomSummary());

    this.score = 0;
    this.kills = 0;
    this.hull = 100;
    this.hullMax = 100;
    this.target = null;
    this._lockProgress = 0;
    this._targetLocked = false;
    this._lockedTone = false;
    this._missionDone = false;
    this._mission = null;
  }

  _prepareMenu() {
    this.physics.setStats(getAircraft(this.selectedAircraftId).stats);
    this.aircraft.setVariant(getAircraft(this.selectedAircraftId));
    this.physics.reset(this._safeSpawn(MENU_SPAWN));
    this.aircraft.setVisible(true);
    this.aircraft.sync(this.physics);
    this.trails.clear();
    this.enemies.clear();
    this.desertTanks?.clear();
    this.weapons.clear();
    this.explosions.clear();
    this._carrierLaunch = null;
    if (this.carrier) this.carrier.group.visible = false;
    this.hud.setCarrierBanner(null);
    this.hud.updateMissileCam(null);
    this.target = null;
    this.autopilot = false;
    this._aiFire = false;
    this._aiMissile = false;
    this._aiFlare = false;
    this._aiTarget = null;
    this._aiTargetTimer = 0;
    // Fire-and-forget engagement memory: enemies that already have an AI missile
    // inbound are deprioritized for ~5.5 s so the AI switches targets immediately.
    this._aiEngagedTargets = new Map();
    this._aiDefendTimer = 0;
    this._aiDefendCooldown = 0;
    this._aiDefendSide = 1;
    this._aiTerrainEvade = false;
    this._aiLockAnnounced = false;
    this._aiLockToneFresh = false;
    this.hud.setAutopilot(false);
    this._clearAutoLock();
    this._exitPointerLock();
    this.cockpit?.setVisible(false);
    this.aircraft.setCockpitHidden(false);
    this.chase.setCinematic(true);
    this.chase.snapTo(this.physics);
    this.hud.showHelp(false);
    this.hud.hideMissionResult();
    this.hud.setPhase('menu');
    this.hud.setMuted(this.muted);
    this._mission = null;
    this.hud.setMission(null);
    this.hud.setContinueEnabled(this._hasSave());
    this.menuTime = 0;
  }

  _bindWindowEvents() {
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    document.addEventListener('fullscreenchange', this._onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this._onFullscreenChange);
    window.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    this.canvas.addEventListener(
      'pointerdown',
      () => {
        this.audio.resume();
        // A click on the canvas is a user gesture, so it can re-acquire the
        // pointer after Esc, alt-tab or a menu visit.
        if (this.state === 'flying') this._requestPointerLock();
      },
      { passive: true }
    );
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this._fatal(new Error('WebGL context lost. Reload to continue.'));
    });
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.chase.resize(w / h);
    this.renderer.setSize(w, h, false);
    this.hud.resize();
    if (this.trails) this.trails.setPixelRatio(this.renderer.getPixelRatio());
  }

  _onVisibility() {
    if (document.hidden && this.state === 'flying') {
      this._wasFlyingBeforeHide = true;
      this._pause();
    } else if (!document.hidden && this._wasFlyingBeforeHide) {
      this._wasFlyingBeforeHide = false;
    }
  }

  _onKeyDown(event) {
    const code = event.code;
    if (this.state === 'menu' && (code === 'Enter' || code === 'Space') && this.ready) {
      event.preventDefault();
      if (this.hud.subScreen === 'hangar') {
        if (this.hud.hangarSelected) this._launchAircraft(this.hud.hangarSelected);
      } else if (this.hud.subScreen === 'campaign') {
        this._launchMission(this.hud.campaignSelected);
      } else if (!this.hud.subScreen) {
        this.hud.showAircraftSelect(true, {
          unlocked: this.progress.unlocked,
          selected: this.selectedAircraftId,
          mission: this.progress.mission,
          points: this.progress.points,
          unlockedMissiles: this.progress.unlockedMissiles,
          selectedMissile: this.selectedMissileId,
        });
      }
      return;
    }
    if (this.state === 'menu' && code === 'Escape' && this.hud.subScreen) {
      event.preventDefault();
      this.hud.closeSubScreen();
      return;
    }
    if (this.state === 'flying') {
      if (this.hud.isChatOpen()) {
        // While typing inside the in-flight chat bar, ignore flight shortcuts.
        return;
      }
      if (code === 'Enter') {
        event.preventDefault();
        this._openFlightChat();
        return;
      }
      if (code === 'KeyR') {
        event.preventDefault();
        this._resetCamera();
        return;
      }
      return;
    }
    if (this.state === 'paused') {
      if (code === 'Escape' || code === 'KeyP') {
        event.preventDefault();
        // While the Setting panel is open, Escape backs out to the pause
        // menu instead of dropping straight back into the cockpit.
        if (this.hud.subScreen) this.hud.closeSubScreen();
        else this._resume();
      } else if (code === 'KeyL') {
        event.preventDefault();
        this._toggleAutoLock();
      } else if (code === 'KeyM') {
        this._toggleMute();
      } else if (code === 'KeyH') {
        this._toggleHelp();
      }
      return;
    }
    if (this.state === 'crashed') {
      if (code === 'Enter' || code === 'Escape') {
        event.preventDefault();
        this._respawn();
      } else if (code === 'KeyM') {
        this._toggleMute();
      }
    }
  }

  /**
   * Hangar "TERBANG" (NEW GAME): resets story missions back to Mission 1 (index 0)
   * while keeping all unlocked aircraft, earned Points (PTS), and unlocked missiles,
   * then launches from the 3D Aircraft Carrier!
   */
  _launchAircraft(id) {
    const craft = getAircraft(id ?? this.selectedAircraftId);
    this.selectedAircraftId = craft.id;
    this.progress = resetMissionsForNewGame(this.progress, {
      aircraft: craft.id,
      missile: this.selectedMissileId,
    });
    this.weapons?.setMissileType(this.selectedMissileId);
    this.hud.setContinueEnabled(this._hasSave());
    this.audio.uiBlip(760, 0.08);
    this.hud.showAircraftSelect(false);
    this.missionIndex = 0;
    return this.ready
      ? this._launchMission(0, { carrierLaunch: true })
      : undefined;
  }

  /** Equips an already-unlocked missile mode in the Hangar. */
  _selectMissile(id) {
    const spec = getMissile(id);
    this.selectedMissileId = spec.id;
    this.progress = saveProgress({ missile: spec.id });
    this.weapons?.setMissileType(spec.id);
    this.audio.uiBlip(740, 0.05);
    this.hud.showToast(`MISSILE · ${spec.name}`);
  }

  /** Spends Points (PTS) to unlock and equip a locked missile mode in the Hangar. */
  _unlockMissile(id) {
    const res = unlockMissile(this.progress, id);
    if (!res.ok) {
      this.audio.uiBlip(240, 0.08);
      this.hud.showToast(
        `POINT KURANG ${res.need ?? 0} PTS · SELESAIKAN MISI UNTUK DAPAT POINT!`
      );
      return;
    }
    this.progress = res.progress;
    this.selectedMissileId = res.missile.id;
    this.weapons?.setMissileType(res.missile.id);
    this.hud.renderHangarMissiles({
      points: this.progress.points,
      unlockedMissiles: this.progress.unlockedMissiles,
      selectedMissile: this.selectedMissileId,
    });
    this.audio.uiBlip(960, 0.12);
    this.hud.showToast(`MISSILE TERBUKA · ${res.missile.name}!`);
  }

  /** Main-menu MULTIPLAYER ONLINE: open the Co-Op / Versus Room Code lobby. */
  _openMultiplayer() {
    if (!this.ready) return;
    this.audio.uiBlip(680, 0.07);
    if (this.multiplayer) {
      if (!this.multiplayer.active || this.multiplayer.isHost) {
        this.multiplayer.mapId = this.mapId;
      }
      this.multiplayer.localAircraftId = this.selectedAircraftId;
    }
    const rooms = this.multiplayer?.refreshRoomList() || [];
    this.hud.setMultiplayerRoomList(rooms);
    this.hud.setMultiplayerAircraft(this.selectedAircraftId);
    this.hud.showMultiplayer(true, this.multiplayer?.getRoomSummary());
    if (this.multiplayer && !this.multiplayer.hasProfile()) {
      this.hud.showMultiplayerProfileGate(true, this.multiplayer.callsign);
    } else {
      this.hud.showMultiplayerProfileGate(false);
    }
  }

  /** Saves the player's pilot profile name before entering Multiplayer. */
  _saveMultiplayerProfile(rawName) {
    const clean = String(rawName || '')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 12);
    if (clean.length < 2) {
      this.audio?.uiBlip(240, 0.08);
      this.hud?.showToast('NAMA PROFIL MINIMAL 2 KARAKTER (HURUF/ANGKA)');
      return false;
    }
    this.multiplayer?.setCallsign(clean);
    this.hud?.showMultiplayerProfileGate(false);
    this.hud?.setMultiplayerStatus(this.multiplayer?.getRoomSummary());
    this.audio?.uiBlip(840, 0.08);
    this.hud?.showToast(`PROFIL PILOT AKTIF · ${clean}`);
    return true;
  }

  /** Selects the player's team ('blue' | 'red') in Team 3 vs 3 lobby. */
  _setMultiplayerTeam(team) {
    if (!this.multiplayer) return;
    if (this._isInBattle()) {
      this.audio?.uiBlip(240, 0.06);
      this.hud?.showToast('GANTI TIM DINONAKTIFKAN SAAT PERTARUNGAN');
      return;
    }
    const ok = this.multiplayer.setTeam(team);
    if (!ok) {
      this.audio?.uiBlip(240, 0.07);
      this.hud?.showToast('TIM SUDAH PENUH (MAKS 3 PILOT)');
      return;
    }
    this.audio?.uiBlip(740, 0.06);
    this.hud?.setMultiplayerStatus(this.multiplayer.getRoomSummary());
    this.hud?.showToast(`BERGABUNG · ${team === 'red' ? 'TIM MERAH' : 'TIM BIRU'}`);
  }

  /** Ends the active online match and displays the Victory / Scoreboard overlay. */
  _onMultiplayerMatchOver(result) {
    if (!result) return;
    this.state = 'debrief';
    this.input.setEnabled(false);
    this.input.clearKeys();
    this._exitPointerLock();
    this._clearAutoLock();
    if (this.mobile) this.mobile.setVisible(false);
    this.audio?.setPaused(true);
    this.audio?.uiBlip(960, 0.18);
    const localWon =
      (result.winnerType === 'player' && result.winnerId === this.multiplayer?.peerId) ||
      (result.winnerType === 'team' && result.winnerTeam === this.multiplayer?.localTeam);
    const earnedPts = (localWon ? 320 : 140) + Math.max(0, this.kills) * 25;
    const ptsOut = awardPoints(this.progress, earnedPts);
    this.progress = ptsOut.progress;
    this.hud?.showMultiplayerResult(result, this.multiplayer?.getRoomSummary());
    const label =
      result.winnerType === 'draw'
        ? `PERTANDINGAN SELESAI · SERI (+${ptsOut.added} PTS)`
        : `PEMENANG · ${result.winnerName} (+${ptsOut.added} PTS)`;
    this.hud?.showToast(label, 5200);
  }

  _multiplayerResultToLobby() {
    this.hud?.hideMultiplayerResult();
    if (this.multiplayer?.active) {
      this.multiplayer.matchEnded = false;
      this.multiplayer.matchResult = null;
      this.multiplayer.localReady = this.multiplayer.isHost;
    }
    this.state = 'menu';
    this.input.setEnabled(false);
    this.input.clearKeys();
    this._prepareMenu();
    this._openMultiplayer();
  }

  _multiplayerResultToMenu() {
    this.hud?.hideMultiplayerResult();
    if (this.multiplayer?.active) {
      this.multiplayer.leaveRoom();
    }
    this.state = 'menu';
    this.input.setEnabled(false);
    this.input.clearKeys();
    this._prepareMenu();
    this.hud?.showToast('KELUAR DARI ROOM · KEMBALI KE MENU UTAMA');
  }

  /** Selects the player's airframe directly from the Multiplayer lobby. */
  _setMultiplayerAircraft(id) {
    if (this._isInBattle()) {
      this.audio?.uiBlip(240, 0.06);
      this.hud?.showToast('GANTI PESAWAT DINONAKTIFKAN SAAT PERTARUNGAN');
      return;
    }
    const craft = getAircraft(id);
    this.selectedAircraftId = craft.id;
    this.progress = saveProgress({ aircraft: craft.id });
    this.physics?.setStats(craft.stats);
    this.aircraft?.setVariant(craft);
    this.multiplayer?.setAircraftId(craft.id);
    this.hud?.setMultiplayerAircraft(craft.id);
    this.hud?.setMultiplayerStatus(this.multiplayer?.getRoomSummary());
    this.audio?.uiBlip(740, 0.06);
    this.hud?.showToast(`PESAWAT LOBI · ${craft.name}`);
  }

  _refreshMultiplayerRooms(showFeedback = false) {
    if (!this.multiplayer) return;
    const rooms = this.multiplayer.refreshRoomList();
    this.hud.setMultiplayerRoomList(rooms);
    if (showFeedback) {
      this.audio.uiBlip(720, 0.05);
      this.hud.showToast(
        rooms.length > 0
          ? `${rooms.length} ROOM AKTIF DITEMUKAN`
          : 'MEMINDAI ROOM AKTIF · BELUM ADA ROOM TERDETEKSI'
      );
    }
  }

  _toggleMultiplayerReady() {
    if (!this.multiplayer?.active || this.multiplayer.isHost) return;
    const ready = this.multiplayer.toggleReady();
    this.audio.uiBlip(ready ? 900 : 480, 0.07);
    this.hud.setMultiplayerStatus(this.multiplayer.getRoomSummary());
    if (ready && !this.multiplayer.matchStarted) {
      this.hud.showToast('STATUS READY · MENUNGGU HOST MEMULAI PERMAINAN');
    } else if (!ready) {
      this.hud.showToast('STATUS READY DIBATALKAN');
    }
  }

  async _onHostStartMatch({ mapId, mode, localReady } = {}) {
    if (!this.ready || !this.multiplayer?.active || this.multiplayer.isHost) return;
    if (!localReady) {
      this.audio?.uiBlip(840, 0.09);
      this.hud?.setMultiplayerStatus(this.multiplayer.getRoomSummary());
      this.hud?.showToast('HOST MEMULAI PERMAINAN · TEKAN READY UNTUK MASUK');
      return;
    }
    if (this.state === 'flying') return;

    if (mapId && mapId !== this.mapId) {
      this._mpMapSynced = true;
      this.hud.showMultiplayer(false);
      await this._setMap(mapId, { behavior: 'launch', silent: false, force: true });
    } else if (this._switchingMap && this._mapSwitchPromise) {
      this._launchAfterMapSwitch = true;
      this.hud.showMultiplayer(false);
      await this._mapSwitchPromise;
      if (this.state !== 'flying') this._startFlight({ force: true });
    } else {
      this.hud.showMultiplayer(false);
      this.hud.setWorldLoading(false);
      this._startFlight({ force: true });
    }

    const modeName =
      mode === 'team'
        ? 'TIM 3 VS 3 (40 SKOR)'
        : mode === 'versus'
          ? 'VERSUS PvP (TARGET 20)'
          : 'CO-OP ONLINE';
    this.hud.showToast(`${modeName} · ROOM ${this.multiplayer.roomCode} DIMULAI`);
  }

  async _createMultiplayerRoom(code) {
    if (!this.multiplayer) return;
    this.audio.uiBlip(780, 0.08);
    if (this.hud.mpCallsignInput?.value) {
      this.multiplayer.setCallsign(this.hud.mpCallsignInput.value);
    }
    this._mpMapSynced = true;
    const roomCode = await this.multiplayer.createRoom({
      code,
      mode: this.multiplayer.mode,
      mapId: this.mapId,
      allowBandits: this.multiplayer.allowBandits,
    });
    this.hud.setMap(this.mapId);
    this.hud.setMultiplayerStatus(this.multiplayer.getRoomSummary());
    this.hud.showToast(`ROOM ${roomCode} AKTIF · BAGIKAN KODE KE TEMAN`);
  }

  async _joinMultiplayerRoom(code) {
    if (!this.multiplayer) return;
    if (this.hud.mpCallsignInput?.value) {
      this.multiplayer.setCallsign(this.hud.mpCallsignInput.value);
    }
    this._mpMapSynced = false;
    const ok = await this.multiplayer.joinRoom({
      code,
      mode: this.multiplayer.mode,
      mapId: this.mapId,
    });
    this.audio.uiBlip(ok ? 820 : 240, 0.08);
    this.hud.setMultiplayerStatus(this.multiplayer.getRoomSummary());
    if (ok) {
      this.hud.showToast(`GABUNG ROOM ${this.multiplayer.roomCode} · TEKAN READY UNTUK SIAP`);
    } else {
      this.hud.showToast('MASUKKAN KODE ROOM MINIMAL 3 KARAKTER');
    }
  }

  _copyMultiplayerCode() {
    const code = this.multiplayer?.roomCode;
    if (!code) {
      this.hud.showToast('BELUM ADA ROOM AKTIF');
      return;
    }
    try {
      navigator.clipboard?.writeText(code);
    } catch {
      /* ignore */
    }
    this.audio.uiBlip(840, 0.06);
    this.hud.showToast(`KODE ROOM DISALIN · ${code}`);
  }

  _leaveMultiplayerRoom() {
    if (!this.multiplayer?.active) return;
    this.multiplayer.leaveRoom();
    this.audio.uiBlip(420, 0.07);
    this.hud.setMultiplayerStatus(this.multiplayer.getRoomSummary());
    this.hud.showToast('KELUAR DARI ROOM ONLINE');
  }

  async _launchMultiplayerSortie() {
    if (!this.ready) return;
    // Guests cannot start the match directly: the primary button toggles READY.
    if (this.multiplayer?.active && !this.multiplayer.isHost) {
      this._toggleMultiplayerReady();
      return;
    }
    if (this.multiplayer && !this.multiplayer.active) {
      await this._createMultiplayerRoom(this.hud.mpRoomInput?.value || '');
    }
    // Host broadcasts start-match so READY guests launch into battle together.
    this.multiplayer?.startMatch();
    // Wait for any in-progress map sync to finish before launching flight so
    // the loading/menu overlay never re-appears over the sortie.
    if (this._switchingMap && this._mapSwitchPromise) {
      this._launchAfterMapSwitch = true;
      this.hud.showMultiplayer(false);
      await this._mapSwitchPromise;
      if (this.state !== 'flying') {
        this._startFlight({ force: true });
      }
    } else {
      this.hud.showMultiplayer(false);
      this.hud.setWorldLoading(false);
      this._startFlight({ force: true });
    }
    if (this.multiplayer?.active) {
      const modeName =
        this.multiplayer.mode === 'team'
          ? 'TIM 3 VS 3 (40 SKOR)'
          : this.multiplayer.mode === 'versus'
            ? 'VERSUS PvP (TARGET 20)'
            : 'CO-OP ONLINE';
      this.hud.showToast(`${modeName} · ROOM ${this.multiplayer.roomCode}`);
    }
  }

  /** Main-menu DAFTAR MISI: open the story campaign browser. */
  _openCampaign() {
    if (!this.ready || this.state !== 'menu') return;
    this.audio.uiBlip(660, 0.06);
    this.hud.showCampaign(true, {
      mission: this.progress.mission,
      unlocked: this.progress.unlocked,
      selected: this._campaignSelected ?? this.missionIndex,
      map: this.mapId,
    });
  }

  /**
   * Launch one campaign mission, switching the world map first when the
   * mission is set somewhere else. The switch happens in place — no reload.
   */
  _launchMission(index, { carrierLaunch = false } = {}) {
    if (!this.ready || this._switchingMap) return undefined;
    const clamped = Math.max(0, Math.min(MISSIONS.length - 1, Math.floor(Number(index) || 0)));
    if (!isMissionPlayable(this.progress, clamped)) {
      this.audio.uiBlip(220, 0.08);
      this.hud.showToast('MISI MASIH TERKUNCI');
      return undefined;
    }
    const mission = MISSIONS[clamped];
    this.missionIndex = clamped;
    this._pendingCarrierLaunch = !!carrierLaunch;
    this.audio.uiBlip(760, 0.08);
    this.hud.hideMissionResult();
    this.hud.showCampaign(false);
    this.hud.showAircraftSelect(false);

    if (mission.map && mission.map !== this.mapId) {
      return this._setMap(mission.map, { behavior: 'launch', silent: true, force: true });
    }
    this._startFlight({ force: true, carrierLaunch });
    return undefined;
  }

  /** Debrief → main menu. */
  _missionToMenu() {
    if (!['debrief', 'paused', 'crashed'].includes(this.state)) return;
    const wasOnline = !!this.multiplayer?.active;
    if (wasOnline) this.multiplayer.leaveRoom();
    this.hud.hideMissionResult();
    this.state = 'menu';
    this.input.setEnabled(false);
    this.input.clearKeys();
    this.hud.setPhase('menu');
    this._prepareMenu();
    this.hud.showToast(wasOnline ? 'KELUAR DARI ROOM · KEMBALI KE MENU UTAMA' : 'KEMBALI KE MENU UTAMA');
  }

  /** A career counts as saved once a mission was cleared or a sortie flown. */
  _hasSave() {
    return this.progress.mission > 0 || this.progress.best.kills > 0 || this.progress.best.score > 0;
  }

  /** CONTINUE: jump straight back into the next mission with the saved jet. */
  _continueGame() {
    if (!this._hasSave() || !this.ready) return;
    this.selectedAircraftId = this.progress.aircraft;
    this.audio.uiBlip(720, 0.08);
    this.hud.showAircraftSelect(false);
    this.missionIndex = this.progress.mission;
    return this._launchMission(this.progress.mission);
  }

  /** Start-screen counters for the live world (land maps count one mainland). */
  _worldFacts() {
    const stats = this.world.getStats();
    const area = Math.round(
      this.world.islands.islands.reduce(
        (sum, island) => sum + Math.PI * island.coastRadius * island.coastRadius,
        0
      ) / 1_000_000
    );
    return {
      islands: stats.islands,
      land: stats.land,
      trees: stats.trees,
      area: Math.max(1, area),
      cloudPuffs: stats.cloudPuffs,
    };
  }

  /**
   * Spawn a few hundred metres above the local surface so a map with tall
   * mountains never drops the jet inside a ridge.
   */
  _safeSpawn(base = SPAWN) {
    const x = base.position.x;
    const z = base.position.z;
    const heading = base.heading ?? 0;
    const dirX = Math.sin(heading);
    const dirZ = -Math.cos(heading);
    let ground = Math.max(
      this.world.getHeightAt(x, z),
      this.world.getWaveHeightAt ? this.world.getWaveHeightAt(x, z) : 0
    );
    if (this.world.land) {
      for (const d of [250, 500, 800, 1100, 1500]) {
        const gx = x + dirX * d;
        const gz = z + dirZ * d;
        ground = Math.max(
          ground,
          this.world.getHeightAt(gx, gz),
          this.world.getHeightAt(gx - 220, gz),
          this.world.getHeightAt(gx + 220, gz)
        );
      }
    }
    const clearance = this.world.land ? 460 : 380;
    return {
      position: new THREE.Vector3(x, Math.max(base.position.y, ground + clearance), z),
      heading: base.heading,
      speed: base.speed,
    };
  }

  /** EXIT: ask the browser to close the tab; explain if it refuses. */
  _exitGame() {
    if (this.multiplayer?.active) this.multiplayer.leaveRoom();
    try {
      window.close();
    } catch {
      /* browsers block close() for non-script-opened tabs */
    }
    const note = document.getElementById('exit-note');
    if (note) {
      note.textContent = window.closed
        ? 'SESI DIHENTIKAN · SAMPAI JUMPA DI LANGIT.'
        : 'Browser memblokir penutupan otomatis — tutup tab ini secara manual.';
    }
    if (window.closed) {
      this.input.setEnabled(false);
      if (this.mobile) this.mobile.setVisible(false);
    }
  }

  _startFlight({ fromPause = false, force = false, isRespawn = false, carrierLaunch = false } = {}) {
    if (!this.ready) return;
    if (this.state === 'flying' && !force) return;
    this.audio.init();
    this.audio.setMuted(this.muted);
    this.audio.setPaused(false);
    this.audio.uiBlip(720, 0.09);

    this.hud.showHelp(false);
    this.hud.hideMultiplayerResult?.();
    this.hud.setWorldLoading(false);
    this.hud.setPhase('flying');
    this.input.setEnabled(true);
    this.input.throttle = 0.68;
    this.input.clearKeys();
    this.input.consumeLook();
    if (this.mobile) this.mobile.setVisible(this.touch);

    const craft = getAircraft(this.selectedAircraftId);
    this.physics.setStats(craft.stats);
    this.aircraft.setVariant(craft);
    this.hullMax = craft.stats.hull;
    this.weapons.setMissileType(this.selectedMissileId);

    const useCarrier = !!(carrierLaunch && !this.multiplayer?.active && !isRespawn && !fromPause);
    this._pendingCarrierLaunch = false;
    this._carrierLaunch = null;
    this.hud.setCarrierBanner(null);

    if (useCarrier && this.carrier) {
      this._beginCarrierLaunch();
    } else {
      if (this.carrier) this.carrier.group.visible = false;
      const spawnBase = this.multiplayer?.active
        ? this.multiplayer.getSpawnTransform(isRespawn)
        : SPAWN;
      this.physics.reset(this._safeSpawn(spawnBase));
    }
    this.aircraft.setVisible(true);
    this.aircraft.sync(this.physics);
    this.trails.clear();
    this.weapons.clear();
    this.weapons.setMissileType(this.selectedMissileId);
    this.explosions.clear();
    this.hud.updateMissileCam(null);
    if (!this.multiplayer || this.multiplayer.shouldSpawnBandits()) {
      this.enemies.reset(this.physics.position);
      this.desertTanks?.setWorld(this.world);
      this.desertTanks?.spawn(this.physics.position);
    } else {
      this.enemies.clear();
      this.desertTanks?.clear();
    }
    this.score = 0;
    this.kills = 0;
    this.hull = this.hullMax;
    this.target = null;
    this._lockProgress = 0;
    this._targetLocked = false;
    this._lockedTone = false;
    this._aiMissileCooldown = 0;
    this._aiTarget = null;
    this._aiTargetTimer = 0;
    // Fire-and-forget engagement memory: enemies that already have an AI missile
    // inbound are deprioritized for ~5.5 s so the AI switches targets immediately.
    this._aiEngagedTargets = new Map();
    this._aiDefendTimer = 0;
    this._aiDefendCooldown = 0;
    this._aiDefendSide = 1;
    this._aiTerrainEvade = false;
    this._aiLockAnnounced = false;
    this._clearAutoLock();
    this.chase.setCinematic(false);
    this.chase.snapTo(this.physics);
    this.chase.addCrashShake(0);

    this.sessionTime = 0;
    this.state = 'flying';
    this._respawnTimer = 0;
    this.hud.setHudEdit(false);
    this.input.recalibrateGyro();
    this._applyCockpitVisibility();
    this.hud.setCombat({
      score: 0,
      kills: 0,
      hull: this.hull,
      hullMax: this.hullMax,
      missiles: this.weapons.missilesLeft,
    });
    this._mission = this.multiplayer?.active ? null : missionAt(this.missionIndex, this.progress);
    this._missionDone = false;
    this.hud.setMission(this._mission, 0, 0);
    // Refresh world lighting & atmosphere immediately for the new spawn position.
    this.world.update(0.016, this.camera, this.physics.position);
    this.hud.showToast(
      this._mission
        ? `${craft.name} · MISI ${pad(this.missionIndex + 1, 2)} · ${this._mission.name} · ${missionObjective(this._mission)}`
        : `${craft.name} · ${fromPause ? 'SORTIE RESTARTED' : 'CLEARED FOR LAUNCH'} · SECTOR 07`
    );
    this._requestPointerLock();
  }

  /**
   * Objective check: every listed bandit destroyed, plus the survival clock
   * when the mission asks for one. Cleared missions bank their airframe,
   * advance the story and open the debrief screen.
   */
  _checkMission() {
    if (this._missionDone || !this._mission) return;
    const killsDone = this.kills >= this._mission.kills;
    const surviveDone = !this._mission.survive || this.sessionTime >= this._mission.survive;
    if (!killsDone || !surviveDone) {
      this.hud.setMission(this._mission, this.kills, this.sessionTime);
      return;
    }

    this._missionDone = true;
    this.state = 'debrief';
    this.input.setEnabled(false);
    this.input.clearKeys();
    this._exitPointerLock();
    this._clearAutoLock();
    if (this.mobile) this.mobile.setVisible(false);
    this.audio.setPaused(true);

    const outcome = completeMission(this.progress, this.missionIndex, {
      score: this.score,
      kills: this.kills,
    });
    this.progress = outcome.progress;
    this.hud.setMission(null);
    this.hud.setContinueEnabled(this._hasSave());

    const next = MISSIONS[this.progress.mission] ?? null;
    const cleared = this.missionIndex + 1;
    const unlockId = outcome.unlocked[0];
    const unlockName = unlockId ? getAircraft(unlockId).name : null;
    this.audio.uiBlip(940, 0.16);
    if (unlockName) {
      this.hud.showToast(`MISI ${pad(cleared, 2)} SELESAI · ${unlockName} TERBUKA`, 5200);
    } else if (outcome.complete) {
      this.hud.showToast('KAMPANYE TUNTAS · SEMUA PESAWAT TERBUKA', 5200);
    } else {
      this.hud.showToast(`MISI ${pad(cleared, 2)} SELESAI`, 5200);
    }

    this.hud.showMissionResult({
      mission: this._mission,
      next,
      unlocked: outcome.unlocked,
      rewardPoints: outcome.rewardPoints,
      totalPoints: outcome.progress.points,
      kills: this.kills,
      score: this.score,
      time: this.sessionTime,
      complete: outcome.complete,
    });
  }

  /** Positions USS SKYBOUND (CVN-07) and arms the steam catapult takeoff sequence. */
  _beginCarrierLaunch() {
    if (!this.carrier || !this.world) return;
    const cx = 0;
    const cz = 1480;
    const baseY = this.world.land ? Math.max(0, this.world.getHeightAt(cx, cz)) + 2 : 0;
    this.carrier.placeAt(cx, baseY, cz);
    this.carrier.setBlastDeflector(true);
    const anchor = this.carrier.getLaunchAnchor();

    this.physics.reset({
      position: anchor.start.clone(),
      heading: 0,
      speed: 0,
    });
    this.physics.throttle = 1;
    this.physics.afterburner = 1;
    this._carrierLaunch = {
      active: true,
      elapsed: 0,
      anchor,
    };
    this.hud.setCarrierBanner('CVN-07 SKYBOUND · KATAPEL SIAP · FULL AFTERBURNER');
  }

  /**
   * Drives the 3-phase Top Gun-style Aircraft Carrier catapult takeoff:
   *  - 0.0–0.9 s: afterburner spool-up on deck behind raised blast deflector
   *  - 0.9–2.9 s: steam catapult acceleration down the 174 m flight deck
   *  - 2.9–3.8 s: clears bow, pitches up cleanly (+14°) and climbs into free flight
   */
  _updateCarrierLaunch(dt) {
    const cl = this._carrierLaunch;
    if (!cl || !cl.active) return false;
    cl.elapsed += dt;
    const t = cl.elapsed;
    const { start, bow } = cl.anchor;

    if (t < 0.9) {
      // Phase 1: Spool up engines on deck with steam blowing.
      this.physics.position.copy(start);
      this.physics.quaternion.identity();
      this.physics.speed = 0;
      this.physics.velocity.set(0, 0, 0);
      this.physics.throttle = 1;
      this.physics.afterburner = 1;
      this.chase.addCrashShake(0.05);
      this.carrier?.update(dt, true, 56);
      this.hud.setCarrierBanner('CVN-07 SKYBOUND · KATAPEL SIAP · FULL AFTERBURNER');
      return true;
    }

    if (t < 2.9) {
      // Phase 2: Catapult sprint down the carrier flight deck!
      const u = clamp((t - 0.9) / 2.0, 0, 1);
      const ease = u * u;
      this.physics.position.lerpVectors(start, bow, ease);
      this.physics.quaternion.identity();
      const spd = 25 + u * 155;
      this.physics.speed = spd;
      this.physics.velocity.set(0, 0, -spd);
      this.physics.throttle = 1;
      this.physics.afterburner = 1;
      this.chase.addCrashShake(0.14);
      const localZ = this.physics.position.z - this.carrier.group.position.z;
      this.carrier?.update(dt, true, localZ);
      this.hud.setCarrierBanner('CVN-07 SKYBOUND · CATAPULT LAUNCH!!');
      return true;
    }

    if (t < 3.8) {
      // Phase 3: Bow liftoff & climb out over open sea!
      const u = clamp((t - 2.9) / 0.9, 0, 1);
      const pitchRad = THREE.MathUtils.degToRad(14 * Math.sin(u * Math.PI * 0.5));
      this._mCamEuler.set(pitchRad, 0, 0, 'YXZ');
      this.physics.quaternion.setFromEuler(this._mCamEuler);
      const spd = 180 + u * 30;
      this.physics.speed = spd;
      _fwdVec.set(0, 0, -1).applyQuaternion(this.physics.quaternion);
      this.physics.velocity.copy(_fwdVec).multiplyScalar(spd);
      this.physics.position.addScaledVector(this.physics.velocity, dt);
      this.physics.throttle = 0.92;
      this.physics.afterburner = 0.65 * (1 - u);
      this.carrier?.setBlastDeflector(false);
      this.carrier?.update(dt, false, -110);
      this.hud.setCarrierBanner('AIRBORNE · CLEARED TO ENGAGE!');
      return true;
    }

    // Takeoff finished — hand seamless control back to the pilot!
    cl.active = false;
    this._carrierLaunch = null;
    this.carrier?.setBlastDeflector(false);
    this.hud.setCarrierBanner(null);
    return false;
  }

  _togglePause() {
    if (this.state === 'flying') this._pause();
    else if (this.state === 'paused') this._resume();
  }

  _pause() {
    if (this.state !== 'flying') return;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.input.consumeLook();
    this.hud.showHelp(false);
    this.hud.showPause(true);
    this.audio.setPaused(true);
    if (this.mobile) this.mobile.setVisible(false);
    // The pointer must be released with the pause menu so the player can use
    // the cursor on its buttons.
    this._exitPointerLock();
    this._clearAutoLock();
  }

  _resume() {
    if (this.state !== 'paused') return;
    this.state = 'flying';
    this.input.setEnabled(true);
    this.hud.showPause(false);
    this.hud.setHudEdit(false);
    // The view may have been cycled while paused — re-apply cockpit/airframe.
    this._applyCockpitVisibility();
    this.audio.setPaused(false);
    this.audio.uiBlip(540, 0.07);
    if (this.mobile) this.mobile.setVisible(this.touch);
    this._requestPointerLock();
  }

  /** PAUSE → RESTART SORTIE: disabled in Multiplayer to preserve room state. */
  _restartSortie() {
    if (this.multiplayer?.active) {
      this.audio?.uiBlip(240, 0.07);
      this.hud?.showToast('RESTART SORTIE DINONAKTIFKAN DI MULTIPLAYER');
      return;
    }
    this._startFlight({ fromPause: true });
  }

  /** PAUSE → KEMBALI KE MENU: park the jet, leave any online room, and return to menu. */
  _returnToMenu() {
    if (this.state !== 'paused') return;
    const wasOnline = !!this.multiplayer?.active;
    if (wasOnline) {
      this.multiplayer.leaveRoom();
    }
    let earnedPts = 0;
    if (this.kills > 0 && !this._missionDone) {
      const out = awardPoints(this.progress, this.kills * 20);
      this.progress = out.progress;
      earnedPts = out.added;
    }
    this.state = 'menu';
    this.input.setEnabled(false);
    this.input.clearKeys();
    this.input.consumeLook();
    this.audio.setPaused(false);
    if (this.mobile) this.mobile.setVisible(false);
    // Close any pause sub-screen (the Setting panel) before the menu reset,
    // otherwise the start screen would stay hidden behind it.
    this.hud.closeSubScreen();
    this._prepareMenu();
    const ptsSuffix = earnedPts > 0 ? ` (+${earnedPts} PTS)` : '';
    this.hud.showToast(
      (wasOnline ? 'KELUAR DARI ROOM · KEMBALI KE MENU UTAMA' : 'KEMBALI KE MENU UTAMA') + ptsSuffix
    );
  }

  _respawn() {
    if (this.state !== 'crashed') return;
    if (this.multiplayer?.matchEnded) return;
    this._startFlight({ isRespawn: true });
    this.hud.showToast('AIRFRAME REPLACED · REDEPLOYED');
  }

  _toggleMute() {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.hud.setMuted(this.muted);
    try {
      window.localStorage.setItem('skybound.muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!this.muted) this.audio.uiBlip(760, 0.07);
  }

  _cycleCamera() {
    if (this.state !== 'flying' && this.state !== 'paused') return;
    const view = this.chase.cycleView();
    if (this.physics && this.world) {
      this.chase.update(0, this.physics, this.world);
    }
    this.hud.setCameraMode(view);
    this.hud.showToast(['VIEW · CHASE', 'VIEW · COCKPIT'][view]);
    this._applyCockpitVisibility();
    this.audio.uiBlip(620 + view * 70, 0.05);
  }

  /** Resets chase camera orbit, zoom, and auto-lock back behind the jet (`R`). */
  _resetCamera() {
    if (this.state !== 'flying' && this.state !== 'paused') return;
    this._clearAutoLock();
    this.chase.resetOrbit();
    if (this.physics && this.world) {
      this.chase.update(0, this.physics, this.world);
    }
    this.hud.showToast('KAMERA RESET');
    this.audio.uiBlip(720, 0.05);
  }

  /** Opens the in-flight tactical chat/command bar (`Enter`). */
  _openFlightChat() {
    if (this.state !== 'flying' || this.hud.isChatOpen()) return;
    this.input.setEnabled(false);
    this.input.clearKeys();
    this._exitPointerLock();
    this.hud.openChat();
  }

  /** Restores flight controls & pointer lock after closing the chat bar. */
  _closeFlightChat() {
    if (this.hud.isChatOpen()) this.hud.closeChat();
    if (this.state === 'flying') {
      this.input.setEnabled(true);
      this._requestPointerLock();
    }
  }

  /**
   * Processes in-flight chat & hidden AI commands:
   *  - `/hvskbnd` -> activates AI Autopilot Mode
   *  - `/stop`    -> stops AI Autopilot Mode and returns manual control
   *  - any other text -> posts to the tactical comms chat log
   */
  _handleChatSubmit(rawText) {
    const text = String(rawText ?? '').trim();
    this._closeFlightChat();
    if (!text) return;

    const cmd = text.toLowerCase();
    if (cmd === '/hvskbnd') {
      this._setAutopilot(true);
      this.hud.addChatMessage('SYSTEM', 'AI MODE AKTIF (/hvskbnd) · ketik /stop untuk berhenti', 'system');
      this.audio.uiBlip(920, 0.07);
      return;
    }
    if (cmd === '/stop') {
      this._setAutopilot(false);
      this.hud.addChatMessage('SYSTEM', 'AI MODE DIHENTIKAN · KONTROL MANUAL', 'warn');
      this.audio.uiBlip(520, 0.07);
      return;
    }
    if (cmd.startsWith('/')) {
      this.hud.addChatMessage('SYSTEM', `Perintah tidak dikenal: ${text}`, 'warn');
      this.audio.uiBlip(340, 0.06);
      return;
    }

    const callsign = this.multiplayer?.getCallsign?.() || 'PILOT';
    this.hud.addChatMessage(callsign, text, 'msg');
    this.audio.uiBlip(660, 0.04);
  }

  /**
   * Keeps the aircraft inside the playable combat sector of the active map:
   * warns inside `[warnRadius, maxRadius]` and smoothly turns/clamps back
   * inward when crossing `maxRadius`.
   */
  _enforceMapBoundary(dt, silent = false) {
    const bounds = this.world?.getMapBounds?.();
    if (!bounds || !this.physics) {
      this._boundaryStatus = null;
      return;
    }
    const pos = this.physics.position;
    const dist = Math.hypot(pos.x, pos.z);
    const warning = dist >= bounds.warnRadius;
    const outOfBounds = dist >= bounds.maxRadius;
    this._boundaryStatus = {
      dist,
      warnRadius: bounds.warnRadius,
      maxRadius: bounds.maxRadius,
      warning,
      outOfBounds,
    };

    if (!outOfBounds) return;

    // Smoothly turn the jet back toward map center (0, pos.y, 0).
    this._boundaryCenter.set(0, pos.y, 0);
    this._boundaryMat.lookAt(pos, this._boundaryCenter, this._boundaryUp);
    this._boundaryQuat.setFromRotationMatrix(this._boundaryMat);
    const turnAlpha = 1 - Math.exp(-3.2 * Math.max(dt, 1 / 60));
    this.physics.quaternion.slerp(this._boundaryQuat, turnAlpha).normalize();

    const spd = this.physics.velocity.length();
    if (spd > 1) {
      _fwdVec.set(0, 0, -1).applyQuaternion(this.physics.quaternion);
      this.physics.velocity.copy(_fwdVec).multiplyScalar(spd);
    }

    // Hard radial ceiling prevents escaping the map edge at max afterburner.
    const hardLimit = bounds.maxRadius + 80;
    if (dist > hardLimit) {
      const ratio = hardLimit / dist;
      pos.x *= ratio;
      pos.z *= ratio;
    }

    if (!silent && this.time - this._boundaryToastAt > 3.2) {
      this._boundaryToastAt = this.time;
      this.hud.showToast('BATAS PETA TERCAPAI · KEMBALI KE AREA TEMPUR');
      this.audio.uiBlip(420, 0.08);
    }
  }

  /** Toggles browser fullscreen (feature-detected, silently no-ops). */
  _toggleFullscreen() {
    const api = this._fullscreen;
    if (!api.supported) {
      this.hud.showToast('FULLSCREEN NOT AVAILABLE');
      return;
    }
    try {
      if (api.active()) api.exit?.();
      else api.request?.();
    } catch (error) {
      console.warn('[SKYBOUND] fullscreen toggle failed:', error);
    }
  }

  /** Keeps the HUD button highlight in sync when the user leaves via ESC. */
  _onFullscreenChange() {
    this.hud?.setFullscreen(this._fullscreen.active());
  }

  /**
   * Pointer lock keeps the mouse inside the sortie: look is driven by raw
   * movement deltas and the cursor never leaves the canvas. Feature-guarded
   * because the API is missing in tests and on some embedded browsers.
   */
  _requestPointerLock() {
    if (this.touch || typeof document === 'undefined') return;
    if (this.state !== 'flying' || !this.canvas) return;
    if (document.pointerLockElement === this.canvas) return;
    if (typeof this.canvas.requestPointerLock !== 'function') return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      /* user gesture missing or API unavailable — the game still plays */
    }
  }

  /** Help overlays need the cursor; hand it back when the card opens. */
  _toggleHelp(show = !this.hud.helpCard.classList.contains('visible')) {
    this.hud.showHelp(show);
    if (show) this._exitPointerLock();
    else this._requestPointerLock();
  }

  _exitPointerLock() {
    if (typeof document === 'undefined') return;
    try {
      if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
        document.exitPointerLock();
      }
    } catch {
      /* ignore */
    }
    this._pointerLocked = false;
    if (this.canvas) this.canvas.style.cursor = '';
  }

  _onPointerLockChange() {
    this._pointerLocked =
      typeof document !== 'undefined' && document.pointerLockElement === this.canvas;
    if (this.canvas) this.canvas.style.cursor = this._pointerLocked ? 'none' : '';
  }

  /**
   * The cockpit view hides the player's own airframe and shows the interior.
   * Pausing keeps the current look (so cycling views behind the pause panel
   * previews the interior) — only menu/crash states force it away.
   */
  _cockpitLighting() {
    const sky = this.world?.sky;
    return {
      sunDir: sky?.sunDir,
      sunColor: sky?.sunLight?.color,
      skyColor: sky?.hemi?.color,
      groundColor: sky?.hemi?.groundColor,
      cameraQuaternion: this.camera?.quaternion,
    };
  }

  _applyCockpitVisibility() {
    const cockpit =
      this.chase.viewMode === 1 &&
      (this.state === 'flying' || this.state === 'paused');
    this.aircraft.setCockpitHidden(cockpit);
    this.cockpit?.setVisible(cockpit);
    if (cockpit) this.cockpit?.syncLighting(this._cockpitLighting(), this._incoming);
    this.hud.setCockpitView(cockpit);
  }

  _changeQuality(name) {
    storeQuality(name);
    this.hud.showToast(`GRAPHICS ${name.toUpperCase()} · REBUILDING WORLD`);
    setTimeout(() => applyQualityParam(name), 320);
  }

  /** HUD column side (left/right), persisted. */
  _setHudSide(side) {
    this.hudSide = side === 'right' ? 'right' : 'left';
    this.hud.setHudSide(this.hudSide);
    this.audio.uiBlip(600, 0.05);
    try {
      window.localStorage.setItem('skybound.hudSide', this.hudSide);
    } catch {
      /* ignore */
    }
  }

  /** Touch action-button cluster placement, persisted. */
  _setButtonLayout(layout) {
    this.buttonLayout = ['left', 'center', 'right'].includes(layout) ? layout : 'center';
    this.hud.setButtonLayout(this.buttonLayout);
    this.mobile?.setButtonLayout(this.buttonLayout);
    this.audio.uiBlip(660, 0.05);
    try {
      window.localStorage.setItem('skybound.buttonLayout', this.buttonLayout);
    } catch {
      /* ignore */
    }
  }

  /** Global HUD/menu zoom (80–160%), persisted per device. */
  _setUiScale(value) {
    this.uiScale = this.hud.setUiScale(value);
    try {
      window.localStorage.setItem('skybound.uiScale', String(this.uiScale));
    } catch {
      /* ignore */
    }
  }

  /** Auto-lock view toggle: the chase camera keeps the nearest bandit framed. */
  _setAutoLock(value) {
    const on = !!value;
    this.autoLock = on;
    this.hud.setAutoLock(on);
    if (on) {
      this._syncAutoLockTarget();
      this.hud.showToast('AUTO LOCK VIEW · AKTIF');
    } else {
      this._clearAutoLock();
      this.hud.showToast('AUTO LOCK VIEW · NONAKTIF');
    }
    this.audio.uiBlip(on ? 720 : 460, 0.06);
    try {
      window.localStorage.setItem('skybound.autoLock', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  _toggleAutoLock() {
    this._setAutoLock(!this.autoLock);
  }

  _clearAutoLock() {
    this.autoLockTarget = null;
    this.chase?.setAutoTarget(null);
  }

  /**
   * Picks the bandit the auto-lock camera should follow. The current target is
   * kept while alive; otherwise the nearest live bandit within radar range is
   * acquired so enabling the view immediately frames someone.
   */
  _syncAutoLockTarget() {
    if (!this.autoLock || !this.chase || !this.enemies) {
      this._clearAutoLock();
      return;
    }
    const player = this.physics?.position;
    if (!player) return;
    let target = null;
    if (this.autopilot && this._aiTarget && this._aiTarget.alive) {
      target = this._aiTarget;
    } else if (this.target && this.target.alive) {
      target = this.target;
    } else if (
      this.autoLockTarget &&
      this.autoLockTarget.alive &&
      this.autoLockTarget.position.distanceTo(player) <= 7000
    ) {
      target = this.autoLockTarget;
    } else {
      let best = Infinity;
      for (const enemy of this._getCombatTargets()) {
        const distance = enemy.position.distanceTo(player);
        if (distance < best && distance <= 7000) {
          best = distance;
          target = enemy;
        }
      }
    }
    this.autoLockTarget = target;
    this.chase.setAutoTarget(target);
  }

  /* --- Auto pilot (AI · aggressive) --------------------------------------- */

  /**
   * Toggles the autopilot. While it is engaged the AI takes the stick: it
   * picks a random live bandit, flies lead pursuit at full throttle with the
   * afterburner, avoids terrain and shoots when the target is on the nose.
   */
  _setAutopilot(on) {
    const active = !!on;
    this.autopilot = active;
    this._aiFire = false;
    this._aiMissile = false;
    this._aiFlare = false;
    this._aiTarget = null;
    this._aiTargetTimer = 0;
    // Fire-and-forget engagement memory: enemies that already have an AI missile
    // inbound are deprioritized for ~5.5 s so the AI switches targets immediately.
    this._aiEngagedTargets = new Map();
    this._aiDefendTimer = 0;
    this._aiDefendCooldown = 0;
    this._aiDefendSide = 1;
    this._aiTerrainEvade = false;
    this._aiLockAnnounced = false;
    this._aiLockToneFresh = false;
    this.hud.setAutopilot(active);
    this.audio.uiBlip(active ? 820 : 470, 0.07);
    this.hud.showToast(active ? 'AUTO PILOT · MODE AGGRESSIVE' : 'AUTO PILOT · KONTROL MANUAL');
    if (active) this._syncAutoLockTarget();
  }

  _toggleAutopilot() {
    this._setAutopilot(!this.autopilot);
  }

  /** Highest solid surface (terrain or wave crest) under a world position. */
  _groundHeightAt(x, z) {
    const terrain = this.world.getHeightAt(x, z);
    const wave = this.world.getWaveHeightAt ? this.world.getWaveHeightAt(x, z) : 0;
    return Math.max(terrain, wave);
  }

  /**
   * Projects the current velocity along the next few seconds and returns the
   * tightest terrain margin. `danger` arms the emergency climb; `clear`
   * releases it only once the whole projected path is comfortably high.
   */
  _aiTerrainRisk() {
    const position = this.physics.position;
    const velocity = this.physics.velocity;
    const ground0 = this._groundHeightAt(position.x, position.z);
    const agl = position.y - ground0;
    let worst = agl;
    for (const time of AI_TERRAIN_LOOKAHEAD) {
      const x = position.x + velocity.x * time;
      const z = position.z + velocity.z * time;
      const groundAt = this._groundHeightAt(x, z);
      const rise = Math.max(0, groundAt - ground0);
      if (time > 3.6 && rise < 40) continue;
      const vy = rise > 20 ? Math.min(velocity.y, 8) : velocity.y;
      const y = position.y + vy * time;
      const margin = y - groundAt - Math.min(110, rise * 0.22);
      if (margin < worst) worst = margin;
    }
    return {
      agl,
      worst,
      danger: agl < AI_TERRAIN_ESCAPE_AGL || worst < AI_TERRAIN_MARGIN,
      clear: agl > AI_TERRAIN_CLEAR_AGL && worst > AI_TERRAIN_CLEAR_MARGIN,
    };
  }

  /**
   * Chooses which bandit the autopilot works. Every live contact is scored by
   * how close it sits to the nose, how near it is and whether it is the one
   * already being hunted (stickiness, so kills get finished instead of the AI
   * flipping between targets).
   *
   * @param {object|null} current bandit the AI is currently chasing
   * @returns {object|null} the chosen target
   */
  _pickAiTarget(current = null, { avoid = null } = {}) {
    const alive = this._getCombatTargets();
    if (!alive.length) {
      this._aiTarget = null;
      this._aiTargetTimer = 0;
      return null;
    }
    // Purge expired fire-and-forget cooldown entries.
    if (this._aiEngagedTargets.size > 0) {
      for (const [enemy, expiry] of this._aiEngagedTargets) {
        if (!enemy?.alive || expiry <= this.time) this._aiEngagedTargets.delete(enemy);
      }
    }
    // Prefer fresh targets that do NOT already have an AI missile inbound.
    const fresh = alive.filter((e) => e !== avoid && !this._aiEngagedTargets.has(e));
    const fallback = alive.filter((e) => e !== avoid);
    const pool = fresh.length > 0 ? fresh : fallback.length > 0 ? fallback : alive;

    const position = this.physics.position;
    _aiFwd.set(0, 0, -1).applyQuaternion(this.physics.quaternion);
    let best = null;
    let bestScore = -Infinity;
    for (const enemy of pool) {
      _aiLockVec.subVectors(enemy.position, position);
      const d = _aiLockVec.length() || 1;
      const dot = _aiLockVec.dot(_aiFwd) / d;
      let score = dot * 1.5 - d / 3200;
      if (enemy === current && enemy !== avoid) score += 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    if (best !== this._aiTarget) this._aiLockAnnounced = false;
    this._aiTarget = best;
    this._aiTargetTimer = AI_RETARGET_TIME;
    return best;
  }

  /**
   * Gun solution against a moving target. Solves the bullet time of flight
   * iteratively with the real muzzle speed and the 45 % velocity inheritance
   * used by `Weapons`, and returns the direction the NOSE must point (written
   * to `outDir`) plus the range to the intercept point.
   */
  _gunSolution(targetPosition, targetVelocity, outDir) {
    const position = this.physics.position;
    const own = this.physics.velocity;
    let t = targetPosition.distanceTo(position) / GUN_SPEED;
    let dist = 1;
    let k = GUN_SPEED;
    for (let i = 0; i < 4; i++) {
      _aiGunQ.copy(targetPosition).addScaledVector(targetVelocity, t);
      _aiGunB.subVectors(_aiGunQ, position);
      dist = _aiGunB.length() || 1;
      _aiGunB.divideScalar(dist);
      const c = _aiGunB.dot(own) * GUN_INHERIT;
      const inh = GUN_INHERIT * own.length();
      k = c + Math.sqrt(Math.max(0, c * c - inh * inh + GUN_SPEED * GUN_SPEED));
      t = Math.min(dist / GUN_SPEED, 2);
    }
    outDir.copy(_aiGunB).multiplyScalar(k).addScaledVector(own, -GUN_INHERIT).divideScalar(GUN_SPEED).normalize();
    return dist;
  }

  /**
   * The most dangerous bandit on our six: behind the jet, close and pointing
   * its nose at us. Returns null when nobody has a shot.
   */
  _aiAssessThreat() {
    const position = this.physics.position;
    _aiFwd.set(0, 0, -1).applyQuaternion(this.physics.quaternion);
    let worst = null;
    let worstScore = 0;
    for (const enemy of this._getCombatTargets()) {
      _aiLockVec.subVectors(enemy.position, position);
      const d = _aiLockVec.length() || 1;
      if (d > 1500) continue;
      _aiLockVec.divideScalar(d);
      if (_aiLockVec.dot(_aiFwd) > 0.15) continue; // not behind us
      const pointing = enemy.direction ? -_aiLockVec.dot(enemy.direction) : 0;
      if (pointing < 0.88) continue; // not aiming at us
      const score = ((1500 - d) / 1500) * pointing;
      if (score > worstScore) {
        worstScore = score;
        worst = enemy;
      }
    }
    return worst;
  }

  /**
   * Builds the flight input for one autopilot frame. The AI flies like a
   * fighter pilot rather than a homing missile:
   *  - scored target selection with stickiness,
   *  - lead pursuit at range, exact gun-pipper tracking inside 1.5 km and lag
   *    pursuit when the closure would otherwise cause an overshoot,
   *  - bank-to-turn: roll the lift vector onto the target plane first, then
   *    pull; fine tracking switches to rudder + damped pitch,
   *  - a defensive break turn when a bandit (or missile) is on its six,
   *  - disciplined gun and missile employment.
   *
   * Control convention (FlightPhysics): +roll banks LEFT, +pitch pulls the
   * nose up, +yaw turns the nose left.
   *
   * @param {number} dt frame time
   * @returns {{pitch:number,roll:number,yaw:number,boost:boolean,brake:boolean,throttle:number}}
   */
  _autopilotInput(dt) {
    const physics = this.physics;
    const position = physics.position;
    const input = { pitch: 0, roll: 0, yaw: 0, boost: false, brake: false, throttle: 1 };
    this._aiFire = false;
    this._aiMissile = false;
    this._aiFlare = false;
    if (this._aiMissileCooldown > 0) this._aiMissileCooldown -= dt;
    if (this._aiDefendCooldown > 0) this._aiDefendCooldown -= dt;

    // --- Countermeasures (works with or without a bandit in view) ---------
    this._aiFlare =
      Number.isFinite(this._incoming) &&
      this._incoming < AI_FLARE_RANGE &&
      this.weapons.flaresLeft > 0;

    // Terrain protection: project the flight path ahead, not just the
    // current altitude. While danger is flagged the AI abandons the hunt,
    // levels the wings and climbs with afterburner until the path is clear.
    const ground = this._groundHeightAt(position.x, position.z);
    const agl = position.y - ground;
    const risk = this._aiTerrainRisk();
    if (risk.danger) this._aiTerrainEvade = true;
    else if (risk.clear) this._aiTerrainEvade = false;

    _aiFwd.set(0, 0, -1).applyQuaternion(physics.quaternion);
    _aiRight.set(1, 0, 0).applyQuaternion(physics.quaternion);
    _aiUp.set(0, 1, 0).applyQuaternion(physics.quaternion);

    if (this._aiTerrainEvade) {
      this._aiFire = false;
      this._aiMissile = false;
      this._aiLockAnnounced = false;
      this._aiDefendTimer = 0;
      // Roll the wings level (-_aiRight.y); if the jet is inverted, roll hard
      // upright before pulling full elevator so recovery never dives.
      input.roll = _aiUp.y < 0.15 ? (_aiRight.y >= 0 ? -1 : 1) : clamp(-_aiRight.y * 2.8, -1, 1);
      const levelFactor = clamp(1 - Math.abs(_aiRight.y), 0.25, 1);
      input.pitch = _aiUp.y < -0.1 ? 0.2 : Math.max(0.55, levelFactor);
      input.throttle = 1;
      input.boost = true;
      return input;
    }

    const effectiveAgl = Math.min(agl, risk.worst + 80);
    const floorPitch = clamp((600 - effectiveAgl) / 300, 0, 1);

    // --- Target selection (scored, re-evaluated every second) ---------------
    this._aiTargetTimer -= dt;
    let target = this._aiTarget;
    if (!target || !target.alive || this._aiTargetTimer <= 0) {
      target = this._pickAiTarget(target);
    }

    if (!target) {
      // Nothing to chase: hold a steady patrol altitude above the terrain.
      this._aiTarget = null;
      const wantAltitude = Math.max(900, ground + 620);
      const climb = clamp((wantAltitude - position.y) / 320, -0.5, 0.7);
      input.pitch = Math.max(climb, floorPitch);
      input.roll = clamp(-_aiRight.y * 2.2, -1, 1);
      input.throttle = 0.86;
      return input;
    }

    const targetDistance = target.position.distanceTo(position);
    _aiTv.set(0, 0, 0);
    if (target.direction && target.speed) {
      _aiTv.copy(target.direction).multiplyScalar(target.speed);
    }

    // --- Defence: bandit on the six or a missile closing ---------------------
    const threat = this._aiAssessThreat();
    const missileThreat = Number.isFinite(this._incoming) && this._incoming < 1300;
    if ((threat || missileThreat) && !(this._aiDefendTimer > 0) && !(this._aiDefendCooldown > 0)) {
      // Only break when the AI has no gun shot of its own to finish first.
      _aiLockVec.subVectors(target.position, position).normalize();
      const shotReady = _aiLockVec.dot(_aiFwd) > 0.96 && targetDistance < 800;
      if (!shotReady && effectiveAgl > 480) {
        this._aiDefendTimer = missileThreat ? 1.4 : 2.2;
        const ref = threat ? threat.position : target.position;
        _aiLockVec.subVectors(ref, position);
        const side = Math.sign(_aiLockVec.dot(_aiRight)) || (Math.random() < 0.5 ? 1 : -1);
        this._aiDefendSide = missileThreat && !threat ? (Math.sin(this.time * 2.5) >= 0 ? 1 : -1) : side;
      }
    }
    if (this._aiDefendTimer > 0) {
      this._aiDefendTimer -= dt;
      if (this._aiDefendTimer <= 0) this._aiDefendCooldown = 2.4;
      // Bank-capped break turn: roll crisply into a ±62° upright bank (never inverted!)
      // and pull coordinated G with full power.
      const currentBank = Math.atan2(_aiRight.y, _aiUp.y);
      const maxDefBank = effectiveAgl < 620
        ? clamp((effectiveAgl - 240) / 380, 0.2, 1) * 1.05
        : 1.08;
      const desiredDefBank = -this._aiDefendSide * maxDefBank;
      let defBankErr = desiredDefBank - currentBank;
      while (defBankErr > Math.PI) defBankErr -= Math.PI * 2;
      while (defBankErr < -Math.PI) defBankErr += Math.PI * 2;
      input.roll = clamp(defBankErr * 1.9 - physics.rates.roll * 0.36, -1, 1);
      input.pitch = _aiUp.y < 0.25 ? 0.2 : Math.max(0.72, floorPitch);
      input.throttle = 1;
      input.boost = physics.speed < 280;
      return input;
    }

    // --- Pursuit geometry -------------------------------------------------------
    const closure0 = this._aiClosure(target, _aiDir.subVectors(target.position, position).normalize());

    // Lead (intercept) point using our own speed.
    const ownSpeed = Math.max(physics.speed, 120);
    let t = Math.min(targetDistance / ownSpeed, 4);
    const aim = _aiAim;
    for (let i = 0; i < 3; i++) {
      aim.copy(target.position).addScaledVector(_aiTv, t);
      t = Math.min(aim.distanceTo(position) / ownSpeed, 4);
    }

    // Lag pursuit when we would overshoot: aim behind the bandit's tail.
    const lag = targetDistance < 650 && closure0 > 110;
    if (lag) aim.copy(target.position).addScaledVector(_aiTv, -0.55);

    // Never aim through a mountain ridge between the jet and the intercept point.
    const midGround = this._groundHeightAt(
      (position.x + aim.x) * 0.5,
      (position.z + aim.z) * 0.5
    );
    const aimGround = this._groundHeightAt(aim.x, aim.z);
    const minAimY = Math.max(ground, midGround, aimGround) + 260;
    if (aim.y < minAimY) aim.y = minAimY;

    const toTarget = _aiToTarget.subVectors(aim, position);
    toTarget.normalize();

    // Exact gun pipper inside 1.5 km.
    let gunRange = 0;
    let useGun = false;
    if (targetDistance < 1500) {
      gunRange = this._gunSolution(target.position, _aiTv, _aiGunDir);
      if (_aiGunDir.dot(_aiFwd) > 0.75 && (_aiGunDir.y > -0.18 || effectiveAgl > 720)) {
        toTarget.copy(_aiGunDir);
        useGun = !lag;
      }
    }

    const forwardDot = toTarget.dot(_aiFwd);

    // --- Upright Horizon-Stabilized Bank-to-Turn & Critically-Damped Lock Tracking ---
    // Project aim onto a world-upright horizontal frame so the fighter NEVER
    // rolls inverted (_aiUp.y < 0) and NEVER weaves in a figure-8 when locked.
    let hfX = _aiFwd.x;
    let hfZ = _aiFwd.z;
    const hfLen = Math.hypot(hfX, hfZ);
    if (hfLen > 0.05) {
      hfX /= hfLen;
      hfZ /= hfLen;
    } else {
      hfX = -Math.sin(physics.heading || 0);
      hfZ = -Math.cos(physics.heading || 0);
    }
    const hrX = -hfZ;
    const hrZ = hfX;

    const hForward = toTarget.x * hfX + toTarget.z * hfZ;
    const hRight = toTarget.x * hrX + toTarget.z * hrZ;
    let headingErr = Math.atan2(hRight, hForward); // > 0 means target is to starboard

    // Hysteresis when target is dead astern so the jet commits cleanly to one turn
    // direction instead of dithering left/right across ±π.
    if (Math.abs(headingErr) > 2.3) {
      if (!this._aiTurnSign) this._aiTurnSign = headingErr >= 0 ? 1 : -1;
      headingErr = this._aiTurnSign * Math.abs(headingErr);
    } else if (Math.abs(headingErr) < 1.8) {
      this._aiTurnSign = 0;
    }

    const targetElev = Math.asin(clamp(toTarget.y, -0.92, 0.92));
    const currentElev = Math.asin(clamp(_aiFwd.y, -0.95, 0.95));
    const elevErr = targetElev - currentElev;

    // Signed world bank angle in [-π, +π]: > 0 = left bank, < 0 = right bank.
    const currentBank = Math.atan2(_aiRight.y, _aiUp.y);
    const maxBank =
      effectiveAgl < 600
        ? clamp((effectiveAgl - 220) / 380, 0.25, 1) * 1.02
        : 1.06; // <= ~61°, strictly upright!

    // Smooth bank target: level wings inside the target-lock cone so fine aim
    // stays dead-steady without figure-8 S-weaving.
    const absH = Math.abs(headingErr);
    const lockLevelBlend = forwardDot > 0.88 ? clamp((absH - 0.04) / 0.22, 0, 1) : 1;
    const desiredBank = clamp(-headingErr * 1.35, -maxBank, maxBank) * lockLevelBlend;

    let bankErr = desiredBank - currentBank;
    while (bankErr > Math.PI) bankErr -= Math.PI * 2;
    while (bankErr < -Math.PI) bankErr += Math.PI * 2;
    input.roll = clamp(bankErr * 1.85 - physics.rates.roll * 0.38, -1, 1);

    // Pitch control: if ever inverted (_aiUp.y < 0.25), keep pitch neutral while
    // rolling upright first; otherwise combine damped elevation + coordinated turn G.
    if (_aiUp.y < 0.25) {
      input.pitch = clamp(elevErr * 0.8 - physics.rates.pitch * 0.25, -0.2, 0.35);
    } else {
      const bankAligned = currentBank * headingErr < 0;
      const turnPull =
        bankAligned && absH > 0.26
          ? clamp((absH - 0.22) * 0.85, 0, 0.82) * clamp(Math.abs(_aiRight.y) * 1.15, 0, 1)
          : 0;
      const elevPitch = elevErr * 2.5 - physics.rates.pitch * 0.28;
      input.pitch = clamp(elevPitch + turnPull, -0.78, 0.92);
    }

    // Damped rudder for crisp horizontal lock tracking without rolling the wings.
    const yawAuth = forwardDot > 0.65 && _aiUp.y > 0.4 ? 1 : 0.25;
    input.yaw = clamp((-headingErr * 2.1 - physics.rates.yaw * 0.3) * yawAuth, -0.7, 0.7);

    // Terrain avoidance outranks the pursuit.
    if (floorPitch > 0) {
      const levelRoll = _aiUp.y < 0.15 ? (_aiRight.y >= 0 ? -1 : 1) : clamp(-_aiRight.y * 2.4, -1, 1);
      const pullScale = clamp(_aiUp.y, 0.2, 1);
      input.pitch = Math.max(input.pitch, floorPitch * pullScale);
      const rollBlend = clamp(floorPitch * 1.15, 0, 0.9);
      input.roll = input.roll * (1 - rollBlend) + levelRoll * rollBlend;
    }
    // Hard near-deck limits: the airframe never follows a bandit into the
    // ground. Diving fades out under 900 m AGL and hard banks under 600 m.
    if (effectiveAgl < 900 && _aiFwd.y < 0.15) {
      const diveLimit = clamp((effectiveAgl - 280) / 620, 0, 1);
      input.pitch = Math.max(input.pitch, -diveLimit);
    }
    if (effectiveAgl < 600) {
      const maxBankScale = clamp((effectiveAgl - 220) / 380, 0, 1);
      const levelRoll = clamp(-_aiRight.y * 2.2, -1, 1);
      input.roll = input.roll * maxBankScale + levelRoll * (1 - maxBankScale);
    }

    // --- Energy management ------------------------------------------------------------
    _aiLockVec.subVectors(target.position, position);
    const banditDistance = _aiLockVec.length() || 1;
    _aiLockVec.multiplyScalar(1 / banditDistance);
    const directDot = _aiLockVec.dot(_aiFwd);
    const plan = this._aiSpeedPlan({
      distance: targetDistance,
      closure: closure0,
      forwardDot: directDot,
      agl,
      behind: directDot < 0.15,
      speed: physics.speed,
    });
    input.throttle = plan.throttle;
    input.boost = plan.boost;
    input.brake = plan.brake;

    // --- Cannon: only when the pipper is on the bandit --------------------------------
    const gunHot = (this.weapons?.heat ?? 0) > 0.92 || this.weapons?.overheated;
    if (targetDistance < 1350 && !gunHot) {
      const gunErr = _aiGunDir.dot(_aiFwd);
      const gunCone = Math.cos(clamp(Math.atan(8 / Math.max(gunRange || targetDistance, 80)), 0.012, 0.07));
      if (targetDistance < 1500 && gunErr > gunCone && directDot > 0.9) this._aiFire = true;
    }

    // --- Auto lock → missile release ----------------------------------------------------
    const inLockCone = directDot > AI_LOCK_CONE && banditDistance < AI_LOCK_RANGE;
    if (!inLockCone) {
      this._aiLockAnnounced = false;
    } else {
      if (!this._aiLockAnnounced) {
        this._aiLockAnnounced = true;
        this._aiLockToneFresh = true;
        this.audio.lockTone();
      }
      if (banditDistance > 450 && this._aiMissileCooldown <= 0) {
        this._aiMissile = true;
        this._aiMissileCooldown = 1.6;
      }
    }
    return input;
  }

  /** Rate at which the AI is closing on its target (m/s, negative = opening). */
  _aiClosure(target, dirToTarget) {
    const tx = (target.direction?.x ?? 0) * (target.speed ?? 0);
    const ty = (target.direction?.y ?? 0) * (target.speed ?? 0);
    const tz = (target.direction?.z ?? 0) * (target.speed ?? 0);
    const v = this.physics.velocity;
    return (v.x - tx) * dirToTarget.x + (v.y - ty) * dirToTarget.y + (v.z - tz) * dirToTarget.z;
  }

  /**
   * Throttle / afterburner / airbrake plan for a professional pursuit:
   * accelerate while far or recovering energy, match speed in the saddle and
   * open the boards the moment closure is too high for a clean gun solution.
   *
   * @param {{distance:number, closure:number, forwardDot:number, agl:number,
   *          behind:boolean, speed:number}} state
   * @returns {{throttle:number, boost:boolean, brake:boolean}}
   */
  _aiSpeedPlan({ distance, closure, forwardDot, agl, behind, speed }) {
    const band = AI_SPEED_BANDS;
    let throttle = 0.9;
    let boost = false;
    let brake = false;

    if (distance > band.chase) {
      throttle = 1;
      boost = speed < 320 || closure < 45;
    } else if (distance > band.close) {
      throttle = 0.94;
      boost = closure < 35 && speed < 300;
    } else if (distance > band.saddle) {
      // Bleed the overtake early so the bandit does not slide behind us.
      throttle = closure > 170 ? 0.58 : closure > 90 ? 0.72 : 0.84;
      brake = closure > 230 && speed > 170;
      if (closure < -20) throttle = 1;
    } else if (distance > band.guns) {
      throttle = 0.42;
      brake = closure > 70 || speed > 215;
      if (closure < -40) throttle = 0.85;
    } else {
      throttle = 0.28;
      brake = speed > 145;
      if (closure < -25) throttle = 0.8;
    }

    // Turning bleeds energy: keep the throttle up while the nose is off.
    if (forwardDot < 0.55 && distance < 1500) {
      throttle = Math.max(throttle, 0.8);
      brake = false;
    }
    // Near the deck climb authority matters more than economy.
    if (agl < 420) {
      throttle = Math.max(throttle, 0.9);
      brake = false;
    }
    // Never stall the jet to stay behind a bandit.
    if (speed < 105) {
      throttle = 1;
      boost = true;
      brake = false;
    } else if (speed < 130) {
      throttle = Math.max(throttle, 0.85);
      brake = false;
    }
    // Directly astern and close: keep enough smash to pull the nose around.
    if (behind && distance < 850) {
      throttle = Math.max(throttle, 0.55);
      brake = false;
    }
    if (brake) boost = false;
    if (speed > 330) boost = false;

    return { throttle: clamp(throttle, 0.15, 1), boost, brake };
  }

  /* --- World map (biome) --------------------------------------------------- */

  /** True while the player is actively in a sortie/battle (flying, paused, or crashed). */
  _isInBattle() {
    return this.state === 'flying' || this.state === 'paused' || this.state === 'crashed';
  }

  /**
   * Switches the world map without reloading the page: the new world is built
   * off-screen, then swapped into the same scene slot and the flight systems
   * are reparented onto it. Manual map switching is disabled during battle.
   *
   * @param {string} name biome id
   * @param {{behavior?:'auto'|'menu'|'launch', silent?:boolean, force?:boolean}} [options]
   * @returns {Promise<boolean>} true when the world was swapped
   */
  _setMap(name, options = {}) {
    if (!BIOME_IDS.includes(name)) return Promise.resolve(false);
    if (!options.force && this._isInBattle()) {
      if (!options.silent) {
        this.audio?.uiBlip(240, 0.07);
        this.hud?.showToast('GANTI PETA DINONAKTIFKAN SAAT PERTARUNGAN');
      }
      this.hud?.setMap(this.mapId);
      return Promise.resolve(false);
    }
    if (!options.force && this.multiplayer?.active && !this.multiplayer.isHost) {
      if (!options.silent) {
        this.audio?.uiBlip(240, 0.07);
        this.hud?.showToast('HANYA HOST YANG BISA MENGGANTI PETA ROOM');
      }
      this.hud?.setMap(this.mapId);
      return Promise.resolve(false);
    }
    if (this._switchingMap) {
      if (options.force && name !== this.mapId) {
        this._pendingMapSync = { name, options };
      }
      return this._mapSwitchPromise || Promise.resolve(false);
    }
    if (name === this.mapId) {
      if (this.multiplayer?.active && this.multiplayer.isHost) {
        this.multiplayer.setMap(this.mapId);
      }
      this.hud?.setMap(this.mapId);
      return Promise.resolve(false);
    }
    const task = this._switchMap(name, options);
    this._mapSwitchPromise = task;
    return task;
  }

  async _switchMap(name, { behavior = 'auto', silent = false } = {}) {

    const previousState = this.state;
    const previousMap = this.mapId;
    const biome = getBiome(name);
    this._switchingMap = true;
    this.mapId = name;
    storeBiome(name);
    this.hud.setMap(name);
    this.state = 'transition';
    this.input.setEnabled(false);
    this.input.clearKeys();
    this.input.consumeLook();
    this._exitPointerLock();
    this._clearAutoLock();
    if (this.mobile) this.mobile.setVisible(false);
    if (!silent) {
      this.audio.uiBlip(700, 0.06);
      this.hud.showToast(`PETA ${biome.label} · MEMBANGUN DUNIA`);
    }
    this.hud.setWorldLoading(true, 0.02, `MEMBANGUN ${biome.label}`);

    let next = null;
    try {
      next = new World(this.quality, biome);
      await next.build((progress, label) => {
        this.hud.setWorldLoading(true, Math.max(0.02, progress), label);
      });
      this._swapWorld(next);
      this.biome = biome;
      if (this.multiplayer?.active && this.multiplayer.isHost) {
        this.multiplayer.setMap(this.mapId);
      }
      this.hud.setWorldFacts(this._worldFacts());
      this.hud.setWorldLoading(false);
      if (!silent) this.hud.showToast(`PETA ${biome.label} SIAP`, 2600);
    } catch (error) {
      console.error('[SKYBOUND] map switch failed:', error);
      this.hud.setWorldLoading(false);
      next?.dispose();
      this._switchingMap = false;
      this._launchAfterMapSwitch = false;
      // Keep the old world playable: roll the selection back with it.
      this.mapId = previousMap;
      this.biome = getBiome(previousMap);
      storeBiome(previousMap);
      this.hud.setMap(previousMap);
      this.state = 'menu';
      this._prepareMenu();
      this.hud.setWorldFacts(this._worldFacts());
      this.hud.showToast('GAGAL MEMBANGUN PETA · KEMBALI KE MENU');
      return false;
    }

    this._switchingMap = false;
    const launchQueued = this._launchAfterMapSwitch;
    this._launchAfterMapSwitch = false;

    if (this._pendingMapSync) {
      const pending = this._pendingMapSync;
      this._pendingMapSync = null;
      if (pending.name !== this.mapId) {
        if (launchQueued) this._launchAfterMapSwitch = true;
        return this._setMap(pending.name, {
          ...pending.options,
          behavior: launchQueued ? 'launch' : pending.options?.behavior,
        });
      }
    }

    if (behavior === 'launch' || launchQueued) {
      this._startFlight({ force: true, carrierLaunch: this._pendingCarrierLaunch });
    } else if (behavior === 'menu' || previousState === 'menu') {
      this.state = 'menu';
      this._prepareMenu();
    } else if (previousState === 'paused') {
      this._startFlight({ force: true });
      this._pause();
    } else if (previousState === 'flying' || previousState === 'crashed') {
      this._startFlight({ force: true });
    } else {
      this.state = 'menu';
      this._prepareMenu();
    }
    return true;
  }

  /** Reparent the live flight systems into the freshly generated scene. */
  _swapWorld(next) {
    const old = this.world;
    this.world = next;
    this.scene = next.scene;
    if (!this.environmentTexture) this.environmentTexture = createEnvironmentTexture();
    this.scene.environment = this.environmentTexture;
    if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.55;

    this.scene.add(this.aircraft.root);
    this.scene.add(this.aircraft.shadow);
    this.scene.add(this.trails.points);
    this.scene.add(this.explosions.points);
    this.weapons.reattach(this.scene);
    if (this.carrier) this.scene.add(this.carrier.group);
    this.enemies.reattach(this.scene);
    this.enemies.setWorld(this.world);
    this.desertTanks?.reattach(this.scene);
    this.desertTanks?.setWorld(this.world);
    if (this.multiplayer) {
      this.multiplayer.mapId = this.mapId;
      this.multiplayer.reattach(this.scene);
    }
    this.scene.add(this.camera);

    old.dispose();

    // Immediately initialize sky, sunLight position/target, fog, and ocean sun
    // uniforms so the newly swapped world is never rendered dark on frame 0.
    this.world.update(0.016, this.camera, this.physics?.position || this.camera.position);
    if (this.renderer?.shadowMap) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  /* --- Gyro calibration ---------------------------------------------------- */

  /** Re-zeros the tilt steering to the way the device is held right now. */
  _calibrateGyro() {
    this.input.recalibrateGyro();
    this.audio.uiBlip(760, 0.06);
    this.hud.showToast('GIRO DIKALIBRASI · TAHAPKAN PONSEL DI POSISI TENANG');
  }

  /** Gyro tilt steering: permission lives inside this click handler. */
  async _setGyro(value) {
    if (value !== 'on') {
      this.gyroOn = false;
      this.input.disableGyro();
      this.hud.setGyro('off');
      this.audio.uiBlip(560, 0.05);
      try {
        window.localStorage.setItem('skybound.gyro', '0');
      } catch {
        /* ignore */
      }
      return;
    }
    const ok = await this.input.enableGyro();
    if (!ok) {
      this.hud.setGyro('off');
      this.hud.showToast('GIRO TIDAK DIIZINKAN / SENSOR TIDAK ADA');
      return;
    }
    this.gyroOn = true;
    this.hud.setGyro('on');
    this.audio.uiBlip(740, 0.07);
    this.hud.showToast('GIRO AKTIF · MIRINGKAN PONSEL UNTUK BELOK');
    try {
      window.localStorage.setItem('skybound.gyro', '1');
    } catch {
      /* ignore */
    }
  }

  /** HUD edit mode: drag panels anywhere, positions persist on drop. */
  _setHudEdit(value) {
    const on = value === 'on';
    this.hud.setHudEdit(on);
    // The touch cluster is hidden while paused — show it so it can be moved.
    if (this.mobile) this.mobile.setVisible(on || this.state === 'flying');
    this.audio.uiBlip(on ? 620 : 480, 0.05);
    if (on) this.hud.showToast('SERET PANEL UNTUK PINDAH · KETUK UNTUK UKURAN & TRANSPARAN');
  }

  _resetHudLayout() {
    this.hud.resetHudPositions();
    this.audio.uiBlip(420, 0.07);
    this.hud.showToast('LAYOUT HUD DIKEMBALIKAN KE BAWAAN');
  }

  _crash(surfaceType) {
    if (this.state !== 'flying' && !(this.state === 'paused' && this.multiplayer?.active)) return;
    if (this.hud.isChatOpen()) this.hud.closeChat();
    if (this.state === 'paused') {
      this.hud.closeSubScreen();
      this.hud.showPause(false);
    }
    this.state = 'crashed';
    this._carrierLaunch = null;
    this.hud.setCarrierBanner(null);
    this.hud.updateMissileCam(null);
    this._crashSurface = surfaceType;
    this._respawnTimer = 4.6;
    this.input.setEnabled(false);
    this._exitPointerLock();
    this._clearAutoLock();
    if (this.mobile) this.mobile.setVisible(false);

    const telemetry = this.physics.getTelemetry();
    const cause =
      surfaceType === 'shotdown'
        ? 'Shot down by bandit fire. The airframe disintegrated.'
        : surfaceType === 'water'
          ? 'Water impact. The airframe broke apart on the reef.'
          : 'Terrain impact. Telemetry link terminated.';

    this.aircraft.setVisible(false);
    this.cockpit?.setVisible(false);
    if (surfaceType === 'shotdown') {
      this.explosions.burst(this.physics.position, 3.2, 0xff7a3a);
      this.audio.explosion(1.6);
    }
    this.trails.update(0, this.aircraft, this.physics, this.world, false);
    this.trails.burst(this.physics.position, surfaceType);
    this.chase.addCrashShake(1.8);
    this.chase.setCinematic(true);
    this.audio.crash();
    this.audio.setPaused(true);

    this.hud.flash('impact');
    this.hud.showCrash({
      cause,
      speed: `${Math.round(telemetry.speedKts)} KT`,
      altitude: `${Math.round(telemetry.altitude)} M`,
      time: formatDuration(this.sessionTime),
      countdown: this._respawnTimer,
    });
  }

  _checkCollision() {
    const p = this.physics.position;
    const terrain = this.world.getHeightAt(p.x, p.z);
    const wave = this.world.getWaveHeightAt ? this.world.getWaveHeightAt(p.x, p.z) : 0;
    const surface = Math.max(terrain, wave);
    const clearance = p.y - surface;
    if (clearance <= 2.3) {
      this._crash(terrain >= wave ? 'land' : 'water');
      return true;
    }
    return false;
  }

  /**
   * Returns all valid hostile targets for the current sortie:
   *  - Versus / Team 3v3: pure PvP (human rivals only, no AI NPCs)
   *  - Co-Op / Single-Player: AI bandits
   */
  _getCombatTargets() {
    if (this.multiplayer?.active && this.multiplayer.isPvpMode()) {
      return this.multiplayer.getVersusTargets();
    }
    const bandits = this.enemies.getAlive();
    const tanks = this.desertTanks?.getAlive() ?? [];
    return tanks.length > 0 ? [...bandits, ...tanks] : bandits;
  }

  /**
   * One combat step: cannon trigger, missile launch, target lock, then the
   * weapons / bandit simulations and every event they emit (hits, kills,
   * hull damage). May end the sortie through `_crash('shotdown')`.
   */
  _updateCombat(dt) {
    const player = {
      position: this.physics.position,
      velocity: this.physics.velocity,
      radius: 6.5,
      alive: true,
    };

    const targets = this._getCombatTargets();

    // --- Target lock (2-stage animated crosshair acquire -> LOCK + sound) --
    _fwdVec.set(0, 0, -1).applyQuaternion(this.physics.quaternion);
    const previousTarget = this.target;
    const lockRange = this.weapons.missileSpec?.lockRange ?? 2800;
    this.target = this.weapons.pickTarget(
      targets,
      this.physics.position,
      _fwdVec,
      lockRange,
      0.88
    );
    if (this.target && this.target.alive) {
      if (this.target !== previousTarget) {
        this._lockProgress = 0.04;
        this._lockedTone = false;
      } else {
        this._lockProgress = Math.min(1, (this._lockProgress || 0) + dt / 0.65);
      }
      this._targetLocked = this._lockProgress >= 1;
      if (this._targetLocked && !this._lockedTone) {
        // Crosshair finished auto-locking onto target -> fire lock sound!
        if (!this._aiLockToneFresh) this.audio.lockTone();
        this._lockedTone = true;
      }
    } else {
      this._lockProgress = 0;
      this._targetLocked = false;
      this._lockedTone = false;
    }
    this._aiLockToneFresh = false;
    // The auto-lock view follows its own bandit so the camera stays useful
    // even when the gun/IR seeker is looking elsewhere.
    this._syncAutoLockTarget();

    // --- Player cannon -----------------------------------------------------
    this._cockpitFiring = !!(this.input.isFiring() || this._aiFire);
    if (this._cockpitFiring) {
      _rightVec.set(1, 0, 0).applyQuaternion(this.physics.quaternion);
      let fired = false;
      for (const side of [-1, 1]) {
        _muzzle
          .copy(this.physics.position)
          .addScaledVector(_fwdVec, 3.4)
          .addScaledVector(_rightVec, side * 2.6)
          .addScaledVector(_upVec.set(0, 1, 0).applyQuaternion(this.physics.quaternion), -0.4);
        if (this.weapons.firePlayerGun(_muzzle, _fwdVec, this.physics.velocity)) {
          fired = true;
        }
      }
      if (fired) {
        this.multiplayer?.sendWeaponEvent('gun', _muzzle, _fwdVec);
      }
      this.audio.gunFire();
      this.chase.addCrashShake(0.02);
    }

    // --- Player missile ----------------------------------------------------
    if (this.input.consumeMissile() || this._aiMissile) {
      this.cockpit?.triggerMissilePress();
      _muzzle
        .copy(this.physics.position)
        .addScaledVector(_fwdVec, 2.2)
        .addScaledVector(_upVec.set(0, 1, 0).applyQuaternion(this.physics.quaternion), -1.1);
      const mslTarget =
        this.target || (this.autopilot && this._aiTarget?.alive ? this._aiTarget : null);
      const launched = this.weapons.launchMissile(_muzzle, _fwdVec, mslTarget, targets);
      if (launched) {
        this.audio.missileLaunch();
        this.multiplayer?.sendWeaponEvent(
          'missile',
          _muzzle,
          _fwdVec,
          mslTarget?.isPlayer ? mslTarget.id : null
        );
        // Fire-and-forget AI: the moment a locked missile leaves the rail, do NOT
        // wait for that target to explode — immediately switch to the next enemy!
        if (this.autopilot && this._aiMissile && mslTarget && mslTarget.alive) {
          this._aiEngagedTargets.set(mslTarget, this.time + 5.5);
          this._pickAiTarget(null, { avoid: mslTarget });
        }
      }
    }

    // --- Flare countermeasure ---------------------------------------------
    // Manual presses queue through the input; the autopilot fires its own
    // salvo whenever a hostile bird is detected inside the envelope.
    if (this.input.consumeFlares() || this._aiFlare) {
      this.cockpit?.triggerFlarePress();
      const stats = this.weapons.getStats();
      if (stats.flares <= 0) {
        this.hud.showToast('FLARES DEPLETED');
        this.audio.uiBlip(200, 0.08);
      } else if (this.weapons.deployFlares(this.physics.position, this.physics.velocity)) {
        this.audio.flareBurst();
      }
    }

    // --- Simulations --------------------------------------------------------
    // Incoming-missile range feeds the HUD warning before events drain.
    this._incoming = this.weapons.getIncoming(this.physics.position);
    this.weapons.update(dt, {
      world: this.world,
      targets,
      player,
      explosions: this.explosions,
    });
    this.enemies.update(dt, {
      world: this.world,
      player,
      weapons: this.weapons,
      explosions: this.explosions,
      allowSpawn: !this.multiplayer || this.multiplayer.shouldSpawnBandits(),
    });
    this.desertTanks?.update(dt, {
      playerPosition: this.physics.position,
      playerVelocity: this.physics.velocity,
      weapons: this.weapons,
      explosions: this.explosions,
      allowFire: !this._carrierLaunch?.active,
    });
    this.explosions.update(dt);

    this._drainCombatEvents();

    // Keep the HUD lock box glued to a live target only.
    if (this.target && !this.target.alive) this.target = null;
  }

  /** Resolve every combat event into score, hull damage and UI feedback. */
  _drainCombatEvents() {
    for (const event of this.weapons.consumeEvents()) {
      if (event.type === 'player-hit') {
        // Airframe defense: 30% of every incoming hit is absorbed.
        const damage = event.damage * (1 - this.defense);
        this.hull = Math.max(0, this.hull - damage);
        this.audio.hullHit();
        this.chase.addCrashShake(0.35);
        this.hud.flash('hit');
        if (this.hull <= 0) {
          this._crash('shotdown');
          return;
        }
      } else if (event.type === 'kill') {
        this.explosions.burst(event.point, 2.4, 0xffb14a);
        this.audio.explosion(1.3);
        if (event.target?.isPlayer) {
          // Send lethal damage to victim; authoritative PvP score increments
          // when the victim confirms pvp-down so kills are never double-counted.
          this.multiplayer?.sendPvpHit(
            event.target.id,
            Math.max(event.damage ?? 48, 120),
            event.weapon || 'missile'
          );
        } else {
          const isTank = event.target?.kind === 'tank';
          if (isTank && event.target?.group) {
            event.target.group.visible = false;
            if (event.target.muzzleFlash) event.target.muzzleFlash.visible = false;
          }
          const pts = isTank
            ? event.weapon === 'missile'
              ? 280
              : 200
            : event.weapon === 'missile'
              ? 250
              : 150;
          this.kills += 1;
          this.score += pts;
          this.multiplayer?.sendCoopKill(event.weapon || 'missile');
          this.hud.showToast(
            `${isTank ? 'TANK GURUN HANCUR' : 'BANDIT DOWN'} · +${pts} PTS`
          );
        }
        if (this.target === event.target) this.target = null;
        this._checkMission();
      } else if (event.type === 'hit') {
        this.score += 10;
        this.audio.uiBlip(980, 0.03);
        if (event.target?.isPlayer) {
          this.multiplayer?.sendPvpHit(
            event.target.id,
            event.damage ?? 14,
            event.weapon || 'gun'
          );
        }
      } else if (event.type === 'detonate') {
        this.audio.explosion(event.scored ? 1.4 : 0.9);
        this.chase.addCrashShake(event.scored ? 0.4 : 0.15);
      } else if (event.type === 'missile-launch') {
        this.hud.flash('launch');
      } else if (event.type === 'hostile-launch') {
        this.hud.flash('launch');
        this.hud.showToast('MISSILE MENGEJAR · TEKAN [V] / FLR UNTUK FLARE!');
        this.audio.missileWarningBeep(0.8);
      } else if (event.type === 'flare-decoyed') {
        this.score += 50;
        this.hud.showToast('MISSILE DECOYED · +50 PTS');
        this.audio.uiBlip(880, 0.08);
      }
    }

    for (const event of this.enemies.consumeEvents()) {
      if (event.type === 'terrain-crash') {
        this.explosions.burst(event.point, 2.0, 0xffa64d);
        this.audio.explosion(1.1);
        this.hud.showToast('BANDIT CRASHED · TERRAIN');
      } else if (event.type === 'spawn' && !this.target) {
        this.hud.showToast('BANDIT INBOUND · WEAPONS FREE');
      }
    }

    this.hud.setCombat({
      score: this.score,
      kills: this.kills,
      hull: this.hull,
      hullMax: this.hullMax,
      missiles: this.weapons.missilesLeft,
      flares: this.weapons.flaresLeft,
      incoming: this._incoming,
    });
  }

  getCombatStats() {
    return {
      score: this.score,
      kills: this.kills,
      hull: this.hull,
      hullMax: this.hullMax,
      incoming: this._incoming,
      ...this.weapons.getStats(),
      bandits: this.enemies.getStats(),
    };
  }

  _handleActions() {
    const actions = this.input.consumeActions();
    for (const action of actions) {
      if (action === 'pause') this._togglePause();
      else if (action === 'autolock') this._toggleAutoLock();
      else if (action === 'mute') this._toggleMute();
      else if (action === 'help') this._toggleHelp();
      else if (action === 'camera') this._cycleCamera();
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    this._update(dt);
    this._renderFrame();
    this._updatePerformance(dt);
  }

  _renderFrame() {
    if (this.pixel) this.pixel.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    this._renderMissileCam();
  }

  /**
   * Renders the right-side Picture-in-Picture Missile Minicam directly into
   * the `#missile-cam-frame` rectangle whenever a player missile is chasing a
   * target (or lingering briefly on the impact fireball).
   */
  _renderMissileCam() {
    if (this.state !== 'flying' || !this.missileCam || !this.weapons) return;
    if (
      typeof this.renderer?.setViewport !== 'function' ||
      typeof this.renderer?.setScissor !== 'function' ||
      typeof this.renderer?.setScissorTest !== 'function'
    ) {
      return;
    }
    const view = this.weapons.getTrackedMissileView();
    if (!view.active) return;

    const rect = this.hud.getMissileCamRect();
    if (!rect) return;

    const fullW = window.innerWidth || 1;
    const fullH = window.innerHeight || 1;
    const vpX = Math.max(0, Math.floor(rect.left));
    const vpW = Math.max(16, Math.floor(rect.width));
    const vpH = Math.max(16, Math.floor(rect.height));
    const vpY = Math.max(0, Math.floor(fullH - rect.bottom));
    if (vpW <= 16 || vpH <= 16 || vpX >= fullW || vpY >= fullH) return;

    // Position chase camera right behind & slightly above the missile nose.
    const dir = view.direction;
    this._mCamSide.crossVectors(dir, this._mCamUp);
    if (this._mCamSide.lengthSq() < 1e-4) this._mCamSide.set(1, 0, 0);
    else this._mCamSide.normalize();

    if (view.impact) {
      this._mCamPos
        .copy(view.position)
        .addScaledVector(dir, -22)
        .addScaledVector(this._mCamUp, 6);
      this._mCamLook.copy(view.position);
    } else {
      this._mCamPos
        .copy(view.position)
        .addScaledVector(dir, -11.5)
        .addScaledVector(this._mCamSide, 1.8)
        .addScaledVector(this._mCamUp, 2.3);
      if (view.target && view.target.alive) {
        this._mCamLook.copy(view.target.position);
      } else {
        this._mCamLook.copy(view.position).addScaledVector(dir, 140);
      }
    }

    this.missileCam.aspect = vpW / vpH;
    this.missileCam.updateProjectionMatrix();
    this.missileCam.position.copy(this._mCamPos);
    this.missileCam.up.copy(this._mCamUp);
    this.missileCam.lookAt(this._mCamLook);

    const prevCockpitVis = this.cockpit?.group?.visible ?? false;
    const prevAirframeVis = this.aircraft?.root?.visible ?? true;
    const prevAutoClear = this.renderer.autoClear;
    if (this.cockpit?.group) this.cockpit.group.visible = false;
    if (this.aircraft?.root) this.aircraft.root.visible = true;

    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(vpX, vpY, vpW, vpH);
    this.renderer.setViewport(vpX, vpY, vpW, vpH);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.missileCam);

    // Restore main viewport & cockpit visibility cleanly.
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, fullW, fullH);
    this.renderer.autoClear = prevAutoClear;
    if (this.cockpit?.group) this.cockpit.group.visible = prevCockpitVis;
    if (this.aircraft?.root) this.aircraft.root.visible = prevAirframeVis;
  }

  _update(dt) {
    if (!this.ready && this.state !== 'menu') return;
    // Cleared every frame; the autopilot refills them before combat runs.
    this._aiFire = false;
    this._aiMissile = false;
    this._aiFlare = false;

    if (this.state === 'transition') {
      // The world generator is building off-screen; keep the old sky alive
      // under the loading overlay but freeze the airframe.
      this.world.update(dt, this.camera, this.physics.position);
      this.chase.update(dt, this.physics, this.world);
      return;
    }

    if (this.state === 'menu') {
      this.menuTime += dt;
      this.physics.update(dt, this.physics.menuInput(this.menuTime));
      // Safety net: the attract-mode orbit must never bury itself in an island.
      const ground = this.world.getHeightAt(
        this.physics.position.x,
        this.physics.position.z
      );
      if (this.physics.position.y < ground + 90) {
        this.physics.reset(this._safeSpawn(MENU_SPAWN));
        this.chase.snapTo(this.physics);
      }
      this.aircraft.updateVisual(dt, this.physics, null, this.time, this.world);
      this.chase.update(dt, this.physics, this.world);
      this.world.update(dt, this.camera, this.physics.position);
      return;
    }

    if (this.state === 'flying') {
      this.input.update(dt);
      this._handleActions();
      if (this.state !== 'flying') return;

      const input = this.input.getFlightInput();
      const flightInput = this.autopilot ? this._autopilotInput(dt) : input;
      // Touch sticks mirror whatever is flying the jet — the AI moves them.
      this.mobile?.setAutopilotDrive(this.autopilot ? flightInput : null);
      this.chase.applyLook(this.input.consumeLook());
      const launchingFromCarrier = this._updateCarrierLaunch(dt);
      if (!launchingFromCarrier) {
        this.physics.update(dt, flightInput);
        this._enforceMapBoundary(dt, false);
        if (this.carrier?.group?.visible) this.carrier.update(dt, false, 0);
      }
      this.sessionTime += dt;
      this.aircraft.updateVisual(dt, this.physics, flightInput, this.time, this.world);

      if (!launchingFromCarrier && this._checkCollision()) {
        this.world.update(dt, this.camera, this.physics.position);
        this.trails.update(dt, this.aircraft, this.physics, this.world, false);
        this.chase.update(dt, this.physics, this.world);
        return;
      }

      this.trails.update(dt, this.aircraft, this.physics, this.world, true);
      this._updateCombat(dt);
      this.hud.updateMissileCam(this.weapons.getTrackedMissileView());
      if (this.state !== 'flying') return;
      // Survival objectives tick down here; a cleared mission opens debrief.
      this._checkMission();
      if (this.state !== 'flying') {
        this.world.update(dt, this.camera, this.physics.position);
        return;
      }
      this.chase.update(dt, this.physics, this.world);
      this.world.update(dt, this.camera, this.physics.position);
      this.multiplayer?.update(dt, {
        physics: this.physics,
        world: this.world,
        aircraftId: this.selectedAircraftId,
        hull: this.hull,
        hullMax: this.hullMax,
        kills: this.kills,
        score: this.score,
        alive: true,
        input: flightInput,
      });
      const mpContacts = this.multiplayer?.getRadarContacts(this.physics.position) || [];
      const banditContacts = this.enemies.getContacts(this.physics.position);
      const tankContacts = this.desertTanks?.getContacts(this.physics.position) ?? [];
      const hostileMpContacts = mpContacts.filter((c) => c.enemy);
      const contacts =
        this.multiplayer?.active && this.multiplayer.isPvpMode()
          ? hostileMpContacts
          : tankContacts.length > 0
            ? [...banditContacts, ...tankContacts]
            : banditContacts;
      if (this.multiplayer?.active) {
        this.hud.updateMultiplayerScoreboard(this.multiplayer.getRoomSummary());
      }
      const telemetry = this.physics.getTelemetry();
      const combat = this.getCombatStats();
      const boxedTarget =
        this.autoLock && this.autoLockTarget
          ? this.autoLockTarget
          : this.target || (this.autopilot && this._aiTarget?.alive ? this._aiTarget : null);
      const lockProgress =
        boxedTarget && boxedTarget === this.target ? this._lockProgress : boxedTarget ? 1 : 0;
      this.hud.update(dt, {
        telemetry,
        physics: this.physics,
        world: this.world,
        camera: this.camera,
        contacts,
        mpContacts,
        combat,
        target: boxedTarget,
        lockProgress,
        boundary: this._boundaryStatus,
      });
      if (this.cockpit?.visible) {
        this.cockpit.update(dt, {
          telemetry,
          contacts,
          combat,
          target: boxedTarget,
          lockProgress,
          playerPosition: this.physics.position,
          input: flightInput,
          incoming: this._incoming,
          lighting: this._cockpitLighting(),
          actions: { firing: !!this._cockpitFiring },
        });
      }
      this.audio.update(dt, telemetry, true);
      this.audio.missileAlarmUpdate(dt, this._incoming, !this.muted);
      this.audio.targetLockUpdate(
        dt,
        this._targetLocked,
        (this.weapons?._missileTimer ?? 0) <= 0,
        !this.muted
      );
      return;
    }

    if (this.state === 'paused') {
      if (this.multiplayer?.active) {
        // In Multiplayer, pausing only opens the overlay — the jet stays online
        // and active on level auto-cruise so peers never lose or freeze it.
        const holdInput = this._pausedOnlineFlightInput();
        this.physics.update(dt, holdInput);
        this._enforceMapBoundary(dt, true);
        this.sessionTime += dt;
        this.aircraft.updateVisual(dt, this.physics, holdInput, this.time, this.world);
        if (this._checkCollision()) {
          this.world.update(dt, this.camera, this.physics.position);
          this.trails.update(dt, this.aircraft, this.physics, this.world, false);
          this.chase.update(dt, this.physics, this.world);
          return;
        }
        this.trails.update(dt, this.aircraft, this.physics, this.world, true);
        const player = {
          position: this.physics.position,
          velocity: this.physics.velocity,
          radius: 6.5,
          alive: true,
        };
        const targets = this._getCombatTargets();
        this._incoming = this.weapons.getIncoming(this.physics.position);
        this.weapons.update(dt, {
          world: this.world,
          targets,
          player,
          explosions: this.explosions,
        });
        this.enemies.update(dt, {
          world: this.world,
          player,
          weapons: this.weapons,
          explosions: this.explosions,
          allowSpawn: this.multiplayer.shouldSpawnBandits(),
        });
        this.explosions.update(dt);
        this._drainCombatEvents();
        if (this.state !== 'paused') {
          this.world.update(dt, this.camera, this.physics.position);
          return;
        }
        this.chase.update(dt, this.physics, this.world);
        this.world.update(dt, this.camera, this.physics.position);
        this.multiplayer.update(dt, {
          physics: this.physics,
          world: this.world,
          aircraftId: this.selectedAircraftId,
          hull: this.hull,
          hullMax: this.hullMax,
          kills: this.kills,
          score: this.score,
          alive: true,
          paused: true,
          input: holdInput,
        });
        this.hud.updateMultiplayerScoreboard(this.multiplayer.getRoomSummary());
        this.audio.update(dt, this.physics.getTelemetry(), false);
        this.audio.missileAlarmUpdate(dt, null, false);
        this.audio.targetLockUpdate(dt, false, false, false);
        return;
      }
      this.world.update(dt, this.camera, this.physics.position);
      this.trails.update(dt, this.aircraft, this.physics, this.world, false);
      this.explosions.update(0);
      this.audio.update(dt, this.physics.getTelemetry(), false);
      this.audio.missileAlarmUpdate(dt, null, false);
      this.audio.targetLockUpdate(dt, false, false, false);
      return;
    }

    if (this.state === 'crashed') {
      this.audio.missileAlarmUpdate(dt, null, false);
      this.audio.targetLockUpdate(dt, false, false, false);
      this.trails.update(dt, this.aircraft, this.physics, this.world, false);
      this.explosions.update(dt);
      this.chase.update(dt, this.physics, this.world);
      this.world.update(dt, this.camera, this.physics.position);
      if (this.multiplayer?.active) {
        this.multiplayer.update(dt, {
          physics: this.physics,
          world: this.world,
          aircraftId: this.selectedAircraftId,
          hull: 0,
          hullMax: this.hullMax,
          kills: this.kills,
          score: this.score,
          alive: false,
          paused: false,
        });
      }
      this._respawnTimer -= dt;
      this.hud.setRespawnCountdown(this._respawnTimer);
      this.audio.update(dt, this.physics.getTelemetry(), false);
      if (this._respawnTimer <= 0) this._respawn();
      return;
    }

    if (this.state === 'debrief') {
      // Let the last explosions settle behind the mission report.
      this.explosions.update(dt);
      this.world.update(dt, this.camera, this.physics.position);
      return;
    }
  }

  /** Gentle level-cruise autopilot while the Pause menu is open in Multiplayer. */
  _pausedOnlineFlightInput() {
    const pos = this.physics.position;
    _aiFwd.set(0, 0, -1).applyQuaternion(this.physics.quaternion);
    _aiRight.set(1, 0, 0).applyQuaternion(this.physics.quaternion);
    _aiUp.set(0, 1, 0).applyQuaternion(this.physics.quaternion);
    const ground = this._groundHeightAt(pos.x, pos.z);
    const agl = pos.y - ground;
    const roll = _aiUp.y < 0.15 ? (_aiRight.y >= 0 ? -1 : 1) : clamp(-_aiRight.y * 2.4, -1, 1);
    const targetAlt = Math.max(520, ground + 440);
    const climb = clamp((targetAlt - pos.y) / 260, -0.35, 0.75);
    const pitch = agl < 360 ? Math.max(0.55, climb) : clamp(climb - _aiFwd.y * 0.9, -0.4, 0.65);
    return {
      pitch,
      roll,
      yaw: 0,
      boost: this.physics.speed < 120,
      brake: false,
      throttle: agl < 360 ? 0.9 : 0.66,
    };
  }

  _updatePerformance(dt) {
    const perf = this._perf;
    perf.runtime += dt;
    perf.acc += dt;
    perf.frames += 1;
    if (perf.cooldown > 0) perf.cooldown -= dt;
    if (perf.acc < 1.2) return;

    const fps = perf.frames / perf.acc;
    this._fps = fps;
    perf.acc = 0;
    perf.frames = 0;

    if (perf.runtime < 2.5 || perf.cooldown > 0) return;
    if (this.state !== 'flying' && this.state !== 'menu') return;

    if (fps < 50 && perf.scale > 0.58) {
      perf.scale = Math.max(0.58, perf.scale - 0.1);
      this.renderer.setPixelRatio(qualityPixelRatio(this.quality, perf.scale));
      this.trails.setPixelRatio(this.renderer.getPixelRatio());
      perf.cooldown = 1.6;
    } else if (fps > 58.5 && perf.scale < 1) {
      perf.scale = Math.min(1, perf.scale + 0.04);
      this.renderer.setPixelRatio(qualityPixelRatio(this.quality, perf.scale));
      this.trails.setPixelRatio(this.renderer.getPixelRatio());
      perf.cooldown = 3.5;
    }
  }

  _fatal(error) {
    console.error(error);
    if (this.hud) {
      this.hud.setProgress(0, 'BOOT FAILED');
      this.hud.showBootFailure(error?.message || 'UNKNOWN FAILURE');
      const status = document.getElementById('boot-status');
      if (status) {
        const span = status.querySelector('span:last-child');
        if (span) span.textContent = `ERROR // ${error.message || 'UNKNOWN FAILURE'}`;
      }
    }
  }

  getStats() {
    return {
      state: this.state,
      fps: Math.round(this._fps),
      quality: this.quality.name,
      pixelRatio: this.renderer ? this.renderer.getPixelRatio() : 1,
      pixel: this.pixel ? this.pixel.getStats() : null,
      world: this.world?.getStats(),
      telemetry: this.physics?.getTelemetry(),
    };
  }
}
