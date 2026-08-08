/**
 * tools/shots.mjs — the review harness.
 *
 * Drives a real Chromium against the local server, walks an experience through
 * an authored script of waits and inputs, and writes PNGs. Nothing here is part
 * of the piece; it exists so that "how does it look at the shrine" and "does the
 * lake read on a phone" are questions with reproducible answers.
 *
 *   node tools/shots.mjs stillwater            # Still Water, the moonlit hour
 *   node tools/shots.mjs stillwater day        # Still Water, the morning
 *   node tools/shots.mjs ascent dawn           # Ascent regression pass
 *   node tools/shots.mjs devices               # final frame on three screens
 *   node tools/shots.mjs tiers [mood]          # one moment on all three tiers
 *
 * Requires a static server on :8080 and Playwright's bundled Chromium.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// Playwright is a review dependency, not a project one — there is no
// package.json here and there should not be. Take it from wherever it is:
// a local node_modules if someone made one, the global root otherwise.
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not local */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(`${root}/playwright`);
  } catch (e) {
    console.error('playwright not found: npm i -g playwright');
    process.exit(2);
  }
}
const { chromium } = loadPlaywright();

const BASE = process.env.SHOT_BASE || 'http://localhost:8080';
const OUT = resolve(process.cwd(), 'review-screenshots');
// A software rasteriser cannot sustain the top tier at a desktop size, and the
// tier is not what most of these shots are about. SHOT_QUALITY=medium pins it.
const Q = process.env.SHOT_QUALITY ? `quality=${process.env.SHOT_QUALITY}` : '';
const url = (q) => `${BASE}/?${[q, Q].filter(Boolean).join('&')}`;

const DESKTOP = { width: 1440, height: 900, isMobile: false, tag: 'desktop' };
const PHONE = { width: 390, height: 844, isMobile: true, tag: 'phone' };
const TABLET = { width: 834, height: 1180, isMobile: true, tag: 'tablet' };

/* ── the clock ──────────────────────────────────────────────────────────────
 * Every experience runs off THREE.Clock, which runs off performance.now(). We
 * replace it with a counter we advance ourselves, so a four-minute meditation
 * is a hundred lines of arithmetic rather than four minutes of waiting — and,
 * more importantly, so the same shot is the same shot every run.
 * ────────────────────────────────────────────────────────────────────────── */

const CLOCK_INIT = `
  (() => {
    let virtual = 0;
    const realNow = performance.now.bind(performance);
    window.__advance = (ms) => { virtual += ms; };
    performance.now = () => realNow() + virtual;
    const D = Date.now;
    Date.now = () => D() + virtual;
  })();
`;

/**
 * Advance the virtual clock in slices, giving the page a real animation frame
 * between each so the frame loop actually integrates the time rather than
 * swallowing it in one clamped delta. main.js clamps dt to 50 ms, so slices
 * must not exceed that or time silently disappears.
 */
async function run(page, seconds, slice = 0.045) {
  const steps = Math.max(1, Math.round(seconds / slice));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((ms) => {
      window.__advance(ms);
      return new Promise((r) => requestAnimationFrame(() => r()));
    }, slice * 1000);
  }
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  // A software rasteriser can take most of a minute over one full-size frame.
  await page.screenshot({ path: file, timeout: 180000 });
  console.log('  ·', name);
}

/**
 * The waits between shots are minutes of meditation nobody is going to look at,
 * and on a software rasteriser a full-size frame costs a second. Shrink the
 * window while time is being spent and put it back before anything is captured:
 * the simulation does not know or care how large the window is.
 */
async function cheap(page, device, on) {
  await page.setViewportSize(on
    ? { width: 420, height: 280 }
    : { width: device.width, height: device.height });
  await page.waitForTimeout(240);          // the resize handler is debounced
}

async function open(browser, url, device) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: 1,
    isMobile: device.isMobile,
    hasTouch: device.isMobile,
    reducedMotion: 'no-preference',
  });
  await context.addInitScript(CLOCK_INIT);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  // The title card's entrances are CSS animations, which run off the real clock
  // and not the virtual one. Give them their four seconds so the card is shot
  // as it is seen, and so `Begin` is actually clickable when we get to it.
  await page.waitForTimeout(4300);
  return { page, context, errors };
}

