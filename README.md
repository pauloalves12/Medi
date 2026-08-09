# Mountain Sanctuary

Two short first-person interactive meditations in the same mountain, chosen on
one title card.

| | |
|---|---|
| **Ascent** | a meditation on movement and release — one path, one lantern, one breathing orb, one bell. About four minutes. |
| **Still Water** | a meditation on stillness — a forest path down to an alpine lake, and as long as it takes. About five minutes. |

Each can be walked at two hours, chosen on the same card.

| | |
|---|---|
| **Ascent — Dawn** | night into sunrise — arrival, waking, beginning |
| **Ascent — Dusk** | day into sunset — release, completion, letting go |
| **Still Water — Moonlit** | a moon on dark water, and the quiet inside that |
| **Still Water — Day** | a clear mountain morning, and a lake becoming a mirror |

## Run it locally

No build step and no install. Serve the folder over HTTP (ES modules and the
import map need a real origin — opening `index.html` from the filesystem will not work):

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx serve`, `php -S localhost:8080`, VS Code Live Server).

Three.js r169 is vendored in `vendor/three/`, so both experiences run fully offline.

### Controls

| | |
|---|---|
| Move | `W A S D` or arrow keys |
| Look | mouse (click to capture the cursor) |
| Act | hold `Space` or the left mouse button — Ascent only |
| Touch | left half of the screen to walk, right half to look, hold to act |

Once Still Water seats you on the shore stone there is nothing left to walk to,
so the whole screen becomes the view.

Headphones are recommended — all sound is synthesised in the browser, there are
no audio files.

### Deep links

```
http://localhost:8080/                                    Ascent, at dawn
http://localhost:8080/?mode=dusk                          Ascent, at dusk
http://localhost:8080/?experience=stillwater              Still Water, moonlit
http://localhost:8080/?experience=stillwater&mode=day     Still Water, morning
http://localhost:8080/?quality=low                        works with any of the above
```

`?mode=` names an hour, and each meditation has its own two: `dawn` / `dusk`
for Ascent, `moonlit` / `day` for Still Water. Choosing the other meditation
drops it, because neither one's hours mean anything in the other.

`?quality=` is a testing override for the tier the renderer picks from device
memory, core count and pointer type. `low` is the fallback for phones and
integrated GPUs: in Ascent it drops shadows, bloom, the god-ray meshes and most
mist layers; in Still Water it drops bloom, the nearest mountain ring, three of
the five mist bands, and coarsens the water grid. Neither of them loses anything
you can interact with, and the whole of Still Water's stillness logic is
identical at every tier.

### Review harness and tests

```bash
node tests/stillness.test.mjs        # the stillness curve, 26 assertions, no browser
node tests/mood.test.mjs             # both hours' tables and contracts, no browser
node tools/links.mjs                 # every entry point and every selector
node tools/shots.mjs stillwater      # Still Water, the moonlit hour
node tools/shots.mjs stillwater day  # Still Water, the morning
node tools/shots.mjs devices         # the final composition on three screens
node tools/shots.mjs ascent dusk     # an Ascent regression pass
```

`tools/links.mjs` is the cheap one — it never renders past a title card, so it
is what to run after touching `boot.js`, `experiences.js`, `ui.js` or either
`main.js`. It checks that each URL boots the world it names, that the card
offers the right meditations and hours with the right one chosen, that unknown
values fall back rather than break, and that every selector lands where it says.

`tools/shots.mjs` needs a static server on `:8080` and Playwright's Chromium. It
replaces `performance.now` with a clock it advances itself, so a five-minute
meditation is arithmetic rather than five minutes, and so the same shot is the
same shot every run. Screenshots land in `review-screenshots/`.

## Architecture

Plain ES modules, no bundler, no framework, no dependencies beyond a vendored
three.js.

```
index.html            canvas, import map, the single #ui mount point
styles.css            all interface styling, shared
src/boot.js           the entry point: reads ?experience= and imports it
src/experiences.js    the catalogue — ids, labels, taglines. Pure data.

src/player.js         SHARED  first-person walker, touch control system
src/ui.js             SHARED  title card, prompts, subtitles, completion

src/main.js           ASCENT  integration layer
src/timeofday.js      ASCENT  dawn and dusk as data
src/environment.js    ASCENT  terrain, path, vegetation, lantern, orb, shrine, bell
src/lighting.js       ASCENT  sky, sun keyframes, shadows, post-processing
src/atmosphere.js     ASCENT  fog, ground mist, the valley cloud sea, god rays
src/interactions.js   ASCENT  proximity + gaze + hold-to-confirm
src/audio.js          ASCENT  Web Audio synthesis

