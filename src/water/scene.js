/**
 * scene.js — the ground, and everything standing on it.
 * @see water/main.js MODULE CONTRACT
 *
 * A deliberately small place: a forest path about thirty-five metres long,
 * a shoreline, a stone to sit on, two wooded headlands and a far shore. The
 * lake reads as large because of what is behind it, not because any of it was
 * built — the mountains are four rings of silhouette and the far shore is a
 * band six metres high two hundred metres out.
 *
 * The height field is the contract with everything else. player.js walks on it,
 * lake.js subtracts it to get water depth, and the vegetation is scattered on
 * it, so it is a plain function of (x, z) rather than a mesh anyone queries.
 */

import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { ridgeHeight } from './mood.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

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

const _perlin = new ImprovedNoise();
function fbm(x, y, oct) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * _perlin.noise(x * f, y * f, 11.3);
    amp *= 0.5; f *= 2.04;
  }
  return v;
}

/* ── the shape of the place ───────────────────────────────────────────────── */

export const PATH_Z0 = 33.0;      // where the walk begins, up under the pines
export const SHORE_Z = -0.6;      // the waterline on the walk's own axis
export const STAND = { x: 0.10, z: -1.60 };
const STONE = { x: 0.10, z: -2.60, rx: 2.60, rz: 2.40, y: 0.46 };

/** The path's gentle S. It bends away and comes back, so the lake arrives. */
export function pathCenterX(z) {
  return 2.6 * Math.sin(((z - SHORE_Z) / 34) * 3.4);
}

function corridorHalf(z) {
  // narrow between the trees, opening into the clearing at the water
  return 5.0 - 1.9 * smoothstep(1.0, 9.0, z);
}

function bankProfile(z) {
  const u = clamp((z - SHORE_Z) / 33, 0, 1);
  return 0.28 + 5.0 * (u * u * (3 - 2 * u));
}

function lakeFloor(z) {
  const u = clamp((SHORE_Z - z) / 44, 0, 1);
  return -0.30 - 5.6 * (u * u * (3 - 2 * u));
}

/** Where the stands of trees are on the far shore. Uneven on purpose. */
const FAR_CLUMPS = [-134, -101, -72, -31, 8, 27, 66, 112, 147];

function lobe(x, z, cx, cz, rx, rz, h) {
  const a = (x - cx) / rx, b = (z - cz) / rz;
  const d = a * a + b * b;
  return d >= 1 ? 0 : h * Math.pow(1 - d, 1.55);
}

/**
 * The band the lake ends against, two hundred metres out.
 *
 * The wobble is the point. A shoreline that is purely a function of z is a
 * ruled line across the whole frame — the hardest edge in the picture and the
 * one thing that most says "flat geometry". Two incommensurate terms in x move
 * it back and forth by about eight metres, which at that distance is a coast
 * with bays in it rather than a drawn rule.
 */
function farShore(x, z) {
  const wob = Math.sin(x * 0.031 + 1.7) * 5.5 + Math.sin(x * 0.083 + 4.1) * 2.6;
  return -0.35 + 7.0 * smoothstep(-198 + wob, -238 + wob, z);
}

export function groundHeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;

  // bank and lake bed, blended through each other so the shoreline is a curve
  // rather than a seam — the crossing through zero is the waterline. The same
  // wobble the far shore gets, at a metre's scale: the near waterline was a
  // clean diagonal against the water and read as cut paper.
  const wob = Math.sin(x * 0.19 + 0.7) * 0.55 + Math.sin(x * 0.47 + 2.9) * 0.28;
  const k = smoothstep(SHORE_Z - 1.6 + wob, SHORE_Z + 1.6 + wob, z);
  let y = lerp(lakeFloor(z), bankProfile(z), k);
  y = Math.max(y, farShore(x, z));

  // the two wooded headlands that frame the view
  y += lobe(x, z, -46, -30, 26, 54, 6.0);
  y += lobe(x, z, 52, -24, 23, 48, 5.2);

  const dx = Math.abs(x - pathCenterX(z));
  const onLand = smoothstep(-1.0, 6.0, z);

  // the walk's own hollow, and the ground rising on both sides of it
  y -= 0.45 * Math.exp(-((dx / 3.0) ** 2)) * onLand;
  y += smoothstep(4.0, 12.5, dx) * 3.2 * onLand;

  // surface detail, kept off the corridor so the walk is not a stumble
  const rough = 1.45 * smoothstep(-1.2, 1.6, y) * (0.30 + 0.70 * smoothstep(2.5, 8.0, dx));
  y += fbm(x * 0.045, z * 0.045, 4) * rough;
  y += fbm(x * 0.19, z * 0.19, 2) * 0.16 * smoothstep(-0.6, 0.8, y);

  // the stone, last, so nothing roughens it
  const sx = (x - STONE.x) / STONE.rx, sz = (z - STONE.z) / STONE.rz;
  const sd = sx * sx + sz * sz;
  if (sd < 1) {
    const top = STONE.y - 0.055 * sd - 0.02 * Math.sin(x * 2.1 + z * 1.7);
    if (top > y) y = top;
  }
  return y;
}