/* ── input ────────────────────────────────────────────────────────────────── */

async function begin(page) {
  await page.click('.title .begin');
  await page.waitForTimeout(120);
}

/** Hold the walk key while the virtual clock advances. */
async function walk(page, seconds) {
  await page.keyboard.down('KeyW');
  await run(page, seconds);
  await page.keyboard.up('KeyW');
}

/** A deliberate look sweep, as a series of pointer-lock mouse deltas. */
async function look(page, dx, dy, seconds = 0.6) {
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    await page.evaluate(([x, y]) => {
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y }));
    }, [dx / steps, dy / steps]);
    await run(page, seconds / steps);
  }
}

async function hold(page, seconds) {
  await page.keyboard.down('Space');
  await run(page, seconds);
  await page.keyboard.up('Space');
}

const phase = (page) => page.evaluate(() => window.__phase && window.__phase());

/**
 * Ascent tells you when you are close enough and looking at the right thing:
 * the prompt ring appears. Driving off that rather than off coordinates means
 * the harness needs no hooks into the piece and cannot walk past anything.
 */
// The prompt starts fading in 4.2 m before the hold is actually actionable, so
// a harness that acts on "I can see it" holds from too far away and nothing
// happens. Wait until it is nearly solid.
const promptUp = (page, min = 0.72) => page.evaluate((m) => {
  const el = document.querySelector('.prompt');
  return !!el && el.classList.contains('is-on') && parseFloat(el.style.opacity || '1') >= m;
}, min);

/**
 * Walk a leg of Ascent and take the thing at the end of it.
 *
 * Ascent's hold-to-confirm wants proximity *and* gaze, and the prompt starts
 * fading in four metres before the hold is actually actionable — so a harness
 * that walks until it can see the prompt and then holds is holding from too far
 * away. Trying to be clever about aiming was worse: big search sweeps walk the
 * player off the path entirely.
 *
 * So: two metres, then hold, then check, and repeat. It cannot overshoot,
 * because it tries at every step of the way, and the small alternating wiggle
 * self-cancels rather than accumulating into a wrong heading.
 */
async function leg(page, from, steps = 16) {
  // ±18° either side of straight ahead, and back. The offsets cancel, so the
  // heading at the end of a step is the heading at the start of it and the
  // walker never drifts off the path.
  const HEADINGS = [0, 150, -300, 150];
  for (let i = 0; i < steps; i++) {
    if ((await phase(page)) !== from) return true;
    await walk(page, 1.2);
    for (const dx of HEADINGS) {
      if (dx) await look(page, dx, 0, 0.25);
      await hold(page, 1.5);
      if ((await phase(page)) !== from) return true;
    }
  }
  return (await phase(page)) !== from;
}

/** Bounded wait: never let a harness loop outlive the thing it is watching. */
async function until(page, test, seconds, step = 3.0) {
  const rounds = Math.ceil(seconds / step);
  for (let i = 0; i < rounds; i++) {
    if (await test()) return true;
    await run(page, step);
  }
  return test();
}

/* ── scripts ──────────────────────────────────────────────────────────────── */

/**
 * Still Water, end to end, at one of its hours.
 *
 * `mood` is 'moonlit' or 'day'; the script is identical for both, which is the
 * point — the two hours share the phase machine, the walk and the mechanic, so
 * a script that needs to know which one it is in would be evidence of a leak.
 */
