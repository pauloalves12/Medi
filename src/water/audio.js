/**
 * audio.js — the lake, synthesised. No files, no samples.
 * @see water/main.js MODULE CONTRACT
 *
 * A bed of four things — wind through pines, water moving somewhere along the
 * shore, a low drone and a sparse cold pad — through a long, cold reverb.
 *
 * The settle takes them away. Not by turning a master down, which would only
 * make the same sound quieter, but by closing a filter over the bed, thinning
 * the wind and the lapping toward nothing, spacing the incidental sounds
 * further and further apart, and opening the reverb as it goes. What is left at
 * the end is a drone, a long tail, and a great deal of room — the same lake with
 * everything that was moving on it stopped.
 *
 * The hour changes the room, not the shape. MOONLIT is a bowl of rock at night:
 * a long cold tail, a bed that closes down to a drone, and something calling in
 * the trees once in a while. DAY is open air over water: a shorter, drier tail,
 * a bed that stays bright and merely gets quieter, and birds. Everything that
 * differs is a number in `mood.curves.audio` — the arc through the phases is the
 * same arc, and PHASE_MIX below is shared.
 */

const PHASE_MIX = {
  title:      { wind: 0.80, lap: 0.55, drone: 0.50, pad: 0.22 },
  approach:   { wind: 1.00, lap: 0.62, drone: 0.72, pad: 0.30 },
  shore:      { wind: 0.86, lap: 1.00, drone: 0.82, pad: 0.42 },
  settling:   { wind: 0.80, lap: 0.95, drone: 0.86, pad: 0.52 },
  breathing:  { wind: 0.62, lap: 0.80, drone: 0.94, pad: 0.86 },
  reflection: { wind: 0.58, lap: 0.72, drone: 0.96, pad: 0.72 },
  stillness:  { wind: 0.46, lap: 0.58, drone: 1.00, pad: 0.60 },
  reveal:     { wind: 0.34, lap: 0.42, drone: 1.00, pad: 0.78 },
  complete:   { wind: 0.24, lap: 0.30, drone: 0.62, pad: 0.44 },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createLakeAudio(ctx) {
  const curves = ctx.mood.curves;
  const A = curves.audio;
  const PAD_NOTES = A.padNotes;

  let ac = null;
  let ready = false;

  let master, duck, bedFilter, comp, convolver, wetGain;
  let windBus, lapBus, droneBus, padBus, fxBus;
  const windGains = [];
  let lapGain = null, lapFilter = null;
  let noiseBuffer = null;
  const padVoices = [];

  let mix = PHASE_MIX.title;
  let phaseName = 'title';
  let settle = 0;
  let gust = 0.5;
  let duckTarget = 1;
  let sparseTimer = 22;
  let paramTimer = 0;

  /* ── buffers ────────────────────────────────────────────────────────────── */

  function makeNoiseBuffer(seconds) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = w * 0.5 + last * 2.5;
      }
      const fadeN = Math.min(2048, (n / 8) | 0);
      for (let i = 0; i < fadeN; i++) {
        const k = i / fadeN;
        d[i] *= k;
        d[n - 1 - i] *= k;
      }
    }
    return buf;
  }

  /** The hour's room. See `mood.curves.audio.room`. */
  function makeImpulse(seconds, decay) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
      const refl = [0.019, 0.031, 0.048, 0.071, 0.104, 0.147];
      for (let r = 0; r < refl.length; r++) {
        const idx = Math.floor(refl[r] * ac.sampleRate) + (c ? 83 : 0);
        if (idx < n) d[idx] += (r % 2 ? -1 : 1) * 0.42 / (r + 1);
      }
    }
    return buf;
  }

  function bus(dry, wet) {
    const g = ac.createGain(); g.gain.value = 1;
    const d = ac.createGain(); d.gain.value = dry;
    const w = ac.createGain(); w.gain.value = wet;
    g.connect(d);
    g.connect(w);
    w.connect(convolver);
    return { node: g, dry: d, wet: w };
  }

  /* ── graph ──────────────────────────────────────────────────────────────── */

  function build() {
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 26;
    comp.ratio.value = 3.0;
    comp.attack.value = 0.012;
    comp.release.value = 0.45;
    comp.connect(ac.destination);

    master = ac.createGain();
    master.gain.value = 0;
    master.connect(comp);

    duck = ac.createGain();
    duck.gain.value = 1;
    duck.connect(master);

    convolver = ac.createConvolver();
    convolver.buffer = makeImpulse(A.room.seconds, A.room.decay);
    wetGain = ac.createGain();
    wetGain.gain.value = 0.8;
    convolver.connect(wetGain);
    wetGain.connect(duck);

    // everything textural sits behind this; the settle closes it
    bedFilter = ac.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 1400;
    bedFilter.Q.value = 0.4;
    bedFilter.connect(duck);

    noiseBuffer = makeNoiseBuffer(4);

    /* wind — two voices, wide, both softer than Ascent's: a lake at night in
       a bowl of mountains is a sheltered place */
    windBus = bus(0.82, 0.40);
    windBus.dry.connect(bedFilter);
    const windSpec = [
      { q: 0.6, f: 310, sweep: 150, rate: 0.031, pan: -0.7, g: 0.22 },
      { q: 3.2, f: 780, sweep: 400, rate: 0.023, pan: 0.66, g: 0.10 },
    ];
    for (let i = 0; i < windSpec.length; i++) {
      const s = windSpec[i];
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer; src.loop = true;
      src.playbackRate.value = 0.62 + i * 0.13;

      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = s.f; bp.Q.value = s.q;

      const lfo = ac.createOscillator(); lfo.frequency.value = s.rate;
      const lfoG = ac.createGain(); lfoG.gain.value = s.sweep;
      lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start();

      const g = ac.createGain(); g.gain.value = s.g * 0.4;
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      src.connect(bp); bp.connect(g);
      if (pan) { pan.pan.value = s.pan; g.connect(pan); pan.connect(windBus.node); }
      else g.connect(windBus.node);
      src.start();
      windGains.push({ g, base: s.g });
    }

    /* water — one narrow noise voice with a slow swell on it. Not a shoreline
       you are standing in: a shoreline somewhere off to the side. */
    lapBus = bus(0.75, 0.55);
    lapBus.dry.connect(bedFilter);
    {
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer; src.loop = true;
      src.playbackRate.value = 0.42;

      lapFilter = ac.createBiquadFilter();
      lapFilter.type = 'bandpass';
      lapFilter.frequency.value = 470;
      lapFilter.Q.value = 1.3;

      lapGain = ac.createGain();
      lapGain.gain.value = 0.16;

      // two incommensurable slow swells, so it never falls into a pulse
      for (const [rate, depth] of [[0.081, 0.085], [0.037, 0.055]]) {
        const lfo = ac.createOscillator(); lfo.frequency.value = rate;
        const lg = ac.createGain(); lg.gain.value = depth;
        lfo.connect(lg); lg.connect(lapGain.gain); lfo.start();
      }
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      src.connect(lapFilter); lapFilter.connect(lapGain);
      if (pan) { pan.pan.value = -0.35; lapGain.connect(pan); pan.connect(lapBus.node); }
      else lapGain.connect(lapBus.node);
      src.start();
    }

    /* drone */
    droneBus = bus(0.9, 0.55);
    droneBus.dry.connect(bedFilter);
    const droneSpec = [
      { f: 55.00, type: 'sine', g: 0.30, rate: 0.047 },
      { f: 82.41, type: 'sine', g: 0.15, rate: 0.033 },
      { f: 110.0, type: 'triangle', g: 0.09, rate: 0.026 },
    ];
    for (let i = 0; i < droneSpec.length; i++) {
      const s = droneSpec[i];
      const o = ac.createOscillator();
      o.type = s.type; o.frequency.value = s.f; o.detune.value = (i - 1) * 5;
      const g = ac.createGain(); g.gain.value = s.g * 0.7;
      const lfo = ac.createOscillator(); lfo.frequency.value = s.rate;
      const lfoG = ac.createGain(); lfoG.gain.value = s.g * 0.30;
      lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
      o.connect(g); g.connect(droneBus.node);
      o.start();
    }

    /* pad — three voices, sparser and higher than Ascent's, mostly reverb */
    padBus = bus(0.42, 1.0);
    padBus.dry.connect(bedFilter);
    for (let i = 0; i < 3; i++) {
      const g = ac.createGain(); g.gain.value = 0;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.5;
      const a = ac.createOscillator(); a.type = 'sine';
      const b = ac.createOscillator(); b.type = 'triangle';
      a.detune.value = -4; b.detune.value = 5;
      const bg = ac.createGain(); bg.gain.value = 0.35;
      a.connect(lp); b.connect(bg); bg.connect(lp);
      lp.connect(g);
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (pan) { pan.pan.value = (i - 1) * 0.5; g.connect(pan); pan.connect(padBus.node); }
      else g.connect(padBus.node);
      a.start(); b.start();
      padVoices.push({ a, b, g, lp, t: i * 6.5, state: 'wait', dur: 4 + i * 3.5, level: 0.042 });
    }

    /* fx — the breath and the one tone at the end, bypassing the bed filter */
    fxBus = bus(0.92, 1.0);
    fxBus.dry.connect(duck);

    ready = true;
    applyPhase(phaseName, 0.5);
    master.gain.setValueAtTime(0.0001, ac.currentTime);
    master.gain.linearRampToValueAtTime(0.50, ac.currentTime + 3.5);
  }

  /* ── helpers ────────────────────────────────────────────────────────────── */

  function ramp(param, value, tau) {
    param.setTargetAtTime(value, ac.currentTime, tau);
  }

  function noiseHit(dest, when, dur, type, f, q, peak, attack) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer; src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = type; bp.frequency.setValueAtTime(f, when); bp.Q.value = q;
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

  /* ── mix ────────────────────────────────────────────────────────────────── */

  function applyPhase(name, tau) {
    mix = PHASE_MIX[name] || PHASE_MIX.settling;
    const t = tau === undefined ? 4.0 : tau;
    ramp(droneBus.node.gain, mix.drone, t);
    ramp(padBus.node.gain, mix.pad, t + 1.5);
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

  /* ── one-shots ──────────────────────────────────────────────────────────── */

  function breathCue(dir) {
    if (!ready) return;
    const t = ac.currentTime + 0.01;
    // Barely there. The ring on the water is the instruction; this is only so
    // that the rhythm survives being looked away from.
    if (dir === 'inhale') {
      const bp = noiseHit(fxBus.node, t, 4.2, 'bandpass', 300, 1.1, 0.30, 2.6);
      bp.frequency.linearRampToValueAtTime(820, t + 4.0);
      tone(fxBus.node, t, 220.0, 4.4, 0.045, 'sine', 2.8);
    } else {
      const bp = noiseHit(fxBus.node, t, 5.8, 'bandpass', 700, 0.9, 0.34, 0.8);
      bp.frequency.linearRampToValueAtTime(215, t + 5.4);
      tone(fxBus.node, t, 110.0, 5.6, 0.055, 'sine', 1.1);
    }
  }

  /** The single sound the ending makes. Low, distant, and over almost at once. */
  function open() {
    if (!ready) return;
    const t = ac.currentTime + 0.02;
    tone(fxBus.node, t, 82.41, 9.0, 0.075, 'sine', 2.6);
    tone(fxBus.node, t + 0.4, 164.81, 7.5, 0.030, 'sine', 3.0);
    tone(fxBus.node, t + 0.9, 246.94, 6.0, 0.014, 'sine', 3.4);
  }

  /* ── incidental ─────────────────────────────────────────────────────────── */

  /**
   * One incidental sound. Which of the three it is comes off the hour's own
   * weights: at night the distant call is the rarest thing on the lake and the
   * shore is the commonest, and in the morning that order is the other way
   * round and the call sits an octave and a half higher. Nothing else about
   * the bed says which hour it is, and it does not need to.
   */
  function sparseEvent() {
    const t = ac.currentTime + 0.02;
    const S = A.sparse;
    const kind = Math.random() * (S.lap + S.tree + S.call);
    if (kind < S.lap) {
      // a single lap against a stone somewhere along the shore
      const bp = noiseHit(fxBus.node, t, 0.75, 'bandpass', 340 + Math.random() * 260, 2.2, 0.075, 0.06);
      bp.frequency.linearRampToValueAtTime(190, t + 0.7);
    } else if (kind < S.lap + S.tree) {
      // something settling in the trees
      tone(fxBus.node, t, 78 + Math.random() * 34, 1.6, 0.030, 'triangle', 0.05);
      noiseHit(fxBus.node, t, 0.35, 'lowpass', 430, 0.7, 0.032, 0.02);
    } else {
      // one distant two-note call
      const base = S.callHz + Math.random() * S.callSpread;
      tone(fxBus.node, t, base, 0.5, S.callI, 'sine', 0.09);
      tone(fxBus.node, t + 0.52, base * 0.84, 0.7, S.callI * 0.69, 'sine', 0.12);
    }
  }

  function tickPad(dt) {
    for (let i = 0; i < padVoices.length; i++) {
      const v = padVoices[i];
      v.t += dt;
      if (v.t < v.dur) continue;
      v.t = 0;
      if (v.state === 'wait') {
        const n = PAD_NOTES[(Math.random() * PAD_NOTES.length) | 0];
        v.a.frequency.setTargetAtTime(n, ac.currentTime, 0.5);
        v.b.frequency.setTargetAtTime(n * 2, ac.currentTime, 0.5);
        v.lp.frequency.setTargetAtTime(700 + Math.random() * 1300, ac.currentTime, 2.5);
        v.g.gain.setTargetAtTime(v.level * (0.5 + Math.random() * 0.7), ac.currentTime, 3.5);
        v.state = 'on';
        v.dur = 11 + Math.random() * 11;
      } else {
        v.g.gain.setTargetAtTime(0.0001, ac.currentTime, 4.0);
        v.state = 'wait';
        // the gaps between the pad's own notes open with everything else
        v.dur = (6 + Math.random() * 10) * (1 + settle * 1.4);
      }
    }
  }

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt, state) {
    if (!ready) return;
    if (state) {
      settle = clamp01(state.settle);
      gust = clamp01(state.windGust);
    }

    tickPad(dt);

    paramTimer += dt;
    if (paramTimer > 0.15) {
      paramTimer = 0;
      const w = (0.30 + 0.85 * gust) * A.windGain(settle);
      for (let i = 0; i < windGains.length; i++) {
        ramp(windGains[i].g.gain, windGains[i].base * w * mix.wind, 1.4);
      }
      ramp(lapBus.node.gain, A.lapGain(settle) * mix.lap, 2.0);
      ramp(lapFilter.frequency, A.lapCutoff(settle), 3.0);
      ramp(bedFilter.frequency, A.cutoff(settle), 3.0);
      ramp(wetGain.gain, A.wet(settle), 3.5);
      ramp(master.gain, 0.50 * A.master(settle), 3.0);
    }

    sparseTimer -= dt;
    if (sparseTimer <= 0) {
      const gap = A.sparseGap(settle);
      sparseTimer = gap + Math.random() * gap * 0.8;
      if (duckTarget > 0.5 && phaseName !== 'title') sparseEvent();
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

  return { unlock, setPhase, setWind, breathCue, open, update };
}
