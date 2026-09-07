import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import {
  CHARACTER_HEIGHT,
  COVER_RAIL_HEIGHT,
  CROUCH_HEIGHT,
  STAND_EYE_ABOVE_FEET,
} from '../core/CoverMetrics';
import {
  CHARACTERS,
  characterById,
  type CharacterBuild,
  type CharacterDef,
} from './Characters';
import { decorate } from './CharacterSignatures';

/**
 * CHARACTER RIG — turns one `CharacterDef` into ink geometry you can put in a
 * scene, pose and animate.
 *
 * Nothing in here touches the game, the network or the DOM. Build one, add
 * `rig.group` to a scene, call `update()` each frame, `dispose()` when done.
 *
 * ------------------------------------------------------------------------
 * WHY THE ART AND THE HITBOX ARE SEPARATE
 * ------------------------------------------------------------------------
 * `group`
 *   └── `art`          scaled to CHARACTER_HEIGHT, holds every visible part
 *   └── hit proxies    identical for all eight characters, never drawn
 *
 * The designs deliberately differ in width, depth and stance — Graphite is
 * half a metre across the shoulders, Crosshatch is a pen line. If bullets hit
 * the art, picking Crosshatch would be a competitive advantage and picking
 * Graphite would be a handicap. So bullets hit the proxies, which are the same
 * boxes `RemotePlayer` already uses, and the art is pure costume.
 */

/** Warm cream of the page. Everything in this game sits on it. */
const PAPER = new THREE.Color(0xf5eedd);

/**
 * The shared head box, mirroring the one `RemotePlayer` builds: centred at
 * 1.57 and 0.34 tall, so it spans 1.40 to 1.74.
 */
const HEAD_PROXY_Y = 1.57;
const HEAD_PROXY_HALF = 0.17;

/**
 * Where the base of the neck sits, for EVERY design. This is the line the rig
 * normalises on: whatever a character's drawn proportions are, its legs plus
 * torso plus neck are scaled to land the chin exactly here, which puts every
 * head inside the shared head box and every shoulder over the shared torso box.
 */
export const HEAD_BASE_Y = HEAD_PROXY_Y - HEAD_PROXY_HALF; // 1.40

/**
 * Where the drawn eyes sit, for EVERY design — the centre of the head hitbox.
 * The mask is pinned here after normalisation regardless of how tall the skull
 * or the headgear above it turned out, so aiming at the eyes is the same shot
 * whoever you are looking at, and a crouched eye line is the same height for
 * all eight.
 *
 * Distinct from `STAND_EYE_ABOVE_FEET`, which is where the CAMERA sits. That
 * one is the geometry of record for cover and never comes from a costume.
 */
export const AVATAR_EYE_Y = HEAD_PROXY_Y; // 1.57

/**
 * Ceiling for anything drawn — crown, brim, hood peak, dome.
 *
 * Crouching squashes the rig by CROUCH_HEIGHT / CHARACTER_HEIGHT, and
 * CROUCH_HEIGHT is exactly COVER_RAIL_HEIGHT, so a drawn top at or under
 * CHARACTER_HEIGHT is a crouched top at or under the rail lip. That single
 * inequality is the whole cover guarantee, and `tests/characters.test.ts`
 * holds every design to it — a design that wants a taller hat has to give up
 * skull to pay for it.
 */
export const MAX_DRAWN_TOP = CHARACTER_HEIGHT; // 1.80

/** Most a skull may be squeezed to fit its own headgear under the ceiling. */
const MAX_HEAD_SQUEEZE = 0.88;

/**
 * Measures what actually gets DRAWN, ignoring the invisible hit proxies and
 * anything a signature switched off. `Box3.expandByObject` counts hidden
 * meshes, which is exactly wrong here.
 */
function visibleSpanY(root: THREE.Object3D): { min: number; max: number } {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !obj.visible) return;
    const mat = mesh.material as THREE.Material;
    if (mat && mat.visible === false) return;
    let hidden = false;
    obj.traverseAncestors((a) => {
      if (!a.visible) hidden = true;
    });
    if (hidden) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
  });
  if (box.isEmpty()) return { min: 0, max: 1 };
  return { min: box.min.y, max: box.max.y };
}

/**
 * Flat fill value for trim. Pulled a little toward the paper so a filled-in
 * plate reads as pen worked over a page, not as a plastic panel.
 */
function fillTone(c: THREE.Color): THREE.Color {
  return c.clone().lerp(PAPER, 0.16);
}

