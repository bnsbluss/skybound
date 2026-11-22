# SKYBOUND

A low-poly 3D flight simulator that runs entirely in the browser. Fly a jet fighter over a procedurally generated coral archipelago — turquoise lagoons, forested peaks, drifting cloud banks and an animated ocean — with a military HUD, chase camera, afterburner and mobile touch controls.

Built with **Three.js**, vanilla **JavaScript ES modules**, **HTML5** and **CSS3**. Every model, texture, sound and island is generated at runtime; there are no external asset files.

---

## Quick start

### Option 1 — one file (easiest)

Open **`SKYBOUND.html`** in any modern browser. Double-clicking it works; no server, no installation, no folder structure required.

### Option 2 — project build

Keep `index.html` next to the `dist/` folder and open `index.html`.

```
index.html
dist/
  game.css
  game.js
```

`dist/game.js` is a classic IIFE bundle, not an ES module, so it also runs from `file://`. WebGL is required.

Optional graphics override: append `?quality=low`, `?quality=medium` or `?quality=high` to either entry point. The Setting screen (also reachable from the pause panel) exposes a graphics selector.

---

## Controls

### Desktop

| Input | Action |
| --- | --- |
| **W / S** | Pitch — nose down / nose up |
| **A / D** | Roll left / right |
| **Q / E** | Yaw left / right |
| **X / Z** | Throttle up / down |
| **SHIFT** | Afterburner (limited reserve, regenerates) |
| **SPACE** | Air brake |
| **F** or **left mouse** | Cannon fire (the heat limiter is internal; no heat/OVERHEAT HUD readout) |
| **G** or **right mouse** | Launch a homing missile at the locked bandit (unlimited stock, 1.5 s cooldown, up to 6 in flight) |
| **V** | Deploy an **IR flare salvo** — decoys an inbound missile (15 canisters, 0.7 s cooldown) |
| **Mouse drag** | Orbit the chase camera |
| **Mouse wheel** | Zoom the chase camera |
| **C** or the **01** button | Cycle **01 / CHASE → 02 / OVERHEAD → 03 / COCKPIT** view |
| **L** or the **LCK** button | Toggle **Auto Lock View** — the camera keeps the nearest bandit framed |
| **AI** button | Toggle the **Auto Pilot (AI · Mode Aggressive)** — full-power lead pursuit on a randomly re-rolled bandit, instant missile release as soon as the lock tone sounds, automatic flares against inbound missiles, predictive terrain look-ahead with sticky recovery climb and automatic guns; click again to take the stick back (per-sortie only) |
| **FS** button | Toggle fullscreen (hidden where the browser has no Fullscreen API) |
| **P** or **Esc** | Pause / resume (the pause panel offers **RESUME**, **PENGATURAN**, **RESTART SORTIE** and **KEMBALI KE MENU**) |
| **M** | Mute / unmute |
| **H** | Flight manual |
| **Enter / Space** | Menu — open the hangar, then launch the selected aircraft (**Esc** closes the open sub-screen) |

### Touch

- **Left stick** — pitch and roll.
- **Right stick** — yaw and throttle (push up for military power).
- **GUN** — hold for cannon fire.
- **MSL** — fire one homing missile per tap.
- **FLR** — release one flare salvo per tap (pale gold so it reads as countermeasures).
- **AB** — afterburner.
- **BRK** — air brake.
- Top-right buttons switch view (**01/02/03**), toggle fullscreen (**FS**), pause, mute and open the manual.
- **GIRO (settings → pause)** — optional tilt steering: the phone becomes the yoke. Tip the top edge toward you to climb, away to dive, tilt right/left to roll. Neutral is calibrated to the hold position whenever it is switched on or a sortie starts (iOS asks for motion permission on first enable). It stacks with the sticks and keyboard, with a 5° dead zone and full deflection by 30° of tilt. The **KALIBRASI** button next to it re-zeros the gyro on demand, and the calibration/tilt mapping is compensated for the screen orientation angle, so landscape play reads correctly; rotating the device re-captures the neutral automatically.

