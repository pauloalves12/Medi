/**
 * Still Water — a meditation on stillness.
 *
 * The integration layer: renderer, quality tier, the shared `state`, the phase
 * machine's clock and the frame loop. It owns no visuals and no UI.
 *
 * ── MODULE CONTRACT ──────────────────────────────────────────────────────────
 * Modules are created once, in this order, and only ever talk to each other
 * through the objects below and the shared `state`. There are no cross-imports
 * between them; the two leaves (mood.js, textures.js) have no behaviour and no
 * imports of ours, so importing them is not a channel.
 *
 *  scene.js     createScene(scene, ctx) -> {
 *      update(dt, state)
 *      getGroundHeight(x, z) -> number
 *      constrainPosition(desired: Vector3)
 *      anchors: { start, stand, lake, compose, ripple }
 *    }
 *
 *  sky.js       createSky(scene, camera, renderer, ctx, { noise }) -> {
 *      update(dt, state) / render() / resize(w, h, dpr)
 *    }
 *
 *  lake.js      createLake(scene, ctx, { groundHeight, noise, rippleCentre }) -> {
 *      update(dt, state)
 *      pulse(strength01)                      // one breathing ring
 *    }
 *
 *  mist.js      createMist(scene, camera, ctx, { noise, dot, groundHeight }) -> {
 *      update(dt, state)
 *    }
 *
 *  stillness.js createStillness(opts) -> { update(dt, sample) -> 0..1, activity, … }
 *
 *  flow.js      createFlow(deps) -> { update(dt) }
 *
 *  player.js and ui.js are shared with Ascent and are used unmodified.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── THE ONE IDEA ─────────────────────────────────────────────────────────────
 * `state.settle` is the only channel between the person and the world. It is
 * the stillness they have earned, floored by flow.js so the ending arrives for
 * everybody, and every module reads it through its own curve in mood.js. The
 * player is never told it exists, never shown a number, and never fails.
 *
 * ── THE HOUR ─────────────────────────────────────────────────────────────────
 * The same lake is walked at two hours: MOONLIT and DAY. Which one is resolved
 * once, here, from `?mode=`, and handed to every module on `ctx.mood`; the
 * celestial values it produces for the current frame are written once onto
 * `state.light` below, so the sky dome and the water's reflection are answering
 * the same arithmetic on the same frame — which is the whole reflection
 * technique. No module knows which hour it is in and there is no `if (day)`
 * anywhere. See mood.js.
 */

import * as THREE from 'three';
import { EXPERIENCES, EXPERIENCE_ORDER, experienceHref } from '../experiences.js';
import { createPlayer } from '../player.js';
import { createUI } from '../ui.js';
import { MOODS, MOOD_ORDER, DEFAULT_MOOD, resolveMood } from './mood.js';
import { noiseTexture, softDotTexture } from './textures.js';
import { createScene } from './scene.js';
import { createSky } from './sky.js';
import { createLake } from './lake.js';
import { createMist } from './mist.js';
import { createStillness } from './stillness.js';
import { createLakeAudio } from './audio.js';
import { createFlow } from './flow.js';

/* ── quality tier ─────────────────────────────────────────────────────────────
 * The same detection Ascent uses, with a table of its own. A night lake spends
 * its budget in different places: no god rays, no dense meadow, no shadow map
 * except on the top tier — a moon casts almost nothing worth a depth pass — and
 * the water gets the resolution instead.
 * ────────────────────────────────────────────────────────────────────────── */

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
  high: {
    dpr: 2.0, shadows: true, shadowSize: 1024, bloom: true,
    terrainSeg: 200, waterSeg: 168, panoWidth: 1024, panoHeight: 96,
    mistBands: 5, motes: 420, pines: 280, grass: 9000, rocks: 48, treeDetail: 1.0,
  },
  medium: {
    dpr: 1.5, shadows: false, shadowSize: 512, bloom: true,
    terrainSeg: 160, waterSeg: 120, panoWidth: 768, panoHeight: 72,
    mistBands: 4, motes: 260, pines: 180, grass: 4200, rocks: 34, treeDetail: 0.7,
  },
  low: {
    dpr: 1.0, shadows: false, shadowSize: 512, bloom: false,
    terrainSeg: 112, waterSeg: 76, panoWidth: 512, panoHeight: 56,
    mistBands: 2, motes: 120, pines: 100, grass: 1600, rocks: 24, treeDetail: 0.45,
  },
};

