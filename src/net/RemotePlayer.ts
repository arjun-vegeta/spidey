import * as THREE from 'three';
import { WebRenderer } from '../effects/WebRenderer';
import { CharacterRig } from '../characters/CharacterRig';
import type { CharacterId } from '../characters/Characters';
import { RopeState } from '../player/WebShooter';
import { CHARACTER_HEIGHT, CROUCH_HEIGHT } from '../core/CoverMetrics';
import {
  FLAG_CROUCHING,
  FLAG_DEAD,
  FLAG_SWINGING,
  type StatePacket,
} from './NetTypes';
import { colorHexFor } from './Profile';

/**
 * How far behind live we render other players, in seconds.
 *
 * Remote transforms arrive at STATE_HZ over a mesh with real jitter. Rendering
 * the newest packet the instant it lands makes everyone stutter; holding a
 * small buffer and drawing the interpolated past instead makes them glide. One
 * and a half state intervals is enough to ride out a single dropped packet.
 */
const INTERP_DELAY = 0.12;

/** Samples older than this are dropped from the buffer. */
const BUFFER_SECONDS = 1.0;

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouching: boolean;
}

/**
 * ONE OTHER PLAYER, wearing the character they picked.
 *
 * The body is a `CharacterRig`, so the silhouette is whichever of the eight
 * designs this peer chose, INKED IN THEIR OWN COLOUR rather than the design's
 * default palette. Shape says who you picked; colour says who you are, and
 * colour is what already ties an avatar to its name plate, its tracers and its
 * line in the kill feed.
 *
 * This class owns everything the rig deliberately does not: where the avatar
 * is (interpolated from the packet stream), what it is called, and its web
 * line. Note the hitbox is the rig's, identical for all eight designs — see
 * `CharacterRig.buildHitProxies`.
 */
export class RemotePlayer {
  public readonly id: string;
  public group: THREE.Group;

  public name: string;
  public colorIndex: number;
  public health: number = 100;
  public maxHealth: number = 100;
  public isDead: boolean = false;

  /** Meshes a bullet can hit. Tagged so `Game` can resolve a hit back to us. */
  public collidableMeshes: THREE.Mesh[] = [];
  public headMesh: THREE.Mesh | null = null;

  /** Live web line, drawn whenever this peer reports that they are swinging. */
  public webRenderer: WebRenderer;

  public characterId: CharacterId;

  private buffer: Sample[] = [];
  /**
   * The body. Public so a verification script can ask which design is on
   * screen, and so `Game` could pose it directly if it ever needs to.
   */
  public rig!: CharacterRig;

  private nameSprite: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTexture: THREE.CanvasTexture;

  private elapsed = 0;
  private lastRenderPos = new THREE.Vector3();
  private webAnchor: THREE.Vector3 | null = null;
  private isSwinging = false;
  private crouching = false;
  private wristWorld = new THREE.Vector3();