Touch layout hides the bulky radar and engine panels; the nearest island contact moves into the centre status strip and the compact combat panel sits at the bottom-left above the stick. The **threat arrow** and the compact **THREAT SCOPE** (the bandit-only radar on the left) stay on screen so the threat picture survives the touch layout.

### Moving the HUD (LETAK HUD)

Pause → **PENGATURAN → LETAK HUD → GESER** gives every HUD widget its own pulsing dashed outline: combat, radar, threat scope, engine, status strip, the speed/altitude tapes, view tag, key hints, the top-row brand/mission card, compass, top info line, each top action button (01, LCK, AI, FS, ?, SND, pause) and each touch button (GUN, MSL, FLR, AB, BRK). Every one is independent:

- **Hold and drag** to move a panel anywhere on screen.
- **Tap once** (without dragging) to select it — the outline turns solid and a small editor opens next to it:
  - **UKURAN** −/+ — scale the panel from **50 % to 200 %** in 10 % steps.
  - **TRANSPARAN** −/+ — opacity from **20 % to 100 %** in 10 % steps (dim panels instead of hiding them).
  - **RESET PANEL INI** — restore just that panel to its factory look.
- Everything (position, size, transparency) is saved per device and survives reloads; **RESET** on the settings row restores the whole layout. Edit mode switches itself off when you resume the flight.
- Since **1.5.0** the editor itself takes pointer events (`pointer-events: auto`, 32 px touch targets), so the −/+/RESET/× buttons really respond to real mouse and finger clicks instead of only synthetic ones.

---

## Features

### Main menu & career

- **Six-item main menu** — `1 NEW GAME`, `2 DAFTAR MISI`, `3 CONTINUE`, `4 SETTING`, `5 ABOUT`, `6 EXIT` — driven by arrow keys + Enter/Space (Esc closes a sub-screen) or by tapping. `CONTINUE` is disabled until a save exists and launches straight back into the next story mission.
- **Hangar with 5 airframes** — F-31 WRAITH and T-6 SPARROW from the start; **A-14 THUNDERBOLT**, **F-40 GHOST** and **B-2 TITAN** stay locked until their mission is cleared. Every card shows the stats the flight model actually consumes (top speed, agility, hull, stores).
- **Eight-mission story campaign** — **BADAI PERTAMA** (12 bandits), **LANGIT KOTA** (14), **PASIR BERDARAH** (16), **DINDING GUNUNG** (12 + survive 90 s), **PERTAHANAN IBU KOTA** (10 + 120 s), **JALUR PUNGGUNG GUNUNG** (18), **ARMADA GURUN** (20), **FAJAR TERAKHIR** (24). The mission list shows `SELESAI / AKTIF / TERKUNCI`, chapter art, map and objective; cleared missions stay replayable, future missions stay sealed. Clearing one unlocks its airframe, arms `CONTINUE` and advances the header badge (`X / Y KILL` plus the survival clock).
- **Mission debrief** — the clear opens a report with kills, score, sortie time, the next story beat, the airframe reward and **MISI BERIKUTNYA** / **KEMBALI KE MENU** buttons. Progress is persisted immediately.
- **Setting screen** — graphics preset, HUD side, **UI scale (80–160 %, desktop defaults to 110 %)**, **Auto Lock View**, **world map (CORAL / KOTA / GURUN / GUNUNG)**, touch-button layout, gyro + **gyro calibration**, **movement sensitivity (0.4–2.5)**, **audio**, **camera cycle**, **LETAK HUD** and a full **key remapper** covering all 18 actions: click a keycap to rebind, duplicates are rejected (`TIDAK BOLEH DUPLIKAT`), Esc cancels, and a reset button restores the defaults. Everything persists per device and the same screen opens from the main menu and from the pause panel.
- **About** credits the author — **HeavyRain AKA Ziky Andeska** — with a control summary and build card; **Exit** shows a thank-you panel, then asks the browser to close the tab (with a manual-close note when the browser refuses).

