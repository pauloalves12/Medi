/**
 * environment.js — terrain, path, vegetation, rocks, lantern, orb, shrine, ridges.
 * @see main.js LOCKED MODULE CONTRACT
 *
 * Everything here is procedural and built once at startup. The terrain height is
 * a pure analytic function (`getGroundHeight`); the rendered mesh samples exactly
 * that function, so ground queries never need a raycast.
 */

import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

/* ── small math helpers ───────────────────────────────────────────────────── */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}
function smootherstep(t) {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// deterministic RNG so every run composes identically
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _perlin = new ImprovedNoise();
function fbm(x, y, oct) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * _perlin.noise(x * f + 13.7, y * f + 41.3, 7.19 + i * 5.31);
    a *= 0.5; f *= 2.03;
  }
  return s * 1.55;
}

/* ── the shape of the journey ─────────────────────────────────────────────── */

const PATH_Z0 = 2.0;          // path begins just behind the spawn
const PATH_Z1 = -53.0;        // path ends on the shrine platform
const PATH_LEN = PATH_Z0 - PATH_Z1;

const TERRAIN_HALF = 120;
const TERRAIN_CZ = -25;

// gentle S-curve so the corridor is never a straight tunnel
function pathCenterX(z) {
  const u = clamp((PATH_Z0 - z) / PATH_LEN, -0.35, 1.5);
  return 2.25 * Math.sin(u * 4.15) * (1 - 0.22 * Math.max(0, u));
}

function corridorHalf(z) {
  return 2.3 + 2.7 * smoothstep(-44.0, -49.5, z) + 0.6 * smoothstep(-2.0, 3.0, z);
}

// elevation of the walked line: +4m climb with a crest at z=-34 and a saddle after it
function pathProfileY(z) {
  const u = clamp((PATH_Z0 - z) / PATH_LEN, 0, 1);
  const s = u * u * (3 - 2 * u);
  const a = (z + 34.0) / 7.2;
  const b = (z + 45.0) / 5.2;
  return 3.9 * s + 1.55 * Math.exp(-a * a) - 0.42 * Math.exp(-b * b);
}

const PLATEAU_Y = pathProfileY(-49.5);

function groundHeight(x, z) {
  const cx = pathCenterX(z);
  const d = Math.abs(x - cx);
  let h = pathProfileY(z);

  const hill = smoothstep(2.4, 14.0, d);
  const micro = 1 - 0.78 * (1 - smoothstep(3.0, 7.5, d));

  h += hill * (2.85 * fbm(x * 0.028, z * 0.028, 4) + 0.75);
  h += hill * 0.052 * d;
  h += micro * 0.30 * fbm(x * 0.16, z * 0.16, 3);
  h += 0.055 * _perlin.noise(x * 0.9 + 3.1, z * 0.9 + 8.6, 2.5);

  // far rim keeps the mesh edge out of sight
  h += 12.0 * Math.pow(smoothstep(52.0, 118.0, d), 1.7);

  // shrine promontory: a flat stone shelf
  const pl = smoothstep(-43.0, -47.5, z) * (1 - smoothstep(5.2, 9.8, d));
  h += (PLATEAU_Y - h) * (0.94 * pl);

  // the promontory's shoulders fall away
  h -= smoothstep(-41.0, -47.5, z) * smoothstep(8.0, 26.0, d) * 55.0;

  // and then the world drops into the cloud valley
  const vd = smoothstep(-54.5, -64.0, z);
  h -= vd * vd * 140.0 + smoothstep(-64.0, -110.0, z) * 90.0;

  return Number.isFinite(h) ? h : 0;
}

