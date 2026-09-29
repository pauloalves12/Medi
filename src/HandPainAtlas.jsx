// Handschmerz-Atlas / Hand Pain Atlas — v1.0
// Single-File-React-Pilot nach App-Pilot-Protokoll.
// Three.js (r128) und MediaPipe Hands werden zur Laufzeit vom CDN geladen – keine weiteren Imports.
// Inhalte zweisprachig (de/en). Keine Diagnose – nur Orientierung.
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

// Keine Bild-Assets: Anatomie, Haut und Marker sind vollständig prozedural.
const ASSETS = {};

// ───────────────────────────── Design-Tokens ─────────────────────────────
// Register «Nachtvitrine»: tiefes Tinten-Navy, Violett als Leitfarbe (Referenz des Users),
// Anatomie-Farben nach Atlas-Konvention (Knochen elfenbein, Muskel karmin, Nerv safran).
const T = {
  bg: '#0d0f16',
  bgGlow: '#1a1830',
  panel: 'rgba(19, 21, 32, 0.9)',
  panelSolid: '#141624',
  line: 'rgba(160, 150, 210, 0.14)',
  lineStrong: 'rgba(160, 150, 210, 0.28)',
  text: '#e8e6f2',
  textDim: '#a7a3bd',
  textFaint: '#726e8c',
  accent: '#8b6cff',
  accentHi: '#b7a4ff',
  accentSoft: 'rgba(139, 108, 255, 0.16)',
  pain: '#ff6f61',
  track: '#62d6c6',
  warn: '#ffb35c',
  layer: {
    skin: '#d99474',
    fascia: '#cfcbee',
    nerves: '#f2c230',
    tendons: '#eee8da',
    muscles: '#c23d36',
    bones: '#eadfc4',
  },
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

// Materialfarben im 3D-Modell (linear gewählt, sRGB-Ausgabe)
const MATC = {
  skin: 0xd9957a, skinGhost: 0x9a6248,
  bone: 0xeee2c8, cartilage: 0xc9dbea,
  muscle: 0xb3322b, tendon: 0xf1ebdf, pulley: 0xd8dcf4, sheath: 0xc9d4f2,
  fascia: 0xe4e0fa, ligament: 0xe6eaf4,
  nerve: 0xf0bd2a, artery: 0xcf2f2a, vein: 0x3a5ec8,
  nail: 0xe9b3a4, edge: 0x9d80ff, hi: 0xa58cff,
};

// ───────────────────────────── Tuning (von Paulo justierbar) ─────────────────────────────
const TUNING = {
  dwellMs: 1200,            // so lange still zeigen, bis eine Stelle öffnet
  dwellCooldownMs: 1400,    // Pause nach einer Auswahl
  pointerMaxDist: 0.16,     // Zeigefinger ↔ Fingersegment, relativ zur Handflächenlänge im Bild
  wristBand: 0.34,          // halbe Breite des Handgelenk-Korridors (relativ)
  contactOn: 0.34,          // Daumen- zu Fingerkuppe / Handflächenlänge: Kontakt-Korrektur beginnt
  contactFull: 0.18,        // … wirkt voll
  pinchOn: 0.28,            // Daumen-Zeigefinger-Abstand / Handgrösse: Pinch beginnt
  pinchOff: 0.42,           // … endet (Hysterese)
  peelDragGain: 7,          // Schichten pro Bildhöhe beim Pinch-Ziehen
  angleSmoothing: 0.45,     // 0..1 – Anteil neuer Messung pro Frame (Gelenkwinkel)
  rotSmoothing: 0.32,       // 0..1 – Anteil neuer Messung pro Frame (Handorientierung)
  airGain: 1.45,            // Luft-Cursor: Verstärkung um die Bildmitte
  airSmoothing: 0.35,
  lostGraceMs: 700,         // Hand kurz verloren → Pose halten
  pickPx: 38,               // Klickradius um einen Marker (px)
  skinVoxel: 0.2,           // Auflösung der Haut (cm) – kleiner = feiner, langsamer
  poseEase: 7.5,            // Geschwindigkeit der Pose-Übergänge (1/s)
  exerciseHold: 1.7,        // Sekunden pro Übungsschritt (Halten)
  exerciseMove: 1.0,        // Sekunden pro Übergang
  camDist: 48, camMin: 20, camMax: 95,
};

const CDN = {
  three: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  hands: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/',
};

// ───────────────────────────── Storage-Kette ─────────────────────────────
const STORE_KEY = 'handatlas_state_v1';
const memStore = {};
const storage = {
  async get(k) {
    try { if (window.storage) { const r = await window.storage.get(k); return r ? r.value : null; } } catch (e) {}
    try { return localStorage.getItem(k); } catch (e) {}
    return memStore[k] ?? null;
  },
  async set(k, v) {
    try { if (window.storage) { await window.storage.set(k, v); return; } } catch (e) {}
    try { localStorage.setItem(k, v); return; } catch (e) {}
    memStore[k] = v;
  },
};
const INITIAL = {
  version: 1,
  lang: 'de',
  side: 'R',
  peel: 0.6,
  vis: [true, true, true, true, true, true],
  settings: { ghost: true, spots: true, swap: false, mode: 'mirror' },
  painMarks: {},     // regionId → Stärke 1..10
  explored: [],      // kumulativ: je erkundete Stelle einmal
};
function migrate(raw) {
  try {
    const g = JSON.parse(raw);
    if (!g || typeof g !== 'object') return { ...INITIAL };
    return {
      ...INITIAL, ...g,
      settings: { ...INITIAL.settings, ...(g.settings || {}) },
      vis: Array.isArray(g.vis) && g.vis.length === 6 ? g.vis : INITIAL.vis,
      painMarks: g.painMarks && typeof g.painMarks === 'object' ? g.painMarks : {},
      explored: Array.isArray(g.explored) ? g.explored : [],
    };
  } catch (e) { return { ...INITIAL }; }
}

// ───────────────────────────── Hilfen ─────────────────────────────
const L = (de, en) => ({ de, en });
const tr = (v, lang) => (v && typeof v === 'object' && !Array.isArray(v) ? (v[lang] ?? v.de) : v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

const scriptPromises = {};
function loadScript(src) {
  if (scriptPromises[src]) return scriptPromises[src];
  scriptPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => { delete scriptPromises[src]; reject(new Error('load ' + src)); };
    document.head.appendChild(s);
  });
  return scriptPromises[src];
}

// Lazy WebAudio – ein Kontext pro App, erst nach Nutzergeste
let audioCtx = null;
function chime() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [523.25, 783.99].forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.9);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 1);
    });
  } catch (e) {}
}
const haptic = (ms) => { try { navigator.vibrate?.(ms); } catch (e) {} };

// ───────────────────────────── UI-Texte ─────────────────────────────
const UI = {
  title: L('Handschmerz-Atlas', 'Hand Pain Atlas'),
  subtitle: L('Schichten abtragen. Klicken oder mit der Webcam zeigen, um herauszufinden, was schmerzen könnte.',
    'Peel back the layers. Click, or point with your webcam, to find what might be hurting.'),
  startCam: L('Webcam starten', 'Start webcam'),
  stopCam: L('Webcam stoppen', 'Stop webcam'),
  camLoading: L('Kamera startet …', 'Starting camera …'),
  layers: L('Schichten', 'Layers'),
  outerDeep: L('AUSSEN → TIEF', 'OUTER → DEEP'),
  peel: L('Abtragen', 'Peel'),
  ghostSkin: L('Hautumriss', 'Ghost skin outline'),
  painSpots: L('Schmerzpunkte', 'Pain spots'),
  stGhost: L('Umriss', 'ghost'),
  stPeeled: L('entfernt', 'peeled'),
  stHidden: L('aus', 'hidden'),
  views: { palm: L('Handfläche', 'Palm'), back: L('Handrücken', 'Back'), thumb: L('Daumenseite', 'Thumb side'), pinky: L('Kleinfingerseite', 'Pinky side') },
  hint: L('Ziehen zum Drehen · Scrollen zum Zoomen · Markierte Stelle anklicken', 'Drag to turn · Scroll to zoom · Click a marked spot'),
  hintTouch: L('Wischen zum Drehen · Zwei Finger zum Zoomen · Stelle antippen', 'Swipe to turn · Pinch to zoom · Tap a spot'),
  pose: L('POSE', 'POSE'),
  exercise: L('ÜBUNG', 'EXERCISE'),
  stop: L('Stopp', 'Stop'),
  under: L('UNTER DIESER STELLE', 'UNDER THIS SPOT'),
  causes: L('MÖGLICHE URSACHEN', 'POSSIBLE CAUSES'),
  helps: L('WAS MEIST HILFT', 'WHAT USUALLY HELPS'),
  doctor: L('ÄRZTLICH ABKLÄREN, WENN', 'GET IT CHECKED IF'),
  showMe: L('Zeig mir', 'Show me'),
  matches: L('passt zu deinen Angaben', 'matches what you feel'),
  feel: L('WAS SPÜRST DU?', 'WHAT DO YOU FEEL?'),
  myspot: L('Hier tut es mir weh', 'This is where it hurts'),
  intensity: L('Stärke', 'Intensity'),
  mySpots: L('Meine Stellen', 'My spots'),
  explored: L('erkundet', 'explored'),
  disclaimer: L('Nur zur Orientierung – ersetzt keine ärztliche Untersuchung. Bei starken, anhaltenden oder neuen Beschwerden bitte ärztlich abklären.',
    'For orientation only, not a diagnosis. Please see a doctor for severe, lasting or new symptoms.'),
  redflagsTitle: L('Sofort abklären lassen', 'Get help right away'),
  redflags: L('Finger kalt, weiss oder blau · Fehlstellung nach Unfall · rote, heisse Schwellung mit Fieber · Biss-, Stich- oder Schnittwunde über Gelenk oder Sehne · plötzliche Schwäche oder Taubheit',
    'A finger that is cold, white or blue · a deformity after an injury · red, hot swelling with fever · a bite, puncture or cut over a joint or tendon · sudden weakness or numbness'),
  mirror: L('Hand spiegeln', 'Mirror my hand'),
  air: L('Luft-Cursor', 'Air cursor'),
  swap: L('Links/rechts tauschen', 'Swap left/right'),
  camCardTitle: L('Steuere das Modell mit deiner Hand', 'Control the model with your hand'),
  camCardText: L('Die Webcam erkennt deine Hand. Das Modell bewegt sich mit, und du kannst auf deiner echten Hand zeigen, wo es schmerzt. Das Bild bleibt auf deinem Gerät.',
    'The webcam tracks your hand. The model moves with it, and you can point on your real hand to show where it hurts. The video never leaves your device.'),
  mirrorSteps: [
    L('Halte eine Hand hoch. Das Modell macht sie nach.', 'Hold one hand up. The model copies it.'),
    L('Zeig mit dem Zeigefinger der anderen Hand auf die schmerzende Stelle und halte still, um sie zu öffnen.', 'Point at a sore spot on that hand with your other index finger and hold still to open it.'),
    L('Handfläche oder Handrücken zur Kamera bestimmt die Seite.', 'Palm or back toward the camera picks the side.'),
    L('Mit der anderen Hand kneifen und nach unten ziehen trägt Schichten ab.', 'Pinch with the other hand and pull down to peel layers.'),
  ],
  airSteps: [
    L('Dein Zeigefinger bewegt den Cursor.', 'Your index finger moves the cursor.'),
    L('Still halten oder Daumen und Zeigefinger zusammenführen wählt die Stelle.', 'Hold still, or pinch thumb and index, to open a spot.'),
  ],
  noHand: L('Halte eine Hand in die Kamera.', 'Hold a hand up to the camera.'),
  mirroring: L('Spiegelt deine {side}, {facing}.', 'Mirroring your {side}, {facing}.'),
  leftHand: L('linke Hand', 'left hand'),
  rightHand: L('rechte Hand', 'right hand'),
  palmFacing: L('Handfläche zur Kamera', 'palm toward camera'),
  backFacing: L('Handrücken zur Kamera', 'back toward camera'),
  pointingAt: L('Zeigt auf', 'Pointing at'),
  peeling: L('Schichten abtragen', 'Peeling layers'),
  airStatus: L('Luft-Cursor aktiv.', 'Air cursor active.'),
  camDenied: L('Kein Kamerazugriff. In der Vorschau auf claude.ai ist die Kamera gesperrt. Öffne index.html direkt im Browser (Chrome, Edge, Firefox) und erlaube die Kamera.',
    'No camera access. The camera is blocked inside the claude.ai preview. Open index.html directly in your browser (Chrome, Edge, Firefox) and allow the camera.'),
  camNoDevice: L('Keine Kamera gefunden.', 'No camera found.'),
  handsFail: L('Die Handerkennung konnte nicht geladen werden. Prüfe die Internetverbindung (MediaPipe wird von cdn.jsdelivr.net geladen).',
    'Hand tracking could not load. Check your internet connection (MediaPipe loads from cdn.jsdelivr.net).'),
  building: L('Anatomie wird aufgebaut …', 'Building the anatomy …'),
  threeFail: L('3D-Grafik konnte nicht geladen werden. Prüfe die Internetverbindung und lade die Seite neu.',
    'The 3D engine could not load. Check your internet connection and reload.'),
  webglFail: L('Dein Browser unterstützt kein WebGL.', 'Your browser does not support WebGL.'),
  retry: L('Neu laden', 'Reload'),
  model: L('Welche Hand? Mit Webcam erscheint sie als Spiegelbild.', 'Which hand? With the webcam it is shown as a mirror image.'),
  sideL: L('Links', 'Left'),
  sideR: L('Rechts', 'Right'),
  step: L('Schritt', 'Step'),
  chooseSpot: L('Stelle wählen', 'Choose a spot'),
};

const FINGER_NAMES = [
  L('Daumen', 'Thumb'), L('Zeigefinger', 'Index finger'), L('Mittelfinger', 'Middle finger'),
  L('Ringfinger', 'Ring finger'), L('Kleiner Finger', 'Little finger'),
];

// Schichten von aussen nach innen (Knochen werden nie abgetragen)
const LAYERS = [
  { id: 'skin', name: L('Haut', 'Skin') },
  { id: 'fascia', name: L('Faszien & Retinakula', 'Fascia & retinacula') },
  { id: 'nerves', name: L('Nerven & Gefässe', 'Nerves & vessels') },
  { id: 'tendons', name: L('Sehnen & Sehnenscheiden', 'Tendons & sheaths') },
  { id: 'muscles', name: L('Muskeln', 'Muscles') },
  { id: 'bones', name: L('Knochen & Gelenke', 'Bones & joints') },
];
const LAYER_IX = { skin: 0, fascia: 1, nerves: 2, tendons: 3, muscles: 4, bones: 5 };

// ───────────────────────────── Strukturen ─────────────────────────────
const STRUCTS = {
  skin: { l: 'skin', n: L('Haut', 'Skin') },
  nail: { l: 'skin', n: L('Nagel', 'Nail') },
  palmar_apo: { l: 'fascia', n: L('Palmaraponeurose', 'Palmar aponeurosis') },
  tcl: { l: 'fascia', n: L('Queres Handwurzelband', 'Transverse carpal ligament') },
  ext_ret: { l: 'fascia', n: L('Retinaculum extensorum', 'Extensor retinaculum') },
  median: { l: 'nerves', n: L('Mittelnerv (N. medianus)', 'Median nerve') },
  ulnar_n: { l: 'nerves', n: L('Ellennerv (N. ulnaris)', 'Ulnar nerve') },
  radial_sup: { l: 'nerves', n: L('Oberflächlicher Speichennerv', 'Superficial radial nerve') },
  digital_n: { l: 'nerves', n: L('Fingernerven', 'Digital nerves') },
  radial_a: { l: 'nerves', n: L('Speichenarterie', 'Radial artery') },
  ulnar_a: { l: 'nerves', n: L('Ellenarterie', 'Ulnar artery') },
  palmar_arch: { l: 'nerves', n: L('Hohlhandbögen', 'Palmar arches') },
  digital_a: { l: 'nerves', n: L('Fingerarterien', 'Digital arteries') },
  veins: { l: 'nerves', n: L('Oberflächliche Venen', 'Superficial veins') },
  fds: { l: 'tendons', n: L('Oberflächlicher Fingerbeuger (FDS)', 'Flexor digitorum superficialis') },
  fdp: { l: 'tendons', n: L('Tiefer Fingerbeuger (FDP)', 'Flexor digitorum profundus') },
  fpl: { l: 'tendons', n: L('Langer Daumenbeuger (FPL)', 'Flexor pollicis longus') },
  fcr: { l: 'tendons', n: L('Radialer Handbeuger (FCR)', 'Flexor carpi radialis') },
  fcu: { l: 'tendons', n: L('Ulnarer Handbeuger (FCU)', 'Flexor carpi ulnaris') },
  pl: { l: 'tendons', n: L('Palmaris longus', 'Palmaris longus') },
  edc: { l: 'tendons', n: L('Fingerstrecker (EDC)', 'Extensor digitorum') },
  epl: { l: 'tendons', n: L('Langer Daumenstrecker (EPL)', 'Extensor pollicis longus') },
  epb: { l: 'tendons', n: L('Kurzer Daumenstrecker (EPB)', 'Extensor pollicis brevis') },
  apl: { l: 'tendons', n: L('Langer Daumenabspreizer (APL)', 'Abductor pollicis longus') },
  ecr: { l: 'tendons', n: L('Radiale Handstrecker (ECRL/ECRB)', 'Radial wrist extensors (ECRL/ECRB)') },
  ecu: { l: 'tendons', n: L('Ulnarer Handstrecker (ECU)', 'Extensor carpi ulnaris') },
  pulleys: { l: 'tendons', n: L('Ringbänder A1–A5', 'Annular pulleys A1–A5') },
  sheaths: { l: 'tendons', n: L('Beugesehnenscheiden', 'Flexor tendon sheaths') },
  first_comp: { l: 'tendons', n: L('1. Strecksehnenfach', 'First extensor compartment') },
  thenar_m: { l: 'muscles', n: L('Daumenballenmuskeln', 'Thenar muscles') },
  adductor: { l: 'muscles', n: L('Daumenanzieher', 'Adductor pollicis') },
  hypothenar_m: { l: 'muscles', n: L('Kleinfingerballenmuskeln', 'Hypothenar muscles') },
  lumbricals: { l: 'muscles', n: L('Lumbrikalmuskeln', 'Lumbricals') },
  interossei: { l: 'muscles', n: L('Zwischenknochenmuskeln', 'Interossei') },
  flexors_fa: { l: 'muscles', n: L('Unterarmbeuger', 'Forearm flexors') },
  extensors_fa: { l: 'muscles', n: L('Unterarmstrecker', 'Forearm extensors') },
  pronator_q: { l: 'muscles', n: L('Pronator quadratus', 'Pronator quadratus') },
  radius: { l: 'bones', n: L('Speiche (Radius)', 'Radius') },
  ulna: { l: 'bones', n: L('Elle (Ulna)', 'Ulna') },
  scaphoid: { l: 'bones', n: L('Kahnbein', 'Scaphoid') },
  lunate: { l: 'bones', n: L('Mondbein', 'Lunate') },
  triquetrum: { l: 'bones', n: L('Dreiecksbein', 'Triquetrum') },
  pisiform: { l: 'bones', n: L('Erbsenbein', 'Pisiform') },
  trapezium: { l: 'bones', n: L('Grosses Vieleckbein', 'Trapezium') },
  trapezoid: { l: 'bones', n: L('Kleines Vieleckbein', 'Trapezoid') },
  capitate: { l: 'bones', n: L('Kopfbein', 'Capitate') },
  hamate: { l: 'bones', n: L('Hakenbein', 'Hamate') },
  metacarpals: { l: 'bones', n: L('Mittelhandknochen', 'Metacarpals') },
  phalanges: { l: 'bones', n: L('Fingerglieder', 'Phalanges') },
  cmc1: { l: 'bones', n: L('Daumensattelgelenk', 'Thumb CMC joint') },
  mcp_j: { l: 'bones', n: L('Grundgelenk (MCP)', 'Knuckle joint (MCP)') },
  pip_j: { l: 'bones', n: L('Mittelgelenk (PIP)', 'Middle joint (PIP)') },
  dip_j: { l: 'bones', n: L('Endgelenk (DIP)', 'End joint (DIP)') },
  collaterals: { l: 'bones', n: L('Seitenbänder', 'Collateral ligaments') },
  volar_plate: { l: 'bones', n: L('Palmare Platte', 'Volar plate') },
  ucl_thumb: { l: 'bones', n: L('Ulnares Seitenband Daumen', 'Thumb ulnar collateral ligament') },
  sl_lig: { l: 'bones', n: L('SL-Band', 'Scapholunate ligament') },
  tfcc: { l: 'bones', n: L('TFCC (Diskus)', 'TFCC') },
};

// ───────────────────────────── Symptome ─────────────────────────────
const SYMPTOMS = [
  { id: 'belastung', n: L('Schmerz beim Greifen', 'Pain when gripping') },
  { id: 'kribbeln', n: L('Kribbeln / Taubheit', 'Tingling / numbness') },
  { id: 'nacht', n: L('Nachts schlimmer', 'Worse at night') },
  { id: 'schwellung', n: L('Schwellung / Knoten', 'Swelling / lump') },
  { id: 'steif', n: L('Morgensteifigkeit', 'Morning stiffness') },
  { id: 'schnappen', n: L('Schnappen / Klicken', 'Catching / clicking') },
  { id: 'unfall', n: L('Nach Sturz / Stoss', 'After a fall or knock') },
  { id: 'schwaeche', n: L('Kraftverlust', 'Weakness') },
  { id: 'roetung', n: L('Rötung / Wärme', 'Redness / warmth') },
];