### World

- **Four selectable biomes** — picked from **SETTING → PETA DUNIA** (the same Setting screen opens from the pause panel), persisted in `localStorage` (`skybound.map`). **CORAL** is the tropical archipelago with coastal lighthouses, beach huts and lagoon sailboats; **KOTA** is a **New York-inspired metropolis** with a Manhattan street grid (250 m avenues, 80 m cross streets, zebra crosswalks, lane markings), the Hudson and East Rivers + Upper Bay, 5 suspension bridges (Brooklyn, Manhattan, Williamsburg, Queensboro, George Washington), Central Park with its reservoir and lakes, Empire State / Chrysler / One WTC / Times Square / Statue of Liberty landmarks, procedural window facades, and **live traffic** (yellow taxis, cars and city buses obeying one-way lanes and traffic-light cycles); **GURUN** is a vast golden dune sea with spring-fed palm oases, stepped sandstone pyramids, Monument-Valley style mesas and saguaro cacti; and **GUNUNG** is a broad highland massif with emerald alpine lakes, valley pine forests, snow-dusted high-altitude conifers and snow peaks. Land maps hide the ocean mesh and lay an 80 km ground sheet at `y = -0.8`, so no water is ever visible at the horizon.
- **In-place map switching** — choosing a map (or launching a mission / hitting `CONTINUE` on another map) builds the new `World` off-screen, swaps it into the live scene, reparents aircraft, trails, weapons and bandits, then disposes the old world. No page reload; the flight state resumes on the new map.
- Procedural coral archipelago: **15 islands**, each with a unique seeded silhouette, coast shelf, beaches, hills and mountain peaks.
- **10 major islands** feed the ocean shader with ellipse coast data, producing turquoise lagoon tint, animated surf bands and foam rings around the shore.
- Animated **low-poly ocean** with layered swell, ripples, crest whitecaps, sun glitter, fresnel sky reflection, distance haze and fog.
- **LOD island meshes** — high-detail rings near the camera swap to a low-detail shell far away.
- Instanced low-poly **broadleaf, pine and palm forests**, rocks and beach props. Typical builds: ~2,100 trees on low, ~6,300 on high.
- Volumetric-style **cumulus clouds** built from an opaque faceted core plus a translucent outer shell, slowly drifting on the wind.
- Gradient **sky dome** with a sun disc, glow sprite, horizon haze, high cirrus and subtle solar drift.
- Directional sun with cascaded-style shadow focus that follows the aircraft, plus hemisphere fill light.
- Scattered islands provide natural race markers, valleys for low passes and ridges to buzz.

### Aircraft

- Original low-poly **F-31 WRAITH** fighter: blended fuselage, swept wings, twin canted tails, stabilators, canopy, intakes, missiles and navigation lights.
- Animated control surfaces: ailerons, elevators, rudders and throttle-linked exhaust petals.
- Twin engine effects with heat glow, shock diamonds, afterburner cones, exhaust shimmer and wingtip vapour.
- Smoke/contrail particle system with speed-dependent emission, plus water and terrain crash bursts.
- Dynamic ground shadow blob that fades with altitude.

### Flight model

