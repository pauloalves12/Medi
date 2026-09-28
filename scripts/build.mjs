// Baut aus src/HandPainAtlas.jsx zwei Ausgaben:
//   index.html          – vollständiges Dokument (lokal öffnen oder via GitHub Pages; Webcam funktioniert hier)
//   dist/artifact.html  – Fragment für ein claude.ai-Artifact (dort ist die Kamera gesperrt)
// React kommt als UMD von cdnjs; Three.js und MediaPipe lädt die App selbst zur Laufzeit.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

const globals = {
  name: 'globals',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'React', namespace: 'global' }));
    b.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: 'ReactDOM', namespace: 'global' }));
    b.onLoad({ filter: /.*/, namespace: 'global' }, (a) => ({ contents: `module.exports = window.${a.path};`, loader: 'js' }));
  },
};

const res = await build({
  entryPoints: ['src/main.jsx'], bundle: true, write: false, format: 'iife', minify: true,
  target: 'es2019', loader: { '.jsx': 'jsx' }, plugins: [globals], legalComments: 'none', charset: 'utf8',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const TITLE = 'Handschmerz-Atlas';
const DESC = 'Interaktiver 3D-Handschmerz-Atlas: Schichten abtragen, Stellen anklicken oder per Webcam zeigen – mögliche Ursachen und Tipps auf Deutsch und Englisch.';
const REACT = 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js';
const REACT_DOM = 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js';
const baseCss = ':root{color-scheme:dark}html,body,#root{height:100%;margin:0}body{background:#0d0f16;color:#e8e6f2}';
const body = [
  '<div id="root"></div>',
  `<script src="${REACT}" crossorigin="anonymous"></script>`,
  `<script src="${REACT_DOM}" crossorigin="anonymous"></script>`,
  `<script>${js}</script>`,
].join('\n');

const full = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<style>${baseCss}</style>
</head>
<body>
${body}
</body>
</html>
`;
const fragment = `<title>${TITLE}</title>\n<style>${baseCss}</style>\n${body}\n`;

writeFileSync('index.html', full);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/artifact.html', fragment);
console.log(`index.html ${(full.length / 1024).toFixed(0)} KB · dist/artifact.html ${(fragment.length / 1024).toFixed(0)} KB`);
