/**
 * lighting.js — sky dome, key light, fill, lantern light and the post chain.
 * @see main.js LOCKED MODULE CONTRACT
 *
 * `render()` is the only place the frame is drawn.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Keyframed dawn. Everything about the light is read off this table so the
 * transition can be tuned in one place. The horizon warms (glow / fog-facing
 * colours) well before the disc itself clears the ridgeline.
 */
const KEYS = [
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
];

const _cA = new THREE.Color(), _cB = new THREE.Color();

function sampleKeys(d, out) {
  d = clamp(d, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && d > KEYS[i + 1].d) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((d - a.d) / (b.d - a.d), 0, 1);
  const s = t * t * (3 - 2 * t);
  const L = (k) => a[k] + (b[k] - a[k]) * s;
  const C = (k, target) => target.set(a[k]).lerp(_cB.set(b[k]), s);

  out.az = L('az'); out.el = L('el');
  out.keyI = L('keyI'); out.discI = L('discI'); out.halo = L('halo');
  out.glowI = L('glowI'); out.hemiI = L('hemiI'); out.ambI = L('ambI');
  out.exposure = L('exposure');
  C('key', out.key); C('disc', out.disc); C('zenith', out.zenith);
  C('horizon', out.horizon); C('glow', out.glow); C('ground', out.ground);
  C('hemiSky', out.hemiSky); C('hemiGround', out.hemiGround); C('ambient', out.ambient);
  return out;
}

/* ── the grade / vignette / grain / aberration pass ───────────────────────── */

