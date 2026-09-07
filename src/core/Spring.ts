import * as THREE from 'three';

/**
 * Damped harmonic oscillator spring for scalar values (used for camera recoil kicks, FOV pops, landing dips).
 * Sub-steps for mathematical stability when dt is large.
 * Zero-allocation during runtime updates.
 */
export class Spring {
  public value: number = 0;
  public vel: number = 0;
  public target: number = 0;
  public k: number; // Stiffness
  public d: number; // Damping

  constructor(k: number = 120, d: number = 14) {
    this.k = k;
    this.d = d;
  }

  public update(dt: number): number {
    const steps = dt > 0.02 ? 3 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const f = (this.target - this.value) * this.k - this.vel * this.d;
      this.vel += f * h;
      this.value += this.vel * h;
    }
    return this.value;
  }

  public kick(v: number): void {
    this.vel += v;
  }

  public set(v: number): void {
    this.value = v;
    this.vel = 0;
  }

  public reset(): void {
    this.value = 0;
    this.vel = 0;
  }
}

/**
 * 3D vector damped harmonic oscillator spring (used for 3D weapon recoil position and rotation kicks).
 * Zero-allocation during runtime updates.
 */
export class Spring3 {
  public value: THREE.Vector3 = new THREE.Vector3();
  public vel: THREE.Vector3 = new THREE.Vector3();
  public target: THREE.Vector3 = new THREE.Vector3();
  public k: number;
  public d: number;
  private _f: THREE.Vector3 = new THREE.Vector3();

  constructor(k: number = 120, d: number = 14) {
    this.k = k;
    this.d = d;
  }

  public update(dt: number): THREE.Vector3 {
    const steps = dt > 0.02 ? 3 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this._f.copy(this.target).sub(this.value).multiplyScalar(this.k).addScaledVector(this.vel, -this.d);
      this.vel.addScaledVector(this._f, h);
      this.value.addScaledVector(this.vel, h);
    }
    return this.value;
  }

  public kick(x: number, y: number, z: number): void {
    this.vel.x += x;
    this.vel.y += y;
    this.vel.z += z;
  }

  public set(x: number, y: number, z: number): void {
    this.value.set(x, y, z);
    this.vel.set(0, 0, 0);
  }

  public reset(): void {
    this.value.set(0, 0, 0);
    this.vel.set(0, 0, 0);
  }
}
