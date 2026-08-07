/**
 * audio.js — 100% Web Audio synthesis. No files, no samples.
 * @see main.js LOCKED MODULE CONTRACT
 *
 * The bed:  wind (filtered noise) + a low drone + a slowly drifting pentatonic pad,
 *           all through a procedurally generated mountain reverb.
 * The hits: the lantern catch, the breath cues, the bell, the closing chime.
 *
 * Every parameter move is ramped. Nothing is allocated per frame.
 */

const PAD_NOTES = [
  146.83, 174.61, 196.00, 220.00, 261.63,   // D3 F3 G3 A3 C4
  293.66, 349.23, 392.00, 440.00, 523.25,   // D4 F4 G4 A4 C5
];

// inharmonic partials of a struck bowl
const BELL_PARTIALS = [1, 2.00, 2.65, 3.01, 4.07, 5.4, 6.8];
const BELL_DECAYS   = [11.0, 7.6, 5.6, 4.3, 3.1, 2.3, 1.7];
const BELL_GAINS    = [1.0, 0.52, 0.40, 0.30, 0.19, 0.12, 0.08];

const PHASE_MIX = {
  title:     { wind: 0.85, drone: 0.55, pad: 0.28 },
  lantern:   { wind: 1.00, drone: 0.80, pad: 0.34 },
  toOrb:     { wind: 0.95, drone: 0.85, pad: 0.42 },
  breathing: { wind: 0.42, drone: 0.92, pad: 1.00 },
  toShrine:  { wind: 0.90, drone: 0.85, pad: 0.55 },
  bell:      { wind: 0.62, drone: 0.80, pad: 0.70 },
  ending:    { wind: 0.55, drone: 1.00, pad: 1.00 },
  complete:  { wind: 0.30, drone: 0.55, pad: 0.62 },
};

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function createAudio(ctx) {
  const tod = (ctx && ctx.tod && ctx.tod.audio) || {};
  const bedCutoff = tod.filter || ((d) => 820 + d * 6400);
  // The bed's cutoff before the first ramp. setDawn only fires once the light
  // has actually moved, so at DAWN this value stands for the whole opening.
  const bedStart = tod.start === undefined ? 900 : tod.start;

  let ac = null;
  let ready = false;

  // graph handles
  let master, duck, bedFilter, comp, convolver, wetGain;
  let windBus, droneBus, padBus, fxBus;
  let windGains = [], windFilters = [];
  let noiseBuffer = null;
  let padVoices = [];

  let windLevel = 1, droneLevel = 0.8, padLevel = 0.3;
  let gustTarget = 0.5;
  let dawnTarget = 0;
  let pendingDawn = 0;
  let duckTarget = 1;
  let sparseTimer = 18;
  let paramTimer = 0;
  let phaseName = 'title';

  /* ── graph construction ─────────────────────────────────────────────────── */

  function makeNoiseBuffer(seconds) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;    // a touch of brown for weight
        d[i] = w * 0.52 + last * 2.4;
      }
      // taper the seam so the loop never clicks
      const fadeN = Math.min(2048, (n / 8) | 0);
      for (let i = 0; i < fadeN; i++) {
        const k = i / fadeN;
        d[i] *= k;
        d[n - 1 - i] *= k;
      }
    }
    return buf;
  }

  function makeImpulse(seconds, decay) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // sparse early reflections + an exponentially decaying diffuse tail
        const env = Math.pow(1 - t, decay);
        d[i] = (Math.random() * 2 - 1) * env;
      }
      // a couple of discrete early reflections give the space a size
      const refl = [0.013, 0.021, 0.037, 0.058, 0.089];
      for (let r = 0; r < refl.length; r++) {
        const idx = Math.floor(refl[r] * ac.sampleRate) + (c ? 61 : 0);
        if (idx < n) d[idx] += (r % 2 ? -1 : 1) * 0.45 / (r + 1);
      }
    }
    return buf;
  }

  function bus(dry, wet) {
    const g = ac.createGain();
    g.gain.value = 1;
    const d = ac.createGain(); d.gain.value = dry;
    const w = ac.createGain(); w.gain.value = wet;
    g.connect(d);
    g.connect(w);
    w.connect(convolver);
    return { node: g, dry: d, wet: w };
  }

  function build() {
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.01;
    comp.release.value = 0.35;
    comp.connect(ac.destination);

    master = ac.createGain();
    master.gain.value = 0;
    master.connect(comp);

    duck = ac.createGain();
    duck.gain.value = 1;
    duck.connect(master);

    // reverb: one big cold mountain
    convolver = ac.createConvolver();
    convolver.buffer = makeImpulse(3.6, 2.6);
    wetGain = ac.createGain();
    wetGain.gain.value = 0.85;
    convolver.connect(wetGain);
    wetGain.connect(duck);

    // the ambience bed sits behind a lowpass that opens as dawn arrives
    bedFilter = ac.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = bedStart;
    bedFilter.Q.value = 0.4;
    bedFilter.connect(duck);

    noiseBuffer = makeNoiseBuffer(4);

    // ── wind: two noise voices, different Q, panned wide ──
    const windSpec = [
      { q: 0.7, f: 420, sweep: 190, rate: 0.041, pan: -0.72, g: 0.30 },
      { q: 3.6, f: 950, sweep: 520, rate: 0.027, pan: 0.68, g: 0.16 },
    ];
    windBus = bus(0.85, 0.35);
    windBus.dry.connect(bedFilter);
    for (let i = 0; i < windSpec.length; i++) {
      const s = windSpec[i];
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      src.playbackRate.value = 0.7 + i * 0.15;

      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = s.f;
      bp.Q.value = s.q;

      const lfo = ac.createOscillator();
      lfo.frequency.value = s.rate;
      const lfoG = ac.createGain();
      lfoG.gain.value = s.sweep;
      lfo.connect(lfoG);
      lfoG.connect(bp.frequency);
      lfo.start();

      const g = ac.createGain();
      g.gain.value = s.g * 0.5;

      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      src.connect(bp); bp.connect(g);
      if (pan) { pan.pan.value = s.pan; g.connect(pan); pan.connect(windBus.node); }
      else g.connect(windBus.node);

      src.start();
      windGains.push({ g, base: s.g });
      windFilters.push(bp);
    }

    // ── drone: three detuned low voices, slow independent breathing ──
    droneBus = bus(0.9, 0.5);
    droneBus.dry.connect(bedFilter);
    const droneSpec = [
      { f: 55.0, type: 'sine', g: 0.30, rate: 0.055 },
      { f: 73.42, type: 'triangle', g: 0.13, rate: 0.037 },
      { f: 110.2, type: 'sine', g: 0.16, rate: 0.029 },
    ];
    for (let i = 0; i < droneSpec.length; i++) {
      const s = droneSpec[i];
      const o = ac.createOscillator();
      o.type = s.type;
      o.frequency.value = s.f;
      o.detune.value = (i - 1) * 6;
      const g = ac.createGain();
      g.gain.value = s.g * 0.7;

      const lfo = ac.createOscillator();
      lfo.frequency.value = s.rate;
      const lfoG = ac.createGain();
      lfoG.gain.value = s.g * 0.35;
      lfo.connect(lfoG);
      lfoG.connect(g.gain);
      lfo.start();

      o.connect(g); g.connect(droneBus.node);
      o.start();
    }

    // ── pad: four persistent voices drifting over a pentatonic set ──
    padBus = bus(0.55, 1.0);
    padBus.dry.connect(bedFilter);
    for (let i = 0; i < 4; i++) {
      const g = ac.createGain();
      g.gain.value = 0;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      lp.Q.value = 0.5;

      const a = ac.createOscillator(); a.type = 'triangle';
      const b = ac.createOscillator(); b.type = 'sine';
      a.detune.value = -5; b.detune.value = 6;
      const bg = ac.createGain(); bg.gain.value = 0.55;

      a.connect(lp); b.connect(bg); bg.connect(lp);
      lp.connect(g); g.connect(padBus.node);

      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (pan) { pan.pan.value = (i - 1.5) * 0.42; g.disconnect(); g.connect(pan); pan.connect(padBus.node); }

      a.start(); b.start();
      padVoices.push({ a, b, g, lp, t: i * 4.5, state: 'wait', dur: 3 + i * 2.5, level: 0.055 });
    }

    // ── fx bus: bright, dry-ish, heavily reverbed; bypasses the dawn filter ──
    fxBus = bus(0.95, 0.9);
    fxBus.dry.connect(duck);

    ready = true;
    applyPhase(phaseName, 0.5);
    master.gain.setValueAtTime(0.0001, ac.currentTime);
    master.gain.linearRampToValueAtTime(0.55, ac.currentTime + 3);
  }

  /* ── helpers ────────────────────────────────────────────────────────────── */

  function ramp(param, value, tau) {
    param.setTargetAtTime(value, ac.currentTime, tau);
  }

  function noiseHit(dest, when, dur, type, f, q, peak, attack) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = type;
    bp.frequency.setValueAtTime(f, when);
    bp.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(bp); bp.connect(g); g.connect(dest);
    src.start(when);
    src.stop(when + dur + 0.05);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
    return bp;
  }

  function tone(dest, when, freq, dur, peak, type, attack) {
    const o = ac.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, when);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + (attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.05);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
    return o;
  }

  /* ── public: mix ────────────────────────────────────────────────────────── */

  function applyPhase(name, tau) {
    const m = PHASE_MIX[name] || PHASE_MIX.lantern;
    windLevel = m.wind; droneLevel = m.drone; padLevel = m.pad;
    ramp(droneBus.node.gain, droneLevel, tau === undefined ? 3.5 : tau);
    ramp(padBus.node.gain, padLevel, tau === undefined ? 4.5 : tau);
    ramp(wetGain.gain, name === 'breathing' || name === 'ending' ? 1.05 : 0.85, 4);
  }

  function setPhase(name) {
    phaseName = name;
    if (!ready) return;
    applyPhase(name);
  }

  function setWind(v01) {
    duckTarget = clamp01(v01);
    if (!ready) return;
    ramp(duck.gain, duckTarget, 0.25);
  }

  function setDawn(v01) {
    dawnTarget = clamp01(v01);
    if (!ready) return;
    // The bed opens as the sun comes up and closes as it goes down — the mode
    // owns which of those it is.
    ramp(bedFilter.frequency, bedCutoff(dawnTarget), 2.5);
  }

  /* ── public: one-shots ──────────────────────────────────────────────────── */

  function lanternLight() {
    if (!ready) return;
    const t = ac.currentTime + 0.01;
    // the catch
    noiseHit(fxBus.node, t, 0.34, 'bandpass', 2100, 1.1, 0.30, 0.008);
    noiseHit(fxBus.node, t, 0.9, 'lowpass', 700, 0.8, 0.16, 0.03);
    // a low bell-ish partial
    tone(fxBus.node, t + 0.01, 233.1, 2.4, 0.16, 'sine', 0.006);
    tone(fxBus.node, t + 0.01, 349.2, 1.5, 0.075, 'sine', 0.006);
    // the warm swell after it
    tone(fxBus.node, t + 0.06, 116.5, 4.5, 0.12, 'triangle', 1.1);
    tone(fxBus.node, t + 0.06, 174.6, 4.0, 0.065, 'sine', 1.3);
  }

  function breathCue(dir) {
    if (!ready) return;
    const t = ac.currentTime + 0.01;
    if (dir === 'inhale') {
      const bp = noiseHit(fxBus.node, t, 4.4, 'bandpass', 340, 1.0, 0.80, 2.6);
      bp.frequency.linearRampToValueAtTime(1150, t + 4.2);
      tone(fxBus.node, t, 293.66, 4.4, 0.13, 'sine', 2.8);
    } else {
      const bp = noiseHit(fxBus.node, t, 6.2, 'bandpass', 900, 0.85, 0.90, 0.7);
      bp.frequency.linearRampToValueAtTime(260, t + 5.8);
      tone(fxBus.node, t, 146.83, 6.0, 0.15, 'triangle', 1.0);
    }
  }

  function bell(force) {
    if (!ready) return;
    const f = clamp01(force === undefined ? 1 : force);
    const t = ac.currentTime + 0.01;
    const f0 = 174.61;
    const amp = 0.40 * (0.45 + 0.55 * f);

    for (let i = 0; i < BELL_PARTIALS.length; i++) {
      const copies = i < 4 ? 2 : 1;          // beating on the strong partials only
      for (let c = 0; c < copies; c++) {
        const detune = c === 0 ? 0 : 0.42 / (i + 1);   // Hz — a slow shimmer
        const freq = f0 * BELL_PARTIALS[i] + detune;
        const o = ac.createOscillator();
        o.type = 'sine';
        // slight pitch drop as the strike settles
        o.frequency.setValueAtTime(freq * 1.018, t);
        o.frequency.exponentialRampToValueAtTime(freq, t + 0.14);

        const g = ac.createGain();
        const peak = amp * BELL_GAINS[i] / copies;
        const dec = BELL_DECAYS[i] * (0.75 + 0.25 * f);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.006 + i * 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);

        o.connect(g); g.connect(fxBus.node);
        o.start(t);
        o.stop(t + dec + 0.1);
        o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
      }
    }
    // the strike itself
    noiseHit(fxBus.node, t, 0.09, 'highpass', 2600, 0.7, 0.30 * f, 0.002);
    noiseHit(fxBus.node, t, 0.22, 'bandpass', 3400, 2.4, 0.20 * f, 0.003);
  }

  function chime() {
    if (!ready) return;
    const t = ac.currentTime + 0.01;
    const f0 = 587.33;                        // D5 — light, high, brief
    const ratios = [1, 2.76, 5.4];
    const decays = [3.6, 2.2, 1.4];
    const gains = [0.13, 0.05, 0.024];
    for (let i = 0; i < ratios.length; i++) {
      tone(fxBus.node, t, f0 * ratios[i], decays[i], gains[i], 'sine', 0.008);
      if (i === 0) tone(fxBus.node, t, f0 * ratios[i] + 0.35, decays[i], gains[i] * 0.8, 'sine', 0.01);
    }
    noiseHit(fxBus.node, t, 0.06, 'highpass', 4200, 0.7, 0.09, 0.002);
  }

  /* ── sparse world events ────────────────────────────────────────────────── */

  function sparseEvent() {
    const t = ac.currentTime + 0.02;
    const kind = Math.random();
    if (kind < 0.45) {
      // a distant bird, two notes, soft and unhurried
      const base = 1400 + Math.random() * 900;
      tone(fxBus.node, t, base, 0.22, 0.030, 'sine', 0.03);
      tone(fxBus.node, t + 0.26, base * 1.19, 0.3, 0.022, 'sine', 0.04);
    } else if (kind < 0.78) {
      // a wooden creak somewhere below
      const bp = noiseHit(fxBus.node, t, 1.1, 'bandpass', 320, 6.5, 0.16, 0.25);
      bp.frequency.linearRampToValueAtTime(210, t + 1.0);
    } else {
      // a stone settling
      tone(fxBus.node, t, 92 + Math.random() * 40, 1.3, 0.048, 'triangle', 0.02);
      noiseHit(fxBus.node, t, 0.3, 'lowpass', 520, 0.8, 0.06, 0.01);
    }
  }

  /* ── pad scheduler ──────────────────────────────────────────────────────── */

  function tickPad(dt) {
    for (let i = 0; i < padVoices.length; i++) {
      const v = padVoices[i];
      v.t += dt;
      if (v.t < v.dur) continue;
      v.t = 0;
      if (v.state === 'wait') {
        const n = PAD_NOTES[(Math.random() * PAD_NOTES.length) | 0];
        v.a.frequency.setTargetAtTime(n, ac.currentTime, 0.4);
        v.b.frequency.setTargetAtTime(n * 2, ac.currentTime, 0.4);
        v.lp.frequency.setTargetAtTime(900 + Math.random() * 1600, ac.currentTime, 2);
        v.g.gain.setTargetAtTime(v.level * (0.6 + Math.random() * 0.6), ac.currentTime, 3.0);
        v.state = 'on';
        v.dur = 9 + Math.random() * 9;
      } else {
        v.g.gain.setTargetAtTime(0.0001, ac.currentTime, 3.4);
        v.state = 'wait';
        v.dur = 5 + Math.random() * 9;
      }
    }
  }

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt, state) {
    if (!ready) return;
    if (state) {
      gustTarget = state.windGust;
      pendingDawn = state.dawn;
    }

    tickPad(dt);

    // wind amplitude follows the shared gust envelope — retimed, not re-nodded
    paramTimer += dt;
    if (paramTimer > 0.12) {
      paramTimer = 0;
      if (Math.abs(pendingDawn - dawnTarget) > 0.004) setDawn(pendingDawn);
      const g = 0.35 + 0.85 * clamp01(gustTarget);
      for (let i = 0; i < windGains.length; i++) {
        ramp(windGains[i].g.gain, windGains[i].base * g * windLevel, 0.9);
      }
    }

    sparseTimer -= dt;
    if (sparseTimer <= 0) {
      sparseTimer = 25 + Math.random() * 22;
      if (duckTarget > 0.5) sparseEvent();
    }
  }

  /* ── unlock ─────────────────────────────────────────────────────────────── */

  function unlock() {
    if (ready) { try { if (ac.state === 'suspended') ac.resume(); } catch (e) { /* noop */ } return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
      build();
      try { if (ac.state === 'suspended') ac.resume(); } catch (e) { /* noop */ }
    } catch (e) {
      ready = false;                     // silent, never fatal
    }
  }

  return { unlock, setPhase, setWind, setDawn, lanternLight, breathCue, bell, chime, update };
}
