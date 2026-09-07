import * as THREE from 'three';
import type { WorldCollider } from '../world/WorldCollider';

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  maxLife: number;
  life: number;
  isPaperScrap?: boolean;
  rotation?: number;
  rotSpeed?: number;
  noGravity?: boolean;
  grow?: number;
  drag?: number;
  isBloodDrop?: boolean;
}

export interface BloodPool {
  mesh: THREE.Mesh;
  targetSize: number;
  timer: number;
  growDuration: number;
  life: number;
  maxLife: number;
}

export interface BloodEmitter {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  life: number;
  maxLife: number;
  rate: number;
  accumulator: number;
}

interface Tracer {
  start: THREE.Vector3;
  end: THREE.Vector3;
  len: number;
  life: number;
  maxLife: number;
  thickness: number;
  color: THREE.Color;
  mesh?: THREE.Mesh;
}

/**
 * Procedural sketched ink splat geometry (from inspiration effects.js splatGeometry).
 * Features organic fingers and satellite droplets for authentic ballpoint pen ink spill realism.
 */
function createSplatGeometry(seed: number): THREE.ShapeGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 20;
  const r0 = 0.42 + 0.1 * (((seed * 7) % 3) / 3);
  const tau = Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * tau;
    // Hand-drawn spidery ink fingers
    const finger = Math.pow(Math.abs(Math.sin(a * (1.5 + seed * 0.5) + seed * 2.1)), 3) * 0.55;
    const wob = 0.82 + 0.36 * (((i * 13 + seed * 5) % 7) / 7);
    pts.push(new THREE.Vector2(Math.cos(a) * r0 * (1 + finger) * wob, Math.sin(a) * r0 * (1 + finger * 0.7) * wob));
  }
  const shapes: THREE.Shape[] = [new THREE.Shape(pts)];
  const sat = 3 + (seed % 3);
  for (let k = 0; k < sat; k++) {
    const a = seed * 2.3 + k * (tau / sat) + 0.4;
    const d = 0.6 + 0.22 * (((k * 3 + seed) % 4) / 4);
    const rad = 0.045 + 0.05 * (((k + seed) % 3) / 3);
    const satShape = new THREE.Shape();
    satShape.absarc(Math.cos(a) * d, Math.sin(a) * d, rad, 0, tau, false);
    shapes.push(satShape);
  }
  return new THREE.ShapeGeometry(shapes, 5);
}

export class InkParticles {
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private tracerMeshPool: THREE.Mesh[] = [];
  private activeTracerMeshes: THREE.Mesh[] = [];
  private static tracerGeom: THREE.BoxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private static tmpTracerDir: THREE.Vector3 = new THREE.Vector3();
  private static upVec: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  // Blood pool decal meshes (pooled, zero allocations after startup)
  public static defaultBloodPoolLifetime: number = 12.0;
  public bloodPoolLifetime: number = InkParticles.defaultBloodPoolLifetime;
  public static defaultBloodPoolOpacity: number = 0.58;
  public bloodPoolOpacity: number = InkParticles.defaultBloodPoolOpacity;
  public activeBloodPools: BloodPool[] = [];
  private bloodPoolMeshPool: THREE.Mesh[] = [];
  private bloodPoolGroup: THREE.Group = new THREE.Group();
  private static splatGeoms: THREE.ShapeGeometry[] | null = null;

  // Active continuous blood fountains (e.g. headshot decapitation fountains)
  public bloodEmitters: BloodEmitter[] = [];

  // World collider reference for floor detection on blood droplets and pools
  public worldCollider: WorldCollider | null = null;

  private pointsMesh: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private maxParticles: number = 1200;
  private density: number = 1.0;

  public setDensity(density: 0.5 | 1): void {
    this.density = density;
    this.maxParticles = density < 1 ? 600 : 1200;
    if (this.particles.length > this.maxParticles) {
      this.particles.length = this.maxParticles;
    }
  }

  public bindCollider(c: WorldCollider | null): void {
    this.worldCollider = c;
  }

  private tracerGroup: THREE.Group = new THREE.Group();
  private rootGroup: THREE.Group = new THREE.Group();

  constructor() {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // Generate circular ink droplet texture safely (works in browser and Node test environment)
    let circleTexture: THREE.Texture | undefined = undefined;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      circleTexture = new THREE.CanvasTexture(canvas);
    }

