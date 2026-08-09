/**
 * mood.js — Still Water's hours, as data.
 *
 * The leaf of the experience: colours, the mountain profile, the response
 * curves every module reads, and the one piece of GLSL that has to be identical
 * in two places. It imports nothing and draws nothing, which is the same
 * arrangement timeofday.js has in Ascent and for the same reason — a world
 * whose look lives in a table can be retuned without touching behaviour.
 *
 * ── THE TWO HOURS ────────────────────────────────────────────────────────────
 * MOONLIT is the original: a moon, a field of stars, and a lake that is the
 * dark half of the frame. DAY is the same lake on a clear mountain morning.
 * They share the place exactly — the same path, the same stone, the same
 * mountains from the same profile function, the same anchors, the same phase
 * machine — and share nothing else. Everything below is per-hour, and
 * water/main.js resolves one of them once and hands it to every module on
 * `ctx.mood`, so the MODULE CONTRACT is untouched.
 *
 * ── s ────────────────────────────────────────────────────────────────────────
 * Every curve takes `s`: the settle, 0..1. That is the stillness the player has
 * earned (see stillness.js), floored during the ending so a restless night
 * still arrives somewhere. Nothing in this file knows where it came from.
 *
 * ── d ────────────────────────────────────────────────────────────────────────
 * `light(state)` additionally reads `arc(state)`: 0..1 along the hour's own
 * light arc. MOONLIT has no arc and returns 0 — a moon does not move in the
 * four minutes anyone is watching it. DAY runs early morning → clear late
 * morning over about seven minutes, driven by `state.elapsed` and therefore
 * monotone: the settle may fall when somebody fidgets, but the morning never
 * runs backwards.
 *
 * Which is the whole division of labour between the two channels:
 *
 *     time      the morning progressing — the sun, the sky's own colour
 *     stillness the air and the water clearing — haze, ripple, reflection
 *
 * ── why the sky is a function and not a shader ───────────────────────────────
 * `mood.glsl` is included by both the sky dome and the water. The dome draws it
 * looking outward; the water calls the same function down a reflected ray. That
 * is the whole reflection technique: no second camera, no render target, no
 * extra pass — the water asks the sky what is in a direction, and the sky
 * answers with the same arithmetic that painted it. The moon, its haloes and
 * the stars appear in the lake at night, and the sun's sky and its clouds
 * appear in it by day, because they cannot not.
 *
 * Both hours define the same two entry points with the same signature, so
 * sky.js and lake.js call them without knowing which hour they are in:
 *
 *   vec3 swSky  (vec3 dir,                 sampler2D noise, …args)
 *   vec3 swWorld(vec3 dir, sampler2D pano, sampler2D noise, …args)
 *
 * The two arguments named `detailGain` and `detailSoft` are the ones each hour
 * reads differently, and they are the mechanic: they say how much fine
 * structure survives in this sample and how far it has dissolved. At night that
 * is the field of stars. By day it is the definition of the clouds. In both, a
 * broken surface asks a blurrier question and gets a blurrier answer.
 */

/* ── the place ────────────────────────────────────────────────────────────────
 * Shared by both hours and not negotiable: it is the same lake. Only the light
 * falling on it and the colours it is seen in belong to an hour.
 * ────────────────────────────────────────────────────────────────────────── */

/** How high the reflection panorama reaches. Nothing on the skyline is near it. */
export const PANO_MAX_EL = 0.26;   // rad ≈ 14.9°
export const EYE_Y = 2.08;         // where the meditation seat puts the eye

/** Ring radius, height, ridge frequency and seed. Four rings, near to far. */
const RIDGE_SHAPE = [
  { r: 340,  h: 58,  freq: 3.2, seed: 4.1 },
  { r: 700,  h: 128, freq: 2.4, seed: 11.7 },
  { r: 1250, h: 236, freq: 1.9, seed: 19.3 },
  { r: 1950, h: 372, freq: 1.4, seed: 27.5 },
];

function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Ridge-line height in metres for a layer, at a world azimuth in radians. */
export function ridgeHeight(layer, angle) {
  const L = RIDGE_SHAPE[layer];
  let n = 0, amp = 0.55, f = L.freq;
  for (let o = 0; o < 4; o++) {
    // a periodic 1D fBm: sampling a circle keeps every octave seamless at 2π
    const x = Math.cos(angle) * f + L.seed;
    const y = Math.sin(angle) * f + L.seed * 1.7;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash1(xi + yi * 57.3 + o * 13.7);
    const b = hash1(xi + 1 + yi * 57.3 + o * 13.7);
    const c = hash1(xi + (yi + 1) * 57.3 + o * 13.7);
    const d = hash1(xi + 1 + (yi + 1) * 57.3 + o * 13.7);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    n += amp * (top + (bot - top) * sy);
    amp *= 0.48; f *= 2.11;
  }
  return L.h * (0.40 + 0.92 * Math.min(1, Math.max(0, n)));
}

/* ── small helpers, so the table can be written as a table ────────────────── */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Mix two colours given as sRGB hex, and hand back sRGB hex.
 *
 * Crude on purpose: this file has no dependencies and is not going to grow a
 * colour space. Every value it produces is fed straight to `Color.setHex`,
 * which is where the conversion to linear actually happens, so mixing in the
 * same space the swatches were authored in is the honest thing to do here.
 */
function mixHex(a, b, t) {
  const k = clamp(t, 0, 1);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, k));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, k));
  const c = Math.round(lerp(a & 255, b & 255, k));
  return (r << 16) | (g << 8) | c;
}