// ───────────────────────────── Krankheitsbilder ─────────────────────────────
// n: Name · d: Kurzbeschreibung · s: typische Zeichen · t: Symptom-Tags
const C = (n, d, s, t) => ({ n, d, s, t });
const CONDITIONS = {
  kts: C(L('Karpaltunnelsyndrom', 'Carpal tunnel syndrome'),
    L('Der Mittelnerv wird unter dem queren Handwurzelband eingeengt.', 'The median nerve is squeezed under the transverse carpal ligament.'),
    [L('Kribbeln in Daumen, Zeige-, Mittel- und halbem Ringfinger', 'Pins and needles in the thumb, index, middle and half the ring finger'),
      L('Nachts oder beim Autofahren schlimmer; Ausschütteln hilft', 'Worse at night or when driving; shaking the hand helps'),
      L('Dinge fallen aus der Hand; später kann der Daumenballen schwinden', 'Dropping things; later, the thumb pad can shrink')],
    ['kribbeln', 'nacht', 'schwaeche']),
  flexor_teno: C(L('Beugesehnenscheiden-Reizung', 'Flexor tenosynovitis'),
    L('Die Sehnenscheiden im Karpaltunnel schwellen an – durch Überlastung, Diabetes oder entzündliches Rheuma.', 'Swelling of the tendon linings inside the tunnel, from overuse, diabetes or inflammatory arthritis.'),
    [L('Druckgefühl und Schwellung an der Handgelenksbeuge', 'Ache and fullness at the wrist crease'),
      L('Knarren oder Steifigkeit beim Faustschluss', 'Creaking or stiffness when making a fist')],
    ['schwellung', 'belastung', 'steif']),
  volar_ganglion: C(L('Palmares Ganglion', 'Volar ganglion cyst'),
    L('Eine mit Gelenkflüssigkeit gefüllte Zyste aus Gelenk oder Sehnenscheide.', 'A fluid-filled lump from a joint or tendon lining.'),
    [L('Glatte Beule nahe dem Puls, auf der Daumenseite der Beugefalte', 'Smooth lump near the pulse, on the thumb side of the crease'),
      L('Kann ihre Grösse ändern', 'May change size')],
    ['schwellung']),
  fcr_tend: C(L('FCR-Tendinitis', 'FCR tendinitis'),
    L('Reizung der Beugesehne des Handgelenks auf der Daumenseite der Beugefalte.', 'Irritation of the wrist-bending tendon on the thumb side of the crease.'),
    [L('Schmerz beim Beugen des Handgelenks gegen Widerstand', 'Pain when bending the wrist against resistance')],
    ['belastung']),
  dorsal_ganglion: C(L('Ganglion am Handrücken', 'Dorsal ganglion cyst'),
    L('Die häufigste Beule der Hand, meist vom Band zwischen Kahn- und Mondbein ausgehend.', 'The most common lump of the hand, usually arising from the ligament between scaphoid and lunate.'),
    [L('Prall-elastische Beule, beim Beugen des Handgelenks deutlicher', 'Firm, rubbery bump, more visible when the wrist bends'),
      L('Schmerzt beim Aufstützen (z. B. Liegestütze)', 'Aches when you push up on the hand (e.g. push-ups)')],
    ['schwellung', 'belastung']),
  extensor_tend: C(L('Strecksehnen-Überlastung', 'Extensor tendinopathy'),
    L('Überlastung der Strecksehnen durch viel Tippen, Mausarbeit oder Hantelsport.', 'Overload of the extensor tendons from lots of typing, mouse work or lifting.'),
    [L('Ziehender Schmerz am Handrücken bei Belastung', 'Ache on the back of the hand with use'),
      L('Manchmal leichte Schwellung entlang der Sehne', 'Sometimes mild swelling along the tendon')],
    ['belastung', 'schwellung']),
  sl_injury: C(L('SL-Bandverletzung', 'Scapholunate ligament injury'),
    L('Riss des Bandes zwischen Kahn- und Mondbein, typisch nach Sturz auf die gestreckte Hand.', 'A tear of the ligament between scaphoid and lunate, typically after a fall on the outstretched hand.'),
    [L('Schmerz beim Aufstützen, weniger Griffkraft', 'Pain when pushing up, weaker grip'),
      L('Klicken oder Schnappen im Handgelenk', 'Clicking or clunking in the wrist')],
    ['unfall', 'schnappen', 'schwaeche']),
  kienboeck: C(L('Morbus Kienböck', "Kienböck's disease"),
    L('Seltene Durchblutungsstörung des Mondbeins.', 'A rare loss of blood supply to the lunate bone.'),
    [L('Tiefer Schmerz in der Handgelenksmitte', 'Deep ache in the middle of the wrist'),
      L('Steifigkeit, manchmal Schwellung', 'Stiffness, sometimes swelling')],
    ['steif', 'belastung']),
  dequervain: C(L('Tendovaginitis de Quervain', "De Quervain's tenosynovitis"),
    L('Zwei Daumensehnen reiben im verengten ersten Strecksehnenfach.', 'Two thumb tendons rub in a tightened first extensor compartment.'),
    [L('Schmerz an der Daumenseite des Handgelenks, stärker beim Greifen', 'Pain over the thumb side of the wrist, worse when gripping'),
      L('Häufig bei jungen Eltern (Baby heben) und viel Handynutzung', 'Common in new parents (lifting a baby) and heavy phone use'),
      L('Daumen in die Faust nehmen und Hand kleinfingerwärts kippen schmerzt', 'Tucking the thumb into a fist and tilting the hand toward the little finger hurts')],
    ['belastung', 'schwellung']),
  scaphoid: C(L('Kahnbeinbruch', 'Scaphoid fracture'),
    L('Nach Sturz auf die ausgestreckte Hand leicht übersehen – heilt ohne Behandlung schlecht.', 'Easily missed after a fall on the outstretched hand, and it heals poorly without treatment.'),
    [L('Druckschmerz in der Tabatière (Grube an der Daumenseite)', 'Tenderness in the snuffbox (hollow on the thumb side)'),
      L('Schmerz beim Greifen, oft wenig Schwellung', 'Pain when gripping, often little swelling')],
    ['unfall']),
  wartenberg: C(L('Wartenberg-Syndrom', "Wartenberg's syndrome"),
    L('Reizung des oberflächlichen Speichennervs, z. B. durch ein enges Uhrarmband.', 'Irritation of the superficial radial nerve, e.g. from a tight watch strap.'),
    [L('Brennen oder Kribbeln am Handrücken über Daumen und Zeigefinger', 'Burning or tingling over the back of the thumb and index'),
      L('Kein Kraftverlust', 'No loss of strength')],
    ['kribbeln']),
  intersection: C(L('Intersektionssyndrom', 'Intersection syndrome'),
    L('Reibung dort, wo die Daumenmuskeln die Handgelenksstrecker kreuzen – typisch bei Rudern und Kraftsport.', 'Friction where the thumb muscles cross the wrist extensors, typical in rowing and weight training.'),
    [L('Schmerz und Schwellung 4–8 cm oberhalb des Handgelenks', 'Pain and swelling 4–8 cm above the wrist'),
      L('Knarren bei Bewegung', 'Squeaking (crepitus) with movement')],
    ['belastung', 'schwellung']),
  cmc_oa: C(L('Rhizarthrose', 'Thumb base arthritis'),
    L('Verschleiss des Daumensattelgelenks, besonders häufig bei Frauen ab 50.', "Wear of the thumb's saddle joint, especially common in women over 50."),
    [L('Schmerz beim Aufdrehen von Gläsern, Schlüsseldrehen, Kneifen', 'Pain opening jars, turning keys, pinching'),
      L('Tiefer Schmerz an der Daumenbasis, später eine Vorwölbung', 'Deep ache at the base of the thumb, later a bump')],
    ['belastung', 'steif', 'schwaeche']),
  thenar_strain: C(L('Überlastung des Daumenballens', 'Thenar muscle strain'),
    L('Ermüdung der Daumenballenmuskeln durch Kneifgriffe, Handy oder Werkzeug.', 'Fatigue of the thumb pad muscles from pinching, phone or tool use.'),
    [L('Muskelkaterartiger Schmerz im Daumenballen', 'Sore, tired feeling in the thumb pad'),
      L('Wird mit Pausen besser', 'Improves with rest')],
    ['belastung']),
  tfcc: C(L('TFCC-Läsion', 'TFCC injury'),
    L('Reizung oder Riss des Knorpel-Band-Kissens zwischen Elle und Handwurzel.', 'Irritation or tear of the cartilage-ligament cushion between ulna and wrist bones.'),
    [L('Schmerz auf der Kleinfingerseite beim Drehen (Türfalle, Schraubenzieher)', 'Pinky-side pain when twisting (door handles, screwdrivers)'),
      L('Klicken, Schwäche beim Aufstützen', 'Clicking, weakness when leaning on the hand')],
    ['belastung', 'schnappen', 'unfall']),
  ecu: C(L('ECU-Tendinitis', 'ECU tendinitis'),
    L('Reizung oder Springen der Sehne des ellenseitigen Handstreckers in ihrer Rinne.', 'Irritation or snapping of the pinky-side wrist extensor tendon in its groove.'),
    [L('Schmerz am Ellenköpfchen beim Drehen der Hand', 'Pain by the ulnar head when rotating the hand'),
      L('Schnappen beim Unterarmdrehen (Tennis, Golf)', 'Snapping as the forearm rotates (tennis, golf)')],
    ['belastung', 'schnappen']),
  ulnar_impaction: C(L('Ulnokarpales Impaktionssyndrom', 'Ulnar impaction'),
    L('Eine relativ lange Elle drückt auf die Handwurzel.', 'A relatively long ulna presses into the wrist bones.'),
    [L('Belastungsschmerz beim Abkippen zur Kleinfingerseite', 'Pain when tilting the hand toward the little finger under load'),
      L('Schleichender Beginn', 'Gradual onset')],
    ['belastung']),
  guyon: C(L('Loge-de-Guyon-Syndrom', 'Ulnar tunnel syndrome'),
    L('Der Ellennerv wird neben dem Erbsenbein eingeengt, oft durch Druck (Velofahren, Werkzeug).', 'The ulnar nerve is squeezed beside the pisiform, often from pressure (cycling, tools).'),
    [L('Kribbeln in Ring- und Kleinfinger', 'Tingling in the ring and little finger'),
      L('Ungeschicklichkeit, Schwäche beim Spreizen der Finger', 'Clumsiness, weak finger spreading')],
    ['kribbeln', 'schwaeche']),
  hamate_hook: C(L('Hamulusfraktur', 'Hook of hamate fracture'),
    L('Bruch des Hakenbein-Fortsatzes, typisch bei Golf, Tennis oder Baseball.', 'Fracture of the hook of the hamate, typical in golf, tennis or baseball.'),
    [L('Druckschmerz im Kleinfingerballen', 'Tender spot in the pinky-side palm'),
      L('Schmerz beim festen Greifen', 'Pain when gripping hard')],
    ['unfall', 'belastung']),
  hypothenar_hammer: C(L('Hypothenar-Hammer-Syndrom', 'Hypothenar hammer syndrome'),
    L('Selten: Schaden an der Ellenarterie, wenn der Handballen als Hammer dient.', 'Rare: damage to the ulnar artery from using the heel of the hand as a hammer.'),
    [L('Kalte, blasse oder bläuliche Finger', 'Cold, pale or bluish fingers'),
      L('Schmerz im Kleinfingerballen', 'Pain in the pinky-side palm')],
    ['kribbeln', 'unfall']),
  dupuytren: C(L('Morbus Dupuytren', "Dupuytren's disease"),
    L('Die Faszie der Hohlhand verdickt sich zu Knoten und Strängen.', 'The fascia of the palm thickens into nodules and cords.'),
    [L('Knoten in der Hohlhand, meist vor Ring- und Kleinfinger', 'Lump in the palm in line with the ring or little finger'),
      L('Finger lassen sich langsam nicht mehr ganz strecken', 'Finger slowly bending')],
    ['schwellung', 'steif']),
  trigger: C(L('Schnellender Finger', 'Trigger finger'),
    L('Das A1-Ringband verdickt sich, die Sehne bleibt beim Durchgleiten hängen.', 'The A1 pulley thickens and the tendon catches as it slides through.'),
    [L('Klicken, Hängenbleiben oder Einrasten des Fingers', 'Clicking, catching or locking of the finger'),
      L('Morgens schlimmer', 'Worse in the morning'),
      L('Druckempfindlicher Knoten an der Fingerbasis', 'Tender nodule at the finger base'),
      L('Häufiger bei Diabetes, an Ringfinger und Daumen', 'More common with diabetes and in the ring finger and thumb')],
    ['schnappen', 'steif', 'schwellung']),
  seed_ganglion: C(L('Ringband-Ganglion', 'Tendon sheath ganglion'),
    L('Eine erbsengrosse Zyste am Ringband.', 'A pea-sized cyst on the pulley.'),
    [L('Harte, druckempfindliche Perle, beim Greifen spürbar', 'Firm, tender bead felt when gripping')],
    ['schwellung', 'belastung']),
  ra: C(L('Rheumatoide Arthritis', 'Rheumatoid arthritis'),
    L('Das Immunsystem entzündet die Gelenkinnenhaut – oft an Grund- und Mittelgelenken beider Hände.', 'The immune system inflames the joint lining, often in the knuckles and middle joints of both hands.'),
    [L('Weiche Schwellung, Wärme', 'Soft swelling, warmth'),
      L('Morgensteifigkeit länger als 30 Minuten', 'Morning stiffness longer than 30 minutes'),
      L('Beide Hände, mehrere Gelenke', 'Both hands, several joints')],
    ['steif', 'schwellung', 'roetung']),
  mcp_oa: C(L('Arthrose des Grundgelenks', 'Knuckle osteoarthritis'),
    L('Seltener als an End- und Mittelgelenken; an Zeige- und Mittelfinger auch ein Hinweis auf Eisenspeicherkrankheit.', 'Less common than in the end and middle joints; in the index and middle knuckles it can point to iron overload.'),
    [L('Harte Verdickung, Faust nicht mehr ganz möglich', 'Hard enlargement, a full fist gets difficult'),
      L('Schmerz bei Belastung', 'Pain with use')],
    ['steif', 'belastung']),
  boxer: C(L('Mittelhandbruch', 'Metacarpal fracture'),
    L('Bruch eines Mittelhandknochens, klassisch am 5. Mittelhandknochen nach Faustschlag («Boxerfraktur»).', "A break in a hand bone, classically the 5th metacarpal after a punch («boxer's fracture»)."),
    [L('Schwellung, abgesunkener Knöchel', 'Swelling, a sunken knuckle'),
      L('Finger dreht beim Faustschluss schief', 'The finger twists when you make a fist')],
    ['unfall', 'schwellung']),
  sagittal_band: C(L('Verletzung der Streckhaube', 'Sagittal band injury'),
    L('Die Strecksehne rutscht über dem Knöchel zur Seite.', 'The extensor tendon slips off the top of the knuckle.'),
    [L('Sehne schnappt beim Faustschluss zur Seite', 'Tendon flicks sideways when making a fist'),
      L('Finger lässt sich schwer strecken', 'Hard to straighten the finger')],
    ['schnappen', 'unfall']),
  bouchard: C(L('Bouchard-Arthrose', "Bouchard's nodes"),
    L('Arthrose der Fingermittelgelenke mit knöchernen Verdickungen.', 'Osteoarthritis of the middle finger joints with bony bumps.'),
    [L('Harte Knoten seitlich am Mittelgelenk', 'Hard bumps on the sides of the middle joint'),
      L('Anlaufschmerz, kurze Morgensteifigkeit', 'Stiff when starting, short morning stiffness')],
    ['steif', 'schwellung', 'belastung']),
  pip_sprain: C(L('Verstauchung / Seitenbandverletzung', 'Sprain / collateral ligament injury'),
    L('Überdehntes Seitenband oder palmare Platte, z. B. beim Ballsport.', 'An overstretched collateral ligament or volar plate, e.g. from ball sports.'),
    [L('Spindelförmige Schwellung, die monatelang bleiben kann', 'Spindle-shaped swelling that can last months'),
      L('Schmerz bei seitlichem Druck', 'Pain when the joint is pushed sideways')],
    ['unfall', 'schwellung']),
  boutonniere: C(L('Knopflochdeformität', 'Boutonnière injury'),
    L('Der Mittelzügel der Strecksehne reisst über dem Mittelgelenk.', 'The central slip of the extensor tendon tears over the middle joint.'),
    [L('Mittelgelenk bleibt gebeugt, Endgelenk überstreckt', 'Middle joint stays bent, end joint bends back'),
      L('Nach Stoss oder Schnitt am Fingerrücken', 'After a jam or cut over the back of the finger')],
    ['unfall', 'schwaeche']),
  heberden: C(L('Heberden-Arthrose', "Heberden's nodes"),
    L('Arthrose der Fingerendgelenke – sehr häufig und oft familiär.', 'Osteoarthritis of the end finger joints, very common and often runs in families.'),
    [L('Harte Knötchen am Endgelenk', 'Hard nodules at the end joint'),
      L('Schubweise Rötung und Schmerz, später oft ruhiger', 'Flares of redness and pain that often settle later')],
    ['steif', 'schwellung', 'roetung']),
  mallet: C(L('Mallet-Finger', 'Mallet finger'),
    L('Die Strecksehne reisst am Endglied ab, oft wenn ein Ball die Fingerspitze trifft.', 'The extensor tendon tears off the end bone, often when a ball hits the fingertip.'),
    [L('Endglied hängt und lässt sich nicht aktiv strecken', 'The fingertip droops and cannot be straightened on its own'),
      L('Mit der anderen Hand lässt es sich noch gerade drücken', 'It can still be pushed straight')],
    ['unfall']),
  mucous_cyst: C(L('Mukoidzyste', 'Mucous cyst'),
    L('Kleine Zyste über dem Endgelenk, meist bei Arthrose.', 'A small cyst over the end joint, usually with arthritis.'),
    [L('Glasige Perle zwischen Gelenk und Nagel', 'Glassy bead between joint and nail'),
      L('Kann eine Rille im Nagel machen', 'Can cause a groove in the nail')],
    ['schwellung']),
  psa: C(L('Psoriasis-Arthritis', 'Psoriatic arthritis'),
    L('Entzündliche Gelenkerkrankung bei Schuppenflechte, oft an den Endgelenken.', 'Inflammatory arthritis linked to psoriasis, often in the end joints.'),
    [L('Wurstfinger (ganzer Finger geschwollen)', 'Sausage finger (whole finger swollen)'),
      L('Nagelveränderungen: Tüpfel, Ablösung', 'Nail changes: pits, lifting')],
    ['schwellung', 'steif', 'roetung']),
  gout: C(L('Gicht', 'Gout'),
    L('Harnsäurekristalle lösen eine heftige Gelenkentzündung aus.', 'Uric acid crystals trigger a sudden, intense joint inflammation.'),
    [L('Plötzlich rot, heiss, extrem berührungsempfindlich', 'Suddenly red, hot and extremely tender'),
      L('Beginnt oft über Nacht', 'Often starts overnight')],
    ['roetung', 'schwellung', 'nacht']),
  paronychia: C(L('Nagelbettentzündung', 'Paronychia'),
    L('Infektion der Haut am Nagelrand.', 'Infection of the skin fold beside the nail.'),
    [L('Roter, pochender Nagelwall', 'Red, throbbing nail fold'),
      L('Gelber Eiterpunkt', 'A yellow bead of pus')],
    ['roetung', 'schwellung']),
  felon: C(L('Panaritium der Fingerbeere', 'Felon'),
    L('Infektion der Fingerbeere. Dringend.', 'Infection of the fingertip pulp. Urgent.'),
    [L('Gespannte, sehr schmerzhafte, geschwollene Kuppe', 'Tense, very painful, swollen tip'),
      L('Oft nach Splitter oder Stich', 'Often after a splinter or prick')],
    ['roetung', 'schwellung']),
  raynaud: C(L('Raynaud-Phänomen', "Raynaud's phenomenon"),
    L('Kleine Arterien verkrampfen sich bei Kälte.', 'Small arteries clamp down in the cold.'),
    [L('Finger werden weiss, dann blau, dann rot', 'Fingers go white, then blue, then red'),
      L('Taub und schmerzhaft beim Aufwärmen', 'Numb and painful as they rewarm')],
    ['kribbeln']),
  nerve_tingling: C(L('Nervenbedingtes Kribbeln', 'Nerve-related tingling'),
    L('Beschwerden an der Kuppe kommen oft von einem Nerv weiter oben.', 'Tip symptoms often come from a nerve higher up.'),
    [L('Daumen, Zeige-, Mittelfinger: an den Karpaltunnel denken', 'Thumb, index, middle: think carpal tunnel'),
      L('Ring- und Kleinfinger: an den Ellennerv denken', 'Ring and little: think ulnar nerve')],
    ['kribbeln', 'nacht']),
  glomus: C(L('Glomustumor', 'Glomus tumour'),
    L('Seltene, gutartige Wucherung unter dem Nagel.', 'Rare, benign growth under the nail.'),
    [L('Punktgenauer, heftiger Schmerz unter dem Nagel', 'Pinpoint, intense pain under the nail'),
      L('Sehr kälteempfindlich', 'Very sensitive to cold')],
    ['nacht']),
  finger_fracture: C(L('Fingerbruch', 'Finger fracture'),
    L('Bruch eines Fingerglieds nach Stoss, Quetschung oder Sturz.', 'A break in a finger bone after a jam, crush or fall.'),
    [L('Schwellung, Bluterguss, Fehlstellung', 'Swelling, bruising, deformity'),
      L('Finger dreht beim Faustschluss schief', 'Finger rotates when you make a fist')],
    ['unfall', 'schwellung']),
  sheath_infection: C(L('Infektion der Beugesehnenscheide', 'Flexor sheath infection'),
    L('Bakterien in der Sehnenscheide – ein Notfall.', 'Bacteria inside the tendon sheath: an emergency.'),
    [L('Ganzer Finger geschwollen und leicht gebeugt', 'Whole finger swollen and held slightly bent'),
      L('Starker Schmerz beim Strecken', 'Severe pain when it is straightened'),
      L('Oft nach kleiner Stichverletzung', 'Often after a small puncture wound')],
    ['roetung', 'schwellung']),
  skier_thumb: C(L('Skidaumen', "Skier's thumb"),
    L('Riss des ellenseitigen Seitenbands am Daumengrundgelenk, z. B. Sturz mit Skistock.', "Tear of the ulnar collateral ligament at the thumb's knuckle, e.g. a fall holding a ski pole."),
    [L('Schmerz und Schwellung auf der Zeigefingerseite des Grundgelenks', 'Pain and swelling on the index side of the thumb knuckle'),
      L('Schwacher Kneifgriff, Daumen wackelt', 'Weak pinch, the thumb feels unstable')],
    ['unfall', 'schwaeche']),
  golfer_ref: C(L('Golferellenbogen (Ausstrahlung)', "Golfer's elbow (referred)"),
    L('Reizung der Beugemuskel-Ansätze am inneren Ellenbogen, zieht in den Unterarm.', 'Irritation where the flexor muscles attach at the inner elbow, spreading into the forearm.'),
    [L('Schmerz beim Greifen und Beugen des Handgelenks', 'Pain when gripping and bending the wrist'),
      L('Druckschmerz am inneren Ellenbogen', 'Tender inner elbow')],
    ['belastung']),
  tennis_ref: C(L('Tennisellenbogen (Ausstrahlung)', 'Tennis elbow (referred)'),
    L('Überlastung der Streckmuskel-Ansätze am äusseren Ellenbogen.', 'Overload where the extensor muscles attach at the outer elbow.'),
    [L('Schmerz beim Heben mit Handrücken nach oben (Tasse, Maus)', 'Pain lifting with the palm down (a mug, a mouse)'),
      L('Druckschmerz am äusseren Ellenbogen', 'Tender outer elbow')],
    ['belastung']),
  forearm_overuse: C(L('Überlastung («Mausarm», RSI)', 'Repetitive strain («mouse arm»)'),
    L('Überlastung von Muskeln und Sehnen durch lange, gleichförmige Tätigkeiten.', 'Overload of muscles and tendons from long, repetitive tasks.'),
    [L('Ziehen, Müdigkeit oder Brennen im Unterarm', 'Aching, tiredness or burning in the forearm'),
      L('Besser in Pausen und am Wochenende', 'Better with breaks and at weekends')],
    ['belastung']),
  pronator: C(L('Pronator-teres-Syndrom', 'Pronator syndrome'),
    L('Der Mittelnerv wird am Unterarm zwischen Muskeln eingeengt.', 'The median nerve is squeezed between muscles in the forearm.'),
    [L('Ziehen im oberen Unterarm', 'Aching in the upper forearm'),
      L('Kribbeln wie beim Karpaltunnel, aber tagsüber', 'Tingling like carpal tunnel, but during the day')],
    ['kribbeln', 'belastung']),
  cervical: C(L('Nervenwurzel am Hals', 'Pinched nerve in the neck'),
    L('Eine gereizte Nervenwurzel an der Halswirbelsäule kann bis in die Hand ausstrahlen.', 'An irritated nerve root in the neck can send symptoms all the way to the hand.'),
    [L('Nacken- oder Schulterschmerz dazu', 'Neck or shoulder pain as well'),
      L('Beschwerden entlang des ganzen Arms', 'Symptoms along the whole arm')],
    ['kribbeln', 'schwaeche']),
};

// ───────────────────────────── Regionen (Vorlagen) ─────────────────────────────
// h: Hilfen (x = Übung zum Zeigen) · k: Ärztlich abklären · u: Strukturen unter der Stelle
const H = (de, en, x) => ({ de, en, x });
const REGION_TPL = {
  wrist_palm: {
    n: L('Handgelenk, Beugeseite', 'Palm side of the wrist'),
    crumb: [L('Beugeseite', 'Palm side'), L('Karpaltunnel', 'Carpal tunnel')],
    u: ['median', 'tcl', 'fds', 'fdp', 'fpl', 'fcr'],
    c: ['kts', 'flexor_teno', 'volar_ganglion', 'fcr_tend'],
    h: [H('Nachts eine Schiene tragen, die das Handgelenk gerade hält, nicht gebeugt.', 'Wear a wrist splint at night that keeps the wrist straight, not bent.'),
      H('Langes Abknicken vermeiden: Maus, Handy, Lenkrad, Schlafhaltung.', 'Avoid long spells with the wrist bent: mouse, phone, steering wheel, sleeping position.'),
      H('Sanfte Nervengleitübungen halten den Mittelnerv beweglich.', 'Gentle nerve glides keep the median nerve moving.', 'nerveGlide'),
      H('Sehnengleiten gegen steife Beugesehnen.', 'Tendon glides ease stiff flexor tendons.', 'tendonGlides'),
      H('Ganglion: nicht aufdrücken oder «zerschlagen» – viele verschwinden von selbst.', "Ganglion: don't squeeze or smash it. Many go away on their own.")],
    k: [L('Taubheit, die nicht mehr weggeht, oder schwacher Griff', 'Numbness that no longer goes away, or a weak grip'),
      L('Der Daumenballen wird flacher', 'The thumb pad looks flatter'),
      L('Keine Besserung nach 4–6 Wochen Schiene', 'No improvement after 4–6 weeks of splinting')],
  },
  wrist_back: {
    n: L('Handgelenk, Streckseite', 'Back of the wrist'),
    crumb: [L('Handrücken', 'Back'), L('Handwurzel', 'Wrist bones')],
    u: ['ext_ret', 'edc', 'ecr', 'sl_lig', 'lunate', 'scaphoid'],
    c: ['dorsal_ganglion', 'extensor_tend', 'sl_injury', 'kienboeck'],
    h: [H('Belastung anpassen statt ganz ruhigstellen: Aufstützen und Liegestütze vorerst meiden.', 'Adjust load rather than immobilise: avoid pushing up and push-ups for now.'),
      H('Bei einem Reizzustand kurz eine Bandage oder Schiene tragen.', 'Wear a brace or splint for short flare-ups.'),
      H('Kühlen (10–15 Minuten) bei frischer Schwellung, Wärme bei Steifigkeit.', 'Cool for 10–15 minutes with fresh swelling, use warmth for stiffness.'),
      H('Sanftes Sehnengleiten hält die Strecker geschmeidig.', 'Gentle tendon glides keep the extensors moving.', 'tendonGlides')],
    k: [L('Schmerz, Klicken oder Kraftverlust nach einem Sturz', 'Pain, clicking or weakness after a fall'),
      L('Tiefer Schmerz, der über Wochen zunimmt', 'Deep pain that builds over weeks')],
  },
  wrist_radial: {
    n: L('Handgelenk, Daumenseite', 'Thumb side of the wrist'),
    crumb: [L('Daumenseite', 'Thumb side'), L('1. Strecksehnenfach', 'First compartment'), L('Tabatière', 'Snuffbox')],
    u: ['apl', 'epb', 'epl', 'first_comp', 'radial_sup', 'radial_a', 'scaphoid'],
    c: ['dequervain', 'scaphoid', 'wartenberg', 'intersection', 'cmc_oa'],
    h: [H('Eine Schiene, die Daumen und Handgelenk einschliesst, für einige Wochen.', 'A splint that includes the thumb and wrist, for a few weeks.'),
      H('Mit der Handfläche nach oben und nah am Körper heben – auch ein Baby.', 'Lift with the palm up and close to your body, a baby included.'),
      H('Weniger mit dem Daumen tippen; Sprachnachrichten oder beide Hände nutzen.', 'Less thumb-typing; use voice or both hands.'),
      H('Das Uhrarmband locker tragen.', 'Wear your watch strap loose.')],
    k: [L('Nach einem Sturz Druckschmerz in der Tabatière: röntgen lassen, auch wenn es sich wie eine Verstauchung anfühlt', 'Snuffbox tenderness after a fall: get an X-ray even if it feels like a sprain'),
      L('Keine Besserung nach 4–6 Wochen; eine Kortisonspritze hilft bei De Quervain oft', "No better after 4–6 weeks; a steroid injection often helps De Quervain's")],
  },
  wrist_ulnar: {
    n: L('Handgelenk, Kleinfingerseite', 'Pinky side of the wrist'),
    crumb: [L('Kleinfingerseite', 'Pinky side'), L('TFCC', 'TFCC')],
    u: ['tfcc', 'ecu', 'ulna', 'triquetrum', 'ulnar_n'],
    c: ['tfcc', 'ecu', 'ulnar_impaction', 'ra'],
    h: [H('Drehbewegungen unter Last reduzieren (Schraubenzieher, Pfannen).', 'Cut down on twisting under load (screwdrivers, frying pans).'),
      H('Ein Handgelenksband um die Elle entlastet oft spürbar.', 'A wrist band around the ulna often helps noticeably.'),
      H('Beim Aufstützen die Faust statt der flachen Hand nutzen.', 'When leaning, rest on your knuckles instead of the flat palm.')],
    k: [L('Klicken, Instabilität oder Schwäche nach einem Sturz', 'Clicking, instability or weakness after a fall'),
      L('Schmerz länger als 6 Wochen', 'Pain for longer than 6 weeks')],
  },
  thumb_base: {
    n: L('Daumenbasis', 'Base of the thumb'),
    crumb: [L('Daumenseite', 'Thumb side'), L('Sattelgelenk', 'CMC joint')],
    u: ['cmc1', 'trapezium', 'metacarpals', 'thenar_m', 'apl'],
    c: ['cmc_oa', 'dequervain', 'scaphoid', 'thenar_strain'],
    h: [H('Eine Daumenorthese stützt das Sattelgelenk bei Belastung.', 'A thumb brace supports the saddle joint during tasks.'),
      H('Gelenkschutz: dicke Griffe, Glasöffner, Schlüsselhilfe.', 'Joint protection: thick handles, jar openers, key turners.'),
      H('Stabilisierende Daumenübungen stärken die Muskeln ums Gelenk.', 'Stabilising thumb exercises strengthen the muscles around the joint.', 'thumbOpposition'),
      H('Wärme bei Steifigkeit, Kälte bei akuter Reizung.', 'Heat for stiffness, cold for flare-ups.')],
    k: [L('Anhaltende Schwellung, Fehlstellung oder Nachtschmerz', 'Persistent swelling, deformity or night pain'),
      L('Nach einem Sturz: Kahnbeinbruch ausschliessen', 'After a fall: rule out a scaphoid fracture')],
  },
  thenar: {
    n: L('Daumenballen', 'Thumb pad (thenar)'),
    crumb: [L('Handfläche', 'Palm'), L('Thenar', 'Thenar')],
    u: ['thenar_m', 'median', 'fpl', 'adductor'],
    c: ['kts', 'cmc_oa', 'thenar_strain'],
    h: [H('Lange Kneif- und Haltegriffe (Handy, Stift) mit Pausen unterbrechen.', 'Break up long pinching and holding (phone, pen) with pauses.'),
      H('Dickere Stifte und Griffe verwenden.', 'Use thicker pens and handles.'),
      H('Sanfte Daumen-Oppositionsübung.', 'Gentle thumb opposition exercise.', 'thumbOpposition')],
    k: [L('Der Daumenballen wird sichtbar flacher oder schwächer', 'The thumb pad looks flatter or weaker'),
      L('Taubheit von Daumen bis Mittelfinger', 'Numbness from the thumb to the middle finger')],
  },
  hypothenar: {
    n: L('Kleinfingerballen', 'Pinky-side palm'),
    crumb: [L('Handfläche', 'Palm'), L('Loge de Guyon', "Guyon's canal")],
    u: ['ulnar_n', 'ulnar_a', 'pisiform', 'hamate', 'hypothenar_m'],
    c: ['guyon', 'hamate_hook', 'hypothenar_hammer'],
    h: [H('Gepolsterte Handschuhe beim Velofahren; Griffposition oft wechseln.', 'Padded cycling gloves; change your grip often.'),
      H('Den Handballen nicht als Hammer benutzen.', "Don't use the heel of your hand as a hammer."),
      H('Nicht auf dem Kleinfingerballen abstützen (Tischkante, Maus).', 'Avoid leaning on the pinky-side palm (desk edge, mouse).')],
    k: [L('Kalte, blasse oder bläuliche Finger: rasch abklären', 'Cold, pale or bluish fingers: get checked promptly'),
      L('Schwaches Fingerspreizen oder Muskelschwund zwischen den Knochen', 'Weak finger spreading or wasting between the bones')],
  },
  palm_center: {
    n: L('Handflächenmitte', 'Centre of the palm'),
    crumb: [L('Handfläche', 'Palm'), L('Palmaraponeurose', 'Palmar fascia')],
    u: ['palmar_apo', 'palmar_arch', 'digital_n', 'fds', 'fdp', 'lumbricals'],
    c: ['dupuytren', 'trigger', 'flexor_teno', 'kts'],
    h: [H('Tischtest: Lässt sich die Hand flach auf den Tisch legen? Wenn nicht, zur Handchirurgie.', "Tabletop test: can you lay your hand flat on a table? If not, see a hand surgeon."),
      H('Gepolsterte Griffe und Handschuhe bei Werkzeugarbeit.', 'Padded grips and gloves for tool work.'),
      H('Sehnengleiten hält die Beugesehnen geschmeidig.', 'Tendon glides keep the flexor tendons moving.', 'tendonGlides')],
    k: [L('Ein Finger lässt sich nicht mehr ganz strecken', 'A finger no longer straightens fully'),
      L('Schwellung mit Rötung und Fieber', 'Swelling with redness and fever')],
  },
  back_of_hand: {
    n: L('Handrücken', 'Back of the hand'),
    crumb: [L('Handrücken', 'Back'), L('Mittelhand', 'Metacarpals')],
    u: ['edc', 'metacarpals', 'interossei', 'veins', 'radial_sup'],
    c: ['extensor_tend', 'boxer', 'dorsal_ganglion', 'ra'],
    h: [H('Belastung dosieren; Tippen und Mausarbeit mit Pausen.', 'Pace your load; break up typing and mouse work.'),
      H('Kühlen und hochlagern bei Schwellung nach einem Stoss.', 'Cool and elevate if it swells after a knock.'),
      H('Sanftes Sehnengleiten.', 'Gentle tendon glides.', 'tendonGlides'),
      H('Spreizübungen für die Zwischenknochenmuskeln.', 'Spreading exercises for the interossei.', 'spread')],
    k: [L('Deutliche Schwellung nach Schlag oder Sturz', 'Marked swelling after a blow or fall'),
      L('Rötung, Wärme und Fieber: Infektion ausschliessen', 'Redness, warmth and fever: rule out infection')],
  },
  finger_base: {
    n: L('Fingerbasis, Handflächenseite', 'Base of a finger, palm side'),
    crumb: [L('Handfläche', 'Palm side'), L('A1-Ringband', 'A1 pulley')],
    u: ['pulleys', 'fds', 'fdp', 'sheaths', 'palmar_apo'],
    c: ['trigger', 'dupuytren', 'seed_ganglion'],
    h: [H('Kraftvolles oder wiederholtes Greifen reduzieren; Werkzeuggriffe polstern.', 'Cut down on forceful or repetitive gripping; pad tool handles.'),
      H('Eine kleine Schiene hält das Grundgelenk nachts gestreckt, bis zu 6 Wochen.', 'A small splint that keeps the knuckle straight at night for up to 6 weeks.'),
      H('Sanftes Sehnengleiten hält die Sehne in Bewegung.', 'Gentle tendon glides keep the tendon moving.', 'tendonGlides'),
      H('Eine Kortisonspritze hilft oft; bei Rückfällen ist ein kleiner Eingriff möglich.', 'A steroid injection often cures trigger finger. A small release operation helps if it keeps coming back.')],
    k: [L('Der Finger blockiert und lässt sich nicht mehr strecken oder beugen', "The finger locks and won't straighten or bend"),
      L('Rötung oder Schwellung des ganzen Fingers', 'Redness or swelling of the whole finger')],
  },
  knuckle: {
    n: L('Fingerknöchel (Grundgelenk)', 'Knuckle (MCP joint)'),
    crumb: [L('Handrücken', 'Back'), L('Grundgelenk', 'MCP joint')],
    u: ['mcp_j', 'edc', 'collaterals', 'metacarpals'],
    c: ['ra', 'mcp_oa', 'boxer', 'sagittal_band'],
    h: [H('Bei Morgensteifigkeit: warmes Wasserbad und sanft bewegen.', 'For morning stiffness: a warm water bath and gentle movement.'),
      H('Gelenkschutz: Lasten mit beiden Händen und nah am Körper tragen.', 'Joint protection: carry loads with both hands, close to the body.'),
      H('Sanftes Faustschliessen und Öffnen.', 'Gentle fist closing and opening.', 'tendonGlides'),
      H('Nach einem Schlag kühlen und hochlagern.', 'After a knock: cool and elevate.')],
    k: [L('Weiche, warme Schwellung mehrerer Gelenke, besonders beidseits: früh zur Rheumatologie', 'Soft, warm swelling of several joints, especially in both hands: see a rheumatologist early'),
      L('Nach einem Schlag: abgesunkener Knöchel oder schief drehender Finger', 'After a punch: a sunken knuckle or a finger that rotates'),
      L('Wunde über dem Knöchel nach Faustschlag gegen Zähne: Notfall', 'A cut over the knuckle from a punch to the teeth: emergency')],
  },
  finger_shaft: {
    n: L('Grundglied', 'Finger shaft'),
    crumb: [L('Finger', 'Finger'), L('Grundglied', 'Proximal phalanx')],
    u: ['phalanges', 'fds', 'fdp', 'sheaths', 'pulleys', 'digital_n'],
    c: ['finger_fracture', 'sheath_infection', 'dupuytren', 'seed_ganglion'],
    h: [H('Nach einem Stoss: kühlen, hochlagern, Ringe abnehmen.', 'After a knock: cool, elevate, take off rings.'),
      H('Bei leichten, stabilen Verletzungen mit dem Nachbarfinger zusammentapen.', 'Buddy-tape to the neighbouring finger for minor, stable injuries.'),
      H('Sehnengleiten, sobald es schmerzarm geht.', 'Tendon glides once pain allows.', 'tendonGlides')],
    k: [L('Der Finger dreht beim Faustschluss schief oder wirkt krumm', 'The finger twists in a fist or looks crooked'),
      L('Ganzer Finger geschwollen, gebeugt gehalten, Strecken sehr schmerzhaft: Notfall', 'Whole finger swollen, held bent and very painful to straighten: emergency')],
  },
  pip: {
    n: L('Fingermittelgelenk', 'Middle joint (PIP)'),
    crumb: [L('Finger', 'Finger'), L('Mittelgelenk', 'PIP joint')],
    u: ['pip_j', 'collaterals', 'volar_plate', 'edc', 'fds'],
    c: ['bouchard', 'ra', 'pip_sprain', 'boutonniere'],
    h: [H('Verstauchung: 2–3 Wochen mit dem Nachbarfinger zusammentapen.', 'Sprain: buddy-tape to the neighbouring finger for 2–3 weeks.'),
      H('Früh und sanft bewegen, damit das Gelenk nicht einsteift.', 'Move early and gently so the joint does not stiffen.', 'blocking'),
      H('Wärme oder Paraffinbad bei Arthrose.', 'Warmth or paraffin baths for arthritis.'),
      H('Ringe abnehmen, solange es geschwollen ist.', "Take off rings while it's swollen.")],
    k: [L('Fehlstellung oder das Gelenk lässt sich nicht strecken', "A deformity, or the joint won't straighten"),
      L('Mittelgelenk bleibt nach einem Stoss gebeugt', 'The middle joint stays bent after a jam'),
      L('Rote, heisse Schwellung', 'Red, hot swelling')],
  },
  dip: {
    n: L('Fingerendgelenk', 'End joint (DIP)'),
    crumb: [L('Finger', 'Finger'), L('Endgelenk', 'DIP joint')],
    u: ['dip_j', 'edc', 'fdp', 'nail', 'collaterals'],
    c: ['heberden', 'mallet', 'mucous_cyst', 'psa', 'gout'],
    h: [H('Mallet-Finger: das Endglied 6–8 Wochen ohne Unterbruch gestreckt schienen.', 'Mallet finger: keep the tip splinted straight, without a break, for 6–8 weeks.'),
      H('Arthrose: Wärme, Bewegung, Gelenkschutz; Schübe beruhigen sich oft.', 'Arthritis: warmth, movement and joint protection; flares often settle.'),
      H('Blocking-Übungen halten Mittel- und Endgelenk beweglich.', 'Blocking exercises keep the middle and end joints moving.', 'blocking')],
    k: [L('Das Endglied hängt nach einem Stoss: innerhalb einer Woche schienen lassen', 'A drooping fingertip after a knock: get it splinted within a week'),
      L('Plötzlich rotes, heisses Gelenk', 'A suddenly red, hot joint'),
      L('Nagelveränderungen zusammen mit Gelenkschwellung', 'Nail changes together with joint swelling')],
  },
  fingertip: {
    n: L('Fingerkuppe & Nagel', 'Fingertip & nail'),
    crumb: [L('Beere', 'Pulp'), L('Nagelwall', 'Nail fold')],
    u: ['nail', 'digital_n', 'digital_a', 'skin'],
    c: ['paronychia', 'felon', 'raynaud', 'nerve_tingling', 'glomus'],
    h: [H('Nagelbettentzündung: warme Salzwasserbäder 3–4× täglich; bei Eiter zur Hausärztin oder zum Hausarzt.', 'Paronychia: warm salt-water soaks 3–4 times a day. See a GP if pus forms or it spreads.'),
      H('Raynaud: den ganzen Körper warm halten, Handschuhe tragen, nicht rauchen.', "Raynaud's: keep the whole body warm, wear gloves, avoid smoking."),
      H('Fingerkuppen bei grober Arbeit mit Handschuhen schützen.', 'Protect fingertips with gloves for rough work.'),
      H('Kribbeln: an Handgelenk und Ellenbogen denken; Nervengleiten kann helfen.', 'Tingling: think of the wrist and elbow; nerve glides can help.', 'nerveGlide')],
    k: [L('Gespannte, pochende Kuppe: am selben Tag', 'A tense, throbbing fingertip: same day'),
      L('Ein Finger bleibt weiss oder blau, oder Wunden an der Kuppe', 'A finger stays white or blue, or sores on the tip'),
      L('Punktgenauer Schmerz unter dem Nagel über Wochen', 'Pinpoint pain under the nail for weeks')],
  },
  thumb_mcp: {
    n: L('Daumengrundgelenk', 'Thumb knuckle (MCP)'),
    crumb: [L('Daumen', 'Thumb'), L('Grundgelenk', 'MCP joint')],
    u: ['ucl_thumb', 'mcp_j', 'pulleys', 'fpl', 'epb'],
    c: ['skier_thumb', 'trigger', 'ra', 'mcp_oa'],
    h: [H('Nach einer Verletzung: den Daumen bis zur Abklärung in einer Schiene ruhig halten.', 'After an injury: rest the thumb in a splint until it is checked.'),
      H('Kneifgriffe entlasten: dickere Griffe und Hilfsmittel.', 'Ease pinching: thicker handles and aids.'),
      H('Schnellender Daumen: Schiene in der Nacht, sanftes Sehnengleiten.', 'Trigger thumb: a night splint and gentle tendon glides.', 'tendonGlides')],
    k: [L('Wackeliger Daumen oder schwacher Kneifgriff nach einem Sturz: innerhalb einer Woche', 'A wobbly thumb or weak pinch after a fall: within a week'),
      L('Der Daumen blockiert', 'The thumb locks')],
  },
  forearm_front: {
    n: L('Unterarm, Beugeseite', 'Front of the forearm'),
    crumb: [L('Unterarm', 'Forearm'), L('Beugemuskeln', 'Flexor muscles')],
    u: ['flexors_fa', 'fds', 'fcr', 'fcu', 'pl', 'median', 'radial_a', 'ulnar_a', 'pronator_q'],
    c: ['forearm_overuse', 'golfer_ref', 'pronator', 'cervical'],
    h: [H('Pausen alle 30–45 Minuten; den Griff bewusst lockern.', 'Take breaks every 30–45 minutes and consciously soften your grip.'),
      H('Beuger dehnen: Arm gestreckt, Finger sanft zurückziehen, 20–30 Sekunden.', 'Flexor stretch: arm straight, ease the fingers back for 20–30 seconds.'),
      H('Langsam steigerndes Krafttraining, sobald es schmerzarm geht.', 'Gradual strengthening once pain allows.'),
      H('Nervengleiten bei Kribbeln.', 'Nerve glides for tingling.', 'nerveGlide')],
    k: [L('Kribbeln oder Schwäche, die zunimmt', 'Tingling or weakness that gets worse'),
      L('Nacken- und Armschmerz mit Taubheit', 'Neck and arm pain with numbness')],
  },
  forearm_back: {
    n: L('Unterarm, Streckseite', 'Back of the forearm'),
    crumb: [L('Unterarm', 'Forearm'), L('Streckmuskeln', 'Extensor muscles')],
    u: ['extensors_fa', 'apl', 'epb', 'ecr', 'edc', 'radial_sup', 'veins'],
    c: ['intersection', 'forearm_overuse', 'tennis_ref', 'cervical'],
    h: [H('Maus und Tastatur so einrichten, dass das Handgelenk gerade bleibt.', 'Set up mouse and keyboard so the wrist stays straight.'),
      H('Mit der Handfläche nach oben heben statt nach unten.', 'Lift with the palm up rather than down.'),
      H('Knarrende Schwellung kühlen und die Belastung 1–2 Wochen reduzieren.', 'Cool a creaky swelling and reduce load for 1–2 weeks.'),
      H('Strecker dehnen: Arm gestreckt, Handgelenk sanft beugen, 20–30 Sekunden.', 'Extensor stretch: arm straight, gently bend the wrist down for 20–30 seconds.')],
    k: [L('Schmerz, der trotz Pause über Wochen bleibt', 'Pain that lasts for weeks despite rest'),
      L('Schwäche beim Strecken der Finger', 'Weakness straightening the fingers')],
  },
};
// Der Daumen nutzt beim Endgelenk einen eigenen Namen
const THUMB_IP_NAME = L('Daumenendgelenk', 'Thumb end joint (IP)');