const GradeShader = {
  name: 'AscentGrade',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uAberration: { value: 0.0006 },
    uGrain: { value: 0.013 },
    uDawn: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uVignette, uAberration, uGrain, uDawn;
    varying vec2 vUv;

    float hash(vec2 p){
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // chromatic aberration: nothing in the centre, a whisper at the corners
      float ca = uAberration * r2 * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + c * ca).b;
      col = max(col, 0.0);

      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // lift the shadows toward indigo, push the highlights toward gold
      col += vec3(0.034, 0.042, 0.078) * (1.0 - smoothstep(0.0, 0.42, l)) * (1.0 - 0.35 * uDawn);
      col = mix(col, col * vec3(1.048, 0.997, 0.922), smoothstep(0.30, 0.92, l) * (0.45 + 0.55 * uDawn));

      // A very gentle S: a stronger one was crushing the shadow detail that the
      // key light is there to reveal.
      col = mix(col, smoothstep(0.0, 1.0, col), 0.13);

      // vignette
      col *= 1.0 - uVignette * pow(clamp(r2 * 2.05, 0.0, 1.0), 1.5);

      // slow film grain, strongest in the shadows
      float g = hash(vUv * uResolution + vec2(uTime * 61.7, uTime * 37.3)) - 0.5;
      col += g * uGrain * (1.0 - 0.55 * l);

      // Static ordered dither, a shade under one 8-bit step. Wide sky gradients
      // band badly without it and grain alone is the wrong tool — it has to be
      // loud enough to hide the step, which is louder than the look wants.
      vec2 ip = floor(vUv * uResolution);
      float d4 = fract(dot(ip, vec2(0.75487766, 0.56984029)));
      col += (d4 - 0.5) * (0.85 / 255.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* ── module ───────────────────────────────────────────────────────────────── */

export function createLighting(scene, camera, renderer, ctx) {
  const preset = ctx.preset;
  let time = 0;

  const K = {
    az: 0, el: 0, keyI: 0, discI: 0, halo: 0, glowI: 0, hemiI: 0, ambI: 0, exposure: 1,
    key: new THREE.Color(), disc: new THREE.Color(), zenith: new THREE.Color(),
    horizon: new THREE.Color(), glow: new THREE.Color(), ground: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), ambient: new THREE.Color(),
  };
  sampleKeys(0, K);

  /* ── sky dome ───────────────────────────────────────────────────────────── */

  const skyUniforms = {
    uZenith: { value: new THREE.Color().copy(K.zenith) },
    uHorizon: { value: new THREE.Color().copy(K.horizon) },
    uGlow: { value: new THREE.Color().copy(K.glow) },
    uGround: { value: new THREE.Color().copy(K.ground) },
    uSunDir: { value: new THREE.Vector3(0, 0.5, -1).normalize() },
    uSunColor: { value: new THREE.Color().copy(K.disc) },
    uGlowI: { value: K.glowI },
    uDiscI: { value: K.discI },
    uHalo: { value: K.halo },
    uNight: { value: 1 },
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith, uHorizon, uGlow, uGround, uSunColor;
      uniform vec3 uSunDir;
      uniform float uGlowI, uDiscI, uHalo, uNight;
      varying vec3 vDir;

      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float up = clamp(h, 0.0, 1.0);

        vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));

        // the warm band hugs the horizon tightly and concentrates around the sun's azimuth
        vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
        float az = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), sunFlat));
        float band = exp(-max(h, 0.0) * 15.0) * smoothstep(-0.05, 0.015, h);
        col += uGlow * band * (0.20 + 0.80 * pow(az, 2.0)) * uGlowI;

        // disc + a tight halo
        float sd = max(0.0, dot(d, normalize(uSunDir)));
        col += uSunColor * pow(sd, 1600.0) * uDiscI * 6.0;
        col += uSunColor * pow(sd, 80.0) * uHalo * 0.80;
        col += uSunColor * pow(sd, 13.0) * uHalo * 0.13;

        // a faint dusting of stars while it is still night
        float night = uNight;
        if (night > 0.02) {
          vec3 sp = floor(d * 260.0);
          float rnd = fract(sin(dot(sp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float star = smoothstep(0.9975, 1.0, rnd) * smoothstep(-0.02, 0.35, h);
          col += vec3(0.55, 0.62, 0.85) * star * night * 1.4;
        }

        col = mix(col, uGround, 1.0 - smoothstep(-0.055, 0.005, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 40, 26), skyMat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);

  /* ── key light ──────────────────────────────────────────────────────────── */

  const keyLight = new THREE.DirectionalLight(K.key.getHex(), K.keyI);
  keyLight.castShadow = preset.shadows;
  if (preset.shadows) {
    const c = keyLight.shadow.camera;
    c.left = -44; c.right = 44; c.top = 44; c.bottom = -44;
    c.near = 1; c.far = 240;
    keyLight.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.035;
    keyLight.shadow.radius = 1.4;
  }
  keyLight.target.position.set(0, 2, -27);
  scene.add(keyLight);
  scene.add(keyLight.target);

  const hemi = new THREE.HemisphereLight(K.hemiSky.getHex(), K.hemiGround.getHex(), K.hemiI);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(K.ambient.getHex(), K.ambI);
  scene.add(ambient);

  // a faint cold bounce from the valley so shadowed forms keep some shape
  const bounce = new THREE.DirectionalLight(0x5b6da0, 0.16);
  bounce.position.set(-0.6, -0.25, 1);
  scene.add(bounce);

  /* ── lantern light ──────────────────────────────────────────────────────── */

  const lanternLight = new THREE.PointLight(0xffb066, 0, 20, 2);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 96;
  {
    const g = glowCanvas.getContext('2d');
    const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    grad.addColorStop(0.0, 'rgba(255,226,180,1)');
    grad.addColorStop(0.22, 'rgba(255,180,110,0.55)');
    grad.addColorStop(0.6, 'rgba(220,140,80,0.12)');
    grad.addColorStop(1.0, 'rgba(200,120,70,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
  }
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc98a, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
  });
  const glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.setScalar(0.9);
  lanternLight.add(glowSprite);

  let lanternTarget = 0, lanternLevel = 0;
  function setLanternIntensity(v01) { lanternTarget = clamp(v01 || 0, 0, 1); }

  /* ── post processing ────────────────────────────────────────────────────── */

  const size = new THREE.Vector2();
  renderer.getSize(size);

  const samples = ctx.quality === 'high' ? 4 : ctx.quality === 'medium' ? 2 : 0;
  const rt = new THREE.WebGLRenderTarget(
    Math.max(2, size.x * renderer.getPixelRatio()),
    Math.max(2, size.y * renderer.getPixelRatio()),
    { type: THREE.HalfFloatType, samples },
  );
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));

  let bloomPass = null;
  if (preset.bloom) {
    // Restrained: only genuine light sources (flame, orb core, the sun's disc)
    // should ever cross the threshold. A wide, strong bloom was hazing the whole
    // frame and turning the orb into a white hole at close range.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.30, 0.55, 0.92);
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());

  const gradePass = new ShaderPass(GradeShader);
  gradePass.material.toneMapped = false;
  if (!preset.bloom) {
    gradePass.uniforms.uGrain.value = 0.011;
    gradePass.uniforms.uAberration.value = 0.0;
  }
  composer.addPass(gradePass);

  const RENDER_SCALE = ctx.quality === 'low' ? 0.85 : 1.0;

  function resize(w, h, dpr) {
    const s = (dpr || renderer.getPixelRatio()) * RENDER_SCALE;
    composer.setPixelRatio(s);
    composer.setSize(w, h);
    if (bloomPass) bloomPass.setSize(w * s, h * s);
    gradePass.uniforms.uResolution.value.set(w * s, h * s);
  }
  resize(size.x, size.y, renderer.getPixelRatio());

  function render() { composer.render(); }

  /* ── per-frame ──────────────────────────────────────────────────────────── */

  const _dir = new THREE.Vector3();

  function update(dt, state) {
    time += dt;
    const dawn = state ? clamp(state.dawn, 0, 1) : 0;
    sampleKeys(dawn, K);

    // celestial direction — az measured from -Z, swinging around to the valley
    const azR = K.az * DEG, elR = K.el * DEG;
    const ce = Math.cos(elR);
    _dir.set(Math.sin(azR) * ce, Math.sin(elR), -Math.cos(azR) * ce).normalize();
    skyUniforms.uSunDir.value.copy(_dir);

    skyUniforms.uZenith.value.copy(K.zenith);
    skyUniforms.uHorizon.value.copy(K.horizon);
    skyUniforms.uGlow.value.copy(K.glow);
    skyUniforms.uGround.value.copy(K.ground);
    skyUniforms.uSunColor.value.copy(K.disc);
    skyUniforms.uGlowI.value = K.glowI;
    skyUniforms.uDiscI.value = K.discI;
    skyUniforms.uHalo.value = K.halo;
    skyUniforms.uNight.value = 1.0 - smoothstep(0.02, 0.30, dawn);
    sky.position.copy(camera.position);

    // the shadow-casting direction never dips below the ground plane
    const elLight = Math.max(K.el, 3.0) * DEG;
    const cl = Math.cos(elLight);
    keyLight.position.set(
      Math.sin(azR) * cl * 70,
      Math.sin(elLight) * 70 + 2,
      -Math.cos(azR) * cl * 70 - 27,
    );
    keyLight.color.copy(K.key);
    keyLight.intensity = K.keyI;

    hemi.color.copy(K.hemiSky);
    hemi.groundColor.copy(K.hemiGround);
    hemi.intensity = K.hemiI;
    ambient.color.copy(K.ambient);
    ambient.intensity = K.ambI;
    // With the fill pulled down, this is what keeps the shadow side shaped
    // indigo instead of a dead silhouette.
    bounce.intensity = 0.22 + 0.18 * dawn;

    // lantern: eased level plus a low-frequency, non-strobing flicker
    lanternLevel += clamp(lanternTarget - lanternLevel, -dt * 1.2, dt * 0.7);
    const flick = 1
      + 0.048 * Math.sin(time * 2.31)
      + 0.026 * Math.sin(time * 5.07 + 1.9)
      + 0.014 * Math.sin(time * 9.73 + 0.4);
    lanternLight.intensity = lanternLevel * 42.0 * flick;
    glowMat.opacity = lanternLevel * 0.55 * flick;
    glowSprite.scale.setScalar(0.78 + 0.22 * lanternLevel * flick);

    gradePass.uniforms.uTime.value = time;
    gradePass.uniforms.uDawn.value = dawn;
    gradePass.uniforms.uVignette.value = 0.34 - 0.08 * dawn;

    renderer.toneMappingExposure = K.exposure;
    if (bloomPass) {
      bloomPass.strength = 0.30 + 0.09 * smoothstep(0.55, 1.0, dawn);
      bloomPass.threshold = 0.92 - 0.07 * dawn;
    }
  }

  return { update, render, resize, setLanternIntensity, lanternLight };
}