/** Azimuth measured from -Z toward +X, elevation from the horizon. Degrees. */
function direction(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  const ce = Math.cos(e);
  return [Math.sin(a) * ce, Math.sin(e), -Math.cos(a) * ce];
}

/* ═════════════════════════════════════════════════════════════════════════════
 * MOONLIT — the original hour. A moon, a field of stars, and inward quiet.
 *
 * Every value in this section reproduces the finished night piece exactly.
 * Changing one changes the experience that already exists; changing anything
 * in DAY cannot.
 * ══════════════════════════════════════════════════════════════════════════ */

const MOON = { az: -7, el: 17 };

const MOONLIT_PALETTE = {
  zenith: 0x04060d,
  horizon: 0x0b1120,
  glow: 0x1a2540,        // the band the moon lays along the horizon
  disc: 0xdde7f5,        // the moon itself
  ground: 0x03050a,      // the dome below the waterline

  deep: 0x06090f,        // open water, straight down
  shallow: 0x0d1522,     // over the shelf near the shore
  haze: 0x0c1322,        // what distance dissolves everything into

  fogA: 0x0a101c,
  mist: 0x2a3a56,        // the low bands lying on the lake

  // ── albedo ────────────────────────────────────────────────────────────────
  // Mixed against the render, not against the swatch. These read far too light
  // as hex — a wet shore rock is not #424b5a — but the light falling on them is
  // a moon: about a quarter of a unit, once its colour and the fill are in. An
  // albedo picked to *look* like moonlit rock arrives as 8/255 and the whole
  // near half of the frame goes black. Ascent has the same note in reverse; the
  // lesson both times is that lifting the light instead only gives grey a
  // suntan, and here it would take the mountains and the water's body with it.
  //
  //   linear(0x3d) ≈ 0.047 × ≈0.29 of light ≈ 0.0135 → about 33/255 on screen,
  //   which is the value the middle mountain band sits at.
  rock: 0x38404e,
  soil: 0x2e3644,
  pine: 0x1c262e,          // the pines stay silhouettes; that is their job
  grass: 0x252e2a,
  reed: 0x2a322e,
  wet: 0x080b11,           // stone at the waterline
};

/*  Four rings. Against a moonlit sky a distant ridge fades *up* into the
 *  horizon haze rather than down into black — the sky is brightest where it
 *  meets the water, so distance means less contrast and more value, not more
 *  darkness. */
const MOONLIT_RIDGES = [
  { foot: 0x05080e, top: 0x0a0f1a, haze: 0x0b1220 },
  { foot: 0x070b14, top: 0x0d1322, haze: 0x0e1626 },
  { foot: 0x090e19, top: 0x111a2c, haze: 0x121c30 },
  { foot: 0x0b1120, top: 0x151f36, haze: 0x16213a },
];

/* ── how the world answers ────────────────────────────────────────────────────
 * Nothing here is dramatic on purpose. The lake at its most disturbed is still
 * a mountain lake at night, and the difference between the two ends has to read
 * as the same place seen more clearly — not as a different place.
 * ────────────────────────────────────────────────────────────────────────── */

