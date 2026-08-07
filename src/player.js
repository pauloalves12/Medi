import * as THREE from 'three';

/**
 * player.js — first-person walker.
 * @see main.js LOCKED MODULE CONTRACT
 *
 * Meditative movement: 1.45 m/s, weighted acceleration, no run/jump/crouch.
 * Owns the camera transform; main.js never touches it.
 */

const BASE_SPEED = 1.45;      // m/s
const ACCEL_TAU = 0.16;       // ~0.45s to settle
const EYE_HEIGHT = 1.62;      // m
const GROUND_TAU = 0.085;     // slope smoothing
const PITCH_LIMIT = 75 * Math.PI / 180;
const MOUSE_SENS = 0.00215;   // rad / px
const TOUCH_SENS = 0.0042;    // rad / px
const LOOK_TAU = 0.028;       // mouse damping (~28ms, under the 40ms budget)

const BOB_STEP = 0.78;        // metres per step
const BOB_VERT = 0.016;       // 1.6 cm
const BOB_LAT = 0.011;        // 1.1 cm
const BOB_ROLL = 0.35 * Math.PI / 180;

const SWAY_PERIOD = 5.0;      // s
const SWAY_VERT = 0.006;      // 6 mm

const STICK_RADIUS = 58;      // px

const CINE_TAU = 0.5;         // s — how fast the bob unwinds into a glide

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smootherstep(t) {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function shortestAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function createPlayer(camera, canvas, ctx) {
  const position = new THREE.Vector3();

  let yaw = 0, pitch = 0, roll = 0;
  let enabled = false;

  // velocity in world XZ, smoothed toward the desired velocity
  let velX = 0, velZ = 0;
  let speed = 0;
  let speedScale = 1;

  let groundY = 0, groundInit = false;
  let bobDist = 0, bobAmount = 0;
  let swayT = 0;

  // pending (undamped) look delta, drained with an exponential filter
  let pendYaw = 0, pendPitch = 0;

  const keys = Object.create(null);
  let moveX = 0, moveZ = 0;      // -1..1 analog input (touch stick or keys)

  let locked = false;

  // assisted look
  const assistTarget = new THREE.Vector3();
  let assistWeight = 0, assistActive = false;

  // authored viewpoint move — the settle onto the shrine's overlook after the
  // bell, so the dawn is composed from the same place every time
  const cineFrom = new THREE.Vector3();
  const cineTo = new THREE.Vector3();
  const cineVia = new THREE.Vector3();
  let cineT = 0, cineDur = 0, cineActive = false, cineLock = false, cineBow = false;

  // scratch — never allocate in update()
  const desired = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  camera.rotation.order = 'YXZ';

  /* ── keyboard ───────────────────────────────────────────────────────────── */

  const MOVE_KEYS = {
    KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2,
    KeyA: 3, ArrowLeft: 3, KeyD: 4, ArrowRight: 4,
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    if (MOVE_KEYS[e.code]) {
      keys[e.code] = true;
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  }
  function onKeyUp(e) { if (MOVE_KEYS[e.code]) keys[e.code] = false; }
  function releaseAll() { for (const k in keys) keys[k] = false; }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);

  /* ── pointer lock + mouse look ──────────────────────────────────────────── */

  function requestLock() {
    if (!enabled || locked) return;
    if (canvas.requestPointerLock) {
      const r = canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  }

  function onCanvasClick() { requestLock(); }

  function onLockChange() {
    locked = document.pointerLockElement === canvas;
    document.body.classList.toggle('locked', locked);
    if (!locked) { pendYaw = 0; pendPitch = 0; }
  }

  function onMouseMove(e) {
    if (!locked) return;
    pendYaw -= (e.movementX || 0) * MOUSE_SENS;
    pendPitch -= (e.movementY || 0) * MOUSE_SENS;
  }

  if (!ctx.isTouch) {
    canvas.addEventListener('click', onCanvasClick);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', () => { locked = false; });
    document.addEventListener('mousemove', onMouseMove);
  }

  /* ── touch: left half = stick, right half = look ────────────────────────── */

  let stickEl = null, knobEl = null;
  let lastStickTransform = '', lastKnobTransform = '', stickShown = false;

  // Each thumb owns its own slot, keyed by pointerId. Nothing but the pointer
  // that claimed a slot can drive it or clear it, so the two thumbs can never
  // write into each other's state.
  const moveP = { id: null, ox: 0, oy: 0 };
  const lookP = { id: null, lx: 0, ly: 0 };

  function buildStick() {
    stickEl = document.createElement('div');
    stickEl.className = 'touch-stick';
    stickEl.setAttribute('aria-hidden', 'true');
    knobEl = document.createElement('div');
    knobEl.className = 'touch-stick-knob';
    stickEl.appendChild(knobEl);
    document.body.appendChild(stickEl);
  }

  function showStick(x, y) {
    if (!stickEl) buildStick();
    const t = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
    if (t !== lastStickTransform) { stickEl.style.transform = t; lastStickTransform = t; }
    if (!stickShown) { stickEl.classList.add('is-active'); stickShown = true; }
    moveKnob(0, 0);
  }
  function hideStick() {
    if (stickEl && stickShown) { stickEl.classList.remove('is-active'); stickShown = false; }
  }
  function moveKnob(dx, dy) {
    if (!knobEl) return;
    const t = `translate3d(${Math.round(dx)}px,${Math.round(dy)}px,0)`;
    if (t !== lastKnobTransform) { knobEl.style.transform = t; lastKnobTransform = t; }
  }

  // Capture routes every later move/up for this finger to the canvas, even once
  // it has slid out of the half it started in or off the screen entirely — which
  // is what stops a wandering thumb from silently losing its slot.
  function capture(id) {
    try { canvas.setPointerCapture(id); } catch (e) { /* pointer already gone */ }
  }
  function uncapture(id) {
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } catch (e) { /* already released */ }
  }

  function releaseMove() {
    if (moveP.id === null) return;
    uncapture(moveP.id);
    moveP.id = null;
    moveX = 0; moveZ = 0;
    hideStick();
  }
  function releaseLook() {
    if (lookP.id === null) return;
    uncapture(lookP.id);
    lookP.id = null;
  }
  function releaseTouch() { releaseMove(); releaseLook(); }

  function onPointerDown(e) {
    if (!enabled || e.pointerType === 'mouse') return;
    // Suppress the compatibility mouse events this would otherwise synthesise,
    // so a tap cannot also arrive at the desktop press handlers.
    e.preventDefault();

    if (e.clientX < window.innerWidth * 0.5) {
      // A fresh thumb in the movement half always takes the movement slot. Any
      // previous owner is either gone or has been abandoned, and there is no
      // reliable way to tell those apart — so we never let a stale id keep the
      // slot, which is what makes movement unconditionally reacquirable.
      releaseMove();
      moveP.id = e.pointerId; moveP.ox = e.clientX; moveP.oy = e.clientY;
      moveX = 0; moveZ = 0;
      showStick(e.clientX, e.clientY);
      capture(e.pointerId);
    } else {
      releaseLook();
      lookP.id = e.pointerId; lookP.lx = e.clientX; lookP.ly = e.clientY;
      capture(e.pointerId);
    }
  }

  function onPointerMove(e) {
    if (e.pointerId === moveP.id) {
      let dx = e.clientX - moveP.ox, dy = e.clientY - moveP.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
      moveKnob(dx, dy);
      moveX = clamp(dx / STICK_RADIUS, -1, 1);
      moveZ = clamp(-dy / STICK_RADIUS, -1, 1);
    } else if (e.pointerId === lookP.id) {
      pendYaw -= (e.clientX - lookP.lx) * TOUCH_SENS;
      pendPitch -= (e.clientY - lookP.ly) * TOUCH_SENS;
      lookP.lx = e.clientX; lookP.ly = e.clientY;
    }
  }

  // pointerup, pointercancel and lostpointercapture all land here. Releasing a
  // slot is idempotent and matched on id, so the duplicate events a normal lift
  // produces cost nothing and an interrupted gesture still frees exactly one.
  function onPointerEnd(e) {
    if (e.pointerId === moveP.id) releaseMove();
    else if (e.pointerId === lookP.id) releaseLook();
  }

  function onVisibility() { if (document.hidden) releaseTouch(); }

  if (ctx.isTouch) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerEnd);
    canvas.addEventListener('pointercancel', onPointerEnd);
    canvas.addEventListener('lostpointercapture', onPointerEnd);
    // If capture never took, the canvas may never see the lift — the window
    // still does, and a second release of an already-free slot is harmless.
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('blur', releaseTouch);
    document.addEventListener('visibilitychange', onVisibility);
  }

  /* ── update ─────────────────────────────────────────────────────────────── */

  function update(dt, env, state) {
    if (dt <= 0) dt = 0.0001;

    // --- look input (damped, never twitchy) ---
    const lookK = 1 - Math.exp(-dt / LOOK_TAU);
    const dy = pendYaw * lookK, dp = pendPitch * lookK;
    pendYaw -= dy; pendPitch -= dp;

    const authored = assistActive ? clamp(assistWeight, 0, 1) : 0;
    const inputGain = 1 - authored * 0.85;
    yaw += dy * inputGain;
    pitch = clamp(pitch + dp * inputGain, -PITCH_LIMIT, PITCH_LIMIT);

    // --- assisted look: pull the gaze toward a world point, never snapping ---
    if (authored > 0) {
      tmp.copy(assistTarget).sub(camera.position);
      const flat = Math.hypot(tmp.x, tmp.z);
      if (flat > 0.001) {
        const tYaw = Math.atan2(-tmp.x, -tmp.z);
        const tPitch = clamp(Math.atan2(tmp.y, flat), -PITCH_LIMIT, PITCH_LIMIT);
        const k = 1 - Math.exp(-dt * (0.35 + authored * 1.35));
        yaw += shortestAngle(tYaw - yaw) * k;
        pitch += (tPitch - pitch) * k;
      }
    }

    // --- authored viewpoint move (overrides walking entirely) ---
    if (cineLock) {
      if (cineActive) {
        cineT += dt;
        const u = smootherstep(cineDur > 0 ? cineT / cineDur : 1);
        if (cineBow) {
          // Quadratic through a control point, so the walk curves around what
          // stands between here and there rather than straight through it.
          const iu = 1 - u, a = iu * iu, b = 2 * iu * u, c = u * u;
          position.x = a * cineFrom.x + b * cineVia.x + c * cineTo.x;
          position.z = a * cineFrom.z + b * cineVia.z + c * cineTo.z;
        } else {
          position.x = cineFrom.x + (cineTo.x - cineFrom.x) * u;
          position.z = cineFrom.z + (cineTo.z - cineFrom.z) * u;
        }
        if (env && env.getGroundHeight) {
          const g = env.getGroundHeight(position.x, position.z);
          if (Number.isFinite(g)) position.y = g;
        }
        if (cineT >= cineDur) cineActive = false;
      }
      velX = 0; velZ = 0; speed = 0;
      // A glide is not a walk: let the footfall bob unwind rather than stepping.
      bobAmount += (0 - bobAmount) * (1 - Math.exp(-dt / CINE_TAU));

      const feetYC = Number.isFinite(position.y) ? position.y : 0;
      if (!groundInit) { groundY = feetYC; groundInit = true; }
      groundY += (feetYC - groundY) * (1 - Math.exp(-dt / GROUND_TAU));

      swayT += dt;
      const swayC = Math.sin(swayT * (Math.PI * 2 / SWAY_PERIOD)) * SWAY_VERT;
      const swayRollC = Math.sin(swayT * (Math.PI * 2 / (SWAY_PERIOD * 1.7))) * 0.0014;
      camera.position.set(position.x, groundY + EYE_HEIGHT + swayC, position.z);
      camera.rotation.set(pitch, yaw, swayRollC);

      api.isMoving = false;
      api.speed01 = 0;
      return;
    }

    // --- movement intent ---
    let ix = moveX, iz = moveZ;
    if (keys.KeyW || keys.ArrowUp) iz += 1;
    if (keys.KeyS || keys.ArrowDown) iz -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    const mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; }
    if (!enabled) { ix = 0; iz = 0; }

    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    // forward = (-sin, 0, -cos)   right = (cos, 0, -sin)
    const target = BASE_SPEED * speedScale;
    const tvX = (-sinY * iz + cosY * ix) * target;
    const tvZ = (-cosY * iz - sinY * ix) * target;

    const accelK = 1 - Math.exp(-dt / ACCEL_TAU);
    velX += (tvX - velX) * accelK;
    velZ += (tvZ - velZ) * accelK;
    if (Math.abs(velX) < 1e-4) velX = 0;
    if (Math.abs(velZ) < 1e-4) velZ = 0;

    speed = Math.hypot(velX, velZ);

    // --- integrate + constrain (the only collision system) ---
    if (speed > 1e-5) {
      desired.set(position.x + velX * dt, position.y, position.z + velZ * dt);
      if (env && env.constrainPosition) env.constrainPosition(desired);
      if (Number.isFinite(desired.x) && Number.isFinite(desired.z)) {
        // The corridor projects us back each frame, which slides us along the
        // edge on its own — keeping the velocity intact is what makes that feel
        // like brushing past a wall rather than sticking to it.
        const movedX = desired.x - position.x, movedZ = desired.z - position.z;
        position.x = desired.x; position.z = desired.z;
        if (Number.isFinite(desired.y)) position.y = desired.y;
        const moved = Math.hypot(movedX, movedZ);
        speed = moved / dt;
        bobDist += moved;
      }
    } else if (env && env.getGroundHeight) {
      const g = env.getGroundHeight(position.x, position.z);
      if (Number.isFinite(g)) position.y = g;
    }

    const feetY = Number.isFinite(position.y) ? position.y : 0;
    if (!groundInit) { groundY = feetY; groundInit = true; }
    groundY += (feetY - groundY) * (1 - Math.exp(-dt / GROUND_TAU));

    // --- head bob (tied to distance, almost subliminal) ---
    const speed01 = clamp(speed / BASE_SPEED, 0, 1);
    bobAmount += (speed01 - bobAmount) * (1 - Math.exp(-dt / 0.22));
    const step = bobDist * (Math.PI / BOB_STEP);
    const bobY = Math.sin(step * 2) * BOB_VERT * bobAmount;
    const bobX = Math.sin(step) * BOB_LAT * bobAmount;
    roll = -Math.sin(step) * BOB_ROLL * bobAmount;

    // --- idle breathing sway (the world is never frozen) ---
    swayT += dt;
    const sway = Math.sin(swayT * (Math.PI * 2 / SWAY_PERIOD)) * SWAY_VERT * (1 - 0.55 * bobAmount);
    const swayRoll = Math.sin(swayT * (Math.PI * 2 / (SWAY_PERIOD * 1.7))) * 0.0014;

    // --- write the camera ---
    camera.position.set(
      position.x + cosY * bobX,
      groundY + EYE_HEIGHT + bobY + sway,
      position.z - sinY * bobX
    );
    camera.rotation.set(pitch, yaw, roll + swayRoll);

    api.isMoving = speed > 0.06;
    api.speed01 = speed01;
  }

  /* ── api ────────────────────────────────────────────────────────────────── */

  const api = {
    update,
    position,
    isMoving: false,
    speed01: 0,

    setEnabled(on) {
      enabled = !!on;
      // An authored move is a temporary seizure of control, and this is the one
      // call that says who has control now — so it always ends here. Otherwise a
      // cinematic that ran once would hold the walker still for good.
      cineActive = false; cineLock = false;
      if (!enabled) {
        releaseAll();
        moveX = 0; moveZ = 0;
        releaseTouch();
      }
    },

    /**
     * Glide the standing point to an authored spot over `seconds`, holding all
     * walking input until movement is re-enabled. Look stays live throughout,
     * so lookAtPoint can compose the view while this runs.
     */
    beginCinematic(target, seconds, via) {
      if (!target) return;
      cineFrom.copy(position);
      cineTo.copy(target);
      cineBow = !!via;
      if (via) cineVia.copy(via);
      cineDur = Math.max(0.001, seconds || 2.0);
      cineT = 0;
      cineActive = true;
      cineLock = true;
      releaseAll();
      moveX = 0; moveZ = 0;
      releaseTouch();
    },

    /** Blend the gaze toward a world point. weight 0 = full player control. */
    lookAtPoint(v, weight01) {
      if (!v || !(weight01 > 0)) { assistActive = false; assistWeight = 0; return; }
      assistTarget.copy(v);
      assistWeight = clamp(weight01, 0, 1);
      assistActive = true;
    },

    /** Gentle damping used by the breathing phase (not a freeze). */
    setSpeedScale(v) { speedScale = clamp(v, 0, 1); },

    get yaw() { return yaw; },
    get pitch() { return pitch; },

    /** Called from the Begin click, which is itself a user gesture. */
    requestLock() { if (!ctx.isTouch) requestLock(); },
    get locked() { return ctx.isTouch ? true : locked; },
  };

  return api;
}
