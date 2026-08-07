/**
 * flow.js — the shape of the meditation.
 * @see water/main.js MODULE CONTRACT
 *
 * The phase machine, the arrival, the five breaths, and the ending. It owns no
 * visuals: it moves the player, spawns ripples, writes lines and advances the
 * phase, and everything else reads the result off the shared state.
 *
 * ── NOTHING CAN FAIL AND NOTHING CAN STICK ───────────────────────────────────
 * Every phase leaves on `enough stillness` OR `enough time`, whichever comes
 * first, so a calm player is answered quickly and a restless one is simply
 * waited for. Nothing is ever restarted, no breath is ever lost, and there is
 * no state the piece cannot leave.
 *
 * The one thing time alone does not buy is the payoff. `settleFloor` is a floor
 * under the settle, and it stays at zero for the whole middle of the piece —
 * only during the last long wait does it begin to creep, and only during the
 * final reveal does it climb to one. So the clear water is earned by being
 * still nearly every time it is seen, and merely arrived at by the person who
 * never was.
 */

import * as THREE from 'three';

/* ── the walk ─────────────────────────────────────────────────────────────── */

const ARRIVE_R = 2.6;             // m — how near the stone counts as arriving
const APPROACH_NUDGE = 50;        // s — one line, if the way down is not obvious
const APPROACH_LIMIT = 96;        // s — after which the shore comes to them

const SHORE_GLIDE = 1.8;          // s onto the stone
const SHORE_SECONDS = 7.0;

/* ── the middle ───────────────────────────────────────────────────────────── */

const SETTLING_MIN = 26, SETTLING_MAX = 46, SETTLING_STILL = 0.30;

const INHALE = 4.5, HOLD = 1.0, EXHALE = 6.0, REST = 1.5;
const CYCLE = INHALE + HOLD + EXHALE + REST;      // 13s × 5 = 65s
const BREATHS = 5;

const REFLECT_MIN = 55, REFLECT_MAX = 132, REFLECT_STILL = 0.70;
const STILL_MIN = 26, STILL_MAX = 74, STILL_DEEP = 0.90;

/* ── the ending ───────────────────────────────────────────────────────────── */

