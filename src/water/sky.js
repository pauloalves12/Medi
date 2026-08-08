/**
 * sky.js — the night above the lake, the light it casts, and the post chain.
 * @see water/main.js MODULE CONTRACT
 *
 * `render()` is the only place the frame is drawn.
 *
 * The dome is one shader-material sphere painted by mood.js's `swSky`. Its
 * arguments are fixed here: the sky does not care how still anyone is being.
 * The lake calls the same function with different arguments, which is the whole
 * of the reflection technique — see the note at the top of mood.js.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PALETTE, GLSL_NIGHT, moonDirection, curves } from './mood.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ── grade ───────────────────────────────────────────────────────────────────
 * Ascent's grade, retuned for a scene with one light source in it. The lift is
 * a cold one, the vignette is stronger because the frame is a composition
 * rather than a walk, and the ordered dither matters more than it did there:
 * a night sky spanning four values of blue bands catastrophically without it.
 * ────────────────────────────────────────────────────────────────────────── */

const GradeShader = {
  name: 'StillWaterGrade',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uAberration: { value: 0.0005 },
    uGrain: { value: 0.012 },
    uShadowTint: { value: new THREE.Color(0.020, 0.028, 0.052) },
    uHighTint: { value: new THREE.Color(0.985, 1.0, 1.045) },
    uHighMix: { value: 0.34 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uVignette, uAberration, uGrain, uHighMix;
    uniform vec3 uShadowTint, uHighTint;
    varying vec2 vUv;

    float hash(vec2 p){
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      float ca = uAberration * r2 * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + c * ca).b;
      col = max(col, 0.0);

      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.34, l));
      col = mix(col, col * uHighTint, smoothstep(0.24, 0.86, l) * uHighMix);
      col = mix(col, smoothstep(0.0, 1.0, col), 0.10);

      col *= 1.0 - uVignette * pow(clamp(r2 * 2.05, 0.0, 1.0), 1.45);

      float g = hash(vUv * uResolution + vec2(uTime * 61.7, uTime * 37.3)) - 0.5;
      col += g * uGrain * (1.0 - 0.5 * l);

      // static ordered dither, a shade under one 8-bit step
      vec2 ip = floor(vUv * uResolution);
      float d4 = fract(dot(ip, vec2(0.75487766, 0.56984029)));
      col += (d4 - 0.5) * (1.0 / 255.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* ── module ───────────────────────────────────────────────────────────────── */

export function createSky(scene, camera, renderer, ctx) {
  const preset = ctx.preset;
  let time = 0;

  const md = moonDirection();
  const moonDir = new THREE.Vector3(md[0], md[1], md[2]).normalize();

  /* ── dome ───────────────────────────────────────────────────────────────── */

  const uniforms = {
    uZenith: { value: new THREE.Color(PALETTE.zenith) },
    uHorizon: { value: new THREE.Color(PALETTE.horizon) },
    uGlow: { value: new THREE.Color(PALETTE.glow) },
    uGround: { value: new THREE.Color(PALETTE.ground) },
    uMoonDir: { value: moonDir.clone() },
    uMoonCol: { value: new THREE.Color(PALETTE.moon) },
    uGlowI: { value: 1.0 },
    uMoonSize: { value: 0.000105 },
    uDiscI: { value: 2.4 },
    uHalo: { value: 380.0 },
    uStarGain: { value: 1.0 },
    uTime: { value: 0 },
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms,
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
    fragmentShader: GLSL_NIGHT + /* glsl */`
      uniform vec3 uZenith, uHorizon, uGlow, uGround, uMoonDir, uMoonCol;
      uniform float uGlowI, uMoonSize, uDiscI, uHalo, uStarGain, uTime;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = swSky(d, uZenith, uHorizon, uGlow, uMoonDir, uMoonCol,
                         uGlowI, uMoonSize, uDiscI, uHalo, uStarGain, 0.0, uTime);
        // below the waterline the dome is simply dark; the lake covers it
        col = mix(col, uGround, 1.0 - smoothstep(-0.06, 0.004, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 44, 28), skyMat);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  /* ── light ───────────────────────────────────────────────────────────────
   * One key from the moon, one very cold hemisphere so nothing is pure black,
   * and a faint bounce off the water. A moon is about a hundred-thousandth of
   * the sun; what makes a night scene read is contrast and silhouette, not
   * how many lights are in it.
   * ────────────────────────────────────────────────────────────────────── */

  const key = new THREE.DirectionalLight(0xc8d8f0, 1.35);
  key.position.copy(moonDir).multiplyScalar(90);
  key.target.position.set(0, 0, -18);
  key.castShadow = !!preset.shadows;
  if (preset.shadows) {
    const c = key.shadow.camera;
    c.left = -30; c.right = 30; c.top = 30; c.bottom = -30;
    c.near = 20; c.far = 190;
    key.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.05;
    key.shadow.radius = 1.6;
  }
  scene.add(key);
  scene.add(key.target);

  const hemi = new THREE.HemisphereLight(0x1a2740, 0x05070c, 0.75);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x0d1526, 0.80);
  scene.add(ambient);

  // the lake throwing a little of the moon back up under the shore rocks
  const bounce = new THREE.DirectionalLight(0x233450, 0.32);
  bounce.position.set(0.1, -0.6, -1);
  scene.add(bounce);

  /* ── post ───────────────────────────────────────────────────────────────── */

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
    // The moon and its path on the water are the only things that should ever
    // cross the threshold. A wide bloom on a night scene is fog, not light.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.24, 0.62, 0.72);
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());

  const gradePass = new ShaderPass(GradeShader);
  gradePass.material.toneMapped = false;
  if (!preset.bloom) {
    gradePass.uniforms.uAberration.value = 0.0;
    gradePass.uniforms.uGrain.value = 0.010;
  }
  const g = curves.grade;
  gradePass.uniforms.uShadowTint.value.setRGB(g.shadowTint[0], g.shadowTint[1], g.shadowTint[2]);
  gradePass.uniforms.uHighTint.value.setRGB(g.highTint[0], g.highTint[1], g.highTint[2]);
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

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt, state) {
    time += dt;
    const s = state ? clamp(state.settle, 0, 1) : 0;

    uniforms.uTime.value = time;
    dome.position.copy(camera.position);

    // The sky itself does not answer to the stillness — only the reflection of
    // it does. What the settle moves up here is the haze between: less of it
    // means more of the field of stars was always there to be seen.
    uniforms.uStarGain.value = 0.72 + 0.42 * s;
    key.intensity = 1.35 + 0.16 * s;
    hemi.intensity = 0.75 - 0.08 * s;

    gradePass.uniforms.uTime.value = time;
    gradePass.uniforms.uVignette.value = g.vignette(s);
    renderer.toneMappingExposure = g.exposure(s);
    if (bloomPass) {
      bloomPass.strength = g.bloom(s);
      bloomPass.threshold = g.bloomThreshold(s);
    }
  }

  return { update, render, resize, moonDir };
}