- Quaternion attitude with **pitch / roll / yaw** rates and smooth control damping.
- Coordinated bank turns, lift vectoring, energy trading, induced drag and speed-dependent control authority.
- **Afterburner reserve** with drain, regeneration and a minimum re-arm threshold.
- Air brake, stall sink and G-force telemetry.
- **Auto Pilot (AI · Mode Aggressive)** — the **AI** button hands the stick to an autopilot that picks a **random live bandit** and re-rolls its target every 6–10 s. It flies lead pursuit with **professional throttle management**: full dry power and afterburner while chasing or recovering energy, throttle pulled back in the saddle, airbrake when closure is too high for a clean gun solution, and power restored while turning or near the deck. It continuously **projects its path 0.8–3.5 s ahead** against terrain and wave crests. If any sample gets within 120 m of the deck (or current AGL drops under 320 m) it abandons the hunt, levels the wings, holds fire and climbs on afterburner until the whole projected path is above 420 m and AGL clears 620 m; dives fade out below 900 m AGL and hard banks below 600 m. Weapons are lock-driven: the seeker **chirps a lock tone** the moment the chosen bandit enters its cone (dot > 0.94, under 2600 m), the cannon fires inside the boresight cone under 1500 m, and the **missile launches on the same frame the lock is acquired** (over 400 m, rack cooldown armed) with no lock-hold delay. When a hostile missile is detected inside 1600 m the AI **deploys flares automatically** (same 0.7 s cooldown and 15-salvo stock as the manual V key, AI mode only). On touch devices the **on-screen sticks mirror the AI's commands** (left knob = pitch/roll, right knob = yaw/throttle) so you can watch it fly — a finger on the stick always wins. It is a per-sortie mode: clicking **AI** again returns full manual control.
- **30 % airframe defense** — every incoming hit (hostile missile, proximity blast, cannon round) is reduced by 30 % before it reaches the hull, so a direct hostile missile costs 29.4 hull instead of 42.
- Altitude/speed telemetry feeds the HUD; terrain and ocean collisions trigger the crash sequence.

### Camera

- Smooth third-person chase camera with spring damping and velocity look-ahead.
- Mouse orbit with idle auto-recentre and wheel zoom; **Pointer Lock** keeps the cursor inside the sortie and releases it for every menu, pause panel, crash screen and the in-flight help card.
- **Auto Lock View** (**L** / **LCK**) frames the current weapon target or the nearest live bandit within 7 km and follows it; the lock box stays on the followed bandit.
- **Three views** cycled with **C** or the top-right **01** button: `01 / CHASE`, `02 / OVERHEAD` (top-down, nose to screen-top), `03 / COCKPIT` (rigid forward-facing first-person inside a real 3D cockpit interior — mouse look never turns the view off the nose).
- Crash shake, speed/boost FOV widening and terrain/ocean collision avoidance.
- Cinematic attract-mode orbit on the start screen.

### Combat

- **Bandit squadron** — pooled low-poly enemy jets with patrol / engage / break AI, lead pursuit, coordinated banking, terrain avoidance and burst cannon fire. Squadron size follows the quality preset (3 / 4 / 5); bandits spawn and patrol in a **wide 3.2–5.4 km ring** so the player has to hunt them on radar instead of starting every fight nose-to-nose, and losses respawn after a few seconds.
- **Cannon** with wing-root tracers, spread, an internal heat limiter and automatic cooldown; heat is no longer shown on the HUD.
- **Homing missiles** with unlimited stock, a 1.5 s launch cooldown and at most 6 in flight, plus seeker lock, proportional turning, proximity and terrain fuses and splash damage.
- **Hostile missiles** — bandits fire IR missiles at you from a lined-up tail shot (380–1750 m, long cooldown). A direct hit costs 42 hull, a 45 m proximity burst costs 21, and the launch shouts `MISSILE LAUNCH DETECTED`.
- **IR flare countermeasure** — **V** (or **FLR**) releases 4 glowing decoys per salvo from a **15-canister** stock, 0.7 s cooldown. A decoy inside the seeker's envelope seduces the missile (`MISSILE DECOYED · +50 PTS`), which detonates harmlessly and can never damage you; when the decoy burns out the seeker re-acquires the aircraft.
- **Explosion system** — pooled additive fireballs, sparks, debris and rising smoke for hits, kills and crashes.
- Hull damage from bandit fire; a destroyed airframe ends the sortie with a `shot down` cause and an auto-redeploy.
- Scoring: hit, gun kill and missile kill pay out differently; toasts confirm every kill.
- Lock box tracks the selected bandit with live range, and the radar reports hostile contacts.

