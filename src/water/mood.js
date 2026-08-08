/**
 * mood.js — Still Water as data.
 *
 * The leaf of the experience: colours, the mountain profile, the response
 * curves every module reads, and the one piece of GLSL that has to be identical
 * in two places. It imports nothing and draws nothing, which is the same
 * arrangement timeofday.js has in Ascent and for the same reason — a world
 * whose look lives in a table can be retuned without touching behaviour.
 *
 * ── s ────────────────────────────────────────────────────────────────────────
 * Every curve below takes `s`: the settle, 0..1. That is the stillness the
 * player has earned (see stillness.js), floored during the ending so a restless
 * night still arrives somewhere. Nothing in this file knows where it came from.
 *
 * ── why the sky is a function and not a shader ───────────────────────────────
 * `GLSL_NIGHT` is included by both the sky dome and the water. The dome draws
 * it looking outward; the water calls the same function down a reflected ray.
 * That is the whole reflection technique: no second camera, no render target,
 * no extra pass — the water asks the sky what is in a direction, and the sky
 * answers with the same arithmetic that painted it. Stars, the moon, its
 * haloes and the horizon band all appear in the lake because they cannot not.
 */

/* ── the hour ─────────────────────────────────────────────────────────────── */

/** Azimuth measured from -Z toward +X, elevation from the horizon. Degrees. */
export const MOON = { az: -7, el: 17 };

export function moonDirection() {
  const a = MOON.az * Math.PI / 180, e = MOON.el * Math.PI / 180;
  const ce = Math.cos(e);
  return [Math.sin(a) * ce, Math.sin(e), -Math.cos(a) * ce];
}

export const PALETTE = {
  zenith: 0x04060d,
  horizon: 0x0b1120,
  glow: 0x1a2540,        // the band the moon lays along the horizon
  moon: 0xdde7f5,
  ground: 0x03050a,      // the dome below the waterline

  deep: 0x06090f,        // open water, straight down
  shallow: 0x0d1522,     // over the shelf near the shore
  haze: 0x0c1322,        // what distance dissolves everything into

  fogA: 0x0a101c,

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
};

/* ── the mountains ────────────────────────────────────────────────────────────
 * Four rings. Against a moonlit sky a distant ridge fades *up* into the horizon
 * haze rather than down into black — the sky is brightest where it meets the
 * water, so distance means less contrast and more value, not more darkness.
 * ────────────────────────────────────────────────────────────────────────── */

export const RIDGES = [
  { r: 340,  h: 58,  freq: 3.2, seed: 4.1,  foot: 0x05080e, top: 0x0a0f1a, haze: 0x0b1220 },
  { r: 700,  h: 128, freq: 2.4, seed: 11.7, foot: 0x070b14, top: 0x0d1322, haze: 0x0e1626 },
  { r: 1250, h: 236, freq: 1.9, seed: 19.3, foot: 0x090e19, top: 0x111a2c, haze: 0x121c30 },
  { r: 1950, h: 372, freq: 1.4, seed: 27.5, foot: 0x0b1120, top: 0x151f36, haze: 0x16213a },
];

/** How high the reflection panorama reaches. Nothing on the skyline is near it. */
export const PANO_MAX_EL = 0.26;   // rad ≈ 14.9°
export const EYE_Y = 2.08;         // where the meditation seat puts the eye

