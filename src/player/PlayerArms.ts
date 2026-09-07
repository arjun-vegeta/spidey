import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';

export class PlayerArms {
  public armsGroup: THREE.Group = new THREE.Group();
  public leftArm: THREE.Group = new THREE.Group();
  public rightArm: THREE.Group = new THREE.Group();

  // Web shooter nozzle world anchor
  public webOriginMesh: THREE.Object3D;

  private leftHandGroup: THREE.Group = new THREE.Group();
  private rightHandGroup: THREE.Group = new THREE.Group();

  // Finger references for Spider-Man web-shooting pose
  private leftIndexFinger!: THREE.Mesh;
  private leftPinkyFinger!: THREE.Mesh;
  private leftMiddleFingers!: THREE.Mesh;

  /** Materials whose ink follows the local player's chosen colour. */
  private tintable: THREE.ShaderMaterial[] = [];

  constructor() {
    this.webOriginMesh = new THREE.Object3D();
    this.buildSpiderManArms();
  }

  /**
   * Re-inks the gloves in the local player's chosen colour, so the hands at
   * the bottom of your own screen match the character everybody else sees you
   * wearing. Geometry is unchanged — the arms are one rig for all eight
   * designs — but the colour is the part you actually notice.
   */
  public setInk(hex: number): void {
    const ink = new THREE.Color(hex);
    for (const mat of this.tintable) {
      mat.uniforms.uInkColor?.value.copy(ink);
      mat.uniforms.uAccentColor?.value.copy(ink.clone().multiplyScalar(0.62));
    }
  }