// ───────────────────────────── Posen & Übungen ─────────────────────────────
// f: je Finger [Grundgelenk-Beugung, Abspreizung (+ = daumenwärts), Mittelgelenk, Endgelenk] in Grad
// t: Daumen [Sattel-Beugung, Sattel-Abspreizung, Grundgelenk, Endgelenk] oder ik: Zielfinger
const POSES = {
  relaxed: { n: L('Entspannt', 'Relaxed'), w: [0, 0], t: [4, 0, 12, 10], f: [[10, -4, 16, 8], [12, 0, 20, 10], [15, 3, 24, 12], [18, 8, 28, 14]] },
  open: { n: L('Offen', 'Open'), w: [0, 0], t: [-8, 18, 0, 0], f: [[0, 10, 0, 0], [0, 2, 0, 0], [0, -6, 0, 0], [0, -14, 0, 0]] },
  fist: { n: L('Faust', 'Fist'), w: [0, 0], t: [30, -12, 42, 38], f: [[85, 0, 100, 60], [88, 0, 102, 62], [90, 0, 100, 62], [92, 0, 98, 60]] },
  hook: { n: L('Haken', 'Hook'), w: [0, 0], t: [4, 0, 10, 10], f: [[0, 0, 95, 70], [0, 0, 96, 72], [0, 0, 96, 72], [0, 0, 94, 70]] },
  point: { n: L('Zeigen', 'Point'), w: [0, 0], t: [28, -10, 38, 30], f: [[0, 2, 0, 0], [88, 0, 102, 62], [90, 0, 100, 62], [92, 0, 98, 60]] },
  pinch: { n: L('Pinzettengriff', 'Pinch'), w: [0, 0], ik: 1, f: [[58, 2, 62, 26], [42, 0, 52, 20], [46, 0, 56, 22], [50, 0, 58, 24]] },
};
const POSE_ORDER = ['relaxed', 'open', 'fist', 'hook', 'point', 'pinch'];

const straight = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const all4 = (a) => [a, a, a, a];
const EXERCISES = {
  tendonGlides: {
    n: L('Sehnengleiten', 'Tendon glides'), loops: 2, view: 'thumb',
    steps: [
      { n: L('Gerade', 'Straight'), p: { t: [0, 8, 0, 0], f: straight } },
      { n: L('Hakenfaust', 'Hook fist'), p: { t: [4, 0, 10, 10], f: all4([0, 0, 95, 70]) } },
      { n: L('Volle Faust', 'Full fist'), p: { t: [30, -12, 42, 38], f: all4([88, 0, 100, 62]) } },
      { n: L('Tischplatte', 'Tabletop'), p: { t: [6, 4, 10, 6], f: all4([88, 0, 0, 0]) } },
      { n: L('Gerade Faust', 'Straight fist'), p: { t: [18, -6, 20, 10], f: all4([88, 0, 92, 0]) } },
    ],
  },
  thumbOpposition: {
    n: L('Daumen-Opposition', 'Thumb opposition'), loops: 2, view: 'palm',
    steps: [
      { n: L('Daumen zum Zeigefinger', 'Thumb to index'), p: { ik: 1, f: [[58, 2, 62, 26], [14, 0, 20, 8], [16, 0, 22, 10], [18, 0, 24, 12]] } },
      { n: L('… zum Mittelfinger', '… to middle'), p: { ik: 2, f: [[14, 0, 18, 8], [60, 0, 62, 26], [18, 0, 24, 10], [18, 0, 24, 12]] } },
      { n: L('… zum Ringfinger', '… to ring'), p: { ik: 3, f: [[10, 0, 14, 6], [16, 0, 20, 8], [62, 0, 60, 26], [24, 0, 28, 12]] } },
      { n: L('… zum kleinen Finger', '… to little finger'), p: { ik: 4, f: [[8, 0, 12, 6], [12, 0, 16, 8], [22, 0, 26, 12], [56, 4, 50, 24]] } },
      { n: L('Öffnen', 'Open'), p: { t: [-8, 18, 0, 0], f: [[0, 8, 0, 0], [0, 2, 0, 0], [0, -5, 0, 0], [0, -12, 0, 0]] } },
    ],
  },
  spread: {
    n: L('Spreizen', 'Spread'), loops: 3, view: 'palm',
    steps: [
      { n: L('Finger weit spreizen', 'Spread the fingers wide'), p: { t: [-8, 22, 0, 0], f: [[0, 14, 0, 0], [0, 3, 0, 0], [0, -8, 0, 0], [0, -18, 0, 0]] } },
      { n: L('Finger schliessen', 'Bring them together'), p: { t: [2, 0, 4, 2], f: [[0, -7, 0, 0], [0, 0, 0, 0], [0, 5, 0, 0], [0, 12, 0, 0]] } },
    ],
  },
  blocking: {
    n: L('Blocking', 'Blocking'), loops: 2, view: 'thumb',
    steps: [
      { n: L('Nur Mittelgelenke beugen', 'Bend only the middle joints'), p: { t: [4, 0, 8, 4], f: all4([0, 0, 90, 18]) } },
      { n: L('Strecken', 'Straighten'), p: { t: [0, 6, 0, 0], f: straight } },
      { n: L('Nur Endgelenke beugen', 'Bend only the end joints'), p: { t: [4, 0, 8, 30], f: all4([0, 0, 6, 62]) } },
      { n: L('Strecken', 'Straighten'), p: { t: [0, 6, 0, 0], f: straight } },
    ],
  },
  nerveGlide: {
    n: L('Nervengleiten', 'Nerve glide'), loops: 2, view: 'thumb',
    steps: [
      { n: L('Faust, Handgelenk neutral', 'Fist, wrist neutral'), p: { w: [0, 0], t: [30, -12, 42, 38], f: all4([88, 0, 100, 62]) } },
      { n: L('Finger und Daumen strecken', 'Straighten fingers and thumb'), p: { w: [0, 0], t: [0, 0, 0, 0], f: straight } },
      { n: L('Handgelenk nach hinten', 'Bend the wrist back'), p: { w: [-55, 0], t: [0, 0, 0, 0], f: straight } },
      { n: L('Daumen abspreizen', 'Move the thumb out'), p: { w: [-55, 0], t: [-10, 28, 0, 0], f: straight } },
    ],
  },
};
const EXERCISE_ORDER = ['tendonGlides', 'thumbOpposition', 'spread', 'blocking', 'nerveGlide'];

// ═══════════════════════════════ 3D-Kern ═══════════════════════════════
// THREE wird zur Laufzeit gesetzt (UMD-Global vom CDN).
let THREE = null;

// ───────────── Handskelett (Ruhelage, Einheiten in cm) ─────────────
// Rig-Koordinaten für eine rechte Hand in Palmaransicht:
// +X = radial (Daumenseite), +Y = distal (Richtung Fingerspitzen), +Z = palmar (Handfläche).
// Eine linke Hand entsteht durch Spiegelung (scale.x = -1).
const RIG = {
  wrist: [0.3, -2.6, 0],
  fingers: [
    null,
    { base: [1.3, -0.4, 0.05], ang: 8, tilt: 0.0, len: [6.8, 4.0, 2.4, 1.8], br: [[0.52, 0.34, 0.56], [0.5, 0.31, 0.4], [0.4, 0.26, 0.33], [0.32, 0.18, 0.27]], sk: [0.93, 0.87, 0.81, 0.74] },
    { base: [0, 0, 0], ang: 0, tilt: 0.0, len: [6.5, 4.5, 2.8, 1.9], br: [[0.53, 0.35, 0.57], [0.52, 0.32, 0.42], [0.42, 0.27, 0.34], [0.33, 0.19, 0.28]], sk: [0.96, 0.9, 0.83, 0.76] },
    { base: [-1.15, -0.2, 0.05], ang: -6, tilt: 0.03, len: [5.8, 4.2, 2.6, 1.9], br: [[0.48, 0.31, 0.52], [0.48, 0.3, 0.39], [0.39, 0.25, 0.32], [0.31, 0.18, 0.26]], sk: [0.9, 0.85, 0.79, 0.72] },
    { base: [-2.2, -0.55, 0.15], ang: -14, tilt: 0.08, len: [5.3, 3.3, 1.9, 1.7], br: [[0.46, 0.29, 0.48], [0.43, 0.27, 0.35], [0.35, 0.22, 0.29], [0.29, 0.16, 0.24]], sk: [0.82, 0.78, 0.73, 0.67] },
  ],
  thumb: { base: [2.1, -1.3, 0.9], dir: [0.55, 0.78, 0.28], pulp: [-0.75, 0, 0.66], len: [4.6, 3.2, 2.4], br: [[0.58, 0.4, 0.55], [0.52, 0.34, 0.44], [0.4, 0.23, 0.31]] },
};
const FINGER_NODES = (f) => (f === 0 ? ['tmc', 'tp1', 'tp2', 'ttip'] : ['mc' + f, 'p1_' + f, 'p2_' + f, 'p3_' + f, 'tip_' + f]);

// ───────────── Vektor-Kleinkram ohne Allokation ─────────────
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ───────────── Distanzfeld-Primitive (Inigo Quilez) ─────────────
function sdRoundCone(px, py, pz, bx, by, bz, r1, r2) { // a im Ursprung
  const l2 = bx * bx + by * by + bz * bz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const y = px * bx + py * by + pz * bz;
  const z = y - l2;
  const xx = px * l2 - bx * y, xy = py * l2 - by * y, xz = pz * l2 - bz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
// Rahmen: X (Breite), Y (Achse), Z (Dicke). kz < 1 = flacher.
function primCone(a, b, r1, r2, X, Z, kz = 1) {
  const Y = vnorm(vsub(b, a));
  const Xo = vnorm(vsub(X, vmul(Y, vdot(X, Y))));
  const Zo = Z ? vnorm(vsub(vsub(Z, vmul(Y, vdot(Z, Y))), vmul(Xo, vdot(Z, Xo)))) : vcross(Xo, Y);
  const d = vsub(b, a);
  const bu = vdot(d, Xo), bv = vdot(d, Y), bw = vdot(d, Zo) / kz;
  const rm = Math.max(r1, r2) * Math.max(1, kz);
  const box = [Math.min(a[0], b[0]) - rm, Math.min(a[1], b[1]) - rm, Math.min(a[2], b[2]) - rm, Math.max(a[0], b[0]) + rm, Math.max(a[1], b[1]) + rm, Math.max(a[2], b[2]) + rm];
  return {
    box,
    f(x, y, z) {
      const dx = x - a[0], dy = y - a[1], dz = z - a[2];
      const u = dx * Xo[0] + dy * Xo[1] + dz * Xo[2];
      const v = dx * Y[0] + dy * Y[1] + dz * Y[2];
      const w = (dx * Zo[0] + dy * Zo[1] + dz * Zo[2]) / kz;
      return sdRoundCone(u, v, w, bu, bv, bw, r1, r2) * (kz < 1 ? (0.5 + 0.5 * kz) : 1);
    },
  };
}
function primEllipsoid(c, r, X, Y) {
  const Xo = vnorm(X); const Yo = vnorm(vsub(Y, vmul(Xo, vdot(Y, Xo)))); const Zo = vcross(Xo, Yo);
  const rm = Math.max(r[0], r[1], r[2]);
  return {
    box: [c[0] - rm, c[1] - rm, c[2] - rm, c[0] + rm, c[1] + rm, c[2] + rm],
    f(x, y, z) {
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      const u = (dx * Xo[0] + dy * Xo[1] + dz * Xo[2]);
      const v = (dx * Yo[0] + dy * Yo[1] + dz * Yo[2]);
      const w = (dx * Zo[0] + dy * Zo[1] + dz * Zo[2]);
      const k0 = Math.hypot(u / r[0], v / r[1], w / r[2]);
      const k1 = Math.hypot(u / (r[0] * r[0]), v / (r[1] * r[1]), w / (r[2] * r[2]));
      return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1], r[2]);
    },
  };
}
function primRoundBox(c, b, rad, angZ) {
  const cs = Math.cos(angZ), sn = Math.sin(angZ);
  const rm = Math.hypot(b[0], b[1]) + rad;
  return {
    box: [c[0] - rm, c[1] - rm, c[2] - b[2] - rad, c[0] + rm, c[1] + rm, c[2] + b[2] + rad],
    f(x, y, z) {
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      const u = Math.abs(dx * cs + dy * sn) - b[0];
      const v = Math.abs(-dx * sn + dy * cs) - b[1];
      const w = Math.abs(dz) - b[2];
      const o = Math.hypot(Math.max(u, 0), Math.max(v, 0), Math.max(w, 0));
      return o + Math.min(Math.max(u, Math.max(v, w)), 0) - rad;
    },
  };
}
function groupEval(prims, k, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i]; const b = p.box;
    if (x < b[0] - k || y < b[1] - k || z < b[2] - k || x > b[3] + k || y > b[4] + k || z > b[5] + k) continue;
    const di = p.f(x, y, z);
    d = d === 1e9 ? di : smin(d, di, k);
  }
  return d;
}

// ───────────── Surface Nets (naiv) ─────────────
async function surfaceNets(sdf, min, max, h, onProgress) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const field = new Float32Array(nx * ny * nz);
  const I = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * h;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h;
      for (let i = 0; i < nx; i++) field[I(i, j, k)] = sdf(min[0] + i * h, y, z);
    }
    if (k % 6 === 5) { onProgress?.(0.1 + 0.5 * k / nz); await new Promise((r) => setTimeout(r, 0)); }
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const CI = (i, j, k) => i + cx * (j + cy * k);
  const pos = [];
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const ed = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float64Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { val[c] = field[I(i + co[c][0], j + co[c][1], k + co[c][2])]; if (val[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = ed[e][0], b = ed[e][1];
      if ((val[a] < 0) === (val[b] < 0)) continue;
      const t = val[a] / (val[a] - val[b]);
      sx += co[a][0] + (co[b][0] - co[a][0]) * t;
      sy += co[a][1] + (co[b][1] - co[a][1]) * t;
      sz += co[a][2] + (co[b][2] - co[a][2]) * t;
      n++;
    }
    cell[CI(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
  }
  const idx = [];
  const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; idx.push(a, b, c, a, c, d); };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = field[I(i, j, k)];
    const in0 = v0 < 0;
    if (i < cx && j >= 1 && k >= 1 && j < cy && k < cz) {
      if (in0 !== (field[I(i + 1, j, k)] < 0)) {
        const a = cell[CI(i, j - 1, k - 1)], b = cell[CI(i, j, k - 1)], c = cell[CI(i, j, k)], d = cell[CI(i, j - 1, k)];
        if (in0) quad(a, b, c, d); else quad(a, d, c, b);
      }
    }
    if (j < cy && i >= 1 && k >= 1 && i < cx && k < cz) {
      if (in0 !== (field[I(i, j + 1, k)] < 0)) {
        const a = cell[CI(i - 1, j, k - 1)], b = cell[CI(i - 1, j, k)], c = cell[CI(i, j, k)], d = cell[CI(i, j, k - 1)];
        if (in0) quad(a, b, c, d); else quad(a, d, c, b);
      }
    }
    if (k < cz && i >= 1 && j >= 1 && i < cx && j < cy) {
      if (in0 !== (field[I(i, j, k + 1)] < 0)) {
        const a = cell[CI(i - 1, j - 1, k)], b = cell[CI(i, j - 1, k)], c = cell[CI(i, j, k)], d = cell[CI(i - 1, j, k)];
        if (in0) quad(a, b, c, d); else quad(a, d, c, b);
      }
    }
  }
  return { pos, idx };
}

function sdfGrad(sdf, x, y, z, e = 0.02) {
  return [
    sdf(x + e, y, z) - sdf(x - e, y, z),
    sdf(x, y + e, z) - sdf(x, y - e, z),
    sdf(x, y, z + e) - sdf(x, y, z - e),
  ];
}

// Punkt entlang einer Richtung auf die Hautoberfläche schieben (Ruhelage)
function snapToSurface(sdf, p, n, out = 0.12) {
  const at = (t) => sdf(p[0] + n[0] * t, p[1] + n[1] * t, p[2] + n[2] * t);
  let t0 = 0, f0 = at(0);
  const step = 0.05;
  if (f0 < 0) {
    for (let t = step; t < 6; t += step) { const f = at(t); if (f >= 0) { let a = t - step, b = t; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (at(m) < 0) a = m; else b = m; } t0 = b; break; } }
  } else {
    for (let t = -step; t > -6; t -= step) { const f = at(t); if (f < 0) { let a = t, b = t + step; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (at(m) < 0) a = m; else b = m; } t0 = b; break; } }
  }
  return [p[0] + n[0] * (t0 + out), p[1] + n[1] * (t0 + out), p[2] + n[2] * (t0 + out)];
}

