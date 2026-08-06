import * as THREE from 'three';
/** @see main.js LOCKED MODULE CONTRACT */
export function createEnvironment(scene, ctx) {
  return {
    update() {}, getGroundHeight: () => 0, constrainPosition: (p) => p,
    anchors: { start: new THREE.Vector3(), lantern: new THREE.Vector3(), orb: new THREE.Vector3(), bell: new THREE.Vector3(), shrineView: new THREE.Vector3() },
    lanternMount: new THREE.Object3D(), orb: new THREE.Object3D(), bell: new THREE.Object3D(),
    setLanternLit() {}, setPathGlow() {}, setOrbBreath() {}, setOrbActive() {}, strikeBell() {},
  };
}
