/**
 * ui.js — every pixel of DOM in the piece.
 * @see main.js LOCKED MODULE CONTRACT
 *
 * Minimal, typographic, cinematic. Everything fades; nothing pops.
 * All per-frame writes are cached so the loop never touches the DOM
 * unless a value actually changed.
 */

const PROMPT_R = 19;
const PROMPT_C = 2 * Math.PI * PROMPT_R;

const BREATH_MIN = 62;
const BREATH_MAX = 188;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} seconds`;
  return `${m} minute${m === 1 ? '' : 's'} ${String(r).padStart(2, '0')} seconds`;
}

export function createUI(root, ctx) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = !!(ctx && ctx.isTouch);

  const controls = touch
    ? 'left thumb to walk · right to look · hold to act'
    : 'wasd to walk · mouse to look · hold space to act';

  root.innerHTML = `
    <div class="fadeover" data-el="fade"></div>

    <section class="title" data-el="title">
      <div class="title-inner">
        <h1 class="title-word">ASCENT</h1>
        <p class="title-sub">a short mountain meditation · about three minutes</p>
        <button class="begin" type="button" data-el="begin"><span>Begin</span></button>
        <p class="title-controls">${controls}</p>
        <p class="title-hint">headphones recommended</p>
      </div>
    </section>

    <div class="breath" data-el="breath" aria-hidden="true">
      <svg class="breath-ring" viewBox="0 0 420 420" focusable="false">
        <circle class="breath-guide" cx="210" cy="210" r="${BREATH_MAX}"></circle>
        <circle class="breath-live" cx="210" cy="210" r="${BREATH_MIN}" data-el="breathCircle"></circle>
      </svg>
      <div class="breath-label" data-el="breathLabel"></div>
      <div class="breath-dots" data-el="breathDots">
        <i></i><i></i><i></i><i></i><i></i>
      </div>
    </div>

    <div class="prompt" data-el="prompt">
      <svg class="prompt-ring" viewBox="0 0 44 44" focusable="false" aria-hidden="true">
        <circle class="prompt-track" cx="22" cy="22" r="${PROMPT_R}"></circle>
        <circle class="prompt-fill" cx="22" cy="22" r="${PROMPT_R}"
                stroke-dasharray="${PROMPT_C.toFixed(2)}"
                stroke-dashoffset="${PROMPT_C.toFixed(2)}" data-el="promptFill"></circle>
      </svg>
      <div class="prompt-text" data-el="promptText"></div>
    </div>

    <div class="subtitle" data-el="subtitle"><span data-el="subtitleText"></span></div>

    <section class="complete" data-el="complete">
      <div class="complete-inner">
        <p class="complete-line" data-el="cLine">You may carry this with you.</p>
        <p class="complete-dur" data-el="cDur"></p>
        <button class="begin again" type="button" data-el="again"><span>Again</span></button>
      </div>
    </section>
  `;

  const el = {};
  root.querySelectorAll('[data-el]').forEach((n) => { el[n.dataset.el] = n; });
  const dots = el.breathDots.querySelectorAll('i');

  /* ── fade overlay ───────────────────────────────────────────────────────── */

  let fadeColor = '';
  function fade(alpha, seconds, color) {
    const a = clamp01(alpha);
    const s = reduce ? Math.min(seconds || 0, 0.4) : (seconds || 0);
    if (color && color !== fadeColor) { el.fade.style.background = color; fadeColor = color; }
    el.fade.style.transitionDuration = `${s}s`;
    // force the browser to register the duration before the opacity change
    void el.fade.offsetWidth;
    el.fade.style.opacity = String(a);
  }

  // open on black, then let the mountain arrive
  el.fade.style.background = '#05070e';
  fadeColor = '#05070e';
  el.fade.style.opacity = '1';
  requestAnimationFrame(() => requestAnimationFrame(() => fade(0, reduce ? 0.4 : 2.6)));

  /* ── title ──────────────────────────────────────────────────────────────── */

  let beginHandler = null;
  el.begin.addEventListener('click', () => { if (beginHandler) beginHandler(); });

  function showTitle(onBegin) {
    beginHandler = onBegin;
    el.title.classList.add('is-on');
    setTimeout(() => { try { el.begin.focus({ preventScroll: true }); } catch (e) { /* noop */ } },
      reduce ? 200 : 2600);
  }

  function hideTitle() {
    el.title.classList.remove('is-on');
    el.title.classList.add('is-gone');
    try { el.begin.blur(); } catch (e) { /* noop */ }
    setTimeout(() => { el.title.style.display = 'none'; }, 1600);
  }

  /* ── prompt ─────────────────────────────────────────────────────────────── */

  let lastPromptText = '';
  let lastPromptOpacity = -1;
  let lastDash = -1;
  let promptOn = false;

  function setPrompt(text, progress01, focus01) {
    const p = clamp01(progress01 || 0);
    if (!text) {
      if (promptOn) {
        promptOn = false;
        // inline opacity wins over the class, so drive it explicitly
        el.prompt.style.opacity = '0';
        lastPromptOpacity = 0;
        el.prompt.classList.remove('is-on');
      }
      return;
    }
    if (text !== lastPromptText) { el.promptText.textContent = text; lastPromptText = text; }
    if (!promptOn) { promptOn = true; el.prompt.classList.add('is-on'); }

    // opacity rises with proximity + gaze, and snaps to full while holding
    const f = focus01 === undefined ? 1 : clamp01(focus01);
    const o = Math.round(Math.min(1, Math.max(f, p > 0 ? 1 : 0)) * 100) / 100;
    if (o !== lastPromptOpacity) { el.prompt.style.opacity = String(o); lastPromptOpacity = o; }

    const dash = Math.round(PROMPT_C * (1 - p) * 10) / 10;
    if (dash !== lastDash) { el.promptFill.style.strokeDashoffset = String(dash); lastDash = dash; }
  }

  /* ── breath guide ───────────────────────────────────────────────────────── */

  let breathOn = false;
  let lastBreathLabel = '';
  let lastR = -1;
  let lastCycle = -1;

  /**
   * `anchor` is the orb's screen position in 0..1, or null for screen centre.
   * The guide follows it loosely so the ring reads as belonging to the light.
   */
  function setBreath(label, phase01, cycle, total, anchor) {
    const t = total || 5;
    const c = (cycle || 0) | 0;

    // Dots first, so the final cycle is acknowledged on the frame it completes
    // rather than being skipped by the dismissal below.
    if (c !== lastCycle) {
      lastCycle = c;
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('is-done', i < c);
    }

    // `null` dismisses the guide; '' keeps it up wordlessly (the rest beat, and
    // the held beat after the fifth breath).
    if (label === null && c >= t) {
      if (breathOn) {
        breathOn = false;
        el.breath.classList.remove('is-on');
        el.breathLabel.textContent = '';
        lastBreathLabel = '';
      }
      return;
    }

    if (!breathOn) { breathOn = true; el.breath.classList.add('is-on'); }

    // no label = the rest beat between cycles: keep the ring, drop the word
    const want = label || '';
    if (want !== lastBreathLabel) { el.breathLabel.textContent = want; lastBreathLabel = want; }

    const r = Math.round((BREATH_MIN + (BREATH_MAX - BREATH_MIN) * clamp01(phase01)) * 10) / 10;
    if (r !== lastR) { el.breathCircle.setAttribute('r', String(r)); lastR = r; }

    if (anchor) { breathAim.x = anchor.x; breathAim.y = anchor.y; }
  }

  // Eased toward the orb so a quick glance never yanks the ring across the screen.
  const breathAim = { x: 0.5, y: 0.5 };
  const breathPos = { x: 0.5, y: 0.5 };
  let lastBreathTransform = '';

  function updateBreathAnchor(dt) {
    if (!breathOn) { breathAim.x = 0.5; breathAim.y = 0.5; }
    const k = 1 - Math.exp(-dt * (reduce ? 12 : 3.2));
    breathPos.x += (breathAim.x - breathPos.x) * k;
    breathPos.y += (breathAim.y - breathPos.y) * k;
    // Damped and clamped: the guide leans toward the orb without ever leaving
    // the frame or drifting far from the reading position.
    const x = (clamp01(breathPos.x) - 0.5) * 0.55;
    const y = (clamp01(breathPos.y) - 0.5) * 0.55;
    const t = `translate(calc(-50% + ${(x * 100).toFixed(2)}vw), calc(-50% + ${(y * 100).toFixed(2)}vh))`;
    if (t !== lastBreathTransform) { el.breath.style.transform = t; lastBreathTransform = t; }
  }

  /* ── subtitles (queued, never overlapping) ──────────────────────────────── */

  const IN = reduce ? 0.4 : 1.2;
  const OUT = reduce ? 0.5 : 1.8;
  const queue = [];
  let subText = null, subHold = 0, subState = 'idle', subT = 0, subOut = OUT;
  let lastSubOpacity = -1, lastSubString = '';

  function setSubtitle(text, holdSeconds) {
    if (text === null || text === undefined) {
      queue.length = 0;
      if (subState === 'in' || subState === 'hold') {
        // holdSeconds === 0 means "get out of the way now" — used when the
        // breathing guide takes the screen, so no line lingers over it.
        subOut = holdSeconds === 0 ? 0.45 : OUT;
        subState = 'out'; subT = 0;
      }
      return;
    }
    queue.push({ text, hold: holdSeconds || 5 });
  }

  function tickSubtitle(dt) {
    if (subState === 'idle') {
      if (queue.length) {
        const n = queue.shift();
        subText = n.text; subHold = n.hold; subOut = OUT;
        if (subText !== lastSubString) { el.subtitleText.textContent = subText; lastSubString = subText; }
        subState = 'in'; subT = 0;
      }
    } else if (subState === 'in') {
      subT += dt;
      if (subT >= IN) { subState = 'hold'; subT = 0; }
    } else if (subState === 'hold') {
      subT += dt;
      if (subT >= subHold) { subState = 'out'; subT = 0; }
    } else if (subState === 'out') {
      subT += dt;
      if (subT >= subOut) { subState = 'idle'; subT = 0; }
    }

    let o = 0;
    if (subState === 'in') o = subT / IN;
    else if (subState === 'hold') o = 1;
    else if (subState === 'out') o = 1 - subT / subOut;
    o = Math.round(clamp01(o) * 100) / 100;
    if (o !== lastSubOpacity) {
      el.subtitle.style.opacity = String(o);
      el.subtitle.style.transform = `translateY(${((1 - o) * 8).toFixed(1)}px)`;
      lastSubOpacity = o;
    }
  }

  /* ── completion ─────────────────────────────────────────────────────────── */

  let againHandler = null;
  let completeT = -1;
  let completeStage = 0;
  let elapsed = 0;

  el.again.addEventListener('click', () => { if (againHandler) againHandler(); });

  function showComplete(onAgain) {
    againHandler = onAgain;
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) { /* noop */ } }
    document.body.classList.remove('locked');
    el.complete.classList.add('is-on');
    el.cDur.textContent = fmtDuration(elapsed);
    completeT = 0;
    completeStage = 0;
    setPrompt(null);
    setBreath(null, 0, 5, 5);
    setSubtitle(null);
  }

  function tickComplete(dt) {
    if (completeT < 0) return;
    completeT += dt;
    const marks = reduce ? [0.2, 0.6, 1.0] : [2.0, 4.4, 6.4];
    if (completeStage === 0 && completeT > marks[0]) { completeStage = 1; el.cLine.classList.add('is-on'); }
    else if (completeStage === 1 && completeT > marks[1]) { completeStage = 2; el.cDur.classList.add('is-on'); }
    else if (completeStage === 2 && completeT > marks[2]) {
      completeStage = 3;
      el.again.classList.add('is-on');
      setTimeout(() => { try { el.again.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 400);
    }
  }

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt, state) {
    if (state) elapsed = state.elapsed;
    tickSubtitle(dt);
    tickComplete(dt);
    updateBreathAnchor(dt);
  }

  return { showTitle, hideTitle, setPrompt, setBreath, setSubtitle, showComplete, fade, update };
}
