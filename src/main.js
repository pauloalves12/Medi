/**
 * Ascent — a mountain meditation.
 *
 * main.js is the integration layer: renderer, quality tier, the shared `state`
 * object, the phase machine, and the frame loop. It owns no visuals and no UI.
 *
 * ── LOCKED MODULE CONTRACT ───────────────────────────────────────────────────
 * Modules are created once, in this order, and only ever talk to each other
 * through the objects below. Do not add cross-imports between modules.
 *
 *  environment.js  createEnvironment(scene, ctx) -> {
 *      update(dt, state)
 *      getGroundHeight(x, z) -> number          // terrain height under a point
 *      constrainPosition(desired: Vector3)      // mutates to stay on the path
 *      anchors: {                               // world-space Vector3s
 *        start, lantern, orb, bell, shrineView
 *      }
 *      lanternMount: Object3D                   // where the lantern light hangs
 *      orb: Object3D
 *      bell: Object3D
 *      setLanternLit(on: boolean)
 *      setPathGlow(v01)                         // golden path reveal
 *      setOrbBreath(scale01, glow01)            // driven by interactions.js
 *      setOrbActive(on: boolean)
 *      strikeBell(force01)                      // visual swing / resonance
 *    }
 *
 *  lighting.js     createLighting(scene, camera, renderer, ctx) -> {
 *      update(dt, state)
 *      render()                                 // post chain or direct render
 *      resize(w, h, dpr)
 *      setLanternIntensity(v01)
 *      lanternLight: Object3D                   // added to environment.lanternMount
 *    }
 *
 *  atmosphere.js   createAtmosphere(scene, camera, ctx) -> {
 *      update(dt, state)
 *    }
 *
 *  player.js       createPlayer(camera, canvas, ctx) -> {
 *      update(dt, env, state)
 *      position: Vector3
 *      setEnabled(on: boolean)                   // also ends any authored move
 *      lookAtPoint(v: Vector3 | null, weight01)  // gentle assisted look
 *      beginCinematic(target: Vector3, seconds, via?: Vector3)
 *                                                // authored glide; suspends
 *                                                // walking, look stays live
 *      isMoving: boolean
 *      speed01: number
 *    }
 *
 *  interactions.js createInteractions(deps) -> { update(dt) }
 *      deps = { camera, env, player, ui, audio, state, advance }
 *
 *  ui.js           createUI(root, ctx) -> {
 *      showTitle({ onBegin, modes, mode, onMode }) / hideTitle()
 *      setPrompt(text | null, progress01?)
 *      setBreath(label | null, phase01, cycle, total)
 *      setSubtitle(text | null, holdSeconds?)
 *      showComplete(onAgain)
 *      fade(alpha01, seconds, color?)
 *      update(dt, state)
 *    }
 *
 *  audio.js        createAudio(ctx) -> {
 *      unlock() / setPhase(name) / setWind(v01) / setDawn(v01)
 *      lanternLight() / breathCue('inhale'|'exhale') / bell(force01)
 *      chime() / update(dt, state)
 *    }
 *
 * timeofday.js is the one exception to "no cross-imports", and only because it
 * is not a module in this sense: it is a leaf table of colours and one-line
 * response curves with no behaviour and no imports of its own. main.js reads it
 * here and hands the selected mode to everyone on `ctx.tod`, so the modules
 * still talk to nothing but the contract above and the shared `state`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { EXPERIENCES, EXPERIENCE_ORDER, experienceHref } from './experiences.js';
import { MODES, MODE_ORDER, DEFAULT_MODE, resolveMode } from './timeofday.js';
import { createEnvironment } from './environment.js';
import { createLighting } from './lighting.js';
import { createAtmosphere } from './atmosphere.js';
import { createPlayer } from './player.js';
import { createInteractions } from './interactions.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';

/* ── quality tier ─────────────────────────────────────────────────────────── */

function detectQuality() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;

  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;

  if (mobile || cores <= 4 || mem <= 4) return mobile && (cores <= 4 || mem <= 4) ? 'low' : 'medium';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