const MOONLIT_CURVES = {
  water: {
    // metres of actual displacement. A hand's breadth at worst; not the sea.
    amp: (s) => 0.052 * (1 - 0.84 * s) + 0.005,
    // The broad swell's steepness, which is what the reflection sees. Held
    // separate from the displacement because a lake's undulation is far flatter
    // than it needs to look — the geometry is honest and the normal is staged.
    swell: (s) => 0.085 * (1 - 0.78 * s) + 0.010,

    // ── the two ripples ─────────────────────────────────────────────────────
    // `ripple` is the wind on the water and answers the stillness almost all
    // the way down. `micro` is the lake's own shimmer and does not: it bottoms
    // out at a sixth of its range, never at zero.
    //
    // That floor is the whole difference between calm water and ice. A surface
    // with no motion left in it stops reflecting like a liquid — the moon's
    // image goes rigid, the highlight becomes an airbrushed smear, and the eye
    // reads the lake as a painted slab. At the floor the slope is under half a
    // degree, which is less than the moon's own angular radius, so the disc
    // stays whole and merely breathes.
    ripple: (s) => 1 - 0.90 * s,
    micro: (s) => 0.32 - 0.25 * s,
    // ── the moon path, in two parts ─────────────────────────────────────────
    // The glitter alone was a scatter of separate points a metre apart, because
    // only the crests of the ripple ever satisfy the mirror condition. The path
    // needs a floor under it: a broad lobe off the swell that is continuous by
    // construction, with the ripple's own highlights riding on top. Together
    // they read as one shimmering column that tightens onto the mirror point
    // rather than as a handful of fireflies.
    // Both are quiet. A moon is a hundred-thousandth of a sun and the water is
    // still the dark half of the frame; the path has to be the brightest thing
    // *on the lake* without becoming the brightest thing in the picture, which
    // is the moon and stays the moon.
    shine: (s) => 60 + 700 * s * s,          // the glitter on the ripple
    specular: (s) => 0.14 + 0.16 * s,
    pathShine: (s) => 60 + 900 * s * s,      // the column under it
    pathI: (s) => 0.11 + 0.09 * s,
    // how much the reflection remembers what it is reflecting
    halo: (s) => 34 + 660 * s * s,
    // at night: the field of stars in the water
    detailGain: (s) => 0.10 + 0.95 * s,
    detailSoft: (s) => 1 - s,
    // a broken surface cannot hold an edge, so the reflected disc softens with
    // everything else rather than staying a hard dot inside a smear
    discSize: (s) => 0.00026 * (1 + 2.2 * (1 - s)),
    // the far water dissolving into the horizon
    fog: (s) => 0.0125 - 0.0052 * s,
    // how much of what it reflects a surface hands back. Water is not a mirror.
    albedo: 0.88,
    // light that went in and came back out, so the water at the player's own
    // feet — where almost nothing reflects — is not simply black. At night
    // what comes back out is the moon's own colour and there is very little
    // of it; by day it is the lake's, and there is a great deal.
    scatter: 0.007,
    scatterCol: 0xdde7f5,
  },

  mist: {
    // `t` is the band, 0 nearest. The far bands are what hides the far shore,
    // so they hold on longest — clarity arrives across the water, not at once.
    density: (s, t) => Math.max(0, (0.62 - 0.50 * s) * (0.55 + 0.75 * t)),
    // raising the threshold breaks a sheet into separated patches rather than
    // fading it uniformly: the mist draws apart instead of switching off
    sharp: (s) => 0.34 + 0.30 * s,
    drift: (s) => 0.35 + 0.65 * (1 - s),
  },

  wind: (s) => 1 - 0.82 * s,
  fog: (s) => 0.0072 - 0.0034 * s,
  // The night air does not visibly open: the ridge colours in RIDGES are the
  // finished answer, and this must stay zero or the moonlit skyline moves.
  ridgeHaze: () => 0,
  // Barely there on purpose. Anything you can count is not atmosphere.
  motes: (s) => 0.09 + 0.15 * s,

  grade: {
    vignette: (s) => 0.34 - 0.07 * s,
    bloom: (s) => 0.22 + 0.14 * s,
    bloomThreshold: (s) => 0.72 - 0.10 * s,
    exposure: (s) => 1.0 + 0.10 * s,
    shadowTint: [0.020, 0.028, 0.052],
    highTint: [0.985, 1.000, 1.045],
    // the bloom pass's own build-time shape, and the lens
    bloomRadius: 0.62,
    aberration: 0.0005,
    grain: 0.012,
    grainLow: 0.010,      // no bloom below the top tiers, so a shade less
  },

  audio: {
    // the bed closes down as the world does; by the end there is a drone, a
    // reverb tail and almost nothing else
    windGain: (s) => 0.9 * (1 - 0.85 * s),
    lapGain: (s) => 0.85 * (1 - 0.88 * s),
    cutoff: (s) => 1400 - 1000 * s,
    padGain: (s) => 0.55 * (1 - 0.45 * s),
    wet: (s) => 0.80 + 0.45 * s,
    master: (s) => 1 - 0.42 * s,
    sparseGap: (s) => 16 + 46 * s,
    lapCutoff: (s) => 470 - 180 * s,
    // A bigger, colder room than Ascent's: a bowl of rock with water in it.
    room: { seconds: 4.6, decay: 2.6 },
    // the sparse bed, as weights: a lap on a stone, something in the trees,
    // one distant call. At night the call is the rarest of the three.
    sparse: { lap: 0.42, tree: 0.34, call: 0.24, callHz: 620, callSpread: 260, callI: 0.016 },
    // the pad's voicing — A minor pentatonic, sparse and cold
    padNotes: [
      110.00, 130.81, 146.83, 164.81, 196.00,   // A2 C3 D3 E3 G3
      220.00, 261.63, 293.66, 329.63, 392.00,   // A3 C4 D4 E4 G4
    ],
  },
};

