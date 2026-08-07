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

/**
 * Everything about the light is read off the active mode's keyframe table in
 * timeofday.js, so a time of day can be tuned in one place — and so the two
 * experiences differ by a table rather than by a branch in here.
 */

const _cB = new THREE.Color();

function sampleKeys(KEYS, d, out) {
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
    uShadowTint: { value: new THREE.Color(0.034, 0.042, 0.078) },
    uShadowFade: { value: 1.0 },
    uHighTint: { value: new THREE.Color(1.048, 0.997, 0.922) },
    uHighMix: { value: 0.45 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uVignette, uAberration, uGrain;
    uniform vec3 uShadowTint, uHighTint;
    uniform float uShadowFade, uHighMix;
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

      // lift the shadows toward the mode's cold end, push the highlights toward
      // its warm one — indigo/gold at dawn, violet-blue/peach at dusk
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.42, l)) * uShadowFade;
      col = mix(col, col * uHighTint, smoothstep(0.30, 0.92, l) * uHighMix);

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
  const tod = ctx.tod;
  const KEYS = tod.keys;
  let time = 0;

  const K = {
    az: 0, el: 0, keyI: 0, discI: 0, halo: 0, glowI: 0, hemiI: 0, ambI: 0, exposure: 1,
    key: new THREE.Color(), disc: new THREE.Color(), zenith: new THREE.Color(),
    horizon: new THREE.Color(), glow: new THREE.Color(), ground: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), ambient: new THREE.Color(),
  };
  sampleKeys(KEYS, 0, K);

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
  const bounce = new THREE.DirectionalLight(tod.bounce.color, 0.16);
  bounce.position.set(-0.6, -0.25, 1);
  scene.add(bounce);

  /* ── lantern light ──────────────────────────────────────────────────────── */

  const lanternLight = new THREE.PointLight(tod.lantern.color, 0, 20, 2);

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
    // -0.5..0.5 around the middle of a breath; zero whenever nobody is breathing
    const breath = state ? clamp(state.breathOpen, 0, 1) - 0.5 : 0;
    sampleKeys(KEYS, dawn, K);

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
    skyUniforms.uNight.value = tod.sky.night(dawn);
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
    // instead of a dead silhouette.
    bounce.intensity = tod.bounce.i(dawn);

    // lantern: eased level plus a low-frequency, non-strobing flicker. How far
    // that light carries is the mode's call — a lantern in daylight is an
    // object, a lantern at sunset is the light source.
    lanternLevel += clamp(lanternTarget - lanternLevel, -dt * 1.2, dt * 0.7);
    const flick = 1
      + 0.048 * Math.sin(time * 2.31)
      + 0.026 * Math.sin(time * 5.07 + 1.9)
      + 0.014 * Math.sin(time * 9.73 + 0.4);
    lanternLight.intensity = lanternLevel * tod.lantern.key(dawn) * flick;
    glowMat.opacity = lanternLevel * tod.lantern.glow(dawn) * flick;
    glowSprite.scale.setScalar(0.78 + 0.22 * lanternLevel * flick);

    const g = tod.grade;
    gradePass.uniforms.uTime.value = time;
    gradePass.uniforms.uVignette.value = g.vignette(dawn);
    gradePass.uniforms.uShadowTint.value.setRGB(g.shadowTint[0], g.shadowTint[1], g.shadowTint[2]);
    gradePass.uniforms.uShadowFade.value = g.shadowFade(dawn);
    gradePass.uniforms.uHighTint.value.setRGB(g.highTint[0], g.highTint[1], g.highTint[2]);
    gradePass.uniforms.uHighMix.value = g.highMix(dawn);

    // The breath's only claim on the light: a fraction of a stop, opening on
    // the inhale. At DAWN's amplitude of zero this is the bare exposure.
    renderer.toneMappingExposure = K.exposure * (1 + tod.breath.exposure * breath);
    if (bloomPass) {
      bloomPass.strength = g.bloom(dawn);
      bloomPass.threshold = g.bloomThreshold(dawn);
    }
  }

  return { update, render, resize, setLanternIntensity, lanternLight };
}
