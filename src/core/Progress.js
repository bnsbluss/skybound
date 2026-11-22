/**
 * Career progress: story missions, airframe unlocks and the localStorage save.
 *
 * The save is intentionally tiny — a few numbers plus the list of unlocked
 * airframes — so it survives reloads and lets Continue jump straight back
 * into the next mission.
 */
import { AIRCRAFT, defaultUnlockedIds, getAircraft, isUnlocked } from '../aircraft/AircraftCatalog.js';
import {
  MISSILES,
  defaultUnlockedMissileIds,
  getMissile,
  isMissileUnlocked,
} from '../combat/MissileCatalog.js';

export const SAVE_KEY = 'skybound.save';

/**
 * Story campaign, in order. Every mission has its own map, objective and
 * chapter text. A mission may also require the pilot to stay alive for
 * `survive` seconds, which turns the later sorties into hold-the-line fights
 * instead of pure kill races.
 */
export const MISSIONS = [
  {
    id: 'first-storm',
    chapter: 'BAB 01 · AWAL',
    name: 'BADAI PERTAMA',
    map: 'coral',
    kills: 12,
    survive: 0,
    unlocks: 'thunder',
    brief: 'Hancurkan 12 bandit yang menembus perairan Sektor 07.',
    story:
      'Sektor 07 adalah rumah. Pagi ini radar pesisir mendeteksi dua belas kontak tanpa transponder — bandit yang datang untuk menguji pertahanan kita. Naik, kunci target, dan bersihkan langit sebelum mereka menyentuh pulau.',
  },
  {
    id: 'city-siege',
    chapter: 'BAB 02 · BETON & BAJA',
    name: 'LANGIT KOTA',
    map: 'city',
    kills: 14,
    survive: 0,
    unlocks: 'ghost',
    brief: 'Bersihkan 14 bandit yang bersembunyi di antara gedung pencakar langit.',
    story:
      'Ibu kota METRO PRIME terkepung. Musuh memakai menara tinggi sebagai tameng radar dan melancarkan serangan dari koridor jalan. Terbang rendah, jangan biarkan gedung menutup bidikan, dan jatuhkan empat belas pesawat sebelum mereka mencapai distrik pusat.',
  },
  {
    id: 'sand-storm',
    chapter: 'BAB 03 · SAMUN',
    name: 'PASIR BERDARAH',
    map: 'desert',
    kills: 16,
    survive: 0,
    unlocks: 'titan',
    brief: 'Hancurkan 16 musuh (bandit udara & tank patroli gurun) di atas lautan dune.',
    story:
      'Konvoi darat kita hilang di gurun. Armada bayangan mengerahkan jet tempur dan kolom TANK patroli bersenjata berat yang menembaki langit dari balik bukit pasir. Enam belas target udara & tank lapis baja, satu gurun — bersihkan semuanya.',
  },
  {
    id: 'mountain-wall',
    chapter: 'BAB 04 · DINDING DUNIA',
    name: 'DINDING GUNUNG',
    map: 'mountain',
    kills: 12,
    survive: 90,
    unlocks: 'morgan',
    brief: 'Hancurkan 12 bandit dan pertahankan langit pegunungan selama 90 detik.',
    story:
      'Stasiun radar di punggung gunung menjadi mata terakhir kita. Musuh tahu itu. Mereka datang dari lembah, memakai tebing sebagai bayangan, dan mencoba membutakan kita. Tahan sembilan puluh detik pertama; setelah itu balikkan keadaan dan jatuhkan dua belas pesawat.',
  },
  {
    id: 'capital-defense',
    chapter: 'BAB 05 · GARIS AKHIR',
    name: 'PERTAHANAN IBU KOTA',
    map: 'city',
    kills: 10,
    survive: 120,
    unlocks: 'wyvern',
    brief: 'Lindungi evakuasi ibu kota: 10 bandit dihancurkan, bertahan 120 detik.',
    story:
      'Evakuasi sipil sedang berlangsung di bawah. Setiap menit yang kita berikan berarti satu konvoi lagi keluar dari kota. Musuh tidak lagi peduli pada gedung — mereka mengejar jalan keluar. Jaga koridor udara selama dua menit dan hancurkan sepuluh penyusup.',
  },
  {
    id: 'ridge-run',
    chapter: 'BAB 06 · PUNGGUNG DUNIA',
    name: 'JALUR PUNGGUNG GUNUNG',
    map: 'mountain',
    kills: 18,
    survive: 0,
    unlocks: 'nosferatu',
    brief: 'Kejar dan hancurkan 18 bandit di koridor pegunungan.',
    story:
      'Skuadron elit musuh meninggalkan pangkalan gurun dan melarikan diri ke pegunungan. Mereka terbang rendah, berpasangan, dan saling melindungi. Delapan belas kontak terakhir harus jatuh di antara tebing — tidak ada bala bantuan yang akan datang untuk mereka.',
  },
  {
    id: 'desert-armada',
    chapter: 'BAB 07 · ARMADA BAYANGAN',
    name: 'ARMADA GURUN',
    map: 'desert',
    kills: 20,
    survive: 0,
    unlocks: 'falken',
    brief: 'Hancurkan 20 target pengawal udara & tank lapis baja armada gurun.',
    story:
      'Depot senjata terakhir musuh bergerak melintasi gurun di bawah pengawalan jet tempur dan barisan TANK tempur utama yang menembakkan meriam anti-udara. Hancurkan seluruh pengawal udara dan tank gurun mereka untuk membuka prototipe puncak ADF-01 FALKEN.',
  },
  {
    id: 'last-dawn',
    chapter: 'BAB 08 · FAJAR TERAKHIR',
    name: 'FAJAR TERAKHIR',
    map: 'coral',
    kills: 24,
    survive: 0,
    brief: 'Serangan terakhir: hancurkan 24 bandit dan rebut kembali Sektor 07.',
    story:
      'Mereka datang dengan seluruh kekuatan yang tersisa. Dua puluh empat pesawat, satu fajar, dan satu kesempatan. Di bawah sana rumah kita masih berdiri. Di atas sini hanya kamu, radar, dan langit yang harus kembali biru. Selesaikan ini.',
  },
];

