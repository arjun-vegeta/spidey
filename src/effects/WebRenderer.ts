import * as THREE from 'three';
import { RopeState } from '../player/WebShooter';

export class WebRenderer {
  public mesh: THREE.Line;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  private maxPoints: number = 24;
  private positions: Float32Array;

  constructor() {
    this.positions = new Float32Array(this.maxPoints * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    // Crisp ballpoint blue web line default
    this.material = new THREE.LineBasicMaterial({
      color: 0x142878,
      linewidth: 3,
      transparent: true,
      opacity: 0.95
    });

    this.mesh = new THREE.Line(this.geometry, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /**
   * Update web line from wrist to anchor with dynamic catenary sag, vibration, and distinct rope visual states
   */
  public updateWeb(startPos: THREE.Vector3, endPos: THREE.Vector3, state: RopeState | boolean, time: number): void {
    if (state === RopeState.HIDDEN) {
      this.mesh.visible = false;
      return;
    }

    this.mesh.visible = true;
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;

    const isZipping = state === RopeState.ZIPPING;
    const isTaut = state === RopeState.TAUT || state === true;

    // Distinct visual profiles:
    // ZIPPING: Dead straight, zero sag, high-speed shimmer vibration, electric bright blue (0x38bdf8)
    // TAUT: Slight catenary sag (0.08), taut harmonic vibration, deep ink blue (0x142878)
    // SLACK: Heavy catenary sag (0.45), no vibration, darker ink blue (0x101f5c)
    let sagFactor = 0.45;
    let vibration = 0;
    let colorHex = 0x101f5c;
    let opacity = 0.85;

    if (isZipping) {
      sagFactor = 0.005; // Laser-straight line for high-speed zip pull
      vibration = Math.sin(time * 55.0) * 0.015;
      colorHex = 0x38bdf8; // Electric bright ink line
      opacity = 1.0;
    } else if (isTaut) {
      sagFactor = 0.08;
      vibration = Math.sin(time * 35.0) * 0.05;
      colorHex = 0x142878;
      opacity = 0.95;
    }

    this.material.color.setHex(colorHex);
    this.material.opacity = opacity;

    for (let i = 0; i < this.maxPoints; i++) {
      const t = i / (this.maxPoints - 1);
      // Parabolic sag curve: 4 * t * (1 - t) peaks at t = 0.5
      const sag = 4 * t * (1 - t) * sagFactor;

      const px = THREE.MathUtils.lerp(startPos.x, endPos.x, t);
      const py = THREE.MathUtils.lerp(startPos.y, endPos.y, t) - sag + vibration * Math.sin(t * Math.PI);
      const pz = THREE.MathUtils.lerp(startPos.z, endPos.z, t);

      posAttr.setXYZ(i, px, py, pz);
    }

    posAttr.needsUpdate = true;
  }

  public hide(): void {
    this.mesh.visible = false;
  }
}
