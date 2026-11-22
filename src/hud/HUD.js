import * as THREE from 'three';
import { clamp, pad, wrap360 } from '../utils/math.js';
import { keyLabel } from '../controls/InputManager.js';
import { AIRCRAFT, isUnlocked } from '../aircraft/AircraftCatalog.js';
import { MISSILES, getMissile, isMissileUnlocked } from '../combat/MissileCatalog.js';
import { MISSIONS, missionObjective } from '../core/Progress.js';

const MAP_LABELS = { coral: 'CORAL', city: 'KOTA', desert: 'GURUN', mountain: 'GUNUNG' };
const MAP_LEADS = {
  coral:
    'A living archipelago of wind-carved islands, turquoise shallows and cloud banks — now contested by bandit jets. You have the stick and the guns. Find the horizon.',
  city:
    'A vertical metropolis of glass towers and concrete canyons. Bandits use the skyline as cover, so own the streets of air and keep the downtown below your wings.',
  desert:
    'An endless sea of dunes, heat shimmer and buried wrecks. No place to hide, no water in sight — hunt them across the sand before the horizon swallows the light.',
  mountain:
    'A highland wall of ridged massifs, pine valleys and snowbound peaks. The last radar station watches from the spine of the world, and the enemy knows it.',
};
const getAircraftName = (id) => AIRCRAFT.find((craft) => craft.id === id)?.name ?? id;

const COMPASS_PX_PER_DEG = 4.8;
const LADDER_PX_PER_DEG = 3.4;
const CARDINALS = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

/** Rebindable actions in Keymapping order: [action, label]. */
const KEYMAP_ACTIONS = [
  ['pitchDown', 'PITCH DOWN'],
  ['pitchUp', 'PITCH UP'],
  ['rollLeft', 'ROLL LEFT'],
  ['rollRight', 'ROLL RIGHT'],
  ['yawLeft', 'YAW LEFT'],
  ['yawRight', 'YAW RIGHT'],
  ['throttleUp', 'THROTTLE UP'],
  ['throttleDown', 'THROTTLE DOWN'],
  ['boost', 'AFTERBURNER'],
  ['brake', 'AIR BRAKE'],
  ['fire', 'CANNON'],
  ['missile', 'MISSILE'],
  ['flare', 'FLARE'],
  ['camera', 'CYCLE VIEW'],
  ['autolock', 'AUTO LOCK'],
  ['pause', 'PAUSE'],
  ['mute', 'SOUND'],
  ['help', 'HELP'],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatMissionClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function makeTapeRows(container, count = 7) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = el('div', 'tape-row');
    const num = el('span', 'tape-num', '0');
    const tick = el('i', 'tape-tick');
    row.append(num, tick);
    container.append(row);
    rows.push({ row, num });
  }
  return rows;
}

/**
 * DOM/canvas flight HUD: instruments, pitch ladder, radar and all front-end
 * screens. Instrument text is throttled, while attitude/radar run every frame.
 */
export class HUD {
  constructor(callbacks = {}, options = {}) {
    this.callbacks = callbacks;
    this.touch = options.touch ?? false;
    this.qualityLabel = options.qualityLabel ?? 'AUTO';
    this.uiScale = clamp(Number(options.uiScale) || 1, 0.8, 1.6);
    this.autoLock = !!options.autoLock;
    this.phase = 'menu';
    this.time = 0;
    this.radarTime = 0;
    this.instrumentAcc = 0;
    this.radarAcc = 0;
    this.frameCount = 0;
    this.fps = 60;
    this.fpsAcc = 0;
    this.lastWarnings = '';
    this.respawnCountdown = 0;
    this.hangarOpen = false;
    this.subScreen = null;
    this.hangarUnlocked = [];
    this.hangarSelected = null;
    this._rebindAction = null;
    this._bindings = null;
    this.speedRows = [];
    this.altRows = [];
    this.boostSegments = [];
    this.compassWidth = 480;
    this.viewport = { w: window.innerWidth, h: window.innerHeight };
    this._tmpVec = new THREE.Vector3();
    this._elapsed = 0;

    this._build();
    this._buildCompass();
    this._buildLadder();
    this._bindEvents();
    this._initHudDrag();
    this.applyHudPositions();
    this.resize();
    this.setUiScale(this.uiScale);
    this.setAutoLock(this.autoLock);
    this.setPhase('menu');
    this.setMuted(false);
  }

  _build() {
    const mount = document.getElementById('ui-root') || document.body;
    mount.insertAdjacentHTML('beforeend', this._markup());
    this.root = document.getElementById('hud-overlay');
    this.startScreen = document.getElementById('start-screen');
    this.startLead = document.getElementById('start-lead');
    this.factLandLabel = document.getElementById('fact-landlabel');
    this.hangarScreen = document.getElementById('hangar-screen');
    this.hangarGrid = document.getElementById('hangar-grid');
    this.hangarDetail = document.getElementById('hangar-detail');
    this.hangarCount = document.getElementById('hangar-count');
    this.hangarMission = document.getElementById('hangar-mission');
    this.hangarPoints = document.getElementById('hangar-points');
    this.hangarMissileGrid = document.getElementById('hangar-missile-grid');
    this.hangarMissileInfo = document.getElementById('hangar-missile-info');
    this.hangarSelectedLabel = document.getElementById('hangar-selected');
    this.hangarLaunch = document.getElementById('btn-hangar-launch');
    this.hangarPointsValue = 0;
    this.hangarMissileSelected = 'aim9x';
    this.hangarMissilesUnlocked = ['aim9x'];
    this.campaignScreen = document.getElementById('campaign-screen');
    this.campaignLead = document.getElementById('campaign-lead');
    this.campaignDetail = document.getElementById('campaign-detail');
    this.campaignProgress = document.getElementById('campaign-progress');
    this.campaignMap = document.getElementById('campaign-map');
    this.campaignLaunch = document.getElementById('btn-campaign-launch');
    this.missionList = document.getElementById('mission-list');
    this.campaignSelected = 0;
    this.campaignProgressIndex = 0;
    this.missionResultScreen = document.getElementById('mission-result-screen');
    this.missionResultKicker = document.getElementById('mission-result-kicker');
    this.missionResultTitle = document.getElementById('mission-result-title');
    this.missionResultStory = document.getElementById('mission-result-story');
    this.missionResultKills = document.getElementById('mission-result-kills');
    this.missionResultScore = document.getElementById('mission-result-score');
    this.missionResultTime = document.getElementById('mission-result-time');
    this.missionResultReward = document.getElementById('mission-result-reward');
    this.missionNext = document.getElementById('btn-mission-next');
    this.worldLoading = document.getElementById('world-loading');
    this.worldLoadingLabel = document.getElementById('world-loading-label');
    this.worldLoadFill = document.getElementById('world-load-fill');
    this.worldLoadingPercent = document.getElementById('world-loading-percent');
    this.settingsScreen = document.getElementById('settings-screen');
    this.aboutScreen = document.getElementById('about-screen');
    this.exitScreen = document.getElementById('exit-screen');
    this.multiplayerScreen = document.getElementById('multiplayer-screen');
    this.multiplayerButton = document.getElementById('btn-multiplayer');
    this.mpCallsignInput = document.getElementById('mp-callsign');
    this.mpRoomInput = document.getElementById('mp-room-input');
    this.mpActiveCode = document.getElementById('mp-active-code');
    this.mpStatusText = document.getElementById('mp-status-text');
    this.mpPilotList = document.getElementById('mp-pilot-list');
    this.mpRoomList = document.getElementById('mp-room-list');
    this.mpRoomCount = document.getElementById('mp-room-count');
    this.mpLaunchBtn = document.getElementById('btn-mp-launch');
    this.mpLaunchNote = document.getElementById('mp-launch-note');
    this.mpHudPill = document.getElementById('mp-hud-pill');
    this.mpScoreboard = document.getElementById('mp-scoreboard');
    this.mpProfileGate = document.getElementById('mp-profile-gate');
    this.mpProfileInput = document.getElementById('mp-profile-input');
    this.mpResultScreen = document.getElementById('mp-result-screen');
    this.mpResultKicker = document.getElementById('mp-result-kicker');
    this.mpResultTitle = document.getElementById('mp-result-title');
    this.mpResultSummary = document.getElementById('mp-result-summary');
    this.mpResultStandings = document.getElementById('mp-result-standings');
    this.mpTagsHost = document.getElementById('mp-pilot-tags');
    this.mpTagPool = [];
    this.menuButtons = Array.from(document.querySelectorAll('#main-menu .menu-item'));
    this.continueButton = document.getElementById('btn-continue');
    this.sensSlider = document.getElementById('sens-slider');
    this.sensValue = document.getElementById('sens-value');
    this.keymapList = document.getElementById('keymap-list');
    this.keymapNote = document.getElementById('keymap-note');
    this.missionTagName = document.getElementById('mission-tag-name');
    this.missionTagProgress = document.getElementById('mission-tag-progress');
    this.pauseScreen = document.getElementById('pause-screen');
    this.crashScreen = document.getElementById('crash-screen');
    this.helpCard = document.getElementById('help-card');
    this.loadingFill = document.getElementById('boot-fill');
    this.loadingLabel = document.getElementById('boot-label');
    this.bootPercent = document.getElementById('boot-percent');
    this.startButton = document.getElementById('btn-start');
    this.bootStatus = document.getElementById('boot-status');

    this.compassWindow = document.getElementById('compass-window');
    this.compassStrip = document.getElementById('compass-strip');
    this.compassValue = document.getElementById('compass-value');
    this.compassCardinal = document.getElementById('compass-cardinal');
    this.ladder = document.getElementById('pitch-ladder');
    this.speedValue = document.getElementById('speed-value');
    this.machValue = document.getElementById('mach-value');
    this.altValue = document.getElementById('alt-value');
    this.aglValue = document.getElementById('agl-value');
    this.vsValue = document.getElementById('vs-value');
    this.boostValue = document.getElementById('boost-value');
    this.throttleValue = document.getElementById('throttle-value');
    this.throttleFill = document.getElementById('throttle-fill');
    this.gValue = document.getElementById('g-value');
    this.abState = document.getElementById('ab-state');
    this.engineMode = document.getElementById('engine-mode');
    this.brakeState = document.getElementById('brake-state');
    this.warningBox = document.getElementById('warning-box');
    this.flightStatus = document.getElementById('flight-status');
    this.fpm = document.getElementById('fpm');
    this.fpsValue = document.getElementById('fps-value');
    this.qualityValue = document.getElementById('quality-value');
    this.missionClock = document.getElementById('mission-clock');
    this.radarCanvas = document.getElementById('radar-canvas');
    this.radarCtx = this.radarCanvas.getContext('2d');
    this.radarNearest = document.getElementById('radar-nearest');
    this.radarRange = document.getElementById('radar-range');
    // Threat arrows (one per bandit) + compact enemy-only scope on the left.
    this.threatArrowHost = document.getElementById('threat-arrows');
    this.threatArrowPool = [];
    this.threatRadarCanvas = document.getElementById('threat-radar-canvas');
    this.threatRadarCtx = this.threatRadarCanvas.getContext('2d');
    this.threatRadarCount = document.getElementById('threat-radar-count');
    this.threatRadarNearest = document.getElementById('threat-radar-nearest');
    this.toast = document.getElementById('hud-toast');
    this.statusExtra = document.querySelector('.flight-status .status-extra');
    this.hudFlash = document.getElementById('hud-flash');

    // Per-panel HUD editor.
    this.hudEditor = document.getElementById('hud-editor');
    this.hudEditorTitle = document.getElementById('hud-editor-title');
    this.hudEditorMode = document.getElementById('hud-editor-mode');
    this.hudScaleValue = document.getElementById('hud-scale-value');
    this.hudOpacityValue = document.getElementById('hud-opacity-value');

    // Combat / view elements.
    this.viewTag = document.getElementById('view-tag');
    this.viewIndex = this.viewTag?.querySelector('.view-index');
    this.viewName = this.viewTag?.querySelector('.view-name');
    this.hullFill = document.getElementById('hull-fill');
    this.hullValue = document.getElementById('hull-value');
    this.missileCount = document.getElementById('missile-count');
    this.flareCount = document.getElementById('flare-count');
    this.inboundValue = document.getElementById('inbound-value');
    this.killCount = document.getElementById('kill-count');
    this.scoreValue = document.getElementById('score-value');
    this.lockState = document.getElementById('lock-state');
    this.btnView = document.getElementById('btn-view');
    this.btnAutoLock = document.getElementById('btn-autolock');
    this.btnFullscreen = document.getElementById('btn-fullscreen');
    this.flightChat = document.getElementById('flight-chat');
    this.flightChatLog = document.getElementById('flight-chat-log');
    this.flightChatInput = document.getElementById('flight-chat-input');
    this.missileCamFrame = document.getElementById('missile-cam-frame');
    this.missileCamLabel = document.getElementById('missile-cam-label');
    this.missileCamRange = document.getElementById('missile-cam-range');
    this.missileCamStatus = document.getElementById('missile-cam-status');
    this.carrierBanner = document.getElementById('carrier-banner');
    this.chatOpen = false;
    this._chatFadeTimer = null;
    this.weaponMode = document.getElementById('weapon-mode');
    this.targetBox = document.getElementById('target-box');
    this.targetLabel = document.getElementById('target-label');
    this.targetRange = document.getElementById('target-range');
    this.cockpitOverlay = document.getElementById('cockpit-overlay');
    this.combat = {
      score: 0,
      kills: 0,
      hull: 100,
      hullMax: 100,
      missiles: Infinity,
      flares: 15,
      incoming: null,
    };
    this.cockpitView = false;
    this.hudSide = 'left';
    this.hudSize = 'compact';
    this.hudEdit = false;
    this.gyroOn = false;
    this._selectedHud = null;
    this.hudStyleByMode = { landscape: {}, portrait: {} };
    this._hudOrientation = null;
    this.extraContacts = [];
    this.speedRows = makeTapeRows(document.getElementById('speed-rows'));
    this.altRows = makeTapeRows(document.getElementById('alt-rows'));
    this.boostSegments = [];
    const boostWrap = document.getElementById('boost-segments');
    for (let i = 0; i < 12; i++) {
      const seg = el('i');
      boostWrap.appendChild(seg);
      this.boostSegments.push(seg);
    }

    // The static boot overlay stays in the DOM: it doubles as the loading
    // screen (progress driven from setProgress) and as the failure panel
    // (showBootFailure). setReady fades it out via the `ready` class.
    this.bootOverlay = document.getElementById('boot-fallback');
    this.bootLoadFill = document.getElementById('boot-load-fill');
    this.bootLoadLabel = document.getElementById('boot-load-label');
    this.bootLoadPercent = document.getElementById('boot-load-percent');
    this.bootTips = this.bootOverlay
      ? Array.from(this.bootOverlay.querySelectorAll('.boot-tip'))
      : [];
    if (this.bootOverlay) this.bootOverlay.classList.remove('ready');
  }