/* ── generated textures ───────────────────────────────────────────────────── */

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function needleTexture() {
  const [c, g] = canvas2d(256);
  g.clearRect(0, 0, 256, 256);
  const rnd = mulberry32(7);
  // clumps of short needle strokes; the gaps between them become the alpha holes
  for (let i = 0; i < 220; i++) {
    const cx = rnd() * 256, cy = rnd() * 256;
    const n = 10 + (rnd() * 14) | 0;
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      const len = 7 + rnd() * 16;
      const v = 0.55 + rnd() * 0.45;
      g.strokeStyle = `rgba(${(28 * v) | 0},${(48 * v) | 0},${(40 * v) | 0},${0.75 + rnd() * 0.25})`;
      g.lineWidth = 1.1 + rnd() * 1.5;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function frondTexture() {
  const [c, g] = canvas2d(128);
  g.clearRect(0, 0, 128, 128);
  const rnd = mulberry32(19);
  for (let s = 0; s < 7; s++) {
    const x0 = 20 + rnd() * 88;
    const tilt = (rnd() - 0.5) * 0.9;
    for (let t = 0; t < 26; t++) {
      const p = t / 26;
      const x = x0 + Math.sin(p * 2.2 + tilt) * 22 * p;
      const y = 126 - p * (70 + rnd() * 45);
      const w = 15 * (1 - p) + 3;
      const v = 0.5 + rnd() * 0.4;
      g.strokeStyle = `rgba(${(34 * v) | 0},${(58 * v) | 0},${(44 * v) | 0},0.95)`;
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - w, y + 5); g.stroke();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + 5); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function radialTexture(size, stops) {
  const [c, g] = canvas2d(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) grad.addColorStop(p, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flameTexture() {
  const [c, g] = canvas2d(64);
  g.clearRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x - 32) / 15;
      const dy = (y - 46) / 26;
      // teardrop
      const r = Math.sqrt(dx * dx * (1 + Math.max(0, -dy) * 1.6) + dy * dy);
      const a = clamp(1 - r, 0, 1);
      const v = Math.pow(a, 1.6);
      g.fillStyle = `rgba(255,${(190 + 60 * v) | 0},${(110 + 110 * v) | 0},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── module ───────────────────────────────────────────────────────────────── */

export function createEnvironment(scene, ctx) {
  const preset = ctx.preset;
  const root = new THREE.Group();
  root.name = 'environment';
  scene.add(root);

  const rnd = mulberry32(20260806);
  let time = 0;

  const anchors = {
    start: new THREE.Vector3(0.0, groundHeight(0.0, 0.0), 0.0),
    lantern: new THREE.Vector3(1.7, groundHeight(1.7, -6.5) + 1.15, -6.5),
    orb: new THREE.Vector3(-1.1, groundHeight(-1.1, -26.0) + 1.45, -26.0),
    bell: new THREE.Vector3(0.6, groundHeight(0.6, -48.0) + 1.60, -48.0),
    shrineView: new THREE.Vector3(0.0, groundHeight(0.0, -52.5) + 1.60, -52.5),
  };

  /* ── shared materials & textures ───────────────────────────────────────── */

  const texNeedle = needleTexture();
  const texFrond = frondTexture();
  const texFlame = flameTexture();
  const texHalo = radialTexture(128, [
    [0.0, 'rgba(255,236,208,1)'], [0.18, 'rgba(255,206,150,0.72)'],
    [0.45, 'rgba(240,170,110,0.20)'], [1.0, 'rgba(200,140,90,0)'],
  ]);

  const matStone = new THREE.MeshStandardMaterial({ color: 0x2f3138, roughness: 0.92, metalness: 0.0 });
  const matTimber = new THREE.MeshStandardMaterial({ color: 0x2b2119, roughness: 0.88, metalness: 0.0 });

  const windUniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.4 },
  };

  /** attaches a shared time/wind uniform pair plus a vertex sway to a material */
  function addSway(material, strength, exponent, tall) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime;
      shader.uniforms.uWind = windUniforms.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uWind;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float swPh = instanceMatrix[3].x * 0.83 + instanceMatrix[3].z * 1.17;
          #else
            float swPh = 0.0;
          #endif
          float swH = clamp(transformed.y / ${tall.toFixed(2)}, 0.0, 1.0);
          float swA = (0.22 + 0.78 * uWind) * pow(swH, ${exponent.toFixed(2)}) * ${strength.toFixed(3)};
          transformed.x += (sin(uTime * 1.15 + swPh) * 0.75 + sin(uTime * 2.61 + swPh * 1.7) * 0.25) * swA;
          transformed.z += (cos(uTime * 0.91 + swPh * 1.3) * 0.7 + sin(uTime * 3.17 + swPh) * 0.2) * swA * 0.85;
        `);
    };
    material.customProgramCacheKey = () => 'sway' + strength + exponent + tall;
  }

  /* ── terrain ───────────────────────────────────────────────────────────── */

  const SEG = ctx.quality === 'high' ? 224 : ctx.quality === 'medium' ? 176 : 120;

  function buildTerrain() {
    const n = SEG, np = n + 1;
    const pos = new Float32Array(np * np * 3);
    const col = new Float32Array(np * np * 3);
    const idx = new Uint32Array(n * n * 6);

    // grid warped toward the centre so the corridor gets the triangles
    const coord = new Float32Array(np);
    for (let i = 0; i < np; i++) {
      const t = (i / n) * 2 - 1;
      coord[i] = Math.sign(t) * Math.pow(Math.abs(t), 1.6) * TERRAIN_HALF;
    }

    let p = 0;
    for (let j = 0; j < np; j++) {
      const z = TERRAIN_CZ + coord[j];
      for (let i = 0; i < np; i++) {
        const x = coord[i];
        pos[p] = x; pos[p + 1] = groundHeight(x, z); pos[p + 2] = z;
        p += 3;
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
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    // vertex colours: wet stone / cold moss / pale frosted grass
    const nrm = geo.attributes.normal.array;
    const cStone = new THREE.Color(0x2b2f38);
    const cWet = new THREE.Color(0x1e222c);
    const cMoss = new THREE.Color(0x36473e);
    const cGrass = new THREE.Color(0x5f6d64);
    const cFrost = new THREE.Color(0x848f98);
    const tmp = new THREE.Color();

    for (let v = 0, i3 = 0; v < np * np; v++, i3 += 3) {
      const x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
      const slope = 1 - clamp(nrm[i3 + 1], 0, 1);
      const d = Math.abs(x - pathCenterX(z));
      const grain = fbm(x * 0.11 + 90, z * 0.11, 3) * 0.5 + 0.5;

      tmp.copy(cMoss);
      tmp.lerp(cGrass, smoothstep(0.15, 0.75, grain) * (1 - smoothstep(0.18, 0.5, slope)));
      tmp.lerp(cStone, smoothstep(0.22, 0.62, slope));
      tmp.lerp(cWet, smoothstep(6.0, 1.2, d) * 0.65);            // damp margins beside the path
      tmp.lerp(cFrost, smoothstep(7.5, 15.0, y) * 0.55 * (1 - smoothstep(0.5, 0.85, slope)));
      const shade = 0.82 + 0.36 * grain;
      col[i3] = tmp.r * shade; col[i3 + 1] = tmp.g * shade; col[i3 + 2] = tmp.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0, dithering: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = preset.shadows;
    mesh.castShadow = preset.shadows && ctx.quality === 'high';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    return mesh;
  }
  buildTerrain();

  /* ── flagstone path ────────────────────────────────────────────────────── */

  const pathGlow = { target: 0, raw: 0 };
  const STONE_R = 0.36;
  let stoneUniforms = null;

  function buildPath() {
    const stones = [];
    const step = 0.66;
    for (let z = PATH_Z0 + 1.0; z > PATH_Z1 - 0.6; z -= step) {
      const u = (PATH_Z0 - z) / PATH_LEN;
      const cx = pathCenterX(z);
      const half = Math.min(corridorHalf(z) - 0.55, 2.2);
      const across = 5 + ((rnd() * 3) | 0);
      for (let i = 0; i < across; i++) {
        const lat = ((i + 0.5) / across - 0.5) * 2 * half + (rnd() - 0.5) * 0.34;
        const x = cx + lat;
        const zz = z + (rnd() - 0.5) * 0.5;
        if (Math.abs(lat) > half + 0.12) continue;
        stones.push({ x, z: zz, u: clamp(u, 0, 1), s: 0.84 + rnd() * 0.34, r: rnd() * Math.PI, h: 0.85 + rnd() * 0.3 });
      }
    }

    // Small, flat, many-sided slabs: a laid path rather than stepping discs.
    const geo = new THREE.CylinderGeometry(STONE_R, STONE_R * 0.9, 0.1, 9, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2d34, roughness: 0.72, metalness: 0.0, emissive: 0x000000,
    });

    stoneUniforms = {
      uFront: { value: -0.2 },
      uStrength: { value: 0 },
      uGlowColor: { value: new THREE.Color(0xffab5e) },
    };

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFront = stoneUniforms.uFront;
      shader.uniforms.uStrength = stoneUniforms.uStrength;
      shader.uniforms.uGlowColor = stoneUniforms.uGlowColor;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPathU; varying float vPathU; varying float vEdge; varying float vSide;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPathU = aPathU;
          vEdge = smoothstep(0.60, 1.02, length(position.xz) / ${STONE_R.toFixed(3)});
          vSide = 1.0 - abs(normal.y);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uFront; uniform float uStrength; uniform vec3 uGlowColor;
          varying float vPathU; varying float vEdge; varying float vSide;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float lit = (1.0 - smoothstep(uFront - 0.13, uFront, vPathU)) * uStrength;
          // Light seeps up through the joints: brightest on the rim of the top
          // face, almost nothing on the buried sides, so it reads as a seam
          // between stones rather than a glowing disc.
          float topness = 1.0 - vSide;
          float seam = vEdge * vEdge;
          totalEmissiveRadiance += uGlowColor * lit * (topness * (0.020 + seam * 0.26) + vSide * 0.03);
          diffuseColor.rgb += uGlowColor * lit * 0.035;`);
    };
    mat.customProgramCacheKey = () => 'pathstone';

    const mesh = new THREE.InstancedMesh(geo, mat, stones.length);
    mesh.receiveShadow = preset.shadows;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const uArr = new Float32Array(stones.length);
    for (let i = 0; i < stones.length; i++) {
      const s = stones[i];
      // Barely tilted and bedded well down, so the coarse terrain triangles
      // never let a side wall show.
      e.set((rnd() - 0.5) * 0.05, s.r, (rnd() - 0.5) * 0.05);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(s.x, groundHeight(s.x, s.z) - 0.085 + (rnd() - 0.5) * 0.01, s.z),
        q,
        new THREE.Vector3(s.s, s.h, s.s * (0.85 + rnd() * 0.3)),
      );
      mesh.setMatrixAt(i, m);
      uArr[i] = s.u;
    }
    geo.setAttribute('aPathU', new THREE.InstancedBufferAttribute(uArr, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  buildPath();

  /* ── pines ─────────────────────────────────────────────────────────────── */

  function coneShell(rBase, height, segs, seed) {
    const r = mulberry32(seed);
    const rings = [0, 0.34, 0.64, 0.86, 1];
    const verts = [], uvs = [], idx = [];
    const jit = [];
    for (let i = 0; i <= segs; i++) jit.push(0.72 + r() * 0.5);
    jit[segs] = jit[0];
    for (let ri = 0; ri < rings.length; ri++) {
      const t = rings[ri];
      const rad = rBase * Math.pow(1 - t, 1.18);
      const y = height * t;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const jr = rad * (ri === 0 ? jit[i] : lerp(jit[i], 1, t * 0.8));
        const dip = ri === 0 ? -0.16 * height * (jit[i] - 0.9) : 0;
        verts.push(Math.cos(a) * jr, y + dip, Math.sin(a) * jr);
        uvs.push(i / segs * 2.2, t * 1.6);
      }
    }
    const rowLen = segs + 1;
    for (let ri = 0; ri < rings.length - 1; ri++) {
      for (let i = 0; i < segs; i++) {
        const a = ri * rowLen + i, b = a + 1, c = a + rowLen, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function mergeGeometries(list) {
    let vc = 0, ic = 0;
    for (const g of list) { vc += g.attributes.position.count; ic += g.index.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
    const idx = new Uint32Array(ic);
    let vo = 0, io = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      uv.set(g.attributes.uv.array, vo * 2);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += g.attributes.position.count; io += gi.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  function buildPines() {
    const shells = [];
    const layers = Math.max(3, Math.round(5 * preset.treeDetail + 0.5));
    const segs = ctx.quality === 'low' ? 7 : 9;
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const g = coneShell(1.75 * (1 - t * 0.62), 2.55 * (1 - t * 0.30), segs, 101 + i * 37);
      g.translate(0, 1.9 + t * 3.15, 0);
      shells.push(g);
    }
    const foliageGeo = mergeGeometries(shells);
    const foliageMat = new THREE.MeshStandardMaterial({
      map: texNeedle, color: 0x233229, roughness: 0.95, metalness: 0.0,
      alphaTest: 0.34, side: THREE.DoubleSide,
    });
    addSway(foliageMat, 0.16, 1.6, 7.0);

    const trunkGeo = new THREE.CylinderGeometry(0.10, 0.26, 6.6, 6, 1);
    trunkGeo.translate(0, 3.3, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a2119, roughness: 0.94 });
    addSway(trunkMat, 0.09, 1.9, 7.0);

    // placement: a ring that frames the sanctuary without ever masking the valley
    const spots = [];
    const want = Math.round((ctx.quality === 'high' ? 150 : ctx.quality === 'medium' ? 104 : 54));
    let guard = 0;
    while (spots.length < want && guard++ < want * 60) {
      const z = 12 - rnd() * 74;                      // +12 .. -62
      const side = rnd() < 0.5 ? -1 : 1;
      const dist = 7.5 + Math.pow(rnd(), 0.62) * 40;
      const x = pathCenterX(z) + side * dist;
      if (Math.abs(x) > 60) continue;
      // never stand in the valley reveal cone
      if (z < -42 && Math.abs(x) < 15 + (-42 - z) * 1.5) continue;
      if (z < -47 && dist < 26) continue;
      const y = groundHeight(x, z);
      if (y < 0.4) continue;
      const slope = Math.abs(groundHeight(x + 1, z) - groundHeight(x - 1, z)) * 0.5;
      if (slope > 1.5) continue;
      let ok = true;
      for (const s of spots) {
        const dx = s.x - x, dz = s.z - z;
        if (dx * dx + dz * dz < 12.0) { ok = false; break; }
      }
      if (!ok) continue;
      spots.push({ x, y, z, s: 0.62 + Math.pow(rnd(), 0.8) * 1.05, r: rnd() * 6.283 });
    }

    const fol = new THREE.InstancedMesh(foliageGeo, foliageMat, spots.length);
    const tru = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    fol.castShadow = tru.castShadow = preset.shadows;
    fol.receiveShadow = tru.receiveShadow = preset.shadows;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      e.set((rnd() - 0.5) * 0.06, s.r, (rnd() - 0.5) * 0.06);
      q.setFromEuler(e);
      v.set(s.x, s.y - 0.15, s.z);
      sc.set(s.s * (0.88 + rnd() * 0.24), s.s * (0.9 + rnd() * 0.35), s.s * (0.88 + rnd() * 0.24));
      m.compose(v, q, sc);
      fol.setMatrixAt(i, m); tru.setMatrixAt(i, m);
    }
    fol.instanceMatrix.needsUpdate = tru.instanceMatrix.needsUpdate = true;
    fol.computeBoundingSphere(); tru.computeBoundingSphere();
    root.add(fol); root.add(tru);
  }
  buildPines();

  /* ── grass ─────────────────────────────────────────────────────────────── */

  function bladeGeometry() {
    const segs = 4, h = 1.0, w = 0.021;
    const pos = [], uv = [], idx = [], nor = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const bend = t * t * 0.46;
      const ww = w * (1 - t * 0.92);
      pos.push(-ww, t * h, bend, ww, t * h, bend);
      nor.push(0, 0.35, 1, 0, 0.35, 1);
      uv.push(0, t, 1, t);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function buildGrass() {
    const count = preset.grassCount;
    const geo = bladeGeometry();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    addSway(mat, 0.30, 1.7, 1.0);

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.receiveShadow = preset.shadows;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const base = new THREE.Color(), dry = new THREE.Color(0x5f6149), green = new THREE.Color(0x3a4c38), pale = new THREE.Color(0x6d7e77);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 8) {
      const z = 5 - rnd() * 61;                      // +5 .. -56
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = Math.pow(rnd(), 1.9) * 17.0 * side;
      const x = pathCenterX(z) + lat;
      const half = corridorHalf(z);
      if (Math.abs(lat) < half * 0.85 && rnd() > 0.09) continue;   // sparse on the flagstones
      const y = groundHeight(x, z);
      if (y < 0.2 && z < -50) continue;
      const slope = Math.abs(groundHeight(x + 0.8, z) - groundHeight(x - 0.8, z)) * 0.625;
      if (slope > 0.85 || rnd() < slope * 0.6) continue;
      if (z < -45 && Math.abs(x) < 2.6 && z > -51) continue;       // keep the shrine floor clear

      e.set(0, rnd() * 6.283, (rnd() - 0.5) * 0.22);
      q.setFromEuler(e);
      const s = 0.22 + Math.pow(rnd(), 1.5) * 0.36;
      v.set(x, y - 0.03, z);
      // The blade curls forward in Z, so Z must scale with height — otherwise a
      // short blade keeps the full-height bend and lies flat like a twig.
      const hs = s * (0.75 + rnd() * 0.6);
      sc.set(0.85 + rnd() * 0.4, hs, hs);
      m.compose(v, q, sc);
      mesh.setMatrixAt(placed, m);

      base.copy(green).lerp(dry, rnd() * 0.55).lerp(pale, smoothstep(6.0, 13.0, y) * 0.4 + rnd() * 0.10);
      base.multiplyScalar(0.95 + rnd() * 0.5);
      mesh.setColorAt(placed, base);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  buildGrass();

  /* ── ferns / shrubs / dead branches ────────────────────────────────────── */

  function buildUndergrowth() {
    const q1 = new THREE.PlaneGeometry(1, 1);
    q1.translate(0, 0.5, 0);
    const q2 = q1.clone(); q2.rotateY(Math.PI / 2);
    const q3 = q1.clone(); q3.rotateY(Math.PI / 4);
    q1.computeVertexNormals(); q2.computeVertexNormals(); q3.computeVertexNormals();
    const fernGeo = mergeGeometries([q1, q2, q3]);
    const fernMat = new THREE.MeshLambertMaterial({
      map: texFrond, color: 0x9fb09a, alphaTest: 0.4, side: THREE.DoubleSide,
    });
    addSway(fernMat, 0.11, 1.5, 1.0);

    const n = ctx.quality === 'low' ? 90 : ctx.quality === 'medium' ? 200 : 330;
    const mesh = new THREE.InstancedMesh(fernGeo, fernMat, n);
    mesh.receiveShadow = preset.shadows;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 30) {
      const z = 4 - rnd() * 58;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = (2.0 + Math.pow(rnd(), 1.5) * 13) * side;
      const x = pathCenterX(z) + lat;
      const y = groundHeight(x, z);
      if (y < 0.3) continue;
      if (z < -44 && Math.abs(x) < 4) continue;
      e.set(0, rnd() * 6.283, 0);
      q.setFromEuler(e);
      const s = 0.5 + rnd() * 0.75;
      m.compose(new THREE.Vector3(x, y - 0.06, z), q, new THREE.Vector3(s, s * (0.7 + rnd() * 0.5), s));
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);

    // dead branches for silhouette variety
    const bg = new THREE.CylinderGeometry(0.028, 0.05, 1.6, 5);
    bg.translate(0, 0.8, 0);
    const bm = new THREE.MeshStandardMaterial({ color: 0x3a332a, roughness: 0.95 });
    const bn = ctx.quality === 'low' ? 8 : 18;
    const br = new THREE.InstancedMesh(bg, bm, bn);
    br.castShadow = preset.shadows;
    for (let i = 0; i < bn; i++) {
      const z = -2 - rnd() * 48;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = pathCenterX(z) + (2.6 + rnd() * 7) * side;
      const y = groundHeight(x, z);
      e.set(1.15 + (rnd() - 0.5) * 0.6, rnd() * 6.283, (rnd() - 0.5) * 0.7);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y + 0.05, z), q, new THREE.Vector3(1, 0.7 + rnd() * 0.9, 1));
      br.setMatrixAt(i, m);
    }
    br.instanceMatrix.needsUpdate = true;
    br.computeBoundingSphere();
    root.add(br);
  }
  buildUndergrowth();

  /* ── boulders ──────────────────────────────────────────────────────────── */

  function buildRocks() {
    const variants = [];
    for (let vi = 0; vi < 3; vi++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      const r = mulberry32(500 + vi * 17);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const d = 1 + (fbm(x * 1.7 + vi * 10, z * 1.7 + y * 1.3, 3)) * 0.30 + (r() - 0.5) * 0.10;
        p.setXYZ(i, x * d, y * d * 0.66, z * d);
      }
      g.computeVertexNormals();
      // moss on upward faces
      const nor = g.attributes.normal;
      const col = new Float32Array(p.count * 3);
      const rock = new THREE.Color(0x2b2e34), moss = new THREE.Color(0x33452f), lit = new THREE.Color(0x4b5058);
      const tmp = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const up = clamp(nor.getY(i), 0, 1);
        tmp.copy(rock).lerp(lit, smoothstep(0.2, 0.9, up) * 0.4).lerp(moss, smoothstep(0.55, 0.95, up) * 0.7);
        tmp.multiplyScalar(0.85 + 0.3 * (fbm(p.getX(i) * 3, p.getZ(i) * 3, 2) * 0.5 + 0.5));
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      variants.push(g);
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, flatShading: true });

    const perVariant = [[], [], []];
    const zs = [1, -3.5, -8.5, -12, -15.5, -19, -23, -25, -28.5, -31, -33.5, -35, -38, -40.5, -43, -46, -48.5, -50.5, -52, -54];
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i] + (rnd() - 0.5) * 1.6;
      const side = i % 2 === 0 ? 1 : -1;
      const dist = corridorHalf(z) + 0.4 + rnd() * 3.4;
      const x = pathCenterX(z) + side * dist;
      const y = groundHeight(x, z);
      perVariant[i % 3].push({ x, y, z, s: 0.42 + Math.pow(rnd(), 1.2) * 1.5, r: rnd() * 6.283 });
      if (rnd() < 0.45) {
        const x2 = pathCenterX(z) + -side * (corridorHalf(z) + 0.8 + rnd() * 5);
        perVariant[(i + 1) % 3].push({ x: x2, y: groundHeight(x2, z), z: z + 1.1, s: 0.3 + rnd() * 0.9, r: rnd() * 6.283 });
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let vi = 0; vi < 3; vi++) {
      const list = perVariant[vi];
      const mesh = new THREE.InstancedMesh(variants[vi], mat, list.length);
      mesh.castShadow = mesh.receiveShadow = preset.shadows;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        e.set((rnd() - 0.5) * 0.22, s.r, (rnd() - 0.5) * 0.22);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(s.x, s.y - s.s * 0.30, s.z), q,
          new THREE.Vector3(s.s * (0.9 + rnd() * 0.4), s.s * (0.7 + rnd() * 0.5), s.s * (0.9 + rnd() * 0.4)));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  }
  buildRocks();

  /* ── lantern ───────────────────────────────────────────────────────────── */

  const lanternMount = new THREE.Object3D();
  const lanternState = { target: 0, lit: 0 };
  let paperMat = null, flameGroup = null, flameMat = null;

  function buildLantern() {
    const g = new THREE.Group();
    g.position.set(anchors.lantern.x, anchors.lantern.y - 1.15, anchors.lantern.z);
    g.rotation.y = -0.5;

    const add = (geo, mat, y, cast = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = y;
      mesh.castShadow = preset.shadows && cast;
      mesh.receiveShadow = preset.shadows;
      g.add(mesh);
      return mesh;
    };

    add(new THREE.CylinderGeometry(0.34, 0.42, 0.20, 8), matStone, 0.10);
    add(new THREE.CylinderGeometry(0.26, 0.30, 0.10, 8), matStone, 0.24);
    add(new THREE.CylinderGeometry(0.075, 0.095, 0.75, 7), matStone, 0.66);
    add(new THREE.CylinderGeometry(0.22, 0.17, 0.09, 8), matStone, 1.06);

    paperMat = new THREE.MeshStandardMaterial({
      color: 0x6a5b48, roughness: 1.0, metalness: 0.0,
      emissive: new THREE.Color(0xffb066), emissiveIntensity: 0.0,
      side: THREE.DoubleSide, transparent: true, opacity: 0.96,
    });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.185, 0.30, 8, 1, true), paperMat);
    shade.position.y = 1.26;
    g.add(shade);

    // slender frame ribs
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x231b14, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.31, 0.018), ribMat);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      rib.position.set(Math.cos(a) * 0.172, 1.26, Math.sin(a) * 0.172);
      g.add(rib);
    }
    add(new THREE.CylinderGeometry(0.30, 0.20, 0.13, 8), matStone, 1.47);
    add(new THREE.SphereGeometry(0.045, 8, 6), matStone, 1.56);

    // flame — two crossed additive quads inside the shade
    flameMat = new THREE.MeshBasicMaterial({
      map: texFlame, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0, toneMapped: true,
    });
    flameGroup = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.17), flameMat);
      q.rotation.y = i * Math.PI / 2;
      q.position.y = 0.055;
      flameGroup.add(q);
    }
    flameGroup.position.y = 1.15;
    g.add(flameGroup);

    lanternMount.position.set(0, 1.15, 0);
    g.add(lanternMount);
    root.add(g);
  }
  buildLantern();

  /* ── orb ───────────────────────────────────────────────────────────────── */

  const orb = new THREE.Group();
  const orbState = { scale: 0.5, glow: 0.4, active: 0, target: 0 };
  let orbCore, orbShell, orbHalo, orbShellMat, orbCoreMat, orbHaloMat;

  function buildOrb() {
    orb.position.copy(anchors.orb);

    orbCoreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.28, 0.95), toneMapped: true });
    orbCore = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 16), orbCoreMat);
    orb.add(orbCore);

    orbShellMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGlow: { value: 0.5 },
        uColor: { value: new THREE.Color(0xffd9a8) },
        uRim: { value: new THREE.Color(0x9fc4ff) },
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vP = position;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime; uniform float uGlow; uniform vec3 uColor; uniform vec3 uRim;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
          float band = 0.5 + 0.5 * sin(vP.y * 22.0 + uTime * 0.7);
          vec3 c = mix(uColor, uRim, 0.45 + 0.35 * band);
          float a = f * (0.30 + 0.85 * uGlow) + 0.035 * uGlow;
          gl_FragColor = vec4(c * (0.5 + 1.4 * uGlow), a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });
    orbShell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 24), orbShellMat);
    orb.add(orbShell);

    orbHaloMat = new THREE.SpriteMaterial({
      map: texHalo, color: 0xffcf9a, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.5,
    });
    orbHalo = new THREE.Sprite(orbHaloMat);
    orbHalo.scale.setScalar(1.5);
    orb.add(orbHalo);

    root.add(orb);
  }
  buildOrb();

  /* ── shrine + bell ─────────────────────────────────────────────────────── */

  const bellPivot = new THREE.Object3D();
  const strikerPivot = new THREE.Object3D();
  const bell = new THREE.Group();
  const bellSwing = { amp: 0, t: 0, glow: 0 };
  let bellMat = null;

  function buildShrine() {
    const cz = -48.7, cx = 0.35;
    const gy = groundHeight(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, gy, cz);
    g.rotation.y = 0.06;

    const put = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = preset.shadows;
      m.receiveShadow = preset.shadows;
      g.add(m);
      return m;
    };

    // stepped base
    put(new THREE.BoxGeometry(4.6, 0.26, 4.2), matStone, 0, 0.05, 0);
    put(new THREE.BoxGeometry(3.9, 0.22, 3.5), matStone, 0, 0.28, 0);
    put(new THREE.BoxGeometry(3.3, 0.20, 2.9), matStone, 0, 0.49, 0);

    // four slender timber posts
    const postGeo = new THREE.BoxGeometry(0.15, 2.35, 0.15);
    for (const sx of [-1.32, 1.32]) for (const sz of [-1.16, 1.16]) put(postGeo, matTimber, sx, 1.76, sz);

    // beams
    put(new THREE.BoxGeometry(3.1, 0.13, 0.13), matTimber, 0, 2.93, -1.16);
    put(new THREE.BoxGeometry(3.1, 0.13, 0.13), matTimber, 0, 2.93, 1.16);
    put(new THREE.BoxGeometry(0.12, 0.12, 2.6), matTimber, -1.32, 2.93, 0);
    put(new THREE.BoxGeometry(0.12, 0.12, 2.6), matTimber, 1.32, 2.93, 0);
    put(new THREE.BoxGeometry(0.14, 0.14, 2.7), matTimber, 0, 3.68, 0);   // ridge

    // pitched roof — two slabs
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.10, 1.62), roofMat);
      slab.position.set(0, 3.32, s * 0.76);
      slab.rotation.x = -s * 0.46;
      slab.castShadow = preset.shadows; slab.receiveShadow = preset.shadows;
      g.add(slab);
    }

    // offering ledge
    put(new THREE.BoxGeometry(1.5, 0.13, 0.46), matStone, 0, 1.10, -1.02);
    put(new THREE.BoxGeometry(0.22, 0.52, 0.30), matStone, -0.5, 0.83, -1.02);
    put(new THREE.BoxGeometry(0.22, 0.52, 0.30), matStone, 0.5, 0.83, -1.02);

    // ── bell, hung from the ridge ──
    const bellLocalY = anchors.bell.y - gy;             // ~1.60 above local ground
    bellPivot.position.set(anchors.bell.x - cx, bellLocalY + 0.72, anchors.bell.z - cz);
    g.add(bellPivot);

    const hangMat = new THREE.MeshStandardMaterial({ color: 0x2c2418, roughness: 0.85 });
    const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.30, 6), hangMat);
    hang.position.y = 0.16;
    bellPivot.add(hang);

    // bronze bell profile
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const y = -0.90 * (1 - t);
      const r = 0.34 * Math.pow(1 - t, 0.42) + 0.035;
      pts.push(new THREE.Vector2(Math.max(0.02, r), y));
    }
    pts.push(new THREE.Vector2(0.06, 0.06));
    pts.push(new THREE.Vector2(0.055, 0.14));
    const bellGeo = new THREE.LatheGeometry(pts, 28);
    bellMat = new THREE.MeshStandardMaterial({
      color: 0x7a5a30, roughness: 0.38, metalness: 0.85,
      emissive: new THREE.Color(0xffa860), emissiveIntensity: 0.0,
    });
    const bellMesh = new THREE.Mesh(bellGeo, bellMat);
    bellMesh.castShadow = preset.shadows;
    bell.add(bellMesh);
    // a raised band near the lip
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.018, 6, 24), bellMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.78;
    bell.add(band);
    bell.position.y = -0.28;
    bellPivot.add(bell);

    // striker beam on ropes
    strikerPivot.position.set(anchors.bell.x - cx, bellLocalY + 0.62, anchors.bell.z - cz + 0.80);
    g.add(strikerPivot);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5b4a34, roughness: 1.0 });
    for (const s of [-1, 1]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.86, 5), ropeMat);
      rope.position.set(s * 0.16, -0.43, 0);
      strikerPivot.add(rope);
    }
    const striker = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.62, 8), matTimber);
    striker.rotation.z = Math.PI / 2;
    striker.rotation.y = Math.PI / 2;
    striker.position.set(0, -0.86, 0);
    striker.castShadow = preset.shadows;
    strikerPivot.add(striker);

    root.add(g);
  }
  buildShrine();

  /* ── distant ridges ────────────────────────────────────────────────────── */

  const ridgeMats = [];

  function buildRidges() {
    const LAYERS = [
      { r: 300, h: 62, base: -80, foot: -6, seed: 3.1, freq: 3.4, col: 0x505c80, mid: 0x424d70, top: 0x1e2740 },
      { r: 620, h: 132, base: -150, foot: -8, seed: 8.7, freq: 2.6, col: 0x5a6489, mid: 0x4c5678, top: 0x2a3350 },
      { r: 1050, h: 232, base: -250, foot: -10, seed: 15.2, freq: 2.0, col: 0x656e94, mid: 0x596283, top: 0x394261 },
      { r: 1600, h: 378, base: -380, foot: -12, seed: 22.9, freq: 1.5, col: 0x6f77a0, mid: 0x656d90, top: 0x4a5271 },
    ];
    const layers = ctx.quality === 'low' ? LAYERS.slice(1) : LAYERS;
    const segs = ctx.quality === 'low' ? 120 : 220;

    for (const L of layers) {
      // three rings: a hazy foot that dissolves into the cloud sea, then rock
      const RN = 3;
      const pos = new Float32Array((segs + 1) * RN * 3);
      const col = new Float32Array((segs + 1) * RN * 3);
      const idx = new Uint32Array(segs * (RN - 1) * 6);
      const cBase = new THREE.Color(L.col), cMid = new THREE.Color(L.mid), cTop = new THREE.Color(L.top);
      const cols = [cBase, cMid, cTop];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        let n = 0, amp = 0.55, f = L.freq;
        for (let o = 0; o < 4; o++) {
          n += amp * (1 - Math.abs(_perlin.noise(ca * f + L.seed, sa * f + L.seed * 1.7, L.seed)) * 2.2);
          amp *= 0.48; f *= 2.13;
        }
        const top = L.h * (0.42 + 0.72 * clamp(n * 0.5 + 0.5, 0, 1));
        const ys = [L.base, L.foot, top];
        for (let r = 0; r < RN; r++) {
          const k = (i * RN + r) * 3;
          pos[k] = ca * L.r; pos[k + 1] = ys[r]; pos[k + 2] = sa * L.r;
          col[k] = cols[r].r; col[k + 1] = cols[r].g; col[k + 2] = cols[r].b;
        }
      }
      let k = 0;
      for (let i = 0; i < segs; i++) {
        for (let r = 0; r < RN - 1; r++) {
          const a = i * RN + r, b = a + 1, c = a + RN, d = c + 1;
          idx[k++] = a; idx[k++] = b; idx[k++] = c;
          idx[k++] = b; idx[k++] = d; idx[k++] = c;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -60;
      root.add(mesh);
      ridgeMats.push({ mat, r: L.r });
    }
  }
  buildRidges();

  /* ── public API ────────────────────────────────────────────────────────── */

  const _tintNight = new THREE.Color(0x8f9ec4);
  const _tintDawn = new THREE.Color(0xffd8bc);
  const _tmpColor = new THREE.Color();
  const _sc = new THREE.Vector3();

  function setLanternLit(on) { lanternState.target = on ? 1 : 0; }
  function setPathGlow(v) { pathGlow.target = clamp(v, 0, 1); }
  function setOrbBreath(scale01, glow01) {
    orbState.scale = clamp(scale01 || 0, 0, 1);
    orbState.glow = clamp(glow01 || 0, 0, 1);
  }
  function setOrbActive(on) { orbState.target = on ? 1 : 0; }
  function strikeBell(force01) {
    const f = clamp(force01 == null ? 1 : force01, 0, 1);
    bellSwing.amp = Math.max(bellSwing.amp, 0.055 + 0.13 * f);
    bellSwing.t = 0;
    bellSwing.glow = Math.max(bellSwing.glow, 0.5 + 0.9 * f);
  }

  const U_LANTERN = clamp((PATH_Z0 - anchors.lantern.z) / PATH_LEN, 0, 1);

  function update(dt, state) {
    time += dt;
    windUniforms.uTime.value = time;
    const wind = state ? clamp(state.windGust, 0, 1.2) : 0.4;
    windUniforms.uWind.value = 0.25 + 0.75 * wind;

    /* path glow — sweeps forward from the lantern over ~3s */
    const rate = dt / 2.6;
    pathGlow.raw += clamp(pathGlow.target - pathGlow.raw, -rate * 1.6, rate);
    const e = smootherstep(pathGlow.raw);
    if (stoneUniforms) {
      stoneUniforms.uFront.value = U_LANTERN - 0.04 + (1.12 - U_LANTERN) * e;
      stoneUniforms.uStrength.value = smoothstep(0.0, 0.14, pathGlow.raw) * (0.55 + 0.45 * e)
        * (0.9 + 0.1 * Math.sin(time * 0.9)) * 0.52;
    }

    /* lantern */
    lanternState.lit += clamp(lanternState.target - lanternState.lit, -dt * 0.9, dt * 0.55);
    const flick = 0.86 + 0.10 * Math.sin(time * 2.7) + 0.06 * Math.sin(time * 5.9 + 1.3)
      + 0.04 * Math.sin(time * 11.3 + 2.9);
    if (paperMat) paperMat.emissiveIntensity = lanternState.lit * 1.5 * flick;
    if (flameMat) flameMat.opacity = lanternState.lit * 0.85 * flick;
    if (flameGroup) {
      const s = lanternState.lit * (0.92 + 0.14 * Math.sin(time * 4.1 + 0.7));
      flameGroup.scale.set(s, s * (0.9 + 0.2 * Math.sin(time * 6.3)), s);
      flameGroup.rotation.y = Math.sin(time * 0.8) * 0.25;
    }

    /* orb */
    orbState.active += clamp(orbState.target - orbState.active, -dt * 0.7, dt * 0.7);
    const act = smootherstep(orbState.active);
    const bob = Math.sin(time * 0.62) * 0.07 + Math.sin(time * 0.31 + 1.2) * 0.04;
    orb.position.set(anchors.orb.x + Math.sin(time * 0.23) * 0.05, anchors.orb.y + bob, anchors.orb.z);
    orb.rotation.y = time * 0.14;
    const breath = 0.85 + 0.50 * orbState.scale;
    const s = breath * (0.72 + 0.28 * act);
    _sc.set(s, s, s);
    orbShell.scale.copy(_sc);
    orbCore.scale.setScalar(s * (0.9 + 0.2 * orbState.glow));
    const glow = (0.18 + 0.82 * orbState.glow) * (0.10 + 0.90 * act);
    orbShellMat.uniforms.uGlow.value = glow;
    orbShellMat.uniforms.uTime.value = time;
    orbCoreMat.color.setRGB(0.24 + 1.5 * glow, 0.20 + 1.24 * glow, 0.16 + 0.92 * glow);
    orbHalo.scale.setScalar(1.15 + 1.35 * glow * s);
    orbHaloMat.opacity = 0.16 + 0.62 * glow;

    /* bell */
    if (bellSwing.amp > 0.0001) {
      bellSwing.t += dt;
      const decay = Math.exp(-bellSwing.t / 1.55);
      const a = bellSwing.amp * decay;
      bellPivot.rotation.z = Math.sin(bellSwing.t * 7.1) * a * 0.55;
      bellPivot.rotation.x = Math.sin(bellSwing.t * 6.4 + 0.6) * a * 0.35;
      strikerPivot.rotation.x = -Math.sin(bellSwing.t * 5.2) * a * 1.9;
      if (bellSwing.t > 6.2) { bellSwing.amp = 0; bellPivot.rotation.set(0, 0, 0); strikerPivot.rotation.set(0, 0, 0); }
    }
    bellSwing.glow = Math.max(0, bellSwing.glow - dt * 0.42);
    if (bellMat) bellMat.emissiveIntensity = bellSwing.glow * 0.55 + (state ? state.dawn * 0.10 : 0);

    /* distant ridges lift toward the dawn sky */
    const dawn = state ? clamp(state.dawn, 0, 1) : 0;
    for (let i = 0; i < ridgeMats.length; i++) {
      const rl = ridgeMats[i];
      const far = clamp((rl.r - 250) / 1400, 0, 1);
      _tmpColor.copy(_tintNight).lerp(_tintDawn, dawn * (0.35 + 0.65 * far));
      const b = (0.55 + 0.45 * dawn) * (0.85 + 0.3 * far);
      rl.mat.color.copy(_tmpColor).multiplyScalar(b);
    }
  }

  /* ── movement corridor ─────────────────────────────────────────────────── */

  function softLimit(v, limit) {
    // asymptotic ease-back instead of a hard wall
    const over = v - limit;
    return over <= 0 ? v : limit + over / (1 + over * 2.6);
  }

  function constrainPosition(v) {
    if (!v) return v;
    if (!Number.isFinite(v.x)) v.x = 0;
    if (!Number.isFinite(v.z)) v.z = 0;

    // longitudinal soft stops
    const zBack = PATH_Z0 + 1.0, zFront = PATH_Z1 - 0.7;
    if (v.z > zBack) v.z = zBack + (v.z - zBack) / (1 + (v.z - zBack) * 3.0);
    if (v.z < zFront) v.z = zFront - (zFront - v.z) / (1 + (zFront - v.z) * 3.0);

    const cx = pathCenterX(v.z);
    const half = corridorHalf(v.z);
    const dx = v.x - cx;
    const ad = Math.abs(dx);
    if (ad > half) v.x = cx + Math.sign(dx) * softLimit(ad, half);

    v.y = groundHeight(v.x, v.z);
    return v;
  }

  return {
    update,
    getGroundHeight: groundHeight,
    constrainPosition,
    anchors,
    lanternMount,
    orb,
    bell,
    setLanternLit,
    setPathGlow,
    setOrbBreath,
    setOrbActive,
    strikeBell,
  };
}