/* ── module ───────────────────────────────────────────────────────────────── */

export function createScene(scene, ctx) {
  const preset = ctx.preset;
  const PALETTE = ctx.mood.palette;
  const RIDGES = ctx.mood.ridges;
  const curves = ctx.mood.curves;
  const root = new THREE.Group();
  root.name = 'shore';
  scene.add(root);

  const rnd = mulberry32(20260808);
  let time = 0;

  const anchors = {
    start: new THREE.Vector3(pathCenterX(PATH_Z0), groundHeight(pathCenterX(PATH_Z0), PATH_Z0), PATH_Z0),
    stand: new THREE.Vector3(STAND.x, groundHeight(STAND.x, STAND.z), STAND.z),
    // Where the walk is going, in the sense the player needs: the opening
    // between the trees with the moon behind it.
    lake: new THREE.Vector3(-3.0, 1.2, -46.0),
    // The authored composition. Ninety metres out on the moon's own azimuth,
    // a degree and a half above the eye: the horizon lands just above the
    // middle of the frame and the moon sits in the upper third of it.
    compose: new THREE.Vector3(-10.9, 4.40, -90.9),
    // The centre of the breathing ripple. Not chosen for its own sake: this is
    // where the moon's mirror image lands for an eye 2.08 m above the water,
    // so the ring opens out of the reflection rather than next to it.
    ripple: new THREE.Vector3(-0.90, 0.0, -9.50),
  };

  /* ── wind ───────────────────────────────────────────────────────────────── */

  const windUniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  const WIND_DIR = [0.74, 0.67];

  function addSway(material, strength, exponent, tall, base) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime;
      shader.uniforms.uWind = windUniforms.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uWind;
          ${base ? 'varying float vSwayT;' : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 swW = instanceMatrix[3].xyz;
          #else
            vec3 swW = vec3(0.0);
          #endif
          float swPh = (swW.x * ${WIND_DIR[0].toFixed(2)} + swW.z * ${WIND_DIR[1].toFixed(2)}) * 0.38;
          float swH = clamp(transformed.y / ${tall.toFixed(2)}, 0.0, 1.0);
          float swA = (0.16 + 0.84 * uWind) * pow(swH, ${exponent.toFixed(2)}) * ${strength.toFixed(3)};
          float swG = sin(uTime * 0.71 - swPh) * 0.74 + sin(uTime * 1.43 - swPh * 1.27 + 0.7) * 0.26;
          transformed.x += (0.38 + 0.62 * swG) * swA * ${WIND_DIR[0].toFixed(2)};
          transformed.z += (0.38 + 0.62 * swG) * swA * ${WIND_DIR[1].toFixed(2)};
          ${base ? 'vSwayT = uv.y;' : ''}
        `);
      if (base) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            varying float vSwayT;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb *= mix(${(1 - base).toFixed(3)}, 1.0, smoothstep(0.0, 0.45, vSwayT));`);
      }
    };
    material.customProgramCacheKey = () => 'wsway' + strength + exponent + tall + (base || 0);
  }

  /* ── geometry helpers ───────────────────────────────────────────────────── */

  function mergeGeos(list) {
    let nv = 0, ni = 0;
    for (const g of list) {
      nv += g.attributes.position.count;
      ni += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      pos.set(p.array, vo * 3);
      if (n) nor.set(n.array, vo * 3);
      if (u) uv.set(u.array, vo * 2);
      if (g.index) {
        for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
      } else {
        for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
      }
      vo += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  /* ── terrain ────────────────────────────────────────────────────────────── */

  const SEG = preset.terrainSeg;
  const HALF_X = 165, Z_NEAR = 40, Z_FAR = -262;

  function buildTerrain() {
    const n = SEG, np = n + 1;
    const pos = new Float32Array(np * np * 3);
    const col = new Float32Array(np * np * 3);
    const idx = new Uint32Array(n * n * 6);

    // both axes warped toward the shore, which is where the triangles are worth
    // spending: the far half of this mesh is a silhouette under mist
    const cx = new Float32Array(np), cz = new Float32Array(np);
    for (let i = 0; i < np; i++) {
      const t = (i / n) * 2 - 1;
      cx[i] = Math.sign(t) * Math.pow(Math.abs(t), 1.75) * HALF_X;
      const u = i / n;
      cz[i] = Z_NEAR - (Math.exp(u * 2.9) - 1) / (Math.exp(2.9) - 1) * (Z_NEAR - Z_FAR);
    }

    const cRock = new THREE.Color(PALETTE.rock);
    const cSoil = new THREE.Color(PALETTE.soil);
    const cWet = new THREE.Color(PALETTE.wet);
    const c = new THREE.Color();

    let p = 0;
    for (let j = 0; j < np; j++) {
      const z = cz[j];
      for (let i = 0; i < np; i++) {
        const x = cx[i];
        const y = groundHeight(x, z);
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
        // wet stone at the waterline, dry soil above it, bare rock high up
        c.copy(cSoil).lerp(cRock, smoothstep(1.2, 5.5, y));
        c.lerp(cWet, smoothstep(0.55, -0.35, y));
        // Broad mottling, and plenty of it, at three scales. A smooth ramp at
        // these values reads as a snowfield however dark it is — what says
        // "ground" is that no two square metres of it are the same. The third
        // octave is the one the eye notices underfoot, where the terrain grid
        // is fine enough to carry it.
        c.multiplyScalar(0.60 + 0.78 * (fbm(x * 0.08, z * 0.08, 3) + 0.5));
        c.multiplyScalar(0.86 + 0.28 * (fbm(x * 0.34, z * 0.34, 2) + 0.5));
        c.multiplyScalar(0.90 + 0.20 * (fbm(x * 1.15, z * 1.15, 2) + 0.5));
        // damp ground gathers in the hollows and reads darker than the rises
        c.multiplyScalar(1.0 - 0.22 * smoothstep(0.55, -0.15, y - bankProfile(z) * 0.6));
        col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b;
        p += 3;
      }
    }

    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // z *decreases* along j here — the grid marches away from the shore —
        // so the winding is the mirror of the one a increasing-z grid wants.
        // Get it backwards and every normal points at the lake bed: the mesh is
        // back-face culled, nothing lights, and the sky dome shows through where
        // the ground should be.
        const a = j * np + i, b = a + 1, d = a + np, e = d + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = d;
        idx[k++] = b; idx[k++] = e; idx[k++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0, flatShading: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = !!preset.shadows;
    mesh.frustumCulled = false;
    root.add(mesh);
  }
  buildTerrain();

  /* ── the stone, and the rocks around it ─────────────────────────────────── */

  function boulderGeometry(r, seed, flat) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position;
    const rr = mulberry32(seed);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 0.76 + rr() * 0.44;
      p.setXYZ(i, x * d, y * d * (flat ? 0.34 : 0.82), z * d);
    }
    g.computeVertexNormals();
    return g;
  }

  // Not chalk. A shore stone at night is damp, and damp stone keeps a narrow
  // moon edge on it — that highlight is most of what says "stone" rather than
  // "pale polygon" at this light level.
  const matRock = new THREE.MeshStandardMaterial({
    color: PALETTE.rock, roughness: 0.78, metalness: 0.0,
  });

  function buildStone() {
    const g = boulderGeometry(2.7, 771, true);
    g.scale(1.0, 1.0, 0.92);
    const m = new THREE.Mesh(g, matRock);
    m.position.set(STONE.x, STONE.y - 0.55, STONE.z);
    m.rotation.y = 0.4;
    m.castShadow = !!preset.shadows;
    m.receiveShadow = !!preset.shadows;
    root.add(m);
  }
  buildStone();

  function buildRocks() {
    const n = preset.rocks;
    const geo = boulderGeometry(1.0, 4409, false);
    const mesh = new THREE.InstancedMesh(geo, matRock, n);
    mesh.castShadow = !!preset.shadows;
    mesh.receiveShadow = !!preset.shadows;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), s = new THREE.Vector3();
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 40) {
      // a shoreline scatter, plus a few standing in the shallows
      const wet = rnd() < 0.35;
      const z = wet ? SHORE_Z - rnd() * 9 : SHORE_Z + rnd() * 16 - 2;
      const x = pathCenterX(z) + (rnd() - 0.5) * (wet ? 26 : 34);
      const y = groundHeight(x, z);
      if (y < -1.1 || y > 4.2) continue;
      // never in the way of the walk, and never on the stone
      const dx = Math.abs(x - pathCenterX(z));
      if (dx < 2.6 && z > SHORE_Z) continue;
      if (Math.hypot(x - STONE.x, z - STONE.z) < 3.6) continue;
      // Wider spread on every axis, and each one bedded into the ground by its
      // own amount — a scatter of stones that all sit the same way in the soil
      // reads as a scatter of props.
      const sc = 0.26 + Math.pow(rnd(), 2.1) * 1.8;
      s.set(sc * (0.72 + rnd() * 0.68), sc * (0.42 + rnd() * 0.62), sc * (0.72 + rnd() * 0.68));
      e.set((rnd() - 0.5) * 0.9, rnd() * 6.28, (rnd() - 0.5) * 0.9);
      q.setFromEuler(e);
      v.set(x, y - sc * (0.16 + rnd() * 0.26), z);
      m.compose(v, q, s);
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }
  buildRocks();

  /* ── pines ──────────────────────────────────────────────────────────────── */

  function pineGeometry(detail) {
    const segs = detail > 0.7 ? 9 : detail > 0.5 ? 7 : 5;
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.055, 0.11, 1.5, 5, 1);
    trunk.translate(0, 0.75, 0);
    parts.push(trunk);
    // three stacked shells, each narrower and shorter than the one below
    const tiers = [
      { y: 0.85, r: 1.16, h: 2.5 },
      { y: 2.45, r: 0.86, h: 2.2 },
      { y: 3.90, r: 0.52, h: 1.9 },
    ];
    for (let t = 0; t < tiers.length; t++) {
      const T = tiers[t];
      const cone = new THREE.ConeGeometry(T.r, T.h, segs, 1, true);
      const p = cone.attributes.position;
      const rr = mulberry32(900 + t * 31);
      for (let i = 0; i < p.count; i++) {
        // ragged: a pine silhouette is never a clean cone
        const d = 0.82 + rr() * 0.42;
        p.setX(i, p.getX(i) * d);
        p.setZ(i, p.getZ(i) * d);
      }
      cone.computeVertexNormals();
      cone.translate(0, T.y + T.h * 0.5, 0);
      parts.push(cone);
    }
    return mergeGeos(parts);
  }

  const matPine = new THREE.MeshStandardMaterial({
    color: PALETTE.pine, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
  });
  addSway(matPine, 0.10, 2.0, 5.8);

  function buildPines() {
    const n = preset.pines;
    const geo = pineGeometry(preset.treeDetail);
    const mesh = new THREE.InstancedMesh(geo, matPine, n);
    mesh.castShadow = !!preset.shadows;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), s = new THREE.Vector3();
    let placed = 0, guard = 0;

    while (placed < n && guard++ < n * 60) {
      const r = rnd();
      let x, z;
      if (r < 0.34) {
        // the approach: both banks, never in the corridor
        z = SHORE_Z + 1 + rnd() * 38;
        const side = rnd() < 0.5 ? -1 : 1;
        x = pathCenterX(z) + side * (5.2 + Math.pow(rnd(), 0.7) * 26);
      } else if (r < 0.72) {
        // the headlands that frame the water
        const left = rnd() < 0.5;
        x = (left ? -46 : 52) + (rnd() - 0.5) * (left ? 46 : 40);
        z = (left ? -30 : -24) + (rnd() - 0.5) * (left ? 96 : 86);
      } else {
        // The far shore. Sown evenly it reads as a picket fence two hundred
        // metres long; trees grow in stands, so these go in stands, and the
        // gaps between them are what make the shoreline a place.
        const cx0 = FAR_CLUMPS[(rnd() * FAR_CLUMPS.length) | 0];
        z = -200 - rnd() * 34;
        x = cx0 + (rnd() - 0.5) * 42;
      }
      const y = groundHeight(x, z);
      if (y < 0.55) continue;
      const dx = Math.abs(x - pathCenterX(z));
      if (z > SHORE_Z && z < 40 && dx < 4.6) continue;
      if (Math.hypot(x - STONE.x, z - STONE.z) < 7) continue;

      // A stand of pines is not a row of one pine. Widening the scale range and
      // letting them lean a little is the cheapest thing that breaks up an
      // instanced silhouette.
      const sc = 0.52 + Math.pow(rnd(), 1.9) * 2.2;
      s.set(sc * (0.76 + rnd() * 0.5), sc * (0.78 + rnd() * 0.62), sc * (0.76 + rnd() * 0.5));
      e.set((rnd() - 0.5) * 0.10, rnd() * 6.28, (rnd() - 0.5) * 0.10);
      q.setFromEuler(e);
      v.set(x, y - 0.12, z);
      m.compose(v, q, s);
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }
  buildPines();

  /* ── grass and reeds ────────────────────────────────────────────────────── */

  function bladeGeometry(h, w, segs) {
    const pos = new Float32Array((segs + 1) * 2 * 3);
    const uv = new Float32Array((segs + 1) * 2 * 2);
    const idx = new Uint32Array(segs * 6);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = t * h;
      const half = w * 0.5 * (1 - t * 0.92);
      const k = i * 6;
      pos[k] = -half; pos[k + 1] = y; pos[k + 2] = 0;
      pos[k + 3] = half; pos[k + 4] = y; pos[k + 5] = 0;
      const u = i * 4;
      uv[u] = 0; uv[u + 1] = t; uv[u + 2] = 1; uv[u + 3] = t;
    }
    let k = 0;
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }

  function buildGrass() {
    const n = preset.grass;
    if (n <= 0) return;

    const matGrass = new THREE.MeshStandardMaterial({
      color: PALETTE.grass, roughness: 0.9, metalness: 0.0,
      side: THREE.DoubleSide, vertexColors: true,
    });
    addSway(matGrass, 0.30, 1.7, 0.55, 0.45);

    const geo = bladeGeometry(0.55, 0.055, 3);
    const mesh = new THREE.InstancedMesh(geo, matGrass, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    const cA = new THREE.Color(PALETTE.grass), cB = new THREE.Color(PALETTE.reed);
    let placed = 0, guard = 0;

    while (placed < n && guard++ < n * 12) {
      // Same number of blades, spread wider. The bare pale wedge either side of
      // the walk was the most obviously untextured thing in the frame, and
      // covering it costs nothing that adding blades would have cost.
      const z = SHORE_Z - 5 + rnd() * 37;
      const x = pathCenterX(z) + (rnd() - 0.5) * 68;
      const y = groundHeight(x, z);
      if (y < -0.28 || y > 3.4) continue;
      if (Math.hypot(x - STONE.x, z - STONE.z) < 3.0) continue;
      // reeds stand taller where their feet are in the water
      const wet = y < 0.35;
      const sc = (wet ? 1.5 : 0.75) * (0.6 + rnd() * 0.9);
      s.set(0.8 + rnd() * 0.5, sc, 1);
      e.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.18);
      q.setFromEuler(e);
      v.set(x, y - 0.04, z);
      m.compose(v, q, s);
      mesh.setMatrixAt(placed, m);
      col.copy(cA).lerp(cB, wet ? 0.7 : rnd() * 0.4).multiplyScalar(0.7 + rnd() * 0.6);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }
  buildGrass();

  /* ── mountains ──────────────────────────────────────────────────────────────
   * Four rings, each one lower in contrast than the one in front of it and
   * each fading *up* into the horizon haze rather than down into black. Both
   * hours want that direction and for the same reason: the sky is brightest
   * where it meets the water, so distance costs contrast and gains value.
   * What the hour changes is only how much value there is to gain — at night
   * these are silhouettes, and by day they are snow behind fifteen hundred
   * metres of air.
   *
   * These are generated from the same profile the reflection panorama is baked
   * from (mood.ridgeHeight), which is why what stands on the horizon and what
   * lies in the water are the same mountains.
   * ────────────────────────────────────────────────────────────────────────── */

  // How far the skyline has dissolved into the air in front of it. The ridges
  // are the one thing in the frame that distance is the *whole* of — they have
  // no light on them and no material, only a value — so the atmosphere opening
  // has to be applied to them directly. Zero at night, where the air does not
  // visibly change and the vertex colours are the finished answer.
  const ridgeUniforms = {
    uRidgeHaze: { value: new THREE.Color(PALETTE.haze) },
    uRidgeMix: { value: 0 },
  };

  function buildRidges() {
    const layers = ctx.quality === 'low' ? [1, 2, 3] : [0, 1, 2, 3];
    const segs = ctx.quality === 'low' ? 150 : 260;

    for (const li of layers) {
      const L = RIDGES[li];
      const RN = 4;
      const pos = new Float32Array((segs + 1) * RN * 3);
      const col = new Float32Array((segs + 1) * RN * 3);
      const idx = new Uint32Array(segs * (RN - 1) * 6);
      const cFoot = new THREE.Color(L.foot);
      const cTop = new THREE.Color(L.top);
      const cHaze = new THREE.Color(L.haze);
      const cMid = cFoot.clone().lerp(cTop, 0.55);
      const cols = [cFoot, cMid, cTop, cHaze];

      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const top = ridgeHeight(li, a);
        const foot = -8 - li * 3;
        const ys = [foot - 40, foot, lerp(foot, top, 0.55), top];
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
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uRidgeHaze = ridgeUniforms.uRidgeHaze;
        shader.uniforms.uRidgeMix = ridgeUniforms.uRidgeMix;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform vec3 uRidgeHaze; uniform float uRidgeMix;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb = mix(diffuseColor.rgb, uRidgeHaze, uRidgeMix);`);
      };
      mat.customProgramCacheKey = () => 'wridge';
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -60;
      root.add(mesh);
    }
  }
  buildRidges();

  /* ── movement ───────────────────────────────────────────────────────────── */

  function softLimit(v, limit) {
    const over = v - limit;
    return over <= 0 ? v : limit + over / (1 + over * 2.6);
  }

  function constrainPosition(v) {
    if (!v) return v;
    if (!Number.isFinite(v.x)) v.x = 0;
    if (!Number.isFinite(v.z)) v.z = 0;

    const zBack = PATH_Z0 + 1.5;
    const zFront = STAND.z - 0.3;       // the water's edge; there is nowhere further
    if (v.z > zBack) v.z = zBack + (v.z - zBack) / (1 + (v.z - zBack) * 3.0);
    if (v.z < zFront) v.z = zFront - (zFront - v.z) / (1 + (zFront - v.z) * 3.4);

    const cx = pathCenterX(v.z);
    const half = corridorHalf(v.z);
    const dx = v.x - cx;
    const ad = Math.abs(dx);
    if (ad > half) v.x = cx + Math.sign(dx) * softLimit(ad, half);

    v.y = groundHeight(v.x, v.z);
    return v;
  }

  /* ── frame ──────────────────────────────────────────────────────────────── */

  function update(dt, state) {
    time += dt;
    const s = state ? clamp(state.settle, 0, 1) : 0;
    const gust = state ? clamp(state.windGust, 0, 1.2) : 0.5;
    windUniforms.uTime.value = time;
    // one wind for the shore, and the settle is most of what it is made of
    windUniforms.uWind.value = curves.wind(s) * (0.45 + 0.55 * gust);
    ridgeUniforms.uRidgeMix.value = curves.ridgeHaze(s);
  }

  return { update, getGroundHeight: groundHeight, constrainPosition, anchors };
}