    // Ink droplet particle material (lighter, translucent watercolor/sketch ink)
    const matParams: THREE.PointsMaterialParameters = {
      vertexColors: true,
      size: 0.05,
      transparent: true,
      opacity: 0.82,
      depthWrite: false
    };
    if (circleTexture) {
      matParams.map = circleTexture;
    }
    const particleMat = new THREE.PointsMaterial(matParams);

    this.pointsMesh = new THREE.Points(this.geometry, particleMat);
    this.pointsMesh.frustumCulled = false;
    this.geometry.setDrawRange(0, 0); // Initially zero particles
    this.rootGroup.add(this.pointsMesh);
    this.rootGroup.add(this.tracerGroup);
    this.rootGroup.add(this.bloodPoolGroup);

    // Pre-allocate blood pool decal meshes (authentic hand-drawn ink splat shapes)
    if (!InkParticles.splatGeoms) {
      InkParticles.splatGeoms = [
        createSplatGeometry(0),
        createSplatGeometry(1),
        createSplatGeometry(2)
      ];
    }

    const maxBloodPools = 48;
    for (let i = 0; i < maxBloodPools; i++) {
      const geo = InkParticles.splatGeoms[i % InkParticles.splatGeoms.length];
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xd63031), // Vibrant sketched comic red ink (lighter, not dark maroon)
        transparent: true,
        opacity: InkParticles.defaultBloodPoolOpacity, // Reduced opacity so it blends as watercolor/pen ink
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.bloodPoolGroup.add(m);
      this.bloodPoolMeshPool.push(m);
    }
  }

  public getGroup(): THREE.Group {
    return this.rootGroup;
  }

  /**
   * Spawns ink splatter when a bullet hits concrete or metal
   */
  public spawnWallImpact(point: THREE.Vector3, normal: THREE.Vector3): void {
    const count = 12;
    const inkBlue = new THREE.Color(0x152778);
    const sparkColor = new THREE.Color(0xffd32a); // Bright comic ricochet spark

    for (let i = 0; i < count; i++) {
      const vel = normal.clone().multiplyScalar(Math.random() * 4 + 2);
      vel.x += (Math.random() - 0.5) * 5;
      vel.y += (Math.random() - 0.5) * 5;
      vel.z += (Math.random() - 0.5) * 5;

      this.addParticle({
        position: point.clone().addScaledVector(normal, 0.05),
        velocity: vel,
        color: inkBlue,
        size: Math.random() * 0.04 + 0.02,
        maxLife: Math.random() * 0.4 + 0.2,
        life: 0
      });
    }

    // High-speed ricochet sparks bursting along wall normal
    for (let i = 0; i < 7; i++) {
      const vel = normal.clone().multiplyScalar(Math.random() * 7 + 4);
      vel.x += (Math.random() - 0.5) * 6;
      vel.y += (Math.random() - 0.5) * 6;
      vel.z += (Math.random() - 0.5) * 6;

      this.addParticle({
        position: point.clone().addScaledVector(normal, 0.03),
        velocity: vel,
        color: sparkColor,
        size: Math.random() * 0.025 + 0.015,
        maxLife: Math.random() * 0.16 + 0.08,
        life: 0,
        drag: 6.0
      });
    }
  }

  /**
   * Spawns realistic comic ink blood splatter (inspired by inspiration effects.js blood()).
   * Emits high-speed directional arcing droplets, high-velocity ink spurts, and billowing crimson mist.
   */
  public spawnBlood(
    point: THREE.Vector3,
    direction: THREE.Vector3,
    amount: number = 1.0,
    isHeadshot: boolean = false
  ): void {
    const dir = direction.clone().normalize();
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);

    const freshRed = new THREE.Color(0.96, 0.24, 0.26); // Vivid, lighter red sketch ink
    const rubyRed = new THREE.Color(0.88, 0.22, 0.24);  // Warm red ink (not dark maroon)
    const brightRed = new THREE.Color(1.0, 0.30, 0.28); // Bright scarlet accent

    // 1. Arcing ink droplets (flung along impact direction with conical spread)
    const dropCount = Math.round((isHeadshot ? 24 : 14) * amount);
    for (let i = 0; i < dropCount; i++) {
      const speed = (isHeadshot ? Math.random() * 5 + 3 : Math.random() * 4 + 2);
      const vel = dir.clone().multiplyScalar(speed);
      vel.x += (Math.random() - 0.5) * 3.5;
      vel.y += (Math.random() - 0.2) * 3.0;
      vel.z += (Math.random() - 0.5) * 3.5;

      const colRoll = Math.random();
      const col = colRoll < 0.5 ? freshRed : (colRoll < 0.85 ? rubyRed : brightRed);

      this.addParticle({
        position: point.clone(),
        velocity: vel,
        color: col,
        size: Math.random() * 0.045 + 0.025,
        maxLife: Math.random() * 0.9 + 0.6,
        life: 0,
        isBloodDrop: true
      });
    }

    // 2. High-speed directional blood streaks / spurts
    const spurtCount = Math.round((isHeadshot ? 16 : 8) * amount);
    for (let i = 0; i < spurtCount; i++) {
      const spurtSpeed = Math.random() * 8 + 6;
      const vel = dir.clone().multiplyScalar(spurtSpeed);
      vel.x += (Math.random() - 0.5) * 2.2;
      vel.y += (Math.random() - 0.3) * 2.5;
      vel.z += (Math.random() - 0.5) * 2.2;

      this.addParticle({
        position: point.clone(),
        velocity: vel,
        color: brightRed,
        size: Math.random() * 0.035 + 0.02,
        maxLife: Math.random() * 0.35 + 0.2,
        life: 0,
        drag: 2.5,
        isBloodDrop: true
      });
    }

    // 3. Fine crimson mist
    const mistCount = Math.round((isHeadshot ? 12 : 6) * amount);
    for (let i = 0; i < mistCount; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2.0,
        Math.random() * 1.5 + 0.5,
        (Math.random() - 0.5) * 2.0
      );

      this.addParticle({
        position: point.clone(),
        velocity: vel,
        color: rubyRed,
        size: Math.random() * 0.035 + 0.02,
        maxLife: Math.random() * 0.55 + 0.35,
        life: 0,
        drag: 3.5,
        grow: 2.8,
        noGravity: true
      });
    }
  }

  /**
   * Spawns an expanding sketched blood pool decal on the floor (inspired by inspiration effects.js bloodPool()).
   * Expands outward over 0.6-1.1s, then lingers on the floor with deep crimson ballpoint ink.
   */
  public spawnBloodPool(position: THREE.Vector3, size: number = 1.4): void {
    let groundY = position.y;
    if (this.worldCollider) {
      const detected = this.worldCollider.groundAt(position.x, position.y + 0.5, position.z, 2.0);
      if (detected !== null) {
        groundY = detected;
      }
    }

    // If pool mesh pool is empty, recycle oldest active pool
    if (this.bloodPoolMeshPool.length === 0 && this.activeBloodPools.length > 0) {
      const oldest = this.activeBloodPools.shift()!;
      this.bloodPoolMeshPool.push(oldest.mesh);
    }
    if (this.bloodPoolMeshPool.length === 0) return;

    // 1. Central blood pool
    const mainMesh = this.bloodPoolMeshPool.pop()!;
    mainMesh.position.set(position.x, groundY + 0.015, position.z);
    mainMesh.rotation.x = -Math.PI * 0.5;
    mainMesh.rotation.z = Math.random() * Math.PI * 2;
    mainMesh.scale.set(0, 0, 1);
    (mainMesh.material as THREE.MeshBasicMaterial).color.setHex(0xd63031);
    (mainMesh.material as THREE.MeshBasicMaterial).opacity = this.bloodPoolOpacity;
    mainMesh.visible = true;

    this.activeBloodPools.push({
      mesh: mainMesh,
      targetSize: size,
      timer: 0,
      growDuration: 0.65 + Math.random() * 0.45,
      life: 0,
      maxLife: this.bloodPoolLifetime
    });

    // 2. Satellite splatter droplets around main puddle (inspired by inspiration)
    const satCount = Math.random() < 0.5 ? 1 : 2;
    for (let k = 0; k < satCount; k++) {
      if (this.bloodPoolMeshPool.length === 0) {
        if (this.activeBloodPools.length > 0) {
          const old = this.activeBloodPools.shift()!;
          this.bloodPoolMeshPool.push(old.mesh);
        } else {
          break;
        }
      }
      const angle = Math.random() * Math.PI * 2;
      const dist = size * (0.35 + Math.random() * 0.4);
      const satMesh = this.bloodPoolMeshPool.pop()!;
      satMesh.position.set(
        position.x + Math.cos(angle) * dist,
        groundY + 0.016,
        position.z + Math.sin(angle) * dist
      );
      satMesh.rotation.x = -Math.PI * 0.5;
      satMesh.rotation.z = Math.random() * Math.PI * 2;
      satMesh.scale.set(0, 0, 1);
      (satMesh.material as THREE.MeshBasicMaterial).color.setHex(0xd63031);
      (satMesh.material as THREE.MeshBasicMaterial).opacity = this.bloodPoolOpacity * 0.85;
      satMesh.visible = true;

      this.activeBloodPools.push({
        mesh: satMesh,
        targetSize: size * (0.3 + Math.random() * 0.25),
        timer: 0,
        growDuration: 0.5 + Math.random() * 0.4,
        life: 0,
        maxLife: this.bloodPoolLifetime * 0.9
      });
    }
  }

  /**
   * Spawns a vertical fountain of crimson ink spurting upward (inspired by inspiration effects.js fountain()).
   * Used for dramatic critical kills and headshot decapitations.
   */
  public spawnBloodFountain(
    position: THREE.Vector3,
    direction: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
    duration: number = 0.8
  ): void {
    this.bloodEmitters.push({
      position: position.clone(),
      direction: direction.clone().normalize(),
      life: duration,
      maxLife: duration,
      rate: 36, // 36 droplets per second
      accumulator: 0
    });
  }

  /**
   * Spawns red ink splatter on enemy hit / headshot
   */
  public spawnEnemyHit(point: THREE.Vector3, isHeadshot: boolean = false, direction?: THREE.Vector3): void {
    const dir = direction ? direction.clone().normalize() : new THREE.Vector3(0, 1, 0);
    this.spawnBlood(point, dir, isHeadshot ? 2.2 : 1.0, isHeadshot);
  }

  /**
   * Spawns disintegrating paper scraps, ink drops, blood splatter, and blood pool on enemy defeat
   */
  public spawnEnemyDeath(origin: THREE.Vector3, hitDir?: THREE.Vector3, isHeadshot: boolean = false): void {
    const dir = hitDir ? hitDir.clone().normalize() : new THREE.Vector3(0, 1, 0);

    // 1. Disintegrating paper scraps & ink drops
    const count = isHeadshot ? 65 : 45;
    const paperColor = new THREE.Color(0xf5eedd);
    const inkRed = new THREE.Color(0xd63031);
    const inkDeep = new THREE.Color(0xb71520);

    for (let i = 0; i < count; i++) {
      const speed = Math.random() * (isHeadshot ? 9 : 7) + 2;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2 + (hitDir ? hitDir.x * 0.8 : 0),
        Math.random() * 2 + 0.5 + (hitDir ? hitDir.y * 0.4 : 0),
        (Math.random() - 0.5) * 2 + (hitDir ? hitDir.z * 0.8 : 0)
      ).normalize().multiplyScalar(speed);

      const isScrap = Math.random() < 0.4;
      const color = isScrap ? paperColor : (Math.random() < 0.6 ? inkRed : inkDeep);

      this.addParticle({
        position: origin.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.6,
          Math.random() * 1.5,
          (Math.random() - 0.5) * 0.6
        )),
        velocity: vel,
        color: color,
        size: Math.random() * 0.16 + 0.06,
        maxLife: Math.random() * 0.9 + 0.5,
        life: 0,
        isPaperScrap: isScrap,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10
      });
    }

    // 2. Large directional ink blood burst
    this.spawnBlood(origin, dir, 2.2, isHeadshot);

    // 3. Ground blood puddle
    this.spawnBloodPool(origin, isHeadshot ? 2.0 : 1.4);

    // 4. Decapitation fountain on headshot kill
    if (isHeadshot) {
      this.spawnBloodFountain(origin, new THREE.Vector3(0, 1, 0), 0.85);
    }
  }

  /**
   * Spawns disintegrating paper scraps and ink dust when a corpse finishes dissolving
   */
  public spawnCorpseDissolve(origin: THREE.Vector3): void {
    const count = 30;
    const paperColor = new THREE.Color(0xf5eedd);
    const inkRed = new THREE.Color(0xd63031);
    const inkDeep = new THREE.Color(0xb71520);

    for (let i = 0; i < count; i++) {
      const speed = Math.random() * 4 + 1.5;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 2 + 1.0,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(speed);

      const isScrap = Math.random() < 0.5;
      const color = isScrap ? paperColor : (Math.random() < 0.6 ? inkRed : inkDeep);

      this.addParticle({
        position: origin.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.4,
          Math.random() * 0.4,
          (Math.random() - 0.5) * 0.4
        )),
        velocity: vel,
        color: color,
        size: Math.random() * 0.12 + 0.05,
        maxLife: Math.random() * 0.7 + 0.4,
        life: 0,
        isPaperScrap: isScrap,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 8
      });
    }
  }

  /**
   * Spawns rising sketch-in ink strokes when an enemy spawns (0.8s)
   */
  public spawnSketchIn(pos: THREE.Vector3): void {
    const count = 24;
    const inkBlue = new THREE.Color(0x152778);
    const inkDark = new THREE.Color(0x0a1440);
    const inkRed = new THREE.Color(0xd63031);

    for (let i = 0; i < count; i++) {
      const offsetX = (Math.random() - 0.5) * 0.8;
      const offsetY = Math.random() * 0.3;
      const offsetZ = (Math.random() - 0.5) * 0.8;

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        Math.random() * 1.8 + 1.8, // 1.8 - 3.6 m/s rising strokes
        (Math.random() - 0.5) * 0.4
      );

      const colorRoll = Math.random();
      const color = colorRoll < 0.6 ? inkBlue : (colorRoll < 0.85 ? inkDark : inkRed);

      this.addParticle({
        position: pos.clone().add(new THREE.Vector3(offsetX, offsetY, offsetZ)),
        velocity: vel,
        color,
        size: Math.random() * 0.05 + 0.03,
        maxLife: 0.8,
        life: 0,
        noGravity: true
      });
    }
  }

  /**
   * Spawns a bold, visible 3D comic ink bullet tracer beam (pooled, zero-alloc).
   */
  public spawnTracer(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: THREE.Color = new THREE.Color(0x1d8cf8),
    thickness: number = 0.04,
    maxLife: number = 0.085
  ): void {
    const dir = InkParticles.tmpTracerDir.subVectors(end, start);
    const len = dir.length();
    if (len < 0.05) return;
    dir.divideScalar(len);

    let mesh = this.tracerMeshPool.pop();
    if (!mesh) {
      const maxTracers = this.density < 1 ? 24 : 48;
      if (this.activeTracerMeshes.length >= maxTracers) return;
      const mat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      });
      mesh = new THREE.Mesh(InkParticles.tracerGeom, mat);
      mesh.frustumCulled = false;
      this.tracerGroup.add(mesh);
    }

    mesh.position.copy(start).addScaledVector(dir, len * 0.5);
    mesh.quaternion.setFromUnitVectors(InkParticles.upVec, dir);
    mesh.scale.set(thickness, len, thickness);
    (mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    mesh.visible = true;

    this.activeTracerMeshes.push(mesh);
    this.tracers.push({
      start: start.clone(),
      end: end.clone(),
      len,
      life: 0,
      maxLife,
      thickness,
      color: color.clone(),
      mesh
    });
  }

  /**
   * Spawns a sweeping comic ink slash arc in front of the camera (inspired by inspiration).
   */
  public spawnSlashArc(
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    combo: number = 0
  ): void {
    const s = combo % 2 === 0 ? -1 : 1;
    const up = InkParticles.upVec;
    const numSegments = 8;
    const slashColor = new THREE.Color(0x3867d6);

    for (let i = 0; i < numSegments; i++) {
      const a = (-1.1 + (2.2 * i) / (numSegments - 1)) * s;
      const b = a + 0.16 * s;
      const pa = origin.clone()
        .addScaledVector(forward, 1.4)
        .addScaledVector(right, Math.cos(a) * 0.95 * s)
        .addScaledVector(up, Math.sin(a) * 0.55 - 0.1);
      const pb = origin.clone()
        .addScaledVector(forward, 1.4)
        .addScaledVector(right, Math.cos(b) * 0.95 * s)
        .addScaledVector(up, Math.sin(b) * 0.55 - 0.1);

      this.spawnTracer(pa, pb, slashColor, 0.035 - 0.002 * i, 0.13 + i * 0.01);
    }

    // Spark drops along the cutting arc
    this.spawnMuzzleSparks(origin.clone().addScaledVector(forward, 1.3), forward, 6, 0x3867d6);
  }

  /**
   * Spawns high-velocity comic ink sparks bursting outward from barrel tip on firing
   */
  public spawnMuzzleSparks(
    muzzlePos: THREE.Vector3,
    forwardDir: THREE.Vector3,
    count: number = 8,
    colorHex: number = 0xffa834
  ): void {
    const sparkCol = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      const vel = forwardDir.clone().multiplyScalar(Math.random() * 8 + 4.5);
      vel.x += (Math.random() - 0.5) * 3.5;
      vel.y += (Math.random() - 0.5) * 3.5;
      vel.z += (Math.random() - 0.5) * 3.5;

      this.addParticle({
        position: muzzlePos.clone(),
        velocity: vel,
        color: sparkCol,
        size: Math.random() * 0.03 + 0.015,
        maxLife: Math.random() * 0.12 + 0.06,
        life: 0,
        drag: 12.0,
        noGravity: true
      });
    }
  }

  /**
   * Spawns circular comic ink smoke puffs drifting forward and floating upward from barrel
   */
  public spawnMuzzleSmoke(
    muzzlePos: THREE.Vector3,
    forwardDir: THREE.Vector3,
    count: number = 3
  ): void {
    const smokeColor = new THREE.Color(0x3d4a7a); // Cool slate comic smoke ink
    for (let i = 0; i < count; i++) {
      const vel = forwardDir.clone().multiplyScalar(Math.random() * 1.5 + 0.5);
      vel.x += (Math.random() - 0.5) * 0.6;
      vel.y += Math.random() * 1.2 + 0.8;
      vel.z += (Math.random() - 0.5) * 0.6;

      this.addParticle({
        position: muzzlePos.clone(),
        velocity: vel,
        color: smokeColor,
        size: Math.random() * 0.035 + 0.02,
        maxLife: Math.random() * 0.45 + 0.3,
        life: 0,
        noGravity: true,
        grow: 3.2,
        drag: 3.5
      });
    }
  }

  /**
   * Legacy muzzle flash trigger (no-op; 3D starburst is handled per-weapon at muzzleTip)
   */
  public triggerMuzzleFlash(_position?: THREE.Vector3, _dir?: THREE.Vector3): void {
    // No-op: 3D starburst is managed per-weapon on muzzleTip
  }

  private addParticle(p: Particle): void {
    if (this.density < 1 && Math.random() > this.density) return;
    if (this.particles.length < this.maxParticles) {
      this.particles.push(p);
    }
  }

  public update(dt: number): void {
    // 0. Update blood emitters (e.g. headshot decapitation fountains)
    for (let i = this.bloodEmitters.length - 1; i >= 0; i--) {
      const emitter = this.bloodEmitters[i];
      emitter.life -= dt;
      if (emitter.life <= 0) {
        this.bloodEmitters.splice(i, 1);
        continue;
      }
      emitter.accumulator += dt * emitter.rate;
      while (emitter.accumulator >= 1.0) {
        emitter.accumulator -= 1.0;
        const vel = emitter.direction.clone().multiplyScalar(Math.random() * 3.5 + 2.5);
        vel.x += (Math.random() - 0.5) * 2.0;
        vel.y += Math.random() * 2.5 + 1.2;
        vel.z += (Math.random() - 0.5) * 2.0;
        const inkColor = Math.random() < 0.7
          ? new THREE.Color(0xd63031)
          : new THREE.Color(0xe84118);
        this.addParticle({
          position: emitter.position.clone(),
          velocity: vel,
          color: inkColor,
          size: Math.random() * 0.04 + 0.025,
          maxLife: Math.random() * 0.8 + 0.5,
          life: 0,
          isBloodDrop: true
        });
      }
    }

    // 1. Update particles
    const gravity = 18.0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      // Physics
      if (p.drag) {
        p.velocity.multiplyScalar(Math.max(0, 1.0 - p.drag * dt));
      }
      if (!p.noGravity) {
        p.velocity.y -= gravity * dt;
      }
      p.position.addScaledVector(p.velocity, dt);
      if (p.rotation !== undefined && p.rotSpeed !== undefined) {
        p.rotation += p.rotSpeed * dt;
      }

      // Blood drop floor collision
      if (p.isBloodDrop && this.worldCollider && p.velocity.y < 0) {
        const floorY = this.worldCollider.groundAt(p.position.x, p.position.y + 0.3, p.position.z, 0.4);
        if (floorY !== null && p.position.y <= floorY + 0.05) {
          p.position.y = floorY;
          p.life = p.maxLife; // Finish particle on impact
          // 20% chance to leave a miniature splatter mark
          if (Math.random() < 0.20 && this.bloodPoolMeshPool.length > 0) {
            this.spawnBloodPool(p.position, Math.random() * 0.3 + 0.2);
          }
        }
      }
    }

    // 2. Update active blood pool decals (expansion and lingering fadeout)
    for (let i = this.activeBloodPools.length - 1; i >= 0; i--) {
      const pool = this.activeBloodPools[i];
      pool.timer += dt;
      pool.life += dt;

      // Expand outward with organic easeOutQuad
      const f = Math.min(1.0, pool.timer / pool.growDuration);
      const ease = 1.0 - (1.0 - f) * (1.0 - f);
      const curScale = pool.targetSize * ease;
      pool.mesh.scale.set(curScale, curScale, 1.0);

      // Smooth drying / fading over the last 3.5s of life (or last 30% if maxLife is shorter)
      const fadeWindow = Math.min(3.5, pool.maxLife * 0.3);
      if (pool.life >= pool.maxLife - fadeWindow) {
        const fade = Math.max(0, (pool.maxLife - pool.life) / fadeWindow);
        (pool.mesh.material as THREE.MeshBasicMaterial).opacity = fade * this.bloodPoolOpacity;
      }

      // Recycle when life expires
      if (pool.life >= pool.maxLife) {
        pool.mesh.visible = false;
        this.bloodPoolMeshPool.push(pool.mesh);
        this.activeBloodPools.splice(i, 1);
      }
    }

    // 3. Update particle buffers
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = this.geometry.attributes.color as THREE.BufferAttribute;
    const sizeAttr = this.geometry.attributes.size as THREE.BufferAttribute;

    const count = Math.min(this.particles.length, this.maxParticles);
    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      const alpha = 1.0 - (p.life / p.maxLife);
      const sizeMultiplier = p.grow
        ? THREE.MathUtils.lerp(1.0, p.grow, 1.0 - alpha) * alpha
        : alpha;

      posAttr.setXYZ(i, p.position.x, p.position.y, p.position.z);
      colAttr.setXYZ(i, p.color.r * alpha, p.color.g * alpha, p.color.b * alpha);
      sizeAttr.setX(i, p.size * sizeMultiplier);
    }

    // Zero out unused slots
    for (let i = count; i < this.maxParticles; i++) {
      sizeAttr.setX(i, 0);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, count);

    // 4. Update 3D bullet tracers (pooled — no per-frame allocation)
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life += dt;
      if (t.life >= t.maxLife) {
        if (t.mesh) {
          t.mesh.visible = false;
          this.tracerMeshPool.push(t.mesh);
          const idx = this.activeTracerMeshes.indexOf(t.mesh);
          if (idx >= 0) this.activeTracerMeshes.splice(idx, 1);
        }
        this.tracers.splice(i, 1);
        continue;
      }
      if (t.mesh) {
        const alpha = Math.max(0, 1.0 - t.life / t.maxLife);
        (t.mesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.95;
        const curW = t.thickness * (0.6 + 0.4 * alpha);
        t.mesh.scale.set(curW, t.len, curW);
      }
    }
  }

  public clear(): void {
    this.particles.length = 0;
    this.tracers.length = 0;
    this.bloodEmitters.length = 0;
    for (const m of this.activeTracerMeshes) {
      m.visible = false;
      this.tracerMeshPool.push(m);
    }
    this.activeTracerMeshes.length = 0;
    for (const p of this.activeBloodPools) {
      p.mesh.visible = false;
      this.bloodPoolMeshPool.push(p.mesh);
    }
    this.activeBloodPools.length = 0;
  }
}