const QUALITY_PRESETS = {
  high:   { dpr: 2.0, shadows: true,  shadowSize: 2048, bloom: true, fog: 'volumetric', grassCount: 26000, particles: 900, treeDetail: 1.0, mistLayers: 7 },
  medium: { dpr: 1.5, shadows: true,  shadowSize: 1024, bloom: true, fog: 'volumetric', grassCount: 13000, particles: 500, treeDetail: 0.7, mistLayers: 5 },
  low:    { dpr: 1.0, shadows: false, shadowSize: 512,  bloom: false, fog: 'simple',    grassCount: 5000,  particles: 220, treeDetail: 0.45, mistLayers: 3 },
};

/* ── time of day ──────────────────────────────────────────────────────────── */

/**
 * The mode is fixed for the lifetime of the page. Half of what separates the
 * two experiences is decided while materials are being built — palettes, the
 * orb's shader colours, the tint on the pines — so switching from the title
 * screen reloads with `?mode=` rather than growing every module a second code
 * path for a change nobody makes twice. The reload happens behind a fade, and
 * lands back on the title with the other world already behind it.
 */
function detectMode() {
  const q = new URLSearchParams(location.search).get('mode');
  return MODES[q] ? q : DEFAULT_MODE;
}

const modeName = detectMode();
const MODE = resolveMode(modeName);

function chooseMode(next) {
  if (next === modeName || !MODES[next]) return;
  ui.fade(1, 0.55, MODES[next].fadeIn);
  setTimeout(() => {
    const url = new URL(location.href);
    if (next === DEFAULT_MODE) url.searchParams.delete('mode');
    else url.searchParams.set('mode', next);
    location.replace(url.toString());
  }, 620);
}

/* ── shared state ─────────────────────────────────────────────────────────── */

const PHASES = ['title', 'lantern', 'toOrb', 'breathing', 'toShrine', 'bell', 'ending', 'complete'];

const state = {
  phase: 'title',
  phaseTime: 0,
  elapsed: 0,
  started: false,

  lanternLit: false,
  pathGlow: 0,        // 0..1 golden path reveal
  breathCycle: 0,     // completed cycles
  breathTotal: 5,
  breathPhase: 0,     // 0..1 within the current cycle
  bellRung: false,

  // 0..1 along the active mode's light arc. DAWN: pre-dawn indigo -> sun in the
  // valley. DUSK: clear afternoon -> coral afterglow. Every module reads it
  // through its own curve in timeofday.js, so the same number can mean "the
  // lantern matters less" in one mode and "the lantern matters more" in the other.
  dawn: 0,
  mist: 1,            // 1 = thick, 0.35 = cleared at the end
  windGust: 0,        // 0..1 slow wind envelope, driven here, read by everyone
  breathOpen: 0,      // 0..1 lungs, written by interactions.js during 'breathing'
};

function setPhase(next) {
  if (state.phase === next) return;
  state.phase = next;
  state.phaseTime = 0;
  audio.setPhase(next);
}

/* ── boot ─────────────────────────────────────────────────────────────────── */

const canvas = document.getElementById('scene');
const quality = detectQuality();
const preset = QUALITY_PRESETS[quality];

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality !== 'low',
    powerPreference: 'high-performance',
    stencil: false,
  });
} catch (e) {
  document.body.innerHTML = '<div class="noscript">This meditation needs WebGL.</div>';
  throw e;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.dpr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = preset.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2200);

const ctx = {
  quality, preset, renderer, THREE,
  isTouch: matchMedia('(pointer: coarse)').matches,
  mode: modeName,
  tod: MODE,
};

const env = createEnvironment(scene, ctx);
const lighting = createLighting(scene, camera, renderer, ctx);
const atmosphere = createAtmosphere(scene, camera, ctx);
const player = createPlayer(camera, canvas, ctx);
const ui = createUI(document.getElementById('ui'), ctx);
const audio = createAudio(ctx);

// The lantern's light lives on the environment's lantern mount.
if (lighting.lanternLight && env.lanternMount) env.lanternMount.add(lighting.lanternLight);

player.position.copy(env.anchors.start);
player.setEnabled(false);

const interactions = createInteractions({
  camera, env, player, ui, audio, state,
  advance: setPhase,
  ctx,
});