const MOONLIT = {
  id: 'moonlit',
  label: 'Moonlit',
  tagline: 'a lake, a moon, and as long as it takes',
  fadeIn: '#04060d',
  palette: MOONLIT_PALETTE,
  ridges: RIDGE_SHAPE.map((s, i) => ({ ...s, ...MOONLIT_RIDGES[i] })),
  curves: MOONLIT_CURVES,

  // the flank turned toward the moon keeps a little more light on it
  panoLit: (c) => 0.80 + 0.34 * c,
  panoAz: MOON.az,

  // A moon does not move in the four minutes anyone is watching it.
  arc: () => 0,

  light(state) {
    const s = state ? clamp(state.settle, 0, 1) : 0;
    return {
      dir: direction(MOON.az, MOON.el),

      keyCol: 0xc8d8f0, keyI: 1.35 + 0.16 * s,
      hemiSky: 0x1a2740, hemiGround: 0x05070c, hemiI: 0.75 - 0.08 * s,
      ambCol: 0x0d1526, ambI: 0.80,
      // the lake throwing a little of the moon back up under the shore rocks
      bounceCol: 0x233450, bounceI: 0.32,

      zenith: MOONLIT_PALETTE.zenith,
      horizon: MOONLIT_PALETTE.horizon,
      glow: MOONLIT_PALETTE.glow,
      ground: MOONLIT_PALETTE.ground,
      discCol: MOONLIT_PALETTE.disc,

      // the dome's own arguments: the sky itself does not answer to the
      // stillness, only the reflection of it does
      glowI: 1.0,
      discSize: 0.000105,
      discI: 2.4,
      halo: 380.0,
      // What the settle moves up here is the haze between: less of it means
      // more of the field of stars was always there to be seen.
      detailGain: 0.72 + 0.42 * s,
      detailSoft: 0.0,
      // the water's own aureole and glow arguments, which do answer
      waterGlowI: 1.0,
      waterDiscI: 2.1,
    };
  },

  /* ── the night sky, once, for both the dome and the water ──────────────── */
  glsl: /* glsl */`
    const float SW_PANO_MAX = ${PANO_MAX_EL.toFixed(4)};
    const float SW_INV_TAU = 0.15915494;

    /**
     * What is in direction d. Every parameter that the water wants to bend —
     * how tight the moon's halo is, how many stars survive — is an argument
     * rather than a uniform, because the dome and the lake want different
     * answers from the same function on the same frame.
     *
     * noiseTex is unused at night and is in the signature so that the two
     * hours are callable by the same code.
     */
    vec3 swSky(
      vec3 d, sampler2D noiseTex,
      vec3 zenith, vec3 horizon, vec3 glowCol, vec3 lightDir, vec3 lightCol,
      float glowI, float discSize, float discI, float halo,
      float detailGain, float detailSoft, float time
    ) {
      vec3 dir = normalize(d);
      float h = dir.y;
      vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));

      // the band the moon lays along the horizon, tight and concentrated on its
      // own azimuth — the only warmth in the frame and there is not much of it
      vec3 mFlat = normalize(vec3(lightDir.x, 0.0, lightDir.z) + 1e-5);
      float az = max(0.0, dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), mFlat));
      float band = exp(-max(h, 0.0) * 8.5) * smoothstep(-0.11, 0.02, h);
      col += glowCol * band * (0.26 + 0.74 * pow(az, 2.2)) * glowI;

      if (detailGain > 0.002) {
        // A star is a point inside its cell with a round falloff around it, not
        // the cell itself — hashing a quantised direction and lighting the whole
        // cube gives you a sky full of little squares.
        vec3 sp = dir * 168.0;
        vec3 cell = floor(sp);
        float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        // detailSoft lifts the threshold: a broken surface keeps only the bright
        // ones, and the faint field comes back as the water goes quiet
        float thr = 0.9948 + detailSoft * 0.0038;
        if (r > thr) {
          float b = fract(r * 137.31);
          vec3 off = vec3(fract(r * 31.7), fract(r * 57.3), fract(r * 91.1)) - 0.5;
          float dd = length(fract(sp) - 0.5 - off * 0.55);
          float st = smoothstep(0.42, 0.06, dd)
                   * smoothstep(thr, min(0.99994, thr + 0.0020), r);
          float tw = 0.62 + 0.38 * sin(time * (0.5 + b * 1.4) + r * 96.0);
          col += vec3(0.74, 0.81, 1.0) * st * (0.28 + 0.95 * b) * tw
               * smoothstep(-0.02, 0.28, h) * detailGain;
        }
      }

      float md = max(0.0, dot(dir, lightDir));
      col += lightCol * smoothstep(1.0 - discSize, 1.0 - discSize * 0.28, md) * discI;
      col += lightCol * pow(md, halo) * 0.40;
      col += lightCol * pow(md, 9.0) * 0.05;

      return col;
    }

    /** The same, with the skyline in front of it. Used only by the water. */
    vec3 swWorld(
      vec3 d, sampler2D pano, sampler2D noiseTex,
      vec3 zenith, vec3 horizon, vec3 glowCol, vec3 lightDir, vec3 lightCol,
      float glowI, float discSize, float discI, float halo,
      float detailGain, float detailSoft, float time
    ) {
      vec3 dir = normalize(d);
      vec3 col = swSky(dir, noiseTex, zenith, horizon, glowCol, lightDir, lightCol,
                       glowI, discSize, discI, halo, detailGain, detailSoft, time);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      if (el < SW_PANO_MAX) {
        float u = atan(dir.z, dir.x) * SW_INV_TAU + 0.5;
        vec4 m = texture2D(pano, vec2(u, clamp(el / SW_PANO_MAX, 0.0, 1.0)));
        col = mix(col, m.rgb, m.a);
      }
      return col;
    }
  `,
};

/* ═════════════════════════════════════════════════════════════════════════════
 * DAY — the same lake on a clear mountain morning.
 *
 * Not the night with the lights turned up. The night version is about a moon
 * on dark water and the quiet inside that; this one is about air you can see
 * through. The reward at the end of it is not a brighter picture, it is a
 * legible one: the mountain, the sky and the clouds standing in the water as
 * clearly as they stand above it.
 *
 * ── THE SUN IS NOT WHERE THE MOON WAS ────────────────────────────────────────
 * The moon sits at azimuth -7°, which is straight down the lake and straight
 * down the composition. That is right for a moon: what the night piece is for
 * is the path it lays on the water, pointing at the person watching.
 *
 * A sun in the same place is a different picture entirely. It would put a
 * blown-out glare column down the middle of the frame, and the glare would sit
 * exactly on top of the reflected mountain — which is the one thing this hour
 * has to show. So the sun goes high and hard to the side, at 76-92°, which is
 * DUSK's lesson in Ascent applied here: a light behind the walker flattens
 * everything ahead of them and a light in front silhouettes it, and only a
 * cross-light gives a ridge a lit face and a cool one. Off the axis it also
 * leaves the water reflecting sky rather than sun, and the mirror survives.
 *
 * The composition anchors do not move — the frame at the end is aimed down the
 * same lake at the same mountains. Only what is lighting them changed.
 *
 * ── WHAT THE WATER SHOWS ─────────────────────────────────────────────────────
 * The reflected ray from a seated eye 2.08 m up climbs as the water gets
 * nearer: about 1° at ninety metres out, about 12° at ten, past the skyline
 * entirely inside about five. So the far water hands back the mountains and
 * the near water hands back open sky — which is what a real lake does, and it
 * means the clouds land in the middle of the frame where the eye already is.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Early morning → clear late morning. Azimuth barely moves; elevation does. */
const SUN = { az0: 76, az1: 92, el0: 26, el1: 36 };

