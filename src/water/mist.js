/**
 * mist.js — the air over the water.
 * @see water/main.js MODULE CONTRACT
 *
 * Scene fog, a handful of low bands lying on the lake, and a thin scatter of
 * motes. Ascent showed where flat cloud sheets stop working, so these are not
 * that: each band is a narrow window in z rather than an infinite plane, they
 * are held off the near water entirely so the reflection under the player's
 * feet is never veiled, and the far ones sit deliberately across the far
 * shoreline, which is the thing they exist to hide.
 *
 * How they answer the settle matters more than how much of them there is.
 * Density falls, but the threshold also *rises* — and raising the threshold on
 * a noise field breaks a sheet into separated patches instead of dimming it
 * uniformly. The mist draws apart rather than switching off, and the far shore
 * comes back through the gaps.
 */

import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*  y     near→ the window in z it lives in →far        scale    drift      dens */
const BANDS = [
  { y: 0.30, z: [-7, -24, -150, -205], s: 0.0090, dx: 0.0028, dz: 0.0008, d: 0.55, t: 0.0 },
  { y: 0.85, z: [-14, -40, -168, -216], s: 0.0062, dx: -0.0019, dz: 0.0011, d: 0.72, t: 0.3 },
  { y: 1.70, z: [-28, -62, -178, -224], s: 0.0041, dx: 0.0013, dz: -0.0007, d: 0.80, t: 0.6 },
  { y: 2.90, z: [-48, -92, -186, -232], s: 0.0027, dx: -0.0009, dz: 0.0005, d: 0.90, t: 0.85 },
  { y: 4.60, z: [-76, -132, -195, -240], s: 0.0018, dx: 0.0006, dz: 0.0004, d: 1.00, t: 1.0 },
];

