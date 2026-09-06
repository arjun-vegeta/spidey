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

  constructor() {
    this.webOriginMesh = new THREE.Object3D();
    this.buildSpiderManArms();
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

    // Silver/metallic nozzle
    const metalMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x2c3e50),
      useUv: true
    });

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

    // ==========================================
    // 2. RIGHT ARM (Weapon Grip Arm)
    // ==========================================
    const rightForearm = new THREE.Mesh(forearmGeom, suitMat);
    rightForearm.rotation.x = Math.PI / 2.2;
    rightForearm.position.set(0, -0.02, -0.12);
    rightForearm.add(InkShaderMaterial.createEdgeLines(forearmGeom));
    this.rightArm.add(rightForearm);

    // Right Wrist Gauntlet
    const rightGauntlet = new THREE.Mesh(gauntletGeom, gauntletMat);
    rightGauntlet.rotation.x = Math.PI / 2.2;
    rightGauntlet.position.set(0, 0.03, -0.22);
    rightGauntlet.add(InkShaderMaterial.createEdgeLines(gauntletGeom));
    this.rightArm.add(rightGauntlet);

    // Right Hand Palm (gripping handle)
    const rightPalm = new THREE.Mesh(palmGeom, suitMat);
    rightPalm.position.set(0, 0.04, -0.28);
    rightPalm.add(InkShaderMaterial.createEdgeLines(palmGeom));
    this.rightHandGroup.add(rightPalm);

    // Curled fingers wrapped around weapon grip
    const curledFingersGeom = new THREE.BoxGeometry(0.065, 0.035, 0.05);
    const rightFingers = new THREE.Mesh(curledFingersGeom, suitMat);
    rightFingers.position.set(0.015, 0.02, -0.32);
    rightFingers.rotation.x = 0.5;
    rightFingers.add(InkShaderMaterial.createEdgeLines(curledFingersGeom));
    this.rightHandGroup.add(rightFingers);

    // Thumb wrapped over top
    const thumbGeom = new THREE.BoxGeometry(0.02, 0.02, 0.04);
    const rightThumb = new THREE.Mesh(thumbGeom, suitMat);
    rightThumb.position.set(-0.035, 0.06, -0.28);
    rightThumb.rotation.z = -0.4;
    rightThumb.add(InkShaderMaterial.createEdgeLines(thumbGeom));
    this.rightHandGroup.add(rightThumb);

    this.rightArm.add(this.rightHandGroup);

    // Default rest position (lower right quadrant, aligned with weapon grip)
    this.rightArm.position.set(0.20, -0.16, -0.36);
    this.rightArm.rotation.set(0.02, -0.08, -0.05);
    this.armsGroup.add(this.rightArm);
  }

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
    cameraPos: THREE.Vector3,
    isMoving: boolean,
    _moveSpeed: number
  ): void {
    const time = performance.now() * 0.003;

    if (isSwinging && webAnchorPos) {
      // DYNAMIC SWINGING POSE:
      // Left arm raises high up, reaching toward the anchor holding the web line taut!
      const targetLeftPos = new THREE.Vector3(-0.14, 0.12, -0.36);
      this.leftArm.position.lerp(targetLeftPos, dt * 14.0);

      // Angle left arm upward toward anchor
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -0.75, dt * 14.0);
      this.leftArm.rotation.y = THREE.MathUtils.lerp(this.leftArm.rotation.y, 0.25, dt * 14.0);
      this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0.35, dt * 14.0);

      // Web shooter pose: index and pinky extended, middle fingers pressed down
      this.leftIndexFinger.rotation.x = -0.3;
      this.leftPinkyFinger.rotation.x = -0.3;
      this.leftMiddleFingers.rotation.x = 0.6;

      // Right arm stays ready, holding weapon
      this.rightArm.position.lerp(new THREE.Vector3(0.18, -0.14, -0.36), dt * 12.0);
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0.05, dt * 12.0);
      this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, -0.05, dt * 12.0);
    } else {
      // GROUND / AIR TRAVERSAL POSE:
      // Natural walking breathing sway
      const idleBobY = Math.sin(time * 2.2) * (isMoving ? 0.016 : 0.004);
      const idleBobX = Math.cos(time * 1.1) * (isMoving ? 0.014 : 0.002);

      const targetLeft = new THREE.Vector3(-0.22 + idleBobX, -0.18 + idleBobY, -0.34);
      this.leftArm.position.lerp(targetLeft, dt * 10.0);
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -0.12, dt * 10.0);
      this.leftArm.rotation.y = THREE.MathUtils.lerp(this.leftArm.rotation.y, 0.12, dt * 10.0);
      this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0.08, dt * 10.0);

      // Relaxed fingers
      this.leftIndexFinger.rotation.x = 0.15;
      this.leftPinkyFinger.rotation.x = 0.2;
      this.leftMiddleFingers.rotation.x = 0.25;

      // Right arm follows weapon grip
      const targetRight = new THREE.Vector3(0.20 - idleBobX, -0.16 + idleBobY, -0.36);
      this.rightArm.position.lerp(targetRight, dt * 12.0);
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0.02, dt * 12.0);
      this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, -0.06, dt * 12.0);
      this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -0.04, dt * 12.0);
    }
  }
}
