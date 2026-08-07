/**
 * timeofday.js — the two experiences, as data.
 *
 * The sanctuary is one world. What makes DAWN and DUSK different is entirely
 * in here: the celestial keyframe table, the colours every module lerps
 * between, and a handful of one-line response curves that say how a thing
 * answers the light. Nothing in this file draws anything, and nothing here
 * imports a module — main.js reads it once and hands the chosen mode to every
 * module on `ctx.tod`, so the LOCKED MODULE CONTRACT is untouched.
 *
 * `d` throughout is `state.dawn`: 0..1 progress along the active mode's light
 * arc. In DAWN that runs pre-dawn indigo → sun in the valley. In DUSK it runs
 * clear afternoon → coral afterglow. Every curve below is a function of it so
 * a mode can invert a relationship rather than only re-tint it — which is what
 * the lantern does, going from an ornament in daylight to the warmest thing in
 * the frame at sunset.
 *
 * ── ADDING TO THIS FILE ──────────────────────────────────────────────────────
 * The DAWN column reproduces the finished night→sunrise piece exactly. Every
 * curve marked `= const` was a literal in the module that reads it. Changing a
 * DAWN value changes the finished experience; changing a DUSK value does not.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ── DAWN: night → sunrise ──────────────────────────────────────────────────
 * The original. The horizon warms (glow / fog-facing colours) well before the
 * disc itself clears the ridgeline.
 */