export function createMist(scene, camera, ctx, deps) {
  const preset = ctx.preset;
  const PALETTE = ctx.mood.palette;
  const curves = ctx.mood.curves;
  const root = new THREE.Group();
  root.name = 'mist';
  scene.add(root);

  const rnd = mulberry32(31337);
  let time = 0;

  /* ── scene fog ──────────────────────────────────────────────────────────── */

  const fog = new THREE.FogExp2(new THREE.Color(PALETTE.fogA).getHex(), 0.007);
  scene.fog = fog;
  scene.background = null;

  /* ── the bands ──────────────────────────────────────────────────────────── */

  const bands = [];
  {
    const n = Math.min(preset.mistBands, BANDS.length);
    // the lowest bands first: on a thin tier they are the ones that matter,
    // because they are the ones lying across the far shoreline
    const rows = n >= BANDS.length ? BANDS
      : n === 4 ? [BANDS[0], BANDS[1], BANDS[2], BANDS[4]]
        : n === 3 ? [BANDS[0], BANDS[2], BANDS[4]]
          : n === 2 ? [BANDS[1], BANDS[3]] : [BANDS[1]];

    const seg = ctx.quality === 'low' ? 20 : 40;
    const geo = new THREE.PlaneGeometry(760, 420, seg, seg);
    geo.rotateX(-Math.PI / 2);

    for (let i = 0; i < rows.length; i++) {
      const B = rows[i];
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uNoise: { value: deps.noise },
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(PALETTE.mist) },
          uDensity: { value: 0.2 },
          uScale: { value: B.s },
          uDrift: { value: new THREE.Vector2(B.dx, B.dz) },
          uSharp: { value: 0.36 },
          uWindow: { value: new THREE.Vector4(B.z[0], B.z[1], B.z[2], B.z[3]) },
          uNear: { value: 5.0 },
          uHalfX: { value: 210.0 },
        },
        vertexShader: /* glsl */`
          varying vec3 vWorld;
          void main(){
            vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
            vWorld = wp;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }
        `,
        fragmentShader: /* glsl */`
          uniform sampler2D uNoise;
          uniform float uTime, uDensity, uScale, uSharp, uNear, uHalfX;
          uniform vec2 uDrift;
          uniform vec4 uWindow;
          uniform vec3 uColor;
          varying vec3 vWorld;

          void main(){
            vec2 p = vWorld.xz * uScale;
            float a1 = texture2D(uNoise, p + uDrift * uTime).r;
            float a2 = texture2D(uNoise, p * 2.31 - uDrift * uTime * 1.6 + 0.37).g;
            float a3 = texture2D(uNoise, p * 0.53 + uDrift * uTime * 0.4 + 0.71).b;
            float n = a1 * 0.50 + a2 * 0.26 + a3 * 0.42;

            // Raising uSharp is what breaks the sheet into patches: the same
            // field, judged more strictly, keeps only its densest places.
            float a = smoothstep(uSharp, uSharp + 0.34, n) * uDensity;

            // the window in z this band lies in, and a lateral fade
            float w = smoothstep(uWindow.x, uWindow.y, vWorld.z)
                    * (1.0 - smoothstep(uWindow.z, uWindow.w, vWorld.z));
            a *= w;
            a *= 1.0 - smoothstep(uHalfX * 0.55, uHalfX, abs(vWorld.x));

            // never in the near field: the water at the player's feet is the
            // one place the reflection has to be readable
            vec3 toFrag = vWorld - cameraPosition;
            float d = length(toFrag);
            a *= smoothstep(uNear, uNear * 3.2, d);

            if (a <= 0.004) discard;

            vec3 col = uColor * (0.78 + 0.46 * smoothstep(0.18, 0.86, n));
            gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        blending: THREE.NormalBlending,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, B.y, -120);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + i;
      root.add(mesh);
      bands.push({ mesh, mat, band: B });
    }
  }

  /* ── motes ──────────────────────────────────────────────────────────────── */

  let motes = null;
  if (preset.motes > 0) {
    const n = preset.motes;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const scale = new Float32Array(n);
    const drift = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      // most of them over the near water, where the moon can catch them
      const overWater = rnd() < 0.62;
      const z = overWater ? -2 - Math.pow(rnd(), 0.7) * 52 : 2 + rnd() * 32;
      const x = (rnd() - 0.5) * (overWater ? 52 : 30);
      // Spread up as well as out. Packed into a metre of air above the water
      // they resolve into a horizontal band, and a band of bright dots at a
      // fixed height reads as fireflies rather than as air.
      const y = (overWater ? 0.15 : deps.groundHeight(x, z) + 0.2) + Math.pow(rnd(), 1.1) * 6.0;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      seed[i] = rnd() * 100;
      // Small, and mostly very small. The few large ones were the whole problem.
      scale[i] = 0.55 + Math.pow(rnd(), 3.2) * 1.9;
      drift[i] = 0.18 + rnd() * 0.7;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: deps.dot },
        uTime: { value: 0 },
        uWind: { value: 0.4 },
        uOpacity: { value: 0.0 },
        uPix: { value: 300 },
      },
      vertexShader: /* glsl */`
        attribute float aSeed; attribute float aScale; attribute float aDrift;
        uniform float uTime, uWind, uPix;
        varying float vTw;
        void main(){
          vec3 p = position;
          float s = aSeed;
          p.x += sin(uTime * 0.17 + s * 6.3) * aDrift * 1.4 + uWind * sin(uTime * 0.08 + s) * 0.7;
          p.y += sin(uTime * 0.13 + s * 3.1) * aDrift * 0.5;
          p.z += cos(uTime * 0.15 + s * 4.7) * aDrift * 1.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aScale * uPix / max(0.5, -mv.z), 0.6, 3.2);
          vTw = 0.28 + 0.72 * (0.5 + 0.5 * sin(uTime * 1.1 + s * 11.0));
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uOpacity;
        varying float vTw;
        void main(){
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(t.rgb, t.a * vTw * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    motes = new THREE.Points(geo, mat);
    motes.frustumCulled = false;
    motes.renderOrder = 20;
    root.add(motes);
  }

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt, state) {
    const s = state ? clamp(state.settle, 0, 1) : 0;
    const wind = state ? clamp(state.windGust, 0, 1.2) : 0.5;
    // the bands slow down with everything else, so their own clock does too
    time += dt * curves.mist.drift(s) * (0.7 + 0.6 * wind);

    fog.density = curves.fog(s);

    const sharp = curves.mist.sharp(s);
    for (const b of bands) {
      b.mat.uniforms.uTime.value = time;
      b.mat.uniforms.uDensity.value = curves.mist.density(s, b.band.t) * b.band.d;
      b.mat.uniforms.uSharp.value = sharp;
    }

    if (motes) {
      motes.material.uniforms.uTime.value = time;
      motes.material.uniforms.uWind.value = curves.wind(s) * wind;
      // more of them read as the air clears, not more of them existing
      motes.material.uniforms.uOpacity.value = curves.motes(s);
    }
  }

  return { update };
}