const DAY_PALETTE = {
  // The sky's two ends. A daylight zenith is a saturated blue and a daylight
  // horizon is very nearly white — the whole depth of a clear sky is in how
  // far apart those two are, not in how bright either of them is.
  zenith: 0x2f6fcc,
  horizon: 0xa8c6de,
  glow: 0xd6e5f0,        // the haze standing along the horizon; it burns off
  disc: 0xfff6e6,
  ground: 0x74899c,      // the dome below the waterline

  // An alpine lake is not blue because the sky is; it is blue-green because
  // the water itself absorbs the warm end out of whatever goes into it. The
  // shelf near the shore keeps more of the green, the open middle keeps less
  // of anything.
  // Water is never brighter than the sky it is reflecting, and a lake that is
  // reads as a swimming pool. These are darker than the swatch instinct wants
  // by some way, and they have to be: the Fresnel term hands the far half of
  // the frame over to the reflection anyway, and everything the body colour
  // adds on top of that is a lake glowing from the inside.
  deep: 0x0e2836,
  shallow: 0x1e454e,
  haze: 0xa8c0d4,        // what distance dissolves everything into

  fogA: 0x93aec6,
  mist: 0xbdd0e0,        // the low bands lying on the lake

  // ── albedo ────────────────────────────────────────────────────────────────
  // The night's palette was mixed to be seen by a moon: the rock is 0x38404e
  // and the pines are 0x1c262e because at that light level anything darker
  // arrives as black. Under a sun those same values are wet slate and the
  // meadow is a grey rug. Ascent has this note in both directions; the lesson
  // is the same here. Lifting the light instead of the albedo only gives grey
  // a suntan, and it would take the mountains and the water's body with it.
  // The bank runs soil at the bottom to rock at the top, so these two are
  // what the whole near half of the frame is made of. Kept apart in hue as
  // well as in value — two warm greys a shade apart give a slope with nothing
  // on it, and this ground has no texture map to save it.
  // Held down harder than the swatch wants. The shore rocks and the sitting
  // stone are one flat instanced material with no mottling on them — the
  // terrain gets that and they do not — so at any value that reads as "lit
  // granite" they print as pale cardboard wedges in the near field.
  rock: 0x63666a,          // cool granite, and nowhere near chalk
  soil: 0x53553a,          // olive earth with something growing in it
  pine: 0x33533f,          // by day a pine is dark blue-green, not a silhouette
  grass: 0x5c7440,
  reed: 0x848a53,
  wet: 0x3a4148,           // stone at the waterline, darkened by the water in it
};

/*  Aerial perspective, which is the only thing that makes a daylight mountain
 *  read as far away. Each ring is paler and lower in contrast than the one in
 *  front of it; within a ring the foot is dark forest and the top is snow and
 *  haze. Distance is carried by value and by how little contrast is left, not
 *  by darkness — darkness is only what night does. */
const DAY_RIDGES = [
  { foot: 0x4a6784, top: 0x6d89a4, haze: 0x8099b0 },
  { foot: 0x63809a, top: 0x8ba1b6, haze: 0x9db2c5 },
  { foot: 0x7d94aa, top: 0xa5b9cb, haze: 0xb5c7d7 },
  { foot: 0x93a6b8, top: 0xbfcedb, haze: 0xcbd8e4 },
];

