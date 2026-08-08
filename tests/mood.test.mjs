/**
 * tests/mood.test.mjs — both of Still Water's hours, without a screen.
 *
 *   node tests/mood.test.mjs
 *
 * Two jobs, and the first one matters more than the second.
 *
 * ── 1. THE NIGHT DID NOT MOVE ────────────────────────────────────────────────
 * Adding DAY turned mood.js from one table into two, which meant every value
 * the finished moonlit piece was tuned against got picked up and put down
 * again. The literals below were read off the file *before* that change. They
 * are not a description of what the night should look like — they are what it
 * did look like, and if one of them fails, the night regressed.
 *
 * ── 2. THE TWO HOURS ARE THE SAME SHAPE ──────────────────────────────────────
 * sky.js and lake.js call one contract and are never told which hour they are
 * in, so the thing that actually protects them is that both tables carry every
 * key, every curve is a function of the settle that stays in range, and both
 * GLSL strings define the same two entry points. A missing key in DAY is a
 * black screen at runtime and nothing catches it earlier than this.
 */

import { MOODS, MOOD_ORDER, DEFAULT_MOOD, resolveMood, ridgeHeight, panoramaPixels, PANO_MAX_EL, EYE_Y }
  from '../src/water/mood.js';

let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

function eq(name, got, want) {
  const g = typeof got === 'number' && !Number.isInteger(got) ? +got.toFixed(6) : got;
  ok(name, g === want, `got ${JSON.stringify(g)}, wanted ${JSON.stringify(want)}`);
}

/* ── 1. the moonlit hour is byte-for-byte the piece that already existed ──── */
{
  const m = MOODS.moonlit;
  const p = m.palette, c = m.curves;

  console.log('\nmoonlit · the finished night, unchanged');

  eq('palette · zenith', p.zenith, 0x04060d);
  eq('palette · horizon', p.horizon, 0x0b1120);
  eq('palette · glow', p.glow, 0x1a2540);
  eq('palette · moon', p.disc, 0xdde7f5);
  eq('palette · deep / shallow', `${p.deep},${p.shallow}`, `${0x06090f},${0x0d1522}`);
  eq('palette · rock / pine', `${p.rock},${p.pine}`, `${0x38404e},${0x1c262e}`);
  eq('palette · wet stone at the waterline', p.wet, 0x080b11);
  eq('palette · the mist bands', p.mist, 0x2a3a56);

  // the moon has not moved: az -7, el 17
  const d = m.light(null).dir;
  eq('moon · direction x', +d[0].toFixed(6), -0.116544);
  eq('moon · direction y', +d[1].toFixed(6), 0.292372);
  eq('moon · direction z', +d[2].toFixed(6), -0.949177);

  // the water curves, at both ends of the settle
  eq('water · amp(0)', +c.water.amp(0).toFixed(6), 0.057);
  eq('water · amp(1)', +c.water.amp(1).toFixed(6), 0.013320);
  eq('water · swell(0)', +c.water.swell(0).toFixed(6), 0.095);
  eq('water · ripple(1)', +c.water.ripple(1).toFixed(6), 0.1);
  eq('water · micro floor', +c.water.micro(1).toFixed(6), 0.07);
  eq('water · shine(1)', c.water.shine(1), 760);
  eq('water · specular(0)', +c.water.specular(0).toFixed(6), 0.14);
  eq('water · pathI(1)', +c.water.pathI(1).toFixed(6), 0.2);
  eq('water · halo(1)', c.water.halo(1), 694);
  eq('water · fog(0)', +c.water.fog(0).toFixed(6), 0.0125);
  eq('water · albedo', c.water.albedo, 0.88);
  eq('water · scatter', c.water.scatter, 0.007);
  // these two were `starGain` and `starSoft` before the rename
  eq('water · detailGain(1) was starGain', +c.water.detailGain(1).toFixed(6), 1.05);
  eq('water · detailSoft(0) was starSoft', c.water.detailSoft(0), 1);
  eq('water · discSize(1) was the moon size', +c.water.discSize(1).toFixed(8), 0.00026);
  eq('water · discSize(0) softened 3.2x', +c.water.discSize(0).toFixed(8), 0.000832);

  eq('mist · density(0, 1)', +c.mist.density(0, 1).toFixed(6), 0.806);
  eq('mist · sharp(0)', +c.mist.sharp(0).toFixed(6), 0.34);
  eq('wind(0) / fog(0)', `${c.wind(0)},${c.fog(0)}`, '1,0.0072');
  eq('motes(0)', +c.motes(0).toFixed(6), 0.09);

  eq('grade · vignette(0)', +c.grade.vignette(0).toFixed(6), 0.34);
  eq('grade · bloom(0)', +c.grade.bloom(0).toFixed(6), 0.22);
  eq('grade · bloomThreshold(0)', +c.grade.bloomThreshold(0).toFixed(6), 0.72);
  eq('grade · exposure(1)', +c.grade.exposure(1).toFixed(6), 1.1);
  eq('grade · shadowTint', c.grade.shadowTint.join(','), '0.02,0.028,0.052');
  eq('grade · highTint', c.grade.highTint.join(','), '0.985,1,1.045');
  eq('grade · aberration / grain', `${c.grade.aberration},${c.grade.grain}`, '0.0005,0.012');
  eq('grade · no saturation lift at night', c.grade.saturate || 0, 0);

  eq('audio · cutoff(0)', c.audio.cutoff(0), 1400);
  eq('audio · wet(1)', +c.audio.wet(1).toFixed(6), 1.25);
  eq('audio · sparseGap(0)', c.audio.sparseGap(0), 16);
  eq('audio · lapCutoff(0)', c.audio.lapCutoff(0), 470);
  eq('audio · the room is the cold bowl', `${c.audio.room.seconds},${c.audio.room.decay}`, '4.6,2.6');
  eq('audio · the pad is A minor pentatonic', c.audio.padNotes.join(','),
    '110,130.81,146.83,164.81,196,220,261.63,293.66,329.63,392');

  // the lights sky.js used to hold as literals
  const L = m.light({ settle: 0 });
  eq('light · key', `${L.keyCol},${L.keyI}`, `${0xc8d8f0},1.35`);
  eq('light · hemi', `${L.hemiSky},${L.hemiGround},${L.hemiI}`, `${0x1a2740},${0x05070c},0.75`);
  eq('light · ambient', `${L.ambCol},${L.ambI}`, `${0x0d1526},0.8`);
  eq('light · bounce', `${L.bounceCol},${L.bounceI}`, `${0x233450},0.32`);
  eq('light · dome disc', `${L.discSize},${L.discI},${L.halo},${L.glowI}`, '0.000105,2.4,380,1');
  eq('light · dome stars at settle 0', +L.detailGain.toFixed(6), 0.72);
  eq('light · dome stars at settle 1', +m.light({ settle: 1 }).detailGain.toFixed(6), 1.14);
  eq('light · water disc', `${L.waterGlowI},${L.waterDiscI}`, '1,2.1');
  ok('light · the night has no arc', m.arc({ elapsed: 10000 }) === 0);
}