const DAWN = {
  id: 'dawn',
  label: 'Dawn',
  tagline: 'night into sunrise',
  fadeIn: '#05070e',
  fadeOut: '#0b0f1c',

  keys: [
    {
      d: 0.00,
      // A cold moon, raking in low over the walker's left shoulder rather than
      // sitting high and straight behind them. Low is the whole point: a shallow
      // key barely touches the open ground — which must stay deep indigo — while
      // it lights the side of every trunk, rock and blade that faces it.
      az: 236, el: 21,
      key: 0x9db1e4, keyI: 1.95,
      disc: 0xcdd8f5, discI: 0.40, halo: 0.05,
      zenith: 0x080b18, horizon: 0x131c36, glow: 0x24406b, glowI: 0.35, ground: 0x0a0f1e,
      // Fill is roughly halved against the key so there is a lit side and a shadow
      // side. The hemisphere stays saturated indigo so shadows never go grey.
      hemiSky: 0x44609f, hemiGround: 0x141a2c, hemiI: 0.68,
      ambient: 0x1f2c56, ambI: 0.40,
      exposure: 1.01,
    },
    {
      d: 0.34,
      az: 178, el: 15,
      key: 0xa8b8e0, keyI: 1.62,
      disc: 0xd7dcf0, discI: 0.30, halo: 0.10,
      zenith: 0x101733, horizon: 0x2a2f4e, glow: 0x6a5378, glowI: 0.85, ground: 0x141a30,
      hemiSky: 0x516196, hemiGround: 0x191d2e, hemiI: 0.82,
      ambient: 0x27345c, ambI: 0.46,
      exposure: 1.04,
    },
    {
      d: 0.60,
      az: 78, el: 2.2,
      key: 0xffae78, keyI: 1.55,
      disc: 0xffb277, discI: 0.55, halo: 0.30,
      zenith: 0x1b2444, horizon: 0x5a4560, glow: 0xff8f52, glowI: 1.00, ground: 0x241f38,
      hemiSky: 0x6a789f, hemiGround: 0x201c2b, hemiI: 1.02,
      ambient: 0x333a60, ambI: 0.58,
      exposure: 1.11,
    },
    {
      d: 0.82,
      az: 34, el: 4.0,
      key: 0xffc089, keyI: 2.60,
      disc: 0xffcf9a, discI: 1.35, halo: 0.55,
      zenith: 0x25315a, horizon: 0x8a6a70, glow: 0xffab63, glowI: 1.20, ground: 0x352b40,
      hemiSky: 0x8290ac, hemiGround: 0x2a2431, hemiI: 1.06,
      ambient: 0x40456a, ambI: 0.54,
      exposure: 1.13,
    },
    {
      d: 1.00,
      az: 21, el: 6.6,
      key: 0xffd2a4, keyI: 3.10,
      disc: 0xffe0bb, discI: 2.1, halo: 0.72,
      zenith: 0x2e3c68, horizon: 0xa8848a, glow: 0xffc184, glowI: 1.25, ground: 0x40364a,
      hemiSky: 0x9aa8c1, hemiGround: 0x322b38, hemiI: 1.06,
      ambient: 0x484c72, ambI: 0.50,
      exposure: 1.15,
    },
  ],

  // the star field fades out as the sky comes up
  sky: { night: (d) => 1 - smoothstep(0.02, 0.30, d) },

  // a faint cold bounce from the valley so shadowed forms keep some shape
  bounce: { color: 0x5b6da0, i: (d) => 0.22 + 0.18 * d },

  lantern: {
    color: 0xffb066,
    key: () => 42.0,          // = const — the point light's reach
    glow: () => 0.55,         // = const — the sprite bloom around the flame
    emissive: () => 1.5,      // = const — the paper shade lighting from within
    flame: () => 0.85,        // = const — the flame quads themselves
  },

  grade: {
    vignette: (d) => 0.34 - 0.08 * d,
    // lift the shadows toward indigo, push the highlights toward gold
    shadowTint: [0.034, 0.042, 0.078],
    shadowFade: (d) => 1.0 - 0.35 * d,
    highTint: [1.048, 0.997, 0.922],
    highMix: (d) => 0.45 + 0.55 * d,
    // Restrained: only genuine light sources (flame, orb core, the sun's disc)
    // should ever cross the threshold.
    bloom: (d) => 0.30 + 0.09 * smoothstep(0.55, 1.0, d),
    bloomThreshold: (d) => 0.92 - 0.07 * d,
  },

  fog: {
    a: 0x11172b, b: 0x8b8098, mix: 0.85,
    density: (d, mist) => (0.0030 + 0.0044 * mist) * (1 - 0.28 * d),
  },

  mist: {
    a: 0x6d80ad, b: 0xd8c9c6, mix: 0.8,
    warmColor: 0xffbe86,
    warm: (d) => d * 0.55,
    // Before dawn the mist is the only thing standing between the shadow side
    // of the valley and pure black. It thins out as the light arrives.
    density: (d, mist, t) => (0.105 - t * 0.045) * (0.22 + 0.9 * mist) * (1 + 0.42 * (1 - d)),
  },

  cloud: {
    a: 0x36415f, b: 0xa2949e,
    warm: (d, t) => d * Math.max(0, 1 - t * 1.3),
    density: (d, mist, dens) => dens * (0.62 + 0.38 * mist),
  },

  motes: { opacity: (d, mist) => 0.105 * (0.45 + 0.55 * mist) * (1 - 0.5 * d) },

  // The shafts must track the key light's azimuth, which lighting.js owns and
  // cannot hand over mid-frame. These two endpoints are the same sweep the
  // keyframe table makes, linearised — close enough for a soft additive quad.
  rays: {
    color: 0xffd6ab,
    az0: 236, az1: 21, el0: 21, el1: 6.6,
    opacity: (d, mist) => 0.062 * smoothstep(0.42, 0.95, d) * (0.5 + 0.5 * mist),
  },

  ridge: {
    // Near to far. Each layer paler and lower in contrast than the one in front
    // of it, and each fading *downward* into a night sky.
    layers: [
      { col: 0x39466a, mid: 0x2b365a, top: 0x1a2340, haze: 0x111a31 },
      { col: 0x525e8a, mid: 0x424d76, top: 0x2d3758, haze: 0x1b2440 },
      { col: 0x6b749c, mid: 0x59628c, top: 0x3f486f, haze: 0x242d4d },
      { col: 0x757ea8, mid: 0x646d99, top: 0x454e78, haze: 0x2a3354 },
    ],
    // Distance both warms a ridge toward the dawn and washes it toward the sky,
    // so the spread between the nearest and farthest layer widens as the light
    // comes up instead of everything brightening together.
    a: 0x8f9ec4, b: 0xffd8bc,
    tint: (d, far) => d * (0.22 + 0.78 * far),
    bright: (d, far) => (0.41 + 0.53 * d) * (0.70 + 0.66 * far),
  },

  // Daylight overwhelms it: the golden path is a pre-dawn guide and should be
  // all but gone by the time the sun is in the valley.
  path: { color: 0xffa960, strength: (d) => 1 - 0.94 * smoothstep(0.12, 0.72, d) },

  orb: {
    core: 0xffcf9e, deep: 0xd98a52,
    shell: 0xffd9a8, rim: 0x9fc4ff,
    halo: 0xf3c193,
    glow: () => 1.0,          // = const
    haloScale: () => 1.0,     // = const
    // = const — fresnel rim vs. body veil in the shell, and the rim's falloff
    edge: 1.0, edgePow: 3.1, veil: 1.0,
  },

  // Dark bronze before dawn — there is no light at the shrine to reflect.
  bell: { env: (d) => 0.36 + d * 1.30 },

  // Every colour in environment.js was mixed for this night. DAWN takes the
  // palette as it is. (Linear multipliers; see worldTint in environment.js.)
  world: { ground: [1, 1, 1], foliage: [1, 1, 1], grass: [1, 1, 1], rock: [1, 1, 1], bark: [1, 1, 1] },

  // the ambience bed sits behind a lowpass that opens as dawn arrives
  audio: { filter: (d) => 820 + d * 6400, start: 900 },

  // DAWN's world does not answer the breath — the orb does that alone.
  breath: { exposure: 0, fog: 0, mist: 0 },

  arc: {
    endingSeconds: 44,
    // Dawn peaks early and then holds, so the last seconds are spent at full
    // light rather than still climbing when the fade begins.
    lightSeconds: 25,
    ending: (e) => ({ light: e, mist: 1 - 0.62 * e }),
    // Lantern light bleeds a little warmth into the world once lit.
    idle: (state) => ({ light: state.lanternLit ? 0.06 : 0, mist: 1 }),
  },

  text: {},
};

