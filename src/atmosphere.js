/**
 * atmosphere.js — fog, ground mist, the valley cloud sea, motes and god rays.
 * @see main.js LOCKED MODULE CONTRACT
 *
 * Everything is driven by an internal clock advanced in update(); nothing here
 * reads another module. The ground curve below is a deliberately coarse echo of
 * the terrain's path profile — mist only needs to hug the walk, not match it.
 */

import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* the same S-curve and climb the terrain uses, in both JS and GLSL */

function pathCx(z) {
  const u = clamp((2.0 - z) / 55.0, -0.35, 1.5);
  return 2.25 * Math.sin(u * 4.15) * (1 - 0.22 * Math.max(0, u));
}

function groundCurve(x, z) {
  const u = clamp((2.0 - z) / 55.0, 0, 1);
  const s = u * u * (3 - 2 * u);
  const a = (z + 34.0) / 7.2, b = (z + 45.0) / 5.2;
  let y = 3.9 * s + 1.55 * Math.exp(-a * a) - 0.42 * Math.exp(-b * b);
  y += smoothstep(3.0, 17.0, Math.abs(x - pathCx(z))) * 2.4;
  y -= smoothstep(-54.5, -66.0, z) * 70.0;
  return y;
}

const GLSL_GROUND = /* glsl */`
  float aPathCx(float z){
    float u = clamp((2.0 - z) / 55.0, -0.35, 1.5);
    return 2.25 * sin(u * 4.15) * (1.0 - 0.22 * max(0.0, u));
  }
  float aGround(float x, float z){
    float u = clamp((2.0 - z) / 55.0, 0.0, 1.0);
    float s = u * u * (3.0 - 2.0 * u);
    float a = (z + 34.0) / 7.2;
    float b = (z + 45.0) / 5.2;
    float y = 3.9 * s + 1.55 * exp(-a * a) - 0.42 * exp(-b * b);
    y += smoothstep(3.0, 17.0, abs(x - aPathCx(z))) * 2.4;
    y -= (1.0 - smoothstep(-66.0, -54.5, z)) * 70.0;
    return y;
  }
`;

/* ── one shared tiling noise texture for every drifting layer ─────────────── */