function defaults() {
  return {
    version: 2,
    mission: 0,
    aircraft: 'wraith',
    unlocked: defaultUnlockedIds(),
    points: 0,
    missile: 'aim9x',
    unlockedMissiles: defaultUnlockedMissileIds(),
    best: { score: 0, kills: 0 },
  };
}

function sanitize(data) {
  const base = defaults();
  if (!data || typeof data !== 'object') return base;
  const unlocked = new Set(base.unlocked);
  for (const id of Array.isArray(data.unlocked) ? data.unlocked : []) {
    if (AIRCRAFT.some((craft) => craft.id === id)) unlocked.add(id);
  }
  const unlockedMissiles = new Set(base.unlockedMissiles);
  for (const id of Array.isArray(data.unlockedMissiles) ? data.unlockedMissiles : []) {
    if (MISSILES.some((m) => m.id === id)) unlockedMissiles.add(id);
  }
  const mission = Number.isFinite(data.mission)
    ? Math.max(0, Math.min(MISSIONS.length, Math.floor(data.mission)))
    : 0;
  const points = Number.isFinite(data.points) ? Math.max(0, Math.floor(data.points)) : 0;
  const missileCandidate = MISSILES.some((m) => m.id === data.missile) ? data.missile : base.missile;
  const missile = isMissileUnlocked(missileCandidate, [...unlockedMissiles])
    ? missileCandidate
    : base.missile;
  const best = data.best && typeof data.best === 'object' ? data.best : {};
  return {
    version: 2,
    mission,
    aircraft: AIRCRAFT.some((craft) => craft.id === data.aircraft) ? data.aircraft : base.aircraft,
    unlocked: [...unlocked],
    points,
    missile,
    unlockedMissiles: [...unlockedMissiles],
    best: {
      score: Math.max(0, Number(best.score) || 0),
      kills: Math.max(0, Number(best.kills) || 0),
    },
  };
}

/** Read the save, falling back to a fresh career on any problem. */
export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return defaults();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

/** Merge a patch into the save and persist it. Returns the stored career. */
export function saveProgress(patch = {}) {
  const next = sanitize({ ...loadProgress(), ...patch });
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked — the run still works, just not persisted */
  }
  return next;
}

/** Wipe the career (used by tests / a future reset option). */
export function clearProgress() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
  return defaults();
}

/**
 * Reset all story missions back to Mission 1 (index 0) for New Game, while
 * keeping every unlocked aircraft, earned Points (PTS), and unlocked missiles.
 */
export function resetMissionsForNewGame(progress, overrides = {}) {
  const p = sanitize(progress ?? loadProgress());
  return saveProgress({
    ...p,
    ...overrides,
    mission: 0,
    unlocked: [...p.unlocked],
    points: p.points,
    unlockedMissiles: [...p.unlockedMissiles],
  });
}