const DAY_CURVES = {
  water: {
    // A little livelier than the night at the top end — a morning breeze on an
    // open lake is a real thing and it is what makes the arrival read as "not
    // yet calm" without any haze to say so — and a little flatter at the
    // bottom, because the whole reward here is the mirror.
    amp: (s) => 0.058 * (1 - 0.86 * s) + 0.005,
    swell: (s) => 0.094 * (1 - 0.82 * s) + 0.011,

    ripple: (s) => 1 - 0.91 * s,
    // The floor that keeps this water and not ice, and it matters far more by
    // day than by night: a calm lake under a bright sky is one step away from
    // being a sheet of white paper, and the only thing standing between the
    // two is that the surface never entirely stops moving. Held slightly
    // higher than the night's for exactly that reason.
    micro: (s) => 0.36 - 0.26 * s,

    // The sun is off the frame's axis, so there is no path down the middle to
    // build — and a sun's glitter is five orders of magnitude brighter than a
    // moon's, so what would read as a shimmering column at night reads as a
    // blown highlight here. Both terms are held right down: what they are for
    // is a sheen along the water's right-hand side that says there is a sun
    // somewhere, not a feature anybody looks at.
    shine: (s) => 120 + 1100 * s * s,
    specular: (s) => 0.055 + 0.045 * s,
    pathShine: (s) => 50 + 420 * s * s,
    pathI: (s) => 0.020 + 0.014 * s,

    // how tightly the reflection resolves what it is reflecting
    halo: (s) => 60 + 900 * s * s,
    // by day: how much definition the clouds keep in the water
    detailGain: (s) => 0.30 + 0.70 * s,
    detailSoft: (s) => 1 - s,
    discSize: (s) => 0.00020 * (1 + 2.0 * (1 - s)),
    // Morning haze on the far water, thinner than the night's mist and opening
    // further: the far shore coming back is most of what the settle buys here.
    fog: (s) => 0.0042 - 0.0032 * s,
    // Held a little under the night's. Water hands back less than it is given
    // whatever the hour, but under a bright sky the difference between 0.88
    // and 0.82 is the difference between a lake and a mirror tile.
    albedo: 0.86,
    // Daylight actually goes into the water and comes back out of it, which is
    // most of why a real lake near your feet is green rather than black. It
    // has to come back out the colour the water made it, though: run through
    // the sun's own white, as the night's runs through the moon's, it lifts
    // every channel equally and the whole lake turns to milk. This is the one
    // number that decides whether the foreground is water or paint.
    scatter: 0.040,
    scatterCol: 0x2f8f7a,
  },

  mist: {
    // Morning haze rather than night mist: less of it, and it opens further,
    // but the far bands still hold the far shore until the very end.
    density: (s, t) => Math.max(0, (0.34 - 0.30 * s) * (0.42 + 0.86 * t)),
    sharp: (s) => 0.38 + 0.28 * s,
    drift: (s) => 0.40 + 0.60 * (1 - s),
  },

  wind: (s) => 1 - 0.84 * s,
  // Held well under the night's. Night fog is nearly black, so laying it over
  // a far shore only darkens one; morning haze is nearly white, so the same
  // density does not veil the far shore, it erases it.
  fog: (s) => 0.0031 - 0.0017 * s,
  // The skyline dissolving into the air in front of it, and coming back. This
  // is the one lever that makes the mountains themselves answer the stillness:
  // scene fog cannot reach them (they are drawn without it, at 340 to 1950 m,
  // where any density that touched them would erase them), and the reflection's
  // copy of them is baked. At the arrival they are more than a third of the way
  // into the haze and read as weather; by the end they are nearly all the way
  // back, and the frame has a mountain in it.
  ridgeHaze: (s) => 0.40 - 0.36 * s,
  // Dust and pollen in a morning sunbeam. Fainter than the night's motes,
  // because by day there is a whole sky to compete with.
  motes: (s) => 0.05 + 0.09 * s,

  grade: {
    // A daylight frame wants less of a hole around it than a night one, and
    // the vignette is the first thing that turns a clear morning into a
    // postcard if it is left where the night had it.
    vignette: (s) => 0.21 - 0.05 * s,
    // Held right down and thresholded high. This is the single biggest risk
    // in the hour: a bright sky over bright water will bloom into paste at
    // any setting that looks reasonable at night, and the result is the
    // "postcard" look rather than a clear morning.
    bloom: (s) => 0.075 + 0.045 * s,
    bloomThreshold: (s) => 0.94 - 0.05 * s,
    exposure: (s) => 1.0 + 0.035 * s,
    // Barely any lift, and cool — a daylight shadow is blue because the sky
    // is lighting it, but it is not a mood.
    shadowTint: [0.009, 0.014, 0.026],
    // Deliberately almost neutral. Warming the highlights is what makes a
    // landscape look graded, and this one should look seen.
    highTint: [1.004, 1.000, 0.992],
    // ACES desaturates, and a clear morning is the frame that can least
    // afford it. Put back a little under a fifth; past that it is a filter.
    saturate: 0.17,
    bloomRadius: 0.70,
    aberration: 0.00028,
    grain: 0.0065,
    grainLow: 0.0055,
  },

  audio: {
    // An open bed rather than a closed one. The night closes down to a drone
    // in a stone bowl; the morning stays airy and merely gets quieter, so the
    // filter opens rather than shuts and the reverb dries out instead of
    // growing. Same shape of arrival, different room.
    windGain: (s) => 0.78 * (1 - 0.80 * s),
    lapGain: (s) => 0.80 * (1 - 0.84 * s),
    cutoff: (s) => 2600 + 1500 * s,
    padGain: (s) => 0.48 * (1 - 0.40 * s),
    wet: (s) => 0.52 - 0.16 * s,
    master: (s) => 1 - 0.36 * s,
    // Birds are not a metronome. The gaps open with everything else, but they
    // start shorter than the night's, because a morning lake has more in it.
    sparseGap: (s) => 11 + 34 * s,
    lapCutoff: (s) => 640 - 200 * s,
    // A smaller, drier, brighter room: open air over water rather than a bowl
    // of rock at night.
    room: { seconds: 2.9, decay: 3.1 },
    // The distant call is the common one now, and it sits higher. This is the
    // whole of what says "morning" in the mix, and it says it about once a
    // quarter of a minute rather than once in a while.
    sparse: { lap: 0.30, tree: 0.22, call: 0.48, callHz: 1450, callSpread: 620, callI: 0.011 },
    // The same five-note shape and the same register, moved off the minor the
    // night is built on. D major pentatonic: open rather than bright, which is
    // the difference between a morning and a jingle.
    padNotes: [
      146.83, 164.81, 185.00, 220.00, 246.94,   // D3 E3 F#3 A3 B3
      293.66, 329.63, 369.99, 440.00, 493.88,   // D4 E4 F#4 A4 B4
    ],
  },
};