// ───────────── Röhren (Sehnen, Nerven, Gefässe, Muskeln, Faszien) ─────────────
// Punkte hängen an Knochen; bei jeder Pose wird die Röhre neu geformt.
class TubeGeo {
  constructor(def) {
    this.def = def;
    this.R = def.rad || 8;
    this.seg = def.seg || 5;
    this.np = def.pts.length;
    this.nSamp = (this.np - 1) * this.seg + 1;
    this.capS = def.cap ? (def.cap[0] ? 4 : 0) : 0;
    this.capE = def.cap ? (def.cap[1] ? 4 : 0) : 0;
    this.rings = this.nSamp + this.capS + this.capE;
    const nv = this.rings * (this.R + 1);
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    for (let r = 0; r < this.rings; r++) for (let j = 0; j <= this.R; j++) {
      const o = (r * (this.R + 1) + j) * 2; uv[o] = j / this.R; uv[o + 1] = r / (this.rings - 1);
    }
    const idx = [];
    for (let r = 0; r < this.rings - 1; r++) for (let j = 0; j < this.R; j++) {
      const a = r * (this.R + 1) + j, b = a + this.R + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 60);
    this.geo = g;
    // Arbeitsspeicher
    this.P = new Float64Array(this.np * 3); this.Wd = new Float64Array(this.np * 3);
    this.S = new Float64Array(this.nSamp * 3); this.SW = new Float64Array(this.nSamp * 3);
    this.SA = new Float64Array(this.nSamp); this.SB = new Float64Array(this.nSamp);
    // Querschnitt vorberechnen
    const e = def.e || 2;
    this.cs = []; for (let j = 0; j <= this.R; j++) {
      const th = (j / this.R) * Math.PI * 2; const c = Math.cos(th), s = Math.sin(th);
      const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / e), py = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
      const qx = Math.sign(c) * Math.pow(Math.abs(c), 2 - 2 / e), qy = Math.sign(s) * Math.pow(Math.abs(s), 2 - 2 / e);
      this.cs.push([px, py, qx, qy]);
    }
  }
  // pts: aufgelöste Punkte in Rig-Koordinaten [x,y,z], axes: Breitenachsen
  update(pts, axes) {
    const { np, seg, P, Wd, S, SW, SA, SB, def } = this;
    for (let i = 0; i < np; i++) { P[i * 3] = pts[i][0]; P[i * 3 + 1] = pts[i][1]; P[i * 3 + 2] = pts[i][2]; Wd[i * 3] = axes[i][0]; Wd[i * 3 + 1] = axes[i][1]; Wd[i * 3 + 2] = axes[i][2]; }
    const gp = (i, o) => {
      if (i < 0) return 2 * P[o] - P[3 + o];
      if (i >= np) return 2 * P[(np - 1) * 3 + o] - P[(np - 2) * 3 + o];
      return P[i * 3 + o];
    };
    let s = 0;
    for (let i = 0; i < np - 1; i++) {
      const p0 = [gp(i - 1, 0), gp(i - 1, 1), gp(i - 1, 2)], p1 = [gp(i, 0), gp(i, 1), gp(i, 2)], p2 = [gp(i + 1, 0), gp(i + 1, 1), gp(i + 1, 2)], p3 = [gp(i + 2, 0), gp(i + 2, 1), gp(i + 2, 2)];
      const t0 = 0, t1 = t0 + Math.sqrt(Math.max(vlen(vsub(p1, p0)), 1e-4));
      const t2 = t1 + Math.sqrt(Math.max(vlen(vsub(p2, p1)), 1e-4)), t3 = t2 + Math.sqrt(Math.max(vlen(vsub(p3, p2)), 1e-4));
      const ai = def.pts[i], bi = def.pts[i + 1];
      const aA = ai.a ?? ai.r ?? def.a ?? def.r ?? 0.12, aB = bi.a ?? bi.r ?? def.a ?? def.r ?? 0.12;
      const bA = ai.b ?? ai.r ?? def.b ?? aA, bB = bi.b ?? bi.r ?? def.b ?? aB;
      const last = i === np - 2 ? seg : seg - 1;
      for (let q = 0; q <= last; q++) {
        const u = q / seg; const t = t1 + (t2 - t1) * u;
        for (let o = 0; o < 3; o++) {
          const A1 = ((t1 - t) * p0[o] + (t - t0) * p1[o]) / (t1 - t0);
          const A2 = ((t2 - t) * p1[o] + (t - t1) * p2[o]) / (t2 - t1);
          const A3 = ((t3 - t) * p2[o] + (t - t2) * p3[o]) / (t3 - t2);
          const B1 = ((t2 - t) * A1 + (t - t0) * A2) / (t2 - t0);
          const B2 = ((t3 - t) * A2 + (t - t1) * A3) / (t3 - t1);
          S[s * 3 + o] = ((t2 - t) * B1 + (t - t1) * B2) / (t2 - t1);
          SW[s * 3 + o] = Wd[i * 3 + o] * (1 - u) + Wd[(i + 1) * 3 + o] * u;
        }
        const us = u * u * (3 - 2 * u);
        SA[s] = aA + (aB - aA) * us; SB[s] = bA + (bB - bA) * us;
        s++;
      }
    }
    // Profil (Spindel für Muskelbäuche)
    const N = this.nSamp;
    if (def.prof === 'spindle') {
      const rmin = def.rmin ?? 0.18;
      for (let i = 0; i < N; i++) { const t = i / (N - 1); const k = rmin + (1 - rmin) * Math.pow(Math.sin(Math.PI * t), 0.75); SA[i] *= k; SB[i] *= k; }
    }
    // Ringe
    const R = this.R, pos = this.pos, nrm = this.nrm, cs = this.cs;
    let ring = 0;
    let pW = null;
    const T = [0, 0, 0], W = [0, 0, 0], Nn = [0, 0, 0];
    const frameAt = (i) => {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      T[0] = S[b * 3] - S[a * 3]; T[1] = S[b * 3 + 1] - S[a * 3 + 1]; T[2] = S[b * 3 + 2] - S[a * 3 + 2];
      let l = Math.hypot(T[0], T[1], T[2]) || 1; T[0] /= l; T[1] /= l; T[2] /= l;
      W[0] = SW[i * 3]; W[1] = SW[i * 3 + 1]; W[2] = SW[i * 3 + 2];
      const d = W[0] * T[0] + W[1] * T[1] + W[2] * T[2];
      W[0] -= T[0] * d; W[1] -= T[1] * d; W[2] -= T[2] * d;
      l = Math.hypot(W[0], W[1], W[2]);
      if (l < 0.15) {
        // Breitenachse fast parallel zur Röhre: vorherige Achse oder beliebige Senkrechte nehmen
        let r = pW || (Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]);
        const d2 = r[0] * T[0] + r[1] * T[1] + r[2] * T[2];
        W[0] = r[0] - T[0] * d2; W[1] = r[1] - T[1] * d2; W[2] = r[2] - T[2] * d2;
        l = Math.hypot(W[0], W[1], W[2]);
        if (l < 1e-4) { r = Math.abs(T[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const d3 = r[0] * T[0] + r[1] * T[1] + r[2] * T[2]; W[0] = r[0] - T[0] * d3; W[1] = r[1] - T[1] * d3; W[2] = r[2] - T[2] * d3; l = Math.hypot(W[0], W[1], W[2]); }
      }
      W[0] /= l; W[1] /= l; W[2] /= l;
      pW = [W[0], W[1], W[2]];
      Nn[0] = T[1] * W[2] - T[2] * W[1]; Nn[1] = T[2] * W[0] - T[0] * W[2]; Nn[2] = T[0] * W[1] - T[1] * W[0];
    };
    const writeRing = (cx, cy, cz, a, b, capPhi, capDir) => {
      const cp = Math.cos(capPhi), sp = Math.sin(capPhi);
      for (let j = 0; j <= R; j++) {
        const c = cs[j];
        const x = a * c[0] * cp, y = b * c[1] * cp;
        const o = (ring * (R + 1) + j) * 3;
        pos[o] = cx + W[0] * x + Nn[0] * y; pos[o + 1] = cy + W[1] * x + Nn[1] * y; pos[o + 2] = cz + W[2] * x + Nn[2] * y;
        let nx = c[2] / a, ny = c[3] / b; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        let qx = (W[0] * nx + Nn[0] * ny) * cp + T[0] * sp * capDir;
        let qy = (W[1] * nx + Nn[1] * ny) * cp + T[1] * sp * capDir;
        let qz = (W[2] * nx + Nn[2] * ny) * cp + T[2] * sp * capDir;
        const ql = Math.hypot(qx, qy, qz) || 1;
        nrm[o] = qx / ql; nrm[o + 1] = qy / ql; nrm[o + 2] = qz / ql;
      }
      ring++;
    };
    const capF = def.capF ?? 1;
    if (this.capS) {
      frameAt(0);
      const a = SA[0], b = SB[0], L = Math.min(a, b) * capF;
      for (let k = this.capS; k >= 1; k--) {
        const phi = (k / this.capS) * Math.PI / 2 * 0.999;
        writeRing(S[0] - T[0] * L * Math.sin(phi), S[1] - T[1] * L * Math.sin(phi), S[2] - T[2] * L * Math.sin(phi), a, b, phi, -1);
      }
    }
    for (let i = 0; i < N; i++) { frameAt(i); writeRing(S[i * 3], S[i * 3 + 1], S[i * 3 + 2], SA[i], SB[i], 0, 1); }
    if (this.capE) {
      frameAt(N - 1);
      const a = SA[N - 1], b = SB[N - 1], L = Math.min(a, b) * capF;
      for (let k = 1; k <= this.capE; k++) {
        const phi = (k / this.capE) * Math.PI / 2 * 0.999;
        writeRing(S[(N - 1) * 3] + T[0] * L * Math.sin(phi), S[(N - 1) * 3 + 1] + T[1] * L * Math.sin(phi), S[(N - 1) * 3 + 2] + T[2] * L * Math.sin(phi), a, b, phi, 1);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}

// ───────────── Knochen-Geometrie ─────────────
function boneProfile(L, rb, rs, rh, tuft) {
  const P = tuft
    ? [[0, 0], [0.015, 0.6 * rb], [0.05, 0.92 * rb], [0.1, rb], [0.2, 0.85 * rb], [0.38, rs], [0.62, rs * 0.95], [0.78, rs * 1.05], [0.88, rh], [0.94, rh * 0.95], [0.975, rh * 0.7], [1, 0]]
    : [[0, 0], [0.012, 0.55 * rb], [0.035, 0.86 * rb], [0.07, rb], [0.14, 0.96 * rb], [0.28, rb * 0.2 + rs * 0.8], [0.4, rs], [0.6, rs * 0.97], [0.74, rs * 1.05], [0.84, rs * 0.25 + rh * 0.75], [0.91, rh], [0.955, rh * 0.86], [0.985, rh * 0.52], [1, 0]];
  return P.map(([t, r]) => new THREE.Vector2(Math.max(r, 0.0001), t * L));
}
function longBoneGeo(L, rb, rs, rh, opt = {}) {
  const g = new THREE.LatheGeometry(boneProfile(L, rb, rs, rh, opt.tuft), 18);
  const kz = opt.kz ?? 0.8;
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const cb = new THREE.Color(MATC.bone).convertSRGBToLinear(), cc = new THREE.Color(MATC.cartilage).convertSRGBToLinear();
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, p.getZ(i) * kz);
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i) / kz; const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
    const t = p.getY(i) / L;
    let m = 0;
    if (!opt.noCartBase && t < 0.06) m = 1 - t / 0.06;
    if (!opt.noCartHead && t > 0.9) m = Math.max(m, (t - 0.9) / 0.1);
    m = Math.min(1, m * 1.6);
    const c = cb.clone().lerp(cc, m);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function blobGeo(r, seed = 1) {
  const g = new THREE.SphereGeometry(1, 22, 16);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const cb = new THREE.Color(MATC.bone).convertSRGBToLinear();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const w = 1 + 0.07 * Math.sin(x * 3.1 + seed) * Math.cos(y * 2.7 + seed * 1.7) + 0.04 * Math.sin(z * 4.3 + seed * 0.3);
    p.setXYZ(i, x * r[0] * w, y * r[1] * w, z * r[2] * w);
    col[i * 3] = cb.r; col[i * 3 + 1] = cb.g; col[i * 3 + 2] = cb.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function latheRig(profile, cx, kz, cartAbove) {
  const g = new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0001), y)), 22);
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const cb = new THREE.Color(MATC.bone).convertSRGBToLinear(), cc = new THREE.Color(MATC.cartilage).convertSRGBToLinear();
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, p.getZ(i) * kz); p.setX(i, p.getX(i) + cx);
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i) / kz; const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
    const m = p.getY(i) > cartAbove ? 1 : 0;
    const c = cb.clone().lerp(cc, m * 0.8);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ───────────── Shader: Abtragen (Auflösen), Ausblenden, Hervorheben ─────────────
const GLSL_NOISE = `
float haHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float haNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(haHash(i), haHash(i + vec3(1,0,0)), f.x), mix(haHash(i + vec3(0,1,0)), haHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(haHash(i + vec3(0,0,1)), haHash(i + vec3(1,0,1)), f.x), mix(haHash(i + vec3(0,1,1)), haHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float haFbm(vec3 p){ return 0.62 * haNoise(p) + 0.38 * haNoise(p * 2.9 + 3.1); }
`;
// Globale Uniforms (Zeit, Farben, Ausblendbereich des Unterarms)
let GU = null;
function initGU() {
  GU = {
    time: { value: 0 },
    edge: { value: new THREE.Color(MATC.edge).convertSRGBToLinear() },
    hiCol: { value: new THREE.Color(MATC.hi).convertSRGBToLinear() },
    ghostCol: { value: new THREE.Color(MATC.skinGhost).convertSRGBToLinear() },
    fadeA: { value: -13.2 }, fadeB: { value: -8.8 },
  };
}
// kind: 0 glatt, 1 Muskel (Fasern), 2 Sehne (feine Längsstreifen)
// mode: null (Standard, wird abgetragen), 'skin' (Farb-Pass der Haut), 'depth' (Tiefen-Vorpass der Haut)
function patchMat(mat, U, kind, mode) {
  const skin = mode === 'skin', depth = mode === 'depth', peelable = !skin && !depth;
  mat.customProgramCacheKey = () => 'ha' + kind + (mode || '');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPeel = U.peel; sh.uniforms.uHi = U.hi; sh.uniforms.uTime = GU.time;
    sh.uniforms.uEdge = GU.edge; sh.uniforms.uHiCol = GU.hiCol; sh.uniforms.uFadeA = GU.fadeA; sh.uniforms.uFadeB = GU.fadeB;
    if (skin) { sh.uniforms.uSkinA = U.skinA; sh.uniforms.uGhost = U.ghost; sh.uniforms.uGhostCol = GU.ghostCol; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHaObj;\nvarying vec2 vHaUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHaObj = position;\nvHaUv = uv;');
    let frag = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHaObj;\nvarying vec2 vHaUv;\nuniform float uPeel;\nuniform float uHi;\nuniform float uTime;\nuniform float uFadeA;\nuniform float uFadeB;\nuniform vec3 uEdge;\nuniform vec3 uHiCol;\n'
        + (skin ? 'uniform float uSkinA;\nuniform float uGhost;\nuniform vec3 uGhostCol;\n' : '') + GLSL_NOISE)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float haN = haFbm(vHaObj * 1.3);
        float haFade = smoothstep(uFadeA, uFadeB, vHaObj.y);
        if (haN * 0.96 + 0.02 > haFade) discard;
        float haThr = uPeel * 1.12 - 0.06;
        ${peelable ? 'if (haN < haThr) discard;' : ''}
        float haEdge = ${peelable ? '(uPeel > 0.001) ? (1.0 - smoothstep(0.0, 0.07, haN - haThr)) : 0.0' : '0.0'};
      `);
    if (kind === 1) frag = frag.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.8 + 0.2 * (0.5 + 0.5 * sin(vHaUv.x * 6.2831 * 24.0 + haN * 3.0));\n diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(0.1, 0.5, abs(vHaUv.y - 0.5));');
    if (kind === 2) frag = frag.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.92 + 0.08 * (0.5 + 0.5 * sin(vHaUv.x * 6.2831 * 12.0));');
    if (!depth) frag = frag.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uEdge * haEdge * 1.8 + uHiCol * uHi * (0.5 + 0.35 * sin(uTime * 4.0));');
    if (skin) {
      frag = frag.replace('#include <tonemapping_fragment>', `
        float haFres = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 2.0);
        float haGA = uGhost * (0.06 + 0.6 * haFres);
        vec3 haGC = uGhostCol * (0.2 + 1.4 * haFres);
        gl_FragColor.rgb = mix(haGC, gl_FragColor.rgb, uSkinA);
        gl_FragColor.a = max(uSkinA, haGA);
        #include <tonemapping_fragment>`);
    }
    sh.fragmentShader = frag;
  };
  return mat;
}

// ───────────── Anatomie-Definitionen ─────────────
// Ankerpunkte: W/F = Rig-Koordinaten an Handwurzel ('wr') bzw. Unterarm ('fa'); A = lokal am Knochen.
const W = (x, y, z, o) => ({ n: 'wr', p: [x, y, z], sp: 'rig', ...(o || {}) });
const F = (x, y, z, o) => ({ n: 'fa', p: [x, y, z], sp: 'rig', ...(o || {}) });
const A = (n, x, y, z, o) => ({ n, p: [x, y, z], sp: 'loc', ...(o || {}) });
const LF = (f) => (f === 0 ? RIG.thumb.len : RIG.fingers[f].len);

function buildTubeDefs() {
  const D = [];
  const T = (o) => D.push(o);
  const Lt = RIG.thumb.len;

  // ── Faszien & Retinakula ──
  T({ id: 'tcl', s: 'tcl', l: 'fascia', m: 'fascia', a: 1.05, b: 0.11, ax: [0, 1, 0], rad: 12, seg: 6, cap: [1, 1], capF: 2.5,
    pts: [W(2.05, -1.3, 1.02), W(1.25, -1.2, 1.42), W(0.25, -1.15, 1.55), W(-0.75, -1.15, 1.45), W(-1.35, -1.2, 1.1)] });
  T({ id: 'extret', s: 'ext_ret', l: 'fascia', m: 'fascia', a: 0.95, b: 0.1, ax: [0, 1, 0], rad: 12, seg: 6, cap: [1, 1], capF: 2.5,
    pts: [F(2.6, -2.95, 0.35), F(1.8, -2.9, -1.22), F(0.4, -2.85, -1.7), F(-1.1, -2.85, -1.52), F(-2.3, -2.85, -0.45)] });
  T({ id: 'pa_c', s: 'palmar_apo', l: 'fascia', m: 'fascia', b: 0.05, rad: 10, seg: 6, e: 2.6, cap: [1, 1], capF: 1,
    pts: [W(0.3, -0.9, 1.45, { a: 0.3 }), W(0.1, 1.2, 1.3, { a: 1.6 }), W(-0.35, 3.3, 1.18, { a: 2.5 })] });
  for (let f = 1; f <= 4; f++) {
    const Lm = LF(f)[0];
    T({ id: 'pa_' + f, s: 'palmar_apo', f, l: 'fascia', m: 'fascia', b: 0.045, rad: 8, seg: 5, cap: [1, 1], capF: 1,
      pts: [W(0.2, 0.6, 1.35, { a: 0.25 }), A('mc' + f, 0, Lm * 0.62, 1.05, { a: 0.42 }), A('mc' + f, 0, Lm + 0.15, 0.95, { a: 0.34 })] });
  }

  // ── Muskeln ──
  const M = (id, s, pts, r, o = {}) => T({ id, s, l: 'muscles', m: 'muscle', prof: 'spindle', rmin: 0.2, a: r, b: o.b ?? r * 0.8, rad: 12, seg: 6, cap: [1, 1], ...o, pts });
  M('fcr_m', 'flexors_fa', [F(1.3, -16, 1.2), F(1.5, -10, 1.3), F(1.6, -6.2, 1.15)], 0.72);
  M('pl_m', 'flexors_fa', [F(0.3, -16, 1.65), F(0.3, -8.2, 1.6)], 0.45);
  M('fcu_m', 'flexors_fa', [F(-1.95, -16, 0.7), F(-1.85, -8, 0.75), F(-1.7, -4.6, 0.8)], 0.66);
  M('fds_m', 'flexors_fa', [F(-0.2, -16, 1.0), F(0, -9, 1.0), F(0.15, -5.6, 0.95)], 1.25, { b: 0.72 });
  M('fdp_m', 'flexors_fa', [F(-0.9, -16, 0.25), F(-0.7, -8, 0.35), F(-0.4, -4.8, 0.42)], 1.1, { b: 0.7 });
  M('fpl_m', 'flexors_fa', [F(1.25, -16, 0.35), F(1.3, -8, 0.45), F(1.35, -4.9, 0.55)], 0.62);
  M('pq', 'pronator_q', [F(-2.0, -4.35, 0.5), F(-0.4, -4.15, 0.78), F(1.3, -4.05, 0.72), F(2.15, -4.15, 0.35)], 0.62, { b: 0.22, ax: [0, 1, 0], prof: null });
  M('ecr_m', 'extensors_fa', [F(2.25, -16, -0.35), F(2.3, -10, -0.5), F(1.95, -6.6, -0.85)], 0.78);
  M('edc_m', 'extensors_fa', [F(0, -16, -1.35), F(0.1, -9.5, -1.4), F(0.2, -6.3, -1.3)], 1.15, { b: 0.6 });
  M('ecu_m', 'extensors_fa', [F(-1.9, -16, -0.75), F(-1.88, -9, -0.78), F(-1.9, -5.6, -0.7)], 0.62);
  M('aplepb_m', 'extensors_fa', [F(0.5, -13.5, -1.3), F(1.8, -8.5, -1.05), F(2.5, -5.3, -0.35)], 0.62);
  M('epl_m', 'extensors_fa', [F(0.35, -13.5, -1.05), F(0.45, -6.2, -1.1)], 0.42);
  M('apb', 'thenar_m', [W(1.95, -1.55, 1.3), A('tmc', 0.35, 2.3, 0.55), A('tp1', 0.42, 0.35, 0.2)], 0.5, { f: 0 });
  M('fpb', 'thenar_m', [W(1.25, -1.0, 1.4), A('tmc', -0.1, 2.5, 0.62), A('tp1', 0.05, 0.3, 0.4)], 0.46, { f: 0 });
  M('op', 'thenar_m', [W(2.05, -0.9, 0.95), A('tmc', 0.35, 2.4, 0.15), A('tmc', 0.42, 4.0, 0.05)], 0.42, { f: 0 });
  M('adp_o', 'adductor', [W(0.45, -0.4, 0.8), W(1.9, 1.2, 1.0), A('tp1', -0.45, 0.3, 0.15)], 0.5, { b: 0.3, f: 0 });
  M('adp_t', 'adductor', [A('mc2', 0, 3.9, 0.45), A('mc1', 0.5, 3.3, 0.2), A('tp1', -0.42, 0.35, 0.05)], 0.45, { b: 0.22, rmin: 0.3, f: 0 });
  M('adm', 'hypothenar_m', [W(-1.35, -1.6, 0.95), A('mc4', -0.6, 2.2, 0.45), A('p1_4', -0.42, 0.35, 0.1)], 0.55, { f: 4 });
  M('fdm', 'hypothenar_m', [W(-1.25, -0.45, 0.95), A('mc4', -0.2, 3.2, 0.62), A('p1_4', -0.25, 0.35, 0.35)], 0.4, { f: 4 });
  M('odm', 'hypothenar_m', [W(-1.4, -0.55, 0.75), A('mc4', -0.35, LF(4)[0] * 0.75, 0.28)], 0.42, { f: 4 });
  for (let f = 1; f <= 4; f++) {
    const Lm = LF(f)[0];
    M('lum' + f, 'lumbricals', [A('mc' + f, 0.28, Lm * 0.32, 0.62), A('mc' + f, 0.5, Lm * 0.85, 0.42), A('p1_' + f, 0.44, 0.9, 0.05)], 0.22, { f, rmin: 0.25 });
  }
  M('di1', 'interossei', [A('tmc', -0.35, 0.8, -0.2), A('mc1', 0.55, 2.2, -0.25), A('p1_1', 0.46, 0.55, -0.08)], 0.55, { f: 1, b: 0.45 });
  M('di2', 'interossei', [A('mc1', -0.55, 0.8, -0.3), A('mc1', -0.62, 4.2, -0.35), A('p1_2', 0.46, 0.5, -0.08)], 0.38, { f: 2, b: 0.5 });
  M('di3', 'interossei', [A('mc2', -0.55, 0.8, -0.3), A('mc2', -0.62, 4.0, -0.35), A('p1_2', -0.46, 0.5, -0.08)], 0.36, { f: 2, b: 0.48 });
  M('di4', 'interossei', [A('mc3', -0.55, 0.6, -0.3), A('mc3', -0.62, 3.6, -0.35), A('p1_3', -0.46, 0.5, -0.08)], 0.34, { f: 3, b: 0.46 });
  M('pi1', 'interossei', [A('mc1', -0.45, 1.3, 0.35), A('mc1', -0.5, 4.6, 0.32), A('p1_1', -0.44, 0.5, 0.1)], 0.3, { f: 1 });
  M('pi2', 'interossei', [A('mc3', 0.45, 1.1, 0.35), A('mc3', 0.5, 4.0, 0.32), A('p1_3', 0.44, 0.5, 0.1)], 0.28, { f: 3 });
  M('pi3', 'interossei', [A('mc4', 0.45, 0.9, 0.38), A('mc4', 0.5, 3.6, 0.35), A('p1_4', 0.42, 0.5, 0.1)], 0.27, { f: 4 });

  // ── Sehnen & Sehnenscheiden ──
  const TD = (id, s, pts, r, o = {}) => T({ id, s, l: 'tendons', m: 'tendon', a: r, b: o.b ?? r, rad: 8, seg: 5, cap: [0, 1], ...o, pts });
  const tunX = [0, 0.95, 0.35, -0.25, -0.75];
  const faX = [0, 0.55, 0.2, -0.3, -0.8];
  const dX = [0, 0.75, 0.3, -0.15, -0.6];
  for (let f = 1; f <= 4; f++) {
    const [Lm, L1, L2, L3] = LF(f);
    TD('fds' + f, 'fds', [F(faX[f], -7.2, 1.05), F(tunX[f] * 0.8, -3.6, 1.08), W(tunX[f], -1.2, 0.98), A('mc' + f, 0, Lm * 0.35, 0.74), A('mc' + f, 0, Lm * 0.82, 0.74), A('mc' + f, 0, Lm + 0.15, 0.66), A('p1_' + f, 0, L1 * 0.35, 0.5), A('p1_' + f, 0, L1 * 0.9, 0.45), A('p2_' + f, 0, 0.4, 0.36)], 0.13, { f });
    TD('fdp' + f, 'fdp', [F(faX[f] - 0.3, -6.6, 0.5), F(tunX[f] * 0.8, -3.6, 0.72), W(tunX[f] * 0.95, -1.2, 0.68), A('mc' + f, 0, Lm * 0.35, 0.55), A('mc' + f, 0, Lm * 0.82, 0.58), A('mc' + f, 0, Lm + 0.15, 0.54), A('p1_' + f, 0, L1 * 0.35, 0.4), A('p1_' + f, 0, L1 * 0.9, 0.38), A('p2_' + f, 0, 0.3, 0.4), A('p2_' + f, 0, L2 * 0.6, 0.33), A('p3_' + f, 0, 0.05, 0.3), A('p3_' + f, 0, 0.4, 0.24)], 0.14, { f });
    const PU = (id, a0, a1) => TD(id, 'pulleys', [a0, a1], 0.3, { f, b: 0.22, m: 'pulley', rad: 12, seg: 3, cap: [0, 0] });
    PU('a1_' + f, A('mc' + f, 0, Lm - 0.35, 0.62), A('p1_' + f, 0, 0.35, 0.48));
    PU('a2_' + f, A('p1_' + f, 0, L1 * 0.22, 0.44), A('p1_' + f, 0, L1 * 0.58, 0.42));
    PU('a3_' + f, A('p1_' + f, 0, L1 - 0.15, 0.42), A('p2_' + f, 0, 0.2, 0.4));
    PU('a4_' + f, A('p2_' + f, 0, L2 * 0.3, 0.37), A('p2_' + f, 0, L2 * 0.65, 0.35));
    PU('a5_' + f, A('p2_' + f, 0, L2 - 0.1, 0.33), A('p3_' + f, 0, 0.12, 0.3));
    TD('sh' + f, 'sheaths', [A('mc' + f, 0, Lm * 0.72, 0.66), A('mc' + f, 0, Lm + 0.1, 0.6), A('p1_' + f, 0, L1 * 0.5, 0.43), A('p2_' + f, 0, 0.1, 0.4), A('p2_' + f, 0, L2 * 0.6, 0.35), A('p3_' + f, 0, 0.25, 0.28)], 0.27, { f, m: 'sheath', b: 0.21, rad: 12, cap: [1, 1] });
    TD('edc' + f, 'edc', [F(faX[f] * 0.7, -6.6, -1.35), F(dX[f] * 0.9, -3.6, -1.3), W(dX[f], -2.3, -1.3), A('mc' + f, 0, 0.9, -0.62), A('mc' + f, 0, Lm * 0.6, -0.6), A('mc' + f, 0, Lm, -0.7), A('p1_' + f, 0, L1 * 0.3, -0.48), A('p1_' + f, 0, L1 * 0.85, -0.43), A('p2_' + f, 0, 0.05, -0.45), A('p2_' + f, 0, L2 * 0.55, -0.36), A('p3_' + f, 0, 0.0, -0.36), A('p3_' + f, 0, 0.35, -0.3)], 0.22, { f, b: 0.075, rad: 10, e: 2.4 });
  }
  TD('jt23', 'edc', [A('mc2', 0, LF(2)[0] * 0.72, -0.62), A('mc3', 0, LF(3)[0] * 0.66, -0.62)], 0.12, { b: 0.05, rad: 6, cap: [1, 1], ax: [0, 1, 0] });
  TD('jt34', 'edc', [A('mc3', 0, LF(3)[0] * 0.7, -0.62), A('mc4', 0, LF(4)[0] * 0.7, -0.6)], 0.12, { b: 0.05, rad: 6, cap: [1, 1], ax: [0, 1, 0] });
  TD('fpl', 'fpl', [F(1.35, -6.0, 0.6), F(1.25, -3.4, 0.82), W(1.05, -1.3, 0.72), W(1.75, -0.25, 0.95), A('tmc', -0.05, 1.6, 0.52), A('tmc', 0, 4.3, 0.55), A('tp1', 0, 0.4, 0.45), A('tp1', 0, 1.6, 0.42), A('tp1', 0, Lt[1] - 0.1, 0.4), A('tp2', 0, 0.35, 0.3)], 0.15, { f: 0 });
  TD('epl', 'epl', [F(0.45, -6.2, -1.1), F(0.62, -3.6, -1.32), W(0.72, -2.4, -1.35), W(1.45, -1.4, -0.95), A('tmc', -0.28, 1.3, -0.52), A('tmc', -0.12, 4.1, -0.58), A('tp1', 0, 1.5, -0.45), A('tp2', 0, 0.3, -0.33)], 0.12, { f: 0 });
  TD('epb', 'epb', [F(2.45, -5.4, -0.3), F(2.6, -3.6, -0.1), W(2.6, -2.3, 0.02), A('tmc', 0.38, 0.9, -0.32), A('tmc', 0.2, 4.2, -0.55), A('tp1', 0.05, 0.38, -0.45)], 0.11, { f: 0 });
  TD('apl', 'apl', [F(2.4, -5.4, -0.15), F(2.65, -3.6, 0.08), W(2.68, -2.3, 0.22), A('tmc', 0.55, 0.35, 0.02)], 0.14, { f: 0 });
  TD('fc1', 'first_comp', [F(2.62, -3.5, 0.0), W(2.66, -1.95, 0.12)], 0.42, { m: 'sheath', b: 0.34, rad: 12, seg: 3, cap: [1, 1] });
  TD('a1_0', 'pulleys', [A('tmc', 0, Lt[0] - 0.35, 0.58), A('tp1', 0, 0.38, 0.47)], 0.3, { f: 0, b: 0.22, m: 'pulley', rad: 12, seg: 3, cap: [0, 0] });
  TD('fcr', 'fcr', [F(1.6, -6.8, 1.15), F(1.75, -3.6, 1.12), W(1.85, -1.7, 0.95), W(1.45, -0.35, 0.55)], 0.16);
  TD('pl', 'pl', [F(0.3, -8.6, 1.6), F(0.3, -3.4, 1.65), W(0.3, -1.6, 1.55), W(0.25, -0.9, 1.45)], 0.1);
  TD('fcu', 'fcu', [F(-1.85, -5.2, 0.85), F(-1.6, -3.1, 0.95), W(-1.3, -1.8, 0.95)], 0.18);
  TD('ecrl', 'ecr', [F(2.0, -6.8, -0.85), F(1.75, -3.6, -1.05), W(1.55, -2.4, -1.1), W(1.35, -0.6, -0.62)], 0.15);
  TD('ecrb', 'ecr', [F(1.85, -6.8, -0.95), F(1.2, -3.6, -1.18), W(0.95, -2.4, -1.25), W(0.3, -0.3, -0.62)], 0.15);
  TD('ecu', 'ecu', [F(-2.0, -5.8, -0.78), F(-2.02, -3.4, -0.62), W(-1.9, -2.5, -0.55), W(-2.35, -0.55, -0.3)], 0.15);

  // ── Bänder (Schicht Knochen & Gelenke) ──
  const LG = (id, s, pts, r, o = {}) => T({ id, s, l: 'bones', m: 'ligament', a: r, b: o.b ?? r * 0.6, rad: 6, seg: 3, cap: [1, 1], ...o, pts });
  for (let f = 1; f <= 4; f++) {
    const [Lm, L1, L2] = LF(f);
    for (const sd of [1, -1]) {
      LG(`cl_mcp_${f}_${sd}`, 'collaterals', [A('mc' + f, sd * 0.46, Lm - 0.45, 0.02), A('p1_' + f, sd * 0.44, 0.35, 0.08)], 0.1, { f });
      LG(`cl_pip_${f}_${sd}`, 'collaterals', [A('p1_' + f, sd * 0.36, L1 - 0.3, 0.02), A('p2_' + f, sd * 0.34, 0.25, 0.06)], 0.08, { f });
      LG(`cl_dip_${f}_${sd}`, 'collaterals', [A('p2_' + f, sd * 0.3, L2 - 0.25, 0.02), A('p3_' + f, sd * 0.28, 0.2, 0.05)], 0.07, { f });
    }
    LG('vp_' + f, 'volar_plate', [A('p1_' + f, 0, L1 - 0.3, 0.3), A('p2_' + f, 0, 0.28, 0.28)], 0.28, { f, b: 0.06, rad: 8 });
  }
  LG('ucl', 'ucl_thumb', [A('tmc', -0.5, Lt[0] - 0.4, 0.05), A('tp1', -0.46, 0.4, 0.1)], 0.12, { f: 0 });
  LG('rcl', 'collaterals', [A('tmc', 0.5, Lt[0] - 0.4, 0.05), A('tp1', 0.46, 0.4, 0.1)], 0.1, { f: 0 });
  LG('sl', 'sl_lig', [W(1.15, -2.0, -0.42), W(0.75, -2.05, -0.42)], 0.22, { b: 0.08, ax: [0, 1, 0], rad: 8 });

  // ── Nerven & Gefässe ──
  const NV = (id, s, pts, r, o = {}) => T({ id, s, l: 'nerves', m: 'nerve', a: r, b: o.b ?? r, rad: 7, seg: 5, cap: [0, 1], ...o, pts });
  const dig = (id, f, side, from, s = 'digital_n', m = 'nerve', r = 0.075, xk = 1, dz = 0) => {
    const pts = [...from];
    if (f === 0) {
      pts.push(A('tmc', side * 0.45 * xk, Lt[0] * 0.7, 0.62 + dz), A('tp1', side * 0.48 * xk, Lt[1] * 0.5, 0.42 + dz), A('tp2', side * 0.42 * xk, Lt[2] * 0.3, 0.36 + dz), A('tp2', side * 0.34 * xk, Lt[2] * 0.72, 0.3 + dz));
    } else {
      const [Lm, L1, L2, L3] = LF(f);
      pts.push(A('mc' + f, side * 0.5 * xk, Lm * 0.86, 0.72 + dz), A('p1_' + f, side * 0.5 * xk, L1 * 0.5, 0.42 + dz), A('p1_' + f, side * 0.47 * xk, L1 * 0.96, 0.4 + dz), A('p2_' + f, side * 0.44 * xk, L2 * 0.5, 0.35 + dz), A('p3_' + f, side * 0.38 * xk, L3 * 0.35, 0.32 + dz), A('p3_' + f, side * 0.3 * xk, L3 * 0.72, 0.26 + dz));
    }
    NV(id, s, pts, r, { f, m });
  };
  NV('median', 'median', [F(0.25, -16, 0.8), F(0.35, -8, 0.9), F(0.45, -3.6, 1.15), W(0.55, -1.8, 1.22), W(0.55, -0.6, 1.22), W(0.5, 0.55, 1.15)], 0.2, { a: 0.24, b: 0.16 });
  NV('median_rec', 'median', [W(0.6, 0.3, 1.2), W(1.45, 0.15, 1.35), A('tmc', -0.25, 1.5, 0.95)], 0.07, { f: 0 });
  const mc1web = A('mc1', -0.85, LF(1)[0] * 0.72, 0.82), mc2web = A('mc2', -0.85, LF(2)[0] * 0.72, 0.82), mc3web = A('mc3', -0.85, LF(3)[0] * 0.72, 0.82);
  dig('dn0r', 0, 1, [W(0.55, 0.5, 1.15), W(1.6, 0.9, 1.3)]);
  dig('dn0u', 0, -1, [W(0.55, 0.5, 1.15), W(1.4, 1.3, 1.2)]);
  dig('dn1r', 1, 1, [W(0.55, 0.55, 1.15), A('mc1', 0.35, LF(1)[0] * 0.45, 0.85)]);
  dig('dn1u', 1, -1, [W(0.5, 0.6, 1.15), mc1web]);
  dig('dn2r', 2, 1, [W(0.5, 0.6, 1.15), mc1web]);
  dig('dn2u', 2, -1, [W(0.45, 0.6, 1.15), mc2web]);
  dig('dn3r', 3, 1, [W(0.45, 0.6, 1.15), mc2web]);
  NV('ulnar', 'ulnar_n', [F(-1.75, -16, 0.55), F(-1.6, -8, 0.65), F(-1.4, -3.5, 0.95), W(-1.0, -1.6, 1.18), W(-1.0, -0.45, 1.25)], 0.18);
  NV('ulnar_deep', 'ulnar_n', [W(-1.0, -0.45, 1.2), W(-1.35, 0.35, 0.62), W(-0.2, 1.5, 0.4), W(1.3, 1.5, 0.55), W(2.0, 1.0, 0.75)], 0.07, { ax: [0, 0, 1] });
  NV('ulnar_dors', 'ulnar_n', [F(-1.6, -7, 0.4), F(-2.4, -4.6, -0.35), W(-2.4, -1.6, -0.85), A('mc4', -0.35, LF(4)[0] * 0.55, -0.72)], 0.06);
  dig('dn3u', 3, -1, [W(-1.0, -0.4, 1.22), mc3web]);
  dig('dn4r', 4, 1, [W(-1.0, -0.4, 1.22), mc3web]);
  dig('dn4u', 4, -1, [W(-1.05, -0.4, 1.22), A('mc4', -0.55, LF(4)[0] * 0.5, 0.8)]);
  NV('radsup', 'radial_sup', [F(2.3, -12, -0.15), F(2.6, -6.5, -0.35), F(2.7, -3.6, -0.55), W(2.55, -1.9, -0.78), A('tmc', 0.25, 2.0, -0.72), A('tp1', 0.3, Lt[1] * 0.5, -0.5)], 0.07, { f: 0 });
  NV('radsup2', 'radial_sup', [W(2.55, -1.9, -0.78), W(2.2, -1.0, -0.85), A('mc1', 0.3, LF(1)[0] * 0.5, -0.72), A('p1_1', 0.42, LF(1)[1] * 0.5, -0.42)], 0.06, { f: 1 });
  NV('rad_a', 'radial_a', [F(1.95, -16, 0.72), F(2.05, -7, 0.95), F(2.15, -3.6, 1.0), W(2.5, -2.1, 0.35), W(2.62, -1.35, -0.35), W(2.15, -0.3, -0.55), A('mc1', 0.6, 1.1, -0.1), W(1.2, 0.9, 0.35), W(-0.2, 1.25, 0.32), W(-1.7, 0.9, 0.4)], 0.12, { m: 'artery', ax: [0, 0, 1] });
  NV('uln_a', 'ulnar_a', [F(-1.45, -16, 0.8), F(-1.3, -7, 0.95), F(-1.1, -3.5, 1.1), W(-0.72, -1.6, 1.32), W(-0.7, 0.1, 1.32)], 0.11, { m: 'artery' });
  NV('arch', 'palmar_arch', [W(-0.7, 0.1, 1.3), W(-1.5, 1.6, 1.22), W(-0.8, 2.9, 1.18), W(0.6, 3.1, 1.18), W(1.8, 2.3, 1.2), W(2.3, 1.3, 1.28)], 0.1, { m: 'artery', ax: [0, 0, 1] });
  const archX = [0, 1.3, 0.3, -0.7, -1.4];
  for (let f = 1; f <= 4; f++) for (const sd of [1, -1]) dig(`da${f}${sd > 0 ? 'r' : 'u'}`, f, sd, [W(archX[f] + sd * 0.25, 3.0, 1.15)], 'digital_a', 'artery', 0.055, 1.12, -0.1);
  dig('da0r', 0, 1, [W(2.2, 1.2, 1.25)], 'digital_a', 'artery', 0.055, 1.12, -0.1);
  dig('da0u', 0, -1, [W(2.0, 1.5, 1.2)], 'digital_a', 'artery', 0.055, 1.12, -0.1);
  NV('ceph', 'veins', [F(2.45, -16, -0.95), F(2.65, -7, -0.9), W(2.35, -2.1, -1.15), A('mc1', 0.35, 2.0, -0.82), A('mc1', 0, 3.4, -0.85)], 0.14, { m: 'vein' });
  NV('basil', 'veins', [F(-2.2, -16, -0.95), F(-2.3, -6.5, -1.02), W(-2.15, -1.6, -1.0), A('mc4', -0.1, 2.3, -0.78)], 0.14, { m: 'vein' });
  NV('darch', 'veins', [A('mc4', -0.1, 2.3, -0.8), A('mc3', 0, 2.9, -0.85), A('mc2', 0, 3.3, -0.88), A('mc1', 0, 3.3, -0.86)], 0.1, { m: 'vein', ax: [0, 0, 1] });
  return D;
}