  _markup() {
    const controlRows = [
      ['W / S', 'Pitch (nose down / up)'],
      ['A / D', 'Roll left / right'],
      ['Q / E', 'Yaw left / right'],
      ['SHIFT', 'Afterburner boost'],
      ['SPACE', 'Air brake'],
      ['F / LMB', 'Cannon fire'],
      ['G / RMB', 'Launch missile'],
      ['V', 'Deploy flares · decoy incoming missiles'],
      ['C', 'Cycle view · chase / cockpit'],
      ['L', 'Auto lock view · follow the target'],
      ['X / Z', 'Throttle up / down'],
      ['P / ESC', 'Pause'],
    ];
    const controlsHtml = controlRows
      .map(
        ([keys, action]) => `
        <div class="control-row"><span class="control-keys">${keys}</span><span class="control-action">${action}</span></div>`
      )
      .join('');

    return `
    <div class="hud" id="hud-overlay" aria-hidden="true">
      <div class="hud-vignette"></div>
      <div class="hud-grid-lines"></div>

      <header class="hud-top">
        <div class="brand-block">
          <div class="brand-mark"><i></i><b>31</b></div>
          <div class="brand-copy">
            <strong>F-31 <em>WRAITH</em></strong>
            <span>SECTOR 07 · CORAL ARCHIPELAGO</span>
          </div>
          <div class="mission-tag">
            <span>MISSION</span>
            <b id="mission-tag-name">FREE FLIGHT</b>
            <em id="mission-tag-progress"></em>
          </div>
        </div>

        <div class="compass-block">
          <div class="compass-window" id="compass-window">
            <div class="compass-strip" id="compass-strip"></div>
            <div class="compass-center-mark"></div>
          </div>
          <div class="compass-readout">
            <span id="compass-value">000</span><small>°</small>
            <b id="compass-cardinal">N</b>
          </div>
        </div>

        <div class="top-right">
          <div class="meta-line">
            <span>ZULU <b id="mission-clock">00:00:00</b></span>
            <span><b id="fps-value">60</b> FPS</span>
            <span>GFX <b id="quality-value">AUTO</b></span>
          </div>
          <div class="hud-actions">
            <button type="button" class="hud-icon-btn" id="btn-view" aria-label="Cycle view" data-icon="view">01</button>
            <button type="button" class="hud-icon-btn" id="btn-autolock" aria-label="Auto lock view" aria-pressed="false" data-icon="lock">LCK</button>
            <button type="button" class="hud-icon-btn" id="btn-fullscreen" aria-label="Fullscreen" aria-pressed="false" data-icon="fs">FS</button>
            <button type="button" class="hud-icon-btn" id="btn-help" aria-label="Controls" data-icon="help">?</button>
            <button type="button" class="hud-icon-btn" id="btn-mute" aria-label="Sound" data-icon="sound">SND</button>
            <button type="button" class="hud-icon-btn" id="btn-pause" aria-label="Pause" data-icon="pause"><span class="pause-glyph"></span></button>
          </div>
        </div>
      </header>

      <div class="view-tag" id="view-tag"><span class="view-index">01</span><span class="view-name">CHASE</span></div>

      <div class="tape-stack tape-left">
        <div class="tape-card">
          <div class="tape-head"><span>IAS</span><span>KNOTS</span></div>
          <div class="tape-big"><span id="speed-value">0</span><small>KT</small></div>
          <div class="tape-track">
            <div class="tape-rows" id="speed-rows"></div>
            <div class="tape-caret"></div>
          </div>
          <div class="tape-foot"><span>MACH</span><b id="mach-value">0.00</b></div>
        </div>
        <div class="mini-stat"><span>ENGINE</span><b>F119-X</b></div>
      </div>

      <div class="tape-stack tape-right">
        <div class="tape-card">
          <div class="tape-head"><span>ALT</span><span>METRES</span></div>
          <div class="tape-big"><span id="alt-value">0</span><small>M</small></div>
          <div class="tape-track">
            <div class="tape-rows" id="alt-rows"></div>
            <div class="tape-caret"></div>
          </div>
          <div class="tape-foot"><span>RAD ALT</span><b><span id="agl-value">0</span> M</b></div>
        </div>
        <div class="mini-stat vs-stat"><span>V/S</span><b id="vs-value">+0.0</b></div>
      </div>

      <div class="hud-center">
        <div class="ladder-clip"><div class="pitch-ladder" id="pitch-ladder"></div></div>
        <svg class="reticle" viewBox="0 0 400 400" aria-hidden="true">
          <circle cx="200" cy="200" r="52" />
          <path d="M148 200h-26M252 200h26M200 148v-22M200 252v22" />
          <path d="M176 176l-10 -10M224 176l10 -10M176 224l-10 10M224 224l10 10" />
          <circle cx="200" cy="200" r="2.2" class="reticle-dot"/>
          <path d="M118 200l-14 -5v10zM282 200l14 -5v10z" class="reticle-wing"/>
        </svg>
        <div class="fpm" id="fpm"><span></span></div>
        <div class="warning-box" id="warning-box"></div>
        <div class="threat-arrows" id="threat-arrows" aria-hidden="true"></div>
      </div>

      <div class="flight-status"><span class="status-dot"></span><b id="flight-status">FLIGHT COMPUTER NOMINAL</b><span class="status-extra">AUTO TRIM ON</span></div>

      <aside class="radar-panel">
        <div class="radar-head"><span>TACTICAL RADAR</span><span id="radar-range">7.5 KM</span></div>
        <div class="radar-wrap">
          <canvas id="radar-canvas" width="400" height="400"></canvas>
          <div class="radar-scanline"></div>
        </div>
        <div class="radar-foot"><span id="radar-nearest">NO CONTACTS</span><span>Z+</span></div>
      </aside>

      <aside class="threat-radar">
        <div class="threat-radar-head"><span>THREAT SCOPE</span><b id="threat-radar-count">0</b></div>
        <canvas id="threat-radar-canvas" width="320" height="320"></canvas>
        <div class="threat-radar-foot"><span id="threat-radar-nearest">CLEAR</span><span>7.5 KM</span></div>
      </aside>

      <aside class="engine-panel">
        <div class="engine-title"><span>PROPULSION</span><b id="engine-mode">MIL</b></div>
        <div class="engine-row"><label>THR</label><div class="bar"><i id="throttle-fill"></i></div><b id="throttle-value">68%</b></div>
        <div class="engine-row boost-row"><label>AB</label><div class="segments" id="boost-segments"></div><b id="boost-value">100</b></div>
        <div class="engine-grid">
          <div><span>G LOAD</span><b id="g-value">1.0</b></div>
          <div><span>BURNER</span><b id="ab-state">STBY</b></div>
          <div><span>BRAKE</span><b id="brake-state">OFF</b></div>
        </div>
      </aside>

      <aside class="weapon-panel">
        <div class="weapon-title"><span>ARMAMENT</span><b id="weapon-mode">GUN · MSL</b></div>
        <div class="weapon-row">
          <label>HULL</label>
          <div class="bar hull-bar"><i id="hull-fill"></i></div>
          <b id="hull-value">100</b>
        </div>
        <div class="weapon-grid">
          <div><span>MISSILES</span><b id="missile-count">∞</b></div>
          <div><span>FLARES</span><b id="flare-count">15</b></div>
          <div><span>KILLS</span><b id="kill-count">0</b></div>
          <div><span>SCORE</span><b id="score-value">0000</b></div>
          <div><span>LOCK</span><b id="lock-state">—</b></div>
          <div><span>INBOUND</span><b id="inbound-value">—</b></div>
        </div>
      </aside>

      <div class="target-box" id="target-box" aria-hidden="true">
        <div class="tb-frame">
          <i class="tb-corner tl"></i><i class="tb-corner tr"></i>
          <i class="tb-corner bl"></i><i class="tb-corner br"></i>
        </div>
        <svg class="tb-crosshair" viewBox="0 0 100 100" aria-hidden="true">
          <polygon class="tb-diamond" points="50,12 88,50 50,88 12,50" />
          <path class="tb-ticks" d="M50 4v14M50 82v14M4 50h14M82 50h14" />
          <circle class="tb-center" cx="50" cy="50" r="3" />
        </svg>
        <span class="tb-label" id="target-label">BANDIT</span>
        <span class="tb-range" id="target-range">0.0 KM</span>
      </div>

      <div class="mp-pilot-tags" id="mp-pilot-tags" aria-hidden="true"></div>
      <div class="mp-hud-pill" id="mp-hud-pill" hidden aria-hidden="true"></div>
      <div class="mp-scoreboard" id="mp-scoreboard" hidden aria-hidden="true"></div>

      <div class="cockpit-overlay" id="cockpit-overlay" aria-hidden="true">
        <div class="cockpit-canopy"></div>
      </div>

      <div class="missile-cam-frame" id="missile-cam-frame" aria-hidden="true">
        <div class="mc-head">
          <span class="mc-dot"></span>
          <b id="missile-cam-label">MISSILE CAM · AIM-9X</b>
          <span id="missile-cam-range">TRACKING</span>
        </div>
        <div class="mc-viewport">
          <span class="mc-cross-h"></span>
          <span class="mc-cross-v"></span>
          <span class="mc-status" id="missile-cam-status">SEEKER LOCK</span>
        </div>
      </div>

      <div class="carrier-banner" id="carrier-banner" hidden aria-hidden="true"></div>

      <div class="flight-chat" id="flight-chat" aria-live="polite">
        <div class="flight-chat-log" id="flight-chat-log"></div>
        <div class="flight-chat-bar">
          <span class="flight-chat-prompt">COMMS &gt;</span>
          <input
            type="text"
            id="flight-chat-input"
            maxlength="96"
            autocomplete="off"
            spellcheck="false"
            placeholder="Ketik pesan / perintah... (ENTER kirim · ESC batal)"
          />
        </div>
      </div>

      <div class="key-hints">
        <span><b>W/S</b> PITCH</span>
        <span><b>A/D</b> ROLL</span>
        <span><b>Q/E</b> YAW</span>
        <span><b>SHIFT</b> BOOST</span>
        <span><b>SPACE</b> BRAKE</span>
        <span><b>F/LMB</b> GUN</span>
        <span><b>G/RMB</b> MSL</span>
        <span><b>V</b> FLARE</span>
        <span><b>C</b> VIEW</span>
        <span><b>R</b> RESET CAM</span>
        <span><b>L</b> LOCK</span>
        <span><b>ENTER</b> CHAT</span>
      </div>

      <div class="hud-toast" id="hud-toast"></div>
      <div class="hud-flash" id="hud-flash"></div>

      <div class="help-card" id="help-card">
        <div class="help-head"><span>FLIGHT MANUAL</span><button type="button" class="help-close" id="btn-help-close" aria-label="Close">×</button></div>
        <div class="help-grid">${controlsHtml}</div>
        <p>Flight is always fly-by-wire. Pull the stick to climb, roll to turn, and keep an eye on the radar altimeter over the islands.</p>
      </div>
    </div>

    <section class="screen start-screen" id="start-screen">
      <div class="screen-noise"></div>
      <div class="start-topbar">
        <div class="start-brand"><span class="start-brand-mark"></span> SKYBOUND <small>FLIGHT OPERATIONS</small></div>
        <div class="start-top-meta"><span>SECTOR 07</span><span>17° 43' N / 146° 12' E</span><span>COMBAT PATROL</span></div>
      </div>

      <div class="start-main">
        <div class="start-copy">
          <div class="eyebrow"><span></span> LOW-POLY FLIGHT SIMULATOR / BUILD 01</div>
          <h1>SKY<span>BOUND</span></h1>
          <p class="start-lead" id="start-lead">
            A living archipelago of wind-carved islands, turquoise shallows and cloud banks —
            now contested by bandit jets. You have the stick and the guns. Find the horizon.
          </p>
          <div class="start-actions">
            <nav class="main-menu" id="main-menu" aria-label="Menu utama">
              <button type="button" class="menu-item primary" id="btn-start" disabled>
                <span class="menu-num">01</span>
                <span class="menu-label">NEW GAME</span>
                <span class="menu-icon">→</span>
              </button>
              <button type="button" class="menu-item" id="btn-missions" disabled>
                <span class="menu-num">02</span>
                <span class="menu-label">DAFTAR MISI</span>
                <span class="menu-icon">→</span>
              </button>
              <button type="button" class="menu-item" id="btn-continue" disabled>
                <span class="menu-num">03</span>
                <span class="menu-label">CONTINUE</span>
                <span class="menu-icon">→</span>
              </button>
              <button type="button" class="menu-item" id="btn-settings" disabled>
                <span class="menu-num">04</span>
                <span class="menu-label">SETTING</span>
                <span class="menu-icon">→</span>
              </button>
              <button type="button" class="menu-item" id="btn-about" disabled>
                <span class="menu-num">05</span>
                <span class="menu-label">ABOUT</span>
                <span class="menu-icon">→</span>
              </button>
              <button type="button" class="menu-item" id="btn-exit" disabled>
                <span class="menu-num">06</span>
                <span class="menu-label">EXIT</span>
                <span class="menu-icon">→</span>
              </button>
            </nav>
            <button type="button" class="mp-menu-cta" id="btn-multiplayer" disabled>
              <span class="mp-cta-badge">ONLINE</span>
              <span class="mp-cta-label">MULTIPLAYER · CO-OP &amp; VERSUS</span>
              <span class="mp-cta-sub">ROOM CODE</span>
            </button>
            <div class="boot-readout">
              <div class="boot-line"><i id="boot-fill"></i></div>
              <div class="boot-meta"><span id="boot-label">INITIALISING FLIGHT SYSTEMS</span><b id="boot-percent">0%</b></div>
            </div>
          </div>
          <div class="start-status" id="boot-status"><span class="status-dot"></span><span>WORLD GENERATOR STANDBY</span></div>
          <div class="start-touch-hint">
            TOUCH FLIGHT · LEFT STICK PITCH / ROLL · RIGHT STICK YAW / THROTTLE · GUN / MSL / AB / BRK BUTTONS
          </div>
          <div class="start-facts">
            <div><b id="fact-islands">15</b><span id="fact-landlabel">ISLANDS</span></div>
            <div><b id="fact-trees">—</b><span>TREES</span></div>
            <div><b id="fact-area">—</b><span>KM² TERRAIN</span></div>
            <div><b id="fact-clouds">—</b><span>CLOUD CELLS</span></div>
          </div>
        </div>

        <div class="start-side">
          <div class="start-panel">
            <div class="start-panel-head"><span>FLIGHT CONTROLS</span><span>01 / 02</span></div>
            <div class="start-control-grid">${controlsHtml}</div>
            <div class="touch-note">TOUCH DEVICE DETECTED · VIRTUAL STICKS ENABLED</div>
          </div>
          <div class="aircraft-card">
            <div class="aircraft-card-top"><span>AIRFRAME</span><b>F-31 WRAITH</b></div>
            <div class="aircraft-silhouette">
              <svg viewBox="0 0 260 110" aria-hidden="true">
                <path d="M130 7l7 32 84 22 8 12-92-4-4 26 24 13v6l-27-5-27 5v-6l24-13-4-26-92 4 8-12 84-22z"/>
              </svg>
            </div>
            <div class="aircraft-specs">
              <div><span>MAX SPEED</span><b>M 1.08</b></div>
              <div><span>CEILING</span><b>5 200 M</b></div>
              <div><span>ROLE</span><b>AIR SUPERIORITY</b></div>
            </div>
          </div>
        </div>
      </div>

      <div class="start-footer">
        <div><span>PROCEDURAL WORLD</span> · REAL-TIME THREE.JS</div>
        <div class="start-footer-center">BEST EXPERIENCED WITH HEADPHONES</div>
        <div>© 2026 SKYBOUND OPS · V1.8.1</div>
      </div>
    </section>

    <section class="screen hangar-screen" id="hangar-screen" aria-hidden="true">
      <div class="screen-noise"></div>
      <div class="hangar-head">
        <div class="start-brand"><span class="start-brand-mark"></span> SKYBOUND <small>HANGAR / AIRFRAME SELECT</small></div>
        <button type="button" class="ghost-btn" id="btn-hangar-back">← MENU UTAMA</button>
      </div>

      <div class="hangar-main">
        <div class="hangar-copy">
          <div class="eyebrow"><span></span> NEW GAME / PILIH PESAWAT</div>
          <h2>HANGAR</h2>
          <p class="hangar-lead">
            Pilih airframe sebelum lepas landas. Pesawat terkunci terbuka otomatis
            setiap kali misi diselesaikan.
          </p>
          <div class="hangar-detail" id="hangar-detail"></div>
          <button type="button" class="launch-btn" id="btn-hangar-launch" disabled>
            <span class="launch-label">PILIH PESAWAT</span>
            <span class="launch-icon">→</span>
          </button>
          <div class="start-facts hangar-facts">
            <div><b id="hangar-count">2 / 5</b><span>PESAWAT TERBUKA</span></div>
            <div><b id="hangar-mission">01</b><span>MISI BERIKUTNYA</span></div>
            <div><b id="hangar-points">0 PTS</b><span>POINT TERSEDIA</span></div>
          </div>
        </div>
        <div class="hangar-right-col">
          <div class="hangar-grid" id="hangar-grid"></div>
          <div class="hangar-missile-box">
            <div class="hangar-missile-head">
              <b>MODE MISSILE (8 PILIHAN)</b>
              <span id="hangar-missile-info">AIM-9X SIDEWINDER · IR DOGFIGHT</span>
            </div>
            <div class="hangar-missile-grid" id="hangar-missile-grid"></div>
          </div>
        </div>
      </div>

      <div class="start-footer">
        <div><span>NEW GAME</span> · PILIH AIRFRAME</div>
        <div class="start-footer-center" id="hangar-selected">F-31 WRAITH</div>
        <div>© 2026 SKYBOUND OPS · V1.8.1</div>
      </div>
    </section>

    <section class="screen menu-screen campaign-screen" id="campaign-screen" aria-hidden="true">
      <div class="screen-noise"></div>
      <div class="hangar-head">
        <div class="start-brand"><span class="start-brand-mark"></span> SKYBOUND <small>OPERATIONS / DAFTAR MISI</small></div>
        <button type="button" class="ghost-btn" id="btn-campaign-back">← MENU UTAMA</button>
      </div>

      <div class="campaign-main">
        <div class="campaign-copy">
          <div class="eyebrow"><span></span> KAMPANYE CERITA / SEKTOR 07</div>
          <h2>DAFTAR<br><span>MISI</span></h2>
          <p class="hangar-lead" id="campaign-lead">
            Satu operasi, delapan bab. Setiap misi membawa front baru: kepulauan,
            pusat kota, gurun, dan pegunungan.
          </p>
          <div class="hangar-detail campaign-detail" id="campaign-detail"></div>
          <button type="button" class="launch-btn" id="btn-campaign-launch" disabled>
            <span class="launch-label">PILIH MISI</span>
            <span class="launch-icon">→</span>
          </button>
          <div class="start-facts hangar-facts">
            <div><b id="campaign-progress">01 / 08</b><span>MISI DIBUKA</span></div>
            <div><b id="campaign-map">CORAL</b><span>PETA AKTIF</span></div>
          </div>
        </div>
        <ol class="mission-list" id="mission-list" aria-label="Daftar misi kampanye"></ol>
      </div>

      <div class="start-footer">
        <div><span>KAMPANYE</span> · STORY MODE</div>
        <div class="start-footer-center">DELAPAN MISI · EMPAT PETA</div>
        <div>© 2026 SKYBOUND OPS · V1.8.1</div>
      </div>
    </section>

    <section class="screen menu-screen settings-screen" id="settings-screen" aria-hidden="true">
      <div class="screen-noise"></div>
      <div class="hangar-head">
        <div class="start-brand"><span class="start-brand-mark"></span> SKYBOUND <small>SETTING / PENGATURAN</small></div>
        <button type="button" class="ghost-btn" id="btn-settings-back">← MENU UTAMA</button>
      </div>

      <div class="settings-panel">
        <div class="settings-col">
          <div class="settings-group">
            <div class="settings-group-head"><span>GRAPHIC</span><b>GRAFIK</b></div>
            <div class="setting-row">
              <span>KUALITAS</span>
              <div class="segmented" id="settings-quality-select">
                <button type="button" data-quality="low">LOW</button>
                <button type="button" data-quality="medium">MED</button>
                <button type="button" data-quality="high">HIGH</button>
              </div>
            </div>
            <div class="setting-row">
              <span>HUD SIDE</span>
              <div class="segmented" id="settings-hud-side">
                <button type="button" data-hudside="left">KIRI</button>
                <button type="button" data-hudside="right">KANAN</button>
              </div>
            </div>
            <div class="setting-row">
              <span>SKALA UI</span>
              <div class="sens-control">
                <input type="range" class="ui-scale-range" min="0.8" max="1.6" step="0.05" value="1" aria-label="Skala antarmuka" />
                <b class="ui-scale-value">100%</b>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-head"><span>KEY BUTTON · KHUSUS MOBILE</span><b>TOMBOL SENTUH</b></div>
            <div class="setting-row">
              <span>LETAK TOMBOL (MOBILE)</span>
              <div class="segmented" id="settings-btn-layout">
                <button type="button" data-btnlayout="left">KIRI</button>
                <button type="button" data-btnlayout="center">TENGAH</button>
                <button type="button" data-btnlayout="right">KANAN</button>
              </div>
            </div>
            <div class="setting-row mobile-only-row">
              <span>EDIT HUD &amp; CAM TOMBOL</span>
              <div class="setting-controls">
                <button type="button" class="toggle-btn" id="btn-mobile-hud-edit">ATUR HUD MOBILE</button>
              </div>
            </div>
            <div class="setting-row">
              <span>AUTO LOCK VIEW</span>
              <div class="segmented" id="settings-autolock">
                <button type="button" data-autolock="off">MATI</button>
                <button type="button" data-autolock="on">HIDUP</button>
              </div>
            </div>
            <div class="setting-row">
              <span>GIROSKOP</span>
              <div class="segmented" id="settings-gyro">
                <button type="button" data-gyro="off">MATI</button>
                <button type="button" data-gyro="on">HIDUP</button>
              </div>
            </div>
            <div class="setting-row">
              <span>KALIBRASI GIRO</span>
              <div class="setting-controls">
                <button type="button" class="toggle-btn" data-gyrocal>KALIBRASI</button>
              </div>
            </div>
            <div class="setting-row">
              <span>PETA DUNIA</span>
              <div class="segmented" id="settings-map-select">
                <button type="button" data-map="coral">CORAL</button>
                <button type="button" data-map="city">KOTA</button>
                <button type="button" data-map="desert">GURUN</button>
                <button type="button" data-map="mountain">GUNUNG</button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-col">
          <div class="settings-group">
            <div class="settings-group-head"><span>SENSITIF GERAK</span><b>SENSITIVITAS</b></div>
            <div class="setting-row">
              <span>GIRO / LOOK</span>
              <div class="sens-control">
                <input type="range" id="sens-slider" min="0.4" max="2.5" step="0.05" value="1" />
                <b id="sens-value">100%</b>
                <button type="button" class="toggle-btn" id="btn-sens-reset">RESET</button>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-head"><span>SYSTEM</span><b>SISTEM PENERBANGAN</b></div>
            <div class="setting-row">
              <span>AUDIO</span>
              <button type="button" class="toggle-btn" id="btn-sound-toggle">SOUND ON</button>
            </div>
            <div class="setting-row">
              <span>CAMERA</span>
              <button type="button" class="toggle-btn" id="btn-camera-cycle">01 · CHASE</button>
            </div>
            <div class="setting-row">
              <span>EDIT HUD &amp; HUD CAM</span>
              <div class="setting-controls">
                <div class="segmented" id="hud-edit-select">
                  <button type="button" data-hudedit="off">TETAP</button>
                  <button type="button" data-hudedit="on">GESER</button>
                </div>
                <button type="button" class="toggle-btn" id="btn-hud-reset">RESET</button>
              </div>
            </div>
          </div>

          <div class="settings-group keymap-group">
            <div class="settings-group-head"><span>KEYMAPPING</span><b>PETA TOMBOL</b></div>
            <div class="keymap-list" id="keymap-list"></div>
            <div class="keymap-foot">
              <button type="button" class="toggle-btn" id="btn-keymap-reset">RESET KEYMAPPING</button>
              <span class="keymap-note" id="keymap-note">KLIK TOMBOL AKSI · TEKAN KUNCI BARU</span>
            </div>
          </div>
        </div>
      </div>

      <div class="start-footer">
        <div><span>SETTING</span> · GRAFIK / TOMBOL / SENSITIF / SISTEM</div>
        <div class="start-footer-center">TERSIMPAN PER PERANGKAT</div>
        <div>© 2026 SKYBOUND OPS · V2.1.0</div>
      </div>
    </section>

    <section class="screen menu-screen multiplayer-screen" id="multiplayer-screen" aria-hidden="true">
      <div class="screen-noise"></div>
      <div class="hangar-head">
        <div class="start-brand"><span class="start-brand-mark"></span> SKYBOUND <small>ONLINE / MULTIPLAYER ROOM CODE</small></div>
        <button type="button" class="ghost-btn" id="btn-mp-back">← MENU UTAMA</button>
      </div>

      <div class="mp-main">
        <div class="mp-col">
          <div class="eyebrow"><span></span> P2P ONLINE · CO-OP &amp; VERSUS (ALL MODE)</div>
          <h2>MULTI<span>PLAYER</span></h2>
          <p class="hangar-lead">
            Buat Room Code atau masukkan kode temanmu. Mendukung <b>Co-Op Online</b> (skuadron bersama melawan bandit AI)
            dan <b>Versus Online</b> (dogfight PvP antar-pemain di semua peta &amp; semua pesawat).
          </p>

          <div class="settings-group mp-group">
            <div class="settings-group-head"><span>PILOT &amp; MODE</span><b>KONFIGURASI ROOM</b></div>
            <div class="setting-row">
              <span>CALLSIGN PILOT</span>
              <input type="text" class="mp-text-input" id="mp-callsign" maxlength="12" value="ACE-01" aria-label="Callsign pilot" />
            </div>
            <div class="setting-row">
              <span>MODE ONLINE</span>
              <div class="segmented" id="mp-mode-select">
                <button type="button" data-mpmode="coop" class="active">CO-OP</button>
                <button type="button" data-mpmode="versus">VERSUS (20)</button>
                <button type="button" data-mpmode="team">TIM 3v3 (40)</button>
              </div>
            </div>
            <div class="setting-row" id="mp-team-row" hidden>
              <span>PILIH TIM (3 vs 3)</span>
              <div class="segmented" id="mp-team-select">
                <button type="button" data-mpteam="blue" class="active">TIM BIRU (0/3)</button>
                <button type="button" data-mpteam="red">TIM MERAH (0/3)</button>
              </div>
            </div>
            <div class="setting-row" id="mp-bandits-row">
              <span>BANDIT AI / NPC</span>
              <div class="segmented" id="mp-bandits-select">
                <button type="button" data-mpbandits="on" class="active">ON (CO-OP)</button>
                <button type="button" data-mpbandits="off">TANPA NPC</button>
              </div>
            </div>
            <div class="setting-row">
              <span>PETA ROOM</span>
              <div class="segmented" id="mp-map-select">
                <button type="button" data-mpmap="coral" class="active">CORAL</button>
                <button type="button" data-mpmap="city">KOTA</button>
                <button type="button" data-mpmap="desert">GURUN</button>
                <button type="button" data-mpmap="mountain">GUNUNG</button>
              </div>
            </div>
            <div class="setting-row mp-aircraft-row">
              <span>PILIH PESAWAT</span>
              <div class="mp-aircraft-grid" id="mp-aircraft-select">
                ${AIRCRAFT.map(
                  (craft, idx) => `
                  <button type="button" class="mp-craft-btn ${idx === 0 ? 'active' : ''}" data-mpaircraft="${craft.id}" title="${craft.role} · HULL ${craft.stats.hull}">
                    <b>${craft.name}</b>
                    <small>${craft.role}</small>
                  </button>`
                ).join('')}
              </div>
            </div>
          </div>

          <div class="settings-group mp-group">
            <div class="settings-group-head"><span>ROOM CODE</span><b>BUAT ATAU GABUNG ROOM</b></div>
            <div class="mp-code-controls">
              <input type="text" class="mp-code-input" id="mp-room-input" maxlength="8" placeholder="KODE (MIS: SKY482)" aria-label="Kode Room" />
              <button type="button" class="toggle-btn mp-action-btn primary" id="btn-mp-create">BUAT ROOM</button>
              <button type="button" class="toggle-btn mp-action-btn" id="btn-mp-join">GABUNG ROOM</button>
            </div>
            <div class="mp-room-bar">
              <div class="mp-active-badge">
                <span>KODE AKTIF</span>
                <b id="mp-active-code">—</b>
              </div>
              <div class="mp-room-btns">
                <button type="button" class="toggle-btn" id="btn-mp-copy">SALIN KODE</button>
                <button type="button" class="toggle-btn" id="btn-mp-leave">PUTUSKAN</button>
              </div>
            </div>
          </div>
        </div>

        <div class="mp-col mp-roster-col">
          <div class="settings-group mp-group mp-roomlist-box">
            <div class="settings-group-head">
              <span>DAFTAR ROOM AKTIF</span>
              <div class="mp-roomlist-tools">
                <b id="mp-room-count">0 ROOM</b>
                <button type="button" class="toggle-btn mp-refresh-btn" id="btn-mp-refresh-rooms">↻ REFRESH</button>
              </div>
            </div>
            <div class="mp-room-list" id="mp-room-list">
              <div class="mp-pilot-empty">Belum ada room aktif terdeteksi. Klik <b>REFRESH</b> atau buat room baru.</div>
            </div>
          </div>

          <div class="settings-group mp-group mp-roster-box">
            <div class="settings-group-head">
              <span>SQUADRON ROSTER</span>
              <b id="mp-status-text">OFFLINE · BELUM DI ROOM</b>
            </div>
            <div class="mp-pilot-list" id="mp-pilot-list">
              <div class="mp-pilot-empty">Tekan <b>BUAT ROOM</b> untuk membuat kode baru, atau pilih room dari <b>DAFTAR ROOM AKTIF</b>.</div>
            </div>
          </div>

          <button type="button" class="launch-btn" id="btn-mp-launch">
            <span class="launch-label">BUAT ROOM &amp; MULAI PERMAINAN</span>
            <span class="launch-icon">→</span>
          </button>
          <div class="mp-launch-note" id="mp-launch-note">Host mengatur permainan · Pemain yang join diminta READY terlebih dahulu.</div>
        </div>
      </div>

      <div class="start-footer">
        <div><span>WEBRTC P2P + LOCAL</span> · SIAP UNTUK GITHUB.IO</div>
        <div class="start-footer-center">CO-OP · VERSUS 20 · TIM 3v3 (40 SKOR · 10 MENIT)</div>
        <div>© 2026 SKYBOUND OPS · V2.1.0</div>
      </div>

      <div class="mp-profile-gate" id="mp-profile-gate" hidden aria-hidden="true">
        <div class="mp-profile-card">
          <div class="panel-kicker">PROFIL PILOT ONLINE</div>
          <h3>BUAT NAMA <span>PROFIL</span></h3>
          <p>
            Sebelum masuk ke mode Multiplayer, buat nama profil / callsign pilotmu dahulu agar tampil
            di Daftar Room, Roster Skuadron, dan Papan Skor.
          </p>
          <input
            type="text"
            class="mp-text-input mp-profile-input"
            id="mp-profile-input"
            maxlength="12"
            placeholder="MIS: GARUDA-1"
            aria-label="Nama profil pilot"
          />
          <div class="mp-profile-actions">
            <button type="button" class="primary-btn" id="btn-mp-profile-save">SIMPAN &amp; LANJUTKAN <span>→</span></button>
            <button type="button" class="secondary-btn" id="btn-mp-profile-cancel">KEMBALI KE MENU</button>
          </div>
        </div>
      </div>
    </section>

    <section class="screen mp-result-screen" id="mp-result-screen" aria-hidden="true">
      <div class="screen-backdrop"></div>
      <div class="mp-result-panel">
        <div class="panel-kicker" id="mp-result-kicker">PERTANDINGAN SELESAI</div>
        <h2 id="mp-result-title">PEMENANG</h2>
        <p class="mp-result-summary" id="mp-result-summary">—</p>
        <div class="mp-result-standings" id="mp-result-standings"></div>
        <div class="pause-actions">
          <button type="button" class="primary-btn" id="btn-mp-result-lobby">KEMBALI KE LOBI ROOM <span>→</span></button>
          <button type="button" class="secondary-btn" id="btn-mp-result-menu">KELUAR KE MENU UTAMA</button>
        </div>
      </div>
    </section>

    <section class="screen menu-screen about-screen" id="about-screen" aria-hidden="true">
      <div class="screen-noise"></div>
      <div class="hangar-head">
        <div class="start-brand"><span class="start-brand-mark"></span> SKYBOUND <small>ABOUT / TENTANG</small></div>
        <button type="button" class="ghost-btn" id="btn-about-back">← MENU UTAMA</button>
      </div>

      <div class="about-panel">
        <div class="eyebrow"><span></span> ABOUT / TENTANG GAME</div>
        <h2>SKY<span>BOUND</span></h2>
        <p class="about-credit">
          Pembuatan game oleh <b>HeavyRain AKA Ziky Andeska</b>
        </p>
        <div class="about-grid">
          <div><span>ENGINE</span><b>THREE.JS 0.169</b></div>
          <div><span>VERSION</span><b>2.1.0</b></div>
          <div><span>GENRE</span><b>FLIGHT SIMULATOR</b></div>
          <div><span>STYLE</span><b>LOW-POLY PIXEL</b></div>
          <div><span>VIEWS</span><b>01 CHASE / 02 COCKPIT</b></div>
          <div><span>PLATFORM</span><b>WEBGL BROWSER</b></div>
        </div>
        <p class="about-note">
          Simulator penerbangan arcade di atas kepulauan prosedural: bandit jet,
          rudal, flare pengecoh, dan tiga kamera pertempuran. Dibangun murni
          dengan JavaScript + Three.js tanpa aset eksternal.
        </p>
        <div class="about-credit-line">HEAVYRAIN AKA ZIKY ANDESKA · 2026</div>
      </div>

      <div class="start-footer">
        <div><span>ABOUT</span> · KREDIT PEMBUAT</div>
        <div class="start-footer-center">SKYBOUND FLIGHT OPERATIONS</div>
        <div>© 2026 SKYBOUND OPS · V1.8.1</div>
      </div>
    </section>

    <section class="screen menu-screen exit-screen" id="exit-screen" aria-hidden="true">
      <div class="screen-backdrop"></div>
      <div class="exit-panel">
        <div class="panel-kicker">CONNECTION CLOSED</div>
        <h2>TERIMA<br><span>KASIH</span></h2>
        <p id="exit-note">Sesi penerbangan berakhir. Tutup tab ini untuk keluar, atau kembali ke menu.</p>
        <div class="pause-actions">
          <button type="button" class="primary-btn" id="btn-exit-confirm">TUTUP GAME <span>×</span></button>
          <button type="button" class="secondary-btn" id="btn-exit-back">KEMBALI KE MENU</button>
        </div>
      </div>
    </section>

    <section class="screen pause-screen" id="pause-screen" aria-hidden="true">
      <div class="screen-backdrop"></div>
      <div class="pause-panel">
        <div class="panel-kicker">FLIGHT SUSPENDED</div>
        <h2>HOLD<br>POSITION</h2>
        <p id="pause-desc">Your aircraft is holding. Adjust systems, then return to the sky.</p>
        <div class="pause-actions">
          <button type="button" class="primary-btn" id="btn-resume">RESUME FLIGHT <span>→</span></button>
          <button type="button" class="secondary-btn" id="btn-pause-settings">PENGATURAN</button>
          <button type="button" class="secondary-btn" id="btn-restart">RESTART SORTIE</button>
          <button type="button" class="secondary-btn" id="btn-pause-menu">KEMBALI KE MENU</button>
        </div>
        <div class="pause-hint">P PAUSE · M SOUND · H HELP · L AUTO LOCK</div>
      </div>
    </section>

    <section class="screen crash-screen" id="crash-screen" aria-hidden="true">
      <div class="screen-backdrop"></div>
      <div class="crash-panel">
        <div class="panel-kicker danger">SIGNAL LOST // AIRFRAME DOWN</div>
        <h2>AIRFRAME<br><span>LOST</span></h2>
        <p id="crash-cause">Impact with terrain. Telemetry link terminated.</p>
        <div class="crash-stats">
          <div><span>IMPACT SPEED</span><b id="crash-speed">—</b></div>
          <div><span>LAST ALTITUDE</span><b id="crash-alt">—</b></div>
          <div><span>FLIGHT TIME</span><b id="crash-time">—</b></div>
        </div>
        <button type="button" class="primary-btn" id="btn-respawn">REDEPLOY <span>→</span></button>
        <div class="respawn-line"><span id="respawn-label">AUTO-REDEPLOY IN 4</span></div>
      </div>
    </section>

    <section class="screen mission-result-screen" id="mission-result-screen" aria-hidden="true">
      <div class="screen-backdrop"></div>
      <div class="mission-result-panel">
        <div class="panel-kicker" id="mission-result-kicker">MISSION COMPLETE // SECTOR CLEARED</div>
        <h2 id="mission-result-title">MISI<br><span>SELESAI</span></h2>
        <p id="mission-result-story"></p>
        <div class="mission-result-stats">
          <div><span>KILL</span><b id="mission-result-kills">0</b></div>
          <div><span>SKOR</span><b id="mission-result-score">0</b></div>
          <div><span>WAKTU</span><b id="mission-result-time">00:00</b></div>
        </div>
        <div class="mission-result-reward" id="mission-result-reward"></div>
        <div class="pause-actions">
          <button type="button" class="primary-btn" id="btn-mission-next">MISI BERIKUTNYA <span>→</span></button>
          <button type="button" class="secondary-btn" id="btn-mission-menu">KEMBALI KE MENU</button>
        </div>
      </div>
    </section>

    <div class="world-loading" id="world-loading" hidden aria-hidden="true">
      <div class="world-loading-panel">
        <span class="panel-kicker">WORLD GENERATOR // LIVE SWITCH</span>
        <b id="world-loading-label">MEMBANGUN PETA</b>
        <div class="world-load-track"><i id="world-load-fill"></i></div>
        <span id="world-loading-percent">0%</span>
      </div>
    </div>

    <div class="hud-edit-bar" id="hud-edit-bar" hidden aria-hidden="true">
      <div class="hud-edit-bar-copy">
        <b>MODE EDIT HUD &amp; CAM</b>
        <span>SERET PANEL / TOMBOL · KETUK UNTUK UKURAN &amp; TRANSPARAN</span>
      </div>
      <div class="hud-edit-bar-actions">
        <button type="button" class="toggle-btn" id="btn-hud-edit-reset">RESET SEMUA</button>
        <button type="button" class="primary-btn" id="btn-hud-edit-done">SIMPAN &amp; SELESAI</button>
      </div>
    </div>

    <div class="hud-editor" id="hud-editor" hidden aria-hidden="true">
      <div class="hud-editor-head">
        <div class="hud-editor-title-wrap">
          <span id="hud-editor-title">PANEL</span>
          <small class="hud-editor-mode" id="hud-editor-mode">LANDSCAPE</small>
        </div>
        <button type="button" id="hud-editor-close" aria-label="Tutup editor">×</button>
      </div>
      <div class="hud-editor-row">
        <span>UKURAN</span>
        <button type="button" id="hud-scale-down">−</button>
        <b id="hud-scale-value">100%</b>
        <button type="button" id="hud-scale-up">+</button>
      </div>
      <div class="hud-editor-row">
        <span>TRANSPARAN</span>
        <button type="button" id="hud-opacity-down">−</button>
        <b id="hud-opacity-value">100%</b>
        <button type="button" id="hud-opacity-up">+</button>
      </div>
      <button type="button" class="hud-editor-reset" id="hud-panel-reset">RESET PANEL INI</button>
    </div>
    `;
  }

