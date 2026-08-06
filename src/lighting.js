/** @see main.js LOCKED MODULE CONTRACT */
export function createLighting(scene, camera, renderer, ctx) {
  return { update() {}, render: () => renderer.render(scene, camera), resize() {}, setLanternIntensity() {}, lanternLight: null };
}
