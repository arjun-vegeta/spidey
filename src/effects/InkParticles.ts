import * as THREE from 'three';

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
}

interface Tracer {
  start: THREE.Vector3;
  end: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  line?: THREE.Line;
}

export class InkParticles {
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private tracerLines: THREE.Line[] = [];
  private tracerPool: THREE.Line[] = [];

  private pointsMesh: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private maxParticles: number = 800;
  private density: number = 1.0;

  public setDensity(density: 0.5 | 1): void {
    this.density = density;
    this.maxParticles = density < 1 ? 400 : 800;
    if (this.particles.length > this.maxParticles) {
      this.particles.length = this.maxParticles;
    }
  }

  private tracerGroup: THREE.Group = new THREE.Group();
  private rootGroup: THREE.Group = new THREE.Group();

  // Muzzle flash sprite
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleFlashTimer: number = 0;

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

    // Ink droplet particle material
    const matParams: THREE.PointsMaterialParameters = {
      vertexColors: true,
      size: 0.05,
      transparent: true,
      opacity: 0.95,
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

    // Muzzle flash starburst plane
    const flashGeom = new THREE.PlaneGeometry(0.35, 0.35);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0x162a78,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });
    this.muzzleFlashMesh = new THREE.Mesh(flashGeom, flashMat);
    this.muzzleFlashMesh.visible = false;
    this.rootGroup.add(this.muzzleFlashMesh);
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
  }

  /**
   * Spawns red ink splatter on enemy hit / headshot
   */
  public spawnEnemyHit(point: THREE.Vector3, isHeadshot: boolean = false): void {
    const count = isHeadshot ? 28 : 16;
    const inkRed = new THREE.Color(0xd63031);

    for (let i = 0; i < count; i++) {
      const speed = isHeadshot ? Math.random() * 8 + 3 : Math.random() * 5 + 2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;

      const vel = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      ).multiplyScalar(speed);

      this.addParticle({
        position: point.clone(),
        velocity: vel,
        color: inkRed,
        size: Math.random() * 0.05 + 0.025,
        maxLife: Math.random() * 0.5 + 0.3,
        life: 0
      });
    }
  }

  /**
   * Spawns disintegrating paper scraps & ink drops when enemy dies
   */
  public spawnEnemyDeath(origin: THREE.Vector3): void {
    const count = 55;
    const paperColor = new THREE.Color(0xfaf7ee);
    const inkBlue = new THREE.Color(0x152778);
    const inkRed = new THREE.Color(0xd63031);

    for (let i = 0; i < count; i++) {
      const speed = Math.random() * 7 + 2;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 2 + 0.5,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(speed);

      const isScrap = Math.random() < 0.5;
      const color = isScrap ? paperColor : (Math.random() < 0.6 ? inkBlue : inkRed);

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
   * Spawns a high-speed ballpoint pen bullet tracer line (pooled)
   */
  public spawnTracer(start: THREE.Vector3, end: THREE.Vector3, color: THREE.Color = new THREE.Color(0x152778)): void {
    let t = this.tracerPool.pop();
    if (!t) {
      const maxTracers = this.density < 1 ? 24 : 48;
      if (this.tracerLines.length >= maxTracers) return;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x152778, transparent: true, opacity: 0.9 });
      const line = new THREE.Line(geom, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.tracerGroup.add(line);
      t = line;
    }
    const pos = t.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    (t.material as THREE.LineBasicMaterial).color.copy(color);
    (t.material as THREE.LineBasicMaterial).opacity = 0.9;
    t.visible = true;
    this.tracerLines.push(t);
    this.tracers.push({
      start: start.clone(),
      end: end.clone(),
      life: 0,
      maxLife: 0.12,
      color,
      line: t,
    });
  }

  /**
   * Triggers muzzle flash burst at weapon tip
   */
  public triggerMuzzleFlash(position: THREE.Vector3, dir: THREE.Vector3): void {
    this.muzzleFlashMesh.position.copy(position).addScaledVector(dir, 0.1);
    this.muzzleFlashMesh.lookAt(position.clone().add(dir));
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI * 2;
    this.muzzleFlashMesh.visible = true;
    this.muzzleFlashTimer = 0.05; // 50ms flash
  }

  private addParticle(p: Particle): void {
    if (this.density < 1 && Math.random() > this.density) return;
    if (this.particles.length < this.maxParticles) {
      this.particles.push(p);
    }
  }

  public update(dt: number): void {
    // 1. Muzzle flash timer
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlashMesh.visible = false;
      }
    }

    // 2. Update particles
    const gravity = 18.0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      // Physics
      if (!p.noGravity) {
        p.velocity.y -= gravity * dt;
      }
      p.position.addScaledVector(p.velocity, dt);
      if (p.rotation !== undefined && p.rotSpeed !== undefined) {
        p.rotation += p.rotSpeed * dt;
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

      posAttr.setXYZ(i, p.position.x, p.position.y, p.position.z);
      colAttr.setXYZ(i, p.color.r * alpha, p.color.g * alpha, p.color.b * alpha);
      sizeAttr.setX(i, p.size * alpha);
    }

    // Zero out unused slots
    for (let i = count; i < this.maxParticles; i++) {
      sizeAttr.setX(i, 0);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, count);

    // 4. Update bullet tracers (pooled — no per-frame allocation)
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life += dt;
      if (t.life >= t.maxLife) {
        if (t.line) {
          t.line.visible = false;
          this.tracerPool.push(t.line);
          const li = this.tracerLines.indexOf(t.line);
          if (li >= 0) this.tracerLines.splice(li, 1);
        }
        this.tracers.splice(i, 1);
        continue;
      }
      if (t.line) {
        (t.line.material as THREE.LineBasicMaterial).opacity = (1 - t.life / t.maxLife) * 0.9;
      }
    }
  }

  public clear(): void {
    this.particles.length = 0;
    this.tracers.length = 0;
    for (const l of this.tracerLines) {
      l.visible = false;
      this.tracerPool.push(l);
    }
    this.tracerLines.length = 0;
  }
}
