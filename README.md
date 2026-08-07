# Ascent

A short first-person interactive meditation in a mountain sanctuary at dawn.
One path, one lantern, one breathing orb, one bell, one sunrise. About four minutes.

## Run it locally

No build step and no install. Serve the folder over HTTP (ES modules and the
import map need a real origin — opening `index.html` from the filesystem will not work):

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx serve`, `php -S localhost:8080`, VS Code Live Server).

Three.js r169 is vendored in `vendor/three/`, so the experience runs fully offline.

### Controls

| | |
|---|---|
| Move | `W A S D` or arrow keys |
| Look | mouse (click to capture the cursor) |
| Act | hold `Space` or the left mouse button |
| Touch | left half of the screen to walk, right half to look, hold to act |

Headphones are recommended — all sound is synthesised in the browser, there are no audio files.

### Quality tiers

The renderer picks `high` / `medium` / `low` from device memory, core count and
pointer type. Override it with a query string when testing:

```
http://localhost:8080/?quality=low
```

`low` drops shadows, bloom, the god-ray meshes and most mist layers, and cuts
grass and particle counts — it is the fallback for phones and integrated GPUs.

### Known limitations

**The walk out to the dawn can graze a shrine upright.** Ringing the bell hands
control to an authored settle onto the overlook south of the shrine, so the
sunrise is composed the same way every time. The curve is bowed clear of the
bell, which you can ring from either side of, but the shrine is a ring of four
posts and you can strike from anywhere around it — so from roughly one ringing
position in six the glide passes through a post for two or three frames. The
posts have no collision during normal walking either, so this is the existing
behaviour rather than a new one; solving it properly needs real path planning,
which is more machinery than the moment justifies.

**Green speckles around the orb on some iPads** are not diagnosed. See the note
in `src/environment.js` above the orb shell shader.

## Architecture

Ten source files, plain ES modules, no bundler, no framework.

```
index.html        canvas, import map, the single #ui mount point
styles.css        all interface styling
src/main.js       integration layer: renderer, quality tier, shared state,
                  phase machine, frame loop. Owns no visuals and no UI.
src/environment.js terrain, path, vegetation, rocks, lantern, orb, shrine, bell
src/lighting.js   sky, sun/moon keyframes, shadows, lantern light, post-processing
src/atmosphere.js fog, ground mist, valley clouds, particles, god rays
src/player.js     first-person walker, head bob, assisted look
src/interactions.js proximity + gaze + hold-to-confirm, the three interactions
src/ui.js         title screen, prompts, breath guide, subtitles, completion
src/audio.js      Web Audio synthesis: wind, drone, pad, breath cues, the bell
```

`main.js` declares a locked module contract at the top of the file. Modules never
import each other — they communicate only through that contract and through a
single shared `state` object (`phase`, `dawn`, `mist`, `lanternLit`, `pathGlow`,
`windGust`, …) that `main.js` passes into every `update(dt, state)`.

The phase machine is linear and cannot dead-end:

```
title → lantern → toOrb → breathing → toShrine → bell → ending → complete
```

`interactions.js` advances the early phases; `main.js` drives the 34-second
ending on a timer and shows the completion screen.

Everything is procedural. There are no textures, models or audio files in the
repository — terrain, flagstones, pines, grass, rocks, the shrine and the bell
are generated geometry, materials are generated in code or in GLSL, and every
sound is built from oscillators, noise buffers and a synthesised impulse
response for the reverb.
