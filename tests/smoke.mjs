// Rauchtest: lädt index.html in Chromium (SwiftShader, Fake-Kamera), leitet CDN-Anfragen auf
// lokale npm-Pakete um, prüft Aufbau, Tracking-Mathematik, Zeige-Abbildung und Kamera-Start.
// Aufruf: node tests/smoke.mjs [ausgabeordner-für-screenshots]
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = resolve(process.argv[2] || 'tests/out');
mkdirSync(OUT, { recursive: true });
const NM = resolve('node_modules');
const ROUTES = [
  [/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/18\.3\.1\/umd\/(.+)$/, (m) => join(NM, 'react/umd', m[1])],
  [/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/18\.3\.1\/umd\/(.+)$/, (m) => join(NM, 'react-dom/umd', m[1])],
  [/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/(.+)$/, (m) => join(NM, 'three/build', m[1])],
  [/cdn\.jsdelivr\.net\/npm\/@mediapipe\/hands@[^/]+\/(.+)$/, (m) => join(NM, '@mediapipe/hands', m[1])],
];
const TYPES = { js: 'application/javascript', wasm: 'application/wasm', data: 'application/octet-stream', tflite: 'application/octet-stream', binarypb: 'application/octet-stream' };

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['camera'] });
await ctx.route(/^https:\/\//, async (route) => {
  const url = route.request().url();
  for (const [re, fn] of ROUTES) {
    const m = url.match(re);
    if (m) {
      const file = fn(m); const ext = file.split('.').pop();
      return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'access-control-allow-origin': '*' } });
    }
  }
  console.log('    (blockiert) ' + url);
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const t0 = Date.now();
await page.goto(pathToFileURL(resolve('index.html')).href);
await page.waitForFunction(() => window.__handAtlas && !document.querySelector('.ha-boot'), null, { timeout: 180000 });
console.log(`Engine bereit nach ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const stats = await page.evaluate(() => ({ ...window.__handAtlas.skinStats, meshes: window.__handAtlas.meshes.length, tubes: window.__handAtlas.tubes.length, markers: window.__handAtlas.markers.length }));
console.log('Modell:', JSON.stringify(stats));
ok(stats.verts > 5000 && stats.tris > 10000, 'Haut-Mesh erzeugt');

// Orientierung der Haut: Dreiecksnormalen zeigen nach aussen (gleiche Richtung wie Vertex-Normalen)
const orient = await page.evaluate(() => {
  const g = window.__handAtlas.skinMesh.geometry; const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
  let agree = 0, tot = 0;
  for (let t = 0; t < ix.length; t += 3 * 7) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const d = cr[0] * (n[a] + n[b] + n[c]) + cr[1] * (n[a + 1] + n[b + 1] + n[c + 1]) + cr[2] * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (Math.hypot(...cr) > 1e-9) { tot++; if (d > 0) agree++; }
  }
  // Röhren: gleiche Prüfung an einer Sehne
  const tg = window.__handAtlas.tubes.find((x) => x.def.id === 'fds2').tg.geo;
  const tp = tg.attributes.position.array, tn = tg.attributes.normal.array, ti = tg.index.array;
  let ta = 0, tt = 0;
  for (let t = 0; t < ti.length; t += 3) {
    const a = ti[t] * 3, b = ti[t + 1] * 3, c = ti[t + 2] * 3;
    const u = [tp[b] - tp[a], tp[b + 1] - tp[a + 1], tp[b + 2] - tp[a + 2]], v = [tp[c] - tp[a], tp[c + 1] - tp[a + 1], tp[c + 2] - tp[a + 2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...cr) < 1e-9) continue;
    tt++; if (cr[0] * tn[a] + cr[1] * tn[a + 1] + cr[2] * tn[a + 2] > 0) ta++;
  }
  return { skin: agree / tot, tube: ta / tt };
});
ok(orient.skin > 0.97, `Haut-Dreiecke nach aussen orientiert (${(orient.skin * 100).toFixed(1)} %)`);
ok(orient.tube > 0.97, `Röhren-Dreiecke nach aussen orientiert (${(orient.tube * 100).toFixed(1)} %)`);

// Tracking-Mathematik: synthetische Landmarken → Pose zurückgewinnen
const round = await page.evaluate(() => {
  const E = window.__handAtlas; const THREE = window.THREE; const D = Math.PI / 180;
  const cases = [];
  const poses = ['relaxed', 'fist', 'hook', 'open', 'point', 'pinch'];
  const orients = [[0, 0, 0], [0.3, 0.8, -0.2], [-0.6, 2.6, 0.4], [1.1, -0.5, 0.9]];
  for (const side of ['R', 'L']) for (const pn of poses) for (const o of orients) {
    const P = E.poseCache[pn];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...o));
    const wl = E.synthLandmarks(P, q, side);
    const r = E.poseFromLandmarks(wl, side);
    let maxF = 0;
    for (let f = 0; f < 4; f++) for (const i of [0, 2, 3]) maxF = Math.max(maxF, Math.abs(r.pose.f[f][i] - P.f[f][i]));
    const maxT = Math.max(Math.abs(r.pose.t[0] - P.t[0]), Math.abs(r.pose.t[1] - P.t[1]));
    const qa = 2 * Math.acos(Math.min(1, Math.abs(r.q.dot(q))));
    const pd = new THREE.Vector3(0, 1, 0).applyQuaternion(P.tq), rd = new THREE.Vector3(0, 1, 0).applyQuaternion(r.pose.tq);
    cases.push({ side, pn, o: o.join(','), fingerErr: maxF / D, thumbErr: maxT / D, rotErr: qa / D, thumbDirErr: pd.angleTo(rd) / D });
  }
  return cases;
});
const worst = (k) => round.reduce((a, c) => Math.max(a, c[k]), 0);
console.log(`Tracking-Rundreise: max Fingerfehler ${worst('fingerErr').toFixed(2)}°, Daumen ${worst('thumbErr').toFixed(2)}°, Daumenrichtung ${worst('thumbDirErr').toFixed(2)}°, Orientierung ${worst('rotErr').toFixed(2)}°`);
ok(worst('fingerErr') < 1.5, 'Fingerwinkel werden aus Landmarken korrekt zurückgewonnen');
ok(worst('thumbDirErr') < 1.5, 'Daumenrichtung wird korrekt zurückgewonnen');
ok(worst('rotErr') < 4, 'Handorientierung wird korrekt zurückgewonnen (inkl. linker Hand)');
ok(worst('thumbErr') < 12, 'Daumenbeugung plausibel zurückgewonnen');

// Daumen-IK: Pinzettengriff und Opposition erreichen die Fingerkuppen
const ik = await page.evaluate(() => {
  const E = window.__handAtlas; const errs = [E.solveThumb(1, E.clonePose(E.poseCache.pinch)).err];
  E.exCache.thumbOpposition.slice(0, 4).forEach((P, i) => errs.push(E.solveThumb(i + 1, E.clonePose(P)).err));
  E.applyPose(E.cur); E.poseDirty = true; return errs;
});
ok(Math.max(...ik) < 0.3, `Daumen erreicht die Fingerkuppen (max. ${Math.max(...ik).toFixed(2)} cm)`);

// Handfläche/Handrücken: Richtung der Handfläche relativ zur Kamera
const facing = await page.evaluate(() => {
  const E = window.__handAtlas; const THREE = window.THREE;
  const P = E.poseCache.open; const res = {};
  // Spiegelbild: Modell-Handfläche zeigt zum Betrachter (Palmaransicht) = Handfläche zur Kamera
  for (const side of ['R', 'L']) {
    res[side + '_viewer'] = E.poseFromLandmarks(E.synthLandmarks(P, new THREE.Quaternion(), side), side).facing;
    res[side + '_flip'] = E.poseFromLandmarks(E.synthLandmarks(P, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)), side), side).facing;
  }
  return res;
});
ok(facing.R_viewer === 'palm' && facing.R_flip === 'back' && facing.L_viewer === 'palm' && facing.L_flip === 'back', `Seitenerkennung Handfläche/Handrücken (Spiegelbild): ${JSON.stringify(facing)}`);

// Spiegelbild: linke Hand wird als rechtes Modell gezeigt, Handfläche zur Kamera → Modell zeigt Handfläche
const mirror = await page.evaluate(() => {
  const E = window.__handAtlas; const saveSide = E.side;
  E.setSide('L'); E.setMirrorView(true);
  const a = E.displaySide(), sx = E.handRoot.scale.x;
  E.setMirrorView(false);
  const b = E.displaySide();
  E.setSide(saveSide);
  return { mirrored: a, scale: sx, normal: b };
});
ok(mirror.mirrored === 'R' && mirror.scale === 1 && mirror.normal === 'L', `Spiegel-Modus zeigt die linke Hand als Spiegelbild (${JSON.stringify(mirror)})`);

// Neigung in der Bildebene: aus den 2D-Punkten übernehmen (MediaPipe richtet die 3D-Punkte intern auf)
const roll = await page.evaluate(() => {
  const E = window.__handAtlas; const THREE = window.THREE; const D = 180 / Math.PI;
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.4, 0.15));
  const wl = E.synthLandmarks(E.poseCache.relaxed, q0, 'R');
  const asp = 4 / 3;
  const lmOf = (a) => wl.map((p) => { const X = p.x * 2.2, Y = p.y * 2.2; return { x: 0.5 + (X * Math.cos(a) - Y * Math.sin(a)) / asp, y: 0.5 + (X * Math.sin(a) + Y * Math.cos(a)) }; });
  const same = E.poseFromLandmarks(wl, 'R', lmOf(0), asp).q;
  const rot = E.poseFromLandmarks(wl, 'R', lmOf(20 / D), asp).q;
  const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * D;
  const rel = rot.clone().multiply(same.clone().invert());
  const axis = new THREE.Vector3(rel.x, rel.y, rel.z).normalize();
  return { unchanged: ang(same, q0), rolled: ang(rot, same), axisZ: Math.abs(axis.z) };
});
ok(roll.unchanged < 0.5 && Math.abs(roll.rolled - 20) < 1 && roll.axisZ > 0.99, `Bildebenen-Neigung aus 2D übernommen (unverändert ${roll.unchanged.toFixed(2)}°, geneigt ${roll.rolled.toFixed(1)}° um Blickachse)`);

// Seitenerkennung: flackernde Labels dürfen die Modellseite nicht umschalten
const flicker = await page.evaluate(() => {
  const E = window.__handAtlas; const THREE = window.THREE;
  const wl = E.synthLandmarks(E.poseCache.open, new THREE.Quaternion(), 'R');
  const lm = wl.map((p) => ({ x: 0.5 + p.x * 2.2, y: 0.5 + p.y * 2.2, z: 0 }));
  const saveSide = E.side; E.setSide('R'); E.resetTracking();
  const res = (label) => ({ multiHandLandmarks: [lm], multiHandWorldLandmarks: [wl], multiHandedness: [{ label, score: 0.9 }] });
  const seq = []; for (let i = 0; i < 60; i++) seq.push(i % 10 < 7 ? 'Right' : 'Left');
  let switched = false;
  for (const l of seq) { E.ingestHands(res(l), { mode: 'mirror', swap: false, aspect: 4 / 3 }); if (E.side !== 'R') switched = true; }
  let framesToSwitch = -1;
  for (let i = 0; i < 40; i++) { E.ingestHands(res('Left'), { mode: 'mirror', swap: false, aspect: 4 / 3 }); if (E.side === 'L') { framesToSwitch = i + 1; break; } }
  E.setSide(saveSide); E.resetTracking();
  return { switched, framesToSwitch };
});
ok(!flicker.switched && flicker.framesToSwitch > 0 && flicker.framesToSwitch <= 30, `Seitenerkennung stabil bei Flackern, wechselt bei klarer Mehrheit nach ${flicker.framesToSwitch} Bildern`);

// Kontakt-Korrektur: Daumenwinkel absichtlich verfälscht, Kuppen berühren sich in den Landmarken → Modell schliesst den Griff
const contact = await page.evaluate(() => {
  const E = window.__handAtlas; const THREE = window.THREE;
  const P = E.poseCache.pinch;
  const wl = E.synthLandmarks(P, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.5, 0.1)), 'R');
  const r = E.poseFromLandmarks(wl, 'R');
  const bad = E.clonePose(r.pose);
  bad.t[0] -= 25 * Math.PI / 180; bad.t[1] -= 20 * Math.PI / 180;
  bad.tq.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0.2)));
  const gap = (pose) => {
    E.applyPose(pose); for (const n of E.nodeNames) E.N[n].updateMatrix();
    const L3 = 1.8, Lt2 = 2.4;
    return E.rigPoint('tp2', 0, Lt2 * 0.72, 0.55, new THREE.Vector3()).distanceTo(E.rigPoint('p3_1', 0, L3 * 0.72, 0.6, new THREE.Vector3()));
  };
  const before = gap(bad);
  const w = E.applyContact(bad, wl);
  const after = gap(bad);
  E.applyPose(E.cur); E.poseDirty = true;
  return { before, after, w };
});
ok(contact.w > 0.99 && contact.after < 0.3 && contact.before > 1, `Pinzettengriff wird geschlossen (Abstand ${contact.before.toFixed(2)} → ${contact.after.toFixed(2)} cm)`);

// Zeige-Abbildung: Zeigefinger der zweiten Hand auf Landmarken der Modellhand
const ptr = await page.evaluate(() => {
  const E = window.__handAtlas; const THREE = window.THREE;
  const out = {};
  for (const [name, rot] of [['palm', [0, 0, 0]], ['back', [0, Math.PI, 0]]]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
    const wl = E.synthLandmarks(E.poseCache.open, q, 'R');
    const lm = wl.map((p) => ({ x: 0.5 + p.x * 2.2, y: 0.5 + p.y * 2.2 }));
    const facing = E.poseFromLandmarks(wl, 'R').facing;
    const test = (tip) => { const h = E.mapPointer(lm, tip, 1, facing === 'palm'); return h ? E.nearestRegionRig(h.n, h.loc) : null; };
    const mid = (a, b, t = 0.5) => ({ x: lm[a].x + (lm[b].x - lm[a].x) * t, y: lm[a].y + (lm[b].y - lm[a].y) * t });
    out[name] = { facing, pip2: test(lm[10]), tip1: test(mid(7, 8, 0.8)), palm: test(mid(0, 9, 0.62)), mcpBase3: test(mid(13, 14, 0.12)), wrist: test(mid(0, 9, -0.12)), thumbTip: test(mid(3, 4, 0.8)) };
  }
  return out;
});
console.log('Zeige-Abbildung:', JSON.stringify(ptr));
ok(ptr.palm.pip2 === 'pip_2' && ptr.back.pip2 === 'pip_2', 'Zeigen aufs Mittelgelenk des Mittelfingers → pip_2');
ok(ptr.palm.tip1 === 'tip_1', 'Zeigen auf die Zeigefingerkuppe → tip_1');
ok(ptr.palm.palm === 'palm_center' && ptr.back.palm === 'back_of_hand', 'Handmitte: Handfläche bzw. Handrücken je nach Seite');
ok(ptr.palm.wrist === 'wrist_palm' && ptr.back.wrist === 'wrist_back', 'Handgelenk: Beuge- bzw. Streckseite je nach Seite');
ok(ptr.palm.thumbTip === 'tip_0', 'Zeigen auf die Daumenkuppe → tip_0');

// Screenshots verschiedener Zustände
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, name + '.png') }); };
const setPeel = async (v) => { await page.fill('#ha-peel', String(v)); await page.dispatchEvent('#ha-peel', 'input'); };
await shot('01-start');
await setPeel(0); await shot('02-haut');
await setPeel(1.4); await shot('03-nerven');
await setPeel(3.3); await shot('04-muskeln');
await setPeel(4.6); await shot('05-knochen');
await setPeel(2.2);
await page.getByRole('button', { name: 'Handrücken', exact: true }).click(); await shot('06-ruecken');
await page.getByRole('button', { name: 'Daumenseite', exact: true }).click(); await shot('07-daumenseite');
await page.getByRole('button', { name: 'Handfläche', exact: true }).click();
await page.getByRole('button', { name: 'Faust', exact: true }).click(); await page.waitForTimeout(900); await shot('08-faust');
await page.getByRole('button', { name: 'Pinzettengriff', exact: true }).click(); await page.waitForTimeout(900); await shot('09-pinzette');
await page.getByRole('button', { name: 'Entspannt', exact: true }).click();
await page.selectOption('#ha-region', 'fbase_3'); await page.waitForTimeout(300); await shot('10-ringband');
await page.getByRole('button', { name: 'Links', exact: true }).click(); await shot('11-links');
await page.getByRole('button', { name: 'EN', exact: true }).click(); await shot('12-english');
const enTitle = await page.textContent('.ha-side h2');
ok(/Base of a finger/.test(enTitle), `Englische Oberfläche aktiv ("${enTitle}")`);
await page.getByRole('button', { name: 'DE', exact: true }).click();
await page.getByRole('button', { name: 'Rechts', exact: true }).click();

// Klick auf einen Marker wählt die Region
const mk = await page.evaluate(() => { const m = window.__handAtlas.markers.find((x) => x.rid === 'tip_1' && x.vis); return m ? { x: m.sx, y: m.sy } : null; });
if (mk) {
  const box = await page.locator('.ha-host').boundingBox();
  await page.mouse.click(box.x + mk.x, box.y + mk.y);
  await page.waitForTimeout(300);
  const title = await page.textContent('.ha-side h2');
  ok(/Fingerkuppe/.test(title), `Klick auf Marker öffnet Region ("${title}")`);
} else ok(false, 'Marker tip_1 sichtbar');

// Übung abspielen
await page.getByRole('button', { name: /Sehnengleiten/ }).first().click();
await page.waitForTimeout(3500); await shot('13-uebung');
const exText = await page.textContent('.ha-posebar');
ok(/Schritt/.test(exText), 'Übung läuft mit Schrittanzeige');
await page.getByRole('button', { name: 'Stopp', exact: true }).first().click();

// Kamera (Fake-Gerät) + MediaPipe aus lokalen Paketen
await page.getByRole('button', { name: 'Webcam starten' }).first().click();
await page.waitForSelector('.ha-camstatus', { timeout: 120000 });
await page.waitForFunction(() => (document.querySelector('.ha-camstatus')?.textContent || '').length > 3, null, { timeout: 120000 });
const camText = await page.textContent('.ha-camstatus');
ok(/Halte eine Hand/.test(camText), `Kamera + Handerkennung laufen ("${camText}")`);
await shot('14-kamera');
await page.getByRole('button', { name: 'Luft-Cursor' }).click(); await page.waitForTimeout(800);
ok(/Luft-Cursor/.test(await page.textContent('.ha-camstatus')), 'Luft-Cursor-Modus aktiv');
await page.getByRole('button', { name: 'Webcam stoppen' }).click();

// Handy-Breite: kein horizontales Scrollen
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(900);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 1, `Keine horizontale Überbreite auf dem Handy (${overflow}px)`);
await page.screenshot({ path: join(OUT, '15-mobile.png'), fullPage: true });

const realErrors = errors.filter((e) => !/favicon/i.test(e));
ok(realErrors.length === 0, 'Keine Konsolenfehler' + (realErrors.length ? ': ' + realErrors.slice(0, 5).join(' | ') : ''));
await browser.close();
console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
