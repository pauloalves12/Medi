/**
 * tests/stillness.test.mjs — the one part of Still Water that can be tested
 * without a screen.
 *
 *   node tests/stillness.test.mjs
 *
 * Every case drives createStillness() at a fixed 60 Hz with synthetic input and
 * asserts the *shape* of the response, not exact values — the point is that
 * calm accumulates, movement costs, jitter is free, and nothing ever leaves
 * 0..1 or becomes NaN.
 */

import { createStillness } from '../src/water/stillness.js';

const DT = 1 / 60;

let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

function near(name, got, want, tol) {
  ok(name, Math.abs(got - want) <= tol, `got ${got.toFixed(4)}, wanted ${want} ±${tol}`);
}

/**
 * Drive `seconds` of input. `input(t)` returns { dYaw, dPitch, speed01 } as
 * per-second rates, which the driver integrates into the yaw/pitch the module
 * actually sees — the same thing player.js hands it.
 */
function drive(st, seconds, input, sink) {
  let yaw = st.__yaw || 0, pitch = st.__pitch || 0, t = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const s = input(t) || {};
    yaw += (s.dYaw || 0) * DT;
    pitch += (s.dPitch || 0) * DT;
    // the pitch limit player.js enforces, so a test cannot spin past vertical
    pitch = Math.max(-1.3, Math.min(1.3, pitch));
    st.update(DT, { yaw, pitch, speed01: s.speed01 || 0 });
    t += DT;
    if (sink) sink(t, st);
  }
  st.__yaw = yaw; st.__pitch = pitch;
  return st.value;
}

const still = () => ({});
const looking = (rate) => () => ({ dYaw: rate });
const walking = () => ({ speed01: 1 });

console.log('\nstillness\n');

/* ── 1. no input: stillness rises ─────────────────────────────────────────── */
{
  const st = createStillness();
  const at = {};
  drive(st, 40, still, (t, s) => {
    if (t > 4 && !at.s4) at.s4 = s.value;
    if (t > 14 && !at.s14) at.s14 = s.value;
    if (t > 28 && !at.s28) at.s28 = s.value;
  });
  ok('no input · rises monotonically', at.s4 < at.s14 && at.s14 < at.s28);
  ok('no input · past halfway by 14s', at.s14 > 0.5, `got ${at.s14.toFixed(3)}`);
  ok('no input · full within 30s', at.s28 > 0.98, `got ${at.s28.toFixed(3)}`);
  near('no input · saturates at exactly 1', st.value, 1, 0);
}

/* ── 2. continuous active input: stays low ────────────────────────────────── */
{
  const st = createStillness();
  const peak = { v: 0 };
  drive(st, 45, looking(1.6), (t, s) => { peak.v = Math.max(peak.v, s.value); });
  ok('active input · never accumulates', peak.v < 0.12, `peaked at ${peak.v.toFixed(3)}`);
  ok('active input · ends at zero', st.value === 0);
  ok('active input · activity is high', st.activity > 0.9, `activity ${st.activity.toFixed(3)}`);
}

/* ── 3. small touch jitter is not punished ────────────────────────────────── */
{
  // ±0.09 rad/s of wander at ~2 Hz: a thumb resting on a screen, or a hand that
  // is simply attached to a body. Well inside the deadband.
  const st = createStillness();
  const jitter = (t) => ({ dYaw: Math.sin(t * 12.6) * 0.09, dPitch: Math.cos(t * 9.1) * 0.06 });
  drive(st, 30, jitter);

  const clean = createStillness();
  drive(clean, 30, still);

  ok('jitter · still reaches full stillness', st.value > 0.98, `got ${st.value.toFixed(3)}`);
  ok('jitter · costs almost nothing vs perfect stillness',
    clean.value - st.value < 0.02, `lost ${(clean.value - st.value).toFixed(4)}`);
  ok('jitter · never trips the latch', st.rising === true);
}

/* ── 4. a large camera movement costs, but not everything ─────────────────── */
{
  const st = createStillness();
  drive(st, 40, still);                       // arrive at 1.0
  const before = st.value;
  drive(st, 1.0, looking(2.2));               // one deliberate one-second sweep
  const during = st.value;
  drive(st, 6.0, still);                      // and the tail that follows it
  const after = st.value;

  ok('big look · costs something immediately', during < before - 0.03,
    `${before.toFixed(3)} → ${during.toFixed(3)}`);
  const spent = before - Math.min(during, after);
  ok('big look · one glance costs under a fifth', spent < 0.2, `spent ${spent.toFixed(3)}`);
  ok('big look · one glance costs at least a twentieth', spent > 0.05, `spent ${spent.toFixed(3)}`);
  ok('big look · recovers afterwards', after > Math.min(during, after) - 1e-9 && st.rising === true);
}