/* ── shared state ─────────────────────────────────────────────────────────── */

const PHASES = [
  'title', 'approach', 'shore', 'settling', 'breathing',
  'reflection', 'stillness', 'reveal', 'complete',
];

const state = {
  phase: 'title',
  elapsed: 0,
  started: false,

  // 0..1, earned. Never shown, never named, never scored.
  stillness: 0,
  // What the world actually answers to: the stillness, floored by flow.js so
  // that the ending is reachable from any behaviour. Zero for the whole middle.
  settle: 0,
  settleFloor: 0,
  activity: 0,

  breathOpen: 0,      // 0..1 lungs, written by flow.js during 'breathing'
  // The same signal centred on zero, and *only* while somebody is breathing.
  // The lake stretches its reflection by this, and a resting value of -0.5
  // would have been a permanent stretch — enough to slide the reflected moon
  // off the mirror point and lose it for the whole piece.
  breathTilt: 0,
  windGust: 0,        // 0..1 slow envelope, driven here, read by everyone

  // The hour's celestial values for this frame, from `mood.light(state)`.
  // Written once per frame before anything reads it, so the dome, the lights
  // and the water's reflection cannot disagree about where the sun is.
  light: null,
};

function setPhase(next) {
  if (state.phase === next || PHASES.indexOf(next) < 0) return;
  state.phase = next;
  audio.setPhase(next);
  if (next === 'complete') showComplete();
}

/* ── boot ─────────────────────────────────────────────────────────────────── */

const canvas = document.getElementById('scene');
const quality = detectQuality();
const preset = QUALITY_PRESETS[quality];

/**
 * The hour is fixed for the lifetime of the page, and choosing another one is a
 * reload rather than a teardown — the same decision Ascent makes about its
 * modes and boot.js makes about the two meditations, for the same reason: half
 * of what separates the moonlit lake from the morning one is decided while its
 * materials are being compiled, and nobody switches twice.
 */
function detectMood() {
  const q = new URLSearchParams(location.search).get('mode');
  return MOODS[q] ? q : DEFAULT_MOOD;
}

const moodName = detectMood();
const mood = resolveMood(moodName);
document.documentElement.dataset.mode = moodName;

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

const scene3 = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 3000);

const ctx = {
  quality, preset, renderer, THREE,
  isTouch: matchMedia('(pointer: coarse)').matches,
  experience: 'stillwater',
  mood, mode: moodName,
  // ui.js opens on this rather than on black. Fading a bright morning up out
  // of the night's near-black is a flash, not a fade.
  fadeIn: mood.fadeIn,
};

// Before anything is built, so a module that wants the sun while it is still
// choosing its materials does not have to guard against not having one yet.
state.light = mood.light(state);

const texNoise = noiseTexture(256, 8821);
const texDot = softDotTexture();

const env = createScene(scene3, ctx);
const sky = createSky(scene3, camera, renderer, ctx, { noise: texNoise });
const lake = createLake(scene3, ctx, {
  groundHeight: env.getGroundHeight,
  noise: texNoise,
  rippleCentre: env.anchors.ripple,
});
const mist = createMist(scene3, camera, ctx, {
  noise: texNoise, dot: texDot, groundHeight: env.getGroundHeight,
});
const player = createPlayer(camera, canvas, ctx);
const ui = createUI(document.getElementById('ui'), ctx);
const audio = createLakeAudio(ctx);
const stillness = createStillness();