/* ── phase orchestration ──────────────────────────────────────────────────── */

// Both modes run the same 44s ending; what differs is how much of it the light
// spends travelling. See `arc` in timeofday.js.
const ENDING_SECONDS = MODE.arc.endingSeconds;
const LIGHT_SECONDS = MODE.arc.lightSeconds;

function updatePhases(dt) {
  state.phaseTime += dt;

  switch (state.phase) {
    case 'title':
    case 'complete':
      // Nothing left to drive: the arc is where the ending left it.
      break;

    case 'ending': {
      // The light peaks early and then holds, so the last seconds are spent at
      // full light rather than still climbing when the fade begins.
      const t = Math.min(1, state.phaseTime / LIGHT_SECONDS);
      const e = t * t * (3 - 2 * t);
      const arc = MODE.arc.ending(e);
      state.dawn = arc.light;
      state.mist = arc.mist;
      if (state.phaseTime >= ENDING_SECONDS) {
        setPhase('complete');
        ui.showComplete(restart);
      }
      break;
    }

    default: {
      // The walk's own slow drift through the day. DAWN barely moves — a little
      // warmth once the lantern is lit — while DUSK covers a third of its arc
      // here, slowly enough that nothing about it is noticeable until the shrine.
      const arc = MODE.arc.idle(state);
      state.dawn = Math.max(state.dawn, arc.light);
      state.mist = arc.mist;
      break;
    }
  }

  // The lantern's key light is owned by lighting.js but gated on world state,
  // so the integration layer is the one place that drives it.
  lighting.setLanternIntensity(state.lanternLit ? 1 : 0);

  // Slow, non-repeating wind envelope shared by grass, trees, mist and audio.
  const e = state.elapsed;
  state.windGust = 0.5 + 0.28 * Math.sin(e * 0.19) + 0.14 * Math.sin(e * 0.61 + 1.7) + 0.08 * Math.sin(e * 1.13 + 4.2);
}

function begin() {
  if (state.started) return;
  state.started = true;
  audio.unlock();
  ui.hideTitle();
  player.setEnabled(true);
  // Begin is a user gesture, so mouse-look can be captured right here rather
  // than waiting for an unexplained second click on the world.
  player.requestLock();
  setPhase('lantern');
  ui.fade(0, 2.4);
}

function restart() {
  location.reload();
}

// Leaving for the other meditation is the same gesture as changing the hour,
// for the same reason — see the note above detectMode.
function choosePath(next) {
  if (next === 'ascent' || !EXPERIENCES[next]) return;
  ui.fade(1, 0.55, EXPERIENCES[next].fadeIn);
  setTimeout(() => location.replace(experienceHref(next)), 620);
}

ui.showTitle({
  onBegin: begin,
  path: 'ascent',
  paths: EXPERIENCE_ORDER.map((id) => ({ id, label: EXPERIENCES[id].label, tagline: EXPERIENCES[id].tagline })),
  onPath: choosePath,
  mode: modeName,
  modes: MODE_ORDER.map((id) => ({ id, label: MODES[id].label, tagline: MODES[id].tagline })),
  onMode: chooseMode,
});

/* ── frame loop ───────────────────────────────────────────────────────────── */

const clock = new THREE.Clock();
let hidden = false;
document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (!hidden) clock.getDelta();
  audio.setWind(hidden ? 0 : 1);
});

function frame() {
  requestAnimationFrame(frame);
  if (hidden) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  state.elapsed += dt;

  updatePhases(dt);

  player.update(dt, env, state);
  interactions.update(dt);
  env.update(dt, state);
  atmosphere.update(dt, state);
  lighting.update(dt, state);
  ui.update(dt, state);
  audio.update(dt, state);

  lighting.render();
}

/* ── resize ───────────────────────────────────────────────────────────────── */

let resizeTimer = 0;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, preset.dpr);
    camera.aspect = w / h;
    // Slightly wider field of view on tall phone screens so the valley still reads.
    camera.fov = h > w ? 70 : 58;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    lighting.resize(w, h, dpr);
  }, 80);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
onResize();

// the review harness's only hook into the piece
window.__phase = () => state.phase;

frame();