const DAY = {
  id: 'day',
  label: 'Day',
  tagline: 'a clear mountain morning, and as long as it takes',
  // Opening on the night's near-black and cutting to a bright sky is a flash.
  // A cool pale grey is still a fade from nothing and lands where the sky is.
  fadeIn: '#aab9c8',
  palette: DAY_PALETTE,
  ridges: RIDGE_SHAPE.map((s, i) => ({ ...s, ...DAY_RIDGES[i] })),
  curves: DAY_CURVES,

  // A sun models a ridge far harder than a moon does, and the panorama is what
  // the reflected mountains are made of, so the modelling has to be in there
  // too or the mirror is flatter than the skyline above it.
  panoLit: (c) => 0.68 + 0.58 * c,
  // Baked once, at the middle of the arc. Only the elevation really moves, and
  // the sixteen degrees the azimuth covers change this term by under 0.03.
  panoAz: (SUN.az0 + SUN.az1) * 0.5,

  // Early morning into clear late morning, over about seven minutes, and never
  // backwards: `elapsed` only ever increases. Nothing about it should be
  // noticeable while it is happening — it is the difference between the frame
  // at the arrival and the frame at the end, not an event.
  arc: (state) => smoothstep(25, 430, state ? state.elapsed : 0),

  light(state) {
    const s = state ? clamp(state.settle, 0, 1) : 0;
    const d = DAY.arc(state);

    return {
      dir: direction(lerp(SUN.az0, SUN.az1, d), lerp(SUN.el0, SUN.el1, d)),

      // The sun loses its early warmth as it climbs, and gains a little
      // strength. Both moves are small: this is one morning, not a sunrise.
      keyCol: mixHex(0xffeed2, 0xfff8ec, d), keyI: lerp(3.30, 3.85, d),
      // The number that actually separates morning from night in this world.
      // A daylight sky is an enormous soft box and it is the only reason a
      // shadow on a shore rock reads blue instead of black.
      // A daylight sky is an enormous soft box, but it is not the key. Run at
      // anything near the sun's own strength it flattens every rock and ridge
      // in the frame into one value, which is what "brighter" looks like when
      // it is mistaken for "daylight". Held to under half of it, the shadow
      // side stays blue and the lit side stays a lit side.
      hemiSky: mixHex(0xa8c8ee, 0xbcd8f6, d), hemiGround: 0x736c5b,
      hemiI: lerp(1.45, 1.70, d) - 0.10 * s,
      ambCol: 0x9cb2c6, ambI: 0.40,
      // The lake really does throw this much back up under the shore rocks by
      // day, and it is what keeps the undersides from going flat.
      bounceCol: 0x86aecc, bounceI: 0.34,

      // The haze burning off is the sky's own share of the settle, and it is
      // the one place the dome answers the stillness at all. At night it does
      // not — there, only the reflection changes. Here the air opening is
      // half of what the hour is about, so the sky is allowed to know.
      zenith: mixHex(0x4a83c8, DAY_PALETTE.zenith, 0.35 + 0.65 * s),
      horizon: mixHex(0xdae6ef, DAY_PALETTE.horizon, 0.4 * d + 0.6 * s),
      glow: DAY_PALETTE.glow,
      ground: DAY_PALETTE.ground,
      discCol: DAY_PALETTE.disc,

      glowI: (0.86 - 0.26 * d) * (1 - 0.44 * s),
      discSize: 0.000075,
      discI: 3.6,
      halo: 620.0,
      // Cloud definition in the sky itself is nearly constant — clouds do not
      // sharpen because somebody sat still. What the settle changes is how
      // much of that definition survives the trip through the water.
      detailGain: 1.0,
      detailSoft: 0.0,
      waterGlowI: 1.0,
      waterDiscI: 2.4,
    };
  },

  /* ── the morning sky, once, for both the dome and the water ────────────────
   * The same two entry points, the same signature, a different world inside.
   *
   * The clouds are the reason this hour needed its own function rather than a
   * palette. They are the only thing in the sky with shape in it, they are
   * what the eye uses to read a mirror as a mirror, and because the water calls
   * the identical function down a reflected ray they arrive in the lake for
   * free and — this is the part that matters — they break up and re-form with
   * the surface exactly as the stars do at night. Nothing fades them.
   * ─────────────────────────────────────────────────────────────────────── */
  glsl: /* glsl */`
    const float SW_PANO_MAX = ${PANO_MAX_EL.toFixed(4)};
    const float SW_INV_TAU = 0.15915494;
    const float SW_CLOUD_H = 1500.0;   // m — the deck the clouds are lying on

    /**
     * The cloud field, on a flat deck at SW_CLOUD_H.
     *
     * Three seamless taps of the shared noise at unrelated scales drifting in
     * unrelated directions, which is enough to never resolve into a pattern.
     * Reading a texture rather than hashing in the shader is deliberate: this
     * runs for every sky pixel *and* every lit water pixel, and the water is
     * most of the frame from the moment you reach the shore.
     */
    float swCloudField(sampler2D nz, vec2 p, float t) {
      float a = texture2D(nz, p * 0.00016 + vec2( t * 0.00046,  t * 0.00024)).r;
      float b = texture2D(nz, p * 0.00047 + vec2(-t * 0.00031,  t * 0.00058)).g;
      float c = texture2D(nz, p * 0.00128 + vec2( t * 0.00074, -t * 0.00040)).b;
      return a * 0.62 + b * 0.26 + c * 0.16;
    }

    /**
     * What is in direction d.
     *
     * detailGain is how much definition the clouds keep and detailSoft is
     * how far they have dissolved — the same two arguments the night uses for
     * its stars, and for the same purpose: the water asks a blurrier question
     * when it is broken and gets a blurrier answer.
     */
    vec3 swSky(
      vec3 d, sampler2D noiseTex,
      vec3 zenith, vec3 horizon, vec3 glowCol, vec3 lightDir, vec3 lightCol,
      float glowI, float discSize, float discI, float halo,
      float detailGain, float detailSoft, float time
    ) {
      vec3 dir = normalize(d);
      float h = clamp(dir.y, 0.0, 1.0);

      // The depth of a clear sky is in how far apart its two ends are and how
      // slowly it crosses between them. A linear ramp reads as a backdrop.
      vec3 col = mix(horizon, zenith, pow(h, 0.46));

      float md = max(0.0, dot(dir, lightDir));

      // The haze standing along the horizon. Broad, and everywhere rather than
      // on one azimuth — by day this is the whole atmosphere between here and
      // the mountains, not a glow cast by anything.
      float band = exp(-h * 6.4) * smoothstep(-0.10, 0.03, dir.y);
      col = mix(col, glowCol, clamp(band * glowI * 0.40, 0.0, 0.80));

      // Forward scatter: the sky is measurably paler and warmer for a long way
      // around the sun, and leaving it out is what makes a shader sky read as
      // a gradient with a dot on it.
      col += glowCol * pow(md, 4.0) * 0.11 * glowI;

      if (detailGain > 0.002) {
        // The deck, projected. The divide blows up toward the horizon, which
        // is correct — clouds really do compress into a band down there — but
        // it also blows up the sampling, so the field is faded out well before
        // it can turn into stretched noise.
        float cy = max(dir.y, 0.045);
        vec2 cp = dir.xz / cy * SW_CLOUD_H;
        float n = swCloudField(noiseTex, cp, time);

        // Coverage. Softening the edge is what detailSoft does: a cloud seen
        // in broken water has no edge left, only a bright place.
        float edge = 0.115 + detailSoft * 0.30;
        float cover = 0.565 + detailSoft * 0.045;
        float thick = smoothstep(cover, cover + edge, n);

        // Lit from above and from the sun's side; the thin parts stay bright
        // because there is not enough of them to shade anything.
        vec3 lit = mix(vec3(0.93, 0.95, 0.99), vec3(1.02, 1.01, 0.98), 0.5);
        vec3 shade = mix(zenith, vec3(0.62, 0.68, 0.76), 0.62);
        vec3 cc = mix(lit, shade, smoothstep(0.35, 1.0, thick) * 0.72);
        // the silver edge on the sun side, only where the cloud is thin
        cc += lightCol * pow(md, 6.0) * 0.55 * (1.0 - thick);

        // Into the haze at the bottom, and out of existence below it. Both are
        // what the eye expects and both keep the projection out of trouble.
        float a = thick * detailGain * smoothstep(0.020, 0.155, dir.y);
        cc = mix(glowCol, cc, smoothstep(0.03, 0.30, dir.y));
        col = mix(col, cc, clamp(a, 0.0, 1.0));
      }

      col += lightCol * smoothstep(1.0 - discSize, 1.0 - discSize * 0.28, md) * discI;
      col += lightCol * pow(md, halo) * 0.55;

      return col;
    }

    /** The same, with the skyline in front of it. Used only by the water. */
    vec3 swWorld(
      vec3 d, sampler2D pano, sampler2D noiseTex,
      vec3 zenith, vec3 horizon, vec3 glowCol, vec3 lightDir, vec3 lightCol,
      float glowI, float discSize, float discI, float halo,
      float detailGain, float detailSoft, float time
    ) {
      vec3 dir = normalize(d);
      vec3 col = swSky(dir, noiseTex, zenith, horizon, glowCol, lightDir, lightCol,
                       glowI, discSize, discI, halo, detailGain, detailSoft, time);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      if (el < SW_PANO_MAX) {
        float u = atan(dir.z, dir.x) * SW_INV_TAU + 0.5;
        vec4 m = texture2D(pano, vec2(u, clamp(el / SW_PANO_MAX, 0.0, 1.0)));
        col = mix(col, m.rgb, m.a);
      }
      return col;
    }
  `,
};