/** A part that keeps moving after the body stops: scarf tails, drips, coat hems. */
interface Flourish {
  obj: THREE.Object3D;
  /** Which way it hangs and swings. */
  axis: 'x' | 'z';
  /** Radians of travel at full tilt. */
  amplitude: number;
  /** Cycles per second at rest. */
  rate: number;
  /** Offset so neighbouring tails never move in lockstep. */
  phase: number;
  /** Pose it settles back to. */
  rest: number;
  /** How much movement speed adds to the swing. */
  drag: number;
}

export interface RigOptions {
  /**
   * Replaces the character's own ink, for when a player's chosen colour must
   * win over the costume's default. Accents and outlines are re-derived from
   * it so the figure still reads as one drawing.
   */
  inkOverride?: number;
  /** Set false for menus and portraits, which never get shot at. */
  hitProxies?: boolean;
  /** Set false to skip the outline pass on very small previews. */
  outlines?: boolean;
}

export interface PoseInput {
  /** Horizontal speed in m/s. Drives the walk cycle and flourish drag. */
  speed?: number;
  /** Tucked swing pose instead of a walk. */
  swinging?: boolean;
  /** Head pitch in radians, clamped by the rig. */
  pitch?: number;
  /** Ducked behind cover. Squashes the rig exactly as `RemotePlayer` does. */
  crouching?: boolean;
}

/**
 * Which shared material a part is drawn in.
 *
 *   ink      hatched body panels, in the character's main colour
 *   accent   hatched, in the darker second colour — for large sub-masses
 *   trim     FLAT FILL in the accent colour: plates, wraps, straps, brims
 *   lens     flat pale fill for eyes and glass
 *   paper    flat cream for tape, paper and correction fluid
 */
export type Coat = 'ink' | 'accent' | 'trim' | 'lens' | 'paper';

export interface PartOptions {
  coat?: Coat;
  pos?: [number, number, number];
  rot?: [number, number, number];
  /** Skip the outline pass — used for lenses and tiny trim. */
  bare?: boolean;
  /** Register the part as a flourish that keeps swaying after the body stops. */
  sway?: Partial<Omit<Flourish, 'obj'>>;
}

/**
 * The drawing tools a signature gets. Every part goes on with `add()`, which
 * handles the material, the outline pass and the raycast opt-out in one place.
 */
export class SketchKit {
  constructor(
    private readonly mats: Record<Coat, THREE.Material>,
    private readonly edge: THREE.Color,
    private readonly flourishes: Flourish[],
    private readonly outlines: boolean
  ) {}

  /**
   * Adds a decorative part. Decoration NEVER takes a bullet — the shared hit
   * proxies do that — so raycasting is switched off on everything built here.
   */
  public add(parent: THREE.Object3D, geometry: THREE.BufferGeometry, o: PartOptions = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.mats[o.coat ?? 'ink']);
    if (o.pos) mesh.position.set(o.pos[0], o.pos[1], o.pos[2]);
    if (o.rot) mesh.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    mesh.raycast = () => {};

    if (this.outlines && !o.bare) {
      const lines = InkShaderMaterial.createEdgeLines(geometry, this.edge);
      lines.raycast = () => {};
      mesh.add(lines);
    }

    parent.add(mesh);

    if (o.sway) {
      this.flourishes.push({
        obj: mesh,
        axis: o.sway.axis ?? 'x',
        amplitude: o.sway.amplitude ?? 0.18,
        rate: o.sway.rate ?? 1.1,
        phase: o.sway.phase ?? 0,
        rest: o.sway.rest ?? mesh.rotation.x,
        drag: o.sway.drag ?? 0.06,
      });
    }
    return mesh;
  }

  /** Box, with its origin at the centre. */
  public box(parent: THREE.Object3D, w: number, h: number, d: number, o: PartOptions = {}): THREE.Mesh {
    return this.add(parent, new THREE.BoxGeometry(w, h, d), o);
  }

  /** Box that hangs DOWN from its origin, so it can be rotated at the top. */
  public hanging(parent: THREE.Object3D, w: number, h: number, d: number, o: PartOptions = {}): THREE.Mesh {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, -h / 2, 0);
    return this.add(parent, g, o);
  }

  /** Low-segment cylinder — six sides keeps the facets visible, like a drawn tube. */
  public tube(
    parent: THREE.Object3D,
    rTop: number,
    rBottom: number,
    h: number,
    segments = 6,
    o: PartOptions = {}
  ): THREE.Mesh {
    return this.add(parent, new THREE.CylinderGeometry(rTop, rBottom, h, segments), o);
  }

  public cone(parent: THREE.Object3D, r: number, h: number, segments = 6, o: PartOptions = {}): THREE.Mesh {
    return this.add(parent, new THREE.ConeGeometry(r, h, segments), o);
  }

  /** Faceted blob. Low segment counts so it still reads as pen work, not CGI. */
  public blob(parent: THREE.Object3D, r: number, o: PartOptions = {}): THREE.Mesh {
    return this.add(parent, new THREE.SphereGeometry(r, 7, 5), o);
  }
}