async function stillwater(browser, device = DESKTOP, prefix = 'stillwater', mood = 'moonlit') {
  const q = 'experience=stillwater' + (mood === 'moonlit' ? '' : `&mode=${mood}`);
  const { page, context, errors } = await open(browser, url(q), device);
  console.log(`\n${prefix} (${mood}) @ ${device.tag}`);

  await run(page, 3.2);
  await shot(page, `${prefix}/1-title`);

  await begin(page);
  await run(page, 4.0);
  await shot(page, `${prefix}/2-approach`);

  // down the path to the shore; the arrival trigger takes it from there
  await cheap(page, device, true);
  for (let i = 0; i < 14 && (await phase(page)) === 'approach'; i++) await walk(page, 3.0);
  await cheap(page, device, false);
  await run(page, 2.5);
  await shot(page, `${prefix}/3-arrival`);

  // Disturbed: look around hard so stillness stays down, but alternate the
  // direction so the net heading is unchanged — this frame has to be the same
  // frame as the settled ones or it compares nothing.
  for (let i = 0; i < 6; i++) {
    await look(page, i % 2 ? 210 : -210, i % 2 ? 60 : -60, 0.5);
    await run(page, 0.4);
  }
  await shot(page, `${prefix}/4-disturbed`);

  // then stop, and let it settle into the breathing
  await cheap(page, device, true);
  await until(page, async () => (await phase(page)) !== 'settling', 70, 2);
  await run(page, 8.0);
  await cheap(page, device, false);
  await shot(page, `${prefix}/5-breathing`);

  await cheap(page, device, true);
  await run(page, 26);
  await cheap(page, device, false);
  await shot(page, `${prefix}/6-half-settled`);

  await cheap(page, device, true);
  await until(page, async () => !['breathing', 'reflection'].includes(await phase(page)), 230, 3);
  await run(page, 6.0);
  await cheap(page, device, false);
  await shot(page, `${prefix}/7-still`);

  await cheap(page, device, true);
  await until(page, async () => (await phase(page)) === 'reveal', 110, 3);
  await cheap(page, device, false);
  await run(page, 14);
  await shot(page, `${prefix}/8-reveal`);

  await cheap(page, device, true);
  await until(page, async () => (await phase(page)) === 'complete', 60, 3);
  await cheap(page, device, false);
  await run(page, 8.0);
  await shot(page, `${prefix}/9-complete`);

  console.log(errors.length ? `  ! ${errors.length} console errors` : '  · no console errors');
  errors.slice(0, 6).forEach((e) => console.log('    ', e));
  await context.close();
  return errors;
}

/** The final composition only, on three screens. */
async function devices(browser, only) {
  const out = [];
  const list = [PHONE, TABLET, DESKTOP].filter((d) => !only || d.tag === only);
  for (const d of list) {
    const { page, context, errors } = await open(browser, url('experience=stillwater'), d);
    console.log(`\nfinal @ ${d.tag}`);
    await run(page, 3.0);
    await shot(page, `stillwater-devices/${d.tag}-title`);
    await begin(page);
    await cheap(page, d, true);
    for (let i = 0; i < 14 && (await phase(page)) === 'approach'; i++) await walk(page, 3.0);
    await until(page, async () => (await phase(page)) === 'reveal', 340, 4);
    await cheap(page, d, false);
    await run(page, 20);
    await shot(page, `stillwater-devices/${d.tag}-final`);
    // the desktop pass doubles as the narrative set's last two frames
    if (d === DESKTOP) {
      await shot(page, 'stillwater/8-reveal');
      await cheap(page, d, true);
      await until(page, async () => (await phase(page)) === 'complete', 60, 3);
      await cheap(page, d, false);
      await run(page, 8.0);
      await shot(page, 'stillwater/9-complete');
    }
    console.log(errors.length ? `  ! ${errors.length} console errors` : '  · no console errors');
    errors.slice(0, 4).forEach((e) => console.log('    ', e));
    out.push(...errors);
    await context.close();
  }
  return out;
}

