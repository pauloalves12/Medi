/**
 * lake.js — the water.
 * @see water/main.js MODULE CONTRACT
 *
 * One mesh, one material, no render targets, no second camera, no extra pass.
 *
 * ── HOW THE REFLECTION WORKS ─────────────────────────────────────────────────
 * A planar reflection costs a whole second render of the world. What it buys —
 * exact geometry in the water — is worth almost nothing here, because what is
 * above this lake is a sky, a moon, a field of stars and four rings of distant
 * silhouette, none of which have any parallax worth resolving from a camera
 * that moves two metres.
 *
 * So the water asks instead. For each fragment it reflects the view vector
 * about the perturbed surface normal and calls `swWorld` — the same GLSL
 * function that paints the sky dome, plus a lookup into a panorama of the
 * skyline baked from the same profile the mountains are built from. One texture
 * fetch and some arithmetic returns the moon, its haloes, the horizon band, the
 * stars and the mountains, correctly placed, for the price of a lit pixel.
 *
 * ── AND WHY THAT MAKES THE MECHANIC WORK ─────────────────────────────────────
 * Because the reflection is sampled *through the normal*, breaking the surface
 * breaks the reflection for free and exactly. A disturbed lake scatters the
 * reflected rays over a wide cone, so the moon's mirror image smears into a
 * shivering path and the stars are lost in it. A still one hands back a clean
 * disc with the field of stars around it. Nothing fades anything: the same
 * arithmetic simply gets a steadier question.
 *
 * The geometry stays nearly flat throughout — the whole displacement is under
 * six centimetres. What the eye reads as the lake calming is almost entirely
 * the normal, which is as it should be: you do not see the shape of water, you
 * see what it is doing to the light.
 */

import * as THREE from 'three';
import { PALETTE, GLSL_NIGHT, moonDirection, panoramaPixels, curves } from './mood.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const Z_NEAR = 8, Z_FAR = -320, HALF_X = 330;

const RING_SLOTS = 3;
const RING_SPEED = 1.55;      // m/s outward
const RING_LIFE = 9.5;        // s until a ring has gone
const RING_AMP = 0.030;       // m of crest

/* ── the wave field, shared by the vertex and the fragment ────────────────── */

const GLSL_WAVES = /* glsl */`
  const vec2 SW_K1 = vec2( 0.140,  0.078);   // ~39 m — the broad undulation
  const vec2 SW_K2 = vec2(-0.320,  0.530);   // ~10 m
  const vec2 SW_K3 = vec2( 1.120, -0.990);   // ~4.2 m

  float swSwell(vec2 p, float t){
    return sin(dot(p, SW_K1) + t * 0.31) * 0.55
         + sin(dot(p, SW_K2) + t * 0.24 + 1.7) * 0.30
         + sin(dot(p, SW_K3) + t * 0.44 + 3.1) * 0.15;
  }

  vec2 swSwellGrad(vec2 p, float t){
    return SW_K1 * (cos(dot(p, SW_K1) + t * 0.31) * 0.55)
         + SW_K2 * (cos(dot(p, SW_K2) + t * 0.24 + 1.7) * 0.30)
         + SW_K3 * (cos(dot(p, SW_K3) + t * 0.44 + 3.1) * 0.15);
  }
`;

