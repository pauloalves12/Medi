/**
 * sky.js — the sky above the lake, the light it casts, and the post chain.
 * @see water/main.js MODULE CONTRACT
 *
 * `render()` is the only place the frame is drawn.
 *
 * The dome is one shader-material sphere painted by the hour's own `swSky`,
 * whichever hour that is. Its arguments come off `state.light`, which main.js
 * writes once a frame; the lake calls the same function with *different*
 * arguments from the same source, which is the whole of the reflection
 * technique — see the note at the top of mood.js.
 *
 * Nothing in here knows which hour it is drawing.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
    uSaturate: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uVignette, uAberration, uGrain, uHighMix, uSaturate;
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

      // ACES takes saturation out of everything, and it takes most of it out
      // of a blue sky and a green lake — which at night costs nothing, because
      // there is no colour in the frame to lose, and by day costs the whole
      // difference between clear air and overcast. Zero for the moonlit hour;
      // this is a restoration rather than a look.
      col = mix(vec3(l), col, 1.0 + uSaturate);

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

export function createSky(scene, camera, renderer, ctx, deps) {
  const preset = ctx.preset;
  const mood = ctx.mood;
  const curves = mood.curves;
  let time = 0;

  const L0 = mood.light(null);
  const lightDir = new THREE.Vector3(L0.dir[0], L0.dir[1], L0.dir[2]).normalize();

  /* ── dome ───────────────────────────────────────────────────────────────── */

  const uniforms = {
    uNoise: { value: deps.noise },
    uZenith: { value: new THREE.Color(L0.zenith) },
    uHorizon: { value: new THREE.Color(L0.horizon) },
    uGlow: { value: new THREE.Color(L0.glow) },
    uGround: { value: new THREE.Color(L0.ground) },
    uLightDir: { value: lightDir.clone() },
    uLightCol: { value: new THREE.Color(L0.discCol) },
    uGlowI: { value: L0.glowI },
    uDiscSize: { value: L0.discSize },
    uDiscI: { value: L0.discI },
    uHalo: { value: L0.halo },
    uDetailGain: { value: L0.detailGain },
    uDetailSoft: { value: L0.detailSoft },
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
    fragmentShader: mood.glsl + /* glsl */`
      uniform sampler2D uNoise;
      uniform vec3 uZenith, uHorizon, uGlow, uGround, uLightDir, uLightCol;
      uniform float uGlowI, uDiscSize, uDiscI, uHalo, uDetailGain, uDetailSoft, uTime;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = swSky(d, uNoise, uZenith, uHorizon, uGlow, uLightDir, uLightCol,
                         uGlowI, uDiscSize, uDiscI, uHalo, uDetailGain, uDetailSoft, uTime);
        // below the waterline the dome is simply the ground colour; the lake
        // covers it, and what shows past the lake's edges is the far bank
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
   * One key, one hemisphere so nothing is pure black, one ambient, and a faint
   * bounce off the water. Four lights at either hour; what the hour changes is
   * the ratio between them, and that ratio is most of the difference. A moon is
   * a hundred-thousandth of the sun and what makes the night read is contrast
   * and silhouette. By day the sky itself becomes a second light — an enormous
   * soft box, and the only reason a shadow on a shore rock reads blue rather
   * than black — but it stays well under the key, because a fill run up near
   * the key's own strength is what "brighter" looks like when it has been
   * mistaken for "daylight".
   * ────────────────────────────────────────────────────────────────────── */

  const key = new THREE.DirectionalLight(L0.keyCol, L0.keyI);
  key.position.copy(lightDir).multiplyScalar(90);
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

  const hemi = new THREE.HemisphereLight(L0.hemiSky, L0.hemiGround, L0.hemiI);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(L0.ambCol, L0.ambI);
  scene.add(ambient);

  // the lake throwing a little of the sky back up under the shore rocks
  const bounce = new THREE.DirectionalLight(L0.bounceCol, L0.bounceI);
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

  const g = curves.grade;

  let bloomPass = null;
  if (preset.bloom) {
    // Only genuine light should ever cross the threshold. A wide bloom on a
    // night scene is fog rather than light; on a daylight one it is paste, and
    // it is the single fastest way to turn a clear morning into a postcard —
    // which is why the day's numbers here are a third of the night's.
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y), g.bloom(0), g.bloomRadius, g.bloomThreshold(0),
    );
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());

  const gradePass = new ShaderPass(GradeShader);
  gradePass.material.toneMapped = false;
  gradePass.uniforms.uAberration.value = preset.bloom ? g.aberration : 0.0;
  gradePass.uniforms.uGrain.value = preset.bloom ? g.grain : g.grainLow;
  gradePass.uniforms.uSaturate.value = g.saturate || 0.0;
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
    const L = (state && state.light) || mood.light(state);

    uniforms.uTime.value = time;
    dome.position.copy(camera.position);

    // Everything celestial comes off the one table main.js filled in for this
    // frame. At night almost none of it moves; by day the sun climbs, the sky
    // deepens and the haze thins — and the water is reading the same numbers,
    // so the reflection cannot drift out of agreement with the sky above it.
    uniforms.uZenith.value.setHex(L.zenith);
    uniforms.uHorizon.value.setHex(L.horizon);
    uniforms.uGlow.value.setHex(L.glow);
    uniforms.uLightCol.value.setHex(L.discCol);
    uniforms.uGlowI.value = L.glowI;
    uniforms.uDiscSize.value = L.discSize;
    uniforms.uDiscI.value = L.discI;
    uniforms.uHalo.value = L.halo;
    uniforms.uDetailGain.value = L.detailGain;
    uniforms.uDetailSoft.value = L.detailSoft;

    lightDir.set(L.dir[0], L.dir[1], L.dir[2]).normalize();
    uniforms.uLightDir.value.copy(lightDir);
    key.position.copy(lightDir).multiplyScalar(90);
    key.color.setHex(L.keyCol);
    key.intensity = L.keyI;
    hemi.color.setHex(L.hemiSky);
    hemi.groundColor.setHex(L.hemiGround);
    hemi.intensity = L.hemiI;
    ambient.intensity = L.ambI;
    bounce.intensity = L.bounceI;

    gradePass.uniforms.uTime.value = time;
    gradePass.uniforms.uVignette.value = g.vignette(s);
    renderer.toneMappingExposure = g.exposure(s);
    if (bloomPass) {
      bloomPass.strength = g.bloom(s);
      bloomPass.threshold = g.bloomThreshold(s);
    }
  }

  return { update, render, resize };
}
