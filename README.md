# Ascent

A short first-person interactive meditation in a mountain sanctuary.
One path, one lantern, one breathing orb, one bell. About four minutes.

The same sanctuary can be walked at two hours of the day, chosen on the title card:

| | |
|---|---|
| **Dawn** | night into sunrise — arrival, waking, beginning |
| **Dusk** | day into sunset — release, completion, letting go |

Dawn is the default. The two share every stone, every interaction and the whole
shape of the meditation; what separates them is the light. See **Time of day**
below.

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
http://localhost:8080/?mode=dusk           # skip the title card's choice
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

**Dusk's final frame has no lit foreground object.** The sunset is watched from
the same authored overlook the sunrise is, and both the lantern and the shrine
are behind the camera there. What carries the bottom of that frame is backlit
ground and grass, not warm detail. Moving the camera to include the shrine is
exactly the change the overlook exists to prevent.

**Neither mode shows the sun's disc in the payoff frame.** Every ridge line
subtends 4-15 degrees from the overlook, so no elevation that still reads as
sunrise or sunset also clears them. Dusk aims the sun into the saddle left of
centre and opens the halo, so it reads as the sun immediately behind that notch.

## Architecture

Ten source files, plain ES modules, no bundler, no framework.

```
index.html        canvas, import map, the single #ui mount point
styles.css        all interface styling
src/main.js       integration layer: renderer, quality tier, mode selection,
                  shared state, phase machine, frame loop. Owns no visuals
                  and no UI.
src/timeofday.js  the two experiences as data: keyframe tables, palettes and
                  the response curves every module reads. No behaviour.
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

`timeofday.js` is the one exception, and only because it is not a module in that
sense: it is a leaf table of colours and one-line curves with no behaviour and no
imports of its own. `main.js` reads it once and hands the selected mode to every
module on `ctx.tod`.

The phase machine is linear and cannot dead-end:

```
title → lantern → toOrb → breathing → toShrine → bell → ending → complete
```

`interactions.js` advances the early phases; `main.js` drives the 34-second
ending on a timer and shows the completion screen.

## Time of day

`state.dawn` is a single 0..1 scalar: progress along the active mode's light arc.
At **dawn** it runs pre-dawn indigo → sun in the valley; at **dusk**, clear
afternoon → coral afterglow. Every module reads it through its own curve in
`timeofday.js`, so the same number can mean *the lantern matters less* in one mode
and *the lantern matters more* in the other — which is exactly the reversal dusk
is built around.

A mode owns its celestial keyframe table (azimuth, elevation, key/fill/ambient
colour and intensity, sky, exposure), the colours fog, mist, the cloud sea, the
ridges and the orb lerp between, and about thirty one-line response curves. It
owns no geometry: the terrain, path, pines, rocks, lantern, orb, shrine and bell
are built once and identically for both.

Two things needed more than a re-tint, and both are palettes rather than code:

- **Albedo.** Every colour in `environment.js` was mixed to be seen by a moon —
  the rock is `0x2b2f38`. Daylight lifts them with `world.*` linear multipliers
  (which is why those are arrays, not hexes: they go past 1.0). Lifting the light
  instead only gives grey a suntan.
- **Ridges.** Against a night sky a distant ridge fades *down* toward black;
  against a daylight one it fades *up* toward white. Same geometry, inverted
  vertical gradient, so each mode carries its own four-layer ridge palette.

The walk itself moves the light. Dawn barely does — a little warmth once the
lantern is lit — while dusk covers a third of its arc across the phases, slowly
enough that nothing about it is noticeable until the shrine, where the sun is
already low. The final bell hands over to the same authored settle onto the
overlook in both modes; what differs is what is waiting there.

Everything is procedural. There are no textures, models or audio files in the
repository — terrain, flagstones, pines, grass, rocks, the shrine and the bell
are generated geometry, materials are generated in code or in GLSL, and every
sound is built from oscillators, noise buffers and a synthesised impulse
response for the reverb.
