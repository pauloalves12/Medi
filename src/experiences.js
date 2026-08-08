/**
 * experiences.js — the sanctuary's catalogue.
 *
 * One mountain, more than one meditation in it. This file is the only place
 * that knows how many there are: it is pure data plus one URL helper, it
 * imports nothing, and both boot.js and the two title cards read it.
 *
 * An experience owns everything below its own entry point — its world, its
 * phase machine, its integration layer. Nothing is shared between them except
 * the leaf infrastructure they both import directly (player.js, ui.js) and the
 * page itself. That is deliberately the smallest abstraction that lets a third
 * one exist without either of the first two learning about it.
 */

export const EXPERIENCES = {
  ascent: {
    id: 'ascent',
    label: 'Ascent',
    tagline: 'a meditation on movement and release · about four minutes',
    module: './main.js',
    fadeIn: '#05070e',
  },
  stillwater: {
    id: 'stillwater',
    label: 'Still Water',
    tagline: 'a meditation on stillness · about five minutes',
    module: './water/main.js',
    fadeIn: '#04060d',
  },
};

export const EXPERIENCE_ORDER = ['ascent', 'stillwater'];
export const DEFAULT_EXPERIENCE = 'ascent';

export function resolveExperience(q) {
  return EXPERIENCES[q] ? q : DEFAULT_EXPERIENCE;
}

/**
 * Where `id` lives, starting from wherever we are now.
 *
 * `?quality=` survives because it is a testing switch that should outlive the
 * choice; `?mode=` does not, because both meditations have hours and neither
 * one's names mean anything in the other. Ascent is the default and so carries
 * no parameter at all, which keeps the bare URL meaning what it always meant.
 */
export function experienceHref(id) {
  const url = new URL(location.href);
  url.searchParams.delete('mode');
  if (id === DEFAULT_EXPERIENCE) url.searchParams.delete('experience');
  else url.searchParams.set('experience', id);
  return url.toString();
}
