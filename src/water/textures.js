/**
 * textures.js — the two generated images Still Water uses.
 *
 * A leaf: it imports three and nothing of ours, and every module that needs a
 * surface asks here rather than growing its own. There are no image files in
 * the repository and there is no reason for there to be.
 */

import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Seamless value-noise fBm, three independent fields in R, G and B.
 *
 * Every octave wraps on its own integer lattice, so the texture tiles no matter
 * how far it is scrolled or how hard it is scaled — which is what lets the mist
 * bands and the lake's ripple share one 256² image between them.
 *
 * The water reads R and G as a *vector* rather than a height: not the true
 * gradient of anything, but a smooth tiling 2D field, which is all a ripple
 * normal needs and costs one fetch per octave instead of three.
 */
export function noiseTexture(size, seed) {
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
  const fbm = (u, v, oct, f0, s) => {
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
      const a = fbm(u, v, 5, 3, seed);
      const b = fbm(u, v, 4, 5, seed + 4111);
      const c = fbm(u, v, 3, 2, seed + 9137);
      const i = (y * size + x) * 4;
      data[i] = clamp(a * 265, 0, 255);
      data[i + 1] = clamp(b * 265, 0, 255);
      data[i + 2] = clamp(c * 265, 0, 255);
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

/** A soft round falloff for the motes drifting over the water. */
export function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(226,236,250,1)');
  grad.addColorStop(0.28, 'rgba(196,214,238,0.45)');
  grad.addColorStop(0.68, 'rgba(160,182,214,0.08)');
  grad.addColorStop(1.0, 'rgba(140,164,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
