/**
 * Aircraft catalogue for the New Game hangar screen.
 *
 * Two airframes are available from the first flight; the rest open up as
 * missions are completed (see MISSIONS in core/Missions.js). Each entry
 * carries flight stats for FlightPhysics, a livery for AircraftModel and a
 * few visual toggles so the silhouettes read differently in the air.
 */

export const AIRCRAFT = [
  {
    id: 'wraith',
    name: 'F-31 WRAITH',
    role: 'AIR SUPERIORITY',
    unlock: null,
    stats: { speed: 1.0, turn: 1.0, boost: 1.0, hull: 100 },
    livery: { body: 0xe9e6db, dark: 0x25343d, accent: 0xff7a3d, cyan: 0x2fe0d0 },
    visual: { scale: 1.0, canard: true, missiles: true },
    blurb: 'Balanced multirole fighter. Forgiving controls, full missile rack.',
  },
  {
    id: 'sparrow',
    name: 'T-6 SPARROW',
    role: 'LIGHT INTERCEPTOR',
    unlock: null,
    stats: { speed: 1.12, turn: 1.15, boost: 1.15, hull: 75 },
    livery: { body: 0xdfe8ee, dark: 0x1d2b33, accent: 0xffd23f, cyan: 0x53e0ff },
    visual: { scale: 0.92, canard: false, missiles: true },
    blurb: 'Quick and nimble, but thin skin. Outturns everything in a knife fight.',
  },
  {
    id: 'thunder',
    name: 'A-14 THUNDERBOLT',
    role: 'GROUND ATTACK',
    unlock: { mission: 0 },
    stats: { speed: 0.88, turn: 0.85, boost: 0.9, hull: 140 },
    livery: { body: 0x9aa4ac, dark: 0x2c3238, accent: 0x8aff6a, cyan: 0x2fe0d0 },
    visual: { scale: 1.1, canard: true, missiles: true },
    blurb: 'Armoured slugger. Soaks up hits and keeps its guns online.',
  },
  {
    id: 'ghost',
    name: 'F-40 GHOST',
    role: 'STEALTH FIGHTER',
    unlock: { mission: 1 },
    stats: { speed: 1.18, turn: 1.08, boost: 1.25, hull: 70 },
    livery: { body: 0x2f3540, dark: 0x14181e, accent: 0x9b6cff, cyan: 0x66ffe0 },
    visual: { scale: 0.96, canard: false, missiles: false },
    blurb: 'Fastest airframe in the wing. Clean profile, no external stores.',
  },
  {
    id: 'titan',
    name: 'B-2 TITAN',
    role: 'HEAVY FIGHTER',
    unlock: { mission: 2 },
    stats: { speed: 0.82, turn: 0.78, boost: 0.85, hull: 180 },
    livery: { body: 0xc8b98f, dark: 0x3a3324, accent: 0xff6a3d, cyan: 0x2fe0d0 },
    visual: { scale: 1.18, canard: true, missiles: true },
    blurb: 'Flying fortress. Slow to swing, very hard to put down.',
  },
  // --- 4 ELITE SUPERPLANES (Ace Combat Legends + Signature Special Weapons) ---
  {
    id: 'morgan',
    name: 'ADFX-02 MORGAN',
    role: 'ELITE · EXPERIMENTAL',
    elite: true,
    specialMissile: 'mpbm_morgan',
    specialLabel: 'MPBM-X BURST',
    unlock: { mission: 3 },
    stats: { speed: 1.32, turn: 1.24, boost: 1.38, hull: 125 },
    livery: { body: 0xebeef2, dark: 0x21262e, accent: 0xd92638, cyan: 0x5ef0ff },
    visual: { scale: 1.04, canard: true, missiles: true },
    blurb: 'Prototipe ELIT sayap maju Belkan. Membawa rudal khusus MPBM-X shockwave 72 m & boost tahan lama.',
  },
  {
    id: 'wyvern',
    name: 'X-02S STRIKE WYVERN',
    role: 'ELITE · SWITCHBLADE',
    elite: true,
    specialMissile: 'eml',
    specialLabel: 'EML ARCLIGHT',
    unlock: { mission: 4 },
    stats: { speed: 1.38, turn: 1.34, boost: 1.44, hull: 115 },
    livery: { body: 0x465466, dark: 0x1b222c, accent: 0xff552e, cyan: 0x54f2ff },
    visual: { scale: 1.02, canard: true, missiles: false },
    blurb: 'Jet siluman ELIT bersayap lipat-maju Erusea. Dipersenjatai EML Arclight Railgun Mach 7.',
  },
  {
    id: 'nosferatu',
    name: 'CFA-44 NOSFERATU',
    role: 'ELITE · CARRIER ACE',
    elite: true,
    specialMissile: 'admm',
    specialLabel: 'ADMM 8× SWARM',
    unlock: { mission: 5 },
    stats: { speed: 1.40, turn: 1.42, boost: 1.48, hull: 110 },
    livery: { body: 0x262932, dark: 0x12141a, accent: 0xe0283c, cyan: 0xffb84d },
    visual: { scale: 1.04, canard: true, missiles: false },
    blurb: 'Pesawat tempur ELIT Estovakia berkemampuan belok ekstrem. Dilengkapi salvo 8 rudal ADMM Swarm.',
  },
  {
    id: 'falken',
    name: 'ADF-01 FALKEN',
    role: 'ELITE · COFFIN APEX',
    elite: true,
    specialMissile: 'tls',
    specialLabel: 'TLS-01 LASER',
    unlock: { mission: 6 },
    stats: { speed: 1.48, turn: 1.46, boost: 1.55, hull: 135 },
    livery: { body: 0x8f1d28, dark: 0x181b22, accent: 0xff3854, cyan: 0x4ef5ff },
    visual: { scale: 1.05, canard: true, missiles: false },
    blurb: 'Puncak tempur ELIT berkanopi lapis baja COFFIN. Memancarkan laser taktis kembar TLS-01 & boost tercepat.',
  },
];

const BY_ID = new Map(AIRCRAFT.map((craft) => [craft.id, craft]));

export function getAircraft(id) {
  return BY_ID.get(id) ?? AIRCRAFT[0];
}

/** Airframes available before any mission has been completed. */
export function defaultUnlockedIds() {
  return AIRCRAFT.filter((craft) => !craft.unlock).map((craft) => craft.id);
}

/**
 * @param {string} id airframe id
 * @param {string[]} unlocked list of unlocked ids from the save
 * @returns {boolean}
 */
export function isUnlocked(id, unlocked) {
  const craft = BY_ID.get(id);
  if (!craft) return false;
  if (!craft.unlock) return true;
  return Array.isArray(unlocked) && unlocked.includes(id);
}

/** Mission index (0-based) that must be completed to open this airframe. */
export function unlockMissionIndex(id) {
  const craft = BY_ID.get(id);
  return craft?.unlock?.mission ?? null;
}