const REVEAL_SECONDS = 30;
const REVEAL_GLIDE = 2.1;         // s of authored drift onto the composition
const REVEAL_FLOOR = 16;          // s for the floor to reach one

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export function createFlow({ env, player, ui, audio, lake, state, advance }) {
  const anchors = env.anchors;

  const standAt = anchors.stand.clone();
  // A hand's width forward of the standing point, so the ending has somewhere
  // to drift to. The composition is made by the look, not by the metre.
  const revealAt = anchors.stand.clone();
  revealAt.z -= 0.55;

  const _v = new THREE.Vector3();

  let phase = state.phase;
  let pt = 0;

  let nudged = false;
  let breathIndex = 0, breathT = 0, lastSegment = -1;
  let lookWeight = 0, lookTarget = null;
  let revealCue = false;

  /* ── phase entry ────────────────────────────────────────────────────────── */

  function onEnter(p) {
    pt = 0;
    if (p !== 'breathing') state.breathOpen = 0;

    if (p === 'shore') {
      // Not a cut and not a teleport: the last two metres are walked for them,
      // onto the one spot the rest of the piece is composed from.
      player.beginCinematic(standAt, SHORE_GLIDE);
      player.setWalk(false);
      lookTarget = anchors.lake;
      ui.setPrompt(null);
      ui.setSubtitle('Let the water settle.', 7);
    }

    if (p === 'settling') {
      lookTarget = null;
    }

    if (p === 'breathing') {
      breathIndex = 0; breathT = 0; lastSegment = -1;
    }

    if (p === 'reflection') {
      ui.setWhisper(null);
      ui.setSubtitle('Nothing needs to move.', 8);
    }

    if (p === 'stillness') {
      ui.setSubtitle(null);
    }

    if (p === 'reveal') {
      // The one authored move of the whole piece. Ascent learned this the hard
      // way: the payoff cannot depend on where the player happened to be
      // looking, and it also cannot be taken from them with a cut.
      player.beginCinematic(revealAt, REVEAL_GLIDE);
      player.setWalk(false);
      lookTarget = anchors.compose;
      revealCue = false;
    }

    if (p === 'complete') {
      ui.setWhisper(null);
      ui.setSubtitle(null);
    }
  }

  /* ── the walk down ──────────────────────────────────────────────────────── */

  function tickApproach(dt) {
    _v.copy(player.position);
    const d = Math.hypot(_v.x - standAt.x, _v.z - standAt.z);

    if (d < ARRIVE_R) { advance('shore'); return; }

    if (!nudged && pt > APPROACH_NUDGE) {
      nudged = true;
      ui.setSubtitle('Down, through the pines.', 6);
    }

    // Nobody is ever left on the path. After a minute and a half the shore
    // simply arrives, which is a slower version of what walking would have done.
    if (pt > APPROACH_LIMIT) advance('shore');
  }

  /* ── the five breaths ───────────────────────────────────────────────────────
   * There is no orb. The instruction is a ring opening out of the reflected
   * moon and closing again, and the two words are quiet enough to ignore once
   * the rhythm is legible.
   *
   * Looking around during this costs stillness, like it costs stillness
   * everywhere else — the water answers with a rougher surface and that is the
   * entire consequence. A breath is never lost and a cycle is never restarted.
   * ────────────────────────────────────────────────────────────────────────── */

  function tickBreathing(dt) {
    if (breathIndex >= BREATHS) {
      // one held beat after the fifth exhale, then out
      if (breathT > REST + 3.0) advance('reflection');
      breathT += dt;
      state.breathOpen = 0;
      ui.setWhisper(null);
      return;
    }

    breathT += dt;
    if (breathT >= CYCLE) { breathT -= CYCLE; breathIndex++; lastSegment = -1; if (breathIndex >= BREATHS) { breathT = 0; return; } }

    let seg, open, word;
    if (breathT < INHALE) {
      seg = 0;
      open = smoothstep(0, 1, breathT / INHALE);
      word = 'breathe in';
    } else if (breathT < INHALE + HOLD) {
      seg = 1; open = 1; word = '';
    } else if (breathT < INHALE + HOLD + EXHALE) {
      seg = 2;
      open = 1 - smoothstep(0, 1, (breathT - INHALE - HOLD) / EXHALE);
      word = 'breathe out';
    } else {
      seg = 3; open = 0; word = '';
    }

    state.breathOpen = open;
    ui.setWhisper(word);

    if (seg !== lastSegment) {
      lastSegment = seg;
      if (seg === 0) {
        // the ring opens with the inhale, out of the moon's own reflection
        lake.pulse(0.85 + 0.15 * (breathIndex / BREATHS));
        audio.breathCue('inhale');
      } else if (seg === 2) {
        audio.breathCue('exhale');
      }
    }
  }

  /* ── the ending ─────────────────────────────────────────────────────────── */

  function tickReveal(dt) {
    // The world clears on its own curve now, floored so that the last of it
    // arrives for everybody. A player who has been still for four minutes is
    // already at the top of this and will not see it move.
    state.settleFloor = smoothstep(0, REVEAL_FLOOR, pt);

    if (!revealCue && pt > 1.2) {
      revealCue = true;
      audio.open();
    }

    if (pt >= REVEAL_SECONDS) advance('complete');
  }

  /* ── the patience floor ─────────────────────────────────────────────────────
   * Only ever consulted in the long wait before the ending, and it climbs
   * slowly enough that being still is always the faster way there. Its whole
   * job is to make sure a restless player is still shown a lake that is
   * quieter than the one they arrived at.
   * ────────────────────────────────────────────────────────────────────────── */

  function patience(p, t) {
    if (p === 'reflection') return smoothstep(80, 130, t) * 0.45;
    if (p === 'stillness') return 0.45 + smoothstep(34, 72, t) * 0.30;
    return 0;
  }

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt) {
    if (state.phase !== phase) { phase = state.phase; onEnter(phase); }
    pt += dt;

    const still = state.stillness;

    switch (phase) {
      case 'approach':
        tickApproach(dt);
        break;

      case 'shore':
        // the gaze is drawn out over the water while the glide finishes
        if (pt > SHORE_SECONDS) advance('settling');
        break;

      case 'settling':
        // Nothing is explained here. This is the fifteen to thirty seconds in
        // which the lake answers being left alone, and the player finds that
        // out by being left alone with it.
        if ((pt > SETTLING_MIN && still > SETTLING_STILL) || pt > SETTLING_MAX) {
          advance('breathing');
        }
        break;

      case 'breathing':
        tickBreathing(dt);
        break;

      case 'reflection':
        state.settleFloor = patience(phase, pt);
        if ((pt > REFLECT_MIN && still > REFLECT_STILL) || pt > REFLECT_MAX) {
          advance('stillness');
        }
        break;

      case 'stillness':
        state.settleFloor = patience(phase, pt);
        if ((pt > STILL_MIN && still > STILL_DEEP) || pt > STILL_MAX) {
          advance('reveal');
        }
        break;

      case 'reveal':
        tickReveal(dt);
        break;

      default:
        break;
    }

    /* ── the assisted gaze ────────────────────────────────────────────────────
     * Used exactly twice: over the water on arrival, and onto the composition
     * at the end. Both ease in and then ease most of the way back out, so the
     * frame is made for the player without ever being taken from them.
     * ────────────────────────────────────────────────────────────────────── */

    let want = 0;
    if (phase === 'shore') want = 0.55 * smoothstep(0.2, 1.6, pt) * (1 - smoothstep(4.0, 6.6, pt));
    else if (phase === 'reveal') {
      want = 0.62 * smoothstep(0.1, REVEAL_GLIDE, pt);
      want *= 1 - 0.68 * smoothstep(REVEAL_GLIDE, REVEAL_GLIDE + 4.5, pt);
    }
    lookWeight += (want - lookWeight) * (1 - Math.exp(-dt / 0.6));
    if (lookTarget && lookWeight > 0.004) player.lookAtPoint(lookTarget, lookWeight);
    else player.lookAtPoint(null, 0);
  }

  return { update };
}