function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Ridge-line height in metres for a layer, at a world azimuth in radians. */
export function ridgeHeight(layer, angle) {
  const L = RIDGES[layer];
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

/**
 * The skyline, baked. RGBA, `w` columns of azimuth (atan2(z, x), wrapping) by
 * `h` rows of elevation from 0 to PANO_MAX_EL. Alpha is coverage, so the ridge
 * line antialiases instead of stepping.
 *
 * The water reads this down a reflected ray. It is not used for the real
 * mountains — those are geometry, and this is generated from the same profile
 * function they are, so the two agree.
 */
export function panoramaPixels(w, h) {
  const data = new Uint8Array(w * h * 4);
  const dE = PANO_MAX_EL / h;
  const moonAz = Math.atan2(moonDirection()[2], moonDirection()[0]);

  // one column of ridge elevations per layer, so the profile is evaluated once
  const elev = RIDGES.map((L, i) => {
    const row = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const az = (x / w - 0.5) * Math.PI * 2;
      row[x] = Math.atan2(ridgeHeight(i, az) - EYE_Y, L.r);
    }
    return row;
  });

  const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const cols = RIDGES.map((L) => ({ foot: rgb(L.foot), top: rgb(L.top), haze: rgb(L.haze) }));

  for (let x = 0; x < w; x++) {
    const az = (x / w - 0.5) * Math.PI * 2;
    // the flank turned toward the moon keeps a little more light on it
    const lit = 0.80 + 0.34 * Math.max(0, Math.cos(az - moonAz));
    for (let y = 0; y < h; y++) {
      const e = (y + 0.5) * dE;
      let r = 0, g = 0, b = 0, a = 0;
      for (let L = 0; L < RIDGES.length; L++) {
        const top = elev[L][x];
        if (e > top + dE * 0.5) continue;              // this layer is behind us
        const cov = Math.min(1, Math.max(0, (top - e) / dE + 0.5));
        if (cov <= 0.002) continue;
        const t = Math.min(1, Math.max(0, e / Math.max(1e-4, top)));
        const s = t * t * (3 - 2 * t);
        const c = cols[L];
        // foot → ridge line, then the last of it dissolving into haze
        const k = Math.min(1, Math.max(0, (t - 0.52) / 0.48));
        for (let ch = 0; ch < 3; ch++) {
          const base = c.foot[ch] + (c.top[ch] - c.foot[ch]) * s;
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

/* ── how the world answers ────────────────────────────────────────────────────
 * Nothing here is dramatic on purpose. The lake at its most disturbed is still
 * a mountain lake at night, and the difference between the two ends has to read
 * as the same place seen more clearly — not as a different place.
 * ────────────────────────────────────────────────────────────────────────── */

export const curves = {
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
    starGain: (s) => 0.10 + 0.95 * s,
    starSoft: (s) => 1 - s,
    // the far water dissolving into the horizon
    fog: (s) => 0.0125 - 0.0052 * s,
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
  // Barely there on purpose. Anything you can count is not atmosphere.
  motes: (s) => 0.09 + 0.15 * s,

  grade: {
    vignette: (s) => 0.34 - 0.07 * s,
    bloom: (s) => 0.22 + 0.14 * s,
    bloomThreshold: (s) => 0.72 - 0.10 * s,
    exposure: (s) => 1.0 + 0.10 * s,
    shadowTint: [0.020, 0.028, 0.052],
    highTint: [0.985, 1.000, 1.045],
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
  },
};

/* ── the sky, once, for both the dome and the water ───────────────────────── */

export const GLSL_NIGHT = /* glsl */`
  const float SW_PANO_MAX = ${PANO_MAX_EL.toFixed(4)};
  const float SW_INV_TAU = 0.15915494;

  /**
   * What is in direction d. Every parameter that the water wants to bend —
   * how tight the moon's halo is, how many stars survive — is an argument
   * rather than a uniform, because the dome and the lake want different
   * answers from the same function on the same frame.
   */
  vec3 swSky(
    vec3 d, vec3 zenith, vec3 horizon, vec3 glowCol, vec3 moonDir, vec3 moonCol,
    float glowI, float moonSize, float discI, float halo,
    float starGain, float starSoft, float time
  ) {
    vec3 dir = normalize(d);
    float h = dir.y;
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));

    // the band the moon lays along the horizon, tight and concentrated on its
    // own azimuth — the only warmth in the frame and there is not much of it
    vec3 mFlat = normalize(vec3(moonDir.x, 0.0, moonDir.z) + 1e-5);
    float az = max(0.0, dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), mFlat));
    float band = exp(-max(h, 0.0) * 8.5) * smoothstep(-0.11, 0.02, h);
    col += glowCol * band * (0.26 + 0.74 * pow(az, 2.2)) * glowI;

    if (starGain > 0.002) {
      // A star is a point inside its cell with a round falloff around it, not
      // the cell itself — hashing a quantised direction and lighting the whole
      // cube gives you a sky full of little squares.
      vec3 sp = dir * 168.0;
      vec3 cell = floor(sp);
      float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      // starSoft lifts the threshold: a broken surface keeps only the bright
      // ones, and the faint field comes back as the water goes quiet
      float thr = 0.9948 + starSoft * 0.0038;
      if (r > thr) {
        float b = fract(r * 137.31);
        vec3 off = vec3(fract(r * 31.7), fract(r * 57.3), fract(r * 91.1)) - 0.5;
        float d = length(fract(sp) - 0.5 - off * 0.55);
        float s = smoothstep(0.42, 0.06, d)
                * smoothstep(thr, min(0.99994, thr + 0.0020), r);
        float tw = 0.62 + 0.38 * sin(time * (0.5 + b * 1.4) + r * 96.0);
        col += vec3(0.74, 0.81, 1.0) * s * (0.28 + 0.95 * b) * tw
             * smoothstep(-0.02, 0.28, h) * starGain;
      }
    }

    float md = max(0.0, dot(dir, moonDir));
    col += moonCol * smoothstep(1.0 - moonSize, 1.0 - moonSize * 0.28, md) * discI;
    col += moonCol * pow(md, halo) * 0.40;
    col += moonCol * pow(md, 9.0) * 0.05;

    return col;
  }

  /** The same, with the skyline in front of it. Used only by the water. */
  vec3 swWorld(
    vec3 d, sampler2D pano,
    vec3 zenith, vec3 horizon, vec3 glowCol, vec3 moonDir, vec3 moonCol,
    float glowI, float moonSize, float discI, float halo,
    float starGain, float starSoft, float time
  ) {
    vec3 dir = normalize(d);
    vec3 col = swSky(dir, zenith, horizon, glowCol, moonDir, moonCol,
                     glowI, moonSize, discI, halo, starGain, starSoft, time);
    float el = asin(clamp(dir.y, -1.0, 1.0));
    if (el < SW_PANO_MAX) {
      float u = atan(dir.z, dir.x) * SW_INV_TAU + 0.5;
      vec4 m = texture2D(pano, vec2(u, clamp(el / SW_PANO_MAX, 0.0, 1.0)));
      col = mix(col, m.rgb, m.a);
    }
    return col;
  }
`;