  _buildCompass() {
    const fragment = document.createDocumentFragment();
    for (let deg = -180; deg <= 540; deg += 5) {
      const tick = el('div', 'compass-tick');
      const normalized = ((deg % 360) + 360) % 360;
      tick.style.left = `${(deg + 180) * COMPASS_PX_PER_DEG}px`;
      if (deg % 15 === 0) tick.classList.add('major');
      if (deg % 30 === 0) {
        tick.classList.add('labeled');
        const label = el('span', 'compass-label');
        label.textContent = CARDINALS[normalized] ?? pad(normalized, 3);
        if (CARDINALS[normalized]) label.classList.add('cardinal-label');
        tick.appendChild(label);
      }
      fragment.appendChild(tick);
    }
    this.compassStrip.appendChild(fragment);
  }

  _buildLadder() {
    const frag = document.createDocumentFragment();
    for (let angle = -90; angle <= 90; angle += 5) {
      if (angle === 0) continue;
      const line = el('div', 'ladder-line');
      if (angle < 0) line.classList.add('negative');
      if (angle % 10 === 0) line.classList.add('ten');
      line.style.top = `${-angle * LADDER_PX_PER_DEG}px`;
      const left = el('span', 'ladder-num left', `${angle > 0 ? angle : Math.abs(angle)}`);
      const right = el('span', 'ladder-num right', `${angle > 0 ? angle : Math.abs(angle)}`);
      line.append(left, right);
      frag.appendChild(line);
    }
    const horizon = el('div', 'ladder-horizon');
    horizon.innerHTML = '<span>HORIZON</span>';
    frag.appendChild(horizon);
    this.ladder.appendChild(frag);
  }