// ───────────── Schmerz-Regionen mit Markern ─────────────
// Marker liegen auf der Hautoberfläche (werden beim Aufbau per Distanzfeld eingerastet).
function buildRegions() {
  const R = [];
  const rg = (id, tpl, finger, anchors) => R.push({ id, tpl, finger, anchors });
  const Ar = (n, p, nrm, sp = 'rig') => ({ n, p, nrm, sp });
  const Lt = RIG.thumb.len;
  rg('wrist_palm', 'wrist_palm', null, [Ar('wr', [0.45, -1.5, 0.3], [0, 0, 1]), Ar('fa', [0.45, -3.4, 0], [0, 0, 1])]);
  rg('wrist_back', 'wrist_back', null, [Ar('wr', [0.4, -1.9, 0], [0, 0, -1])]);
  rg('wrist_radial', 'wrist_radial', null, [Ar('fa', [1.6, -3.1, 0], [1, 0, 0.1]), Ar('wr', [1.6, -1.6, 0], [0.72, 0, -0.7])]);
  rg('wrist_ulnar', 'wrist_ulnar', null, [Ar('fa', [-1.2, -2.9, 0], [-1, 0, 0])]);
  rg('forearm_front', 'forearm_front', null, [Ar('fa', [0.4, -7.2, 0], [0, 0, 1])]);
  rg('forearm_back', 'forearm_back', null, [Ar('fa', [0.4, -7.2, 0], [0, 0, -1]), Ar('fa', [1.4, -6.4, 0], [0.7, 0, -0.7])]);
  rg('palm_center', 'palm_center', null, [Ar('wr', [-0.1, 2.7, 0], [0, 0, 1])]);
  rg('back_of_hand', 'back_of_hand', null, [Ar('wr', [0, 2.6, 0], [0, 0, -1])]);
  rg('thenar', 'thenar', 0, [Ar('tmc', [0, 2.1, 0], [-0.25, 0, 1], 'loc')]);
  rg('hypothenar', 'hypothenar', null, [Ar('wr', [-2.2, 0.9, 0.2], [-0.3, 0, 1])]);
  rg('thumb_base', 'thumb_base', 0, [Ar('tmc', [0, 0.6, 0], [0.72, 0, 0.7], 'loc'), Ar('tmc', [0, 0.6, 0], [0.72, 0, -0.7], 'loc')]);
  rg('thumb_mcp', 'thumb_mcp', 0, [Ar('tp1', [0, 0, 0], [0, 0, -1], 'loc'), Ar('tp1', [0, 0, 0], [-1, 0, 0.25], 'loc')]);
  rg('dip_0', 'dip', 0, [Ar('tp2', [0, 0, 0], [0, 0, 1], 'loc'), Ar('tp2', [0, 0, 0], [0, 0, -1], 'loc')]);
  rg('tip_0', 'fingertip', 0, [Ar('tp2', [0, Lt[2] * 0.62, 0], [0, 0, 1], 'loc'), Ar('tp2', [0, Lt[2] * 0.58, 0], [0, 0, -1], 'loc')]);
  for (let f = 1; f <= 4; f++) {
    const [Lm, L1, , L3] = LF(f);
    rg('fbase_' + f, 'finger_base', f, [Ar('mc' + f, [0, Lm - 0.05, 0], [0, 0, 1], 'loc')]);
    rg('knuckle_' + f, 'knuckle', f, [Ar('mc' + f, [0, Lm - 0.1, 0], [0, 0, -1], 'loc')]);
    rg('shaft_' + f, 'finger_shaft', f, [Ar('p1_' + f, [0, L1 * 0.5, 0], [0, 0, 1], 'loc'), Ar('p1_' + f, [0, L1 * 0.5, 0], [0, 0, -1], 'loc')]);
    rg('pip_' + f, 'pip', f, [Ar('p2_' + f, [0, 0, 0], [0, 0, 1], 'loc'), Ar('p2_' + f, [0, 0, 0], [0, 0, -1], 'loc')]);
    rg('dip_' + f, 'dip', f, [Ar('p3_' + f, [0, 0, 0], [0, 0, 1], 'loc'), Ar('p3_' + f, [0, 0, 0], [0, 0, -1], 'loc')]);
    rg('tip_' + f, 'fingertip', f, [Ar('p3_' + f, [0, L3 * 0.62, 0], [0, 0, 1], 'loc'), Ar('p3_' + f, [0, L3 * 0.58, 0], [0, 0, -1], 'loc')]);
  }
  return R;
}
const REGIONS = buildRegions();
const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const REGION_GROUPS = [
  { n: L('Handgelenk & Unterarm', 'Wrist & forearm'), ids: ['wrist_palm', 'wrist_back', 'wrist_radial', 'wrist_ulnar', 'forearm_front', 'forearm_back'] },
  { n: L('Hand', 'Hand'), ids: ['palm_center', 'back_of_hand', 'thenar', 'hypothenar'] },
  { n: FINGER_NAMES[0], ids: ['thumb_base', 'thumb_mcp', 'dip_0', 'tip_0'] },
  ...[1, 2, 3, 4].map((f) => ({ n: FINGER_NAMES[f], ids: ['fbase_', 'knuckle_', 'shaft_', 'pip_', 'dip_', 'tip_'].map((p) => p + f) })),
];
function regionName(id, lang) {
  const r = REGION_BY_ID[id]; if (!r) return '';
  if (id === 'dip_0') return tr(THUMB_IP_NAME, lang);
  return tr(REGION_TPL[r.tpl].n, lang);
}

