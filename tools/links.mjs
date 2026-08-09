/**
 * tools/links.mjs — every way into the sanctuary, and every way between.
 *
 *   node tools/links.mjs
 *
 * Loads each entry point, checks the world it booted, checks the title card
 * offers the right two meditations and the right two hours with the right one
 * chosen, and then clicks the selectors to confirm each lands where it says.
 * Also asserts what a URL is allowed to survive: `?quality=` outlives a choice
 * because it is a testing switch, `?mode=` does not outlive a change of
 * meditation because neither one's hours mean anything in the other.
 *
 * Cheap next to tools/shots.mjs — nothing here renders past a title card — so
 * it is the thing to run after touching boot.js, experiences.js, ui.js, or
 * either main.js. Needs a static server on :8080 and Playwright's Chromium.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// Playwright is a review dependency, not a project one — see tools/shots.mjs.
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not local */ }
  try { return require(`${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright`); } catch (e) {
    console.error('playwright not found: npm i -g playwright');
    process.exit(2);
  }
}
const { chromium } = loadPlaywright();

const BASE = process.env.SHOT_BASE || 'http://localhost:8080';
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`); } };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

async function open(q) {
  const context = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url()} HTTP ${r.status()}`); });
  await page.goto(`${BASE}/${q ? `?${q}` : ''}`, { waitUntil: 'load' });
  await page.waitForTimeout(4600);
  return { page, context, errors, failed };
}

const words = (page, sel) => page.$$eval(sel, (ns) => ns.map((n) => ({
  label: n.textContent.trim(),
  current: n.classList.contains('is-current'),
  disabled: n.disabled,
})));

/* ── every entry point boots the world it names ───────────────────────────── */

const CASES = [
  { q: '', exp: 'ascent', hours: ['Dawn', 'Dusk'], on: 'Dawn' },
  { q: 'mode=dusk', exp: 'ascent', hours: ['Dawn', 'Dusk'], on: 'Dusk' },
  { q: 'experience=stillwater', exp: 'stillwater', hours: ['Moonlit', 'Day'], on: 'Moonlit' },
  { q: 'experience=stillwater&mode=day', exp: 'stillwater', hours: ['Moonlit', 'Day'], on: 'Day' },
  // an hour that belongs to the other meditation, and one that belongs to none
  { q: 'experience=stillwater&mode=dusk', exp: 'stillwater', hours: ['Moonlit', 'Day'], on: 'Moonlit' },
  { q: 'experience=stillwater&mode=elevenses', exp: 'stillwater', hours: ['Moonlit', 'Day'], on: 'Moonlit' },
  { q: 'experience=nowhere&mode=day', exp: 'ascent', hours: ['Dawn', 'Dusk'], on: 'Dawn' },
  { q: 'experience=stillwater&mode=day&quality=low', exp: 'stillwater', hours: ['Moonlit', 'Day'], on: 'Day' },
];

for (const c of CASES) {
  const { page, context, errors, failed } = await open(c.q);
  const label = c.q || '(bare)';
  const exp = await page.evaluate(() => document.documentElement.dataset.experience);
  const mode = await page.evaluate(() => (window.__mode ? window.__mode() : null));
  const hrs = await words(page, '.hours .hour');
  const paths = await words(page, '.paths .path');

  ok(`${label} · boots ${c.exp}`, exp === c.exp, `got ${exp}`);
  ok(`${label} · offers ${c.hours.join(' / ')}`,
    hrs.map((h) => h.label).join(',') === c.hours.join(','), hrs.map((h) => h.label).join(','));
  ok(`${label} · ${c.on} is the chosen hour`,
    hrs.some((h) => h.label === c.on && h.current),
    hrs.map((h) => `${h.label}${h.current ? '*' : ''}`).join(','));
  ok(`${label} · both meditations are offered and neither is disabled`,
    paths.length === 2 && paths.every((p) => !p.disabled));
  if (c.exp === 'stillwater') {
    ok(`${label} · window.__mode agrees`, mode === (c.on === 'Day' ? 'day' : 'moonlit'), String(mode));
  }
  ok(`${label} · no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  ok(`${label} · no failed requests`, failed.length === 0, failed.slice(0, 2).join(' | '));
  await context.close();
}

/* ── clicking a selector goes where it says ───────────────────────────────── */

async function click(q, sel, expectQuery) {
  const { page, context, errors } = await open(q);
  // the choice fades for 620 ms before it replaces the location, and the
  // destination then has to compile its shaders, so wait for the navigation
  // itself rather than guessing at a duration
  await Promise.all([
    page.waitForURL((u) => u.search.replace(/^\?/, '') === expectQuery, { timeout: 60000 })
      .catch(() => {}),
    page.click(sel),
  ]);
  await page.waitForLoadState('load').catch(() => {});
  const url = new URL(page.url());
  const got = url.search.replace(/^\?/, '');
  ok(`click ${sel} from "${q || '(bare)'}" → "${expectQuery}"`, got === expectQuery, `got "${got}"`);
  ok(`  …and the destination has no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

console.log('');
// Still Water: moonlit → day and back
await click('experience=stillwater', '.hours .hour[data-pick="day"]', 'experience=stillwater&mode=day');
await click('experience=stillwater&mode=day', '.hours .hour[data-pick="moonlit"]', 'experience=stillwater');
// the testing override outlives the choice; the hour does not outlive the meditation
await click('experience=stillwater&quality=low', '.hours .hour[data-pick="day"]', 'experience=stillwater&quality=low&mode=day');
await click('experience=stillwater&mode=day', '.paths .path[data-pick="ascent"]', '');
await click('mode=dusk', '.paths .path[data-pick="stillwater"]', 'experience=stillwater');

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