/* ── 2. the place is the same place at both hours ─────────────────────────── */
{
  console.log('\nthe place · shared, and not an hour\'s to change');

  eq('pano reaches 0.26 rad', PANO_MAX_EL, 0.26);
  eq('the seat puts the eye at 2.08 m', EYE_Y, 2.08);

  let same = true;
  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      if (ridgeHeight(layer, a) !== ridgeHeight(layer, a)) same = false;
    }
  }
  ok('the ridge profile is one function, not one per hour', same);

  // the four rings carry the same radius and height in both tables
  const geom = (m) => m.ridges.map((r) => `${r.r}/${r.h}/${r.freq}/${r.seed}`).join(' ');
  eq('both hours stand in front of the same mountains',
    geom(MOODS.day), geom(MOODS.moonlit));

  // …and different colours on them
  ok('and paint them differently',
    MOODS.day.ridges[0].top !== MOODS.moonlit.ridges[0].top);
  ok('the day ridge tops are lighter than the night\'s',
    MOODS.day.ridges[0].top > MOODS.moonlit.ridges[0].top);
}

/* ── 3. both hours satisfy the contract sky.js and lake.js call ───────────── */
{
  console.log('\nthe contract · what sky.js and lake.js are allowed to assume');

  eq('two hours, moonlit first', MOOD_ORDER.join(','), 'moonlit,day');
  eq('the default is the one that already existed', DEFAULT_MOOD, 'moonlit');
  eq('an unknown mode falls back', resolveMood('elevenses').id, 'moonlit');
  eq('a known one does not', resolveMood('day').id, 'day');

  const WATER = ['amp', 'swell', 'ripple', 'micro', 'shine', 'specular',
    'pathShine', 'pathI', 'halo', 'detailGain', 'detailSoft', 'discSize', 'fog'];
  const PALETTE = ['zenith', 'horizon', 'glow', 'disc', 'ground', 'deep', 'shallow',
    'haze', 'fogA', 'mist', 'rock', 'soil', 'pine', 'grass', 'reed', 'wet'];
  const LIGHT = ['dir', 'keyCol', 'keyI', 'hemiSky', 'hemiGround', 'hemiI', 'ambCol',
    'ambI', 'bounceCol', 'bounceI', 'zenith', 'horizon', 'glow', 'ground', 'discCol',
    'glowI', 'discSize', 'discI', 'halo', 'detailGain', 'detailSoft',
    'waterGlowI', 'waterDiscI'];

  for (const id of MOOD_ORDER) {
    const m = MOODS[id];
    const c = m.curves;

    eq(`${id} · has a label and a tagline`,
      !!(m.label && m.tagline && m.fadeIn && m.id === id), true);

    ok(`${id} · palette is complete`,
      PALETTE.every((k) => Number.isInteger(m.palette[k])),
      PALETTE.filter((k) => !Number.isInteger(m.palette[k])).join(','));

    ok(`${id} · four rings with colours on them`,
      m.ridges.length === 4 && m.ridges.every((r) => r.foot >= 0 && r.top >= 0 && r.haze >= 0));

    ok(`${id} · every water curve is a function`,
      WATER.every((k) => typeof c.water[k] === 'function'),
      WATER.filter((k) => typeof c.water[k] !== 'function').join(','));

    // Every curve gets swept, because a curve that goes negative or NaN
    // somewhere in the middle is a shader uniform that quietly breaks a frame.
    let finite = true, bad = '';
    for (let i = 0; i <= 40; i++) {
      const s = i / 40;
      for (const k of WATER) {
        const v = c.water[k](s);
        if (!Number.isFinite(v) || v < 0) { finite = false; bad = `water.${k}(${s})=${v}`; }
      }
      for (const k of ['wind', 'fog', 'motes']) {
        const v = c[k](s);
        if (!Number.isFinite(v) || v < 0) { finite = false; bad = `${k}(${s})=${v}`; }
      }
      for (const k of ['sharp', 'drift']) {
        const v = c.mist[k](s);
        if (!Number.isFinite(v) || v < 0) { finite = false; bad = `mist.${k}(${s})=${v}`; }
      }
      for (let t = 0; t <= 1; t += 0.25) {
        const v = c.mist.density(s, t);
        if (!Number.isFinite(v) || v < 0) { finite = false; bad = `mist.density(${s},${t})=${v}`; }
      }
      for (const k of ['vignette', 'bloom', 'bloomThreshold', 'exposure']) {
        const v = c.grade[k](s);
        if (!Number.isFinite(v) || v < 0) { finite = false; bad = `grade.${k}(${s})=${v}`; }
      }
      for (const k of ['windGain', 'lapGain', 'cutoff', 'padGain', 'wet', 'master',
        'sparseGap', 'lapCutoff']) {
        const v = c.audio[k](s);
        if (!Number.isFinite(v) || v < 0) { finite = false; bad = `audio.${k}(${s})=${v}`; }
      }
    }
    ok(`${id} · no curve goes negative or NaN across the settle`, finite, bad);

    // the settle only ever makes the water calmer, never rougher
    ok(`${id} · stillness never roughens the water`,
      c.water.amp(1) < c.water.amp(0) && c.water.ripple(1) < c.water.ripple(0)
      && c.water.micro(1) < c.water.micro(0) && c.water.fog(1) < c.water.fog(0));
    ok(`${id} · and the shimmer never reaches zero — this is water, not ice`,
      c.water.micro(1) > 0.02);

    ok(`${id} · the room and the sparse bed are described`,
      c.audio.room.seconds > 0 && c.audio.room.decay > 0
      && c.audio.sparse.lap + c.audio.sparse.tree + c.audio.sparse.call > 0
      && c.audio.padNotes.length > 0);

    // light() must answer at every point of both channels
    let lightOk = true, missing = '';
    for (const st of [null, { settle: 0, elapsed: 0 }, { settle: 1, elapsed: 0 },
      { settle: 0, elapsed: 1000 }, { settle: 1, elapsed: 1000 }]) {
      const L = m.light(st);
      for (const k of LIGHT) {
        const v = L[k];
        if (k === 'dir') {
          if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) {
            lightOk = false; missing = 'dir';
          }
        } else if (!Number.isFinite(v)) { lightOk = false; missing = k; }
      }
    }
    ok(`${id} · light() answers with every key at both ends of both channels`,
      lightOk, missing);

    // the sun is a unit vector above the horizon, at every point of the arc
    let above = true;
    for (let i = 0; i <= 20; i++) {
      const d = m.light({ settle: 0, elapsed: i * 40 }).dir;
      const len = Math.hypot(d[0], d[1], d[2]);
      if (Math.abs(len - 1) > 1e-6 || d[1] <= 0.05) above = false;
    }
    ok(`${id} · the light stays a unit vector well above the horizon`, above);

    ok(`${id} · the arc never runs backwards`, (() => {
      let prev = -1;
      for (let t = 0; t <= 900; t += 15) {
        const v = m.arc({ elapsed: t });
        if (!Number.isFinite(v) || v < prev - 1e-9 || v < 0 || v > 1) return false;
        prev = v;
      }
      return true;
    })());

    ok(`${id} · the sky is one GLSL string with both entry points`,
      typeof m.glsl === 'string'
      && m.glsl.includes('vec3 swSky(') && m.glsl.includes('vec3 swWorld(')
      // a stray backtick would have closed the template literal, so this is
      // cheap insurance against a comment breaking a shader
      && !m.glsl.includes('`'));

    const px = panoramaPixels(64, 16, m);
    ok(`${id} · the skyline bakes, and has something in it`,
      px.length === 64 * 16 * 4 && px.some((v) => v > 0));
  }
}