function noiseTexture(size, seed) {
  // periodic value-noise fBm: each octave wraps on its own integer lattice so the
  // texture tiles seamlessly no matter how far it is scrolled or scaled
  const h2 = (x, y, s) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177);
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, y, period, s) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - fx * 2), sy = fy * fy * (3 - fy * 2);
    const m = (v) => ((v % period) + period) % period;
    const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
    const a = h2(x0, y0, s), b = h2(x1, y0, s), c = h2(x0, y1, s), d = h2(x1, y1, s);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  };
  const fbmT = (u, v, oct, f0, s) => {
    let val = 0, amp = 0.5, f = f0;
    for (let o = 0; o < oct; o++) {
      val += amp * vnoise(u * f, v * f, f, s + o * 977);
      amp *= 0.5; f *= 2;
    }
    return val;
  };

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = fbmT(u, v, 5, 3, seed);
      const b = fbmT(u, v, 4, 2, seed + 4111);
      const i = (y * size + x) * 4;
      data[i] = clamp(a * 265, 0, 255);
      data[i + 1] = clamp(b * 265, 0, 255);
      data[i + 2] = clamp((a * 0.55 + b * 0.45) * 265, 0, 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,246,228,0.55)');
  grad.addColorStop(0.65, 'rgba(220,215,230,0.10)');
  grad.addColorStop(1.0, 'rgba(200,205,230,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(32, 128);
  for (let y = 0; y < 128; y++) {
    const ty = y / 127;
    const along = Math.sin(ty * Math.PI) ** 1.4;
    for (let x = 0; x < 32; x++) {
      const tx = Math.abs(x / 31 - 0.5) * 2;
      const across = Math.pow(1 - tx, 2.2);
      const a = across * along;
      const i = (y * 32 + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 226; img.data[i + 2] = 186;
      img.data[i + 3] = clamp(a * 255, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── module ───────────────────────────────────────────────────────────────── */

export function createAtmosphere(scene, camera, ctx) {
  const preset = ctx.preset;
  const simple = preset.fog === 'simple';
  const root = new THREE.Group();
  root.name = 'atmosphere';
  scene.add(root);

  let time = 0;
  const rnd = mulberry32(4711);

  const texNoise = noiseTexture(256, 991);
  const texDot = softDotTexture();

  /* ── scene fog ──────────────────────────────────────────────────────────── */

  const fogNight = new THREE.Color(0x11172b);
  const fogDawn = new THREE.Color(0x8b8098);
  const fog = new THREE.FogExp2(fogNight.getHex(), 0.0072);
  scene.fog = fog;
  scene.background = null;

  /* ── mist / cloud shader ────────────────────────────────────────────────── */

  function layerMaterial(opts) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: texNoise },
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uHeight: { value: opts.height },
        uColor: { value: new THREE.Color(opts.color) },
        uDensity: { value: opts.density },
        uScale: { value: opts.scale },
        uDrift: { value: new THREE.Vector2(opts.driftX, opts.driftZ) },
        uFade: { value: opts.fade },
        uNear: { value: opts.near },
        uSharp: { value: opts.sharp },
        uFollow: { value: opts.follow ? 1 : 0 },
        uClip: { value: new THREE.Vector2(opts.clipA, opts.clipB) },
        uClipInv: { value: opts.clipInv ? 1 : 0 },
        uWarm: { value: 0 },
        uWarmColor: { value: new THREE.Color(0xffbe86) },
        uSunDir: { value: new THREE.Vector3(0.3, 0.1, -1).normalize() },
        uWarp: { value: opts.warp || 0 },
        uWarpPhase: { value: opts.warpPhase || 0 },
        uWarpScale: { value: opts.warpScale || 0.00085 },
        uSoft: { value: opts.soft === undefined ? 0.46 : opts.soft },
        uBreakup: { value: opts.breakup || 0 },
        uHorizon: { value: opts.horizon || 0 },
      },
      vertexShader: GLSL_GROUND + /* glsl */`
        uniform sampler2D uNoise;
        uniform vec3 uOrigin;
        uniform float uHeight;
        uniform float uFollow;
        uniform float uWarp;
        uniform float uWarpPhase;
        uniform float uWarpScale;
        uniform float uTime;
        uniform vec2 uDrift;
        varying vec3 vWorld;
        varying float vLift;
        void main(){
          vec3 wp = position + uOrigin;
          if (uFollow > 0.5) wp.y = aGround(wp.x, wp.z) + uHeight;
          else wp.y = uOrigin.y + uHeight;
          vLift = 0.0;
          // Billowing: without it a cloud layer is a razor-flat sheet whose
          // silhouette gives the plane away at grazing angles. Two octaves an
          // octave-and-a-half apart give a broad swell carrying smaller heads,
          // which is the difference between cloud and a rippled mirror.
          if (uWarp > 0.0) {
            vec2 q = wp.xz * uWarpScale + uWarpPhase + uDrift * uTime * 0.5;
            float w = texture2D(uNoise, q).r * 0.62
                    + texture2D(uNoise, q * 2.77 + 0.44).g * 0.26
                    + texture2D(uNoise, q * 6.13 + 0.81).b * 0.12;
            vLift = (w - 0.5) * 2.0;
            wp.y += vLift * uWarp * 0.5;
          }
          vWorld = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uNoise;
        uniform float uTime, uDensity, uScale, uFade, uNear, uSharp, uWarm, uClipInv;
        uniform float uSoft, uBreakup, uHorizon;
        uniform vec2 uDrift, uClip;
        uniform vec3 uColor, uWarmColor, uSunDir, uOrigin;
        varying vec3 vWorld;
        varying float vLift;

        void main(){
          vec2 p = vWorld.xz * uScale;
          float a1 = texture2D(uNoise, p + uDrift * uTime).r;
          float a2 = texture2D(uNoise, p * 2.13 - uDrift * uTime * 1.7 + 0.37).g;
          float a3 = texture2D(uNoise, p * 0.47 + uDrift * uTime * 0.4 + 0.71).b;
          float n = a1 * 0.5 + a2 * 0.28 + a3 * 0.42;

          // The vertical swell also thins the sheet: the flanks of a billow are
          // where you should be able to see through it.
          n += vLift * uBreakup;

          float a = smoothstep(uSharp, uSharp + uSoft, n) * uDensity;
          float rad = length(vWorld.xz - uOrigin.xz);
          a *= 1.0 - smoothstep(uFade * 0.28, uFade, rad);
          float cl = smoothstep(uClip.x, uClip.y, vWorld.z);
          a *= mix(cl, 1.0 - cl, uClipInv);

          vec3 toFrag = vWorld - cameraPosition;
          float dCam = length(toFrag);
          a *= smoothstep(uNear, uNear * 3.4, dCam);

          // Nothing should end at a hard line where the plane grazes eye level.
          // Fading with the elevation angle lets the sea dissolve into the ridge
          // haze instead of stopping against it.
          if (uHorizon > 0.0) {
            float elev = abs(toFrag.y) / max(1.0, dCam);
            a *= mix(1.0, smoothstep(0.0, uHorizon, elev), 0.72);
          }
          if (a <= 0.004) discard;

          // Local brightness variation: a billow lit from one side is not one
          // flat value, and the tops catch the low sun first.
          vec3 col = uColor * (0.80 + 0.44 * smoothstep(0.15, 0.85, n) + 0.18 * vLift);
          float lift = smoothstep(0.30, 0.92, n + vLift * 0.35) * uWarm;
          col = mix(col, uWarmColor, lift * 0.75);

          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      blending: THREE.NormalBlending,
    });
  }

  /* ── ground mist ────────────────────────────────────────────────────────── */

  const mistLayers = [];
  {
    // Six is already past the point where another near-fullscreen transparent
    // sheet reads; capping it here buys back fill on the high preset.
    const n = Math.min(preset.mistLayers, 6);
    const geo = new THREE.PlaneGeometry(120, 120, simple ? 24 : 44, simple ? 24 : 44);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const mat = layerMaterial({
        height: 0.12 + t * 1.35,
        color: 0x8fa4c8,
        density: 0.10 - t * 0.045,
        scale: 0.0135 + t * 0.007,
        driftX: 0.0035 + t * 0.0016,
        driftZ: 0.0011 + t * 0.0007,
        fade: 50,
        near: 3.4 + t * 1.6,
        sharp: 0.40 + t * 0.08,
        follow: true,
        clipA: -58, clipB: -49,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + i;
      root.add(mesh);
      mistLayers.push({ mesh, mat, t });
    }
  }

  /* ── valley cloud sea ───────────────────────────────────────────────────── */

  /**
   * The cloud sea is five sheets that share nothing. Six near-identical sheets
   * at near-identical scales stacked up into a rippled mirror; here the feature
   * size spans a factor of eleven, the vertical swell a factor of nine, and
   * every sheet drifts at its own speed in its own direction, so the silhouette
   * never resolves into a plane. One sheet fewer than before, and each one now
   * fades out toward the horizon, which pays for the extra work in fill.
   */
  const cloudLayers = [];
  {
    const DEEP = [
      // y      dens  scale    warp  wScale   sharp soft  drift          brk
      { y: -9,  d: 0.44, s: 0.0165, w: 18,  ws: 0.0021,  sh: 0.50, so: 0.62, dx: 0.00090, dz: 0.00026, b: 0.20 },
      { y: -15, d: 0.50, s: 0.0092, w: 34,  ws: 0.0014,  sh: 0.45, so: 0.52, dx: -0.00062, dz: 0.00040, b: 0.24 },
      { y: -25, d: 0.58, s: 0.0044, w: 56,  ws: 0.00082, sh: 0.41, so: 0.42, dx: 0.00042, dz: -0.00022, b: 0.28 },
      { y: -42, d: 0.66, s: 0.0022, w: 80,  ws: 0.00046, sh: 0.37, so: 0.34, dx: -0.00026, dz: -0.00014, b: 0.32 },
      { y: -70, d: 0.74, s: 0.0015, w: 108, ws: 0.00028, sh: 0.33, so: 0.30, dx: 0.00016, dz: 0.00009, b: 0.36 },
    ];
    const SIMPLE = [DEEP[0], DEEP[2], DEEP[4]];
    const rows = simple ? SIMPLE : DEEP;
    const seg = simple ? 24 : 56;
    const geo = new THREE.PlaneGeometry(1800, 1800, seg, seg);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < rows.length; i++) {
      const L = rows[i];
      const t = i / (rows.length - 1);
      const mat = layerMaterial({
        height: 0,
        color: 0x7787ad,
        density: L.d,
        scale: L.s,
        driftX: L.dx, driftZ: L.dz,
        fade: 900,
        near: 8,
        sharp: L.sh,
        soft: L.so,
        breakup: L.b,
        horizon: 0.030 + t * 0.026,
        follow: false,
        clipA: -78, clipB: -50, clipInv: true,
        warp: L.w,
        warpScale: L.ws,
        warpPhase: i * 0.71 + 0.13,
      });
      mat.userData.shade = 1 - t * 0.52;
      mat.userData.dens = L.d;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, L.y, -300);
      mat.uniforms.uOrigin.value.set(0, L.y, -300);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4 + i;
      root.add(mesh);
      cloudLayers.push({ mesh, mat, t, shade: mat.userData.shade, dens: L.d, speed: 0.55 + i * 0.42 });
    }
  }

  /* ── motes ──────────────────────────────────────────────────────────────── */

  let motes = null;
  {
    const n = preset.particles;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const scale = new Float32Array(n);
    const drift = new Float32Array(n);
    const col = new Float32Array(n * 3);

    const LANT = new THREE.Vector3(1.7, 1.15, -6.5);
    const ORB = new THREE.Vector3(-1.1, 1.45, -26.0);
    const cWarm = new THREE.Color(0xffcb92);
    const cCool = new THREE.Color(0xb8c8ee);
    const tmp = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const r = rnd();
      let x, y, z, warm;
      if (r < 0.15) {
        x = LANT.x + (rnd() - 0.5) * 9.0; z = LANT.z + (rnd() - 0.5) * 9.5;
        y = groundCurve(x, z) + 0.2 + rnd() * 2.6; warm = 0.85;
      } else if (r < 0.30) {
        x = ORB.x + (rnd() - 0.5) * 10.0; z = ORB.z + (rnd() - 0.5) * 11.0;
        y = groundCurve(x, z) + 0.2 + rnd() * 3.0; warm = 0.55;
      } else {
        z = 3 - rnd() * 58;
        x = pathCx(z) + (rnd() - 0.5) * 30;
        y = groundCurve(x, z) + 0.1 + Math.pow(rnd(), 1.6) * 5.5;
        warm = 0.12 + rnd() * 0.3;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      seed[i] = rnd() * 100;
      scale[i] = 1.1 + Math.pow(rnd(), 2.4) * 4.6;
      drift[i] = 0.25 + rnd() * 0.9;
      tmp.copy(cCool).lerp(cWarm, warm * (0.5 + rnd() * 0.5));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texDot },
        uTime: { value: 0 },
        uWind: { value: 0.5 },
        uOpacity: { value: 0.0 },
        uPix: { value: 300 },
      },
      vertexShader: /* glsl */`
        attribute float aSeed; attribute float aScale; attribute float aDrift;
        uniform float uTime, uWind, uPix;
        varying vec3 vCol; varying float vTw;
        void main(){
          vec3 p = position;
          float s = aSeed;
          p.x += sin(uTime * 0.21 + s * 6.3) * aDrift * 1.6 + uWind * sin(uTime * 0.09 + s) * 0.8;
          p.y += sin(uTime * 0.17 + s * 3.1) * aDrift * 0.7;
          p.z += cos(uTime * 0.19 + s * 4.7) * aDrift * 1.4 + uWind * cos(uTime * 0.07 + s * 2.0) * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aScale * uPix / max(0.5, -mv.z), 0.8, 7.0);
          vCol = color;
          vTw = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.35 + s * 11.0));
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uOpacity;
        varying vec3 vCol; varying float vTw;
        void main(){
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vCol * t.rgb, t.a * vTw * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    motes = new THREE.Points(geo, mat);
    motes.frustumCulled = false;
    motes.renderOrder = 20;
    root.add(motes);
  }

  /* ── god rays ───────────────────────────────────────────────────────────── */

  const rays = [];
  if (!simple) {
    const texShaft = shaftTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: texShaft, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0, side: THREE.DoubleSide, fog: false,
      color: 0xffd6ab, toneMapped: true,
    });
    const spots = [
      [-4.5, -13], [5.2, -20], [-6.0, -29], [3.4, -36], [-2.5, -44], [6.5, -8],
    ];
    for (const [x, z] of spots) {
      const group = new THREE.Group();
      group.position.set(x, groundCurve(x, z) + 3.6, z);
      const w = 5 + rnd() * 6;
      const len = 34 + rnd() * 22;
      const geo = new THREE.PlaneGeometry(w, len);
      const quad = new THREE.Mesh(geo, mat);
      quad.renderOrder = 15;
      group.add(quad);
      group.frustumCulled = false;
      root.add(group);
      rays.push({ group, quad });
    }
  }

  /* ── per-frame ──────────────────────────────────────────────────────────── */

  const _up = new THREE.Vector3(0, 1, 0);
  const _sun = new THREE.Vector3();
  const _localCam = new THREE.Vector3();
  const MIST_NIGHT = new THREE.Color(0x6d80ad);
  const MIST_DAWN = new THREE.Color(0xd8c9c6);
  const CLOUD_NIGHT = new THREE.Color(0x36415f);
  const CLOUD_DAWN = new THREE.Color(0xa2949e);

  function update(dt, state) {
    time += dt;
    const dawn = state ? clamp(state.dawn, 0, 1) : 0;
    const mist = state ? clamp(state.mist, 0, 1.2) : 1;
    const wind = state ? clamp(state.windGust, 0, 1.2) : 0.5;

    /* fog */
    fog.color.copy(fogNight).lerp(fogDawn, dawn * 0.85);
    fog.density = (0.0030 + 0.0044 * mist) * (1 - 0.28 * dawn);

    /* ground mist follows the camera so its edges are never visible */
    const cx = camera.position.x, cz = camera.position.z;
    for (const L of mistLayers) {
      L.mat.uniforms.uTime.value = time * (0.6 + 0.4 * wind);
      L.mat.uniforms.uOrigin.value.set(cx, 0, cz);
      L.mat.uniforms.uDensity.value = (0.105 - L.t * 0.045) * (0.22 + 0.9 * mist);
      L.mat.uniforms.uColor.value.copy(MIST_NIGHT).lerp(MIST_DAWN, dawn * 0.8);
      L.mat.uniforms.uWarm.value = dawn * 0.55;
    }

    /* valley clouds — each sheet keeps its own clock, so the sea churns */
    for (const L of cloudLayers) {
      L.mat.uniforms.uTime.value = time * L.speed;
      L.mat.uniforms.uDensity.value = L.dens * (0.62 + 0.38 * mist);
      L.mat.uniforms.uColor.value.copy(CLOUD_NIGHT).lerp(CLOUD_DAWN, dawn).multiplyScalar(L.shade);
      L.mat.uniforms.uWarm.value = dawn * Math.max(0, 1 - L.t * 1.3);
    }

    /* motes */
    if (motes) {
      motes.material.uniforms.uTime.value = time;
      motes.material.uniforms.uWind.value = wind;
      motes.material.uniforms.uOpacity.value = 0.105 * (0.45 + 0.55 * mist) * (1 - 0.5 * dawn);
    }

    /* god rays billboard around the sun axis */
    if (rays.length) {
      // must track lighting.js KEYS az/el, which the two modules cannot share
      const az = (236 - 215 * smoothstep(0, 1, dawn)) * Math.PI / 180;
      const el = (21 - 14.4 * smoothstep(0, 1, dawn)) * Math.PI / 180;
      const ce = Math.cos(el);
      _sun.set(Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce).normalize();
      const opacity = 0.062 * smoothstep(0.42, 0.95, dawn) * (0.5 + 0.5 * mist);
      for (const r of rays) {
        r.group.quaternion.setFromUnitVectors(_up, _sun);
        _localCam.copy(camera.position);
        r.group.worldToLocal(_localCam);
        r.quad.rotation.y = Math.atan2(_localCam.x, _localCam.z);
        r.quad.material.opacity = opacity;
      }
    }
  }

  return { update };
}