  constructor(id: string, name: string, colorIndex: number, characterId: CharacterId) {
    this.id = id;
    this.name = name;
    this.colorIndex = colorIndex;
    this.characterId = characterId;

    this.group = new THREE.Group();
    this.group.name = `RemotePlayer:${id}`;
    this.buildRig();

    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 512;
    this.nameCanvas.height = 128;
    this.nameTexture = new THREE.CanvasTexture(this.nameCanvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: this.nameTexture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.nameSprite = new THREE.Sprite(spriteMat);
    this.nameSprite.scale.set(2.4, 0.6, 1);
    this.nameSprite.position.set(0, CHARACTER_HEIGHT + 0.55, 0);
    this.nameSprite.renderOrder = 3;
    this.group.add(this.nameSprite);
    this.redrawNameTag();

    this.webRenderer = new WebRenderer();
  }

  /**
   * Builds (or rebuilds) the avatar body from the character this peer picked.
   *
   * The rig lives under our own group rather than being our group, so a crouch
   * squash and a death topple apply to the body while the name plate above it
   * stays upright and undistorted.
   */
  private buildRig(): void {
    if (this.rig) {
      this.group.remove(this.rig.group);
      this.rig.dispose();
    }

    this.rig = new CharacterRig(this.characterId, {
      // The player's chosen ink beats the costume's own palette: two people on
      // the same design in different colours have to be told apart instantly.
      inkOverride: colorHexFor(this.colorIndex),
    });
    this.group.add(this.rig.group);

    // Tag the rig's hit proxies back to us, which is how `RemotePlayerManager`
    // walks up from a raycast hit to the player who was shot.
    this.collidableMeshes = this.rig.collidableMeshes;
    for (const mesh of this.collidableMeshes) {
      mesh.userData = { ...mesh.userData, remotePlayer: this };
    }
    this.headMesh = this.rig.headMesh;
  }

  /** Repaints the floating name plate and its health pips. */
  private redrawNameTag(): void {
    const ctx = this.nameCanvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.nameCanvas;
    ctx.clearRect(0, 0, w, h);

    const css = `#${colorHexFor(this.colorIndex).toString(16).padStart(6, '0')}`;

    ctx.font = 'bold 54px "Special Elite", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Cream halo so a name stays legible against dark ink geometry behind it
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(245, 238, 221, 0.95)';
    ctx.strokeText(this.name, w / 2, 44);
    ctx.fillStyle = css;
    ctx.fillText(this.name, w / 2, 44);

    // Hand-drawn health bar underneath
    const barW = 300;
    const barH = 18;
    const barX = (w - barW) / 2;
    const barY = 82;
    const frac = Math.max(0, Math.min(1, this.health / this.maxHealth));

    ctx.fillStyle = 'rgba(245, 238, 221, 0.9)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = frac > 0.5 ? css : frac > 0.25 ? '#c25e12' : '#d63031';
    ctx.fillRect(barX, barY, barW * frac, barH);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#152778';
    ctx.strokeRect(barX, barY, barW, barH);

    this.nameTexture.needsUpdate = true;
  }

  /**
   * Applies a peer's announced profile.
   *
   * Returns true when the BODY was rebuilt — a new character or a new colour —
   * because that replaces the hit proxies, and the manager's cached raycast
   * target list would otherwise keep pointing at disposed meshes.
   */
  public setProfile(name: string, colorIndex: number, characterId: CharacterId): boolean {
    let dirty = false;
    let rebuilt = false;

    if (name !== this.name) {
      this.name = name;
      dirty = true;
    }
    if (colorIndex !== this.colorIndex || characterId !== this.characterId) {
      this.colorIndex = colorIndex;
      this.characterId = characterId;
      this.buildRig();
      // A rebuilt rig starts standing and alive; put it back how it was.
      if (this.isDead) this.rig.setDead(true);
      rebuilt = true;
      dirty = true;
    }

    if (dirty) this.redrawNameTag();
    return rebuilt;
  }

  public setHealth(health: number): void {
    const clamped = Math.max(0, Math.min(this.maxHealth, health));
    if (clamped === this.health) return;
    this.health = clamped;
    this.redrawNameTag();
  }

  /** Buffers a freshly arrived transform for interpolation. */
  public pushState(s: StatePacket, now: number): void {
    const crouching = (s.f & FLAG_CROUCHING) !== 0;
    this.crouching = crouching;
    this.isSwinging = (s.f & FLAG_SWINGING) !== 0;
    const dead = (s.f & FLAG_DEAD) !== 0;
    if (dead !== this.isDead) this.setDead(dead);

    // The owner's own health is authoritative, which corrects the optimistic
    // figure a shooter predicted when they landed a hit — and picks up regen.
    if (!dead && typeof s.h === 'number') this.setHealth(s.h);

    if (this.isSwinging && s.a) {
      this.webAnchor = (this.webAnchor ?? new THREE.Vector3()).set(s.a[0], s.a[1], s.a[2]);
    } else {
      this.webAnchor = null;
    }

    this.buffer.push({
      t: now,
      x: s.p[0],
      y: s.p[1],
      z: s.p[2],
      yaw: s.r[0],
      pitch: s.r[1],
      crouching,
    });

    const cutoff = now - BUFFER_SECONDS;
    while (this.buffer.length > 2 && this.buffer[0].t < cutoff) this.buffer.shift();
  }

  public setDead(dead: boolean): void {
    this.isDead = dead;
    // Topple rather than vanish, so a kill reads as a kill. The rig owns the
    // pose; the name plate above it is ours to hide.
    this.rig.setDead(dead);
    if (dead) {
      this.health = 0;
      this.nameSprite.visible = false;
      this.webRenderer.hide();
    } else {
      this.health = this.maxHealth;
      this.nameSprite.visible = true;
    }
    this.redrawNameTag();
  }

  /**
   * Red ink flash when a bullet lands, so shooters get feedback at range. The
   * rig runs the flash and its own timer, exactly as the AI hostiles do.
   */
  public flashHit(): void {
    this.rig.flashHit();
  }

  /**
   * Advances the avatar to `renderTime`, which the manager keeps a fixed delay
   * behind the wall clock so there is always a sample on each side to blend.
   */
  public update(dt: number, renderTime: number, camera: THREE.Camera): void {
    this.elapsed += dt;

    const target = renderTime - INTERP_DELAY;
    const sample = this.sampleAt(target);
    if (!sample) return;

    const stance = sample.crouching ? CROUCH_HEIGHT : CHARACTER_HEIGHT;
    // Packets carry the capsule CENTRE; the model's origin is its feet.
    const feetY = sample.y - stance * 0.5;

    const prevX = this.lastRenderPos.x;
    const prevZ = this.lastRenderPos.z;
    this.group.position.set(sample.x, feetY, sample.z);
    this.group.rotation.y = sample.yaw;

    // Name plate sits above whatever stance the body is in. It hangs off THIS
    // group rather than the rig, so the crouch squash and the death topple
    // never distort it — which is why it needs no compensating scale.
    this.nameSprite.position.y = (this.isDead ? CHARACTER_HEIGHT * 0.6 : stance) + 0.55;

    // The rig owns the body: crouch squash, walk cycle, swing tuck, head
    // pitch and any flourishes the chosen design has.
    const moved = Math.hypot(sample.x - prevX, sample.z - prevZ);
    this.rig.update(dt, {
      speed: this.isDead ? 0 : dt > 0 ? moved / dt : 0,
      swinging: this.isSwinging,
      pitch: sample.pitch,
      crouching: sample.crouching,
    });

    this.lastRenderPos.set(sample.x, feetY, sample.z);
    this.updateWebLine(camera);
  }

  private updateWebLine(camera: THREE.Camera): void {
    if (!this.isSwinging || !this.webAnchor || this.isDead) {
      this.webRenderer.hide();
      return;
    }
    // Fire the line from the chest rather than the origin so it does not
    // appear to sprout from the player's feet.
    this.wristWorld.set(this.group.position.x, this.group.position.y + 1.3, this.group.position.z);
    this.webRenderer.updateWeb(this.wristWorld, this.webAnchor, RopeState.TAUT, this.elapsed);
    void camera;
  }

  /**
   * Finds the pair of buffered samples bracketing `target` and blends them.
   * Falls back to the newest sample when the buffer has run dry, which is what
   * makes a peer freeze in place rather than teleport when their connection
   * hiccups.
   */
  private sampleAt(target: number): Sample | null {
    const buf = this.buffer;
    if (buf.length === 0) return null;
    if (buf.length === 1 || target <= buf[0].t) return buf[0];
    if (target >= buf[buf.length - 1].t) return buf[buf.length - 1];

    for (let i = buf.length - 1; i > 0; i--) {
      const b = buf[i];
      const a = buf[i - 1];
      if (target >= a.t && target <= b.t) {
        const span = b.t - a.t;
        const f = span > 1e-6 ? (target - a.t) / span : 0;
        return {
          t: target,
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
          yaw: a.yaw + shortestAngle(a.yaw, b.yaw) * f,
          pitch: a.pitch + (b.pitch - a.pitch) * f,
          crouching: f < 0.5 ? a.crouching : b.crouching,
        };
      }
    }
    return buf[buf.length - 1];
  }

  /**
   * Frees every GPU resource this avatar owns. Players come and go over a long
   * session, so leaking a rig per departure is not acceptable.
   */
  public dispose(): void {
    const seen = new Set<THREE.BufferGeometry>();
    const disposeTree = (root: THREE.Object3D) => {
      root.traverse((obj) => {
        const withGeom = obj as THREE.Mesh;
        // Legs and arms deliberately share a geometry between left and right.
        if (withGeom.geometry && !seen.has(withGeom.geometry)) {
          seen.add(withGeom.geometry);
          withGeom.geometry.dispose();
        }
      });
    };

    disposeTree(this.group);
    // The web line lives on the manager's group, not ours, but it is ours to free.
    disposeTree(this.webRenderer.mesh);
    const webMat = this.webRenderer.mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(webMat)) webMat.forEach((m) => m.dispose());
    else webMat.dispose();

    this.rig.dispose();

    this.nameTexture.dispose();
    (this.nameSprite.material as THREE.SpriteMaterial).dispose();
    this.collidableMeshes.length = 0;
    this.headMesh = null;
    this.buffer.length = 0;
  }
}

/** Shortest signed delta between two angles, so yaw never spins the long way. */
function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