/* ── DUSK: day → golden hour → sunset ───────────────────────────────────────
 * The same mountain, hours earlier in the day and hours later in the light.
 * The sun starts high and off the left shoulder — cross-light, which is what
 * gives terrain its form — and swings round to sit on the ridge the walk has
 * been aimed at the whole time.
 */

const DUSK = {
  id: 'dusk',
  label: 'Dusk',
  tagline: 'day into sunset',
  fadeIn: '#05070e',
  fadeOut: '#171226',

  keys: [
    {
      d: 0.00,
      // High and well to the side. A sun behind the walker flattens everything
      // ahead of them and a sun in front silhouettes it; 282° rakes across the
      // corridor, so every ridge, rock and drift has a lit face and a cool one.
      az: 282, el: 36,
      key: 0xfff4e2, keyI: 5.60,
      disc: 0xfffaf0, discI: 0.55, halo: 0.06,
      zenith: 0x5e9ce8, horizon: 0xd2e6f6, glow: 0xeaf3fb, glowI: 0.30, ground: 0x76808e,
      // A daylight sky is an enormous soft box, and it is the only reason a
      // shadow in snow reads blue instead of black. This is the number that
      // separates afternoon from twilight — more than the key does.
      hemiSky: 0xbcd8f7, hemiGround: 0x938973, hemiI: 4.20,
      ambient: 0xa2b4cd, ambI: 1.55,
      exposure: 1.04,
    },
    {
      d: 0.34,
      // Late afternoon. The move is almost entirely in elevation — the light
      // lengthens before it warms, which is the part people never consciously
      // notice.
      az: 308, el: 22,
      key: 0xfff0cf, keyI: 5.40,
      disc: 0xfff6e4, discI: 0.70, halo: 0.11,
      zenith: 0x5993e0, horizon: 0xdbe4ee, glow: 0xf6e6cc, glowI: 0.48, ground: 0x767e8b,
      hemiSky: 0xb7d1f0, hemiGround: 0x998c72, hemiI: 3.85,
      ambient: 0xa1afc4, ambI: 1.48,
      exposure: 1.05,
    },
    {
      d: 0.60,
      // Golden hour. The fill warms with the key here rather than lagging it,
      // or the whole valley reads lavender while only the lit faces are gold.
      az: 330, el: 11.5,
      key: 0xffd097, keyI: 4.90,
      disc: 0xffe2b4, discI: 1.10, halo: 0.28,
      zenith: 0x4d7ecc, horizon: 0xf2cda6, glow: 0xffb168, glowI: 1.05, ground: 0x6d6062,
      hemiSky: 0xb6bfe2, hemiGround: 0x9c7f5c, hemiI: 3.00,
      ambient: 0x9d95a8, ambI: 1.20,
      exposure: 1.06,
    },
    {
      d: 0.82,
      az: 340, el: 8.6,
      key: 0xffa961, keyI: 3.90,
      disc: 0xffc98d, discI: 1.70, halo: 0.72,
      zenith: 0x36539a, horizon: 0xed8f60, glow: 0xff7838, glowI: 1.40, ground: 0x4d4051,
      // The fill turns before the key does: shadows are already violet while
      // the lit faces are still orange, which is the whole colour story of a
      // sunset on snow.
      hemiSky: 0x8f9ad0, hemiGround: 0x77584a, hemiI: 1.95,
      ambient: 0x77719c, ambI: 0.92,
      exposure: 1.08,
    },
    {
      d: 1.00,
      // Behind the ridge, not above it. Every ridge line in this world subtends
      // 4-15 degrees from the overlook, so no elevation that still reads as
      // sunset also clears them — DAWN's final sun is behind them too. So the
      // disc is aimed into the saddle left of centre and the halo is opened up
      // instead: what the payoff frame shows is the sun immediately behind that
      // notch, burning through it, which is the stronger composition anyway.
      az: 344, el: 5.2,
      key: 0xff8f5c, keyI: 2.55,
      disc: 0xffb079, discI: 2.40, halo: 1.00,
      zenith: 0x27417f, horizon: 0xf49a80, glow: 0xff8352, glowI: 1.32, ground: 0x3d3450,
      // Lifted against the backlight: at this hour the overlook the walker is
      // standing on is lit by sky alone, and it must not fall out of the frame.
      hemiSky: 0x8288c6, hemiGround: 0x74564e, hemiI: 1.58,
      ambient: 0x6a6a9e, ambI: 0.92,
      exposure: 1.10,
    },
  ],

  // No stars until the light has genuinely gone, and then only the first few.
  sky: { night: (d) => smoothstep(0.93, 1.0, d) * 0.26 },

  bounce: { color: 0x9fb2d6, i: (d) => 0.58 - 0.34 * d },

  lantern: {
    color: 0xffb066,
    // The reversal. In full daylight the lantern is a ritual object with a
    // flame in it; by the afterglow it is the warmest thing in the frame and
    // the only light still throwing a pool.
    key: (d) => 9.0 + 48.0 * smoothstep(0.22, 1.0, d),
    glow: (d) => 0.09 + 0.56 * smoothstep(0.28, 1.0, d),
    // The flame stays legible from the moment it is lit — what changes is how
    // much of the world it lights, not how clearly you can see it burning.
    emissive: (d) => 0.95 + 1.45 * smoothstep(0.20, 1.0, d),
    flame: (d) => 0.78 + 0.30 * smoothstep(0.30, 1.0, d),
  },

  grade: {
    // Daylight wants less of a hole around the frame than night does.
    vignette: (d) => 0.24 + 0.13 * d,
    shadowTint: [0.020, 0.026, 0.055],
    shadowFade: (d) => 0.50 + 0.80 * d,
    highTint: [1.055, 0.995, 0.905],
    highMix: (d) => 0.55 + 0.45 * d,
    // Kept low through the day so bright snow rolls off instead of blooming,
    // and only opened once there is a disc worth blooming.
    bloom: (d) => 0.15 + 0.24 * smoothstep(0.52, 1.0, d),
    bloomThreshold: (d) => 0.97 - 0.11 * d,
  },

  fog: {
    a: 0xa8bed8, b: 0xd39a86, mix: 0.92,
    // Restrained haze in the afternoon — the daylight scene has to be readable
    // to the far ridges — thickening as the sun drops so the valley layers up.
    density: (d, mist) => (0.0022 + 0.0040 * mist) * (1 + 0.30 * d),
  },

  mist: {
    a: 0xc3d2e6, b: 0xe8b9a4, mix: 0.9,
    warmColor: 0xffa878,
    warm: (d) => smoothstep(0.30, 1.0, d) * 0.72,
    density: (d, mist, t) => (0.078 - t * 0.034) * (0.28 + 0.86 * mist) * (0.55 + 0.75 * d),
  },

  cloud: {
    a: 0xb9c6d8, b: 0xdb9c86,
    warm: (d, t) => smoothstep(0.34, 1.0, d) * Math.max(0, 1 - t * 1.1),
    density: (d, mist, dens) => dens * (0.58 + 0.42 * mist),
  },

  // Dust in a sunbeam: almost nothing in flat afternoon light, and then the
  // low sun picks every mote out.
  motes: { opacity: (d, mist) => 0.072 * (0.40 + 0.60 * mist) * (0.30 + 0.90 * smoothstep(0.28, 1.0, d)) },

  rays: {
    color: 0xffc79a,
    az0: 282, az1: 344, el0: 36, el1: 5.2,
    opacity: (d, mist) => 0.058 * smoothstep(0.40, 0.98, d) * (0.5 + 0.5 * mist),
  },

  ridge: {
    // The daylight inversion. Every layer is pale blue-grey rather than navy,
    // the far ones paler than the near ones, and each fades *upward* into haze
    // so a ridge dissolves into a bright sky instead of cutting a hole in it.
    // Distance is carried by value, which is what haze does to a mountain — not
    // by darkness, which is only what night does.
    layers: [
      { col: 0x7d90b4, mid: 0x8b9dbf, top: 0x9dadca, haze: 0xb3c0d8 },
      { col: 0x92a5c6, mid: 0x9dafcf, top: 0xadbcd8, haze: 0xc2cde2 },
      { col: 0xa0b0cc, mid: 0xaabad4, top: 0xb7c5dc, haze: 0xc8d4e6 },
      { col: 0xaebcd4, mid: 0xb7c4da, top: 0xc2cee2, haze: 0xd0daea },
    ],
    a: 0xf6f8fc, b: 0xffb08e,
    // As the sun drops the near layers fall toward silhouette while the far
    // ones take the warmth — which is the whole reason a sunset has depth.
    tint: (d, far) => d * (0.34 + 0.66 * far),
    bright: (d, far) => (1.32 - 0.82 * d) * (0.74 + 0.34 * far),
  },

  // Lit in broad daylight the path glow is invisible, which is correct — and
  // it quietly returns as the light goes, so the way back reads at the end.
  path: { color: 0xffa960, strength: (d) => 0.08 + 0.92 * smoothstep(0.34, 0.96, d) },

  orb: {
    // Warm ivory over pale gold, with a cool rim doing the silhouette work
    // that darkness does for free at night. The core keeps some saturation on
    // purpose: an additive near-white core against a bright sky has nowhere
    // left to go and clips to a paper hole.
    core: 0xffe4ac, deep: 0xd98f4e,
    shell: 0xffe8c6, rim: 0x8fb6e8,
    halo: 0xe9caa2,
    // Held well down against daylight, and opening as the light leaves.
    glow: (d) => 0.44 + 0.58 * d,
    // The outer glow is handed to the halo sprite, which has no silhouette to
    // print, and taken away from the shell, which does.
    haloScale: (d) => 0.86 + 0.24 * d,
    // A rim, not a bubble. The falloff matters more than the amount: at DAWN's
    // exponent the rim is a thin bright ring, and against a bright sky a thin
    // bright ring is just the sphere's outline drawn like a decal. Spread wide
    // and kept low, it separates the orb from the valley without printing an
    // edge, and the core is left to be the light.
    edge: 0.58, edgePow: 1.30, veil: 0.22,
  },

  bell: { env: (d) => 1.30 - 0.35 * d },

  // Daylight's real problem in this world is albedo, not exposure: the rock is
  // mixed at 0x2b2f38 and the frost at 0x848f98 because at night they are only
  // ever seen by a moon. Lifting them here is what turns the ground back into
  // snow and stone; lifting the light instead would only give grey a suntan.
  // Slightly unequal channels keep the snow warm and the pines blue-green.
  world: {
    ground: [2.62, 2.30, 2.18],
    foliage: [2.10, 2.50, 2.24],
    grass: [1.72, 1.70, 1.46],
    rock: [1.80, 1.80, 1.82],
    bark: [1.75, 1.62, 1.48],
  },

  // Open air in the afternoon, closing down as the light goes.
  audio: { filter: (d) => 4600 - 3000 * smoothstep(0.15, 1.0, d), start: 4600 },

  // The world answering the breath. Inhale opens the light and clears the air
  // a little; exhale softens and diffuses. These amplitudes are deliberately
  // at the edge of perceptible — the moment it reads as pulsing it is wrong.
  breath: { exposure: 0.030, fog: 0.10, mist: 0.14 },

  arc: {
    endingSeconds: 44,
    // ~32s of actual sun travel, then a held afterglow while the last lines
    // and the chime land.
    lightSeconds: 32,
    ending: (e) => {
      const light = DUSK_IDLE_END + (1 - DUSK_IDLE_END) * e;
      return { light, mist: 0.50 + 0.55 * light };
    },
    idle: (state) => {
      const p = DUSK_PHASES[state.phase];
      let light = DUSK_IDLE_END;
      if (p) {
        const t = clamp(state.phaseTime / p.span, 0, 1);
        light = p.from + (p.to - p.from) * (t * t * (3 - 2 * t));
      }
      // main.js takes the max against the current value, so the sun never
      // climbs back up if a phase is left early.
      return { light, mist: 0.50 + 0.55 * Math.max(state.dawn, light) };
    },
  },

  text: {
    // 'waking' is the one line that belongs to the other end of the day.
    valley: 'Go on. The day is letting go.',
  },
};

/**
 * How far along the light arc each phase carries the afternoon, and over how
 * long. The spans are longer than the phases usually take, so the light is
 * still creeping when the walker moves on rather than parking at a value and
 * waiting — the whole point is that nothing about it is noticeable until the
 * shrine, where a third of the arc has already gone by.
 */
const DUSK_PHASES = {
  title:     { from: 0.000, to: 0.000, span: 1 },
  lantern:   { from: 0.000, to: 0.050, span: 50 },
  toOrb:     { from: 0.050, to: 0.110, span: 45 },
  breathing: { from: 0.110, to: 0.205, span: 80 },
  toShrine:  { from: 0.205, to: 0.300, span: 60 },
  bell:      { from: 0.300, to: 0.330, span: 4 },
};
const DUSK_IDLE_END = 0.330;

/* ── selection ──────────────────────────────────────────────────────────── */

export const MODES = { dawn: DAWN, dusk: DUSK };
export const MODE_ORDER = ['dawn', 'dusk'];
export const DEFAULT_MODE = 'dawn';

export function resolveMode(name) {
  return MODES[name] || MODES[DEFAULT_MODE];
}