player.position.copy(env.anchors.start);
player.setEnabled(false);

const flow = createFlow({
  env, player, ui, audio, lake, state,
  advance: setPhase,
  ctx,
});

/* ── title ────────────────────────────────────────────────────────────────── */

function choosePath(next) {
  if (next === 'stillwater' || !EXPERIENCES[next]) return;
  ui.fade(1, 0.55, EXPERIENCES[next].fadeIn);
  setTimeout(() => location.replace(experienceHref(next)), 620);
}

/** The other hour of the same lake. Fades out toward where it is going. */
function chooseMood(next) {
  if (next === moodName || !MOODS[next]) return;
  ui.fade(1, 0.55, MOODS[next].fadeIn);
  setTimeout(() => {
    const url = new URL(location.href);
    if (next === DEFAULT_MOOD) url.searchParams.delete('mode');
    else url.searchParams.set('mode', next);
    location.replace(url.toString());
  }, 620);
}

function begin() {
  if (state.started) return;
  state.started = true;
  audio.unlock();
  ui.hideTitle();
  player.setEnabled(true);
  player.requestLock();
  setPhase('approach');
  ui.fade(0, 3.0);
}

function restart() { location.reload(); }

function leave() {
  ui.fade(1, 0.55, EXPERIENCES.ascent.fadeIn);
  setTimeout(() => location.replace(experienceHref('ascent')), 620);
}

function showComplete() {
  ui.showComplete(restart, {
    line: 'You may carry this stillness with you.',
    duration: false,           // nothing here was counted
    onLeave: leave,
  });
}

ui.showTitle({
  onBegin: begin,
  path: 'stillwater',
  paths: EXPERIENCE_ORDER.map((id) => ({ id, label: EXPERIENCES[id].label, tagline: EXPERIENCES[id].tagline })),
  onPath: choosePath,
  mode: moodName,
  modes: MOOD_ORDER.map((id) => ({ id, label: MOODS[id].label, tagline: MOODS[id].tagline })),
  onMode: chooseMood,
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

  // Before anything is walked there is nothing to be still about, and the
  // meter must not fill while the title card is up.
  if (state.started && state.phase !== 'complete') {
    state.stillness = stillness.update(dt, {
      yaw: player.yaw, pitch: player.pitch, speed01: player.speed01,
    });
    state.activity = stillness.activity;
  }
  state.settle = Math.max(state.stillness, state.settleFloor);

  // A slow, non-repeating envelope shared by the pines, the mist and the audio.
  // How much of it survives to be felt is the settle's business, not this one's.
  const e = state.elapsed;
  state.windGust = 0.5 + 0.28 * Math.sin(e * 0.17) + 0.14 * Math.sin(e * 0.53 + 1.7)
    + 0.08 * Math.sin(e * 1.09 + 4.2);

  // Once, before anything reads it: the dome and the lake must be answering
  // the same sun on the same frame or the reflection is of a different sky.
  state.light = mood.light(state);

  player.update(dt, env, state);
  flow.update(dt);
  env.update(dt, state);
  lake.update(dt, state);
  mist.update(dt, state);
  sky.update(dt, state);
  ui.update(dt, state);
  audio.update(dt, state);

  sky.render();
}

/* ── resize ───────────────────────────────────────────────────────────────── */

let resizeTimer = 0;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, preset.dpr);
    camera.aspect = w / h;
    // A taller frame needs a wider lens or the lake loses the sky above it.
    camera.fov = h > w ? 70 : 58;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    sky.resize(w, h, dpr);
  }, 80);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
onResize();

// the review harness's only hook into the piece
window.__phase = () => state.phase;
window.__mode = () => moodName;
window.__still = () => ({ stillness: state.stillness, settle: state.settle, activity: state.activity });
window.__cam = () => ({
  x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2),
  yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3),
});

frame();