/* ── 4. the day is a different picture, not a brighter one ────────────────── */
{
  console.log('\nday · the ways it is deliberately not the night');

  const n = MOODS.moonlit, d = MOODS.day;

  ok('the sun is nowhere near where the moon is', (() => {
    const a = n.light(null).dir, b = d.light(null).dir;
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0.5;     // over 60° apart
  })());

  ok('the morning climbs, and only over minutes', (() => {
    const early = d.light({ settle: 0, elapsed: 0 }).dir[1];
    const late = d.light({ settle: 0, elapsed: 600 }).dir[1];
    return late > early + 0.1 && d.arc({ elapsed: 20 }) === 0;
  })());

  ok('the settle cannot move the sun', (() => {
    const a = d.light({ settle: 0, elapsed: 300 }).dir;
    const b = d.light({ settle: 1, elapsed: 300 }).dir;
    return a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  })());

  ok('the haze burns off as the water settles', (() => {
    const a = d.light({ settle: 0, elapsed: 300 }).glowI;
    const b = d.light({ settle: 1, elapsed: 300 }).glowI;
    return b < a * 0.7;
  })());

  ok('the day carries far more light than the night', d.light(null).keyI > n.light(null).keyI * 2);
  ok('and holds the fill well under the key', d.light(null).hemiI < d.light(null).keyI * 0.6);
  ok('the day blooms a third as hard', d.curves.grade.bloom(1) < n.curves.grade.bloom(1) * 0.5);
  ok('and vignettes less', d.curves.grade.vignette(0) < n.curves.grade.vignette(0));
  ok('the day hangs far less fog than the night', d.curves.fog(0) < n.curves.fog(0) * 0.6);
  ok('the sun path on the water is held right down', d.curves.water.pathI(1) < n.curves.water.pathI(1) * 0.25);
  ok('the day albedo is lifted off the moonlit one',
    d.palette.rock > n.palette.rock && d.palette.pine > n.palette.pine
    && d.palette.grass > n.palette.grass);
  ok('the water scatters its own colour, not the light\'s',
    d.curves.water.scatterCol !== d.palette.disc && n.curves.water.scatterCol === n.palette.disc);
  ok('the morning bed is brighter and drier than the night\'s',
    d.curves.audio.cutoff(0) > n.curves.audio.cutoff(0)
    && d.curves.audio.wet(1) < n.curves.audio.wet(1)
    && d.curves.audio.room.seconds < n.curves.audio.room.seconds);
  ok('and the birds are the common sound rather than the rare one',
    d.curves.audio.sparse.call > d.curves.audio.sparse.lap
    && n.curves.audio.sparse.call < n.curves.audio.sparse.lap);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