export function createLake(scene, ctx, deps) {
  const preset = ctx.preset;
  const groundHeight = deps.groundHeight;
  const centre = deps.rippleCentre;
  let time = 0;

  /* ── the skyline, baked ─────────────────────────────────────────────────── */

  const pw = preset.panoWidth, ph = preset.panoHeight;
  const pano = new THREE.DataTexture(panoramaPixels(pw, ph), pw, ph, THREE.RGBAFormat);
  pano.colorSpace = THREE.SRGBColorSpace;
  pano.wrapS = THREE.RepeatWrapping;          // azimuth wraps
  pano.wrapT = THREE.ClampToEdgeWrapping;     // elevation does not
  pano.minFilter = pano.magFilter = THREE.LinearFilter;
  pano.generateMipmaps = false;
  pano.needsUpdate = true;

  /* ── geometry ───────────────────────────────────────────────────────────────
   * Built in world space and added at the origin, so the shaders can work in
   * world coordinates without a transform. Both axes are warped toward the
   * shore: the near water is where a crest has to be a crest, and the far water
   * is a mirror under mist that a coarse triangle serves perfectly well.
   *
   * `aDepth` is the real water depth in metres, taken from the same height
   * function the player walks on. It is what tells the shader where the shelf
   * is, where to stop the swell so it does not saw through the shingle, and
   * where there is no lake at all.
   * ────────────────────────────────────────────────────────────────────────── */

  const SEG = preset.waterSeg;

  function buildGeometry() {
    const n = SEG, np = n + 1;
    const pos = new Float32Array(np * np * 3);
    const dep = new Float32Array(np * np);
    const idx = new Uint32Array(n * n * 6);

    const cx = new Float32Array(np), cz = new Float32Array(np);
    for (let i = 0; i < np; i++) {
      const t = (i / n) * 2 - 1;
      cx[i] = Math.sign(t) * Math.pow(Math.abs(t), 1.85) * HALF_X;
      const u = i / n;
      cz[i] = Z_NEAR - (Math.exp(u * 3.1) - 1) / (Math.exp(3.1) - 1) * (Z_NEAR - Z_FAR);
    }

    let p = 0, q = 0;
    for (let j = 0; j < np; j++) {
      const z = cz[j];
      for (let i = 0; i < np; i++) {
        const x = cx[i];
        pos[p] = x; pos[p + 1] = 0; pos[p + 2] = z;
        dep[q] = clamp(-groundHeight(x, z), -2.5, 40);
        p += 3; q += 1;
      }
    }

    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // z decreases along j, so the winding is the mirror of the usual one.
        // Backwards, the whole lake is a downward-facing surface and vanishes.
        const a = j * np + i, b = a + 1, c = a + np, d = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  /* ── material ───────────────────────────────────────────────────────────── */

  const md = moonDirection();

  const uniforms = {
    uNoise: { value: deps.noise },
    uPano: { value: pano },
    uTime: { value: 0 },

    uAmp: { value: 0.05 },
    uSwell: { value: 0.08 },
    uRipple: { value: 1.0 },
    uMicro: { value: 0.30 },
    uShine: { value: 32 },
    uSpecI: { value: 0.26 },
    uPathShine: { value: 22 },
    uPathI: { value: 0.30 },
    uBreath: { value: 0 },
    uLod: { value: 0.012 },

    uZenith: { value: new THREE.Color(PALETTE.zenith) },
    uHorizon: { value: new THREE.Color(PALETTE.horizon) },
    uGlow: { value: new THREE.Color(PALETTE.glow) },
    uMoonDir: { value: new THREE.Vector3(md[0], md[1], md[2]).normalize() },
    uMoonCol: { value: new THREE.Color(PALETTE.moon) },
    uGlowI: { value: 1.0 },
    uMoonSize: { value: 0.00026 },
    uDiscI: { value: 2.1 },
    uHalo: { value: 60 },
    uStarGain: { value: 0.1 },
    uStarSoft: { value: 1.0 },

    uDeep: { value: new THREE.Color(PALETTE.deep) },
    uShallow: { value: new THREE.Color(PALETTE.shallow) },
    uHaze: { value: new THREE.Color(PALETTE.haze) },
    uFogK: { value: 0.0125 },

    uRingC: { value: new THREE.Vector2(centre.x, centre.z) },
    uRings: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uRingLight: { value: 0.055 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: false,                 // the haze is analytic in here, toward the horizon
    transparent: false,
    depthWrite: true,
    side: THREE.FrontSide,
    vertexShader: GLSL_WAVES + /* glsl */`
      attribute float aDepth;
      uniform float uTime, uAmp, uRingLight;
      uniform vec2 uRingC;
      uniform vec3 uRings[${RING_SLOTS}];
      varying vec3 vWorld;
      varying float vDepth;

      void main(){
        vec3 wp = position;
        vDepth = aDepth;

        float h = swSwell(wp.xz, uTime) * uAmp;

        // the breathing rings, as actual crests in the surface
        float rd = length(wp.xz - uRingC);
        for (int i = 0; i < ${RING_SLOTS}; i++) {
          float st = uRings[i].y;
          if (st <= 0.001) continue;
          float q = (rd - uRings[i].x) / uRings[i].z;
          h += exp(-q * q) * st * ${RING_AMP.toFixed(4)};
        }

        // nothing moves where the water is only ankle deep, or the swell would
        // saw straight through the shingle
        h *= smoothstep(0.0, 0.75, aDepth);

        wp.y = h - 0.02;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: GLSL_NIGHT + GLSL_WAVES + /* glsl */`
      uniform sampler2D uNoise, uPano;
      uniform float uTime, uSwell, uRipple, uMicro, uShine, uSpecI, uBreath, uLod;
      uniform float uPathShine, uPathI;
      uniform vec3 uZenith, uHorizon, uGlow, uMoonDir, uMoonCol;
      uniform float uGlowI, uMoonSize, uDiscI, uHalo, uStarGain, uStarSoft;
      uniform vec3 uDeep, uShallow, uHaze;
      uniform float uFogK, uRingLight;
      uniform vec2 uRingC;
      uniform vec3 uRings[${RING_SLOTS}];
      varying vec3 vWorld;
      varying float vDepth;

      void main(){
        // there is no lake inside the headlands; the terrain covers it anyway
        if (vDepth < -0.9) discard;

        vec3 toCam = cameraPosition - vWorld;
        float dist = max(length(toCam), 1e-4);
        vec3 V = -toCam / dist;                 // camera → fragment

        // Detail the eye could not resolve is detail that only aliases. This
        // also happens to be why distant water always looks like a mirror.
        float lod = exp(-dist * uLod);
        // The shimmer is finer than the ripple, so it goes first and it goes
        // faster — which is what makes the far half of the lake settle into a
        // mirror while the near half is still alive.
        float microLod = exp(-dist * uLod * 2.4);

        // The swell on its own, kept: the moon path is built off this, and it
        // has to be continuous whatever the ripple is doing.
        vec2 broad = swSwellGrad(vWorld.xz, uTime) * uSwell;
        vec2 slope = broad;

        // ── where the air is touching the water ──────────────────────────────
        // A real lake is never evenly calm. The wind lands in patches twenty
        // metres across that drift and dissolve, so some of the surface is
        // ruffled while the rest of it is glass. One very low-frequency tap
        // buys all of that: it modulates the ripple, and further down it
        // modulates how sharply the reflection resolves, so the mirror is
        // crisper in some places than others rather than uniformly soft.
        vec2 qp = vWorld.xz * 0.045 + vec2(uTime * 0.0043, uTime * -0.0026);
        float ruffle = 0.35 + 1.15 * smoothstep(0.28, 0.82, texture2D(uNoise, qp).b);

        // Three scrolling taps of the shared noise, read as a vector field
        // rather than a height — one fetch per octave instead of three, and a
        // ripple normal does not care that it is not anybody's true gradient.
        // The three drift at unrelated speeds in unrelated directions so the
        // field never resolves into a pattern.
        vec2 q1 = vWorld.xz * 0.55 + vec2(uTime * 0.024, uTime * -0.015);
        vec2 q2 = vWorld.xz * 1.63 + vec2(uTime * -0.019, uTime * 0.027);
        vec2 q3 = vWorld.xz * 5.20 + vec2(uTime * 0.300, uTime * 0.210);
        vec2 r1 = texture2D(uNoise, q1).rg - 0.5;
        vec2 r2 = texture2D(uNoise, q2).rg - 0.5;
        vec2 r3 = texture2D(uNoise, q3).rg - 0.5;

        // wind ripple: answers the stillness, and only where the wind is
        slope += (r1 + r2 * 0.62) * uRipple * ruffle * lod * 0.30;
        // the lake's own shimmer: quieter when calm, never absent
        slope += r3 * uMicro * mix(1.0, ruffle, 0.45) * microLod * 0.30;

        vec2 d2 = vWorld.xz - uRingC;
        float rd = length(d2);
        vec2 rdir = rd > 1e-4 ? d2 / rd : vec2(0.0);
        float ringGlow = 0.0;
        for (int i = 0; i < ${RING_SLOTS}; i++) {
          float st = uRings[i].y;
          if (st <= 0.001) continue;
          float w = uRings[i].z;
          float q = (rd - uRings[i].x) / w;
          float e = exp(-q * q);
          slope += rdir * (-2.0 * q / w * e * st * ${(RING_AMP * 2.6).toFixed(4)});
          ringGlow += exp(-q * q * 1.25) * st;
        }

        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

        vec3 R = reflect(V, N);
        R.y = max(R.y, 0.0035);
        // the inhale stretches what is standing in the water, very slightly
        R.y *= 1.0 - uBreath * 0.09;
        R = normalize(R);

        // Ruffled water cannot hold an edge. Letting the patch field bend the
        // halo and the star threshold means the reflection resolves at
        // different sharpnesses across the same lake, which is what stops it
        // reading as one uniformly blurred image.
        float sharp = clamp(ruffle - 0.5, 0.0, 1.0);
        vec3 refl = swWorld(R, uPano, uZenith, uHorizon, uGlow, uMoonDir, uMoonCol,
                            uGlowI, uMoonSize * (1.0 + sharp * 0.9), uDiscI,
                            uHalo * mix(1.0, 0.5, sharp),
                            uStarGain * mix(1.0, 0.72, sharp),
                            clamp(uStarSoft + sharp * 0.30, 0.0, 1.0), uTime);
        refl *= 0.88;                            // water is not a mirror

        // A slightly harder grazing response than Schlick's fifth power: the
        // far half of a lake really does go almost fully reflective, and the
        // softer exponent was leaving it too dark to read as water at all.
        float ndv = clamp(dot(N, -V), 0.0, 1.0);
        float fres = 0.022 + 0.978 * pow(1.0 - ndv, 4.2);
        // Bending the normal only shows where the reflected image has contrast
        // in it, and most of what this lake reflects is a near-black mountain.
        // So the patches have to reach the reflectance too: ruffled water hands
        // back more sky and less of the dark below it, which is why a night
        // lake is visibly mottled rather than one flat value.
        fres = clamp(fres * (0.90 + 0.22 * (ruffle - 0.9)), 0.0, 1.0);

        // depth as colour: the shelf under the shore against the open middle
        vec3 body = mix(uShallow, uDeep, smoothstep(0.15, 7.0, vDepth));
        // Lifted less than it was. The shallows needed rescuing from black, but
        // at 1.55 the foreground went milky and swallowed the sheen that is
        // carrying the surface there.
        body = mix(body * 1.32, body, smoothstep(0.05, 0.9, vDepth));
        // Absorption. Water takes the warm end of the spectrum out first and
        // takes more of it the further down the light has to go, so shallow
        // water over a bed is warmer and brighter than the open middle is.
        body *= mix(vec3(1.16, 1.12, 1.08), vec3(0.70, 0.81, 1.00),
                    smoothstep(0.3, 8.0, vDepth));
        // Light that went in and came back out. Without it the water at the
        // player's own feet — where almost nothing reflects — is simply black.
        body += uMoonCol * 0.007 * (0.35 + 0.65 * max(0.0, -V.y));

        vec3 col = mix(body, refl, fres);

        // The moon path, in two parts. The broad lobe comes off the swell alone
        // and is continuous by construction — it is the column. The tight one
        // comes off the full normal and only fires where a ripple crest happens
        // to face the moon — it is the glitter riding on the column. Either
        // alone reads wrong: the first as a painted smear, the second as a
        // handful of fireflies.
        vec3 H = normalize(uMoonDir - V);
        vec3 Nb = normalize(vec3(-broad.x, 1.0, -broad.y));
        // The shimmer breaks the column up from the inside — free, because the
        // field is already fetched. Without it the path is an airbrushed smear
        // with no grain in it, which is the other half of why calm water was
        // reading as a solid.
        float grain = 0.66 + 1.30 * length(r3);
        col += uMoonCol * pow(max(dot(Nb, H), 0.0), uPathShine) * uPathI
             * mix(1.0, grain, 0.55);
        col += uMoonCol * pow(max(dot(N, H), 0.0), uShine) * uSpecI;
        // A wide, weak sheen over the whole moon-facing half of the lake,
        // textured by the same shimmer. This is the term that actually carries
        // the surface: it gives the water something of its own to show, instead
        // of leaving it to reflect a dark mountain and look like slate.
        col += uMoonCol * pow(max(dot(N, H), 0.0), 9.0) * 0.020
             * (0.45 + 1.05 * length(r3)) * lod;

        col += uMoonCol * ringGlow * uRingLight;

        // The waterline itself: a wet gleam a hand's width wide, broken up so
        // it is a shore rather than a drawn curve.
        float edge = (1.0 - smoothstep(0.0, 0.30, vDepth)) * smoothstep(-0.12, 0.02, vDepth);
        col += uMoonCol * edge * 0.055 * (0.55 + 0.90 * length(r2));

        col = mix(col, uHaze, 1.0 - exp(-dist * uFogK));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -20;
  scene.add(mesh);

  /* ── the breathing rings ────────────────────────────────────────────────── */

  const rings = [];
  for (let i = 0; i < RING_SLOTS; i++) rings.push({ age: -1, peak: 0 });
  let next = 0;

  /** One ring, opening out of the reflected moon. Strength is 0..1. */
  function pulse(strength) {
    const r = rings[next];
    next = (next + 1) % RING_SLOTS;
    r.age = 0;
    r.peak = clamp(strength === undefined ? 1 : strength, 0, 1);
  }

  function tickRings(dt) {
    for (let i = 0; i < RING_SLOTS; i++) {
      const r = rings[i];
      const u = uniforms.uRings.value[i];
      if (r.age < 0) { u.set(0, 0, 1); continue; }
      r.age += dt;
      if (r.age > RING_LIFE) { r.age = -1; u.set(0, 0, 1); continue; }
      const t = r.age / RING_LIFE;
      // opens quickly, then spreads and thins — a ring on a lake does not
      // travel far before it is only a change in the light
      const radius = 0.35 + RING_SPEED * r.age * (1 - 0.35 * t);
      const width = 0.55 + 2.0 * t;
      const strength = r.peak * (1 - t) * (1 - t) * Math.min(1, r.age * 5);
      u.set(radius, strength, width);
    }
  }

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt, state) {
    time += dt;
    uniforms.uTime.value = time;
    tickRings(dt);

    const s = state ? clamp(state.settle, 0, 1) : 0;
    const w = curves.water;

    uniforms.uAmp.value = w.amp(s);
    uniforms.uSwell.value = w.swell(s);
    uniforms.uRipple.value = w.ripple(s);
    uniforms.uMicro.value = w.micro(s);
    uniforms.uShine.value = w.shine(s);
    uniforms.uSpecI.value = w.specular(s);
    uniforms.uPathShine.value = w.pathShine(s);
    uniforms.uPathI.value = w.pathI(s);
    uniforms.uHalo.value = w.halo(s);
    uniforms.uStarGain.value = w.starGain(s);
    uniforms.uStarSoft.value = w.starSoft(s);
    uniforms.uFogK.value = w.fog(s);
    // a broken surface cannot hold an edge, so the reflected disc softens with
    // everything else rather than staying a hard dot inside a smear
    uniforms.uMoonSize.value = 0.00026 * (1 + 2.2 * (1 - s));
    uniforms.uBreath.value = state ? clamp(state.breathTilt, -0.5, 0.5) : 0;
  }

  return { update, pulse, material };
}