/* ── the skyline, baked ───────────────────────────────────────────────────── */

/**
 * RGBA, `w` columns of azimuth (atan2(z, x), wrapping) by `h` rows of elevation
 * from 0 to PANO_MAX_EL. Alpha is coverage, so the ridge line antialiases
 * instead of stepping.
 *
 * The water reads this down a reflected ray. It is not used for the real
 * mountains — those are geometry, and this is generated from the same profile
 * function they are, so the two agree.
 */
export function panoramaPixels(w, h, mood) {
  const data = new Uint8Array(w * h * 4);
  const dE = PANO_MAX_EL / h;
  const ridges = mood.ridges;
  const lightAz = Math.atan2(direction(mood.panoAz, 0)[2], direction(mood.panoAz, 0)[0]);

  // one column of ridge elevations per layer, so the profile is evaluated once
  const elev = ridges.map((L, i) => {
    const row = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const az = (x / w - 0.5) * Math.PI * 2;
      row[x] = Math.atan2(ridgeHeight(i, az) - EYE_Y, L.r);
    }
    return row;
  });

  const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const cols = ridges.map((L) => ({ foot: rgb(L.foot), top: rgb(L.top), haze: rgb(L.haze) }));

  for (let x = 0; x < w; x++) {
    const az = (x / w - 0.5) * Math.PI * 2;
    // the flank turned toward the light keeps more of it on it
    const lit = mood.panoLit(Math.max(0, Math.cos(az - lightAz)));
    for (let y = 0; y < h; y++) {
      const e = (y + 0.5) * dE;
      let r = 0, g = 0, b = 0, a = 0;
      for (let L = 0; L < ridges.length; L++) {
        const top = elev[L][x];
        if (e > top + dE * 0.5) continue;              // this layer is behind us
        const cov = Math.min(1, Math.max(0, (top - e) / dE + 0.5));
        if (cov <= 0.002) continue;
        const t = Math.min(1, Math.max(0, e / Math.max(1e-4, top)));
        const sm = t * t * (3 - 2 * t);
        const c = cols[L];
        // foot → ridge line, then the last of it dissolving into haze
        const k = Math.min(1, Math.max(0, (t - 0.52) / 0.48));
        for (let ch = 0; ch < 3; ch++) {
          const base = c.foot[ch] + (c.top[ch] - c.foot[ch]) * sm;
          const v = base + (c.haze[ch] - base) * k * 0.75;
          const out = v * lit;
          if (ch === 0) r = out; else if (ch === 1) g = out; else b = out;
        }
        a = cov * 255;
        break;
      }
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, r); data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b); data[i + 3] = a;
    }
  }
  return data;
}

/* ── selection ────────────────────────────────────────────────────────────── */

export const MOODS = { moonlit: MOONLIT, day: DAY };
export const MOOD_ORDER = ['moonlit', 'day'];
export const DEFAULT_MOOD = 'moonlit';

export function resolveMood(name) {
  return MOODS[name] || MOODS[DEFAULT_MOOD];
}