// Handflächen-Rahmen aus Handgelenk + vier Knöcheln (Reihenfolge 0, 5, 9, 13, 17).
// Die Ebene kommt aus Newells Verfahren über alle fünf Punkte – robuster als drei Einzelpunkte,
// wenn die Tiefe einzelner Knöchel unsicher ist (z. B. eingerollte Finger beim Peace-Zeichen).
// s = +1 für eine rechte, −1 für eine linke Hand-Geometrie.
function palmFrame(P, s) {
  let n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    n = vadd(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  const palmar = vmul(vnorm(n), s);
  let distal = vsub(P[2], P[0]); distal = vnorm(vsub(distal, vmul(palmar, vdot(distal, palmar))));
  const radial = vmul(vcross(distal, palmar), s);
  return { radial, distal, palmar };
}

// ═══════════════════════════════ Engine ═══════════════════════════════
const SPOT_SVG = '<svg viewBox="-13 -13 26 26" width="26" height="26" aria-hidden="true"><circle class="ha-ring" r="8.6"/><circle class="ha-dot" r="1.7"/><path class="ha-x" d="M-3.6 -3.6L3.6 3.6M3.6 -3.6L-3.6 3.6"/></svg>';
const RING_SVG = '<svg viewBox="-20 -20 40 40" width="40" height="40" aria-hidden="true"><circle class="ha-cr-bg" r="15"/><circle class="ha-cr-fg" r="15" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90)"/><circle class="ha-cr-dot" r="4"/></svg>';

class HandEngine {
  constructor(host, overlay, opts) {
    this.host = host; this.overlay = overlay; this.opts = opts || {};
    this.reduced = !!this.opts.reduced;
    this.side = 'R';
    this.mode = 'mirror';
    this.state = { peel: 0.6, vis: [true, true, true, true, true, true], ghost: true, spots: true };
    this.peelCur = 0.6;
    this.selected = null; this.hover = null; this.hoverSrc = null;
    this.painMarks = {};
    this.hiReq = { region: null, struct: null };
    this.meshes = []; this.tubes = [];
    this.yaw = 0.35; this.pitch = 0.12; this.yawT = 0.35; this.pitchT = 0.12;
    this.zoom = 1; this.zoomT = 1;
    this.poseName = 'relaxed';
    this.trk = { seen: false, lastT: 0, pose: null, q: null, facing: 'palm', lastWrist: null, sideCand: null, sideSince: 0 };
    this.pinch = {}; this.peelDrag = null;
    this.dw = { id: null, t0: 0, fired: false, lastFire: 0 };
    this.air = null; this.ptr = null;
    this.ex = null;
    this.disposed = false;
    this.poseDirty = true;
    this.mirrorView = false;
  }

  // ───── Aufbau ─────
  async init(onProgress) {
    initGU();
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.setClearColor(0x000000, 0);
    r.domElement.className = 'ha-canvas';
    this.host.appendChild(r.domElement);
    const sc = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 600);
    sc.add(new THREE.HemisphereLight(0xe9ecff, 0x2b2230, 0.72));
    const key = new THREE.DirectionalLight(0xfff1e2, 1.15); key.position.set(8, 12, 16); sc.add(key);
    const fill = new THREE.DirectionalLight(0xc8d4ff, 0.42); fill.position.set(-14, 2, 8); sc.add(fill);
    const rim = new THREE.DirectionalLight(0xd8ccff, 0.6); rim.position.set(-3, 9, -16); sc.add(rim);
    const low = new THREE.DirectionalLight(0xffe6d8, 0.22); low.position.set(2, -12, 6); sc.add(low);
    this.viewPivot = new THREE.Group(); sc.add(this.viewPivot);
    this.handRoot = new THREE.Group(); this.viewPivot.add(this.handRoot);
    this.rigRoot = new THREE.Group(); this.rigRoot.position.set(0, -3.4, 0); this.handRoot.add(this.rigRoot);
    this.layerU = LAYERS.map(() => ({ peel: { value: 0 } }));
    onProgress?.(0.05);
    this.buildRig();
    this.buildBones();
    await this.buildSkin(onProgress);
    onProgress?.(0.85);
    this.buildTubes();
    this.buildExtras();
    this.buildMarkers();
    this.precomputePoses();
    this.cur = this.clonePose(this.poseCache.relaxed);
    this.applyPose(this.cur); this.refreshRig();
    this.handRoot.quaternion.copy(this.restQuat(0));
    this.bindEvents();
    this.resize();
    onProgress?.(1);
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  buildRig() {
    const N = this.N = {};
    this.restLocalQ = {};
    const mk = (name, parent, pos, q) => {
      const b = new THREE.Bone(); b.name = name; b.rotation.order = 'ZXY';
      b.position.set(pos[0], pos[1], pos[2]); if (q) b.quaternion.copy(q);
      parent.add(b); N[name] = b; this.restLocalQ[name] = b.quaternion.clone(); return b;
    };
    const Y = new THREE.Vector3(0, 1, 0);
    mk('fa', this.rigRoot, RIG.wrist);
    mk('wr', N.fa, [0, 0, 0]);
    for (let f = 1; f <= 4; f++) {
      const d = RIG.fingers[f];
      const dir = new THREE.Vector3(Math.sin(d.ang * DEG), Math.cos(d.ang * DEG), d.tilt).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
      mk('mc' + f, N.wr, vsub(d.base, RIG.wrist), q);
      mk('p1_' + f, N['mc' + f], [0, d.len[0], 0]);
      mk('p2_' + f, N['p1_' + f], [0, d.len[1], 0]);
      mk('p3_' + f, N['p2_' + f], [0, d.len[2], 0]);
      mk('tip_' + f, N['p3_' + f], [0, d.len[3], 0]);
    }
    const t = RIG.thumb;
    const Y0 = new THREE.Vector3(...t.dir).normalize();
    const pulp = new THREE.Vector3(...t.pulp);
    const Z0 = pulp.clone().sub(Y0.clone().multiplyScalar(pulp.dot(Y0))).normalize();
    const X0 = new THREE.Vector3().crossVectors(Y0, Z0).normalize();
    const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X0, Y0, Z0));
    this.Q0 = Q0.clone(); this.thumbDir0 = Y0.clone();
    mk('tmc', N.wr, vsub(t.base, RIG.wrist), Q0);
    mk('tp1', N.tmc, [0, t.len[0], 0]);
    mk('tp2', N.tp1, [0, t.len[1], 0]);
    mk('ttip', N.tp2, [0, t.len[2], 0]);
    this.nodeNames = Object.keys(N);
    this.rigRoot.updateMatrixWorld(true);
    // Rahmen, den die Handflächen-Landmarken im Rig aufspannen (gleiche Rechnung wie beim Tracking)
    {
      const wp = (n) => new THREE.Vector3().setFromMatrixPosition(this.relMatrix(N[n], new THREE.Matrix4())).toArray();
      const fr = palmFrame([wp('fa'), wp('p1_1'), wp('p1_2'), wp('p1_3'), wp('p1_4')], 1);
      const rd = new THREE.Vector3(...fr.radial), dl = new THREE.Vector3(...fr.distal), pm = new THREE.Vector3(...fr.palmar);
      this.lfQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(rd, dl, pm));
      const inv = this.lfQ.clone().invert();
      this.lfCorr = { R: inv, L: new THREE.Quaternion(inv.x, -inv.y, -inv.z, inv.w) };
    }
    this.restRel = {}; this.restInv = {}; this.cur = null; this.rel = {};
    for (const n of this.nodeNames) {
      this.restRel[n] = this.relMatrix(N[n], new THREE.Matrix4());
      this.restInv[n] = this.restRel[n].clone().invert();
      this.rel[n] = this.restRel[n].clone();
    }
  }
  relMatrix(node, out) {
    out.copy(node.matrix);
    let p = node.parent;
    while (p && p !== this.rigRoot) { out.premultiply(p.matrix); p = p.parent; }
    return out;
  }
  restPt(n, x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(this.restRel[n]); }
  restAxis(n, i) { const e = this.restRel[n].elements; return new THREE.Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]).normalize(); }
  refreshRig() {
    this.rigRoot.updateMatrixWorld(true);
    for (const n of this.nodeNames) this.relMatrix(this.N[n], this.rel[n]);
  }

  // ───── Materialien ─────
  makeMaterial(key, layer) {
    const U = { peel: this.layerU[LAYER_IX[layer]].peel, hi: { value: 0 } };
    let m, kind = 0;
    const S = (o) => new THREE.MeshStandardMaterial({ metalness: 0, ...o });
    switch (key) {
      case 'bone': m = S({ vertexColors: true, roughness: 0.55, emissive: 0x140e07 }); break;
      case 'cart': m = S({ color: MATC.cartilage, roughness: 0.35, emissive: 0x0a0e14 }); break;
      case 'muscle': m = S({ color: MATC.muscle, roughness: 0.58, emissive: 0x1c0303 }); kind = 1; break;
      case 'tendon': m = S({ color: MATC.tendon, roughness: 0.36, emissive: 0x0e0d0b }); kind = 2; break;
      case 'ligament': m = S({ color: MATC.ligament, roughness: 0.4, emissive: 0x0b0c10 }); kind = 2; break;
      case 'pulley': m = S({ color: MATC.pulley, roughness: 0.4, emissive: 0x0c0d18 }); break;
      case 'sheath': m = S({ color: MATC.sheath, roughness: 0.3, transparent: true, opacity: 0.32, depthWrite: false }); break;
      case 'fascia': m = S({ color: MATC.fascia, roughness: 0.45, transparent: true, opacity: 0.8, emissive: 0x0d0c16 }); kind = 2; break;
      case 'nerve': m = S({ color: MATC.nerve, roughness: 0.42, emissive: 0x2c1e00 }); kind = 2; break;
      case 'artery': m = S({ color: MATC.artery, roughness: 0.35, emissive: 0x280000 }); break;
      case 'vein': m = S({ color: MATC.vein, roughness: 0.4, emissive: 0x040a2c }); break;
      case 'nail': m = S({ color: MATC.nail, roughness: 0.25, emissive: 0x1a0c08 }); break;
      default: m = S({ color: 0xffffff });
    }
    m.color.convertSRGBToLinear(); m.emissive.convertSRGBToLinear();
    patchMat(m, U, kind, null);
    return { m, U };
  }
  addMesh(geo, key, parent, layer, structs, finger, extra = {}) {
    const { m, U } = this.makeMaterial(key, layer);
    const mesh = new THREE.Mesh(geo, m);
    if (extra.pos) mesh.position.set(...extra.pos);
    if (extra.rotZ) mesh.rotation.z = extra.rotZ;
    if (key === 'fascia') mesh.renderOrder = 5;
    if (key === 'sheath') mesh.renderOrder = 6;
    parent.add(mesh);
    const e = { mesh, layer, li: LAYER_IX[layer], structs, finger: finger ?? null, U, hiCur: 0 };
    this.meshes.push(e);
    return e;
  }

  // ───── Knochen ─────
  buildBones() {
    const N = this.N;
    for (let f = 1; f <= 4; f++) {
      const d = RIG.fingers[f]; const [Lm, L1, L2, L3] = d.len; const br = d.br;
      this.addMesh(longBoneGeo(Lm - 0.12, ...br[0]), 'bone', N['mc' + f], 'bones', ['metacarpals', 'mcp_j'], f, { pos: [0, 0.04, 0] });
      this.addMesh(longBoneGeo(L1 - 0.16, ...br[1]), 'bone', N['p1_' + f], 'bones', ['phalanges', 'mcp_j', 'pip_j'], f, { pos: [0, 0.08, 0] });
      this.addMesh(longBoneGeo(L2 - 0.14, ...br[2]), 'bone', N['p2_' + f], 'bones', ['phalanges', 'pip_j', 'dip_j'], f, { pos: [0, 0.07, 0] });
      this.addMesh(longBoneGeo(L3 - 0.08, ...br[3], { tuft: true, noCartHead: true }), 'bone', N['p3_' + f], 'bones', ['phalanges', 'dip_j'], f, { pos: [0, 0.07, 0] });
    }
    const t = RIG.thumb;
    this.addMesh(longBoneGeo(t.len[0] - 0.12, ...t.br[0]), 'bone', N.tmc, 'bones', ['metacarpals', 'cmc1', 'mcp_j'], 0, { pos: [0, 0.05, 0] });
    this.addMesh(longBoneGeo(t.len[1] - 0.16, ...t.br[1]), 'bone', N.tp1, 'bones', ['phalanges', 'mcp_j', 'dip_j'], 0, { pos: [0, 0.08, 0] });
    this.addMesh(longBoneGeo(t.len[2] - 0.08, ...t.br[2], { tuft: true, noCartHead: true }), 'bone', N.tp2, 'bones', ['phalanges', 'dip_j'], 0, { pos: [0, 0.07, 0] });
    const w = RIG.wrist;
    const carpals = [
      ['scaphoid', [1.55, -1.95, 0.22], [0.72, 0.42, 0.45], 35],
      ['lunate', [0.35, -2.05, 0.04], [0.5, 0.45, 0.52], 0],
      ['triquetrum', [-0.95, -1.82, -0.06], [0.48, 0.4, 0.42], -10],
      ['pisiform', [-1.28, -1.62, 0.72], [0.3, 0.33, 0.28], 0],
      ['trapezium', [1.95, -0.88, 0.45], [0.5, 0.42, 0.45], 30],
      ['trapezoid', [1.15, -0.82, 0.08], [0.4, 0.38, 0.42], 0],
      ['capitate', [0.1, -1.0, 0.04], [0.45, 0.65, 0.5], 0],
      ['hamate', [-1.1, -0.86, 0.04], [0.5, 0.55, 0.48], 0],
      ['hamate', [-1.2, -0.62, 0.62], [0.16, 0.28, 0.22], 0],
    ];
    carpals.forEach(([s, p, sz, rz], i) => {
      const structs = s === 'trapezium' ? ['trapezium', 'cmc1'] : [s];
      this.addMesh(blobGeo(sz, i * 1.7 + 0.3), 'bone', N.wr, 'bones', structs, null, { pos: vsub(p, w), rotZ: rz * DEG });
    });
    const rad = [[-16, 0.0001], [-15.9, 0.6], [-9, 0.62], [-6, 0.8], [-4, 1.05], [-3.2, 1.4], [-2.86, 1.58], [-2.66, 1.5], [-2.58, 0.9], [-2.56, 0.0001]];
    this.addMesh(latheRig(rad, 0.8, 0.62, -2.72), 'bone', this.rigRoot, 'bones', ['radius'], null);
    const uln = [[-16, 0.0001], [-15.9, 0.5], [-8, 0.5], [-5, 0.52], [-3.6, 0.62], [-3.0, 0.68], [-2.84, 0.6], [-2.75, 0.35], [-2.72, 0.0001]];
    this.addMesh(latheRig(uln, -1.75, 0.9, -2.9), 'bone', this.rigRoot, 'bones', ['ulna'], null);
    this.addMesh(blobGeo([0.32, 0.42, 0.3], 7), 'bone', this.rigRoot, 'bones', ['radius'], null, { pos: [2.22, -2.55, 0] });
    this.addMesh(blobGeo([0.22, 0.35, 0.18], 8), 'bone', this.rigRoot, 'bones', ['radius'], null, { pos: [0.75, -3.1, -0.95] });
    this.addMesh(blobGeo([0.18, 0.34, 0.18], 9), 'bone', this.rigRoot, 'bones', ['ulna'], null, { pos: [-2.2, -2.62, -0.35] });
    const tf = new THREE.SphereGeometry(1, 20, 12); tf.scale(0.58, 0.1, 0.52);
    this.addMesh(tf, 'cart', this.rigRoot, 'bones', ['tfcc'], null, { pos: [-1.55, -2.5, 0] });
  }

  // ───── Haut aus Distanzfeld ─────
  skinSDF() {
    const P = (n, x = 0, y = 0, z = 0) => this.restPt(n, x, y, z).toArray();
    const Ax = (n, i) => this.restAxis(n, i).toArray();
    const X = [1, 0, 0], Z = [0, 0, 1];
    const palm = [
      primCone([0.3, -15.6, -0.1], [0.32, -3.3, 0], 3.45, 2.95, X, Z, 0.72),
      primCone([0.32, -3.3, 0], [0.28, -1.2, 0.08], 2.95, 3.0, X, Z, 0.55),
      primCone([0.25, -1.3, 0.08], [0.0, 1.1, 0.12], 3.05, 3.3, X, Z, 0.46),
      primRoundBox([-0.45, 2.75, 0.2], [2.4, 2.3, 0.52], 0.76, 17 * DEG),
      primEllipsoid([-2.75, 0.9, 0.45], [1.05, 2.4, 0.95], X, [0, 1, 0]),
    ];
    for (let f = 1; f <= 4; f++) {
      const Lm = RIG.fingers[f].len[0];
      palm.push(primCone(P('mc' + f, 0, 0.3, 0.1), P('mc' + f, 0, Lm + 0.1, 0.05), 0.95, 0.92, Ax('mc' + f, 0), Ax('mc' + f, 2), 1.25));
    }
    const Lt = RIG.thumb.len;
    palm.push(primEllipsoid(P('tmc', -0.15, 2.0, 0.55), [1.25, 2.3, 1.1], Ax('tmc', 0), Ax('tmc', 1)));
    palm.push(primCone(P('tmc', 0, -0.3, 0.1), P('tmc', 0, Lt[0] + 0.05, 0.05), 1.15, 1.0, Ax('tmc', 0), Ax('tmc', 2), 0.85));
    palm.push(primCone(P('tmc', -0.5, Lt[0] * 0.55, -0.05), P('mc1', 0.45, RIG.fingers[1].len[0] * 0.3, 0.05), 0.62, 0.62, [0, 1, 0], Z, 0.7));
    palm.push(primCone(P('tmc', -0.55, Lt[0] * 0.95, 0.0), P('mc1', 0.5, RIG.fingers[1].len[0] * 0.55, 0.1), 0.5, 0.55, [0, 1, 0], Z, 0.62));
    const fingers = [];
    for (let f = 1; f <= 4; f++) {
      const d = RIG.fingers[f]; const [, L1, L2, L3] = d.len; const sk = d.sk;
      const a1 = P('p1_' + f, 0, 0, 0.1), b1 = P('p1_' + f, 0, L1, 0.1), b2 = P('p2_' + f, 0, L2, 0.1), b3 = P('p3_' + f, 0, L3 - 0.45, 0.1);
      const Xf = Ax('p1_' + f, 0), Zf = Ax('p1_' + f, 2);
      fingers.push([primCone(a1, b1, sk[0], sk[1], Xf, Zf, 0.86), primCone(b1, b2, sk[1], sk[2], Xf, Zf, 0.86), primCone(b2, b3, sk[2], sk[3], Xf, Zf, 0.86)]);
    }
    const Xt = Ax('tp1', 0), Zt = Ax('tp1', 2);
    fingers.push([
      primCone(P('tp1', 0, 0, 0.08), P('tp1', 0, Lt[1], 0.08), 1.03, 0.96, Xt, Zt, 0.86),
      primCone(P('tp1', 0, Lt[1], 0.08), P('tp2', 0, Lt[2] - 0.42, 0.08), 0.96, 0.84, Xt, Zt, 0.86),
    ]);
    return (x, y, z) => {
      const dp = groupEval(palm, 0.9, x, y, z);
      let df = 1e9;
      for (let i = 0; i < fingers.length; i++) { const g = groupEval(fingers[i], 0.3, x, y, z); if (g < df) df = g; }
      if (df > 5e8) return dp;
      if (dp > 5e8) return df;
      return smin(dp, df, 0.6);
    };
  }
  async buildSkin(onProgress) {
    const sdf = this.sdf = this.skinSDF();
    const h = TUNING.skinVoxel;
    const { pos, idx } = await surfaceNets(sdf, [-5.8, -16.4, -3.6], [9.8, 17.6, 5.8], h, onProgress);
    onProgress?.(0.65);
    const nv = pos.length / 3;
    const P = new Float32Array(pos.length), Nn = new Float32Array(pos.length);
    for (let i = 0; i < nv; i++) {
      let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      for (let it = 0; it < 2; it++) {
        const f = sdf(x, y, z); const g = sdfGrad(sdf, x, y, z); const gl = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (0.04 * 0.04) || 1;
        const s = f / gl / 0.04; x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
      }
      const g = vnorm(sdfGrad(sdf, x, y, z));
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; Nn[i * 3] = g[0]; Nn[i * 3 + 1] = g[1]; Nn[i * 3 + 2] = g[2];
      if (i % 4000 === 3999) { onProgress?.(0.65 + 0.15 * i / nv); await new Promise((r) => setTimeout(r, 0)); }
    }
    // Hautgewichte: nächstes Knochensegment + Eltern/Kinder, weich überblendet
    const segs = [];
    const S = (n, a, b, parent) => segs.push({ n, a: a.toArray ? a.toArray() : a, b: b.toArray ? b.toArray() : b, parent });
    const RP = (n) => new THREE.Vector3().setFromMatrixPosition(this.restRel[n]).toArray();
    S('fa', [0.3, -16, 0], RIG.wrist, null);
    S('wr', RIG.wrist, [0.1, -0.3, 0], 'fa');
    for (let f = 1; f <= 4; f++) {
      S('mc' + f, RP('mc' + f), RP('p1_' + f), 'wr');
      S('p1_' + f, RP('p1_' + f), RP('p2_' + f), 'mc' + f);
      S('p2_' + f, RP('p2_' + f), RP('p3_' + f), 'p1_' + f);
      S('p3_' + f, RP('p3_' + f), RP('tip_' + f), 'p2_' + f);
    }
    S('tmc', RP('tmc'), RP('tp1'), 'wr'); S('tp1', RP('tp1'), RP('tp2'), 'tmc'); S('tp2', RP('tp2'), RP('ttip'), 'tp1');
    const segIx = Object.fromEntries(segs.map((s, i) => [s.n, i]));
    const kids = segs.map(() => []); segs.forEach((s, i) => { if (s.parent) kids[segIx[s.parent]].push(i); });
    // Handwurzel-Gruppe: diese Knochen dürfen untereinander weich überblenden (verhindert Falten am Daumenballen)
    const rigid = new Set(['fa', 'wr', 'mc1', 'mc2', 'mc3', 'mc4', 'tmc']);
    const boneList = this.nodeNames.map((n) => this.N[n]);
    const boneIx = Object.fromEntries(this.nodeNames.map((n, i) => [n, i]));
    const SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4);
    const dseg = (p, s) => {
      const ab = vsub(s.b, s.a); const t = clamp(vdot(vsub(p, s.a), ab) / vdot(ab, ab), 0, 1);
      return vlen(vsub(p, vadd(s.a, vmul(ab, t))));
    };
    const sig = 0.3;
    const d = new Float64Array(segs.length);
    for (let i = 0; i < nv; i++) {
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      let best = 0;
      for (let s = 0; s < segs.length; s++) { d[s] = dseg(p, segs[s]); if (d[s] < d[best]) best = s; }
      const cand = new Set([best]);
      if (segs[best].parent) cand.add(segIx[segs[best].parent]);
      kids[best].forEach((k) => cand.add(k));
      if (rigid.has(segs[best].n)) segs.forEach((s, k) => { if (rigid.has(s.n) && d[k] < d[best] + 0.9) cand.add(k); });
      const ws = [...cand].map((k) => [k, Math.exp(-(d[k] - d[best]) / sig)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = ws.reduce((a, b) => a + b[1], 0);
      ws.forEach(([k, w], j) => { SI[i * 4 + j] = boneIx[segs[k].n]; SW[i * 4 + j] = w / tot; });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 60);
    this.skinStats = { verts: nv, tris: idx.length / 3 };
    const skel = new THREE.Skeleton(boneList);
    const U = { peel: { value: 0 }, hi: { value: 0 }, skinA: { value: 1 }, ghost: { value: 1 } };
    this.skinU = U;
    const cm = new THREE.MeshStandardMaterial({ color: MATC.skin, roughness: 0.6, metalness: 0, skinning: true, transparent: true, depthWrite: false, emissive: 0x2a1208 });
    cm.color.convertSRGBToLinear(); cm.emissive.convertSRGBToLinear();
    patchMat(cm, U, 0, 'skin');
    const dm = new THREE.MeshBasicMaterial({ skinning: true, colorWrite: false, transparent: true, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    patchMat(dm, U, 0, 'depth');
    const skin = new THREE.SkinnedMesh(g, cm); skin.renderOrder = 11; skin.frustumCulled = false;
    const pre = new THREE.SkinnedMesh(g, dm); pre.renderOrder = 10; pre.frustumCulled = false;
    this.rigRoot.add(skin); this.rigRoot.add(pre);
    this.rigRoot.updateMatrixWorld(true);
    skin.bind(skel); pre.bind(skel);
    this.skinMesh = skin; this.skinPre = pre;
    this.meshes.push({ mesh: skin, layer: 'skin', li: 0, structs: ['skin'], finger: null, U, hiCur: 0, isSkin: true });
  }

  // ───── Röhren ─────
  buildTubes() {
    const defs = buildTubeDefs();
    const tmp = new THREE.Vector3();
    for (const def of defs) {
      const tg = new TubeGeo(def);
      const nodes = [...new Set(def.pts.map((p) => p.n))];
      const allFa = nodes.every((n) => n === 'fa');
      const allWr = nodes.every((n) => n === 'wr' || /^mc\d$/.test(n));
      const space = allWr ? 'wr' : 'rig';
      const axRig = new THREE.Vector3(...(def.ax || [1, 0, 0])).normalize();
      const anchors = def.pts.map((p) => {
        const loc = p.sp === 'loc' ? new THREE.Vector3(...p.p) : new THREE.Vector3(...p.p).applyMatrix4(this.restInv[p.n]);
        const ax = axRig.clone().transformDirection(this.restInv[p.n]);
        return { n: p.n, loc, ax };
      });
      const e = this.addMesh(tg.geo, def.m, space === 'wr' ? this.N.wr : this.rigRoot, def.l, [def.s], def.f);
      e.mesh.frustumCulled = false;
      const t = { def, tg, anchors, dynamic: !(allFa || allWr), space, pts: anchors.map(() => [0, 0, 0]), axs: anchors.map(() => [0, 0, 0]), entry: e, stale: false };
      e.tube = t;
      this.tubes.push(t);
      this.updateTube(t, tmp, true);
    }
  }
  updateTube(t, tmp, force) {
    if (!t.dynamic && !force) return;
    const wrInv = t.space === 'wr' ? this.restInv.wr : null;
    for (let i = 0; i < t.anchors.length; i++) {
      const a = t.anchors[i];
      const M = t.space === 'wr' ? this.restRel[a.n] : this.rel[a.n];
      tmp.copy(a.loc).applyMatrix4(M); if (wrInv) tmp.applyMatrix4(wrInv);
      t.pts[i][0] = tmp.x; t.pts[i][1] = tmp.y; t.pts[i][2] = tmp.z;
      tmp.copy(a.ax).transformDirection(M); if (wrInv) tmp.transformDirection(wrInv);
      t.axs[i][0] = tmp.x; t.axs[i][1] = tmp.y; t.axs[i][2] = tmp.z;
    }
    t.tg.update(t.pts, t.axs);
  }

  // ───── Nägel ─────
  buildExtras() {
    for (let f = 0; f <= 4; f++) {
      const n = f === 0 ? 'tp2' : 'p3_' + f;
      const L3 = f === 0 ? RIG.thumb.len[2] : RIG.fingers[f].len[3];
      const w = f === 0 ? 0.62 : RIG.fingers[f].sk[3] * 0.72;
      const base = this.restPt(n, 0, L3 * 0.55, 0).toArray();
      const nrm = this.restAxis(n, 2).negate().toArray();
      const s = snapToSurface(this.sdf, base, nrm, 0.0);
      const loc = new THREE.Vector3(...s).applyMatrix4(this.restInv[n]);
      const g = new THREE.SphereGeometry(1, 18, 10); g.scale(w, L3 * 0.36, 0.14);
      this.addMesh(g, 'nail', this.N[n], 'skin', ['nail'], f, { pos: [loc.x, loc.y, loc.z + 0.02] });
    }
  }

  // ───── Marker (DOM über dem Canvas) ─────
  buildMarkers() {
    const ov = this.overlay;
    this.markers = [];
    for (const r of REGIONS) {
      r.anchors.forEach((a, ai) => {
        const node = a.n;
        const pRest = a.sp === 'loc' ? this.restPt(node, ...a.p).toArray() : a.p;
        const nRest = a.sp === 'loc' ? new THREE.Vector3(...a.nrm).normalize().transformDirection(this.restRel[node]).toArray() : vnorm(a.nrm);
        const s = snapToSurface(this.sdf, pRest, nRest, 0.18);
        const loc = new THREE.Vector3(...s).applyMatrix4(this.restInv[node]);
        const nl = new THREE.Vector3(...nRest).transformDirection(this.restInv[node]);
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'ha-spot'; el.tabIndex = -1; el.innerHTML = SPOT_SVG;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); this.select(r.id, 'click'); });
        el.addEventListener('pointerenter', () => this.setHover(r.id, 'mouse'));
        el.addEventListener('pointerleave', () => { if (this.hoverSrc === 'mouse') this.setHover(null, 'mouse'); });
        ov.appendChild(el);
        this.markers.push({ rid: r.id, n: node, loc, nl, el, sx: -999, sy: -999, facing: -1, vis: false, cls: '' });
      });
    }
    this.labelEl = document.createElement('div'); this.labelEl.className = 'ha-label'; ov.appendChild(this.labelEl);
    this.cursorEl = document.createElement('div'); this.cursorEl.className = 'ha-cursor'; this.cursorEl.innerHTML = RING_SVG; ov.appendChild(this.cursorEl);
    this.ptrEl = document.createElement('div'); this.ptrEl.className = 'ha-cursor ha-ptr'; this.ptrEl.innerHTML = RING_SVG; ov.appendChild(this.ptrEl);
  }

  // ───── Posen ─────
  clonePose(P) { return { w: [...P.w], tq: P.tq.clone(), t: [...P.t], f: P.f.map((a) => [...a]) }; }
  toPose(def) {
    const P = { w: [(def.w?.[0] ?? 0) * DEG, (def.w?.[1] ?? 0) * DEG], f: def.f.map((a) => a.map((x) => x * DEG)), t: [0, 0], tq: new THREE.Quaternion() };
    if (def.ik) { const r = this.solveThumb(def.ik, P); P.tq.copy(r.tq); P.t = [r.mcp, r.ip]; }
    else {
      const t = def.t || [0, 0, 0, 0];
      P.tq.copy(this.Q0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(t[0] * DEG, 0, -t[1] * DEG, 'ZXY')));
      P.t = [t[2] * DEG, t[3] * DEG];
    }
    return P;
  }
  precomputePoses() {
    this.poseCache = {};
    for (const k of Object.keys(POSES)) this.poseCache[k] = this.toPose(POSES[k]);
    this.exCache = {};
    for (const k of Object.keys(EXERCISES)) this.exCache[k] = EXERCISES[k].steps.map((s) => this.toPose(s.p));
  }
  applyPose(P) {
    const N = this.N;
    N.wr.rotation.set(P.w[0], 0, -P.w[1]);
    for (let f = 1; f <= 4; f++) {
      const a = P.f[f - 1];
      N['p1_' + f].rotation.set(a[0], 0, -a[1]);
      N['p2_' + f].rotation.set(a[2], 0, 0);
      N['p3_' + f].rotation.set(a[3], 0, 0);
    }
    N.tmc.quaternion.copy(P.tq);
    N.tp1.rotation.set(P.t[0], 0, 0);
    N.tp2.rotation.set(P.t[1], 0, 0);
  }
  rigPoint(n, x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.relMatrix(this.N[n], this._m || (this._m = new THREE.Matrix4()))); }
  // Daumen per CCD-IK an eine Fingerbeere führen
  solveThumb(fi, P, start, iters = 60) {
    const N = this.N;
    const guess = start
      ? { ...P, tq: start.tq.clone(), t: [...start.t] }
      : { ...P, tq: this.Q0.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(28 * DEG, 0, 4 * DEG, 'ZXY'))), t: [25 * DEG, 20 * DEG] };
    this.applyPose(guess);
    for (const n of this.nodeNames) N[n].updateMatrix();
    const upd = () => { N.tmc.updateMatrix(); N.tp1.updateMatrix(); N.tp2.updateMatrix(); };
    const L3 = RIG.fingers[fi].len[3], Lt2 = RIG.thumb.len[2];
    const tgtL = [0, L3 * 0.72, 0.6], effL = [0, Lt2 * 0.72, 0.55];
    const E = new THREE.Vector3(), Tg = new THREE.Vector3(), J = new THREE.Vector3(), ax = new THREE.Vector3();
    const e = new THREE.Vector3(), g = new THREE.Vector3(), c = new THREE.Vector3();
    const lim = { tp1: [-10 * DEG, 70 * DEG], tp2: [-15 * DEG, 85 * DEG] };
    const m = new THREE.Matrix4();
    for (let it = 0; it < iters; it++) {
      for (const j of ['tp2', 'tp1', 'tmc']) {
        upd();
        this.rigPoint('tp2', ...effL, E); this.rigPoint('p3_' + fi, ...tgtL, Tg);
        this.relMatrix(N[j], m); J.setFromMatrixPosition(m);
        e.subVectors(E, J); g.subVectors(Tg, J);
        if (j === 'tmc') {
          const q = new THREE.Quaternion().setFromUnitVectors(e.clone().normalize(), g.clone().normalize());
          q.slerp(new THREE.Quaternion(), 0.45);
          N.tmc.quaternion.premultiply(q);
          const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(N.tmc.quaternion);
          const ang = dir.angleTo(this.thumbDir0);
          if (ang > 80 * DEG) N.tmc.quaternion.slerp(this.Q0, 1 - (80 * DEG) / ang);
        } else {
          ax.setFromMatrixColumn(m, 0).normalize();
          e.addScaledVector(ax, -e.dot(ax)); g.addScaledVector(ax, -g.dot(ax));
          const a = Math.atan2(c.crossVectors(e, g).dot(ax), e.dot(g));
          N[j].rotation.x = clamp(N[j].rotation.x + a * 0.8, lim[j][0], lim[j][1]);
        }
      }
      upd();
      this.rigPoint('tp2', ...effL, E); this.rigPoint('p3_' + fi, ...tgtL, Tg);
      if (E.distanceTo(Tg) < 0.05) break;
    }
    this.poseDirty = true;
    return { tq: N.tmc.quaternion.clone(), mcp: N.tp1.rotation.x, ip: N.tp2.rotation.x, err: E.distanceTo(Tg) };
  }
  blendPose(cur, tgt, k) {
    let ch = 0;
    for (let i = 0; i < 2; i++) { const d = tgt.w[i] - cur.w[i]; cur.w[i] += d * k; ch += Math.abs(d); }
    for (let i = 0; i < 2; i++) { const d = tgt.t[i] - cur.t[i]; cur.t[i] += d * k; ch += Math.abs(d); }
    for (let f = 0; f < 4; f++) for (let i = 0; i < 4; i++) { const d = tgt.f[f][i] - cur.f[f][i]; cur.f[f][i] += d * k; ch += Math.abs(d); }
    ch += 1 - Math.abs(cur.tq.dot(tgt.tq));
    cur.tq.slerp(tgt.tq, k);
    return ch;
  }
  restQuat(t) {
    const sway = this.reduced ? 0 : Math.sin(t * 0.00045) * 0.05;
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sway, this.displaySide() === 'L' ? 0.2 : -0.2));
  }
  // Im Spiegel-Modus zeigt das Modell das Spiegelbild deiner Hand (wie die Kamera-Vorschau):
  // eine linke Hand erscheint dann als rechte Hand – genau wie in einem Spiegel.
  displaySide() { return this.mirrorView ? (this.side === 'L' ? 'R' : 'L') : this.side; }
  applyChirality() { this.handRoot.scale.x = this.displaySide() === 'L' ? -1 : 1; }
  setMirrorView(on) {
    if (!!on === !!this.mirrorView) return;
    this.mirrorView = !!on; this.applyChirality();
    if (on) this.setView('palm');
  }

  // ───── Öffentliche Steuerung ─────
  setSide(s) {
    if (s !== 'L' && s !== 'R') return;
    this.side = s;
    this.applyChirality();
  }
  setLayers(st) { Object.assign(this.state, st); if (this.reduced) this.peelCur = this.state.peel; }
  setPoseName(n) { if (this.poseCache[n]) { this.poseName = n; this.ex = null; } }
  setView(v) {
    const s = this.displaySide() === 'L' ? -1 : 1;
    const Y = { palm: 0, back: Math.PI, thumb: -Math.PI / 2 * s, pinky: Math.PI / 2 * s, home: 0.35 }[v];
    if (Y === undefined) return;
    let y = Y; while (y - this.yaw > Math.PI) y -= Math.PI * 2; while (y - this.yaw < -Math.PI) y += Math.PI * 2;
    this.yawT = y; this.pitchT = v === 'home' ? 0.12 : 0.04;
    if (this.reduced) { this.yaw = this.yawT; this.pitch = this.pitchT; }
  }
  setSelected(id) { this.selected = id; }
  setPainMarks(m) { this.painMarks = m || {}; }
  setHighlight(region, struct) { this.hiReq = { region, struct }; }
  setMode(m) { this.mode = m; this.setHover(null, 'air'); this.setHover(null, 'ptr'); this.air = null; this.ptr = null; this.trk.seen = false; }
  playExercise(id) {
    if (!this.exCache[id]) return;
    this.ex = { id, i: 0, t0: performance.now(), loop: 0, loops: EXERCISES[id].loops };
    this.setView(EXERCISES[id].view || 'palm');
    this.opts.onExercise?.({ id, i: 0, n: this.exCache[id].length, loop: 0 });
  }
  stopExercise() { this.ex = null; this.opts.onExercise?.(null); }
  select(id, src) {
    if (!REGION_BY_ID[id]) return;
    this.selected = id;
    this.opts.onSelect?.(id, src);
  }
  setHover(id, src) {
    if (id === null && this.hoverSrc && this.hoverSrc !== src) return;
    if (this.hover === id && this.hoverSrc === src) return;
    this.hover = id; this.hoverSrc = id ? src : null;
    this.opts.onHover?.(id);
  }

  // ───── Eingaben (Maus/Touch) ─────
  bindEvents() {
    const c = this.renderer.domElement;
    this.ptrs = new Map();
    let down = null; let pinch0 = null;
    const onDown = (e) => {
      c.setPointerCapture?.(e.pointerId);
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.ptrs.size === 1) down = { x: e.clientX, y: e.clientY, yaw: this.yawT, pitch: this.pitchT, moved: 0 };
      if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoomT }; down = null; }
    };
    const onMove = (e) => {
      const rect = c.getBoundingClientRect();
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch0 && this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        this.zoomT = clamp(pinch0.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinch0.d, 1), 0.55, 2.4);
        return;
      }
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        down.moved = Math.max(down.moved, Math.hypot(dx, dy));
        if (down.moved > 4) {
          this.yawT = down.yaw + dx * 0.009; this.pitchT = clamp(down.pitch + dy * 0.007, -1.3, 1.3);
          if (this.reduced) { this.yaw = this.yawT; this.pitch = this.pitchT; }
          this.setHover(null, 'mouse');
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        const id = this.pickScreen(e.clientX - rect.left, e.clientY - rect.top, 1);
        this.setHover(id, 'mouse');
        c.style.cursor = id ? 'pointer' : 'grab';
      }
    };
    const onUp = (e) => {
      const rect = c.getBoundingClientRect();
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size < 2) pinch0 = null;
      if (down && down.moved <= 4) {
        const id = this.pickScreen(e.clientX - rect.left, e.clientY - rect.top, e.pointerType === 'mouse' ? 1 : 1.5);
        if (id) this.select(id, 'click');
      }
      down = null;
    };
    const onWheel = (e) => { e.preventDefault(); this.zoomT = clamp(this.zoomT * Math.exp(-e.deltaY * 0.0012), 0.55, 2.4); };
    const onLeave = () => { if (this.hoverSrc === 'mouse') this.setHover(null, 'mouse'); };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('wheel', onWheel, { passive: false });
    this.unbind = () => {
      c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp); c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('pointerleave', onLeave); c.removeEventListener('wheel', onWheel);
    };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
  }
  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const t = Math.tan((this.camera.fov * DEG) / 2);
    this.fitDist = Math.max(15.2 / t, 10.5 / (t * this.camera.aspect));
  }
  pickScreen(x, y, k = 1) {
    let best = null, bd = TUNING.pickPx * k;
    for (const m of this.markers) {
      if (!m.vis) continue;
      const d = Math.hypot(m.sx - x, m.sy - y);
      if (d < bd) { bd = d; best = m.rid; }
    }
    return best;
  }

  // ───── Webcam: Landmarken → Pose ─────
  labelOf(hd, swap) {
    const l = hd && (hd.label || hd.categoryName);
    if (!l) return null;
    let s = /left/i.test(l) ? 'L' : 'R';
    if (swap) s = s === 'L' ? 'R' : 'L';
    return s;
  }
  // modelSide = angezeigte Modellseite. Spiegelbild-Koordinaten: x wie Vorschau, y nach oben,
  // z zur Kamera hin (= zum Betrachter). Die Geometrie ist dadurch seitenverkehrt → Modellseite gespiegelt.
  poseFromLandmarks(wl, modelSide) {
    const s = (modelSide || this.displaySide()) === 'L' ? -1 : 1;
    const p = wl.map((q) => [q.x, -q.y, -q.z]);
    const { radial, distal, palmar } = palmFrame([p[0], p[5], p[9], p[13], p[17]], s);
    const c0 = vmul(radial, s), c1 = distal, c2 = vcross(c0, c1);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...c0), new THREE.Vector3(...c1), new THREE.Vector3(...c2)));
    q.multiply(s > 0 ? this.lfCorr.R : this.lfCorr.L);
    const tv = new THREE.Vector3();
    const L = p.map((v) => { const d = vsub(v, p[0]); return tv.set(vdot(d, radial), vdot(d, distal), vdot(d, palmar)).applyQuaternion(this.lfQ).toArray(); });
    const sa = (a, b, ax) => Math.atan2(vdot(vcross(a, b), ax), vdot(a, b));
    const f = [];
    for (let k = 1; k <= 4; k++) {
      const i = 4 * k + 1;
      const v1 = vnorm(vsub(L[i + 1], L[i])), v2 = vnorm(vsub(L[i + 2], L[i + 1])), v3 = vnorm(vsub(L[i + 3], L[i + 2]));
      const qmc = this.restLocalQ['mc' + k];
      const m = new THREE.Vector3(...v1).applyQuaternion(qmc.clone().invert());
      // m = (cos f · sin a, cos f · cos a, sin f). Bei ~90° Beugung ist a aus m allein unbestimmt →
      // dann die Abspreizung aus der Beugeebene des Fingers (Achse der Mittel-/Endgelenke) ableiten.
      let abd = Math.atan2(m.x, m.y);
      if (Math.abs(abd) > Math.PI / 2) abd = Math.atan2(-m.x, -m.y);
      const nAx = vadd(vcross(v1, v2), vcross(v2, v3)); const nl = vlen(nAx);
      if (nl > 0.15) {
        const nm = new THREE.Vector3(...nAx).normalize().applyQuaternion(qmc.clone().invert());
        if (nm.x < 0) nm.negate();
        const aPlane = Math.atan2(-nm.y, nm.x);
        const w = clamp((nl - 0.15) / 0.25, 0, 1) * clamp(1 - Math.abs(m.y) / 0.5, 0, 1);
        abd = abd + (aPlane - abd) * w;
      }
      abd = clamp(abd, -30 * DEG, 30 * DEG);
      const flex = Math.atan2(m.z, m.x * Math.sin(abd) + m.y * Math.cos(abd));
      const q1 = qmc.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(flex, 0, -abd, 'ZXY')));
      const X1 = new THREE.Vector3(1, 0, 0).applyQuaternion(q1).toArray();
      f.push([clamp(flex, -25 * DEG, 100 * DEG), abd, clamp(sa(v1, v2, X1), -10 * DEG, 115 * DEG), clamp(sa(v2, v3, X1), -15 * DEG, 90 * DEG)]);
    }
    const b = new THREE.Vector3(...vnorm(vsub(L[2], L[1])));
    let qs = new THREE.Quaternion().setFromUnitVectors(this.thumbDir0, b);
    const ang = 2 * Math.acos(clamp(Math.abs(qs.w), 0, 1));
    if (ang > 80 * DEG) qs = new THREE.Quaternion().slerp(qs, (80 * DEG) / ang);
    const tq = qs.clone().multiply(this.Q0);
    const cV = vnorm(vsub(L[3], L[2])), eV = vnorm(vsub(L[4], L[3]));
    // Eindrehung des Daumens aus seiner Beugeebene: die Achse, um die sich Grund- und Endgelenk beugen
    const bA = b.toArray();
    const nb = vadd(vcross(bA, cV), vcross(cV, eV)); const nbl = vlen(nb);
    if (nbl > 0.12) {
      const Xs = new THREE.Vector3(1, 0, 0).applyQuaternion(tq);
      const Xn = new THREE.Vector3(...nb); Xn.addScaledVector(b, -Xn.dot(b)).normalize();
      if (Xn.dot(Xs) < 0) Xn.negate();
      const Zn = new THREE.Vector3().crossVectors(Xn, b);
      const qp = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xn, b, Zn));
      tq.slerp(qp, clamp((nbl - 0.12) / 0.25, 0, 1));
    }
    const Xt = new THREE.Vector3(1, 0, 0).applyQuaternion(tq).toArray();
    const t = [clamp(sa(bA, cV, Xt), -20 * DEG, 75 * DEG), clamp(sa(cV, eV, Xt), -25 * DEG, 90 * DEG)];
    return { q, pose: { w: [0, 0], tq, t, f }, facing: palmar[2] > 0 ? 'palm' : 'back', palmar };
  }
  // Berühren sich Daumen und eine Fingerkuppe an der echten Hand, den Modell-Daumen per IK dorthin führen
  applyContact(pose, wl) {
    const d = (a, b) => Math.hypot(wl[a].x - wl[b].x, wl[a].y - wl[b].y, wl[a].z - wl[b].z);
    const palm = d(0, 9) || 1;
    let best = null;
    for (const [fi, tip] of [[1, 8], [2, 12], [3, 16], [4, 20]]) {
      const r = d(4, tip) / palm;
      if (r < TUNING.contactOn && (!best || r < best.r)) best = { fi, r };
    }
    if (!best) return 0;
    const w = clamp((TUNING.contactOn - best.r) / (TUNING.contactOn - TUNING.contactFull), 0, 1);
    const ik = this.solveThumb(best.fi, pose, { tq: pose.tq, t: pose.t }, 14);
    pose.tq.slerp(ik.tq, w);
    pose.t[0] += (ik.mcp - pose.t[0]) * w; pose.t[1] += (ik.ip - pose.t[1]) * w;
    return w;
  }
  // Test-Hilfe: aus einer Pose synthetische Weltlandmarken erzeugen (MediaPipe-Konvention, Selfie-Modus)
  synthLandmarks(P, q, modelSide) {
    const saveS = this.handRoot.scale.x; const saveQ = this.handRoot.quaternion.clone(); const saveV = this.viewPivot.quaternion.clone();
    this.handRoot.scale.x = modelSide === 'L' ? -1 : 1; this.handRoot.quaternion.copy(q); this.viewPivot.quaternion.identity();
    this.applyPose(P); this.scene.updateMatrixWorld(true);
    const names = ['fa', 'tmc', 'tp1', 'tp2', 'ttip'];
    for (let f = 1; f <= 4; f++) names.push('p1_' + f, 'p2_' + f, 'p3_' + f, 'tip_' + f);
    const out = names.map((n) => { const v = new THREE.Vector3().setFromMatrixPosition(this.N[n].matrixWorld); return { x: v.x / 100, y: -v.y / 100, z: -v.z / 100 }; });
    this.handRoot.scale.x = saveS; this.handRoot.quaternion.copy(saveQ); this.viewPivot.quaternion.copy(saveV); this.applyPose(this.cur); this.poseDirty = true;
    return out;
  }
  pinchOf(lm, key) {
    const s = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 1;
    const d = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / s;
    const was = !!this.pinch[key];
    const now = was ? d < TUNING.pinchOff : d < TUNING.pinchOn;
    this.pinch[key] = now;
    return { now, started: now && !was, ended: !now && was };
  }
  // Zeigefinger der zweiten Hand → Punkt auf der Modellhand
  mapPointer(P, tip, aspect, palmFacing) {
    const pt = (i) => [P[i].x * aspect, P[i].y];
    const Q = [tip.x * aspect, tip.y];
    const s = Math.hypot(pt(0)[0] - pt(9)[0], pt(0)[1] - pt(9)[1]) || 1;
    const Lt = RIG.thumb.len;
    const segs = [['tmc', 1, 2, Lt[0]], ['tp1', 2, 3, Lt[1]], ['tp2', 3, 4, Lt[2] + 0.3]];
    for (let f = 1; f <= 4; f++) { const L = RIG.fingers[f].len; const b = 4 * f + 1; segs.push(['p1_' + f, b, b + 1, L[1]], ['p2_' + f, b + 1, b + 2, L[2]], ['p3_' + f, b + 2, b + 3, L[3] + 0.3]); }
    let best = null;
    for (const [n, i0, i1, len] of segs) {
      const a = pt(i0), b = pt(i1); const ab = [b[0] - a[0], b[1] - a[1]]; const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
      const t = clamp(((Q[0] - a[0]) * ab[0] + (Q[1] - a[1]) * ab[1]) / l2, 0, 1);
      const d = Math.hypot(Q[0] - (a[0] + ab[0] * t), Q[1] - (a[1] + ab[1] * t));
      if (d < TUNING.pointerMaxDist * s && (!best || d < best.d)) best = { n, base: [0, t * len, 0], d, loc: true };
    }
    if (!best) {
      const LMR = { 0: [0.3, -2.6], 1: this.restPt('tmc', 0, 0, 0).toArray(), 2: this.restPt('tp1', 0, 0, 0).toArray() };
      for (let f = 1; f <= 4; f++) LMR[4 * f + 1] = this.restPt('p1_' + f, 0, 0, 0).toArray();
      for (const tri of [[0, 1, 5], [0, 5, 9], [0, 9, 13], [0, 13, 17], [1, 2, 5]]) {
        const [A0, B0, C0] = tri.map(pt);
        const v0 = [B0[0] - A0[0], B0[1] - A0[1]], v1 = [C0[0] - A0[0], C0[1] - A0[1]], v2 = [Q[0] - A0[0], Q[1] - A0[1]];
        const den = v0[0] * v1[1] - v1[0] * v0[1]; if (Math.abs(den) < 1e-9) continue;
        const wb = (v2[0] * v1[1] - v1[0] * v2[1]) / den, wc = (v0[0] * v2[1] - v2[0] * v0[1]) / den, wa = 1 - wb - wc;
        if (wa > -0.06 && wb > -0.06 && wc > -0.06) {
          const R = tri.map((i) => LMR[i]);
          best = { n: 'wr', rigBase: [wa * R[0][0] + wb * R[1][0] + wc * R[2][0], wa * R[0][1] + wb * R[1][1] + wc * R[2][1], 0.1] };
          break;
        }
      }
    }
    if (!best) {
      const A0 = pt(0); const dir = vnorm([A0[0] - pt(9)[0], A0[1] - pt(9)[1], 0]);
      const rimg = vnorm([pt(5)[0] - pt(17)[0], pt(5)[1] - pt(17)[1], 0]);
      const d = [Q[0] - A0[0], Q[1] - A0[1], 0];
      const t = vdot(d, dir) / s; const u = vdot(d, rimg) / (TUNING.wristBand * s);
      if (t > -0.12 && t < 1.0 && Math.abs(u) < 1.15) best = { n: 'fa', rigBase: [0.3 + clamp(u, -1, 1) * 2.4, -2.6 - Math.max(0, t) * 8.5, 0] };
    }
    if (!best) return null;
    const n = best.n;
    const base = best.loc ? this.restPt(n, ...best.base).toArray() : best.rigBase;
    const zr = best.loc ? this.restAxis(n, 2).toArray() : [0, 0, 1];
    const nrm = palmFacing ? zr : vmul(zr, -1);
    const surf = snapToSurface(this.sdf, base, nrm, 0.1);
    const loc = new THREE.Vector3(...surf).applyMatrix4(this.restInv[n]);
    return { n, loc };
  }
  nearestRegionRig(n, loc) {
    const p = loc.clone().applyMatrix4(this.rel[n]);
    let best = null, bd = 3.2;
    const tmp = new THREE.Vector3();
    for (const m of this.markers) {
      tmp.copy(m.loc).applyMatrix4(this.rel[m.n]);
      const d = tmp.distanceTo(p);
      if (d < bd) { bd = d; best = m.rid; }
    }
    return best;
  }
  dwellStep(id, now) {
    if (id !== this.dw.id) { this.dw.id = id; this.dw.t0 = now; this.dw.fired = false; }
    if (!id) return 0;
    const p = (now - this.dw.t0) / TUNING.dwellMs;
    if (p >= 1 && !this.dw.fired && now - this.dw.lastFire > TUNING.dwellCooldownMs) {
      this.dw.fired = true; this.dw.lastFire = now; this.select(id, 'gesture');
    }
    return this.dw.fired ? 1 : clamp(p, 0, 1);
  }
  ingestHands(res, opt) {
    const now = performance.now();
    const LM = res.multiHandLandmarks || [], WL = res.multiHandWorldLandmarks || [], HD = res.multiHandedness || [];
    const hands = LM.map((lm, i) => ({ lm, wl: WL[i] || null, label: this.labelOf(HD[i], opt.swap) }));
    const out = { n: hands.length, puppet: -1, pointer: -1, dwell: 0, region: null, facing: null, side: this.side, cursor: null, peeling: false, pinch: false };
    const aspect = opt.aspect || 4 / 3;
    if (opt.mode === 'air') {
      this.ptr = null; this.setHover(null, 'ptr');
      if (!hands.length) { this.air = null; this.setHover(null, 'air'); this.dwellStep(null, now); return out; }
      const h = hands.find((x) => x.label === this.side) || hands[0];
      out.pointer = hands.indexOf(h);
      const tip = h.lm[8];
      const g = TUNING.airGain;
      const tx = clamp(((tip.x - 0.5) * g + 0.5), 0, 1) * this.w, ty = clamp(((tip.y - 0.5) * g + 0.5), 0, 1) * this.h;
      const k = TUNING.airSmoothing;
      this.air = this.air ? { x: lerp(this.air.x, tx, k), y: lerp(this.air.y, ty, k) } : { x: tx, y: ty };
      const id = this.pickScreen(this.air.x, this.air.y, 1.35);
      this.setHover(id, 'air');
      const pc = this.pinchOf(h.lm, 'air');
      out.pinch = pc.now;
      if (pc.started && id) { this.select(id, 'gesture'); this.dw.fired = true; this.dw.lastFire = now; }
      out.dwell = this.dwellStep(id, now);
      out.region = id; out.cursor = { ...this.air };
      return out;
    }
    this.air = null; this.setHover(null, 'air');
    if (!hands.length) { this.ptr = null; this.setHover(null, 'ptr'); this.dwellStep(null, now); return out; }
    let pi = 0;
    if (hands.length >= 2) {
      const m = hands.map((h, i) => (h.label === this.side ? i : -1)).filter((i) => i >= 0);
      if (m.length === 1) pi = m[0];
      else if (this.trk.lastWrist) {
        const d = (h) => Math.hypot(h.lm[0].x - this.trk.lastWrist.x, h.lm[0].y - this.trk.lastWrist.y);
        pi = d(hands[0]) <= d(hands[1]) ? 0 : 1;
      }
    }
    const P = hands[pi]; out.puppet = pi;
    this.trk.lastWrist = { x: P.lm[0].x, y: P.lm[0].y };
    if (hands.length === 1 && P.label && P.label !== this.side) {
      if (this.trk.sideCand !== P.label) { this.trk.sideCand = P.label; this.trk.sideSince = now; }
      else if (now - this.trk.sideSince > 650) { this.setSide(P.label); this.opts.onSide?.(P.label); this.trk.sideCand = null; }
    } else this.trk.sideCand = null;
    if (P.wl) {
      const r = this.poseFromLandmarks(P.wl);
      const a = TUNING.angleSmoothing;
      const fresh = !this.trk.pose || !this.trk.seen || now - this.trk.lastT > TUNING.lostGraceMs;
      if (fresh) { this.trk.pose = this.clonePose(r.pose); this.trk.q = r.q.clone(); }
      else { this.blendPose(this.trk.pose, r.pose, a); this.trk.q.slerp(r.q, TUNING.rotSmoothing); }
      this.applyContact(this.trk.pose, P.wl);
      this.trk.seen = true; this.trk.lastT = now; this.trk.facing = r.facing;
      out.facing = r.facing;
    }
    if (hands.length >= 2) {
      const Q = hands[1 - pi]; out.pointer = 1 - pi;
      const pc = this.pinchOf(Q.lm, 'ptr');
      out.pinch = pc.now;
      if (pc.now) {
        const my = (Q.lm[4].y + Q.lm[8].y) / 2;
        if (pc.started || !this.peelDrag) this.peelDrag = { y0: my, p0: this.state.peel };
        const v = clamp(this.peelDrag.p0 + (my - this.peelDrag.y0) * TUNING.peelDragGain, 0, 5);
        this.opts.onPeel?.(v);
        out.peeling = true; this.ptr = null; this.setHover(null, 'ptr'); this.dwellStep(null, now);
        return out;
      }
      this.peelDrag = null;
      const hit = this.mapPointer(P.lm, Q.lm[8], aspect, this.trk.facing === 'palm');
      if (hit) {
        const id = this.nearestRegionRig(hit.n, hit.loc);
        this.ptr = hit;
        this.setHover(id, 'ptr');
        out.region = id; out.dwell = this.dwellStep(id, now);
      } else { this.ptr = null; this.setHover(null, 'ptr'); this.dwellStep(null, now); }
    } else { this.ptr = null; this.setHover(null, 'ptr'); this.dwellStep(null, now); this.peelDrag = null; }
    this.ptrDwell = out.dwell;
    return out;
  }
  resetTracking() { this.trk.seen = false; this.trk.pose = null; this.ptr = null; this.air = null; this.peelDrag = null; this.pinch = {}; this.setHover(null, 'ptr'); this.setHover(null, 'air'); this.dwellStep(null, performance.now()); }
  trackingActive(now) { return this.mode === 'mirror' && this.trk.seen && now - this.trk.lastT < TUNING.lostGraceMs; }

  // ───── Render-Schleife ─────
  tick(t) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (t - (this.lastT || t)) / 1000); this.lastT = t;
    GU.time.value = t / 1000;
    const now = performance.now();
    let tgt = this.poseCache[this.poseName];
    let k = this.reduced ? 1 : 1 - Math.exp(-dt * TUNING.poseEase);
    const trackOn = this.trackingActive(now);
    if (this.ex) {
      const e = this.ex; const dur = (TUNING.exerciseHold + TUNING.exerciseMove) * (this.reduced ? 1500 : 1000);
      if (now - e.t0 > dur) {
        e.i++; e.t0 = now;
        if (e.i >= this.exCache[e.id].length) { e.i = 0; e.loop++; }
        if (e.loop >= e.loops) { this.ex = null; this.opts.onExercise?.(null); }
        else this.opts.onExercise?.({ id: e.id, i: e.i, n: this.exCache[e.id].length, loop: e.loop });
      }
      if (this.ex) { tgt = this.exCache[e.id][e.i]; k = this.reduced ? 1 : 1 - Math.exp(-dt * 3.4); }
    } else if (trackOn && this.trk.pose) { tgt = this.trk.pose; k = 1; }
    if (this.blendPose(this.cur, tgt, k) > 1e-5 || this.poseDirty) {
      this.applyPose(this.cur); this.refreshRig();
      const tmp = this._tv || (this._tv = new THREE.Vector3());
      // Nur sichtbare Röhren neu formen; verdeckte beim nächsten Einblenden nachziehen
      for (const tb of this.tubes) if (tb.dynamic) { if (tb.entry.mesh.visible) this.updateTube(tb, tmp); else tb.stale = true; }
      this.poseDirty = false;
    }
    const qT = trackOn && !this.ex ? this.trk.q : this.restQuat(t);
    const kq = trackOn && !this.ex ? 1 : (this.reduced ? 1 : 1 - Math.exp(-dt * 3));
    this.handRoot.quaternion.slerp(qT, kq);
    const kv = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
    this.yaw += (this.yawT - this.yaw) * kv; this.pitch += (this.pitchT - this.pitch) * kv;
    this.viewPivot.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'XYZ'));
    this.zoom += (this.zoomT - this.zoom) * kv;
    const dist = this.fitDist / this.zoom;
    this.camera.position.set(0, -1.2, dist); this.camera.lookAt(0, -1.2, 0);
    // Schichten
    const kp = this.reduced ? 1 : 1 - Math.exp(-dt * 9);
    this.peelCur += (this.state.peel - this.peelCur) * kp;
    for (let i = 1; i < 5; i++) this.layerU[i].peel.value = clamp(this.peelCur - i, 0, 1);
    this.layerU[5].peel.value = 0;
    const skinA = 1 - clamp(this.peelCur, 0, 1);
    this.skinU.skinA.value = skinA; this.skinU.ghost.value = this.state.ghost ? 1 : 0;
    const skinOn = this.state.vis[0] && (skinA > 0.004 || this.state.ghost);
    this.skinMesh.visible = skinOn; this.skinPre.visible = skinOn;
    // Hervorhebung
    const reg = this.hiReq.region ? REGION_BY_ID[this.hiReq.region] : null;
    const regStructs = reg ? REGION_TPL[reg.tpl].u : [];
    const fing = reg ? reg.finger : null;
    for (const e of this.meshes) {
      if (!e.isSkin) {
        const peel = e.li >= 1 && e.li <= 4 ? this.layerU[e.li].peel.value : 0;
        // Bei voll deckender Haut ist innen nichts sichtbar → ausblenden (spart Rechenzeit, verhindert Durchstechen)
        const covered = e.li > 0 && skinOn && skinA > 0.995;
        e.mesh.visible = this.state.vis[e.li] && peel < 0.999 && !covered && (e.li !== 0 || skinA > 0.004);
        if (e.tube && e.tube.stale && e.mesh.visible) { this.updateTube(e.tube, this._tv || (this._tv = new THREE.Vector3())); e.tube.stale = false; }
      }
      const fm = fing === null || e.finger === null || e.finger === fing;
      let target = 0;
      if (this.hiReq.struct && e.structs.includes(this.hiReq.struct) && fm) target = 1;
      else if (regStructs.length && fm && e.structs.some((s) => regStructs.includes(s))) target = e.isSkin ? 0.08 : 0.28;
      e.hiCur += (target - e.hiCur) * (this.reduced ? 1 : 1 - Math.exp(-dt * 8));
      e.U.hi.value = e.hiCur;
    }
    this.scene.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    this.updateOverlay();
  }
  updateOverlay() {
    const cam = this.camera; const W = this.w, H = this.h;
    const v = this._ov || (this._ov = new THREE.Vector3()); const nv = this._on || (this._on = new THREE.Vector3());
    const cp = cam.position;
    const hoverId = this.hover; const selId = this.selected;
    let labelM = null, labelF = -2, selM = null, selF = -2;
    for (const m of this.markers) {
      v.copy(m.loc).applyMatrix4(this.N[m.n].matrixWorld);
      nv.copy(m.nl).transformDirection(this.N[m.n].matrixWorld);
      const tx = cp.x - v.x, ty = cp.y - v.y, tz = cp.z - v.z; const tl = Math.hypot(tx, ty, tz) || 1;
      m.facing = (nv.x * tx + nv.y * ty + nv.z * tz) / tl;
      v.project(cam);
      m.sx = (v.x * 0.5 + 0.5) * W; m.sy = (-v.y * 0.5 + 0.5) * H;
      const pain = this.painMarks[m.rid] > 0;
      m.vis = m.facing > 0.06 && (this.state.spots || m.rid === selId || m.rid === hoverId || pain);
      const cls = 'ha-spot' + (m.rid === selId ? ' sel' : '') + (m.rid === hoverId ? ' hov' : '') + (pain ? ' pain' : '') + (m.vis ? '' : ' off');
      if (cls !== m.cls) { m.el.className = cls; m.cls = cls; }
      if (pain) m.el.style.setProperty('--pain', String(this.painMarks[m.rid]));
      m.el.style.transform = `translate(${m.sx.toFixed(1)}px, ${m.sy.toFixed(1)}px)`;
      if (m.rid === hoverId && m.facing > labelF) { labelF = m.facing; labelM = m; }
      if (m.rid === selId && m.facing > selF) { selF = m.facing; selM = m; }
    }
    const lm = labelM || (selF > 0.06 ? selM : null);
    if (lm) {
      this.labelEl.textContent = this.opts.getLabel ? this.opts.getLabel(lm.rid) : lm.rid;
      this.labelEl.style.transform = `translate(${lm.sx.toFixed(1)}px, ${(lm.sy - 18).toFixed(1)}px) translate(-50%, -100%)`;
      this.labelEl.classList.add('on');
    } else this.labelEl.classList.remove('on');
    const setRing = (el, x, y, p, on) => {
      if (!on) { el.classList.remove('on'); return; }
      el.classList.add('on');
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.querySelector('.ha-cr-fg').setAttribute('stroke-dasharray', `${(p * 100).toFixed(1)} 100`);
    };
    setRing(this.cursorEl, this.air?.x ?? 0, this.air?.y ?? 0, this.dw.id && this.hoverSrc === 'air' ? (this.dw.fired ? 1 : clamp((performance.now() - this.dw.t0) / TUNING.dwellMs, 0, 1)) : 0, !!this.air);
    if (this.ptr) {
      v.copy(this.ptr.loc).applyMatrix4(this.N[this.ptr.n].matrixWorld).project(cam);
      setRing(this.ptrEl, (v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, this.dw.id && this.hoverSrc === 'ptr' ? (this.dw.fired ? 1 : clamp((performance.now() - this.dw.t0) / TUNING.dwellMs, 0, 1)) : 0, true);
    } else setRing(this.ptrEl, 0, 0, 0, false);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbind?.(); this.ro?.disconnect();
    this.scene?.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.overlay.innerHTML = '';
  }
}