/** Mission currently awaiting the player, or null once the campaign is done. */
export function currentMission(progress) {
  const p = progress ?? loadProgress();
  return MISSIONS[p.mission] ?? null;
}

/**
 * Mission by index, clamped to the active campaign entry. Completed missions
 * stay replayable through the mission list.
 */
export function missionAt(index, progress) {
  const p = progress ?? loadProgress();
  const clamped = Math.max(0, Math.min(p.mission, Math.floor(Number(index) || 0)));
  return MISSIONS[clamped] ?? null;
}

/** A completed mission may be replayed; future missions stay sealed. */
export function isMissionPlayable(progress, index) {
  const p = progress ?? loadProgress();
  return index >= 0 && index <= p.mission && index < MISSIONS.length;
}

/** Objective line shared by the mission list, hangar and HUD badge. */
export function missionObjective(mission) {
  if (!mission) return 'FREE FLIGHT';
  const killText = `${mission.kills} BANDIT`;
  if (mission.survive > 0) {
    const minutes = Math.floor(mission.survive / 60);
    const seconds = mission.survive % 60;
    const time = `${minutes}:${String(seconds).padStart(2, '0')}`;
    return `${killText} · BERTAHAN ${time}`;
  }
  return killText;
}

export function isAircraftUnlocked(progress, id) {
  return isUnlocked(id, (progress ?? loadProgress()).unlocked);
}

/**
 * Record a finished mission: unlock its airframe, advance the campaign and
 * keep the best sortie numbers.
 *
 * @param {object} progress current career (defaults to the stored save)
 * @param {number} missionIndex 0-based mission that was just cleared
 * @param {{score?:number,kills?:number}} [result] sortie result
 * @returns {{progress:object, unlocked:string[], mission:object|null, complete:boolean}}
 */
export function completeMission(progress, missionIndex, result = {}) {
  const p = sanitize(progress ?? loadProgress());
  const mission = MISSIONS[missionIndex];
  if (!mission) return { progress: p, unlocked: [], mission: null, complete: p.mission >= MISSIONS.length };

  const before = new Set(p.unlocked);
  if (mission.unlocks && !before.has(mission.unlocks)) {
    p.unlocked.push(mission.unlocks);
    const unlockedCraft = getAircraft(mission.unlocks);
    if (
      unlockedCraft?.specialMissile &&
      !p.unlockedMissiles.includes(unlockedCraft.specialMissile)
    ) {
      p.unlockedMissiles.push(unlockedCraft.specialMissile);
    }
  }
  const unlocked = p.unlocked.filter((id) => !before.has(id));

  p.mission = Math.max(p.mission, Math.min(MISSIONS.length, missionIndex + 1));
  const rewardPoints =
    400 + missionIndex * 120 + Math.round(Math.max(0, Number(result.score) || 0) * 0.15);
  p.points = (p.points || 0) + rewardPoints;
  p.best = {
    score: Math.max(p.best.score, Math.max(0, Number(result.score) || 0)),
    kills: Math.max(p.best.kills, Math.max(0, Number(result.kills) || 0)),
  };
  const stored = sanitize(p);
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
  return {
    progress: stored,
    unlocked,
    rewardPoints,
    mission: MISSIONS[stored.mission] ?? null,
    complete: stored.mission >= MISSIONS.length,
  };
}

/** Awards Points (PTS) earned from sorties or multiplayer matches and persists them. */
export function awardPoints(progress, amount) {
  const p = sanitize(progress ?? loadProgress());
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  if (add <= 0) return { progress: p, added: 0 };
  const stored = saveProgress({ ...p, points: p.points + add });
  return { progress: stored, added: add };
}

/** Spends Points (PTS) to unlock a missile system and equips it immediately. */
export function unlockMissile(progress, missileId) {
  const p = sanitize(progress ?? loadProgress());
  const spec = getMissile(missileId);
  if (!spec) return { ok: false, reason: 'invalid', progress: p };
  if (isMissileUnlocked(spec.id, p.unlockedMissiles)) {
    const stored = saveProgress({ ...p, missile: spec.id });
    return { ok: true, already: true, progress: stored, missile: spec };
  }
  if (p.points < spec.cost) {
    return { ok: false, reason: 'insufficient', need: spec.cost - p.points, progress: p, missile: spec };
  }
  const stored = saveProgress({
    ...p,
    points: p.points - spec.cost,
    unlockedMissiles: [...p.unlockedMissiles, spec.id],
    missile: spec.id,
  });
  return { ok: true, already: false, progress: stored, missile: spec };
}