  _bindEvents() {
    const on = (id, fn) => {
      const node = document.getElementById(id);
      if (node) node.addEventListener('click', fn);
    };
    on('btn-start', () => this.callbacks.onStart?.());
    on('btn-missions', () => this.callbacks.onMissions?.());
    on('btn-continue', () => this.callbacks.onContinue?.());
    on('btn-campaign-back', () => this.closeSubScreen('campaign'));
    on('btn-campaign-launch', () => {
      const index = this.campaignSelected;
      if (index > this.campaignProgressIndex) return;
      this.callbacks.onMissionLaunch?.(index);
    });
    on('btn-mission-next', () => this.callbacks.onMissionNext?.());
    on('btn-mission-menu', () => this.callbacks.onMissionMenu?.());
    on('btn-settings', () => this.showSettings(true));
    on('btn-multiplayer', () => this.callbacks.onMultiplayerOpen?.());
    on('btn-mp-back', () => this.closeSubScreen('multiplayer'));
    on('btn-mp-create', () => {
      const code = this.mpRoomInput?.value || '';
      this.callbacks.onMultiplayerCreate?.(code);
    });
    on('btn-mp-join', () => {
      const code = this.mpRoomInput?.value || '';
      this.callbacks.onMultiplayerJoin?.(code);
    });
    on('btn-mp-copy', () => this.callbacks.onMultiplayerCopy?.());
    on('btn-mp-leave', () => this.callbacks.onMultiplayerLeave?.());
    on('btn-mp-launch', () => this.callbacks.onMultiplayerLaunch?.());
    on('btn-mp-refresh-rooms', () => this.callbacks.onMultiplayerRefreshRooms?.());
    this.mpRoomList?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-join-room]');
      if (!btn || btn.disabled) return;
      const code = btn.dataset.joinRoom;
      if (this.mpRoomInput) this.mpRoomInput.value = code;
      this.callbacks.onMultiplayerJoin?.(code);
    });
    this.mpCallsignInput?.addEventListener('change', () => {
      this.callbacks.onMultiplayerCallsign?.(this.mpCallsignInput.value);
    });
    document.querySelectorAll('#mp-mode-select [data-mpmode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        document.querySelectorAll('#mp-mode-select [data-mpmode]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        this.callbacks.onMultiplayerMode?.(btn.dataset.mpmode);
      });
    });
    document.querySelectorAll('#mp-bandits-select [data-mpbandits]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        document.querySelectorAll('#mp-bandits-select [data-mpbandits]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        this.callbacks.onMultiplayerBandits?.(btn.dataset.mpbandits === 'on');
      });
    });
    document.querySelectorAll('#mp-map-select [data-mpmap]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.callbacks.onMap?.(btn.dataset.mpmap);
      });
    });
    document.querySelectorAll('#mp-aircraft-select [data-mpaircraft]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.callbacks.onMultiplayerAircraft?.(btn.dataset.mpaircraft);
      });
    });
    document.querySelectorAll('#mp-team-select [data-mpteam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.callbacks.onMultiplayerTeam?.(btn.dataset.mpteam);
      });
    });
    on('btn-mp-profile-save', () => {
      this.callbacks.onMultiplayerProfileSave?.(this.mpProfileInput?.value || '');
    });
    on('btn-mp-profile-cancel', () => {
      this.showMultiplayerProfileGate(false);
      this.closeSubScreen('multiplayer');
    });
    this.mpProfileInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.callbacks.onMultiplayerProfileSave?.(this.mpProfileInput.value);
      }
    });
    on('btn-mp-result-lobby', () => this.callbacks.onMultiplayerResultLobby?.());
    on('btn-mp-result-menu', () => this.callbacks.onMultiplayerResultMenu?.());
    on('btn-about', () => this.showAbout(true));
    on('btn-exit', () => this.showExit(true));
    on('btn-settings-back', () => this.closeSubScreen('settings'));
    on('btn-about-back', () => this.closeSubScreen('about'));
    on('btn-exit-back', () => this.closeSubScreen('exit'));
    on('btn-exit-confirm', () => this.callbacks.onExitConfirm?.());
    on('btn-sens-reset', () => {
      this.setSensitivity(1);
      this.callbacks.onSensitivity?.(1);
    });
    on('btn-keymap-reset', () => this.callbacks.onKeymapReset?.());
    this.sensSlider?.addEventListener('input', () => {
      const value = Number(this.sensSlider.value);
      this._paintSensitivity(value);
      this.callbacks.onSensitivity?.(value);
    });
    this.keymapList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-keymap]');
      if (button) this._beginRebind(button.dataset.keymap);
    });
    // Rebind capture: swallow the key so it never reaches the flight input.
    window.addEventListener(
      'keydown',
      (event) => {
        if (!this._rebindAction) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === 'Escape') {
          this._endRebind('cancel');
          return;
        }
        const ok = this.callbacks.onSetBinding?.(this._rebindAction, event.code) ?? false;
        if (ok) {
          this._bindings = { ...this._bindings, [this._rebindAction]: event.code };
          this.setKeymap(this._bindings);
        }
        this._endRebind(ok ? 'ok' : 'conflict', event.code);
      },
      true
    );
    on('btn-hangar-back', () => {
      this.showAircraftSelect(false);
      this.callbacks.onAircraftBack?.();
    });
    on('btn-hangar-launch', () => {
      const pick = this.hangarSelected;
      this.showAircraftSelect(false);
      this.callbacks.onAircraftLaunch?.(pick);
    });
    on('btn-pause', () => this.callbacks.onPause?.());
    on('btn-resume', () => this.callbacks.onResume?.());
    on('btn-pause-settings', () => this.showSettings(true));
    on('btn-restart', () => {
      const btn = document.getElementById('btn-restart');
      if (btn?.disabled) return;
      this.callbacks.onRestart?.();
    });
    on('btn-pause-menu', () => this.callbacks.onReturnToMenu?.());
    on('btn-respawn', () => this.callbacks.onRespawn?.());
    on('btn-help', () => this.callbacks.onHelp?.());
    on('btn-help-close', () => this.callbacks.onHelpClose?.());
    on('btn-mute', () => this.callbacks.onMute?.());
    on('btn-sound-toggle', () => this.callbacks.onMute?.());
    on('btn-view', () => this.callbacks.onCamera?.());
    on('btn-fullscreen', () => this.callbacks.onFullscreen?.());
    on('btn-camera-cycle', () => this.callbacks.onCamera?.());
    document.querySelectorAll('[data-hudside]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onHudSide?.(button.dataset.hudside));
    });
    document.querySelectorAll('[data-btnlayout]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onButtonLayout?.(button.dataset.btnlayout));
    });
    document.querySelectorAll('[data-gyro]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onGyro?.(button.dataset.gyro));
    });
    document.querySelectorAll('[data-autolock]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onAutoLock?.(button.dataset.autolock === 'on'));
    });
    document.querySelectorAll('.ui-scale-range').forEach((input) => {
      input.addEventListener('input', () => {
        const value = Number(input.value);
        this.setUiScale(value);
        this.callbacks.onUiScale?.(value);
      });
    });
    on('btn-autolock', () => this.callbacks.onAutoLockToggle?.());
    if (this.flightChatInput) {
      this.flightChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const raw = this.flightChatInput.value.trim();
          this.flightChatInput.value = '';
          this.closeChat();
          if (raw) this.callbacks.onChatSubmit?.(raw);
          else this.callbacks.onChatClose?.();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.flightChatInput.value = '';
          this.closeChat();
          this.callbacks.onChatClose?.();
        }
      });
    }
    document.querySelectorAll('[data-map]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.callbacks.onMap?.(button.dataset.map);
      });
    });
    document.querySelectorAll('[data-gyrocal]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onGyroCalibrate?.());
    });
    document.querySelectorAll('#hud-edit-select [data-hudedit]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onHudEdit?.(button.dataset.hudedit));
    });
    on('btn-mobile-hud-edit', () => this.callbacks.onHudEdit?.('on'));
    on('btn-hud-edit-done', () => this.callbacks.onHudEdit?.('off'));
    on('btn-hud-edit-reset', () => this.callbacks.onHudReset?.());
    on('btn-hud-reset', () => this.callbacks.onHudReset?.());

    // Per-panel editor widget.
    on('hud-editor-close', () => this._closeHudEditor());
    on('hud-scale-down', () => this._nudgeHudScale(-0.1));
    on('hud-scale-up', () => this._nudgeHudScale(0.1));
    on('hud-opacity-down', () => this._nudgeHudOpacity(-0.1));
    on('hud-opacity-up', () => this._nudgeHudOpacity(0.1));
    on('hud-panel-reset', () => this._resetHudPanel());
    document.querySelectorAll('[data-quality]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onQuality?.(button.dataset.quality));
    });
    this.startScreen.addEventListener('pointermove', (event) => {
      const x = event.clientX / window.innerWidth - 0.5;
      const y = event.clientY / window.innerHeight - 0.5;
      this.startScreen.style.setProperty('--mx', `${x * 22}px`);
      this.startScreen.style.setProperty('--my', `${y * 16}px`);
    });
  }

  setPhase(phase) {
    this.phase = phase;
    if (phase !== 'menu') this._openSubScreen(null);
    const flying = phase === 'flying' || phase === 'crashed';
    this.root.classList.toggle('visible', flying || phase === 'paused');
    this.root.setAttribute('aria-hidden', String(!flying && phase !== 'paused'));
    this.startScreen.classList.toggle('visible', phase === 'menu' && !this.subScreen);
    this.pauseScreen.classList.toggle('visible', phase === 'paused');
    this.crashScreen.classList.toggle('visible', phase === 'crashed');
    this.missionResultScreen?.classList.toggle('visible', phase === 'debrief');
    this.missionResultScreen?.setAttribute('aria-hidden', String(phase !== 'debrief'));
    if (phase === 'menu') {
      this.helpCard.classList.remove('visible');
      this.pauseScreen.setAttribute('aria-hidden', 'true');
      this.crashScreen.setAttribute('aria-hidden', 'true');
    }
    if (phase === 'flying') this.startScreen.classList.remove('visible');
    this.root.classList.toggle('is-paused', phase === 'paused');
    this.root.classList.toggle('is-crashed', phase === 'crashed');
    this._syncMapSwitchLock();
  }

  setProgress(progress, label) {
    const percent = Math.round(clamp(progress, 0, 1) * 100);
    this.loadingFill.style.width = `${percent}%`;
    this.loadingLabel.textContent = label ?? 'BUILDING WORLD';
    this.bootPercent.textContent = `${percent}%`;
    this.bootStatus.querySelector('span:last-child').textContent =
      percent >= 100 ? 'WORLD READY // CLEARED FOR LAUNCH' : 'WORLD GENERATOR ACTIVE';
    // Mirror into the static boot overlay so the very first paint of the
    // page already shows a live loading bar.
    if (this.bootLoadFill) this.bootLoadFill.style.width = `${percent}%`;
    if (this.bootLoadLabel) this.bootLoadLabel.textContent = label ?? 'BUILDING WORLD';
    if (this.bootLoadPercent) this.bootLoadPercent.textContent = `${percent}%`;
  }

  setReady(stats = {}) {
    this.setProgress(1, 'ALL SYSTEMS NOMINAL');
    for (const button of this.menuButtons) button.disabled = false;
    if (this.multiplayerButton) this.multiplayerButton.disabled = false;
    this.startButton.disabled = false;
    const primaryLabel = this.startButton.querySelector('.menu-label');
    if (primaryLabel) primaryLabel.textContent = 'NEW GAME';
    this.startScreen.classList.add('ready');
    this.setWorldFacts(stats);
    this.bootStatus.querySelector('span:last-child').textContent =
      'WORLD READY // CLEARED FOR LAUNCH';
    // Fade the loading overlay out (CSS transition handles the rest).
    this.bootOverlay?.classList.add('ready');
  }

  /** Re-shows the boot overlay as an error panel (fatal boot failures). */
  showBootFailure(message = 'UNKNOWN ERROR') {
    if (!this.bootOverlay) return;
    this.bootOverlay.classList.remove('ready');
    this.bootOverlay.classList.add('failed');
    const sub = this.bootOverlay.querySelector('.boot-fallback-sub');
    if (sub) sub.textContent = `BOOT FAILURE // ${message}`;
    const spinner = this.bootOverlay.querySelector('.boot-spinner');
    if (spinner) spinner.style.display = 'none';
    if (this.bootLoadLabel) this.bootLoadLabel.textContent = 'BOOT FAILURE';
    if (this.bootLoadPercent) this.bootLoadPercent.textContent = '—';
  }

  /** Toggles the fullscreen button highlight (Game drives the actual API). */
  setFullscreen(active) {
    if (!this.btnFullscreen) return;
    this.btnFullscreen.classList.toggle('active', !!active);
    this.btnFullscreen.setAttribute('aria-pressed', String(!!active));
  }

  setQuality(quality) {
    this.qualityLabel = quality.toUpperCase();
    if (this.qualityValue) this.qualityValue.textContent = this.qualityLabel;
    document.querySelectorAll('[data-quality]').forEach((button) => {
      button.classList.toggle('active', button.dataset.quality === quality);
    });
  }

  setMuted(muted) {
    this.muted = muted;
    const btn = document.getElementById('btn-mute');
    const toggle = document.getElementById('btn-sound-toggle');
    if (btn) {
      btn.classList.toggle('muted', muted);
      btn.innerHTML = muted ? '<span class="sound-off"></span>' : '<span class="sound-on"></span>';
    }
    if (toggle) toggle.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }

  showToast(text, duration = 3800) {
    this.toast.textContent = text;
    this.toast.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toast.classList.remove('visible'), duration);
  }

  showHelp(show) {
    this.helpCard.classList.toggle('visible', show);
  }

  flash(type = 'impact') {
    this.hudFlash.className = `hud-flash ${type}`;
    void this.hudFlash.offsetWidth;
    this.hudFlash.classList.add('active');
    setTimeout(() => this.hudFlash.classList.remove('active'), 500);
  }

  showCrash(info) {
    this.setPhase('crashed');
    document.getElementById('crash-cause').textContent = info.cause;
    document.getElementById('crash-speed').textContent = info.speed;
    document.getElementById('crash-alt').textContent = info.altitude;
    document.getElementById('crash-time').textContent = info.time;
    this.setRespawnCountdown(info.countdown ?? 4);
  }

  /**
   * Debrief overlay after the objective is met. Shows the next story beat and
   * lets the pilot jump straight into the next mission or return to the menu.
   * @param {{mission:object, next?:object|null, unlocked?:string[], kills?:number,
   *          score?:number, time?:number, complete?:boolean}} info
   */
  showMissionResult(info = {}) {
    this.setPhase('debrief');
    const mission = info.mission;
    const next = info.next ?? null;
    const unlocked = info.unlocked ?? [];
    const complete = !!info.complete;
    if (this.missionResultKicker) {
      this.missionResultKicker.textContent = complete
        ? 'CAMPAIGN COMPLETE // SECTOR SECURED'
        : 'MISSION COMPLETE // SECTOR CLEARED';
    }
    if (this.missionResultTitle) {
      this.missionResultTitle.innerHTML = complete
        ? 'KAMPANYE<br><span>TUNTAS</span>'
        : 'MISI<br><span>SELESAI</span>';
    }
    if (this.missionResultStory) {
      this.missionResultStory.textContent = complete
        ? 'Seluruh sektor kembali aman. Langit di atas kepulauan, kota, gurun, dan pegunungan akhirnya bersih. Terima kasih, pilot.'
        : next?.story ?? 'Objektif tercapai. Sektor aman untuk saat ini.';
    }
    if (this.missionResultKills) this.missionResultKills.textContent = String(info.kills ?? 0);
    if (this.missionResultScore) this.missionResultScore.textContent = String(info.score ?? 0);
    if (this.missionResultTime) this.missionResultTime.textContent = formatMissionClock(info.time ?? 0);
    if (this.missionResultReward) {
      const ptsLine =
        Number.isFinite(info.rewardPoints) && info.rewardPoints > 0
          ? ` · +${info.rewardPoints} PTS (TOTAL ${info.totalPoints ?? info.rewardPoints} PTS)`
          : '';
      this.missionResultReward.innerHTML = complete
        ? `<b>SEMUA MISI SELESAI${ptsLine}</b><span>Seluruh airframe telah terbuka. Gunakan Point di Hangar untuk membuka semua Missile.</span>`
        : unlocked.length
          ? `<b>AIRFRAME BARU · ${unlocked.map(getAircraftName).join(' · ')}${ptsLine}</b><span>Pesawat baru & Point hadiah sudah masuk ke Hangar.</span>`
          : next
            ? `<b>MISI BERIKUTNYA · ${pad(MISSIONS.indexOf(next) + 1, 2)} ${next.name}${ptsLine}</b><span>${next.brief}</span>`
            : `<b>SEKTOR AMAN${ptsLine}</b><span>Gunakan Point di Hangar untuk membuka mode Missile baru.</span>`;
    }
    if (this.missionNext) {
      this.missionNext.hidden = !next;
      this.missionNext.disabled = !next;
      this.missionNext.innerHTML = next
        ? 'MISI BERIKUTNYA <span>→</span>'
        : 'KAMPANYE TUNTAS';
    }
    this.missionResultScreen?.classList.add('visible');
    this.missionResultScreen?.setAttribute('aria-hidden', 'false');
  }

  hideMissionResult() {
    this.missionResultScreen?.classList.remove('visible');
    this.missionResultScreen?.setAttribute('aria-hidden', 'true');
  }

  /** Full-screen generator overlay used for the in-place map switch. */
  setWorldLoading(show, progress = 0, label = 'MEMBANGUN PETA') {
    const pct = Math.round(clamp(progress, 0, 1) * 100);
    if (this.worldLoading) {
      this.worldLoading.hidden = !show;
      this.worldLoading.setAttribute('aria-hidden', String(!show));
      this.worldLoading.classList.toggle('visible', !!show);
    }
    if (this.worldLoadingLabel) this.worldLoadingLabel.textContent = label;
    if (this.worldLoadFill) this.worldLoadFill.style.width = `${pct}%`;
    if (this.worldLoadingPercent) this.worldLoadingPercent.textContent = `${pct}%`;
  }

  setRespawnCountdown(seconds) {
    const node = document.getElementById('respawn-label');
    if (node) node.textContent = `AUTO-REDEPLOY IN ${Math.max(0, Math.ceil(seconds))}`;
  }

  showPause(show) {
    this.setPhase(show ? 'paused' : 'flying');
  }

  /** Open/close the New Game hangar; rebuilds the cards when `data` is given. */
  showAircraftSelect(show, data) {
    if (data) this.renderHangar(data);
    if (show) {
      if (this.phase === 'menu') this._openSubScreen('hangar');
    } else if (this.subScreen === 'hangar') {
      this._openSubScreen(null);
    }
  }

  showCampaign(show, data) {
    if (show) {
      if (this.phase !== 'menu') return;
      if (data) this.renderCampaign(data);
      this._openSubScreen('campaign');
    } else if (this.subScreen === 'campaign') {
      this._openSubScreen(null);
    }
  }

  showSettings(show) {
    if (show) {
      // Reachable from the main menu and from the pause panel.
      if (this.phase !== 'menu' && this.phase !== 'paused') return;
      const back = document.getElementById('btn-settings-back');
      if (back) back.textContent = this.phase === 'paused' ? '← KEMBALI' : '← MENU UTAMA';
      this._syncMapSwitchLock();
      this._openSubScreen('settings');
    } else if (this.subScreen === 'settings') {
      this._openSubScreen(null);
    }
  }

  showAbout(show) {
    if (show) {
      if (this.phase === 'menu') this._openSubScreen('about');
    } else if (this.subScreen === 'about') {
      this._openSubScreen(null);
    }
  }

  showMultiplayer(show, summary = null) {
    if (summary) this.setMultiplayerStatus(summary);
    if (show) {
      if (this.phase === 'menu' || this.phase === 'paused') {
        this._openSubScreen('multiplayer');
      }
    } else if (this.subScreen === 'multiplayer') {
      this._openSubScreen(null);
    }
  }

  setMultiplayerStatus(summary = {}) {
    this._mpSummary = summary;
    if (this.mpCallsignInput && summary.pilots?.[0]?.callsign) {
      if (document.activeElement !== this.mpCallsignInput) {
        this.mpCallsignInput.value = summary.pilots[0].callsign;
      }
    }
    if (this.mpActiveCode) {
      this.mpActiveCode.textContent = summary.active && summary.roomCode ? summary.roomCode : '—';
    }
    if (this.mpRoomInput && summary.active && summary.roomCode && !this.mpRoomInput.value) {
      this.mpRoomInput.value = summary.roomCode;
    }
    if (this.mpStatusText) {
      this.mpStatusText.textContent = summary.status || 'OFFLINE · BELUM DI ROOM';
    }
    document.querySelectorAll('#mp-mode-select [data-mpmode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mpmode === (summary.mode || 'coop'));
    });
    const isTeamMode = summary.mode === 'team';
    const isPvpMode = summary.mode === 'versus' || isTeamMode;
    const teamRow = document.getElementById('mp-team-row');
    if (teamRow) teamRow.hidden = !isTeamMode;
    if (isTeamMode) {
      const counts = summary.teamCounts || { blue: 0, red: 0 };
      document.querySelectorAll('#mp-team-select [data-mpteam]').forEach((btn) => {
        const t = btn.dataset.mpteam;
        btn.classList.toggle('active', t === (summary.localTeam || 'blue'));
        btn.textContent = t === 'red' ? `TIM MERAH (${counts.red || 0}/3)` : `TIM BIRU (${counts.blue || 0}/3)`;
      });
    }
    const banditsRow = document.getElementById('mp-bandits-row');
    if (banditsRow) banditsRow.hidden = isPvpMode;
    document.querySelectorAll('#mp-bandits-select [data-mpbandits]').forEach((btn) => {
      const on = !isPvpMode && summary.allowBandits !== false;
      btn.classList.toggle('active', btn.dataset.mpbandits === (on ? 'on' : 'off'));
    });
    if (summary.mapId) {
      document.querySelectorAll('#mp-map-select [data-mpmap]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mpmap === summary.mapId);
      });
    }
    if (this.mpPilotList) {
      if (!summary.active) {
        this.mpPilotList.innerHTML =
          '<div class="mp-pilot-empty">Tekan <b>BUAT ROOM</b> untuk membuat kode baru, atau pilih room dari <b>DAFTAR ROOM AKTIF</b>.</div>';
      } else {
        const modeTag =
          summary.mode === 'team'
            ? 'TIM 3v3'
            : summary.mode === 'versus'
              ? 'VERSUS 20'
              : 'CO-OP';
        this.mpPilotList.innerHTML = (summary.pilots || [])
          .map((p) => {
            const badge = p.isHost
              ? '<span class="mp-ready-badge is-host">HOST</span>'
              : p.ready
                ? '<span class="mp-ready-badge is-ready">✓ READY</span>'
                : '<span class="mp-ready-badge is-wait">BELUM READY</span>';
            const teamBadge =
              summary.mode === 'team'
                ? `<span class="mp-team-badge team-${p.team === 'red' ? 'red' : 'blue'}">${p.team === 'red' ? 'MERAH' : 'BIRU'}</span>`
                : '';
            const craftName = getAircraftName(p.aircraftId || 'wraith');
            return `
            <div class="mp-pilot-row ${p.isLocal ? 'is-local' : ''} ${summary.mode === 'team' ? `team-${p.team === 'red' ? 'red' : 'blue'}` : ''}">
              <span class="mp-pilot-callsign">${teamBadge}<b>${p.callsign}</b> ${p.isLocal ? '<small>(KAMU)</small>' : ''}<em class="mp-pilot-craft">${craftName}</em></span>
              <span class="mp-pilot-role">${badge}<span>${modeTag}</span></span>
            </div>`;
          })
          .join('');
      }
    }
    if (this.mpLaunchBtn) {
      const labelEl = this.mpLaunchBtn.querySelector('.launch-label');
      const iconEl = this.mpLaunchBtn.querySelector('.launch-icon');
      const isGuest = !!(summary.active && !summary.isHost);
      const isHost = !!(summary.active && summary.isHost);
      this.mpLaunchBtn.classList.toggle('is-ready-btn', isGuest);
      this.mpLaunchBtn.classList.toggle('is-ready-active', isGuest && !!summary.localReady);
      if (isGuest) {
        if (summary.localReady) {
          if (labelEl) labelEl.textContent = '✓ READY · MENUNGGU HOST MEMULAI...';
          if (iconEl) iconEl.textContent = '✓';
          if (this.mpLaunchNote) {
            this.mpLaunchNote.textContent =
              'Kamu sudah READY! Permainan akan mulai otomatis saat Host menekan Mulai.';
          }
        } else {
          if (labelEl) {
            labelEl.textContent = summary.matchStarted
              ? 'READY · MASUK PERTARUNGAN SEKARANG'
              : 'SIAP (READY) · MASUK PERMAINAN';
          }
          if (iconEl) iconEl.textContent = '✓';
          if (this.mpLaunchNote) {
            this.mpLaunchNote.textContent = summary.matchStarted
              ? 'Host sudah memulai permainan! Tekan READY untuk langsung bergabung ke langit.'
              : 'Tekan READY agar siap masuk saat Host memulai permainan.';
          }
        }
      } else if (isHost) {
        const guestCount = summary.guestCount || 0;
        const readyGuests = summary.readyGuests || 0;
        if (labelEl) {
          labelEl.textContent =
            guestCount > 0
              ? `MULAI PERMAINAN · HOST (${readyGuests}/${guestCount} READY)`
              : 'MULAI PERMAINAN · HOST LAUNCH';
        }
        if (iconEl) iconEl.textContent = '→';
        if (this.mpLaunchNote) {
          this.mpLaunchNote.textContent =
            guestCount === 0
              ? 'Host boleh langsung memulai permainan kapan saja.'
              : summary.allGuestsReady
                ? 'Semua pemain sudah READY — Host bisa langsung memulai permainan!'
                : 'Host boleh langsung memulai; pemain yang READY akan ikut terjun otomatis.';
        }
      } else {
        if (labelEl) labelEl.textContent = 'BUAT ROOM & MULAI PERMAINAN';
        if (iconEl) iconEl.textContent = '→';
        if (this.mpLaunchNote) {
          this.mpLaunchNote.textContent =
            'Host mengatur permainan · Pemain yang join diminta READY terlebih dahulu.';
        }
      }
    }
    if (this.mpHudPill) {
      if (!summary.active) {
        this.mpHudPill.hidden = true;
        this.mpHudPill.setAttribute('aria-hidden', 'true');
      } else {
        const modeLabel =
          summary.mode === 'team'
            ? 'TIM 3v3'
            : summary.mode === 'versus'
              ? 'VERSUS PvP'
              : 'CO-OP ONLINE';
        const extra =
          summary.mode === 'coop' && summary.squadKills > 0
            ? ` · SQUAD ${summary.squadKills} KILL`
            : '';
        this.mpHudPill.hidden = false;
        this.mpHudPill.setAttribute('aria-hidden', 'false');
        this.mpHudPill.className = `mp-hud-pill mode-${summary.mode}`;
        this.mpHudPill.innerHTML = `<span class="mp-dot"></span><b>${modeLabel}</b><span>ROOM ${summary.roomCode}</span><span>${summary.totalPilots || 1} PILOT${extra}</span>`;
      }
    }
    this.updateMultiplayerScoreboard(summary);
    this._syncMapSwitchLock();
  }

  /** Shows or hides the mandatory Pilot Profile Name setup modal before Multiplayer. */
  showMultiplayerProfileGate(show, currentCallsign = '') {
    if (!this.mpProfileGate) return;
    this.mpProfileGate.hidden = !show;
    this.mpProfileGate.setAttribute('aria-hidden', String(!show));
    this.mpProfileGate.classList.toggle('visible', !!show);
    if (show && this.mpProfileInput) {
      this.mpProfileInput.value = currentCallsign && !currentCallsign.startsWith('ACE-') ? currentCallsign : '';
      try {
        this.mpProfileInput.focus();
      } catch {
        /* ignore in jsdom */
      }
    }
  }

  /**
   * Updates the top-center HUD Scoreboard for Solo Versus (target 20) and
   * Team 3 vs 3 (40 vs 40 + 10:00 countdown timer).
   */
  updateMultiplayerScoreboard(summary = null) {
    if (!this.mpScoreboard) return;
    const show = !!(summary?.active && (summary.mode === 'versus' || summary.mode === 'team'));
    this.mpScoreboard.hidden = !show;
    this.mpScoreboard.setAttribute('aria-hidden', String(!show));
    if (!show) return;

    if (summary.mode === 'team') {
      const blue = summary.teamScores?.blue ?? 0;
      const red = summary.teamScores?.red ?? 0;
      const limit = summary.scoreLimit ?? 40;
      const secs = Math.max(0, Math.floor(summary.matchRemaining ?? 600));
      const clock = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
      const urgent = secs <= 60 ? 'is-urgent' : '';
      this.mpScoreboard.className = 'mp-scoreboard mode-team';
      this.mpScoreboard.innerHTML = `
        <div class="mp-sb-team team-blue">
          <span>TIM BIRU</span>
          <b>${blue}<small>/${limit}</small></b>
        </div>
        <div class="mp-sb-clock ${urgent}">
          <span>WAKTU</span>
          <b>${clock}</b>
        </div>
        <div class="mp-sb-team team-red">
          <b>${red}<small>/${limit}</small></b>
          <span>TIM MERAH</span>
        </div>`;
      return;
    }

    // Solo Versus (first to 20).
    const limit = summary.scoreLimit ?? 20;
    const myScore = summary.localPvpScore ?? 0;
    const leader = summary.standings?.[0] || { callsign: summary.callsign || 'PILOT', score: myScore };
    this.mpScoreboard.className = 'mp-scoreboard mode-versus';
    this.mpScoreboard.innerHTML = `
      <div class="mp-sb-versus-item">
        <span>SKOR KAMU</span>
        <b>${myScore}<small>/${limit}</small></b>
      </div>
      <div class="mp-sb-divider">TARGET ${limit}</div>
      <div class="mp-sb-versus-item is-leader">
        <span>PEMIMPIN · ${leader.callsign}</span>
        <b>${leader.score}<small>/${limit}</small></b>
      </div>`;
  }

  /** Shows the Multiplayer Match Over / Victory screen with final standings. */
  showMultiplayerResult(result = {}, summary = {}) {
    if (!this.mpResultScreen) return;
    if (this.mpResultKicker) {
      this.mpResultKicker.textContent =
        result.mode === 'team'
          ? result.reason === 'time'
            ? 'TIM 3 VS 3 · WAKTU 10 MENIT SELESAI'
            : 'TIM 3 VS 3 · TARGET SKOR 40 TERCAPAI'
          : 'VERSUS PvP · TARGET SKOR 20 TERCAPAI';
    }
    if (this.mpResultTitle) {
      this.mpResultTitle.textContent =
        result.winnerType === 'draw' ? 'HASIL SERI' : `${result.winnerName} MENANG!`;
    }
    if (this.mpResultSummary) {
      if (result.mode === 'team') {
        const b = result.teamScores?.blue ?? 0;
        const r = result.teamScores?.red ?? 0;
        this.mpResultSummary.textContent = `SKOR AKHIR · TIM BIRU ${b} — ${r} TIM MERAH`;
      } else {
        this.mpResultSummary.textContent = `${result.winnerName} mencapai skor ${result.winnerScore ?? 20} / 20 dan memenangkan dogfight!`;
      }
    }
    if (this.mpResultStandings) {
      const standings = result.standings || summary.standings || [];
      this.mpResultStandings.innerHTML = standings
        .map((row, idx) => {
          const teamTag =
            result.mode === 'team'
              ? `<span class="mp-team-badge team-${row.team === 'red' ? 'red' : 'blue'}">${row.team === 'red' ? 'MERAH' : 'BIRU'}</span>`
              : '';
          return `
            <div class="mp-standing-row ${row.isLocal ? 'is-local' : ''}">
              <span>#${idx + 1} ${teamTag} <b>${row.callsign}</b></span>
              <b>${row.score} KILL</b>
            </div>`;
        })
        .join('');
    }
    this.mpResultScreen.classList.add('visible');
    this.mpResultScreen.setAttribute('aria-hidden', 'false');
  }

  hideMultiplayerResult() {
    if (!this.mpResultScreen) return;
    this.mpResultScreen.classList.remove('visible');
    this.mpResultScreen.setAttribute('aria-hidden', 'true');
  }

  /** Renders the live Room List inside the Multiplayer lobby. */
  setMultiplayerRoomList(rooms = []) {
    if (this.mpRoomCount) {
      this.mpRoomCount.textContent = `${rooms.length} ROOM`;
    }
    if (!this.mpRoomList) return;
    if (!rooms.length) {
      this.mpRoomList.innerHTML =
        '<div class="mp-pilot-empty">Belum ada room aktif terdeteksi. Klik <b>REFRESH</b> atau masukkan Kode Room teman di kiri.</div>';
      return;
    }
    this.mpRoomList.innerHTML = rooms
      .map((room) => {
        const modeLabel =
          room.mode === 'team' ? 'TIM 3v3' : room.mode === 'versus' ? 'VERSUS 20' : 'CO-OP';
        const mapLabel = MAP_LABELS[room.mapId] || 'CORAL';
        const stateLabel = room.matchStarted ? 'BERTEMPUR' : 'LOBI';
        const actionHtml = room.isOwnRoom
          ? '<span class="mp-room-own">ROOM KAMU</span>'
          : `<button type="button" class="toggle-btn mp-join-list-btn" data-join-room="${room.roomCode}">GABUNG</button>`;
        return `
          <div class="mp-room-item ${room.isOwnRoom ? 'is-own' : ''}">
            <div class="mp-room-info">
              <div class="mp-room-top">
                <b class="mp-room-code">${room.roomCode}</b>
                <span class="mp-room-tag mode-${room.mode}">${modeLabel}</span>
                <span class="mp-room-tag">${mapLabel}</span>
                <span class="mp-room-tag state-${room.matchStarted ? 'live' : 'lobby'}">${stateLabel}</span>
              </div>
              <div class="mp-room-meta">HOST: ${room.hostCallsign || 'ACE'} · ${room.totalPilots || 1} PILOT</div>
            </div>
            ${actionHtml}
          </div>`;
      })
      .join('');
  }

  showExit(show) {
    if (show) {
      if (this.phase === 'menu') this._openSubScreen('exit');
    } else if (this.subScreen === 'exit') {
      this._openSubScreen(null);
    }
  }

  /**
   * Exactly one menu sub-screen at a time (hangar / settings / about / exit).
   * @param {string|null} name
   */
  _openSubScreen(name) {
    this.subScreen = name;
    this.hangarOpen = name === 'hangar';
    if (name && name !== 'hangar') this._endRebind('cancel');
    const screens = [
      [this.hangarScreen, 'hangar'],
      [this.campaignScreen, 'campaign'],
      [this.settingsScreen, 'settings'],
      [this.multiplayerScreen, 'multiplayer'],
      [this.aboutScreen, 'about'],
      [this.exitScreen, 'exit'],
    ];
    for (const [screen, key] of screens) {
      if (!screen) continue;
      const on = name === key;
      screen.classList.toggle('visible', on);
      screen.setAttribute('aria-hidden', String(!on));
    }
    this.startScreen.classList.toggle('visible', this.phase === 'menu' && !name);
  }

  /** Close the given sub-screen (or the active one when omitted). */
  closeSubScreen(name = null) {
    if (name && this.subScreen !== name) return;
    this._openSubScreen(null);
  }

  /** CONTINUE is only lit when a career save exists. */
  setContinueEnabled(enabled) {
    if (!this.continueButton) return;
    this.continueButton.disabled = !enabled;
    this.continueButton.classList.toggle('unavailable', !enabled);
    this.continueButton.title = enabled ? '' : 'TIDAK ADA SAVE';
  }

  /** Sensitivity slider (0.4–2.5) paint + sync. */
  setSensitivity(scale) {
    const value = clamp(Number(scale) || 1, 0.4, 2.5);
    if (this.sensSlider) this.sensSlider.value = String(value);
    this._paintSensitivity(value);
  }

  _paintSensitivity(value) {
    if (this.sensValue) this.sensValue.textContent = `${Math.round(value * 100)}%`;
  }

  /** Push the live keymap into the Setting screen rows. */
  setKeymap(bindings = {}) {
    this._bindings = { ...bindings };
    if (!this.keymapList) return;
    if (!this.keymapList.children.length) this._buildKeymap();
    for (const row of this.keymapList.querySelectorAll('.keymap-row')) {
      const cap = row.querySelector('.keycap');
      if (cap) cap.textContent = keyLabel(this._bindings[row.dataset.row]);
    }
  }

  _buildKeymap() {
    this.keymapList.textContent = '';
    for (const [action, label] of KEYMAP_ACTIONS) {
      const row = el('div', 'keymap-row');
      row.dataset.row = action;
      const name = el('span', 'keymap-name', label);
      const cap = el('button', 'keycap', keyLabel(this._bindings?.[action]));
      cap.type = 'button';
      cap.dataset.keymap = action;
      row.append(name, cap);
      this.keymapList.append(row);
    }
  }

  /** Keymapping: click an action, then press the new key (Esc cancels). */
  _beginRebind(action) {
    if (!this._bindings || !(action in this._bindings)) return;
    this._rebindAction = action;
    const label = KEYMAP_ACTIONS.find(([id]) => id === action)?.[1] ?? action;
    for (const row of this.keymapList.querySelectorAll('.keymap-row')) {
      const on = row.dataset.row === action;
      row.classList.toggle('listening', on);
      row.querySelector('.keycap')?.classList.toggle('listening', on);
    }
    if (this.keymapNote) this.keymapNote.textContent = `TEKAN KUNCI BARU · ${label} · ESC BATAL`;
  }

  _endRebind(result = 'cancel', code = null) {
    const active = this._rebindAction;
    this._rebindAction = null;
    for (const row of this.keymapList?.querySelectorAll('.keymap-row') ?? []) {
      row.classList.remove('listening');
      row.querySelector('.keycap')?.classList.remove('listening');
    }
    if (!active || !this.keymapNote) return;
    if (result === 'ok') {
      this.keymapNote.textContent = `TERSIMPAN · ${keyLabel(code)} · KLIK AKSI UNTUK UBAH`;
    } else if (result === 'conflict') {
      this.keymapNote.textContent = `TIDAK BOLEH DUPLIKAT · ${keyLabel(code)} SUDAH DIPAKAI`;
    } else {
      this.keymapNote.textContent = 'DIBATALKAN · KLIK TOMBOL AKSI UNTUK UBAH';
    }
  }

  /**
   * Story campaign list. Completed missions stay replayable; the active
   * mission is the last one the save has unlocked.
   * @param {{mission?:number, unlocked?:string[], selected?:number, map?:string}} data
   */
  renderCampaign({ mission = 0, unlocked = [], selected = null, map = 'coral' } = {}) {
    this.campaignProgressIndex = clamp(Math.floor(mission), 0, MISSIONS.length);
    this.campaignData = { mission: this.campaignProgressIndex, unlocked, map };
    this.missionList.textContent = '';

    MISSIONS.forEach((entry, index) => {
      const open = index <= this.campaignProgressIndex;
      const done = index < this.campaignProgressIndex;
      const active = index === this.campaignProgressIndex;
      const item = document.createElement('li');
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mission-card';
      card.dataset.mission = String(index);
      if (done) card.classList.add('complete');
      if (active) card.classList.add('active');
      if (!open) card.classList.add('locked');
      card.innerHTML = `
        <span class="mission-num">${pad(index + 1, 2)}</span>
        <span class="mission-copy">
          <b>${entry.name}</b>
          <i>${entry.chapter}</i>
          <small>${MAP_LABELS[entry.map] ?? 'CORAL'} · ${missionObjective(entry)}</small>
        </span>
        <span class="mission-state">${done ? 'SELESAI' : active ? 'AKTIF' : 'TERKUNCI'}</span>`;
      card.addEventListener('click', () => {
        if (index > this.campaignProgressIndex) {
          this.audioCue?.();
          return;
        }
        this.selectCampaignMission(index);
      });
      item.appendChild(card);
      this.missionList.appendChild(item);
    });

    this.campaignProgress.textContent = `${pad(Math.min(this.campaignProgressIndex + 1, MISSIONS.length), 2)} / ${pad(MISSIONS.length, 2)}`;
    const initial =
      Number.isInteger(selected) && selected >= 0 && selected <= this.campaignProgressIndex
        ? selected
        : this.campaignProgressIndex;
    this.campaignSelected = initial;
    this.selectCampaignMission(initial, { silent: true });
  }

  /** Highlight one campaign mission and paint its story / objective sheet. */
  selectCampaignMission(index, { silent = false } = {}) {
    const entry = MISSIONS[index];
    if (!entry) return;
    const active = this.campaignProgressIndex;
    this.campaignSelected = index;
    this.missionList.querySelectorAll('.mission-card').forEach((card) => {
      card.classList.toggle('selected', Number(card.dataset.mission) === index);
    });

    const done = index < active;
    const isActive = index === active;
    const state = done ? 'SELESAI' : isActive ? 'AKTIF' : 'TERKUNCI';
    const rewardId = entry.unlocks ? getAircraftName(entry.unlocks) : null;
    this.campaignDetail.innerHTML = `
      <div class="hangar-detail-head ${done ? '' : isActive ? '' : 'locked'}">
        <b>${pad(index + 1, 2)} · ${entry.name}</b>
        <span>${state}</span>
      </div>
      <div class="mission-detail-meta">
        <div><span>PETA</span><b>${MAP_LABELS[entry.map] ?? 'CORAL'}</b></div>
        <div><span>OBJEKTIF</span><b>${missionObjective(entry)}</b></div>
        <div><span>HADIAH</span><b>${rewardId ?? 'INTEL SEKTOR'}</b></div>
      </div>
      <p class="mission-story">${entry.story}</p>
      <p class="mission-brief"><b>BRIEF:</b> ${entry.brief}</p>`;
    this.campaignDetail.dataset.state = state.toLowerCase();
    this.campaignMap.textContent = MAP_LABELS[entry.map] ?? 'CORAL';

    if (this.campaignLaunch) {
      const playable = index <= active;
      this.campaignLaunch.disabled = !playable;
      this.campaignLaunch.querySelector('.launch-label').textContent = playable
        ? isActive
          ? 'TERBANGKAN MISI'
          : 'ULANG MISI'
        : 'MISI TERKUNCI';
    }
    if (!silent) this.callbacks.onMissionSelect?.(index);
  }

  /**Build the airframe cards from the catalogue.
   * @param {{unlocked?:string[], selected?:string|null, mission?:number, points?:number, unlockedMissiles?:string[], selectedMissile?:string}} data
   */
  renderHangar({ unlocked = [], selected = null, mission = 0, points, unlockedMissiles, selectedMissile } = {}) {
    const silhouettes = {
      // F-31 WRAITH: canard swept delta-trapezoid air-superiority fighter
      wraith:
        'M130 6l5 22 24 8 3 6-26-2 2 10 82 22 7 12-88-4-4 20 25 13v6l-28-5-28 5v-6l25-13-4-20-88 4 7-12 82-22 2-10-26 2 3-6 24-8z',
      // T-6 SPARROW: forward-swept wing light interceptor with needle nose
      sparrow:
        'M130 4l4 34 86-16 6 11-76 34-3 22 22 12v6l-29-5-29 5v-6l22-12-3-22-76-34 6-11 86 16z',
      // A-14 THUNDERBOLT: straight broad wing + twin rear turbofan nacelles + H-tail
      thunder:
        'M130 8l6 28 96 4v16l-88 4 14 14v12l-14-2v12l30 4v8h-88v-8l30-4v-12l-14 2v-12l14-14-88-4v-16l96-4z',
      // F-40 GHOST: diamond stealth fighter with serrated W-tail
      ghost:
        'M130 5l16 32 78 28-64 26-14-10-16 20-16-20-14 10-64-26 78-28z',
      // B-2 TITAN: wide flying-wing heavy fortress with sawtooth trailing edge
      titan:
        'M130 12l108 54-22 18-28-14-24 22-34-16-34 16-24-22-28 14-22-18z',
      // ADFX-02 MORGAN: forward-swept Belkan superfighter with canards + twin tail
      morgan:
        'M130 4l6 22 24 8 2 6-24-2 4 14 78-22 8 14-74 36-4 18 22 10v6l-28-5-14 4-14-4-28 5v-6l22-10-4-18-74-36 8-14 78 22 4-14-24 2 2-6 24-8z',
      // X-02S STRIKE WYVERN: switchblade forward-swept stealth fighter with V-tail
      wyvern:
        'M130 4l7 20 26 6 2 7-26-1 6 16 74-20 9 13-66 32-8 19 26 10v6l-32-6-18 5-18-5-32 6v-6l26-10-8-19-66-32 9-13 74 20 6-16-26 1 2-7 26-6z',
      // CFA-44 NOSFERATU: cranked-arrow wide stealth delta + dorsal ADMM bays
      nosferatu:
        'M130 4l7 22 26 9 1 6-26-2 4 10 92 24-6 14-56 4-18 17-24-6-24 6-18-17-56-4-6-14 92-24 4-10-26 2 1-6 26-9z',
      // ADF-01 FALKEN: COFFIN split-nose apex fighter with dagger forward-swept wings
      falken:
        'M130 2l8 24 28 7 2 7-28-2 6 16 82-26 8 15-78 37-4 18 26 11v6l-34-6-16 4-16-4-34 6v-6l26-11-4-18-78-37 8-15 82 26 6-16-28 2 2-7 28-7z',
    };
    this.hangarUnlocked = [...unlocked];
    this.hangarGrid.textContent = '';
    for (const craft of AIRCRAFT) {
      const open = isUnlocked(craft.id, this.hangarUnlocked);
      const card = el('button', 'hangar-card');
      card.type = 'button';
      card.dataset.aircraft = craft.id;
      if (!open) card.classList.add('locked');
      if (craft.elite) card.classList.add('elite');
      const silPath = silhouettes[craft.id] || silhouettes.wraith;
      const eliteBadge = craft.specialLabel ? ` · ${craft.specialLabel}` : '';
      card.innerHTML = `
        <span class="hangar-card-head"><b>${craft.name}</b><i>${craft.role}</i></span>
        <span class="hangar-card-sil">
          <svg viewBox="0 0 260 110" aria-hidden="true"><path d="${silPath}"/></svg>
        </span>
        <span class="hangar-card-specs">
          <span>SPD ${craft.stats.speed.toFixed(2)}</span>
          <span>TRN ${craft.stats.turn.toFixed(2)}</span>
          <span>BST ${craft.stats.boost.toFixed(2)}</span>
          <span>HUL ${craft.stats.hull}</span>
        </span>
        <span class="hangar-card-state">${open ? `TERBUKA${eliteBadge}` : `TERKUNCI · MISI ${(craft.unlock?.mission ?? 0) + 1}${eliteBadge}`}</span>`;
      card.addEventListener('click', () => {
        if (!open) {
          this._renderHangarDetail(craft, false);
          return;
        }
        this.selectAircraft(craft.id);
      });
      this.hangarGrid.appendChild(card);
    }

    const openCount = AIRCRAFT.filter((craft) => isUnlocked(craft.id, this.hangarUnlocked)).length;
    this.hangarCount.textContent = `${openCount} / ${AIRCRAFT.length}`;
    this.hangarMission.textContent = mission >= MISSIONS.length ? 'SELESAI' : pad(mission + 1, 2);
    this.renderHangarMissiles({
      points: points ?? this.hangarPointsValue,
      unlockedMissiles: unlockedMissiles ?? this.hangarMissilesUnlocked,
      selectedMissile: selectedMissile ?? this.hangarMissileSelected,
    });

    const fallback = AIRCRAFT.find((craft) => isUnlocked(craft.id, this.hangarUnlocked))?.id;
    const initial =
      selected && isUnlocked(selected, this.hangarUnlocked) ? selected : fallback;
    this.selectAircraft(initial);
  }

  /** Renders the 8-missile loadout picker & Point unlock cards inside the Hangar. */
  renderHangarMissiles({ points = 0, unlockedMissiles = ['aim9x'], selectedMissile = 'aim9x' } = {}) {
    this.hangarPointsValue = Math.max(0, Math.floor(Number(points) || 0));
    this.hangarMissilesUnlocked = Array.isArray(unlockedMissiles) ? unlockedMissiles : ['aim9x'];
    this.hangarMissileSelected = isMissileUnlocked(selectedMissile, this.hangarMissilesUnlocked)
      ? selectedMissile
      : 'aim9x';

    if (this.hangarPoints) {
      this.hangarPoints.textContent = `${this.hangarPointsValue.toLocaleString('en-US')} PTS`;
    }
    const spec = getMissile(this.hangarMissileSelected);
    if (this.hangarMissileInfo && spec) {
      this.hangarMissileInfo.textContent = `${spec.name} · ${spec.role} · ${spec.blurb}`;
    }
    if (!this.hangarMissileGrid) return;

    this.hangarMissileGrid.innerHTML = MISSILES.map((m) => {
      const open = isMissileUnlocked(m.id, this.hangarMissilesUnlocked);
      const active = open && m.id === this.hangarMissileSelected;
      const canBuy = !open && this.hangarPointsValue >= m.cost;
      const badge = active
        ? 'DIPAKAI'
        : open
          ? 'TERBUKA'
          : canBuy
            ? `BUKA ${m.cost} PTS`
            : `🔒 ${m.cost} PTS`;
      return `
        <button
          type="button"
          class="hangar-missile-card ${open ? '' : 'locked'} ${active ? 'active' : ''} ${canBuy ? 'affordable' : ''}"
          data-missile="${m.id}"
          title="${m.blurb}"
        >
          <span class="hm-code">${m.code}</span>
          <span class="hm-role">${m.role}</span>
          <span class="hm-badge">${badge}</span>
        </button>`;
    }).join('');

    this.hangarMissileGrid.querySelectorAll('.hangar-missile-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.missile;
        if (!id) return;
        if (isMissileUnlocked(id, this.hangarMissilesUnlocked)) {
          this.hangarMissileSelected = id;
          this.renderHangarMissiles({
            points: this.hangarPointsValue,
            unlockedMissiles: this.hangarMissilesUnlocked,
            selectedMissile: id,
          });
          this.callbacks.onMissileSelect?.(id);
        } else {
          this.callbacks.onMissileUnlock?.(id);
        }
      });
    });
  }

  /** Updates the right-side PIP Missile Minicam HUD overlay. */
  updateMissileCam(info) {
    if (!this.missileCamFrame) return;
    const show = !!(info && info.active);
    this.missileCamFrame.classList.toggle('visible', show);
    this.missileCamFrame.classList.toggle('impact', !!(show && info.impact));
    this.missileCamFrame.setAttribute('aria-hidden', String(!show));
    if (!show) return;
    if (this.missileCamLabel) {
      this.missileCamLabel.textContent = `MISSILE CAM · ${info.missileName || 'AIM-9X'}`;
    }
    if (this.missileCamRange) {
      this.missileCamRange.textContent = info.impact
        ? 'DETONATED'
        : Number.isFinite(info.range)
          ? `RNG ${Math.round(info.range)} M`
          : 'IN FLIGHT';
    }
    if (this.missileCamStatus) {
      this.missileCamStatus.textContent = info.impact
        ? 'IMPACT!'
        : info.target
          ? 'HOMING · LOCK'
          : 'BALLISTIC';
    }
  }

  /** Returns the screen rect of the right-side Missile Minicam for WebGL scissor rendering. */
  getMissileCamRect() {
    if (!this.missileCamFrame || !this.missileCamFrame.classList.contains('visible')) return null;
    const rect = this.missileCamFrame.getBoundingClientRect?.();
    if (!rect || rect.width < 20 || rect.height < 20) return null;
    return rect;
  }

  /** Shows/hides the top-center Carrier Catapult Launch status banner. */
  setCarrierBanner(text) {
    if (!this.carrierBanner) return;
    const show = !!text;
    this.carrierBanner.hidden = !show;
    this.carrierBanner.classList.toggle('visible', show);
    this.carrierBanner.setAttribute('aria-hidden', String(!show));
    if (show) this.carrierBanner.textContent = text;
  }

  /** Highlight an airframe and refresh the detail panel + launch button. */
  selectAircraft(id) {
    const craft = AIRCRAFT.find((entry) => entry.id === id);
    if (!craft || !isUnlocked(craft.id, this.hangarUnlocked)) return;
    this.hangarSelected = craft.id;
    this.hangarGrid.querySelectorAll('.hangar-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.aircraft === craft.id);
    });
    this.hangarSelectedLabel.textContent = craft.name;
    this.hangarLaunch.disabled = false;
    this.hangarLaunch.querySelector('.launch-label').textContent = `TERBANG · ${craft.name}`;
    this.setActiveAircraftBrand(craft);
    this._renderHangarDetail(craft, true);
    this.callbacks.onAircraftSelect?.(craft.id);
  }

  /** Syncs the top-left HUD brand block with the selected airframe callsign. */
  setActiveAircraftBrand(craft) {
    if (!craft?.name) return;
    const parts = craft.name.split(' ');
    const code = parts[0] || 'F-31';
    const callsign = parts.slice(1).join(' ') || craft.name;
    const numMatch = code.match(/\d+/);
    const markNum = this.root?.querySelector('.brand-mark b');
    const titleEl = this.root?.querySelector('.brand-copy strong');
    if (markNum && numMatch) markNum.textContent = numMatch[0];
    if (titleEl) titleEl.innerHTML = `${code} <em>${callsign}</em>`;
  }

  /** Spec sheet on the left of the hangar — or the lock reason if sealed. */
  _renderHangarDetail(craft, unlocked) {
    const bar = (label, value, pct) => `
      <div class="hangar-stat">
        <span>${label}</span>
        <div class="hangar-bar"><i style="width:${Math.round(clamp(pct, 6, 100))}%"></i></div>
        <b>${value}</b>
      </div>`;
    const mult = (v) => ((clamp(v, 0.75, 1.55) - 0.75) / 0.8) * 100;
    const specialNote = craft.specialLabel
      ? `<div class="hangar-lock-note">SENJATA KHUSUS ELIT · ${craft.specialLabel}</div>`
      : '';
    const stats = unlocked
      ? `
      ${bar('KECEPATAN', craft.stats.speed.toFixed(2), mult(craft.stats.speed))}
      ${bar('MANUVER', craft.stats.turn.toFixed(2), mult(craft.stats.turn))}
      ${bar('AFTERBURNER', craft.stats.boost.toFixed(2), mult(craft.stats.boost))}
      ${bar('HULL', String(craft.stats.hull), ((craft.stats.hull - 50) / 150) * 100)}`
      : '';
    this.hangarDetail.innerHTML = unlocked
      ? `
      <div class="hangar-detail-head"><b>${craft.name}</b><span>${craft.role}</span></div>
      <p>${craft.blurb}</p>
      ${specialNote}
      <div class="hangar-stats">${stats}</div>`
      : `
      <div class="hangar-detail-head locked"><b>${craft.name}</b><span>TERKUNCI</span></div>
      <p>Pesawat ini terbuka setelah Misi ${(craft.unlock?.mission ?? 0) + 1} diselesaikan.${craft.specialLabel ? ` Otomatis membuka senjata khusus ${craft.specialLabel}.` : ''}</p>
      <div class="hangar-lock-note">SELESAI MISI ${(craft.unlock?.mission ?? 0) + 1} · ${craft.role}</div>`;
    this.hangarDetail.dataset.locked = unlocked ? '0' : '1';
  }

  resize() {
    this.viewport.w = window.innerWidth;
    this.viewport.h = window.innerHeight;
    const nextOrient = this.getHudOrientation();
    if (this._hudOrientation && this._hudOrientation !== nextOrient) {
      this._hudOrientation = nextOrient;
      this.applyHudPositions();
    } else {
      this._hudOrientation = nextOrient;
    }
    if (this.hudEditorMode) {
      this.hudEditorMode.textContent = nextOrient === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE';
    }
    this.compassWidth = this.compassWindow.clientWidth || 440;
    this.compassStrip.style.transform = this._compassTransform(0);
    const radarSize = window.innerWidth < 760 ? 300 : 400;
    if (this.radarCanvas.width !== radarSize) {
      this.radarCanvas.width = radarSize;
      this.radarCanvas.height = radarSize;
    }
  }

  _compassTransform(heading) {
    return `translate3d(${this.compassWidth / 2 - (heading + 180) * COMPASS_PX_PER_DEG}px,0,0)`;
  }

  update(dt, state) {
    if (this.phase !== 'flying' && this.phase !== 'crashed') return;
    this.time += dt;
    const telemetry = state.telemetry;
    const physics = state.physics;
    const world = state.world;
    const camera = state.camera;

    const heading = wrap360(telemetry.heading);
    this.compassStrip.style.transform = this._compassTransform(heading);
    this.compassValue.textContent = String(Math.round(heading)).padStart(3, '0');
    this.compassCardinal.textContent = CARDINALS[Math.round(heading / 45) * 45 % 360] ?? '';

    // Artificial horizon / pitch ladder.
    this.ladder.style.transform = `translateY(${telemetry.pitch * LADDER_PX_PER_DEG}px) rotate(${
      telemetry.roll
    }deg)`;

    // Flight path marker.
    this._updateFPM(physics, camera);

    // Radar at ~30 Hz.
    this.radarTime += dt;
    this.radarAcc += dt;
    if (this.radarAcc >= 1 / 30) {
      this.radarAcc = 0;
      const contacts = world.getRadarContacts(physics.position.x, physics.position.z, 7500);
      const bandits = state.contacts || [];
      const merged = contacts.concat(bandits);
      merged.sort((a, b) => a.distance - b.distance);
      this.extraContacts = bandits;
      this._drawRadar(merged, physics, this.radarTime, world);
      this._drawThreatRadar(bandits, physics, this.radarTime);
      if (bandits.length) {
        const nearest = `${bandits[0].name} · ${(bandits[0].distance / 1000).toFixed(1)}KM`;
        this.radarNearest.textContent = nearest;
        if (this.statusExtra) this.statusExtra.textContent = `BANDITS ${bandits.length} · ${nearest}`;
      } else if (contacts.length) {
        const nearest = `${contacts[0].name} · ${(contacts[0].distance / 1000).toFixed(1)}KM`;
        this.radarNearest.textContent = nearest;
        if (this.statusExtra) this.statusExtra.textContent = `NEAREST ${nearest}`;
      } else {
        this.radarNearest.textContent = 'NO CONTACTS';
        if (this.statusExtra) {
          this.statusExtra.textContent = world.land
            ? 'NO CONTACTS · OPEN SKY'
            : 'NO CONTACTS · OPEN WATER';
        }
      }
    }

    // Combat readouts + lock box run every frame so the box tracks smoothly.
    if (state.combat) this.combat = { ...this.combat, ...state.combat };
    this._updateWeaponPanel();
    this._updateTargetBox(state.target, physics, camera, state.lockProgress);
    this._updateThreatArrows(state.contacts, physics);
    this._updateMultiplayerTags(state.mpContacts, physics, camera);

    // Instruments at 16 Hz.
    this.instrumentAcc += dt;
    if (this.instrumentAcc < 1 / 16) return;
    const elapsed = this.instrumentAcc;
    this.instrumentAcc = 0;
    this._elapsed += elapsed;

    const ground = Math.max(0, world.getHeightAt(physics.position.x, physics.position.z));
    const agl = Math.max(0, physics.position.y - ground);
    const speedKts = telemetry.speedKts;
    const altitude = telemetry.altitude;

    this._updateTape(this.speedRows, speedKts, 20, 30);
    this._updateTape(this.altRows, altitude, 50, 30);
    this.speedValue.textContent = Math.round(speedKts);
    this.machValue.textContent = telemetry.speedMach.toFixed(2);
    this.altValue.textContent = Math.round(altitude);
    this.aglValue.textContent = Math.round(agl);
    this.vsValue.textContent = `${telemetry.verticalSpeed >= 0 ? '+' : ''}${telemetry.verticalSpeed.toFixed(1)}`;
    this.vsValue.classList.toggle('negative', telemetry.verticalSpeed < -0.5);

    this.throttleValue.textContent = `${Math.round(telemetry.throttle * 100)}%`;
    this.throttleFill.style.width = `${telemetry.throttle * 100}%`;
    this.boostValue.textContent = `${Math.round(telemetry.boost * 100)}`;
    const lit = Math.ceil(telemetry.boost * 12);
    this.boostSegments.forEach((seg, i) => {
      seg.classList.toggle('on', i < lit);
      seg.classList.toggle('critical', telemetry.boost < 0.22);
    });
    this.gValue.textContent = telemetry.gForce.toFixed(1);
    this.gValue.classList.toggle('hot', telemetry.gForce > 5.5);
    this.abState.textContent = telemetry.boosting ? 'LIT' : 'STBY';
    this.abState.classList.toggle('hot', telemetry.boosting);
    this.brakeState.textContent = telemetry.airbrake ? 'EXT' : 'OFF';
    this.brakeState.classList.toggle('hot', telemetry.airbrake);
    this.engineMode.textContent = telemetry.boosting
      ? 'AFTERBURNER'
      : telemetry.airbrake
        ? 'BRAKE'
        : telemetry.throttle > 0.85
          ? 'MIL PWR'
          : 'CRUISE';

    this._updateWarnings(telemetry, agl, physics, state.boundary);
    this._updateFPS(dt);
    const totalSeconds = Math.floor(this.time);
    this.missionClock.textContent = `${String(Math.floor(totalSeconds / 3600)).padStart(
      2,
      '0'
    )}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')}:${String(
      totalSeconds % 60
    ).padStart(2, '0')}`;
  }

  _updateTape(rows, value, step, fallbackRowHeight) {
    const first = rows[0]?.row;
    const rowHeight = first?.offsetHeight || fallbackRowHeight;
    const trackHeight = first?.parentElement?.clientHeight || fallbackRowHeight * 6;
    const base = Math.round(value / step) * step;
    const offset = ((value - base) / step) * rowHeight;
    const center = trackHeight / 2 - rowHeight / 2;
    for (let i = 0; i < rows.length; i++) {
      const slot = i - Math.floor(rows.length / 2);
      const rowValue = base - slot * step;
      const { row, num } = rows[i];
      num.textContent = rowValue >= 0 ? rowValue : '—';
      row.style.transform = `translate3d(0, ${center + slot * rowHeight + offset}px, 0)`;
      row.classList.toggle('center', slot === 0);
      row.style.opacity = rowValue >= 0 ? 1 - Math.abs(slot) * 0.18 : 0;
    }
  }

  _updateFPM(physics, camera) {
    if (!physics.velocity || physics.velocity.lengthSq() < 1) {
      this.fpm.classList.remove('visible');
      return;
    }
    this._tmpVec
      .copy(physics.position)
      .addScaledVector(physics.velocity, 8);
    camera.updateMatrixWorld();
    this._tmpVec.project(camera);
    if (this._tmpVec.z > 1 || this._tmpVec.z < -1) {
      this.fpm.classList.remove('visible');
      return;
    }
    const s = this.uiScale || 1;
    const vw = this.viewport.w / s;
    const vh = this.viewport.h / s;
    const x = (this._tmpVec.x * 0.5 + 0.5) * vw;
    const y = (-this._tmpVec.y * 0.5 + 0.5) * vh;
    if (x < 40 || x > vw - 40 || y < 40 || y > vh - 40) {
      this.fpm.classList.remove('visible');
      return;
    }
    this.fpm.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    this.fpm.classList.add('visible');
  }

  _updateWarnings(telemetry, agl, physics, boundary = null) {
    const warnings = [];
    // An inbound hostile missile outranks every terrain callout.
    if (Number.isFinite(this.combat.incoming)) {
      warnings.push({ text: 'MISSILE INBOUND // TEKAN [V] FLARE!', level: 'critical' });
    }
    if (boundary?.outOfBounds) {
      warnings.push({ text: 'BATAS PETA TERCAPAI // KEMBALI KE ZONA TEMPUR', level: 'critical' });
    } else if (boundary?.warning) {
      const rem = Math.max(0, Math.round(boundary.maxRadius - boundary.dist));
      warnings.push({ text: `MENDEKATI BATAS PETA (${rem} M) // PUTAR BALIK`, level: 'warn' });
    }
    const timeToImpact =
      telemetry.verticalSpeed < -1 ? agl / Math.abs(telemetry.verticalSpeed) : Infinity;
    if (agl < 120 || (timeToImpact < 5.5 && agl < 420)) {
      warnings.push({ text: 'PULL UP', level: 'critical' });
    }
    if (telemetry.stalling) warnings.push({ text: 'STALL // NOSE DOWN', level: 'critical' });
    if (agl < 350 && telemetry.verticalSpeed < -18) {
      warnings.push({ text: 'TERRAIN PROXIMITY', level: 'warn' });
    }
    if (telemetry.speedKts > 675) warnings.push({ text: 'OVERSPEED', level: 'warn' });
    if (!telemetry.boostReady && telemetry.boost < 0.99) {
      warnings.push({ text: 'AB RECHARGING', level: 'info' });
    }
    if (telemetry.airbrake) warnings.push({ text: 'SPEEDBRAKE EXTENDED', level: 'info' });

    const top = warnings.slice(0, 2);
    const key = top.map((w) => w.text + w.level).join('|');
    if (key !== this.lastWarnings) {
      this.lastWarnings = key;
      this.warningBox.innerHTML = top
        .map((w) => `<div class="warning ${w.level}">${w.text}</div>`)
        .join('');
    }

    let status = this.autopilot ? 'AI AUTOPILOT AKTIF · KETIK /stop' : 'FLIGHT COMPUTER NOMINAL';
    let statusClass = '';
    if (warnings.some((w) => w.level === 'critical')) {
      status = warnings[0].text;
      statusClass = 'critical';
    } else if (telemetry.boosting) {
      status = 'AFTERBURNER ENGAGED';
      statusClass = 'boost';
    } else if (telemetry.airbrake) {
      status = 'SPEEDBRAKES EXTENDED';
      statusClass = 'warn';
    } else if (telemetry.stalling) {
      status = 'STALL MARGIN LOW';
      statusClass = 'critical';
    }
    if (this.flightStatus.textContent !== status) this.flightStatus.textContent = status;
    this.root.dataset.flightStatus = statusClass;
  }

  _updateFPS(dt) {
    this.frameCount++;
    this.fpsAcc += dt;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsAcc);
      this.fpsValue.textContent = String(this.fps);
      this.frameCount = 0;
      this.fpsAcc = 0;
    }
  }

  _drawRadar(contacts, physics, time, world = null) {
    const ctx = this.radarCtx;
    const size = this.radarCanvas.width;
    const c = size / 2;
    const radius = size * 0.465;
    const range = 7500;
    const scale = radius / range;
    const heading = physics.heading;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.clip();

    const bg = ctx.createRadialGradient(c, c, 0, c, c, radius);
    bg.addColorStop(0, 'rgba(4, 42, 42, 0.5)');
    bg.addColorStop(0.7, 'rgba(2, 31, 32, 0.7)');
    bg.addColorStop(1, 'rgba(1, 18, 20, 0.82)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // Draw playable map combat boundary ring relative to aircraft position & heading.
    const bounds = world?.getMapBounds?.();
    if (bounds?.maxRadius) {
      const dx = -physics.position.x;
      const dz = -physics.position.z;
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const cx = c + rx * scale;
      const cy = c + rz * scale;
      const br = bounds.maxRadius * scale;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 102, 74, 0.62)';
      ctx.lineWidth = 2;
      if (ctx.setLineDash) ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, br, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Range rings.
    ctx.strokeStyle = 'rgba(107, 255, 219, 0.16)';
    ctx.lineWidth = size * 0.0035;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(c, c, (radius * i) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(107, 255, 219, 0.1)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(a) * radius, c + Math.sin(a) * radius);
      ctx.stroke();
    }

    // Sweep wedge.
    const sweep = time * 1.25;
    const wedge = ctx.createConicGradient
      ? ctx.createConicGradient(sweep, c, c)
      : null;
    if (wedge) {
      wedge.addColorStop(0, 'rgba(118, 255, 222, 0.22)');
      wedge.addColorStop(0.055, 'rgba(118, 255, 222, 0.02)');
      wedge.addColorStop(0.12, 'rgba(118, 255, 222, 0)');
      wedge.addColorStop(1, 'rgba(118, 255, 222, 0)');
      ctx.fillStyle = wedge;
      ctx.fillRect(0, 0, size, size);
    } else {
      ctx.fillStyle = 'rgba(118, 255, 222, 0.08)';
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, radius, sweep, sweep + 0.5);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(142, 255, 227, 0.55)';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(sweep) * radius, c + Math.sin(sweep) * radius);
    ctx.stroke();

    // Island & aircraft contacts.
    for (const contact of contacts) {
      const dx = contact.x - physics.position.x;
      const dz = contact.z - physics.position.z;
      const sx = dx * cos + dz * sin;
      const sy = -dx * sin + dz * cos;
      const px = c + sx * scale;
      const py = c + sy * scale;
      const dist = Math.hypot(px - c, py - c);
      if (dist > radius) continue;
      if (contact.ally) {
        // Co-Op Wingman blip (cyan diamond).
        ctx.fillStyle = '#47f3ff';
        ctx.beginPath();
        ctx.arc(px, py, 4.2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (contact.enemy) {
        // Hostile Bandit or Versus Rival blip.
        ctx.fillStyle = contact.isPlayer ? '#ff3864' : '#ff8a4c';
        ctx.beginPath();
        ctx.arc(px, py, contact.isPlayer ? 4.4 : 3.4, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const blobRadius = clamp(contact.radius * scale * 1.8, 2.5, 22);
      ctx.beginPath();
      ctx.arc(px, py, blobRadius, 0, Math.PI * 2);
      ctx.fillStyle = contact.major ? 'rgba(83, 216, 178, 0.22)' : 'rgba(83, 216, 178, 0.12)';
      ctx.fill();
      ctx.strokeStyle = contact.major ? 'rgba(117, 255, 212, 0.55)' : 'rgba(117, 255, 212, 0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (contact.major) {
        ctx.fillStyle = 'rgba(189, 255, 235, 0.9)';
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player marker (screen is heading-up).
    ctx.translate(c, c);
    ctx.fillStyle = '#bffdec';
    ctx.strokeStyle = 'rgba(3, 20, 20, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 11);
    ctx.lineTo(0, 6);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Outer ring + range labels.
    ctx.strokeStyle = 'rgba(125, 255, 224, 0.4)';
    ctx.lineWidth = size * 0.006;
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150, 255, 231, 0.55)';
    ctx.font = `${Math.round(size * 0.032)}px "Share Tech Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('2.5', c + radius * 0.67, c - 6);
    ctx.fillText('5.0', c + radius * 0.9, c - 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(150, 255, 231, 0.7)';
    ctx.fillText('HDG UP', size - 8, size - 10);
  }

  /**
   * Compact enemy-only scope parked on the left of the HUD. It shares the
   * heading-up frame of the big radar but only ever plots bandits, so the
   * threat picture stays readable at a glance (and survives the touch layout
   * where the tactical radar is hidden under the virtual stick).
   */
  _drawThreatRadar(contacts, physics, time) {
    const canvas = this.threatRadarCanvas;
    if (!canvas) return;
    const ctx = this.threatRadarCtx;
    const size = canvas.width;
    const c = size / 2;
    const radius = size * 0.44;
    const range = 7500;
    const scale = radius / range;
    const cos = Math.cos(physics.heading);
    const sin = Math.sin(physics.heading);
    const list = contacts || [];
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.clip();

    const bg = ctx.createRadialGradient(c, c, 0, c, c, radius);
    bg.addColorStop(0, 'rgba(46, 11, 6, 0.55)');
    bg.addColorStop(1, 'rgba(14, 3, 3, 0.86)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // Range rings + cardinal cross.
    ctx.strokeStyle = 'rgba(255, 138, 76, 0.16)';
    ctx.lineWidth = Math.max(1, size * 0.006);
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(c, c, (radius * i) / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, c - radius);
    ctx.lineTo(c, c + radius);
    ctx.moveTo(c - radius, c);
    ctx.lineTo(c + radius, c);
    ctx.stroke();

    // Sweep needle on the same tempo as the tactical radar.
    const sweep = time * 1.25;
    ctx.strokeStyle = 'rgba(255, 158, 100, 0.5)';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(sweep) * radius, c + Math.sin(sweep) * radius);
    ctx.stroke();

    let nearest = null;
    for (const contact of list) {
      if (!nearest || (contact.distance ?? Infinity) < (nearest.distance ?? Infinity)) {
        nearest = contact;
      }
    }

    // Bandits, clamped to the rim when they sit beyond the scope range.
    for (const contact of list) {
      const dx = contact.x - physics.position.x;
      const dz = contact.z - physics.position.z;
      const sx = dx * cos + dz * sin;
      const sy = -dx * sin + dz * cos;
      let px = c + sx * scale;
      let py = c + sy * scale;
      const dist = Math.hypot(px - c, py - c);
      const beyond = dist > radius;
      if (beyond) {
        const k = radius / dist;
        px = c + (px - c) * k;
        py = c + (py - c) * k;
      }
      const highlight = contact === nearest;
      const dot = size * (highlight ? 0.034 : 0.026);
      ctx.beginPath();
      ctx.arc(px, py, dot, 0, Math.PI * 2);
      ctx.fillStyle = beyond
        ? 'rgba(255, 120, 70, 0.4)'
        : highlight
          ? 'rgba(255, 156, 96, 0.95)'
          : 'rgba(255, 120, 70, 0.72)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(18, 4, 2, 0.85)';
      ctx.lineWidth = Math.max(1, size * 0.008);
      ctx.stroke();
    }

    // Own ship at the centre of the heading-up display.
    ctx.fillStyle = '#ffd9c0';
    ctx.beginPath();
    ctx.moveTo(c, c - size * 0.05);
    ctx.lineTo(c + size * 0.032, c + size * 0.04);
    ctx.lineTo(c, c + size * 0.018);
    ctx.lineTo(c - size * 0.032, c + size * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Rim + north tick.
    ctx.strokeStyle = 'rgba(255, 138, 76, 0.55)';
    ctx.lineWidth = Math.max(1, size * 0.01);
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 196, 158, 0.72)';
    ctx.font = `${Math.round(size * 0.045)}px "Share Tech Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('N', c, c - radius + size * 0.05);

    if (this.threatRadarCount) this.threatRadarCount.textContent = String(list.length);
    if (this.threatRadarNearest) {
      this.threatRadarNearest.textContent = nearest
        ? `${((nearest.distance ?? 0) / 1000).toFixed(1)} KM`
        : 'CLEAR';
    }
  }

  /**
   * One heading-up arrow per bandit riding a ring around the reticle: 0° is
   * dead ahead, +90° starboard, and each range label counter-rotates so it
   * always reads upright. The nearest contact gets the `nearest` highlight.
   */
  _updateThreatArrows(contacts, physics) {
    const host = this.threatArrowHost;
    if (!host) return;
    const list = (contacts || []).slice();
    list.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    if (!list.length) {
      for (const arrow of this.threatArrowPool) arrow.classList.remove('visible', 'nearest');
      return;
    }

    const radius = clamp(Math.min(this.viewport.w, this.viewport.h) * 0.38, 120, 330);
    list.forEach((contact, index) => {
      const arrow = this._threatArrowAt(index);
      const dx = contact.x - physics.position.x;
      const dz = contact.z - physics.position.z;
      const cos = Math.cos(physics.heading);
      const sin = Math.sin(physics.heading);
      const sx = dx * cos + dz * sin;
      const sy = -dx * sin + dz * cos;
      const deg = (Math.atan2(sx, -sy) * 180) / Math.PI;

      arrow.classList.add('visible');
      arrow.classList.toggle('nearest', index === 0);
      const transform = `rotate(${deg.toFixed(1)}deg) translateY(${(-radius).toFixed(1)}px)`;
      if (arrow.style.transform !== transform) arrow.style.transform = transform;

      const label = arrow.lastElementChild;
      if (label) {
        const metres = contact.distance ?? 0;
        const text =
          metres >= 1000 ? `${(metres / 1000).toFixed(1)}KM` : `${Math.round(metres)}M`;
        if (label.textContent !== text) label.textContent = text;
        const flip = `translateX(-50%) rotate(${(-deg).toFixed(1)}deg)`;
        if (label.style.transform !== flip) label.style.transform = flip;
      }
    });

    for (let i = list.length; i < this.threatArrowPool.length; i++) {
      this.threatArrowPool[i].classList.remove('visible', 'nearest');
    }
  }

  /** Lazily grows the arrow pool — one element per tracked bandit. */
  _threatArrowAt(index) {
    while (this.threatArrowPool.length <= index) {
      const arrow = document.createElement('div');
      arrow.className = 'threat-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.appendChild(document.createElement('i'));
      arrow.appendChild(document.createElement('span'));
      this.threatArrowHost.appendChild(arrow);
      this.threatArrowPool.push(arrow);
    }
    return this.threatArrowPool[index];
  }

  setCameraMode(index) {
    const names = ['CHASE', 'COCKPIT'];
    const safe = ((index % 2) + 2) % 2;
    const name = names[safe] ?? 'CHASE';
    const label = `0${safe + 1} · ${name}`;
    const button = document.getElementById('btn-camera-cycle');
    if (button) button.textContent = label;
    if (this.btnView) this.btnView.textContent = `0${safe + 1}`;
    if (this.viewIndex) this.viewIndex.textContent = `0${safe + 1}`;
    if (this.viewName) this.viewName.textContent = name;
  }

  /** Weapon / hull / score panel (16 Hz throttle keeps the DOM quiet). */
  setCombat(combat = {}) {
    Object.assign(this.combat, combat);
    this._renderCombat = true;
  }

  /**
   * Mission objective badge in the header: name + live kill counter.
   * @param {{name:string,kills:number}|null} mission active mission (null = free flight)
   * @param {number} kills kills scored so far this sortie
   */
  setMission(mission, kills = 0, elapsed = 0) {
    if (!this.missionTagName) return;
    if (!mission) {
      this.missionTagName.textContent = 'FREE FLIGHT';
      if (this.missionTagProgress) this.missionTagProgress.textContent = '';
      return;
    }
    this.missionTagName.textContent = mission.name;
    if (this.missionTagProgress) {
      const killText = `${Math.min(kills, mission.kills)} / ${mission.kills} KILL`;
      const survive = mission.survive > 0;
      this.missionTagProgress.textContent = survive
        ? `${killText} · ${formatMissionClock(elapsed)} / ${formatMissionClock(mission.survive)}`
        : killText;
      this.missionTagProgress.classList.toggle(
        'done',
        kills >= mission.kills && (!survive || elapsed >= mission.survive)
      );
    }
  }

  setCockpitView(active) {
    this.cockpitView = !!active;
    this.root.classList.toggle('cockpit-active', this.cockpitView);
    if (this.cockpitOverlay) {
      this.cockpitOverlay.classList.toggle('visible', this.cockpitView);
      this.cockpitOverlay.setAttribute('aria-hidden', String(!this.cockpitView));
    }
  }

  /** Moves the combat / instrument column to the left or right edge. */
  setHudSide(side) {
    this.hudSide = side === 'right' ? 'right' : 'left';
    this.root.classList.toggle('hud-right', this.hudSide === 'right');
    document.querySelectorAll('[data-hudside]').forEach((button) => {
      button.classList.toggle('active', button.dataset.hudside === this.hudSide);
    });
  }

  /** Touch button cluster placement: left / center / right. */
  setButtonLayout(layout) {
    this.buttonLayout = ['left', 'center', 'right'].includes(layout) ? layout : 'center';
    document.querySelectorAll('[data-btnlayout]').forEach((button) => {
      button.classList.toggle('active', button.dataset.btnlayout === this.buttonLayout);
    });
    // Buttons the user has NOT repositioned follow the layout presets again;
    // customised ones keep the spot the user chose.
    for (const target of this.hudDragTargets ?? []) {
      if (!target.fixed) continue;
      if (this._hudStyleFor(target.id).custom) continue;
      target.el.style.position = '';
      target.el.style.left = '';
      target.el.style.top = '';
      target.el.style.right = '';
      target.el.style.bottom = '';
    }
  }

  /** Gyro (tilt) steering state on the settings row. */
  setGyro(state) {
    this.gyroOn = state === 'on';
    document.querySelectorAll('[data-gyro]').forEach((button) => {
      button.classList.toggle('active', button.dataset.gyro === (this.gyroOn ? 'on' : 'off'));
    });
  }

  /** Global interface zoom (80–160%), persisted by the game. */
  setUiScale(value) {
    const scale = clamp(Number(value) || 1, 0.8, 1.6);
    this.uiScale = Math.round(scale * 100) / 100;
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--ui-scale', String(this.uiScale));
    }
    const label = `${Math.round(this.uiScale * 100)}%`;
    document.querySelectorAll('.ui-scale-range').forEach((input) => {
      if (Number(input.value) !== this.uiScale) input.value = String(this.uiScale);
    });
    document.querySelectorAll('.ui-scale-value').forEach((node) => {
      node.textContent = label;
    });
    return this.uiScale;
  }

  /** Auto-lock toggle state on the HUD button and both settings screens. */
  setAutoLock(on) {
    this.autoLock = !!on;
    document.querySelectorAll('[data-autolock]').forEach((button) => {
      button.classList.toggle(
        'active',
        button.dataset.autolock === (this.autoLock ? 'on' : 'off')
      );
    });
    if (this.btnAutoLock) {
      this.btnAutoLock.classList.toggle('active', this.autoLock);
      this.btnAutoLock.setAttribute('aria-pressed', String(this.autoLock));
    }
  }

  /** Auto pilot (AI) state — controlled via in-flight chat commands (`/hvskbnd` & `/stop`). */
  setAutopilot(on) {
    this.autopilot = !!on;
    this.root?.classList.toggle('ai-active', this.autopilot);
  }

  /** Opens the in-flight tactical chat/command bar (`Enter`). */
  openChat() {
    if (!this.flightChat || !this.flightChatInput) return;
    this.chatOpen = true;
    this.flightChat.classList.add('open', 'has-activity');
    clearTimeout(this._chatFadeTimer);
    this.flightChatInput.focus?.();
  }

  /** Closes the in-flight chat input bar (keeps recent messages visible briefly). */
  closeChat() {
    if (!this.flightChat) return;
    this.chatOpen = false;
    this.flightChat.classList.remove('open');
    this.flightChatInput?.blur?.();
    clearTimeout(this._chatFadeTimer);
    this._chatFadeTimer = setTimeout(() => {
      if (!this.chatOpen) this.flightChat?.classList.remove('has-activity');
    }, 6500);
  }

  isChatOpen() {
    return !!this.chatOpen;
  }

  /** Appends a message or system status line to the in-flight chat feed. */
  addChatMessage(sender, text, kind = 'msg') {
    if (!this.flightChatLog || !text) return;
    const row = document.createElement('div');
    row.className = `flight-chat-line ${kind}`;
    const safeSender = sender ? `${sender}: ` : '';
    row.textContent = `${safeSender}${text}`;
    this.flightChatLog.appendChild(row);
    while (this.flightChatLog.children.length > 6) {
      this.flightChatLog.removeChild(this.flightChatLog.firstChild);
    }
    this.flightChat?.classList.add('has-activity');
    clearTimeout(this._chatFadeTimer);
    if (!this.chatOpen) {
      this._chatFadeTimer = setTimeout(() => {
        if (!this.chatOpen) this.flightChat?.classList.remove('has-activity');
      }, 6500);
    }
  }

  /** Active world map (coral / city / desert / mountain) on both screens. */
  setMap(id) {
    this.mapId = ['coral', 'city', 'desert', 'mountain'].includes(id) ? id : 'coral';
    document.querySelectorAll('[data-map]').forEach((button) => {
      button.classList.toggle('active', button.dataset.map === this.mapId);
    });
    document.querySelectorAll('#mp-map-select [data-mpmap]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mpmap === this.mapId);
    });
    if (this.startLead) this.startLead.textContent = MAP_LEADS[this.mapId];
  }

  /** Highlights the active airframe in the Multiplayer lobby selector. */
  setMultiplayerAircraft(id) {
    const clean = AIRCRAFT.some((c) => c.id === id) ? id : AIRCRAFT[0].id;
    document.querySelectorAll('#mp-aircraft-select [data-mpaircraft]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mpaircraft === clean);
    });
  }

  /**
   * Disables map switching while in battle (flying / paused / crashed),
   * disables Restart Sortie while in Multiplayer, and locks room configuration
   * controls for non-host guests in an active room.
   */
  _syncMapSwitchLock() {
    const inBattle =
      this.phase === 'flying' || this.phase === 'paused' || this.phase === 'crashed';
    const mpActive = !!this._mpSummary?.active;
    const isGuestInRoom = !!(mpActive && !this._mpSummary?.isHost);
    const mapLocked = inBattle || isGuestInRoom;
    const reason = inBattle
      ? 'Ganti peta dinonaktifkan saat dalam pertarungan'
      : isGuestInRoom
        ? 'Hanya Host yang dapat mengganti peta room'
        : '';

    const settingsMap = document.getElementById('settings-map-select');
    if (settingsMap) {
      settingsMap.classList.toggle('is-locked', mapLocked);
      settingsMap.title = reason;
      settingsMap.querySelectorAll('[data-map]').forEach((btn) => {
        btn.disabled = mapLocked;
      });
    }

    const mpMap = document.getElementById('mp-map-select');
    if (mpMap) {
      mpMap.classList.toggle('is-locked', mapLocked);
      mpMap.title = reason;
      mpMap.querySelectorAll('[data-mpmap]').forEach((btn) => {
        btn.disabled = mapLocked;
      });
    }

    const mpAircraft = document.getElementById('mp-aircraft-select');
    if (mpAircraft) {
      mpAircraft.classList.toggle('is-locked', inBattle);
      mpAircraft.title = inBattle ? 'Ganti pesawat dinonaktifkan saat dalam pertarungan' : '';
      mpAircraft.querySelectorAll('[data-mpaircraft]').forEach((btn) => {
        btn.disabled = inBattle;
      });
    }

    const mpMode = document.getElementById('mp-mode-select');
    if (mpMode) {
      mpMode.classList.toggle('is-locked', isGuestInRoom);
      mpMode.title = isGuestInRoom ? 'Hanya Host yang dapat mengubah mode room' : '';
      mpMode.querySelectorAll('[data-mpmode]').forEach((btn) => {
        btn.disabled = isGuestInRoom;
      });
    }

    const mpBandits = document.getElementById('mp-bandits-select');
    if (mpBandits) {
      mpBandits.classList.toggle('is-locked', isGuestInRoom);
      mpBandits.title = isGuestInRoom ? 'Hanya Host yang dapat mengubah pengaturan bandit' : '';
      mpBandits.querySelectorAll('[data-mpbandits]').forEach((btn) => {
        btn.disabled = isGuestInRoom;
      });
    }

    const restartBtn = document.getElementById('btn-restart');
    if (restartBtn) {
      restartBtn.disabled = mpActive;
      restartBtn.classList.toggle('is-locked', mpActive);
      restartBtn.title = mpActive ? 'Restart Sortie dinonaktifkan di mode Multiplayer' : '';
    }

    const pauseDesc = document.getElementById('pause-desc');
    if (pauseDesc) {
      pauseDesc.textContent = mpActive
        ? 'Mode Online aktif — pesawatmu tetap online dan terbang otomatis selama pause. Kembali ke menu akan keluar dari room.'
        : 'Your aircraft is holding. Adjust systems, then return to the sky.';
    }
  }

  /** Start-screen world counters; land maps count one mainland, not islands. */
  setWorldFacts(stats = {}) {
    const islands = document.getElementById('fact-islands');
    if (islands) islands.textContent = stats.islands ?? '—';
    const trees = document.getElementById('fact-trees');
    if (trees) {
      trees.textContent = stats.trees ? stats.trees.toLocaleString('en-US') : '—';
    }
    const area = document.getElementById('fact-area');
    if (area) area.textContent = stats.area ?? '480';
    const clouds = document.getElementById('fact-clouds');
    if (clouds) clouds.textContent = stats.cloudPuffs ?? '—';
    if (this.factLandLabel) this.factLandLabel.textContent = stats.land ? 'DARATAN' : 'ISLANDS';
  }

  /**
   * HUD edit mode. Tap a panel once to select it and open the per-panel
   * editor (size / transparency); hold and drag to move it. Every change is
   * written to `localStorage` immediately.
   */
  setHudEdit(on) {
    this.hudEdit = !!on;
    document.body.classList.toggle('hud-edit', this.hudEdit);
    document.querySelectorAll('#hud-edit-select [data-hudedit]').forEach((button) => {
      button.classList.toggle('active', button.dataset.hudedit === (this.hudEdit ? 'on' : 'off'));
    });
    const bar = document.getElementById('hud-edit-bar');
    if (bar) {
      bar.hidden = !this.hudEdit;
      bar.setAttribute('aria-hidden', String(!this.hudEdit));
    }
    this._endHudDrag();
    if (this.hudEdit) this._promoteHudButtons();
    else this._closeHudEditor();
  }

  /**
   * Touch buttons share a flex row. The first time edit mode opens each one
   * is lifted out of that flow onto `position: fixed` at its measured spot,
   * so every button becomes its own independent drag/resize target without
   * any visual jump. Buttons the user already repositioned stay as they are.
   */
  _promoteHudButtons() {
    const pending = [];
    for (const target of this.hudDragTargets) {
      if (!target.fixed) continue;
      if (this._hudStyleFor(target.id).custom) continue;
      pending.push({ target, rect: target.el.getBoundingClientRect() });
    }
    // Measure every button before fixing any of them: otherwise the first
    // promotion collapses the flex row and the next measurement drifts.
    for (const { target, rect } of pending) {
      this._freezeHudPosition(target.el, true, rect);
    }
  }

  /** Active orientation key for HUD layout storage ('landscape' | 'portrait'). */
  getHudOrientation() {
    const w = this.viewport?.w || window.innerWidth || 1280;
    const h = this.viewport?.h || window.innerHeight || 720;
    return h > w ? 'portrait' : 'landscape';
  }

  _hudStorageKey(mode = this.getHudOrientation()) {
    return `skybound.hudPos.${mode}`;
  }

  /** Restores saved position / size / transparency for every panel in the active orientation. */
  applyHudPositions() {
    const mode = this.getHudOrientation();
    const saved = this._readHudLayout(mode);
    for (const { id, el, fixed } of this.hudDragTargets) {
      if (!el) continue;
      const pos = saved[id];
      const st = this._hudStyleFor(id, mode);
      if (!pos) {
        el.style.position = '';
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.transform = '';
        el.style.transformOrigin = '';
        el.style.opacity = '';
        st.scale = 1;
        st.opacity = 1;
        st.custom = false;
        continue;
      }
      this._freezeHudPosition(el, fixed);
      if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        const s = this.uiScale || 1;
        const w = (Number.isFinite(pos.w) ? pos.w : 0) * (Number.isFinite(pos.scale) ? pos.scale : 1);
        const h = (Number.isFinite(pos.h) ? pos.h : 0) * (Number.isFinite(pos.scale) ? pos.scale : 1);
        this._placeHudElement(
          el,
          clamp(pos.left, 0, Math.max(0, this.viewport.w / s - w)),
          clamp(pos.top, 0, Math.max(0, this.viewport.h / s - h))
        );
      }
      if (Number.isFinite(pos.scale)) st.scale = clamp(pos.scale, 0.5, 2);
      if (Number.isFinite(pos.opacity)) st.opacity = clamp(pos.opacity, 0.2, 1);
      st.custom = true;
      this._applyHudStyle(el, st);
    }
    if (this.hudEdit) this._promoteHudButtons();
    if (this.hudEditorMode) {
      this.hudEditorMode.textContent = mode === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE';
    }
  }

  /** Drops saved tweaks for the active orientation and returns panels to their CSS layout. */
  resetHudPositions() {
    const mode = this.getHudOrientation();
    try {
      window.localStorage.removeItem(this._hudStorageKey(mode));
      window.localStorage.removeItem('skybound.hudPos');
    } catch {
      /* ignore */
    }
    for (const { id, el } of this.hudDragTargets) {
      if (!el) continue;
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.style.opacity = '';
      const st = this._hudStyleFor(id, mode);
      st.scale = 1;
      st.opacity = 1;
      st.custom = false;
    }
    this._closeHudEditor();
  }

  _initHudDrag() {
    const selectors = [
      { id: 'weapon', sel: '.weapon-panel', label: 'SENJATA' },
      { id: 'radar', sel: '.radar-panel', label: 'RADAR' },
      { id: 'threat', sel: '.threat-radar', label: 'RADAR ANCAMAN' },
      { id: 'engine', sel: '.engine-panel', label: 'MESIN' },
      { id: 'status', sel: '.flight-status', label: 'STATUS' },
      { id: 'speed', sel: '.tape-left', label: 'TAPE KECEPATAN' },
      { id: 'altitude', sel: '.tape-right', label: 'TAPE KETINGGIAN' },
      { id: 'missilecam', sel: '#missile-cam-frame', label: 'HUD MISSILE CAM' },
      { id: 'viewtag', sel: '.view-tag', label: 'MODE KAMERA' },
      { id: 'hints', sel: '.key-hints', label: 'PETUNJUK TOMBOL' },
      // Top-row widgets and action buttons are lifted out of the flex row
      // during edit so each one can be resized, faded and moved on its own.
      { id: 'brand', sel: '.brand-block', label: 'BRAND / MISI', fixed: true },
      { id: 'compass', sel: '.compass-block', label: 'KOMPAS', fixed: true },
      { id: 'topmeta', sel: '.meta-line', label: 'INFO ATAS', fixed: true },
      { id: 'viewbtn', sel: '#btn-view', label: 'TOMBOL CAM / VIEW', fixed: true },
      { id: 'lockbtn', sel: '#btn-autolock', label: 'TOMBOL AUTO LOCK', fixed: true },
      { id: 'fsbtn', sel: '#btn-fullscreen', label: 'TOMBOL FULLSCREEN', fixed: true },
      { id: 'helpbtn', sel: '#btn-help', label: 'TOMBOL BANTUAN', fixed: true },
      { id: 'soundbtn', sel: '#btn-mute', label: 'TOMBOL SUARA', fixed: true },
      { id: 'pausebtn', sel: '#btn-pause', label: 'TOMBOL PAUSE', fixed: true },
      // Touch buttons & virtual joysticks live in a flex/absolute layout; on first
      // edit they are promoted to fixed positioning so each one can be moved on its own.
      { id: 'stickleft', sel: '.stick-left', label: 'JOYSTICK KIRI', fixed: true },
      { id: 'stickright', sel: '.stick-right', label: 'JOYSTICK KANAN', fixed: true },
      { id: 'fire', sel: '.touch-fire', label: 'GUN', fixed: true },
      { id: 'missile', sel: '.touch-missile', label: 'MISSILE', fixed: true },
      { id: 'flare', sel: '.touch-flare', label: 'FLARE', fixed: true },
      { id: 'boost', sel: '.touch-boost', label: 'AFTERBURNER', fixed: true },
      { id: 'brake', sel: '.touch-brake', label: 'BRAKE', fixed: true },
      { id: 'touchcam', sel: '.touch-cam', label: 'TOMBOL CAM (MOBILE)', fixed: true },
    ];
    this._hudDragBound ??= new Set();
    this.hudDragTargets = [];
    this._hudDrag ??= null;
    this.hudStyle ??= {};

    for (const spec of selectors) {
      const { id, sel } = spec;
      const el = document.querySelector(sel);
      if (!el) continue;
      const target = { id, el, fixed: !!spec.fixed, label: spec.label ?? id };
      this.hudDragTargets.push(target);
      if (this._hudDragBound.has(el)) continue;
      this._hudDragBound.add(el);

      el.addEventListener('pointerdown', (event) => {
        if (!this.hudEdit || this._hudDrag) return;
        event.preventDefault();
        event.stopPropagation();
        this._freezeHudPosition(el, target.fixed);
        const rect = el.getBoundingClientRect();
        const s = this.uiScale || 1;
        this._hudDrag = {
          id,
          el,
          pointerId: event.pointerId,
          x0: event.clientX,
          y0: event.clientY,
          moved: false,
          dx: event.clientX / s - rect.left / s,
          dy: event.clientY / s - rect.top / s,
          w: rect.width / s,
          h: rect.height / s,
        };
        el.classList.add('dragging');
        el.setPointerCapture?.(event.pointerId);
      });
      el.addEventListener('pointermove', (event) => {
        const drag = this._hudDrag;
        if (!drag || drag.el !== el || event.pointerId !== drag.pointerId) return;
        if (!drag.moved) {
          // A tap (under 6 px) selects instead of moving the panel.
          if (Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < 6) return;
          drag.moved = true;
        }
        const left = clamp(
          event.clientX / (this.uiScale || 1) - drag.dx,
          0,
          Math.max(0, (this.viewport.w / (this.uiScale || 1)) - drag.w)
        );
        const top = clamp(
          event.clientY / (this.uiScale || 1) - drag.dy,
          0,
          Math.max(0, (this.viewport.h / (this.uiScale || 1)) - drag.h)
        );
        this._placeHudElement(el, left, top);
      });
      const drop = (event) => {
        const drag = this._hudDrag;
        if (!drag || drag.el !== el || event.pointerId !== drag.pointerId) return;
        const moved = drag.moved;
        this._endHudDrag();
        if (moved) {
          this._hudStyleFor(id).custom = true;
          this._saveHudPositions();
        } else {
          this._selectHudPanel(id);
        }
      };
      el.addEventListener('pointerup', drop);
      el.addEventListener('pointercancel', drop);
    }
  }

  /** Converts a CSS-positioned panel into an absolute one without jumping. */
  _freezeHudPosition(el, fixed = false, measuredRect = null) {
    if (fixed && el.style.position !== 'fixed') el.style.position = 'fixed';
    if (el.style.left) return;
    const rect = measuredRect ?? el.getBoundingClientRect();
    const s = this.uiScale || 1;
    let tx = 0;
    try {
      const cs = window.getComputedStyle(el).transform;
      if (cs && cs.startsWith('matrix(')) tx = parseFloat(cs.split(',')[4]) || 0;
    } catch {
      /* ignore */
    }
    el.style.left = `${Math.round(rect.left / s - tx)}px`;
    el.style.top = `${Math.round(rect.top / s)}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transformOrigin = 'top left';
    el.style.transform = 'none';
  }

  _placeHudElement(el, left, top) {
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  _hudStyleFor(id, mode = this.getHudOrientation()) {
    this.hudStyleByMode ??= { landscape: {}, portrait: {} };
    const bucket = (this.hudStyleByMode[mode] ??= {});
    return (bucket[id] ??= { scale: 1, opacity: 1 });
  }

  _applyHudStyle(el, st) {
    el.style.transformOrigin = 'top left';
    el.style.transform = st.scale === 1 ? 'none' : `scale(${st.scale})`;
    el.style.opacity = st.opacity >= 1 ? '' : String(Number(st.opacity.toFixed(2)));
  }

  /* --- Per-panel editor -------------------------------------------------- */

  _selectHudPanel(id) {
    const target = this.hudDragTargets.find((t) => t.id === id);
    if (!target) return;
    this._selectedHud = id;
    for (const t of this.hudDragTargets) t.el.classList.toggle('selected', t.id === id);
    if (this.hudEditorTitle) this.hudEditorTitle.textContent = target.label ?? 'PANEL';
    if (this.hudEditor) {
      this.hudEditor.hidden = false;
      this.hudEditor.setAttribute('aria-hidden', 'false');
      this._syncHudEditor();
      this._placeHudEditor(target.el);
    }
  }

  _closeHudEditor() {
    this._selectedHud = null;
    for (const t of this.hudDragTargets ?? []) t.el.classList.remove('selected');
    if (this.hudEditor) {
      this.hudEditor.hidden = true;
      this.hudEditor.setAttribute('aria-hidden', 'true');
    }
  }

  _syncHudEditor() {
    if (!this._selectedHud) return;
    const st = this._hudStyleFor(this._selectedHud);
    if (this.hudScaleValue) this.hudScaleValue.textContent = `${Math.round(st.scale * 100)}%`;
    if (this.hudOpacityValue) this.hudOpacityValue.textContent = `${Math.round(st.opacity * 100)}%`;
  }

  /** Parks the widget next to the selected panel, clamped on screen. */
  _placeHudEditor(el) {
    if (!this.hudEditor) return;
    const rect = el.getBoundingClientRect();
    const s = this.uiScale || 1;
    const w = 220 * s;
    const h = 160 * s;
    const gap = 10 * s;
    const left = clamp(rect.left, 8, Math.max(8, this.viewport.w - w - 8));
    let top = rect.bottom + gap;
    if (top + h > this.viewport.h - 8) top = Math.max(8, rect.top - h - gap);
    this.hudEditor.style.left = `${Math.round(left)}px`;
    this.hudEditor.style.top = `${Math.round(top)}px`;
  }

  _nudgeHudScale(delta) {
    const id = this._selectedHud;
    if (!id) return;
    const target = this.hudDragTargets.find((t) => t.id === id);
    if (!target) return;
    this._freezeHudPosition(target.el, target.fixed);
    const st = this._hudStyleFor(id);
    st.custom = true;
    st.scale = Math.round(clamp(st.scale + delta, 0.5, 2) * 100) / 100;
    this._applyHudStyle(target.el, st);
    this._syncHudEditor();
    this._placeHudEditor(target.el);
    this._saveHudPositions();
  }

  _nudgeHudOpacity(delta) {
    const id = this._selectedHud;
    if (!id) return;
    const target = this.hudDragTargets.find((t) => t.id === id);
    if (!target) return;
    const st = this._hudStyleFor(id);
    st.custom = true;
    st.opacity = Math.round(clamp(st.opacity + delta, 0.2, 1) * 100) / 100;
    this._applyHudStyle(target.el, st);
    this._syncHudEditor();
    this._saveHudPositions();
  }

  /** Restore only the selected panel to its factory look. */
  _resetHudPanel() {
    const id = this._selectedHud;
    if (!id) return;
    const target = this.hudDragTargets.find((t) => t.id === id);
    if (!target) return;
    const el = target.el;
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.opacity = '';
    const st = this._hudStyleFor(id);
    st.scale = 1;
    st.opacity = 1;
    st.custom = false;
    this._saveHudPositions();
    this._syncHudEditor();
    this._placeHudEditor(el);
  }

  _readHudLayout(mode = this.getHudOrientation()) {
    try {
      const scoped = window.localStorage.getItem(this._hudStorageKey(mode));
      if (scoped) return JSON.parse(scoped) || {};
      if (mode === 'landscape') {
        return JSON.parse(window.localStorage.getItem('skybound.hudPos') || '{}') || {};
      }
      return {};
    } catch {
      return {};
    }
  }

  _endHudDrag() {
    if (!this._hudDrag) return;
    this._hudDrag.el.classList.remove('dragging');
    this._hudDrag = null;
  }

  _saveHudPositions() {
    const mode = this.getHudOrientation();
    const out = {};
    for (const { id, el } of this.hudDragTargets) {
      if (!el) continue;
      const st = this._hudStyleFor(id, mode);
      // Only panels the user actually touched are persisted; untouched ones
      // keep following the CSS layout (button row placement, HUD side, ...).
      if (!st.custom) continue;
      const entry = { scale: st.scale, opacity: st.opacity };
      if (el.style.left) {
        entry.left = parseFloat(el.style.left);
        entry.top = parseFloat(el.style.top);
        entry.w = el.offsetWidth;
        entry.h = el.offsetHeight;
      }
      out[id] = entry;
    }
    try {
      const json = JSON.stringify(out);
      window.localStorage.setItem(this._hudStorageKey(mode), json);
      window.localStorage.setItem('skybound.hudPos', json);
    } catch {
      /* ignore */
    }
  }

  _updateWeaponPanel() {
    if (!this._renderCombat && this.instrumentAcc > 0) return;
    this._renderCombat = false;
    const c = this.combat;
    const hullMax = clamp(c.hullMax ?? 100, 40, 400);
    const hull = clamp(c.hull, 0, hullMax);
    const hullPct = (hull / hullMax) * 100;
    if (this.hullFill) {
      this.hullFill.style.width = `${hullPct}%`;
      this.hullFill.classList.toggle('critical', hullPct <= 30);
    }
    if (this.hullValue) {
      this.hullValue.textContent = String(Math.round(hull));
      this.hullValue.classList.toggle('critical', hullPct <= 30);
    }
    if (this.missileCount) {
      const missiles = c.missiles;
      const unlimited = !Number.isFinite(missiles) || c.missilesUnlimited;
      this.missileCount.textContent = unlimited ? '∞' : String(missiles ?? 0);
      this.missileCount.classList.toggle('critical', !unlimited && (missiles ?? 0) === 0);
    }
    if (this.flareCount) {
      this.flareCount.textContent = String(c.flares ?? 0);
      this.flareCount.classList.toggle('critical', (c.flares ?? 0) === 0);
    }
    if (this.inboundValue) {
      const incoming = c.incoming;
      if (Number.isFinite(incoming)) {
        this.inboundValue.textContent =
          incoming >= 1000 ? `${(incoming / 1000).toFixed(1)}K` : `${Math.round(incoming)}M`;
        this.inboundValue.classList.add('critical');
      } else {
        this.inboundValue.textContent = '—';
        this.inboundValue.classList.remove('critical');
      }
    }
    if (this.killCount) this.killCount.textContent = String(c.kills ?? 0);
    if (this.scoreValue) this.scoreValue.textContent = String(c.score ?? 0).padStart(4, '0');
    if (this.weaponMode) {
      const mCode = c.missileCode || 'MSL';
      this.weaponMode.textContent = `GUN · ${mCode}`;
      this.weaponMode.classList.remove('critical');
    }
  }

  /**
   * Projects the bandit into an animated auto-lock crosshair: starts wide &
   * rotated while acquiring (`0 < lockProgress < 1`), then snaps tight into a
   * crimson LOCKED reticle once the seeker finishes locking on (`lockProgress >= 1`).
   */
  _updateTargetBox(target, physics, camera, lockProgress) {
    if (!this.targetBox) return;
    if (!target || !target.alive) {
      this.targetBox.classList.remove('visible', 'acquiring', 'locked', 'close');
      if (this.lockState) {
        this.lockState.textContent = '—';
        this.lockState.classList.remove('critical');
      }
      return;
    }

    const progress =
      typeof lockProgress === 'number' && Number.isFinite(lockProgress)
        ? Math.max(0, Math.min(1, lockProgress))
        : 1;
    const isLocked = progress >= 1;

    camera.updateMatrixWorld();
    this._tmpVec.copy(target.position).project(camera);
    const behind = this._tmpVec.z > 1 || this._tmpVec.z < -1;
    const s = this.uiScale || 1;
    const vw = this.viewport.w / s;
    const vh = this.viewport.h / s;
    const x = (this._tmpVec.x * 0.5 + 0.5) * vw;
    const y = (-this._tmpVec.y * 0.5 + 0.5) * vh;
    const margin = 48;
    const onScreen =
      !behind && x > margin && x < vw - margin && y > margin && y < vh - margin;

    const distance = physics.position.distanceTo(target.position);
    if (this.targetRange) this.targetRange.textContent = `${(distance / 1000).toFixed(1)} KM`;
    if (this.targetLabel) {
      const name = target.isPlayer && target.name ? target.name : 'BANDIT';
      if (isLocked) {
        this.targetLabel.textContent = `${name} · LOCK`;
      } else {
        this.targetLabel.textContent = `${name} · ${Math.round(progress * 100)}%`;
      }
    }
    if (this.lockState) {
      this.lockState.textContent = isLocked ? (distance < 2200 ? 'LOCK' : 'SEEK') : 'SEEK';
      this.lockState.classList.toggle('critical', isLocked || distance < 900);
    }

    if (onScreen) {
      this.targetBox.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      this.targetBox.classList.add('visible');
      this.targetBox.classList.toggle('acquiring', !isLocked);
      this.targetBox.classList.toggle('locked', isLocked);
      this.targetBox.classList.toggle('close', isLocked || distance < 900);

      // Drive smooth auto-lock convergence animation on inner crosshair & corners.
      const ease = 1 - Math.pow(1 - progress, 2.2);
      const boxScale = isLocked ? 0.92 : 1.75 - ease * 0.78;
      const crossScale = isLocked ? 0.82 : 2.25 - ease * 1.38;
      const crossRot = isLocked ? 0 : (1 - ease) * 58;
      if (!this._tbFrame) this._tbFrame = this.targetBox.querySelector('.tb-frame');
      if (!this._tbCross) this._tbCross = this.targetBox.querySelector('.tb-crosshair');
      if (this._tbFrame) {
        this._tbFrame.style.transform = `scale(${boxScale.toFixed(3)})`;
      }
      if (this._tbCross) {
        this._tbCross.style.transform = `scale(${crossScale.toFixed(3)}) rotate(${crossRot.toFixed(1)}deg)`;
      }
    } else {
      this.targetBox.classList.remove('visible');
    }
  }

  /**
   * Projects 3D floating callsign & hull badges over remote multiplayer
   * aircraft (cyan ALLY badges in Co-Op, red-orange VS badges in Versus).
   */
  _updateMultiplayerTags(mpContacts, physics, camera) {
    const host = this.mpTagsHost;
    if (!host) return;
    const list = mpContacts || [];
    if (!list.length) {
      for (const tag of this.mpTagPool) tag.classList.remove('visible');
      return;
    }
    camera.updateMatrixWorld();
    const s = this.uiScale || 1;
    const vw = this.viewport.w / s;
    const vh = this.viewport.h / s;

    list.forEach((contact, i) => {
      while (this.mpTagPool.length <= i) {
        const elTag = document.createElement('div');
        elTag.className = 'mp-pilot-tag';
        elTag.innerHTML = '<span class="mp-tag-role"></span><b class="mp-tag-name"></b><em class="mp-tag-dist"></em>';
        host.appendChild(elTag);
        this.mpTagPool.push(elTag);
      }
      const tag = this.mpTagPool[i];
      this._tmpVec.set(contact.x, (contact.y ?? physics.position.y) + 8, contact.z).project(camera);
      const behind = this._tmpVec.z > 1 || this._tmpVec.z < -1;
      const x = (this._tmpVec.x * 0.5 + 0.5) * vw;
      const y = (-this._tmpVec.y * 0.5 + 0.5) * vh;
      if (behind || x < 24 || x > vw - 24 || y < 24 || y > vh - 24) {
        tag.classList.remove('visible');
        return;
      }
      tag.classList.add('visible');
      tag.classList.toggle('is-ally', !!contact.ally);
      tag.classList.toggle('is-enemy', !!contact.enemy);
      tag.children[0].textContent = contact.ally ? 'ALLY' : 'VS';
      tag.children[1].textContent = contact.callsign || contact.name || 'PILOT';
      tag.children[2].textContent = `${((contact.distance || 0) / 1000).toFixed(1)} KM`;
      tag.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    });

    for (let i = list.length; i < this.mpTagPool.length; i++) {
      this.mpTagPool[i].classList.remove('visible');
    }
  }
}
