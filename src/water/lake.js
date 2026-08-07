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
        const a = j * np + i, b = a + 1, c = a + np, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
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
    uDetail: { value: 1.0 },
    uShine: { value: 55 },
    uSpecI: { value: 0.30 },
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
      uniform float uTime, uSwell, uDetail, uShine, uSpecI, uBreath, uLod;
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

        vec2 slope = swSwellGrad(vWorld.xz, uTime) * uSwell;

        // Two scrolling taps of the shared noise, read as a vector field rather
        // than a height — one fetch per octave instead of three, and a ripple
        // normal does not care that it is not anybody's true gradient.
        vec2 q1 = vWorld.xz * 0.55 + vec2(uTime * 0.024, uTime * -0.015);
        vec2 q2 = vWorld.xz * 1.63 + vec2(uTime * -0.019, uTime * 0.027);
        vec2 r1 = texture2D(uNoise, q1).rg - 0.5;
        vec2 r2 = texture2D(uNoise, q2).rg - 0.5;
        slope += (r1 + r2 * 0.62) * uDetail * lod * 0.30;

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

        vec3 refl = swWorld(R, uPano, uZenith, uHorizon, uGlow, uMoonDir, uMoonCol,
                            uGlowI, uMoonSize, uDiscI, uHalo, uStarGain, uStarSoft, uTime);
        refl *= 0.88;                            // water is not a mirror

        float ndv = clamp(dot(N, -V), 0.0, 1.0);
        float fres = 0.020 + 0.980 * pow(1.0 - ndv, 5.0);

        // depth as colour: the shelf under the shore against the open middle
        vec3 body = mix(uShallow, uDeep, smoothstep(0.15, 7.0, vDepth));
        body = mix(body * 1.55, body, smoothstep(0.05, 0.9, vDepth));

        vec3 col = mix(body, refl, fres);

        // the moon path proper — the scatter around the mirror point
        vec3 H = normalize(uMoonDir - V);
        col += uMoonCol * pow(max(dot(N, H), 0.0), uShine) * uSpecI;

        col += uMoonCol * ringGlow * uRingLight;

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
    uniforms.uDetail.value = w.detail(s);
    uniforms.uShine.value = w.shine(s);
    uniforms.uSpecI.value = w.specular(s);
    uniforms.uHalo.value = w.halo(s);
    uniforms.uStarGain.value = w.starGain(s);
    uniforms.uStarSoft.value = w.starSoft(s);
    uniforms.uFogK.value = w.fog(s);
    // a broken surface cannot hold an edge, so the reflected disc softens with
    // everything else rather than staying a hard dot inside a smear
    uniforms.uMoonSize.value = 0.00026 * (1 + 2.2 * (1 - s));
    uniforms.uBreath.value = state ? clamp(state.breathOpen, 0, 1) - 0.5 : 0;
  }

  return { update, pulse, material };
}