// ═══════════════════════════════ Webcam-Tracking ═══════════════════════════════
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

class HandTracker {
  constructor(video, onResults) { this.video = video; this.onResults = onResults; this.stopped = true; }
  async start() {
    this.stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) { const e = new Error('nomedia'); e.name = 'NotAllowedError'; throw e; }
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    if (this.stopped) { this.stream.getTracks().forEach((t) => t.stop()); return; }
    const v = this.video; v.muted = true; v.playsInline = true; v.srcObject = this.stream;
    await v.play().catch(() => {});
    try {
      await loadScript(CDN.hands + 'hands.js');
      if (!window.Hands) throw new Error('hands');
      const hands = this.hands = new window.Hands({ locateFile: (f) => CDN.hands + f });
      hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5, selfieMode: true });
      hands.onResults((r) => { if (!this.stopped) this.onResults(r); });
      if (hands.initialize) await hands.initialize();
    } catch (e) { const err = new Error('hands'); err.name = 'HandsLoadError'; throw err; }
    const loop = async () => {
      if (this.stopped) return;
      if (v.readyState >= 2 && !this.busy) {
        this.busy = true;
        try { await this.hands.send({ image: v }); } catch (e) { /* einzelnes Bild verworfen */ }
        this.busy = false;
      }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    try { this.hands?.close?.(); } catch (e) {}
    this.hands = null;
  }
}

function drawPreview(canvas, res, info) {
  if (!canvas || !res?.image) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.drawImage(res.image, 0, 0, W, H);
  ctx.fillStyle = 'rgba(13,15,22,0.18)'; ctx.fillRect(0, 0, W, H);
  (res.multiHandLandmarks || []).forEach((lm, i) => {
    const col = i === info.puppet ? '#a58cff' : i === info.pointer ? (info.pinch ? '#ffb35c' : '#62d6c6') : '#8a86a0';
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of HAND_LINKS) { ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); }
    ctx.stroke();
    ctx.fillStyle = col;
    for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 2.4, 0, Math.PI * 2); ctx.fill(); }
    if (i === info.pointer && info.dwell > 0) {
      const t = lm[8];
      ctx.strokeStyle = '#ff6f61'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x * W, t.y * H, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * info.dwell); ctx.stroke();
    }
  });
}

