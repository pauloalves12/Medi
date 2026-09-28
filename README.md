# Handschmerz-Atlas · Hand Pain Atlas

Interaktive 3D-Hand zum Erkunden von Handschmerzen – mit Knochen, Muskeln, Sehnen, Nerven und Gefässen, die sich Schicht für Schicht abtragen lassen. Eine Stelle anklicken oder **mit der Webcam auf die eigene Hand zeigen**, und rechts erscheinen mögliche Ursachen, typische Zeichen, was meist hilft und wann man es ärztlich abklären sollte. Oberfläche und Inhalte auf **Deutsch und Englisch** (Umschalter oben rechts).

> Nur zur Orientierung – ersetzt keine ärztliche Untersuchung.

## Starten

`index.html` direkt im Browser öffnen (Chrome, Edge oder Firefox) – oder über GitHub Pages ausliefern. Beim Klick auf **Webcam starten** fragt der Browser nach der Kamera. Das Videobild bleibt auf dem Gerät; die Handerkennung (MediaPipe Hands) läuft lokal im Browser.

Benötigt Internet für die Bibliotheken: React (cdnjs), Three.js r128 (cdnjs), MediaPipe Hands (jsDelivr).

> In der claude.ai-Artifact-Vorschau ist die Kamera gesperrt. Dort funktionieren Modell, Schichten und Klicks – für die Webcam-Steuerung `index.html` direkt öffnen.

## Bedienung

| Aktion | Maus / Touch | Webcam |
|---|---|---|
| Modell drehen / zoomen | ziehen · scrollen / zwei Finger | Hand drehen – das Modell folgt |
| Schichten abtragen | Regler «Abtragen», Klick auf eine Schicht, Augen-Symbol | mit der zweiten Hand kneifen und nach unten ziehen |
| Stelle öffnen | Marker anklicken oder Auswahlliste | mit dem Zeigefinger der anderen Hand auf die schmerzende Stelle zeigen und ~1 s still halten |
| Seite wählen | Handfläche / Handrücken / Daumen- / Kleinfingerseite | Handfläche oder Handrücken zur Kamera |

Zwei Webcam-Modi:
- **Hand spiegeln** – eine Hand steuert Pose und Drehung des Modells (Finger, Daumen, Orientierung). Die zweite Hand zeigt auf Stellen der ersten.
- **Luft-Cursor** – der Zeigefinger bewegt einen Cursor über das Modell; still halten oder Daumen und Zeigefinger zusammenführen öffnet die Stelle.

Falls links/rechts vertauscht erkannt wird (manche Kameras spiegeln bereits), hilft «Links/rechts tauschen».

Weitere Funktionen: Posen (entspannt, offen, Faust, Haken, Zeigen, Pinzettengriff), animierte Übungen (Sehnengleiten, Daumen-Opposition, Spreizen, Blocking, Nervengleiten – auch als «Zeig mir» bei den Tipps), Symptom-Filter («Was spürst du?»), eigene Schmerzstellen mit Stärke 1–10 markieren. Einstellungen und markierte Stellen werden lokal im Browser gespeichert.

## Inhalt

- 38 Stellen (Handgelenk, Unterarm, Handfläche, Handrücken, Daumen, jeder Finger mit Basis, Knöchel, Grundglied, Mittel- und Endgelenk, Kuppe)
- 48 Krankheitsbilder, u. a. Karpaltunnelsyndrom, De Quervain, Rhizarthrose, schnellender Finger, Heberden/Bouchard, Ganglion, TFCC, Skidaumen, Mallet-Finger, Dupuytren, Raynaud
- 6 Schichten: Haut · Faszien & Retinakula · Nerven & Gefässe · Sehnen & Sehnenscheiden · Muskeln · Knochen & Gelenke

## Entwicklung

```bash
npm install
npm run check   # esbuild-Validierung der Single-File-JSX (React extern)
npm run build   # erzeugt index.html und dist/artifact.html
npm test        # Playwright-Rauchtest (Chromium, Fake-Kamera, CDN → lokale npm-Pakete)
```

Die gesamte App steckt in **`src/HandPainAtlas.jsx`** (Single-File-React-Pilot, keine Imports ausser React):

- **Haut**: Distanzfeld aus Kapseln/Ellipsoiden → Surface Nets → GPU-Skinning an ein 26-Knochen-Rig
- **Innere Strukturen**: 152 knochenverankerte Röhren (Sehnen, Nerven, Arterien, Venen, Muskelbäuche, Faszien, Bänder), bei jeder Pose neu geformt
- **Abtragen**: Shader-Patch mit Rausch-Auflösung und leuchtender Kante; Haut als Tiefen-Vorpass + transparenter «Geister»-Umriss
- **Tracking**: MediaPipe-Weltlandmarken → Handrahmen → Gelenkwinkel (Rundreise-Test: 0,00° Abweichung); Zeige-Abbildung 2D → Oberfläche der Modellhand
- **Daumen-IK** (CCD) für Pinzettengriff und Opposition

Justierbare Werte stehen gebündelt in `T` (Design) und `TUNING` (Verweildauer, Pinch-Schwellen, Glättung, Auflösung der Haut …) am Dateianfang.

---

## English

Interactive 3D hand for exploring hand pain. Peel back skin, fascia, nerves & vessels, tendons and muscles down to the bones. Click a marked spot, or **point at your own hand through the webcam**, to see possible causes, typical signs, what usually helps and when to get it checked. Full German and English UI (toggle top right). Open `index.html` directly in Chrome, Edge or Firefox for webcam control; the camera is blocked inside the claude.ai artifact preview. For orientation only, not a diagnosis.