  private buildSpiderManArms(): void {
    // Red comic suit material with blue web linework
    const suitMat = InkShaderMaterial.create({
      accentColor: new THREE.Color(0xd63031),
      isAccent: true,
      useUv: true,
      uvScale: 1.5
    });

    // Deep ballpoint navy for gauntlets and web shooters
    const gauntletMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x14215e),
      useUv: true,
      uvScale: 2.0
    });

    // Silver/metallic nozzle. Left out of `tintable` on purpose: the nozzle
    // reads as hardware, and hardware does not change colour with the suit.
    const metalMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x2c3e50),
      useUv: true
    });

    this.tintable.push(suitMat, gauntletMat);

    // ==========================================
    // 1. LEFT ARM (Web-Slinging Arm)
    // ==========================================
    // Forearm extending from bottom-left towards center-left
    const forearmGeom = new THREE.CylinderGeometry(0.042, 0.034, 0.32, 10);
    const leftForearm = new THREE.Mesh(forearmGeom, suitMat);
    leftForearm.rotation.x = Math.PI / 2.3;
    leftForearm.position.set(0, -0.02, -0.12);
    leftForearm.add(InkShaderMaterial.createEdgeLines(forearmGeom));
    this.leftArm.add(leftForearm);

    // Left Wrist Web-Shooter Gauntlet
    const gauntletGeom = new THREE.CylinderGeometry(0.046, 0.046, 0.07, 10);
    const leftGauntlet = new THREE.Mesh(gauntletGeom, gauntletMat);
    leftGauntlet.rotation.x = Math.PI / 2.3;
    leftGauntlet.position.set(0, 0.03, -0.22);
    leftGauntlet.add(InkShaderMaterial.createEdgeLines(gauntletGeom));
    this.leftArm.add(leftGauntlet);

    // Chrome Web-Shooter Trigger / Nozzle
    const nozzleGeom = new THREE.CylinderGeometry(0.008, 0.012, 0.025, 8);
    const leftNozzle = new THREE.Mesh(nozzleGeom, metalMat);
    leftNozzle.rotation.x = Math.PI / 2;
    leftNozzle.position.set(0, 0.04, -0.26);
    this.leftArm.add(leftNozzle);

    // Web line attachment point at nozzle tip
    this.webOriginMesh.position.set(0, 0.04, -0.28);
    this.leftArm.add(this.webOriginMesh);

    // Left Hand Palm
    const palmGeom = new THREE.BoxGeometry(0.065, 0.038, 0.08);
    const leftPalm = new THREE.Mesh(palmGeom, suitMat);
    leftPalm.position.set(0, 0.05, -0.28);
    leftPalm.add(InkShaderMaterial.createEdgeLines(palmGeom));

    // Knuckle creases: extra edge-line detail across back of hand (reusing suitMat, no new textures)
    const knuckleCreaseGeom = new THREE.BoxGeometry(0.052, 0.005, 0.016);
    const leftKnuckleCrease = new THREE.Mesh(knuckleCreaseGeom, suitMat);
    leftKnuckleCrease.position.set(0, 0.02, -0.018);
    leftKnuckleCrease.add(InkShaderMaterial.createEdgeLines(knuckleCreaseGeom));
    leftPalm.add(leftKnuckleCrease);

    this.leftHandGroup.add(leftPalm);

    // Spider-Man iconic fingers:
    // Middle two fingers (curled down to palm trigger)
    const midFingerGeom = new THREE.BoxGeometry(0.032, 0.022, 0.045);
    this.leftMiddleFingers = new THREE.Mesh(midFingerGeom, suitMat);
    this.leftMiddleFingers.position.set(0, 0.035, -0.32);
    this.leftMiddleFingers.rotation.x = 0.4;
    this.leftMiddleFingers.add(InkShaderMaterial.createEdgeLines(midFingerGeom));
    this.leftHandGroup.add(this.leftMiddleFingers);

    // Index finger (extended forward)
    const fingerGeom = new THREE.BoxGeometry(0.016, 0.018, 0.06);
    this.leftIndexFinger = new THREE.Mesh(fingerGeom, suitMat);
    this.leftIndexFinger.position.set(-0.026, 0.055, -0.34);
    this.leftIndexFinger.rotation.x = -0.15;
    this.leftIndexFinger.add(InkShaderMaterial.createEdgeLines(fingerGeom));
    this.leftHandGroup.add(this.leftIndexFinger);

    // Pinky finger (extended)
    this.leftPinkyFinger = new THREE.Mesh(fingerGeom, suitMat);
    this.leftPinkyFinger.position.set(0.026, 0.055, -0.34);
    this.leftPinkyFinger.rotation.x = -0.15;
    this.leftPinkyFinger.add(InkShaderMaterial.createEdgeLines(fingerGeom));
    this.leftHandGroup.add(this.leftPinkyFinger);

    this.leftArm.add(this.leftHandGroup);

    // Default rest position (lower left quadrant)
    this.leftArm.position.set(-0.22, -0.18, -0.34);
    this.leftArm.rotation.set(-0.1, 0.15, 0.1);
    this.armsGroup.add(this.leftArm);

    // Right arm is left empty so the right side exclusively displays
    // the active weapon (sword, pistol, rifle, sniper) without any overlapping arm or right-side web slinger.
    this.rightArm.clear();
  }

  // Scratch vectors for zero-allocation per-frame arm updates
  private static readonly targetLeftPos: THREE.Vector3 = new THREE.Vector3();
  private static readonly targetLeft: THREE.Vector3 = new THREE.Vector3();

  /**
   * Get world position where web line attaches to player's left wrist
   */
  public getWebOriginWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return this.webOriginMesh.getWorldPosition(out);
  }

  /**
   * Updates arm positioning and IK/poses based on swinging, movement, and weapons
   */
  public update(
    dt: number,
    isSwinging: boolean,
    webAnchorPos: THREE.Vector3 | null,
    _cameraPos: THREE.Vector3,
    isMoving: boolean,
    _moveSpeed: number
  ): void {
    const time = performance.now() * 0.003;

    if (isSwinging && webAnchorPos) {
      // DYNAMIC SWINGING POSE:
      // Left arm raises high up, reaching toward the anchor holding the web line taut!
      PlayerArms.targetLeftPos.set(-0.14, 0.12, -0.36);
      this.leftArm.position.lerp(PlayerArms.targetLeftPos, dt * 14.0);

      // Angle left arm upward toward anchor
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -0.75, dt * 14.0);
      this.leftArm.rotation.y = THREE.MathUtils.lerp(this.leftArm.rotation.y, 0.25, dt * 14.0);
      this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0.35, dt * 14.0);

      // Web shooter pose: index and pinky extended, middle fingers pressed down
      this.leftIndexFinger.rotation.x = -0.3;
      this.leftPinkyFinger.rotation.x = -0.3;
      this.leftMiddleFingers.rotation.x = 0.6;
    } else {
      // GROUND / AIR TRAVERSAL POSE:
      // Natural walking breathing sway
      const idleBobY = Math.sin(time * 2.2) * (isMoving ? 0.016 : 0.004);
      const idleBobX = Math.cos(time * 1.1) * (isMoving ? 0.014 : 0.002);

      PlayerArms.targetLeft.set(-0.22 + idleBobX, -0.18 + idleBobY, -0.34);
      this.leftArm.position.lerp(PlayerArms.targetLeft, dt * 10.0);
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -0.12, dt * 10.0);
      this.leftArm.rotation.y = THREE.MathUtils.lerp(this.leftArm.rotation.y, 0.12, dt * 10.0);
      this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0.08, dt * 10.0);

      // Relaxed fingers
      this.leftIndexFinger.rotation.x = 0.15;
      this.leftPinkyFinger.rotation.x = 0.2;
      this.leftMiddleFingers.rotation.x = 0.25;
    }
  }
}