### HUD

- Military-style IAS and altitude tapes, Mach readout, radar altimeter, vertical speed.
- Sliding compass ribbon, pitch ladder, flight-path marker, crosshair and bank indicator.
- Boost reserve segments, throttle/brake state, engine and airframe status.
- **View tag** (`01 / CHASE` …), compact **weapon panel** (hull, unlimited missiles shown as `∞`, **15 flares**, kills, score, lock, **inbound missile range**) parked **bottom-left** and a **projected lock box**. The old cannon heat / OVERHEAT readout is gone.
- **Radar** with island and bandit contacts, distance and nearest-contact bearing.
- **Threat arrows for every bandit** — one chevron per live bandit riding a ring around the reticle in the heading-up frame, each with its own live range label (`1.2KM` / `480M`); the closest contact is highlighted, arrows pool in and out with the contact count and the whole group hides when the sky is clear.
- **Compact THREAT SCOPE on the left** — a bandit-only mini radar (range rings, sweep, own-ship marker, nearest-bandit highlight, count + nearest readout) that also carries the contact picture on touch layouts where the tactical radar is hidden.
- Warning stack (**missile inbound**, stall, pull-up, overspeed, brake, boost depletion), mission clock, FPS and quality readout.
- Top-right action row: **01** view switch, **LCK** Auto Lock View, **AI** Auto Pilot, **FS** fullscreen, manual, sound and pause.
- **Loading screen** — the very first paint shows the wordmark, sweeping target rings, a live progress bar, rotating pilot tips and a spinner; it fades out when the world is ready and re-opens as an error panel if the boot fails.
- **Setting screen (main menu or pause)** for layout: **HUD SIDE** (KIRI/KANAN moves the combat column to either edge), **SKALA UI** (80–160 % global HUD/menu zoom), **AUTO LOCK VIEW**, **PETA DUNIA** (CORAL/KOTA/GURUN/GUNUNG rebuilds the biome in place), **TOMBOL** (KIRI/TENGAH/KANAN parks the touch buttons — buttons you have repositioned keep their spot), **GIRO** (tilt-to-steer on phones) with a **KALIBRASI** button, **AUDIO**, **CAMERA** and **LETAK HUD** (drag-and-drop panel positioning). The pause panel itself now only carries **RESUME FLIGHT / PENGATURAN / RESTART SORTIE / KEMBALI KE MENU**. All preferences persist in `localStorage` (the map as `skybound.map`).
- Start screen with procedural-world statistics, loading progress and aircraft card.
- Pause panel with graphics, audio, camera and layout controls; crash panel with impact telemetry and auto-redeploy countdown.
- Responsive desktop/tablet/phone layouts with safe-area insets and short-screen scrolling.

### Cockpit (view 03)

- A real 3D interior parented to the camera: instrument coaming, glare shield, canopy pillars and front window posts, side consoles, rails, mirror and the tub walls/floor around the pilot — it inherits camera shake while staying locked straight ahead.
- **Three live displays** drawn into canvas textures at 12 Hz:
  - **Left MFD — SYS/PROPULSION**: throttle and boost bars, MACH, vertical speed, G, heading and a blinking caution block (STALL / PULL UP).
  - **Centre panel**: airspeed and altitude gauges with needles, weapon status column (hull, missiles, lock, score, kills) and a heading tape.
  - **Right MFD — TAC**: large 7.5 km tactical scope with sweeping wedge, red bandit blips, contact count and nearest range.
