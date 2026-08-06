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

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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
  let moveId = null, lookId = null;
  let moveOX = 0, moveOY = 0, lookLX = 0, lookLY = 0;

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

  function onTouchStart(e) {
    if (!enabled) return;
    const half = window.innerWidth * 0.5;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < half && moveId === null) {
        moveId = t.identifier; moveOX = t.clientX; moveOY = t.clientY;
        showStick(t.clientX, t.clientY);
      } else if (lookId === null) {
        lookId = t.identifier; lookLX = t.clientX; lookLY = t.clientY;
      }
    }
  }

  function onTouchMove(e) {
    if (moveId === null && lookId === null) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === moveId) {
        let dx = t.clientX - moveOX, dy = t.clientY - moveOY;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        moveKnob(dx, dy);
        moveX = clamp(dx / STICK_RADIUS, -1, 1);
        moveZ = clamp(-dy / STICK_RADIUS, -1, 1);
      } else if (t.identifier === lookId) {
        pendYaw -= (t.clientX - lookLX) * TOUCH_SENS;
        pendPitch -= (t.clientY - lookLY) * TOUCH_SENS;
        lookLX = t.clientX; lookLY = t.clientY;
      }
    }
  }

  function onTouchEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === moveId) { moveId = null; moveX = 0; moveZ = 0; hideStick(); }
      else if (t.identifier === lookId) { lookId = null; }
    }
  }

  if (ctx.isTouch) {
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
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
      if (!enabled) {
        releaseAll();
        moveX = 0; moveZ = 0;
        moveId = null; lookId = null;
        hideStick();
      }
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
  };

  return api;
}
