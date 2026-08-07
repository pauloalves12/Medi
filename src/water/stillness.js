/**
 * stillness.js — how still the person holding the phone is being.
 *
 * One number, 0..1, and the only thing in Still Water that reads the player's
 * behaviour. It imports nothing and touches no scene, which is what makes it
 * testable: tests/stillness.test.mjs drives it with synthetic input and checks
 * the shape of the curve rather than the look of the lake.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 * Not a combo meter. A meter resets, and a meter that resets teaches you to
 * hold your breath and freeze, which is the opposite of the thing. Four
 * decisions keep it from behaving like one:
 *
 *   1. A deadband.  Below `jitterRate` of angular drift nothing is counted at
 *      all. A thumb resting on a screen moves; a hand holding a phone moves;
 *      neither is looking around.
 *   2. Smoothing.   The raw rate is low-passed before it is judged, so a single
 *      frame of a fat pointer event batch cannot spike it.
 *   3. Asymmetry.   Disturbance arrives fast and leaves slowly (`attackTau` vs
 *      `releaseTau`), so the *world* keeps moving for a moment after you stop —
 *      water has inertia and should look like it.
 *   4. Hysteresis.  Rising and falling are a latched state with two different
 *      thresholds. Between them nothing changes direction, so hovering near the
 *      edge does not chatter between settling and un-settling.
 *
 * ── THE NUMBERS ──────────────────────────────────────────────────────────────
 * Calm from nothing to full takes about 28 seconds. Ten seconds of continuous
 * looking around spends all of it. A single one-second glance costs about a
 * tenth, tail included — enough to see the water answer, nowhere near enough to
 * feel like a punishment.
 */

export const DEFAULTS = {
  jitterRate: 0.16,   // rad/s — angular drift that costs nothing at all (~9°/s)
  lookFull: 1.25,     // rad/s — a deliberate look sweep (~72°/s)
  walkWeight: 0.85,   // what full walking speed counts as, on its own
  rateClamp: 12.0,    // rad/s — nothing real is faster; caps authored snaps

  angTau: 0.30,       // s — low-pass on the raw angular rate
  attackTau: 0.22,    // s — disturbance arrives
  releaseTau: 1.70,   // s — and leaves, slowly

  calmEnter: 0.075,   // activity below this: settling resumes
  calmExit: 0.185,    // activity above this: settling stops

  riseSeconds: 24,    // base seconds for the whole climb
  riseEase: 0.45,     // how much the last of it slows down
  fallRate: 0.10,     // per second, at full activity
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function shortestAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function createStillness(opts) {
  const P = Object.assign({}, DEFAULTS, opts || {});
  const lookSpan = Math.max(1e-3, P.lookFull - P.jitterRate);

  let value = 0;        // the stillness itself
  let activity = 0;     // recent disturbance, 0..1 — what the world reads
  let angSmooth = 0;    // low-passed angular rate, rad/s
  let rising = true;    // the latch
  let lastYaw = 0, lastPitch = 0, hasLast = false;

  /**
   * @param dt      seconds
   * @param sample  { yaw, pitch, speed01 } — radians and 0..1
   * @returns the stillness, 0..1
   */
  function update(dt, sample) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 0;
    // A tab that was in the background hands back one enormous delta. Treating
    // it as real time would either drain everything or grant everything.
    if (dt > 0.1) dt = 0.1;

    const s = sample || {};
    const yaw = Number.isFinite(s.yaw) ? s.yaw : lastYaw;
    const pitch = Number.isFinite(s.pitch) ? s.pitch : lastPitch;
    const speed01 = clamp01(Number.isFinite(s.speed01) ? s.speed01 : 0);

    /* ── how fast the view is turning ─────────────────────────────────────── */

    let rate = 0;
    if (hasLast && dt > 0) {
      const dy = shortestAngle(yaw - lastYaw);
      const dp = pitch - lastPitch;
      rate = Math.hypot(dy, dp) / dt;
      if (!Number.isFinite(rate)) rate = 0;
      if (rate > P.rateClamp) rate = P.rateClamp;
    }
    lastYaw = yaw; lastPitch = pitch; hasLast = true;

    const angK = 1 - Math.exp(-dt / P.angTau);
    angSmooth += (rate - angSmooth) * angK;

    /* ── what that adds up to ─────────────────────────────────────────────── */

    const look01 = clamp01((angSmooth - P.jitterRate) / lookSpan);
    const raw = clamp01(look01 + speed01 * P.walkWeight);

    const tau = raw > activity ? P.attackTau : P.releaseTau;
    activity += (raw - activity) * (1 - Math.exp(-dt / tau));
    activity = clamp01(activity);

    /* ── the latch ────────────────────────────────────────────────────────── */

    if (activity > P.calmExit) rising = false;
    else if (activity < P.calmEnter) rising = true;

    if (rising) {
      // The climb eases off toward the top: the last of the stillness is the
      // part that has to be sat through rather than arrived at.
      value += (dt / P.riseSeconds) * (1 + P.riseEase - P.riseEase * value);
    } else {
      value -= dt * P.fallRate * activity;
    }

    if (!Number.isFinite(value)) value = 0;
    value = clamp01(value);
    return value;
  }

  return {
    update,
    get value() { return value; },
    get activity() { return activity; },
    get rising() { return rising; },
    get rate() { return angSmooth; },
    reset() {
      value = 0; activity = 0; angSmooth = 0; rising = true; hasLast = false;
    },
    params: P,
  };
}
