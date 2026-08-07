import * as THREE from 'three';

/**
 * interactions.js — the interaction language and the phase choreography.
 * @see main.js LOCKED MODULE CONTRACT
 *
 * One grammar for everything: proximity + gaze + one deliberate hold.
 * No crosshair, no clicking small things, no way to soft-lock.
 */

const HOLD_TIME = 1.1;          // s — deliberate, not a click
const HOLD_DECAY = 0.28;        // s — how fast an abandoned hold unwinds

const PATH_GLOW_SECONDS = 3.0;

// breathing: 4.5 + 1.5 + 6.5 + 2.0 = 14.5s × 5 = 72.5s
const INHALE = 4.5, HOLD_B = 1.5, EXHALE = 6.5, REST = 2.0;
const CYCLE = INHALE + HOLD_B + EXHALE + REST;

const BELL_TURN = 4.0;          // s to be turned toward the valley
const SETTLE_SECONDS = 2.1;     // s to glide onto the authored dawn overlook

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
function smootherstep(t) {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function createInteractions({ camera, env, player, ui, audio, state, advance, ctx }) {
  const anchors = env.anchors;

  /* ── the three focus targets ────────────────────────────────────────────── */

  // The bell hangs inside a four-post shrine, so the places you can physically
  // stand and still see it are fewer than for the lantern or the orb — it needs
  // the most reach, not the least.
  const TARGETS = {
    lantern:  { point: anchors.lantern, label: 'Light the lantern',    reach: 3.0 },
    toOrb:    { point: anchors.orb,     label: 'Breathe with the light', reach: 3.2 },
    toShrine: { point: anchors.bell,    label: 'Ring the bell',        reach: 3.4 },
  };

  /* ── orb → screen, for anchoring the breath guide ───────────────────────── */

  const orbWorld = new THREE.Vector3();
  const orbProj = new THREE.Vector3();
  const breathAnchor = { x: 0.5, y: 0.5 };

  function orbScreen(out) {
    env.orb.getWorldPosition(orbWorld);
    orbProj.copy(orbWorld).project(camera);
    // Behind the camera, w flips the projection — fall back to centre.
    if (orbProj.z > 1) { out.x = 0.5; out.y = 0.5; return out; }
    out.x = orbProj.x * 0.5 + 0.5;
    out.y = -orbProj.y * 0.5 + 0.5;
    return out;
  }

  /* ── input: a single confirm hold ───────────────────────────────────────── */

  let holdDown = false;      // physical input held
  let holdT = 0;             // 0..HOLD_TIME
  let consumed = false;      // fired; needs a release before re-arming
  let touchHoldId = null, touchHoldX = 0, touchHoldY = 0;

  function pressDown() { if (!consumed) holdDown = true; }
  function pressUp() { holdDown = false; consumed = false; }
  function cancelHold() { holdDown = false; touchHoldId = null; }

  function onKeyDown(e) {
    if (e.code !== 'Space') return;
    // never steal Space from a focused affordance (Begin / Again)
    const t = e.target;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.isContentEditable)) return;
    e.preventDefault();
    if (!e.repeat) pressDown();
  }
  function onKeyUp(e) { if (e.code === 'Space') pressUp(); }
  function onMouseDown(e) {
    if (e.button !== 0) return;
    // never on the title / completion affordances
    const t = e.target;
    if (t && t.closest && t.closest('button')) return;
    // A click made purely to recapture the cursor should not also start a hold.
    if (!player.locked) return;
    pressDown();
  }
  function onMouseUp(e) { if (e.button === 0) pressUp(); }

  // A held thumb wanders: a resting hand drifts, and the same finger is also the
  // look control, so the frame is moving under it. 16px was inside the noise of
  // an outstretched thumb on a phone — a hold could die from a tremor. This is
  // still far short of the sweep a deliberate look drag makes.
  const HOLD_SLOP = 34;      // px

  function onHoldDown(e) {
    if (e.pointerType === 'mouse') return;
    if (e.clientX < window.innerWidth * 0.5) return;
    // The newest thumb in the look half owns the hold. Nothing else can be
    // holding it that we still care about, and refusing to re-arm on a stale id
    // is exactly how the hold used to become permanently unavailable.
    touchHoldId = e.pointerId; touchHoldX = e.clientX; touchHoldY = e.clientY;
    pressDown();
  }
  function onHoldMove(e) {
    if (e.pointerId !== touchHoldId) return;
    if (Math.hypot(e.clientX - touchHoldX, e.clientY - touchHoldY) > HOLD_SLOP) {
      touchHoldId = null; holdDown = false;   // it was a look drag, not a hold
    }
  }
  function onHoldEnd(e) {
    if (e.pointerId !== touchHoldId) return;
    touchHoldId = null;
    pressUp();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('pointerdown', onHoldDown);
  window.addEventListener('pointermove', onHoldMove);
  window.addEventListener('pointerup', onHoldEnd);
  window.addEventListener('pointercancel', onHoldEnd);
  window.addEventListener('lostpointercapture', onHoldEnd);
  window.addEventListener('blur', cancelHold);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelHold(); });

  /* ── scratch ────────────────────────────────────────────────────────────── */

  const fwd = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const valley = new THREE.Vector3();
  const valleyDrift = new THREE.Vector3();
  const lastPos = new THREE.Vector3().copy(player.position);

  /* ── per-phase memory ───────────────────────────────────────────────────── */

  let phase = state.phase;
  let pt = 0;                 // time in phase (our own, independent of main)
  let walked = 0;

  let glowRamp = -1;          // >=0 while the path glow is revealing
  let saidFollow = false, orbWoken = false, saidValley = false;
  let breathCycles = 0, breathT = 0, lastBreathSeg = -1, breathDone = false;
  let endingCue = 0;

  valley.copy(anchors.shrineView).add(new THREE.Vector3(0, -2, -60));

  // Where the dawn is watched from. A little short of the overlook anchor: far
  // enough past the shrine's stone base that no post, beam or roof edge is in
  // front of the valley, close enough that the ground still carries the bottom
  // of the frame instead of dropping straight into cloud.
  const settleView = anchors.shrineView.clone();
  settleView.z += 1.1;

  // The bell hangs at eye height on the line a lot of people will walk out
  // along: ring it from the near side and a straight glide to the overlook goes
  // through the bronze. Bowing the curve away from the bell clears it from every
  // position you can ring from, and reads as stepping around the bell rather
  // than avoiding it. It does not clear the four uprights from every position —
  // see the note in README on what is left.
  const SETTLE_BOW = 1.2;       // m of control-point offset; the curve takes half
  const via = new THREE.Vector3();

  function settleVia() {
    const sx = player.position.x, sz = player.position.z;
    const dx = settleView.x - sx, dz = settleView.z - sz;
    const len = Math.hypot(dx, dz);
    const mx = (sx + settleView.x) * 0.5, mz = (sz + settleView.z) * 0.5;
    if (len < 0.01) { via.set(mx, settleView.y, mz); return via; }
    let nx = -dz / len, nz = dx / len;
    if ((mx - anchors.bell.x) * nx + (mz - anchors.bell.z) * nz < 0) { nx = -nx; nz = -nz; }
    via.set(mx + nx * SETTLE_BOW, settleView.y, mz + nz * SETTLE_BOW);
    return via;
  }

  function onEnterPhase(p) {
    pt = 0;
    holdDown = false; holdT = 0; consumed = false;
    if (p === 'breathing') {
      player.setSpeedScale(0.35);
      breathCycles = 0; breathT = 0; lastBreathSeg = -1; breathDone = false;
    } else {
      player.setSpeedScale(1);
    }
    if (p === 'toOrb') { walked = 0; lastPos.copy(player.position); }
    if (p === 'bell') {
      env.strikeBell(1.0);
      audio.bell(1.0);
      state.bellRung = true;
      ui.setPrompt(null);
      // You can ring the bell from anywhere you can reach it, including from
      // behind a post with the whole shrine between you and the valley. The
      // dawn is the payoff for the entire walk, so it is composed from one
      // authored overlook rather than from wherever the strike happened to
      // land — a slow settle onto the ledge, not a cut.
      player.beginCinematic(settleView, SETTLE_SECONDS, settleVia());
    }
    if (p === 'ending') {
      player.setEnabled(false);
      endingCue = 0;
      ui.setPrompt(null);
    }
  }

  /* ── focus: proximity × gaze ────────────────────────────────────────────── */

  let focus = 0, actionable = false;

  // How wide the "looking at it" cone is. Close things subtend a big angle, so
  // the tolerance opens as you approach — glancing at a lantern an arm's length
  // away should count, while a distant one still has to be picked out.
  const GAZE_BASE = 0.40;      // rad — ~23° of slack at any range
  const GAZE_SIZE = 1.15;      // m — the apparent radius we treat targets as having

  // Once a hold is genuinely under way the thresholds widen a little. Acquiring
  // the target still takes deliberate aim; keeping it does not, so a thumb that
  // drifts a few degrees mid-hold no longer throws the whole hold away.
  const ENGAGED_REACH = 1.18;
  const GAZE_MIN = 0.45, GAZE_MIN_ENGAGED = 0.30;

  function evaluateTarget(cfg, engaged) {
    const p = cfg.point;
    const dx = p.x - camera.position.x, dz = p.z - camera.position.z;
    const dist = Math.hypot(dx, dz);

    camera.getWorldDirection(fwd);
    toTarget.copy(p).sub(camera.position);
    const len = toTarget.length();
    let gaze = 0;
    if (len > 1e-4) {
      toTarget.multiplyScalar(1 / len);
      let d = fwd.dot(toTarget);
      if (d > 1) d = 1; else if (d < -1) d = -1;
      const off = Math.acos(d);
      const tol = GAZE_BASE + Math.atan2(GAZE_SIZE, Math.max(len, 0.5));
      gaze = smoothstep(tol, tol * 0.42, off);
    }

    const prox = smoothstep(cfg.reach + 4.2, cfg.reach * 0.85, dist);
    focus = prox * gaze;
    const reach = engaged ? cfg.reach * ENGAGED_REACH : cfg.reach;
    actionable = dist <= reach && gaze > (engaged ? GAZE_MIN_ENGAGED : GAZE_MIN);
    return focus;
  }

  function tickHold(dt, onFire) {
    if (holdDown && actionable) {
      holdT += dt;
      if (holdT >= HOLD_TIME) {
        holdT = 0; holdDown = false; consumed = true;
        onFire();
        return true;
      }
    } else if (holdT > 0) {
      holdT = Math.max(0, holdT - dt * (HOLD_TIME / HOLD_DECAY));
    }
    return false;
  }

  function prompt(text, progress, fade) {
    // ui.js caches its own DOM writes; this stays allocation-free.
    ui.setPrompt(text, progress || 0, fade === undefined ? 1 : fade);
  }

  /* ── the breathing curve ────────────────────────────────────────────────── */

  // reused every frame — no allocation in the loop
  const breath = { scale: 0, glow: 0, label: null, seg: 3 };

  function breathAt(t) {
    if (t < INHALE) {
      const s = smootherstep(t / INHALE);
      breath.scale = s; breath.glow = 0.14 + 0.86 * s;
      breath.label = 'Breathe in'; breath.seg = 0;
    } else if (t < INHALE + HOLD_B) {
      breath.scale = 1; breath.glow = 1;
      breath.label = 'Hold'; breath.seg = 1;
    } else if (t < INHALE + HOLD_B + EXHALE) {
      const u = (t - INHALE - HOLD_B) / EXHALE;
      // time-warped so the release starts heavy and settles slowly
      const w = Math.pow(u, 0.86);
      const s = 1 - w * w * (3 - 2 * w);
      breath.scale = s; breath.glow = 0.10 + 0.90 * Math.pow(s, 0.75);
      breath.label = 'Breathe out'; breath.seg = 2;
    } else {
      breath.scale = 0; breath.glow = 0.10;
      breath.label = null; breath.seg = 3;
    }
    return breath;
  }

  /* ── main update ────────────────────────────────────────────────────────── */

  function update(dt) {
    if (state.phase !== phase) { phase = state.phase; onEnterPhase(phase); }
    pt += dt;

    // path glow reveal runs across phase boundaries
    if (glowRamp >= 0) {
      glowRamp += dt;
      const g = clamp01(glowRamp / PATH_GLOW_SECONDS);
      state.pathGlow = g * g * (3 - 2 * g);
      env.setPathGlow(state.pathGlow);
      if (glowRamp >= PATH_GLOW_SECONDS) glowRamp = -1;
    }

    switch (phase) {

      case 'title':
        prompt(null);
        break;

      /* ── light the lantern ── */
      case 'lantern': {
        const f = evaluateTarget(TARGETS.lantern, holdT > 0);
        const fired = tickHold(dt, () => {
          state.lanternLit = true;
          env.setLanternLit(true);
          audio.lanternLight();
          glowRamp = 0;
          ui.setPrompt(null);
          ui.setSubtitle('The path remembers the way.', 6);
          advance('toOrb');
        });
        if (!fired) prompt(TARGETS.lantern.label, holdT / HOLD_TIME, f);
        break;
      }

      /* ── walk to the orb ── */
      case 'toOrb': {
        walked += lastPos.distanceTo(player.position);
        lastPos.copy(player.position);

        if (!saidFollow && (walked > 5 || pt > 11)) {
          saidFollow = true;
          ui.setSubtitle('Follow the light.', 5);
        }

        const dOrb = Math.hypot(
          anchors.orb.x - player.position.x,
          anchors.orb.z - player.position.z
        );
        if (!orbWoken && dOrb < 8) { orbWoken = true; env.setOrbActive(true); }

        const f = evaluateTarget(TARGETS.toOrb, holdT > 0);
        const fired = tickHold(dt, () => {
          if (!orbWoken) { orbWoken = true; env.setOrbActive(true); }
          ui.setPrompt(null);
          // Clear any queued narration, and clear it quickly, so no line is
          // still on screen when the breathing guide comes up.
          ui.setSubtitle(null, 0);
          advance('breathing');
        });
        if (!fired) prompt(TARGETS.toOrb.label, holdT / HOLD_TIME, f);
        break;
      }

      /* ── the centrepiece ── */
      case 'breathing': {
        prompt(null);
        // The guide sits where the orb is, and the orb is drawn gently toward
        // the centre of the view — the two read as one thing.
        orbScreen(breathAnchor);
        player.lookAtPoint(env.orb.getWorldPosition(orbWorld), 0.16);
        if (!breathDone) {
          breathT += dt;
          if (breathT >= CYCLE) {
            breathT -= CYCLE;
            breathCycles++;
            state.breathCycle = breathCycles;
            if (breathCycles >= state.breathTotal) {
              breathDone = true;
              breathT = 0;
            }
          }
        }

        if (!breathDone) {
          const b = breathAt(breathT);
          env.setOrbBreath(b.scale, b.glow);
          state.breathPhase = breathT / CYCLE;
          if (b.seg !== lastBreathSeg) {
            lastBreathSeg = b.seg;
            if (b.seg === 0) audio.breathCue('inhale');
            else if (b.seg === 2) audio.breathCue('exhale');
          }
          ui.setBreath(b.label, b.scale, breathCycles, state.breathTotal, breathAnchor);
        } else {
          // Hold the completed guide — all five dots lit — for a beat, so the
          // fifth breath is acknowledged before the ring leaves.
          env.setOrbBreath(0, 0.06);
          ui.setBreath('', 0, state.breathTotal, state.breathTotal, breathAnchor);
          breathT += dt;
          if (breathT > 2.6) {
            ui.setBreath(null, 0, state.breathTotal, state.breathTotal);
            player.lookAtPoint(null, 0);
            player.setSpeedScale(1);
            env.setOrbActive(false);
            ui.setSubtitle('The mountain breathes with you.', 6);
            advance('toShrine');
          }
        }
        break;
      }

      /* ── climb to the shrine ── */
      case 'toShrine': {
        if (!saidValley && pt > 4) {
          saidValley = true;
          ui.setSubtitle('Go on. The valley is waking.', 5);
        }
        // past the crest the reveal speaks for itself — no subtitles here.
        const f = evaluateTarget(TARGETS.toShrine, holdT > 0);
        const fired = tickHold(dt, () => {
          ui.setPrompt(null);
          ui.setSubtitle(null);
          advance('bell');
        });
        if (!fired) prompt(TARGETS.toShrine.label, holdT / HOLD_TIME, f);
        break;
      }

      /* ── the bell, and the turn toward the valley ── */
      case 'bell': {
        prompt(null);
        const w = smoothstep(0, BELL_TURN * 0.85, pt);
        player.lookAtPoint(valley, w);
        if (pt >= BELL_TURN) advance('ending');
        break;
      }

      /* ── 34 seconds of dawn ── */
      case 'ending': {
        prompt(null);
        valleyDrift.copy(valley);
        valleyDrift.x += Math.sin(pt * 0.085) * 16;
        valleyDrift.y += Math.sin(pt * 0.062 + 1.1) * 5;
        player.lookAtPoint(valleyDrift, 1);

        if (endingCue === 0 && pt > 3.5) { endingCue = 1; ui.setSubtitle('Nothing to reach for.', 6); }
        else if (endingCue === 1 && pt > 12.5) { endingCue = 2; ui.setSubtitle('Nothing to hold.', 6); }
        else if (endingCue === 2 && pt > 21.5) { endingCue = 3; ui.setSubtitle('Just this.', 6); }
        else if (endingCue === 3 && pt > 25.5) {
          // Dawn is at full by now; the chime marks the peak and the fade only
          // begins once the player has had a few seconds of it.
          endingCue = 4;
          audio.chime();
          ui.setSubtitle(null);
        } else if (endingCue === 4 && pt > 37) {
          endingCue = 5;
          ui.fade(1, 6, '#0b0f1c');
        }
        break;
      }

      case 'complete':
        prompt(null);
        player.lookAtPoint(null, 0);
        break;
    }
  }

  return { update };
}