/** Everything a signature function is allowed to draw on. */
export interface RigParts {
  def: CharacterDef;
  b: CharacterBuild;
  kit: SketchKit;
  /** Scaled art root. Local units are metres at the character's drawn size. */
  art: THREE.Group;
  /** Pivots at the pelvis; everything above the waist rides on it. */
  torso: THREE.Group;
  /** Pivots at the base of the neck. */
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  /** Y of the torso's top face, in torso-local units. */
  torsoTopY: number;
  /** Y of the shoulder sockets, in torso-local units. */
  shoulderY: number;
  /**
   * The default torso and head boxes. A signature that brings its own body —
   * Graphite's hexagonal shaft, Inkblot's spill — hides these instead of
   * sitting a second mass inside them, which would z-fight into a mess.
   */
  torsoShell: THREE.Mesh;
  headShell: THREE.Mesh;
  /**
   * Draw the mask in HERE, around a local origin of zero — y 0 is the eye
   * line. The rig aligns this group to `AVATAR_EYE_Y` for every design, so a
   * lens placed at a hand-picked height on the skull would defeat the point.
   */
  eyes: THREE.Group;
}

export class CharacterRig {
  public readonly def: CharacterDef;
  /** Add this to the scene. Origin sits at the character's feet. */
  public readonly group = new THREE.Group();
  public readonly art = new THREE.Group();

  /** Boxes a bullet can hit. Identical across the roster. */
  public readonly collidableMeshes: THREE.Mesh[] = [];
  public headMesh: THREE.Mesh | null = null;

  public readonly torso = new THREE.Group();
  public readonly head = new THREE.Group();
  public readonly leftArm = new THREE.Group();
  public readonly rightArm = new THREE.Group();
  public readonly leftLeg = new THREE.Group();
  /**
   * The mask. Every lens, rim and eye hole lives in here, drawn around a local
   * origin of zero, so the whole face can be slid onto the shared eye line in
   * one move once the rig has been scaled.
   */
  public readonly eyes = new THREE.Group();
  public readonly rightLeg = new THREE.Group();