src/water/main.js     STILL WATER  integration layer
src/water/mood.js     STILL WATER  the two hours as data: palettes, the mountain
                                   profile, response curves, and each hour's own
                                   sky as one GLSL function
src/water/textures.js STILL WATER  the two generated images
src/water/scene.js    STILL WATER  ground, shore, stone, pines, mountains
src/water/lake.js     STILL WATER  the water surface and its reflection
src/water/sky.js      STILL WATER  sky dome, the four lights, post-processing
src/water/mist.js     STILL WATER  fog, the low bands, motes
src/water/stillness.js STILL WATER the behavioural stillness value (no imports)
src/water/flow.js     STILL WATER  the phase machine
src/water/audio.js    STILL WATER  Web Audio synthesis
```

### How the two are separated

`boot.js` reads `?experience=` and imports one integration layer or the other.
That is the entire coupling. Neither experience imports anything of the other's,
neither knows the other exists beyond the catalogue entry the title card needs,
and there is no `if (stillWater)` anywhere. Changing an experience cannot change
the other one because there is no code path they share except `player.js`,
`ui.js` and the stylesheet.

Choosing on the title card is a page load rather than a teardown, for the same
reason changing the hour is: half of what separates two worlds is decided while
its materials are being built, and nobody switches twice. The reload happens
behind a fade and lands back on the title with the other world already behind it.

Each experience declares a module contract at the top of its own `main.js`.
Modules never import each other — they communicate through that contract and a
single shared `state` object passed into every `update(dt, state)`. The two
leaves each experience allows itself (`timeofday.js`, `mood.js` / `textures.js`)
are tables and generators with no behaviour, which is why importing them is not
a channel between modules.

Everything is procedural in both. There are no textures, models or audio files
in the repository — terrain, stones, pines, grass, the shrine, the bell and the
lake are generated geometry, materials are generated in code or in GLSL, and
every sound is built from oscillators, noise buffers and a synthesised impulse
response for the reverb.

## Ascent

The phase machine is linear and cannot dead-end:

```
title → lantern → toOrb → breathing → toShrine → bell → ending → complete
```

`interactions.js` advances the early phases; `main.js` drives the 44-second
ending on a timer and shows the completion screen.

### Time of day

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

## Still Water

```
title → approach → shore → settling → breathing → reflection → stillness → reveal → complete
```

A path down through pines to a stone at the edge of a lake, five breaths, and
then a long quiet with almost nothing in it.

### The two hours

Structurally this is Ascent's `timeofday.js` again, and deliberately so: one
file of data, resolved once, handed to every module, and read through per-hour
response curves rather than branched on.

`water/main.js` reads `?mode=`, resolves a mood out of `mood.js`, and puts it on
`ctx.mood`. Every module takes its palette, its ridge colours, its curves and
its sky shader off that. There is no `if (day)` in the experience, and no module
is told which hour it is drawing.

A mood owns the whole look and none of the place. The path, the stone, the
shoreline, the headlands, the four rings of mountain and every anchor —
including the authored composition the ending drifts onto — are built once from
the same numbers at both hours. `ridgeHeight()` is one function outside both
tables, so what stands on the horizon is the same mountain range whichever hour
you walk it in; only its colours belong to an hour.

Two channels drive the world, and keeping them apart is the whole design:

| | |
|---|---|
| **stillness** | the air and the water clearing — haze, ripple, reflection, the mist drawing apart. Reversible, because fidgeting has to cost something. |
| **time** | the morning progressing — the sun's elevation, the sky's own colour. Monotone, because a sun that sank when you looked around would read as a bug. |

Moonlit has no second channel: its arc returns zero, because a moon does not
move in the five minutes anybody is watching it. Day runs early morning into
clear late morning over about seven minutes, and nothing about it is meant to be
noticeable while it happens — it is the difference between the frame at the
arrival and the frame at the end, not an event.

The celestial values for the current frame are computed once, in `main.js`, and
written to `state.light`. The dome and the water both read them from there. That
is not tidiness: it is the reflection technique's only correctness requirement.
If the sky and the lake disagreed by one frame about where the sun was, the
lake would be reflecting a sky that is not above it.

### The mechanic

The calmer the player is, the calmer the lake becomes. There is no meter, no
score, no achievement and no text that says so; the environment is the entire
feedback channel, and the player is meant to work it out by noticing.

`stillness.js` turns behaviour into one number. It watches the camera's angular
velocity and the walking speed — nothing else, and no sensor of any kind — and
is built specifically not to feel like a combo meter:

- a **deadband** under 0.16 rad/s, so a thumb resting on a screen costs nothing;
- **smoothing** on the raw rate, so one fat pointer-event batch cannot spike it;
- **asymmetry** — disturbance arrives in a quarter of a second and leaves over
  nearly two, so the water keeps moving for a moment after you stop;
- **hysteresis** — rising and falling are a latched state with two thresholds, so
  hovering near the edge does not chatter.

Calm from nothing to full takes about 28 seconds. Ten seconds of continuously
looking around spends all of it. One deliberate one-second glance costs about a
tenth, tail included. Nothing ever resets, nothing can fail, and no breath is
ever lost. `tests/stillness.test.mjs` asserts all of that without a browser.

`state.settle` is what the world actually reads: the stillness, floored by
`flow.js`. The floor is zero for the entire middle of the piece and only climbs
during the final reveal, so the clear water is earned nearly every time it is
seen, and merely arrived at by the player who was never still. Every phase also
leaves on *stillness or time, whichever comes first*, so a restless night is
waited out rather than punished.

### The lake

One mesh, one material, no render target, no second camera, no extra pass.

A planar reflection costs a whole second render of the world, and buys almost
nothing here: what is above this lake is a sky, a moon, a field of stars and four
rings of distant silhouette, none of which have parallax worth resolving from a
camera that moves two metres.

So the water asks instead. Each hour exports its sky as a GLSL *function*, and
both hours export the same two entry points with the same signature. The dome
calls it looking outward. For each water fragment, the lake reflects the view
vector about the perturbed surface normal and calls the same function down the
reflected ray, plus one lookup into a 1024×96 panorama of the skyline baked from
the same profile function the mountain geometry is built from. That returns the
sky, the light's disc and haloes, the horizon band, the fine detail and the
mountains, correctly placed, for the price of a lit pixel — and it is why what
stands on the horizon and what lies in the water are the same mountains.

Sampling the reflection *through the normal* is also what makes the mechanic work
for free. A disturbed lake scatters the reflected rays over a wide cone, so the
mirror image smears and the fine detail is lost in it. A still one hands the
detail back. Nothing fades anything; the same arithmetic gets a steadier
question.

The two arguments the hours read differently — `detailGain` and `detailSoft` —
are where that lands. At night they are the field of stars: a broken lake keeps
only the brightest, and the faint field returns as the water goes quiet. By day
they are the definition of the clouds, which do exactly the same thing for
exactly the same reason.

Where the reflected ray goes is what decides what the lake shows, and it is the
same geometry at both hours: from a seated eye 2.08 m up, the reflected ray
climbs as the water gets nearer — about 1° at ninety metres out, about 12° at
ten, past the skyline entirely inside about five. So the far water hands back
the mountains and the near water hands back open sky. At night that means the
moon's path and the stars; by day it means the clouds land in the middle of the
frame, where the eye already is.

The geometry stays nearly flat throughout — the whole displacement is under six
centimetres, and the broad swell's *steepness* is carried as a separate number
from its amplitude, because a lake's undulation is far flatter than it needs to
look. What the eye reads as the lake calming is almost entirely the normal.

### The morning

Not the night with the lights turned up. Three things needed more than a
re-tint, and all three are the same lesson in different places:

- **Albedo.** The night palette was mixed to be seen by a moon — the rock is
  `0x38404e` and the pines are `0x1c262e`, because at that light level anything
  darker arrives as black. Under a sun those same values are wet slate and the
  meadow is a grey rug, so the day carries its own. Ascent has this note in both
  directions; lifting the light instead of the albedo only gives grey a suntan.
- **The fill.** A daylight sky is an enormous soft box, and it is the only
  reason a shadow on a shore rock reads blue rather than black. Run anywhere
  near the key's own strength, though, it flattens every rock and ridge into one
  value — which is exactly what "brighter" looks like when it has been mistaken
  for "daylight". It is held to well under half the key.
- **The sun is not where the moon is.** The moon sits at azimuth -7°, straight
  down the lake and straight down the composition, which is right for a moon:
  the path it lays points at the person watching. A sun in the same place puts a
  blown glare column down the middle of the frame, directly on top of the
  reflected mountain — the one thing this hour exists to show. So it goes high
  and hard to the side, at 76-92°, which is Dusk's cross-light lesson applied
  here. Off the axis, the water reflects sky rather than sun, and the mirror
  survives. The composition anchors do not move; only what is lighting them did.

The risks were the other way round from the night's, too. A calm lake under a
bright sky is one step from a sheet of white paper, so the shimmer floor that
keeps the water liquid is set *higher* by day than by night, the bloom runs at a
third of the night's strength with the threshold well up, and the highlight tint
is left almost neutral — warming highlights is what makes a landscape look
graded, and this one should look seen. The subsurface term that stops the
foreground reading as paint has to come back the colour the water made it: run
through the sun's white, as the night's runs through the moon's, it lifts every
channel equally and the whole lake turns to milk.

### The breath

There is no orb. A soft ring opens out of the reflected moon on each inhale and
fades on the exhale — an actual crest in the surface, with a faint rim of light
on it, centred on the point where the moon's mirror image lands for an eye 2.08 m
above the water. Two very quiet words carry the rhythm for anyone not watching.

Looking around during the breathing costs stillness exactly as it does everywhere
else, and the water answering with a rougher surface is the entire consequence.
Cycles are never restarted and there is no failure state.

### The ending

Ascent's lesson, applied: the payoff cannot depend on where the player happened
to be looking, and it also cannot be taken from them with a cut. The reveal opens
with a 2.1-second drift onto an authored composition — ninety metres out on the
moon's own azimuth, a degree and a half above the eye — with the assisted look
easing in to 0.62 and then most of the way back out, so the frame is *made* for
the player without being *taken* from them. The horizon lands just above the
middle, the moon sits in the upper third, its path runs from the horizon down
toward the camera, and a sliver of the stone they are standing on carries the
bottom edge.

## Known limitations

**Ascent: the walk out to the dawn can graze a shrine upright.** Ringing the bell
hands control to an authored settle onto the overlook south of the shrine, so the
sunrise is composed the same way every time. The curve is bowed clear of the
bell, which you can ring from either side of, but the shrine is a ring of four
posts and you can strike from anywhere around it — so from roughly one ringing
position in six the glide passes through a post for two or three frames. The
posts have no collision during normal walking either, so this is the existing
behaviour rather than a new one; solving it properly needs real path planning,
which is more machinery than the moment justifies.

**Ascent: green speckles around the orb on some iPads** are not diagnosed. See
the note in `src/environment.js` above the orb shell shader.

**Ascent: dusk's final frame has no lit foreground object.** The sunset is
watched from the same authored overlook the sunrise is, and both the lantern and
the shrine are behind the camera there.

**Ascent: neither mode shows the sun's disc in the payoff frame.** Every ridge
line subtends 4-15 degrees from the overlook. Still Water does not have this
problem — its moon sits at 17°, clear of a skyline that tops out near 12°.

**Still Water: the water shader is the frame's whole cost.** Everything the lake
does happens per lit pixel, and the lake is most of the screen from the moment
you reach the shore. Distant ripple detail is faded out with distance, which
prevents aliasing and happens to be free, but there is no cheaper path than the
one taken and no fallback below the `low` tier.

**Still Water: the reflected skyline is a panorama, not geometry.** It is baked
from the same profile and at the same eye height, so it agrees with the
mountains to well under a degree, but it is parallax-free — moving the camera
does not move the reflected ridges against each other. At two metres of travel
and four hundred metres of distance there is nothing to see, and nothing in the
piece invites you to test it.

**The review harness cannot drive Ascent's hold-to-confirm.** Ascent asks for
proximity *and* gaze at once, and a scripted walker that goes in a straight line
threads between the two: by the time it is within the three metres of reach, the
lantern is nearly abeam and the gaze term has gone. Keyboard delivery was
verified separately (the window sees the `Space` keydown, `document.activeElement`
is `body`, and the prompt appears with the right label), so this is a limitation
of the harness rather than of the piece — but it means Ascent's regression
evidence is "renders correctly at every stage, no console errors, and none of
the modules that produce it changed" rather than a scripted play-through.

**Neither experience has been run on real hardware.** Everything here was
verified in Chromium against a software rasteriser at phone, tablet and desktop
sizes. That checks composition, behaviour, control flow and correctness; it does
not check frame rate on an actual phone. The rasteriser is also why the harness
shrinks the window between captures and why the review sets were taken on the
`medium` and `low` tiers rather than `high`.
