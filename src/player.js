import * as THREE from 'three';
/** @see main.js LOCKED MODULE CONTRACT */
export function createPlayer(camera, canvas, ctx) {
  return { update() {}, position: new THREE.Vector3(), setEnabled() {}, lookAtPoint() {}, isMoving: false, speed01: 0 };
}