// ═══════════════════════════════ Oberfläche ═══════════════════════════════
const CSS = `
.ha-root{--bg:${T.bg};--glow:${T.bgGlow};--panel:${T.panel};--panel-solid:${T.panelSolid};--line:${T.line};--line2:${T.lineStrong};--text:${T.text};--dim:${T.textDim};--faint:${T.textFaint};--accent:${T.accent};--accent-hi:${T.accentHi};--accent-soft:${T.accentSoft};--pain:${T.pain};--track:${T.track};--warn:${T.warn};
  color-scheme:dark;position:relative;height:100%;min-height:100%;display:grid;grid-template-rows:auto 1fr;background:radial-gradient(1200px 800px at 38% 45%,var(--glow),var(--bg) 70%);color:var(--text);font-family:${T.sans};font-size:14px;line-height:1.45;overflow:hidden;box-sizing:border-box}
.ha-root *,.ha-root *::before,.ha-root *::after{box-sizing:border-box}
.ha-root button{font:inherit;color:inherit}
.ha-root :focus-visible{outline:2px solid var(--accent-hi);outline-offset:2px}
.ha-head{display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid var(--line);min-width:0}
.ha-logo{flex:none;width:34px;height:34px}
.ha-titles{min-width:0;flex:1}
.ha-title{font-family:${T.serif};font-size:21px;font-weight:400;margin:0;line-height:1.2;letter-spacing:.2px;text-wrap:balance}
.ha-sub{margin:1px 0 0;color:var(--dim);font-size:12.5px}
.ha-headr{display:flex;gap:10px;align-items:center;flex:none}
.ha-seg{display:inline-flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}
.ha-seg button{background:none;border:0;padding:5px 10px;font-size:12.5px;cursor:pointer;color:var(--dim)}
.ha-seg button[aria-pressed="true"]{background:var(--accent-soft);color:var(--text)}
.ha-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(139,108,255,.55);background:rgba(139,108,255,.14);border-radius:8px;padding:7px 13px;cursor:pointer;font-size:13px;white-space:nowrap}
.ha-btn:hover{background:rgba(139,108,255,.24)}
.ha-btn[disabled]{opacity:.6;cursor:progress}
.ha-btn.ghost{background:none;border-color:var(--line2)}
.ha-main{display:grid;grid-template-columns:minmax(0,1fr) 380px;min-height:0}
.ha-stagewrap{position:relative;min-width:0;min-height:0}
.ha-stage{position:absolute;inset:0}
.ha-host{position:absolute;inset:0;touch-action:none}
.ha-canvas{display:block;width:100%;height:100%;cursor:grab}
.ha-canvas:active{cursor:grabbing}
.ha-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.ha-spot{position:absolute;left:-13px;top:-13px;width:26px;height:26px;padding:0;border:0;background:none;cursor:pointer;pointer-events:auto;transition:opacity .2s}
.ha-spot svg{display:block;transition:transform .2s;transform-origin:center;overflow:visible}
.ha-spot.off{opacity:0;pointer-events:none}
.ha-ring{fill:rgba(139,108,255,.07);stroke:#9d86ff;stroke-width:1.3;stroke-dasharray:2.6 2.1}
.ha-dot{fill:#b7a4ff}
.ha-x{stroke:#fff;stroke-width:1.8;stroke-linecap:round;opacity:0}
.ha-spot.hov .ha-ring{stroke-dasharray:none;fill:rgba(139,108,255,.25);stroke:#c4b6ff}
.ha-spot.hov svg{transform:scale(1.15)}
.ha-spot.sel svg{transform:scale(1.32)}
.ha-spot.sel .ha-ring{fill:rgba(118,86,255,.62);stroke:#d4c9ff;stroke-dasharray:none;stroke-width:1.5}
.ha-spot.sel .ha-dot{opacity:0}.ha-spot.sel .ha-x{opacity:1}
.ha-spot.pain .ha-ring{stroke:var(--pain);stroke-dasharray:none;fill:rgba(255,111,97,calc(.12 + var(--pain,5) * .045))}
.ha-spot.pain .ha-dot{fill:var(--pain)}
.ha-spot.pain.sel .ha-ring{fill:rgba(255,111,97,.7)}
.ha-label{position:absolute;left:0;top:0;padding:4px 9px;border-radius:6px;background:rgba(22,19,44,.9);border:1px solid rgba(157,134,255,.65);color:#cfc4ff;font-size:12.5px;font-weight:600;white-space:nowrap;opacity:0;transition:opacity .15s}
.ha-label.on{opacity:1}
.ha-cursor{position:absolute;left:-20px;top:-20px;width:40px;height:40px;opacity:0;transition:opacity .15s}
.ha-cursor.on{opacity:1}
.ha-cr-bg{fill:rgba(98,214,198,.12);stroke:rgba(98,214,198,.55);stroke-width:2}
.ha-cr-fg{fill:none;stroke:var(--track);stroke-width:3.2;stroke-linecap:round}
.ha-cr-dot{fill:var(--track)}
.ha-ptr .ha-cr-bg{fill:rgba(255,111,97,.14);stroke:rgba(255,111,97,.6)}
.ha-ptr .ha-cr-fg{stroke:var(--pain)}.ha-ptr .ha-cr-dot{fill:var(--pain)}
.ha-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.ha-layers{position:absolute;left:16px;top:16px;width:258px;padding:12px 14px;z-index:3}
.ha-ph{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ha-ph h2{font-family:${T.serif};font-weight:400;font-size:16px;margin:0}
.ha-mono{font-family:${T.mono};font-size:10.5px;letter-spacing:.9px;color:var(--faint);text-transform:uppercase}
.ha-peel{display:grid;grid-template-columns:auto 1fr 38px;align-items:center;gap:10px;margin:10px 0 6px;font-size:12.5px;color:var(--dim)}
.ha-peel output{font-family:${T.mono};font-size:11px;color:var(--faint);text-align:right;font-variant-numeric:tabular-nums}
.ha-range{width:100%;accent-color:var(--accent);height:18px;margin:0}
.ha-lrow{display:grid;grid-template-columns:12px 1fr auto 26px;align-items:center;gap:9px;padding:5px 0;font-size:13px}
.ha-sw{width:11px;height:11px;border-radius:3px}
.ha-lname{background:none;border:0;padding:0;text-align:left;cursor:pointer;color:var(--dim)}
.ha-lname.top{color:var(--text);font-weight:600}
.ha-lname.gone{text-decoration:line-through;color:var(--faint)}
.ha-lst{font-family:${T.mono};font-size:10.5px;color:var(--faint);font-variant-numeric:tabular-nums}
.ha-eye{background:none;border:0;padding:3px;cursor:pointer;color:var(--dim);display:grid;place-items:center;border-radius:6px}
.ha-eye:hover{background:rgba(255,255,255,.06)}
.ha-eye[aria-pressed="false"]{color:var(--faint)}
.ha-checks{display:flex;flex-wrap:wrap;gap:6px 16px;border-top:1px solid var(--line);margin-top:8px;padding-top:9px;font-size:12.5px;color:var(--dim)}
.ha-checks label{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.ha-checks input{accent-color:var(--accent);margin:0}
.ha-collapse{display:none}
.ha-views{position:absolute;right:16px;top:16px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:3;max-width:calc(100% - 300px)}
.ha-vbar{display:flex;flex-wrap:wrap;justify-content:flex-end;padding:4px;gap:2px}
.ha-vbar button{background:none;border:0;border-radius:7px;padding:5px 10px;font-size:12.5px;color:var(--dim);cursor:pointer}
.ha-vbar button:hover{background:rgba(255,255,255,.06);color:var(--text)}
.ha-vbar .sep{width:1px;background:var(--line2);margin:4px 4px}
.ha-vbar button[aria-pressed="true"]{background:var(--accent-soft);color:var(--text)}
.ha-hint{font-size:11.5px;color:var(--faint);text-align:right}
.ha-dock{position:absolute;left:16px;right:16px;bottom:16px;display:flex;justify-content:space-between;align-items:flex-end;gap:14px;pointer-events:none;z-index:3}
.ha-dock>*{pointer-events:auto}
.ha-posebar{padding:10px 12px;display:grid;gap:8px;min-width:0;max-width:640px}
.ha-prow{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.ha-prow .ha-mono{width:64px;flex:none}
.ha-chip{border:1px solid var(--line2);background:rgba(255,255,255,.02);border-radius:999px;padding:4px 11px;font-size:12.5px;cursor:pointer;color:var(--dim);white-space:nowrap}
.ha-chip:hover{color:var(--text);border-color:rgba(157,134,255,.5)}
.ha-chip[aria-pressed="true"]{background:rgba(139,108,255,.85);border-color:transparent;color:#fff}
.ha-exnow{display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap}
.ha-exnow strong{font-family:${T.serif};font-weight:400;font-size:15px}
.ha-cam{width:304px;padding:10px;display:grid;gap:9px}
.ha-cam video{display:none}
.ha-prev{width:100%;aspect-ratio:4/3;border-radius:8px;background:#07080c;display:block;max-width:100%}
.ha-tabs{display:grid;grid-template-columns:1fr 1fr;background:rgba(255,255,255,.04);border-radius:8px;padding:3px;gap:3px}
.ha-tabs button{border:0;background:none;border-radius:6px;padding:6px 4px;font-size:12.5px;cursor:pointer;color:var(--dim)}
.ha-tabs button[aria-pressed="true"]{background:rgba(255,255,255,.08);color:var(--text)}
.ha-camstatus{font-size:12.5px;color:var(--dim);min-height:1.45em}
.ha-camstatus b{color:var(--accent-hi);font-weight:600}
.ha-steps{margin:0;padding-left:18px;font-size:12px;color:var(--faint);display:grid;gap:3px}
.ha-camfoot{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;color:var(--dim)}
.ha-camfoot label{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.ha-camfoot input{accent-color:var(--accent);margin:0}
.ha-camcta h3{font-family:${T.serif};font-weight:400;font-size:15px;margin:0 0 4px}
.ha-camcta p{margin:0 0 10px;font-size:12.5px;color:var(--dim)}
.ha-err{font-size:12.5px;color:var(--warn);margin:0 0 10px}
.ha-side{border-left:1px solid var(--line);overflow-y:auto;padding:18px 20px 28px;min-height:0;background:rgba(12,13,20,.55)}
.ha-crumb{display:flex;align-items:center;gap:7px}
.ha-side h2{font-family:${T.serif};font-weight:400;font-size:25px;margin:6px 0 10px;line-height:1.2;text-wrap:balance}
.ha-select{width:100%;background:var(--panel-solid);color:var(--text);border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px}
.ha-sec{margin-top:20px}
.ha-sec>.ha-mono{display:block;margin-bottom:8px}
.ha-chips{display:flex;flex-wrap:wrap;gap:6px}
.ha-schip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);border-radius:8px;padding:4px 9px;font-size:12.5px;background:rgba(255,255,255,.02);cursor:pointer;color:var(--text)}
.ha-schip:hover,.ha-schip[aria-pressed="true"]{border-color:rgba(157,134,255,.7);background:var(--accent-soft)}
.ha-schip .ha-sw{width:9px;height:9px;border-radius:2px}
.ha-sym{border:1px solid var(--line2);border-radius:999px;padding:3px 10px;font-size:12px;background:none;cursor:pointer;color:var(--dim)}
.ha-sym[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft);color:var(--text)}
.ha-causes{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.ha-cause{display:grid;grid-template-columns:22px 1fr;gap:10px}
.ha-num{width:21px;height:21px;border-radius:50%;border:1px dashed rgba(157,134,255,.8);display:grid;place-items:center;font-size:11px;color:var(--accent-hi);font-family:${T.mono}}
.ha-cause h3{margin:0;font-size:14.5px;font-weight:650}
.ha-cause p{margin:2px 0 4px;font-family:${T.serif};font-size:14px;color:#d6d3e6;line-height:1.5}
.ha-cause ul{margin:0;padding-left:16px;font-size:12.5px;color:var(--dim);display:grid;gap:2px}
.ha-cause li::marker{color:var(--faint)}
.ha-match{display:inline-block;margin-left:8px;font-size:10.5px;font-family:${T.mono};color:var(--track);letter-spacing:.4px;vertical-align:middle}
.ha-helps{margin:0;padding-left:16px;display:grid;gap:8px;font-size:13.5px}
.ha-helps li::marker{color:var(--accent)}
.ha-show{display:inline-flex;align-items:center;gap:5px;margin-top:5px;border:1px solid rgba(157,134,255,.7);border-radius:999px;background:none;padding:2px 10px;font-size:12px;color:var(--accent-hi);cursor:pointer}
.ha-show:hover{background:var(--accent-soft)}
.ha-doc{margin:0;padding-left:16px;display:grid;gap:6px;font-size:13px;color:#f1d7bd}
.ha-doc li::marker{color:var(--warn)}
.ha-red{margin-top:20px;border:1px solid rgba(255,111,97,.35);background:rgba(255,111,97,.07);border-radius:10px;padding:10px 12px;font-size:12.5px;color:#f3cfc9}
.ha-red strong{display:block;color:var(--pain);margin-bottom:2px;font-size:12.5px}
.ha-disc{margin-top:14px;font-size:11.5px;color:var(--faint)}
.ha-mine{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
.ha-mine .ha-btn{padding:5px 11px;font-size:12.5px}
.ha-mine .ha-btn[aria-pressed="true"]{border-color:var(--pain);background:rgba(255,111,97,.16)}
.ha-mine label{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dim)}
.ha-mine input{accent-color:var(--pain);width:110px}
.ha-foot{margin-top:18px;border-top:1px solid var(--line);padding-top:12px;display:grid;gap:8px}
.ha-mylist{display:flex;flex-wrap:wrap;gap:6px}
.ha-mylist button{border:1px solid rgba(255,111,97,.45);background:rgba(255,111,97,.08);color:#f6d2cc;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer}
.ha-boot{position:absolute;inset:0;display:grid;place-items:center;z-index:5;pointer-events:none}
.ha-bootcard{padding:16px 20px;text-align:center;min-width:240px;pointer-events:auto}
.ha-bootcard p{margin:0 0 10px;font-family:${T.serif};font-size:15px}
.ha-bar{height:4px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
.ha-bar i{display:block;height:100%;background:var(--accent);transition:width .2s}
.ha-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width: 1100px){ .ha-main{grid-template-columns:minmax(0,1fr) 330px} .ha-cam{width:270px} }
@media (max-width: 860px){
  .ha-root{height:auto;min-height:100%;overflow:visible;display:block}
  .ha-head{padding:10px 16px;flex-wrap:wrap;gap:10px}
  .ha-title{font-size:18px}
  .ha-headr{margin-left:auto}
  .ha-sub{display:none}
  .ha-main{display:block}
  .ha-stagewrap{position:relative}
  .ha-stage{position:relative;height:62vh;min-height:380px;inset:auto}
  .ha-layers{left:10px;top:10px;width:auto;max-width:calc(100% - 20px);padding:8px 10px}
  .ha-layers.closed .ha-lbody{display:none}
  .ha-collapse{display:inline-flex;background:none;border:0;padding:2px 4px;color:var(--dim);cursor:pointer;font-size:12px}
  .ha-views{position:absolute;top:auto;bottom:10px;right:10px;left:10px;max-width:none;align-items:stretch}
  .ha-vbar{justify-content:center}
  .ha-hint{display:none}
  .ha-dock{position:static;flex-direction:column;align-items:stretch;padding:12px 16px 0}
  .ha-posebar{max-width:none}
  .ha-cam{width:auto}
  .ha-prev{max-height:220px;object-fit:cover}
  .ha-side{border-left:0;border-top:1px solid var(--line);margin-top:12px;overflow:visible;padding:16px}
}
@media (prefers-reduced-motion: reduce){ .ha-root *{transition:none!important} }
`;

const EyeIcon = ({ off }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);
const CamIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2" /><path d="M15.5 10.5l6-3.5v10l-6-3.5z" /></svg>
);
const Logo = () => (
  <svg className="ha-logo" viewBox="-17 -17 34 34" aria-hidden="true">
    <circle r="14.5" fill="rgba(139,108,255,.12)" stroke="#9d86ff" strokeWidth="1.6" strokeDasharray="3 2.4" />
    <path d="M-5.2 -5.2L5.2 5.2M5.2 -5.2L-5.2 5.2" stroke="#c9bcff" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

function fmt(s, vars) { return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }

export default function HandPainAtlas() {
  const reduced = useMemo(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }, []);
  const [boot, setBoot] = useState({ phase: 'loading', progress: 0, error: null });
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState(INITIAL.lang);
  const [side, setSide] = useState(INITIAL.side);
  const [peel, setPeel] = useState(INITIAL.peel);
  const [vis, setVis] = useState(INITIAL.vis);
  const [settings, setSettings] = useState(INITIAL.settings);
  const [painMarks, setPainMarks] = useState({});
  const [explored, setExplored] = useState([]);
  const [selected, setSelected] = useState('wrist_palm');
  const [hoverStruct, setHoverStruct] = useState(null);
  const [pinStruct, setPinStruct] = useState(null);
  const [pose, setPose] = useState('relaxed');
  const [exState, setExState] = useState(null);
  const [cam, setCam] = useState({ on: false, busy: false, error: null });
  const [camStatus, setCamStatus] = useState(null);
  const [feel, setFeel] = useState([]);
  const [layersOpen, setLayersOpen] = useState(() => { try { return !window.matchMedia('(max-width: 860px)').matches; } catch (e) { return true; } });
  const [view, setView] = useState(null);
  const hostRef = useRef(null), overlayRef = useRef(null), engRef = useRef(null), trkRef = useRef(null);
  const videoRef = useRef(null), prevRef = useRef(null), sideRef = useRef(null);
  const L_ = (o) => tr(o, lang);
  const langRef = useRef(lang); langRef.current = lang;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const statusKey = useRef('');

  // Gespeicherten Zustand laden (Storage-Kette)
  useEffect(() => {
    let dead = false;
    storage.get(STORE_KEY).then((raw) => {
      if (dead) return;
      const s = raw ? migrate(raw) : { ...INITIAL };
      setLang(s.lang === 'en' ? 'en' : 'de'); setSide(s.side === 'L' ? 'L' : 'R');
      setPeel(clamp(Number(s.peel) || 0, 0, 5)); setVis(s.vis); setSettings(s.settings);
      setPainMarks(s.painMarks); setExplored(s.explored);
      setReady(true);
    });
    return () => { dead = true; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      storage.set(STORE_KEY, JSON.stringify({ version: 1, lang, side, peel, vis, settings, painMarks, explored }));
    }, 350);
    return () => clearTimeout(id);
  }, [ready, lang, side, peel, vis, settings, painMarks, explored]);

  // Engine starten
  const cbRef = useRef({});
  cbRef.current = {
    onSelect: (id, src) => {
      setSelected(id); setPinStruct(null);
      if (src === 'gesture') { chime(); haptic(18); }
    },
    onSide: (s) => setSide(s),
    onPeel: (v) => setPeel(Math.round(v * 100) / 100),
    onExercise: (e) => setExState(e),
  };
  useEffect(() => {
    let dead = false; let eng = null;
    (async () => {
      try {
        await loadScript(CDN.three);
        if (!window.THREE) throw new Error('three');
        THREE = window.THREE;
        const probe = document.createElement('canvas');
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) { setBoot({ phase: 'error', progress: 0, error: 'webgl' }); return; }
        eng = new HandEngine(hostRef.current, overlayRef.current, {
          reduced,
          onSelect: (id, src) => cbRef.current.onSelect(id, src),
          onHover: () => {},
          onSide: (s) => cbRef.current.onSide(s),
          onPeel: (v) => cbRef.current.onPeel(v),
          onExercise: (e) => cbRef.current.onExercise(e),
          getLabel: (id) => regionName(id, langRef.current),
        });
        await eng.init((p) => { if (!dead) setBoot((b) => ({ ...b, progress: p })); });
        if (dead) { eng.dispose(); return; }
        engRef.current = eng;
        window.__handAtlas = eng;
        setBoot({ phase: 'ready', progress: 1, error: null });
      } catch (e) {
        console.error(e);
        if (!dead) setBoot({ phase: 'error', progress: 0, error: 'three' });
      }
    })();
    return () => { dead = true; trkRef.current?.stop(); eng?.dispose(); engRef.current = null; };
  }, [reduced]);

  const eng = boot.phase === 'ready' ? engRef.current : null;
  useEffect(() => { eng?.setSide(side); }, [eng, side]);
  useEffect(() => { eng?.setLayers({ peel, vis, ghost: settings.ghost, spots: settings.spots }); }, [eng, peel, vis, settings.ghost, settings.spots]);
  useEffect(() => { eng?.setSelected(selected); }, [eng, selected]);
  useEffect(() => { eng?.setHighlight(selected, hoverStruct || pinStruct); }, [eng, selected, hoverStruct, pinStruct]);
  useEffect(() => { eng?.setPainMarks(painMarks); }, [eng, painMarks]);
  useEffect(() => { eng?.setMode(settings.mode); }, [eng, settings.mode]);
  useEffect(() => { eng?.setMirrorView(cam.on && settings.mode === 'mirror'); }, [eng, cam.on, settings.mode]);
  useEffect(() => {
    if (!ready || !selected) return;
    setExplored((ex) => (ex.includes(selected) ? ex : [...ex, selected]));
  }, [ready, selected]);

  // Webcam
  const onResults = useCallback((res) => {
    const e = engRef.current; if (!e) return;
    const v = videoRef.current;
    const aspect = v && v.videoWidth ? v.videoWidth / v.videoHeight : 4 / 3;
    const info = e.ingestHands(res, { mode: settingsRef.current.mode, swap: settingsRef.current.swap, aspect });
    drawPreview(prevRef.current, res, info);
    const lg = langRef.current;
    let st;
    if (settingsRef.current.mode === 'air') st = { k: 'air', region: info.region };
    else if (!info.n) st = { k: 'none' };
    else st = { k: 'mirror', side: info.side, facing: info.facing || e.trk.facing, region: info.pointer >= 0 ? info.region : null, peeling: info.peeling };
    const key = JSON.stringify(st) + lg;
    if (key !== statusKey.current) { statusKey.current = key; setCamStatus(st); }
  }, []);
  const startCam = async () => {
    if (cam.busy) return;
    setCam({ on: false, busy: true, error: null });
    const t = new HandTracker(videoRef.current, onResults);
    trkRef.current = t;
    try {
      await t.start();
      setCam({ on: true, busy: false, error: null });
      if (settingsRef.current.mode === 'mirror') { engRef.current?.setView('palm'); setView('palm'); }
    } catch (err) {
      t.stop(); trkRef.current = null;
      const name = err?.name || '';
      const code = name === 'HandsLoadError' ? 'handsFail' : (name === 'NotFoundError' || name === 'OverconstrainedError') ? 'camNoDevice' : 'camDenied';
      setCam({ on: false, busy: false, error: code });
    }
  };
  const stopCam = () => {
    trkRef.current?.stop(); trkRef.current = null;
    engRef.current?.resetTracking();
    setCam({ on: false, busy: false, error: null }); setCamStatus(null); statusKey.current = '';
  };

  const region = REGION_BY_ID[selected] || REGIONS[0];
  const tpl = REGION_TPL[region.tpl];
  const crumb = [...tpl.crumb.map(L_), region.finger != null ? L_(FINGER_NAMES[region.finger]) : null].filter(Boolean).join(' · ');
  const causes = useMemo(() => {
    const list = tpl.c.map((id, i) => ({ id, i, c: CONDITIONS[id], m: feel.length ? CONDITIONS[id].t.filter((t) => feel.includes(t)).length : 0 }));
    return feel.length ? [...list].sort((a, b) => b.m - a.m || a.i - b.i) : list;
  }, [tpl, feel]);
  const painLevel = painMarks[selected] || 0;
  const setPain = (v) => setPainMarks((m) => { const n = { ...m }; if (v > 0) n[selected] = v; else delete n[selected]; return n; });
  const layerState = (k) => {
    if (!vis[k]) return { st: L_(UI.stHidden), gone: true };
    if (k === 5) return { st: '', gone: false };
    const p = clamp(peel - k, 0, 1);
    if (p >= 0.999) return { st: k === 0 && settings.ghost ? L_(UI.stGhost) : L_(UI.stPeeled), gone: true };
    if (p > 0.001) return { st: Math.round((1 - p) * 100) + '%', gone: false };
    return { st: '', gone: false };
  };
  const topLayer = (() => { for (let k = 0; k < 6; k++) { if (vis[k] && (k === 5 || peel - k < 0.999)) return k; } return 5; })();
  const reveal = (sid) => {
    const li = LAYER_IX[STRUCTS[sid].l];
    setVis((v) => v.map((x, i) => (i === li ? true : x)));
    if (li > 0) setPeel((p) => (p < li || p > li + 0.5 ? li : p));
    setPinStruct((p) => (p === sid ? null : sid));
  };
  const statusText = (() => {
    if (!camStatus) return null;
    if (camStatus.k === 'air') return <>{L_(UI.airStatus)}{camStatus.region && <> {L_(UI.pointingAt)}: <b>{regionName(camStatus.region, lang)}</b></>}</>;
    if (camStatus.k === 'none') return L_(UI.noHand);
    if (camStatus.peeling) return <b>{L_(UI.peeling)} …</b>;
    const sideName = L_(camStatus.side === 'L' ? UI.leftHand : UI.rightHand);
    const [pre, post] = L_(UI.mirroring).split('{side}');
    return <>{pre}<b>{sideName}</b>{fmt(post, { facing: L_(camStatus.facing === 'back' ? UI.backFacing : UI.palmFacing) })}
      {camStatus.region && <> {L_(UI.pointingAt)}: <b>{regionName(camStatus.region, lang)}</b></>}</>;
  })();
  const isTouch = useMemo(() => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }, []);
  const doView = (v) => { eng?.setView(v); setView(v); };
  const exName = exState ? L_(EXERCISES[exState.id].n) : '';
  const exStep = exState ? L_(EXERCISES[exState.id].steps[exState.i].n) : '';
  const myList = Object.entries(painMarks).filter(([id]) => REGION_BY_ID[id]);

  return (
    <div className="ha-root" lang={lang}>
      <style>{CSS}</style>
      <header className="ha-head">
        <Logo />
        <div className="ha-titles">
          <h1 className="ha-title">{L_(UI.title)}</h1>
          <p className="ha-sub">{L_(UI.subtitle)}</p>
        </div>
        <div className="ha-headr">
          <div className="ha-seg" role="group" aria-label="Sprache / Language">
            <button type="button" aria-pressed={lang === 'de'} onClick={() => setLang('de')}>DE</button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          </div>
          {cam.on
            ? <button type="button" className="ha-btn" onClick={stopCam}><CamIcon />{L_(UI.stopCam)}</button>
            : <button type="button" className="ha-btn" onClick={startCam} disabled={cam.busy || boot.phase !== 'ready'}><CamIcon />{cam.busy ? L_(UI.camLoading) : L_(UI.startCam)}</button>}
        </div>
      </header>
      <div className="ha-main">
        <div className="ha-stagewrap">
          <div className="ha-stage">
            <div className="ha-host" ref={hostRef} />
            <div className="ha-overlay" ref={overlayRef} />
            {boot.phase !== 'ready' && (
              <div className="ha-boot">
                <div className="ha-panel ha-bootcard" role="status">
                  {boot.phase === 'error'
                    ? <><p>{L_(boot.error === 'webgl' ? UI.webglFail : UI.threeFail)}</p><button type="button" className="ha-btn" onClick={() => window.location.reload()}>{L_(UI.retry)}</button></>
                    : <><p>{L_(UI.building)}</p><div className="ha-bar"><i style={{ width: `${Math.round(boot.progress * 100)}%` }} /></div></>}
                </div>
              </div>
            )}
            <section className={'ha-panel ha-layers' + (layersOpen ? '' : ' closed')} aria-label={L_(UI.layers)}>
              <div className="ha-ph">
                <h2>{L_(UI.layers)}</h2>
                <span className="ha-mono">{L_(UI.outerDeep)}</span>
                <button type="button" className="ha-collapse" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>{layersOpen ? '▴' : '▾'}</button>
              </div>
              <div className="ha-peel">
                <label htmlFor="ha-peel">{L_(UI.peel)}</label>
                <input id="ha-peel" className="ha-range" type="range" min="0" max="5" step="0.01" value={peel} onChange={(e) => setPeel(Number(e.target.value))} />
                <output htmlFor="ha-peel">{peel.toFixed(2)}</output>
              </div>
              <div className="ha-lbody">
                {LAYERS.map((ly, k) => {
                  const s = layerState(k);
                  return (
                    <div className="ha-lrow" key={ly.id}>
                      <span className="ha-sw" style={{ background: T.layer[ly.id] }} />
                      <button type="button" className={'ha-lname' + (s.gone ? ' gone' : '') + (k === topLayer ? ' top' : '')} onClick={() => { setVis((v) => v.map((x, i) => (i === k ? true : x))); setPeel(k); }}>{L_(ly.name)}</button>
                      <span className="ha-lst">{s.st}</span>
                      <button type="button" className="ha-eye" aria-pressed={vis[k]} aria-label={L_(ly.name)} onClick={() => setVis((v) => v.map((x, i) => (i === k ? !x : x)))}><EyeIcon off={!vis[k]} /></button>
                    </div>
                  );
                })}
                <div className="ha-checks">
                  <label><input id="ha-ghost" type="checkbox" checked={settings.ghost} onChange={(e) => setSettings((s) => ({ ...s, ghost: e.target.checked }))} />{L_(UI.ghostSkin)}</label>
                  <label><input id="ha-spots" type="checkbox" checked={settings.spots} onChange={(e) => setSettings((s) => ({ ...s, spots: e.target.checked }))} />{L_(UI.painSpots)}</label>
                </div>
              </div>
            </section>
            <div className="ha-views">
              <div className="ha-panel ha-vbar" role="group" aria-label="Ansicht / View">
                {['palm', 'back', 'thumb', 'pinky'].map((v) => <button type="button" key={v} aria-pressed={view === v} onClick={() => doView(v)}>{L_(UI.views[v])}</button>)}
                <span className="sep" />
                <button type="button" aria-pressed={side === 'L'} onClick={() => setSide('L')} title={L_(UI.model)}>{L_(UI.sideL)}</button>
                <button type="button" aria-pressed={side === 'R'} onClick={() => setSide('R')} title={L_(UI.model)}>{L_(UI.sideR)}</button>
              </div>
              <div className="ha-hint">{L_(isTouch ? UI.hintTouch : UI.hint)}</div>
            </div>
          </div>
          <div className="ha-dock">
            <section className="ha-panel ha-posebar" aria-label={L_(UI.pose)}>
              {exState ? (
                <div className="ha-exnow" role="status">
                  <span className="ha-mono">{L_(UI.exercise)}</span>
                  <strong>{exName}</strong>
                  <span>{L_(UI.step)} {exState.i + 1}/{exState.n} · {exStep}</span>
                  <button type="button" className="ha-btn ghost" onClick={() => eng?.stopExercise()}>{L_(UI.stop)}</button>
                </div>
              ) : (<>
                <div className="ha-prow">
                  <span className="ha-mono">{L_(UI.pose)}</span>
                  {POSE_ORDER.map((p) => <button type="button" key={p} className="ha-chip" aria-pressed={pose === p} onClick={() => { setPose(p); eng?.setPoseName(p); }}>{L_(POSES[p].n)}</button>)}
                </div>
                <div className="ha-prow">
                  <span className="ha-mono">{L_(UI.exercise)}</span>
                  {EXERCISE_ORDER.map((x) => <button type="button" key={x} className="ha-chip" onClick={() => eng?.playExercise(x)}>▶ {L_(EXERCISES[x].n)}</button>)}
                </div>
              </>)}
            </section>
            <section className="ha-panel ha-cam" aria-label="Webcam">
              <video ref={videoRef} muted playsInline />
              {cam.on ? (<>
                <canvas ref={prevRef} className="ha-prev" width="320" height="240" />
                <div className="ha-tabs" role="group">
                  <button type="button" aria-pressed={settings.mode === 'mirror'} onClick={() => setSettings((s) => ({ ...s, mode: 'mirror' }))}>{L_(UI.mirror)}</button>
                  <button type="button" aria-pressed={settings.mode === 'air'} onClick={() => setSettings((s) => ({ ...s, mode: 'air' }))}>{L_(UI.air)}</button>
                </div>
                <div className="ha-camstatus" role="status" aria-live="polite">{statusText}</div>
                <ol className="ha-steps">{(settings.mode === 'air' ? UI.airSteps : UI.mirrorSteps).map((s, i) => <li key={i}>{L_(s)}</li>)}</ol>
                <div className="ha-camfoot">
                  <label><input id="ha-swap" type="checkbox" checked={settings.swap} onChange={(e) => setSettings((s) => ({ ...s, swap: e.target.checked }))} />{L_(UI.swap)}</label>
                  <button type="button" className="ha-btn ghost" onClick={stopCam}>{L_(UI.stop)}</button>
                </div>
              </>) : (
                <div className="ha-camcta">
                  <h3>{L_(UI.camCardTitle)}</h3>
                  {cam.error ? <p className="ha-err">{L_(UI[cam.error])}</p> : <p>{L_(UI.camCardText)}</p>}
                  <button type="button" className="ha-btn" onClick={startCam} disabled={cam.busy || boot.phase !== 'ready'}><CamIcon />{cam.busy ? L_(UI.camLoading) : L_(UI.startCam)}</button>
                </div>
              )}
            </section>
          </div>
        </div>
        <aside className="ha-side" aria-live="polite">
          <div className="ha-crumb"><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" fill="none" stroke="#9d86ff" strokeWidth="1.4" strokeDasharray="2 1.6" /></svg><span className="ha-mono">{crumb}</span></div>
          <h2>{regionName(selected, lang)}</h2>
          <label className="ha-sr" htmlFor="ha-region">{L_(UI.chooseSpot)}</label>
          <select id="ha-region" className="ha-select" value={selected} onChange={(e) => { setSelected(e.target.value); setPinStruct(null); }}>
            {REGION_GROUPS.map((g) => (
              <optgroup key={g.ids[0]} label={L_(g.n)}>
                {g.ids.map((id) => <option key={id} value={id}>{regionName(id, lang)}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="ha-mine">
            <button type="button" className="ha-btn ghost" aria-pressed={painLevel > 0} onClick={() => setPain(painLevel > 0 ? 0 : 5)}>{L_(UI.myspot)}</button>
            {painLevel > 0 && <label>{L_(UI.intensity)} <input id="ha-pain" type="range" min="1" max="10" step="1" value={painLevel} onChange={(e) => setPain(Number(e.target.value))} /> <span className="ha-lst">{painLevel}/10</span></label>}
          </div>
          <div className="ha-sec">
            <span className="ha-mono">{L_(UI.under)}</span>
            <div className="ha-chips">
              {tpl.u.map((sid) => (
                <button type="button" key={sid} className="ha-schip" aria-pressed={pinStruct === sid}
                  onMouseEnter={() => setHoverStruct(sid)} onMouseLeave={() => setHoverStruct(null)}
                  onFocus={() => setHoverStruct(sid)} onBlur={() => setHoverStruct(null)} onClick={() => reveal(sid)}>
                  <span className="ha-sw" style={{ background: T.layer[STRUCTS[sid].l] }} />{L_(STRUCTS[sid].n)}
                </button>
              ))}
            </div>
          </div>
          <div className="ha-sec">
            <span className="ha-mono">{L_(UI.feel)}</span>
            <div className="ha-chips">
              {SYMPTOMS.map((s) => <button type="button" key={s.id} className="ha-sym" aria-pressed={feel.includes(s.id)} onClick={() => setFeel((f) => (f.includes(s.id) ? f.filter((x) => x !== s.id) : [...f, s.id]))}>{L_(s.n)}</button>)}
            </div>
          </div>
          <div className="ha-sec">
            <span className="ha-mono">{L_(UI.causes)}</span>
            <ol className="ha-causes">
              {causes.map(({ id, c, m }, i) => (
                <li className="ha-cause" key={id}>
                  <span className="ha-num">{i + 1}</span>
                  <div>
                    <h3>{L_(c.n)}{m > 0 && <span className="ha-match">● {L_(UI.matches)}</span>}</h3>
                    <p>{L_(c.d)}</p>
                    <ul>{c.s.map((s, j) => <li key={j}>{L_(s)}</li>)}</ul>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="ha-sec">
            <span className="ha-mono">{L_(UI.helps)}</span>
            <ul className="ha-helps">
              {tpl.h.map((h, i) => (
                <li key={i}>{L_(h)}{h.x && <><br /><button type="button" className="ha-show" onClick={() => eng?.playExercise(h.x)}>▶ {L_(UI.showMe)}: {L_(EXERCISES[h.x].n)}</button></>}</li>
              ))}
            </ul>
          </div>
          <div className="ha-sec">
            <span className="ha-mono">{L_(UI.doctor)}</span>
            <ul className="ha-doc">{tpl.k.map((k, i) => <li key={i}>{L_(k)}</li>)}</ul>
          </div>
          <div className="ha-red"><strong>{L_(UI.redflagsTitle)}</strong>{L_(UI.redflags)}</div>
          <div className="ha-foot">
            {myList.length > 0 && (<>
              <span className="ha-mono">{L_(UI.mySpots)}</span>
              <div className="ha-mylist">{myList.map(([id, v]) => <button type="button" key={id} onClick={() => setSelected(id)}>{regionName(id, lang)}{REGION_BY_ID[id].finger != null ? ' · ' + L_(FINGER_NAMES[REGION_BY_ID[id].finger]) : ''} · {v}/10</button>)}</div>
            </>)}
            <span className="ha-mono">{explored.length} / {REGIONS.length} {L_(UI.explored)}</span>
            <p className="ha-disc">{L_(UI.disclaimer)}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