- **Control-room hardware**: overhead switch panel with 24 lit toggles and two guarded red switches, warning lamp strip, throttle quadrant with dual levers on the left console, 3 × 4 button grid on the right console and a buttoned centre pedestal.
- **Control stick** on the tub floor between the pilot's knees — base, shaft, angled grip with trigger, hat switch and three weapon-select buttons — that leans smoothly with your live pitch/roll input (pull back = grip aft, roll left = grip left).
- **Wide, clean canopy** — cockpit FOV opens at **76°** (vs 68° in chase-friendly builds) and `.hud.cockpit-active` fades out the DOM radar, engine, weapon, key-hint and flight-status panels, so the view is not blocked by flat HUD cards. Edge ladder, reticle and threat arrows stay dimmed for orientation.
- The old DOM dash overlay was removed; only the canopy vignette remains as a DOM layer.

### Pixel-art rendering

- Optional low-resolution render target upscaled with nearest-neighbour sampling for a crisp pixel look, plus ordered Bayer dithering and colour quantisation.
- Sharpened presets: low/medium render at half resolution with 32/48 colour levels; high renders natively with no quantisation or dither.
- Adaptive clamp — the pixel block size grows (up to native) so the internal buffer never drops below 760 px wide, keeping small phone screens sharp instead of mushy.
- Overrides: `?pixelscale=N` (1 = off) and `?dither=0`; defaults follow the quality preset.

### Audio

Fully procedural WebAudio: turbofan whine, jet rush, wind, afterburner roar, UI blips, cannon cracks, missile whoosh, **flare burst** (a noise pop sweeping 3.2 kHz → 700 Hz), explosions, hull hits, lock tone and a crash impact. Audio starts on the first launch (browser autoplay policy) and can be muted with **M**.

---

## Performance

Three quality tiers are selected automatically from pointer type, CPU cores, device memory and screen size:

| | Low | Medium | High |
| --- | --- | --- | --- |
| Pixel ratio cap | 1.0 | 1.5 | 2.0 |
| Antialiasing | off | on | on |
| Shadows | off | 1536² | 2048² |
| Ocean segments | 128² | 176² | 240² |
| Island rings / segments | 14 / 36 | 22 / 52 | 30 / 72 |
| Tree density | 0.42 | 0.80 | 1.15 |
| Cloud clusters | 7 | 12 | 17 |
| Bandits | 3 | 4 | 5 |
| Pixel scale (render ÷ N) | 2 | 2 | 1 |
| Colour levels | 32 | 48 | off |

Additional optimisations:

- InstancedMesh for forests, rocks, missiles and cloud puffs.
- Island LOD with distance-based mesh swapping.
- Dynamic resolution scaling — if FPS drops below 48 the renderer lowers pixel ratio in steps (floor 0.64×) and recovers when headroom returns.
- Single draw calls for the ocean and sky, no post-processing pass.
- Particle pools with fixed capacity and reusable buffers.
- Capped delta time to prevent physics explosions after tab switches.
- Quality choice persists in `localStorage` and can be forced via URL.

---

## Project layout

