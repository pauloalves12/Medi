/**
 * boot.js — the page's only entry point.
 *
 * It reads which meditation was asked for and imports it. That is the whole
 * job: it creates no renderer, owns no state and knows nothing about either
 * world, so an experience is free to set itself up however suits it.
 *
 * The choice is a page load rather than a teardown for the same reason the
 * hours are (see the note in main.js): half of what separates two worlds is
 * decided while their materials are being built, and nobody switches twice.
 *
 *   /                     Ascent, at dawn
 *   /?mode=dusk           Ascent, at dusk
 *   /?experience=stillwater
 *   /?quality=low         works with any of the above
 */

import { EXPERIENCES, resolveExperience } from './experiences.js';

const name = resolveExperience(new URLSearchParams(location.search).get('experience'));
document.documentElement.dataset.experience = name;

import(EXPERIENCES[name].module).catch((err) => {
  console.error(err);
  document.body.innerHTML = '<div class="noscript">This meditation could not be loaded.</div>';
});
