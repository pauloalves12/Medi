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
 *      setEnabled(on: boolean)
 *      lookAtPoint(v: Vector3 | null, weight01)  // gentle assisted look
 *      isMoving: boolean
 *      speed01: number
 *    }
 *
 *  interactions.js createInteractions(deps) -> { update(dt) }
 *      deps = { camera, env, player, ui, audio, state, advance }
 *
 *  ui.js           createUI(root, ctx) -> {
 *      showTitle(onBegin) / hideTitle()
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
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
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

  dawn: 0,            // 0 = pre-dawn indigo, 1 = sun in the valley
  mist: 1,            // 1 = thick, 0.35 = cleared at the end
  windGust: 0,        // 0..1 slow wind envelope, driven here, read by everyone
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

const ctx = { quality, preset, renderer, THREE, isTouch: matchMedia('(pointer: coarse)').matches };

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

const ENDING_SECONDS = 36;
const DAWN_SECONDS = 25;   // dawn reaches full a clear beat before the fade starts

function updatePhases(dt) {
  state.phaseTime += dt;

  switch (state.phase) {
    case 'title':
      break;

    case 'ending': {
      // Dawn peaks early and then holds, so the last seconds are spent at full
      // light rather than still climbing when the fade begins.
      const t = Math.min(1, state.phaseTime / DAWN_SECONDS);
      const e = t * t * (3 - 2 * t);
      state.dawn = e;
      state.mist = 1 - 0.62 * e;
      if (state.phaseTime >= ENDING_SECONDS) {
        setPhase('complete');
        ui.showComplete(restart);
      }
      break;
    }

    default:
      // Lantern light bleeds a little warmth into the world once lit.
      state.dawn = Math.max(state.dawn, state.lanternLit ? 0.06 : 0);
      break;
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
  setPhase('lantern');
  ui.fade(0, 2.4);
}

function restart() {
  location.reload();
}

ui.showTitle(begin);

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

frame();