```
src/
  main.js                  entry point, fatal-error fallback
  styles.css               full responsive HUD/UI styling
  fonts.css                embedded Rajdhani + Share Tech Mono (base64 WOFF2)
  core/
    Game.js                orchestration, state machine, loop, crash/respawn
    Quality.js             presets, auto-detect, persistence, pixel ratio
    Progress.js            missions, aircraft unlocks, save / load
    AudioSystem.js         procedural WebAudio soundscape
  world/
    World.js               scene assembly, land ground sheet, world-level samplers
    Biomes.js              coral / city / desert / mountain map configs
    Sky.js                 sky dome, sun sprite, lights, shadows
    Ocean.js               animated shader ocean with lagoons/surf
    IslandField.js         island geometry, LOD, instanced vegetation
    Clouds.js              instanced volumetric-style cumulus
  aircraft/
    Aircraft.js            visual coordinator and ground shadow
    AircraftModel.js       F-31 mesh, control surfaces, lights
    AircraftCatalog.js     5 airframes, flight stats, unlock gates
    FlightPhysics.js       quaternion flight model and telemetry
    EngineEffects.js       exhaust, afterburner, shock diamonds, vapour
    Cockpit.js             control-room interior, three canvas MFD displays
  camera/
    ChaseCamera.js         chase/overhead/cockpit views, orbit, collision avoidance
  controls/
    InputManager.js        keyboard, mouse, touch, gyro state, smoothing
    MobileControls.js      virtual sticks and action buttons (GUN / MSL / FLR / AB / BRK)
  hud/
    HUD.js                 instruments, screens, weapon panel, lock box, loading overlay, HUD drag
  combat/
    Weapons.js             cannon, heat, homing + hostile missiles, IR flares, collisions
    Enemies.js             bandit model, AI state machine, spawning, missile launches
  fx/
    TrailSystem.js         smoke, contrails, crash bursts
    ExplosionSystem.js     pooled fireball / spark / smoke particles
  render/
    PixelRenderer.js       low-res target, nearest upscale, Bayer dither
  utils/
    math.js  noise.js  terrain.js  geometry.js  textures.js  fullscreen.js
scripts/
  build-standalone.mjs     inlines CSS/JS into SKYBOUND.html
tests/
  test-core.mjs            island samplers + flight physics
  test-career.mjs          catalogue, career save, hangar, menu, settings, mission badge
  test-world.mjs           coral world, aircraft, camera, trails, input
  test-maps.mjs            city / desert / mountain land maps (dry, grounded, populated)
  test-hud.mjs             HUD markup, callbacks, instruments, loading overlay, per-panel editor, threat arrow
  test-game.mjs            full game loop, stubbed renderer, cockpit interior, menu/mission/flare flows
  test-mobile.mjs          virtual sticks, buttons (incl. FLR), gyro tilt mapping
  test-combat.mjs          explosions, weapons, hostile missiles, flares, bandit AI, input
  test-pixel.mjs           quality presets, sharpness clamp, effective scale
```

## Build

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run build            # minified dist/game.js + dist/game.css + source maps
npm run build:standalone # inline build → SKYBOUND.html
npm run build:all        # both of the above
npm run build:dev        # readable bundle for debugging
```

> **Android note:** shared storage (`/storage/emulated/0`) is mounted `noexec`, so the native
> esbuild binary cannot run from this delivery folder. `SKYBOUND.html` is already built and
> playable as-is; to rebuild, copy the project to internal storage (`~`) first and run the
> commands there.

### Tests

```bash
npm test                 # core, career, HUD, world, maps, game, mobile, combat, pixel
npm run test:core
npm run test:career
npm run test:hud
npm run test:world
npm run test:maps       # KOTA / GURUN / GUNUNG land-map checks
npm run test:game
npm run test:mobile
npm run test:combat
npm run test:world:high  # build the high-quality world (~6,300 trees)
```

The test suite runs headless with jsdom and a stubbed renderer, so it validates DOM markup, state transitions, physics and scene construction without needing a browser or GPU.

---

## Browser support

- Chrome / Edge / Firefox / Safari with WebGL 1 or 2.

## Version

V1.8.1 — story campaign, in-place city/desert/mountain maps and the professional-pilot autopilot.

- Desktop and Android/iOS touch devices.
- `file://` opening is supported by both entry points.
- WebGL context loss shows a fatal error instead of a frozen screen.
- If JavaScript or WebGL is unavailable, the page displays a fallback message.

## Credits

- **HeavyRain AKA Ziky Andeska** — game design, code and direction (see **ABOUT** in the main menu).
- **Three.js** — MIT License.
- **Rajdhani** and **Share Tech Mono** — SIL Open Font License, embedded as base64 WOFF2.
- All geometry, textures, island data and audio are generated by this project.
- Code © 2026 SKYBOUND OPS.