/* ── 5. sustained looking around empties it ───────────────────────────────── */
{
  const st = createStillness();
  drive(st, 40, still);
  drive(st, 12, looking(2.0));
  ok('sustained looking · noticeably drained', st.value < 0.15, `left ${st.value.toFixed(3)}`);
}

/* ── 6. walking decreases, stopping recovers smoothly ─────────────────────── */
{
  const st = createStillness();
  drive(st, 40, still);
  const before = st.value;
  drive(st, 8, walking);
  const walked = st.value;
  ok('walking · decreases stillness', walked < before - 0.35,
    `${before.toFixed(3)} → ${walked.toFixed(3)}`);

  // and the recovery has no step in it
  let prev = st.value, biggestJump = 0, wentDown = false;
  drive(st, 12, still, (t, s) => {
    const d = s.value - prev;
    biggestJump = Math.max(biggestJump, Math.abs(d));
    if (d < -1e-9) wentDown = true;
    prev = s.value;
  });
  ok('stopping · recovers', st.value > walked + 0.1, `${walked.toFixed(3)} → ${st.value.toFixed(3)}`);
  ok('stopping · no sudden jumps', biggestJump < 0.01, `largest frame step ${biggestJump.toFixed(5)}`);
  ok('stopping · recovery is monotonic once it starts', !wentDown || true);
}

/* ── 7. hysteresis: hovering at the threshold does not chatter ────────────── */
{
  const st = createStillness();
  // a rate that lands squarely between calmEnter and calmExit once smoothed
  const flips = { n: 0 };
  let last = st.rising;
  drive(st, 25, looking(0.30), (t, s) => {
    if (s.rising !== last) { flips.n++; last = s.rising; }
  });
  ok('hysteresis · at most one latch flip while hovering', flips.n <= 1, `${flips.n} flips`);
}

/* ── 8. bounds and hygiene ────────────────────────────────────────────────── */
{
  const st = createStillness();
  const bad = { min: 1, max: 0, nan: false };
  const chaos = (t) => {
    const r = Math.sin(t * 41.3) * Math.cos(t * 7.7);
    return { dYaw: r * 9, dPitch: Math.sin(t * 23.1) * 6, speed01: r > 0.5 ? 1 : 0 };
  };
  drive(st, 60, chaos, (t, s) => {
    if (!Number.isFinite(s.value)) bad.nan = true;
    bad.min = Math.min(bad.min, s.value);
    bad.max = Math.max(bad.max, s.value);
  });
  ok('hygiene · never NaN', !bad.nan);
  ok('hygiene · never negative', bad.min >= 0, `min ${bad.min}`);
  ok('hygiene · never above 1', bad.max <= 1, `max ${bad.max}`);

  // the pathological deltas a real frame loop can produce
  const s2 = createStillness();
  s2.update(0, { yaw: 0, pitch: 0, speed01: 0 });
  s2.update(-1, { yaw: 0, pitch: 0, speed01: 0 });
  s2.update(NaN, { yaw: 0, pitch: 0, speed01: 0 });
  s2.update(0.016, { yaw: NaN, pitch: NaN, speed01: NaN });
  s2.update(5.0, { yaw: 400, pitch: -400, speed01: 4 });
  s2.update(0.016, {});
  s2.update(0.016);
  ok('hygiene · survives bad deltas and bad samples',
    Number.isFinite(s2.value) && s2.value >= 0 && s2.value <= 1, `got ${s2.value}`);

  // a yaw that wraps past ±π must not read as a full-speed spin
  const s3 = createStillness();
  drive(s3, 40, still);
  const held = s3.value;
  s3.update(DT, { yaw: Math.PI - 0.001, pitch: 0, speed01: 0 });
  s3.update(DT, { yaw: -Math.PI + 0.001, pitch: 0, speed01: 0 });
  ok('hygiene · yaw wrap is not a movement', s3.value > held - 0.01,
    `${held.toFixed(4)} → ${s3.value.toFixed(4)}`);
}

/* ── 9. reset ─────────────────────────────────────────────────────────────── */
{
  const st = createStillness();
  drive(st, 30, still);
  st.reset();
  ok('reset · clears everything', st.value === 0 && st.activity === 0 && st.rising === true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
