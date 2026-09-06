import * as THREE from 'three';

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

    // Crisp ballpoint blue web line
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
   * Update web line from wrist to anchor with slight dynamic catenary sag/vibration
   */
  public updateWeb(startPos: THREE.Vector3, endPos: THREE.Vector3, isTaut: boolean, time: number): void {
    this.mesh.visible = true;
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;

    const sagFactor = isTaut ? 0.08 : 0.45;
    const vibration = isTaut ? Math.sin(time * 35.0) * 0.05 : 0;

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