/** The same moment on all three tiers, so "low still looks like the place". */
async function tiers(browser, mood = 'moonlit') {
  const out = [];
  const m = mood === 'moonlit' ? '' : `&mode=${mood}`;
  for (const q of ['low', 'medium', 'high']) {
    const { page, context, errors } = await open(browser, `${BASE}/?experience=stillwater${m}&quality=${q}`, DESKTOP);
    console.log(`\ntier ${q} (${mood})`);
    await begin(page);
    await cheap(page, DESKTOP, true);
    for (let i = 0; i < 14 && (await phase(page)) === 'approach'; i++) await walk(page, 3.0);
    // far enough in that the lake has answered, and always the same far enough
    await until(page, async () => (await phase(page)) === 'breathing', 130, 3);
    await run(page, 30);
    await cheap(page, DESKTOP, false);
    await run(page, 1.0);
    await shot(page, `stillwater-tiers/${mood === 'moonlit' ? '' : `${mood}-`}${q}`);
    console.log(errors.length ? `  ! ${errors.length} console errors` : '  · no console errors');
    errors.slice(0, 4).forEach((e) => console.log('    ', e));
    out.push(...errors);
    await context.close();
  }
  return out;
}

/** Ascent, end to end, for regression. */
async function ascent(browser, mode = 'dawn') {
  const { page, context, errors } = await open(browser, url(mode === 'dawn' ? '' : `mode=${mode}`), DESKTOP);
  console.log(`\nascent ${mode}`);
  const dir = `regression/${mode}`;

  await run(page, 3.2);
  await shot(page, `${dir}/1-title`);

  // Ascent's valley cloud sea is five near-fullscreen transparent sheets, which
  // on a software rasteriser costs more per frame than the whole of Still
  // Water. Everything between shots happens small.
  const reached = {};
  await begin(page);
  await cheap(page, DESKTOP, true);
  await run(page, 3.0);
  reached.lit = await leg(page, 'lantern');
  await run(page, 3.0);
  await cheap(page, DESKTOP, false);
  await shot(page, `${dir}/2-lantern`);

  await cheap(page, DESKTOP, true);
  reached.breathing = await leg(page, 'toOrb');
  await run(page, 3.0);
  await cheap(page, DESKTOP, false);
  await shot(page, `${dir}/3-orb`);

  await cheap(page, DESKTOP, true);
  await until(page, async () => (await phase(page)) !== 'breathing', 140, 4);
  await run(page, 2.0);
  await cheap(page, DESKTOP, false);
  await shot(page, `${dir}/4-breathing-done`);
  reached.breathingDone = (await phase(page)) === 'toShrine';

  await cheap(page, DESKTOP, true);
  reached.rung = await leg(page, 'toShrine');
  await run(page, 3.0);
  await cheap(page, DESKTOP, false);
  await shot(page, `${dir}/5-bell-settle`);

  await cheap(page, DESKTOP, true);
  await until(page, async () => (await phase(page)) === 'ending', 30, 3);
  await until(page, async () => (await phase(page)) === 'complete', 70, 4);
  await cheap(page, DESKTOP, false);
  await run(page, 1.0);
  await shot(page, `${dir}/6-payoff`);
  reached.complete = (await phase(page)) === 'complete';
  await run(page, 8.0);
  await shot(page, `${dir}/7-complete`);

  console.log('  phases:', JSON.stringify(reached));
  console.log(errors.length ? `  ! ${errors.length} console errors` : '  · no console errors');
  errors.slice(0, 6).forEach((e) => console.log('    ', e));
  await context.close();
  return errors.concat(Object.values(reached).includes(false) ? ['a phase was not reached'] : []);
}

/* ── main ─────────────────────────────────────────────────────────────────── */

const [what, arg] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

let errors = [];
try {
  if (what === 'ascent') errors = await ascent(browser, arg || 'dawn');
  else if (what === 'devices') errors = await devices(browser, arg);
  else if (what === 'tiers') errors = await tiers(browser, arg || 'moonlit');
  else if (what === 'phone') errors = await stillwater(browser, PHONE, 'stillwater-phone', arg || 'moonlit');
  else if (what === 'tablet') errors = await stillwater(browser, TABLET, 'stillwater-tablet', arg || 'moonlit');
  else if (what === 'stillwater') {
    const mood = arg || 'moonlit';
    errors = await stillwater(browser, DESKTOP, mood === 'day' ? 'stillwater-day' : 'stillwater', mood);
  } else errors = await stillwater(browser, DESKTOP, arg || 'stillwater');
} finally {
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