  private readonly mats: Record<Coat, THREE.Material>;
  private readonly inkMaterials: THREE.ShaderMaterial[] = [];
  private readonly flourishes: Flourish[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private proxyMat: THREE.Material | null = null;
  private torsoShell!: THREE.Mesh;
  private headShell!: THREE.Mesh;
  private artScale = 1;
  private tmpEye = new THREE.Vector3();

  private readonly ink: THREE.Color;
  private readonly accent: THREE.Color;

  private elapsed = 0;
  private stepPhase = 0;
  private hitFlash = 0;

  constructor(idOrDef: string | CharacterDef, options: RigOptions = {}) {
    this.def = typeof idOrDef === 'string' ? characterById(idOrDef) : idOrDef;
    const b = this.def.build;

    // Ink, accent and outline. An override recolours the whole figure from one
    // hue rather than pasting a foreign colour onto the costume's own accents.
    if (options.inkOverride !== undefined) {
      // ONE COLOUR DRESSES THE WHOLE CHARACTER. The accent is the same hue
      // pushed darker, so the figure reads as one drawing in one pen rather
      // than as two-tone kit, and it matches the player's name plate exactly.
      this.ink = new THREE.Color(options.inkOverride);
      this.accent = this.ink.clone().multiplyScalar(0.62);
    } else {
      this.ink = new THREE.Color(this.def.palette.ink);
      this.accent = new THREE.Color(this.def.palette.accent);
    }
    const edge =
      options.inkOverride !== undefined
        ? this.ink.clone().multiplyScalar(0.45)
        : new THREE.Color(this.def.palette.edge);

    // Clone into the materials. `InkShaderMaterial.create` keeps the Color you
    // hand it BY REFERENCE as a uniform value, so passing `this.ink` straight
    // in would let `flashHit()` overwrite the very colour `restoreInk()` needs
    // to put back — the figure would stay crimson for the rest of the match.
    //
    // `useUv` is the important part. The default world-space hatching is tuned
    // for buildings: on something the size of a torso it lays down two stripes
    // that read as accidental smudges. Hatching in UV space instead gives every
    // panel its own consistent stroke density at any range.
    const bodyMat = InkShaderMaterial.create({
      inkColor: this.ink.clone(),
      accentColor: this.accent.clone(),
      useUv: true,
      uvScale: 0.17,
    });
    const accentMat = InkShaderMaterial.create({
      inkColor: this.accent.clone(),
      accentColor: this.ink.clone(),
      useUv: true,
      uvScale: 0.13,
    });
    this.inkMaterials.push(bodyMat, accentMat);

    this.mats = {
      ink: bodyMat,
      accent: accentMat,
      // Trim is FILLED IN, not hatched — the way you'd go back over a biro
      // sketch and colour the costume in. It is what makes eight palettes
      // distinguishable across a rooftop; hatching alone leaves all eight
      // reading as the same cream figure with a coloured outline.
      trim: new THREE.MeshBasicMaterial({ color: fillTone(this.accent) }),
      lens: new THREE.MeshBasicMaterial({ color: this.def.palette.lens }),
      paper: new THREE.MeshBasicMaterial({ color: 0xf5eedd }),
    };

    const kit = new SketchKit(this.mats, edge, this.flourishes, options.outlines ?? true);

    this.group.name = `Character:${this.def.id}`;
    this.buildSkeleton(b, kit);

    this.group.add(this.art);

    decorate(this.def.id, {
      def: this.def,
      b,
      kit,
      art: this.art,
      torso: this.torso,
      head: this.head,
      leftArm: this.leftArm,
      rightArm: this.rightArm,
      leftLeg: this.leftLeg,
      rightLeg: this.rightLeg,
      torsoTopY: b.torsoHeight,
      shoulderY: b.torsoHeight - b.armWidth * 0.6,
      torsoShell: this.torsoShell,
      headShell: this.headShell,
      eyes: this.eyes,
    });

    // Normalise on the NECK LINE, not on overall height. Fitting a design's
    // total height to a number is the obvious move and it is wrong: a design
    // wearing a tall hat then gets a small body, and its drawn face slides
    // down out of the shared head box, so shooting the mask scores a body
    // shot. Pinning the chin instead puts every head in the same place, and
    // headgear is paid for out of skull height — capped by MAX_DRAWN_TOP.
    // The lean counts: a stooped torso carries its chin lower than its length,
    // so the spine is measured along its actual tilt. Without the cosine, the
    // leaning designs' necks land half a centimetre low and their heads sit
    // fractionally off the shared head box.
    const spine = b.legLength + Math.cos(b.stoop) * (b.torsoHeight + b.neck);
    const scale = HEAD_BASE_Y / Math.max(1e-4, spine);
    this.art.scale.setScalar(scale);
    this.artScale = scale;

    // Headgear pays for itself. A crown or a brim that would break the ceiling
    // gets absorbed by squeezing the HEAD — which pivots on the chin, so the
    // neck line, the body and the hitbox are untouched. A couple of percent is
    // invisible; anything past MAX_HEAD_SQUEEZE is a design that wants far too
    // much hat, and the ceiling test is left to fail loudly rather than the rig
    // silently flattening a skull.
    // Aim a tenth of a millimetre UNDER the ceiling, so the fit converges from
    // the safe side instead of hovering a float's width over the line.
    const target = MAX_DRAWN_TOP - 1e-4;
    this.art.updateMatrixWorld(true);
    for (let i = 0; i < 6; i++) {
      const top = visibleSpanY(this.art).max;
      if (top <= target) break;
      const headTop = visibleSpanY(this.head).max;
      // Overshooting with something that is not headgear (a shoulder spike,
      // say) is not the head's to fix.
      if (headTop < top - 1e-4) break;
      const f = (target - HEAD_BASE_Y) / Math.max(1e-4, headTop - HEAD_BASE_Y);
      if (f < MAX_HEAD_SQUEEZE) break;
      this.head.scale.y *= f;
      this.art.updateMatrixWorld(true);
    }

    // Then pin the mask to the shared eye line. Iterated rather than solved,
    // because the eye group hangs off a torso that a design may have stooped,
    // so its local +Y is not world +Y.
    for (let i = 0; i < 4; i++) {
      this.eyes.getWorldPosition(this.tmpEye);
      const err = AVATAR_EYE_Y - this.tmpEye.y;
      if (Math.abs(err) < 1e-5) break;
      this.eyes.position.y += err / scale;
      this.art.updateMatrixWorld(true);
    }

    if (options.hitProxies ?? true) this.buildHitProxies();
    this.collectGeometries();
  }

  /** Torso, head and four limbs, from the numbers in the def and nothing else. */
  private buildSkeleton(b: CharacterBuild, kit: SketchKit): void {
    // Torso pivots at the pelvis so a stoop bends the figure at the waist.
    this.torso.position.set(0, b.legLength, 0);
    this.torso.rotation.x = b.stoop;
    this.torsoShell = kit.box(this.torso, b.torsoWidth, b.torsoHeight, b.torsoDepth, {
      pos: [0, b.torsoHeight / 2, 0],
    });
    this.art.add(this.torso);

    this.head.position.set(0, b.torsoHeight + b.neck, 0);
    // Provisional — the constructor slides it onto AVATAR_EYE_Y afterwards.
    this.eyes.position.set(0, b.headHeight * 0.58, 0);
    this.head.add(this.eyes);
    this.headShell = kit.box(this.head, b.headWidth, b.headHeight, b.headDepth, {
      pos: [0, b.headHeight / 2, 0],
    });
    this.torso.add(this.head);

    const shoulderY = b.torsoHeight - b.armWidth * 0.6;
    for (const [side, grp] of [
      [-1, this.leftArm],
      [1, this.rightArm],
    ] as const) {
      grp.position.set(side * b.shoulder, shoulderY, 0);
      kit.hanging(grp, b.armWidth, b.armLength, b.armDepth);
      this.torso.add(grp);
    }

    const hipX = Math.max(0.1, b.torsoWidth * 0.29);
    for (const [side, grp] of [
      [-1, this.leftLeg],
      [1, this.rightLeg],
    ] as const) {
      grp.position.set(side * hipX, b.legLength, 0);
      kit.hanging(grp, b.legWidth, b.legLength, b.legDepth);
      this.art.add(grp);
    }
  }

  /**
   * The shared, invisible hitbox. Same boxes for every character, matching
   * `RemotePlayer`'s so PvP feels identical whoever you picked.
   *
   * `material.visible = false` rather than `object.visible = false`: the
   * renderer skips a mesh with an invisible material, but the raycaster still
   * finds the object, which is exactly the combination a hitbox wants.
   */
  private buildHitProxies(): void {
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.proxyMat = proxyMat;

    const put = (w: number, h: number, d: number, x: number, y: number, isHead: boolean): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), proxyMat);
      mesh.position.set(x, y, 0);
      mesh.userData = { characterRig: this, isHead };
      this.group.add(mesh);
      this.collidableMeshes.push(mesh);
      if (isHead) this.headMesh = mesh;
    };

    put(0.55, 0.65, 0.35, 0, 1.05, false); // torso
    put(0.32, 0.34, 0.32, 0, 1.57, true); // head
    put(0.18, 0.8, 0.2, -0.16, 0.4, false); // legs
    put(0.18, 0.8, 0.2, 0.16, 0.4, false);
    put(0.14, 0.5, 0.14, -0.35, 1.06, false); // arms
    put(0.14, 0.5, 0.14, 0.35, 1.06, false);
  }

  private collectGeometries(): void {
    this.group.traverse((obj) => {
      const withGeom = obj as THREE.Mesh | THREE.LineSegments;
      if (withGeom.geometry) this.geometries.add(withGeom.geometry);
    });
  }

  /** Base of the neck. Identical across the roster, by construction. */
  public get headBaseHeight(): number {
    return HEAD_BASE_Y;
  }

  /** Drawn eye line, standing. Identical across the roster, by construction. */
  public get eyeLineHeight(): number {
    return AVATAR_EYE_Y;
  }

  /** Drawn eye line while crouched. Also identical across the roster. */
  public get crouchedEyeLineHeight(): number {
    return AVATAR_EYE_Y * (CROUCH_HEIGHT / CHARACTER_HEIGHT);
  }

  /** Measured vertical span of everything actually drawn, standing. */
  public drawnSpanY(): { min: number; max: number } {
    const span = visibleSpanY(this.art);
    return { min: span.min, max: span.max };
  }

  /**
   * Eye height, straight from `CoverMetrics`. It is NOT derived from the
   * costume: the camera, the muzzle and every cover raycast use this number
   * whichever character is picked, which is what makes the skins cosmetic.
   */
  public get eyeHeight(): number {
    return STAND_EYE_ABOVE_FEET;
  }

  /** Uniform scale applied to the art to fit the shared envelope. */
  public get silhouetteScale(): number {
    return this.artScale;
  }

  /**
   * Walk cycle, swing tuck and flourish sway. Cosmetic: a rig never decides
   * where it is, it only reacts to the speed it is told about.
   */
  public update(dt: number, pose: PoseInput = {}): void {
    this.elapsed += dt;
    const speed = pose.speed ?? 0;

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      if (this.hitFlash <= 0) this.restoreInk();
    }

    // Crouch is a uniform squash of the whole rig, matching `RemotePlayer`, so
    // a ducked figure of any design fits behind a COVER_RAIL_HEIGHT parapet
    // with nothing over the lip.
    const squash = pose.crouching ? CROUCH_HEIGHT / CHARACTER_HEIGHT : 1;
    this.group.scale.y = squash;
    void COVER_RAIL_HEIGHT;

    const pitch = Math.max(-1.1, Math.min(1.1, pose.pitch ?? 0));
    this.head.rotation.x = pitch * 0.5;

    if (pose.swinging) {
      this.leftArm.rotation.x = -2.3;
      this.rightArm.rotation.x = -2.3;
      this.leftLeg.rotation.x = 0.5 + Math.sin(this.elapsed * 4) * 0.12;
      this.rightLeg.rotation.x = 0.35 - Math.sin(this.elapsed * 4) * 0.12;
    } else if (speed > 0.4) {
      this.stepPhase += dt * Math.min(14, 4 + speed * 1.2);
      const swing = Math.sin(this.stepPhase) * Math.min(0.8, 0.22 + speed * 0.05);
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.7;
      this.rightArm.rotation.x = swing * 0.7;
    } else {
      const decay = Math.min(1, dt * 8);
      for (const limb of [this.leftLeg, this.rightLeg, this.leftArm, this.rightArm]) {
        limb.rotation.x += (0 - limb.rotation.x) * decay;
      }
    }

    // Tails and drips lag the body: they swing faster and further the quicker
    // you are moving, which is what sells the trail behind a swing.
    for (const f of this.flourishes) {
      const wobble = Math.sin(this.elapsed * f.rate * Math.PI * 2 + f.phase);
      const amp = f.amplitude * (1 + Math.min(2.5, speed * f.drag));
      f.obj.rotation[f.axis] = f.rest + wobble * amp;
    }
  }

  /** Red ink flash on a hit, matching how hostiles and remote players flash. */
  public flashHit(): void {
    this.hitFlash = 0.12;
    for (const m of this.inkMaterials) m.uniforms.uInkColor?.value.setRGB(1.0, 0.08, 0.08);
  }

  private restoreInk(): void {
    this.inkMaterials[0].uniforms.uInkColor?.value.copy(this.ink);
    this.inkMaterials[1].uniforms.uInkColor?.value.copy(this.accent);
  }

  /** Collapses the figure. Same topple `RemotePlayer` uses, so a kill reads. */
  public setDead(dead: boolean): void {
    this.group.rotation.z = dead ? Math.PI * 0.48 : 0;
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries.clear();
    for (const m of this.inkMaterials) {
      InkShaderMaterial.unregister(m);
      m.dispose();
    }
    this.proxyMat?.dispose();
    this.proxyMat = null;
    for (const key of Object.keys(this.mats) as Coat[]) {
      const m = this.mats[key];
      if (!(m as THREE.ShaderMaterial).isShaderMaterial) m.dispose();
    }
    this.group.traverse((obj) => {
      const line = obj as THREE.LineSegments;
      if (line.isLineSegments) (line.material as THREE.Material).dispose();
    });
    this.collidableMeshes.length = 0;
    this.flourishes.length = 0;
    this.headMesh = null;
  }
}

/** Builds one rig per roster entry. Handy for a picker or a lineup shot. */
export function buildRoster(options: RigOptions = {}): CharacterRig[] {
  return CHARACTERS.map((def) => new CharacterRig(def, options));
}
