import * as THREE from 'three';
import { SwingPhysics, MovementMode } from './SwingPhysics';
import { WebRenderer } from '../effects/WebRenderer';
import { soundManager } from '../core/SoundManager';

export enum RopeState {
  HIDDEN = 'HIDDEN',
  TAUT = 'TAUT',
  SLACK = 'SLACK',
  ZIPPING = 'ZIPPING',
}

/**
 * Pure scoring function for web anchor candidates.
 * Lower score is better. Angle has primary weight (65%), distance has secondary weight (35%).
 * Higher anchors above player receive a height bonus that reduces the score.
 */
export function scoreAnchor(
  angleRad: number,
  distM: number,
  maxDist: number = 110.0,
  heightBonus: number = 0
): number {
  const normDist = maxDist > 0 ? distM / maxDist : 0;
  return angleRad * 0.65 + normDist * 0.35 - heightBonus * 0.02;
}

export interface WebTargetInfo {
  isValid: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

export class WebShooter {
  private physics: SwingPhysics;
  public webRenderer: WebRenderer;
  public maxWebDistance: number = 110.0;

  public currentTarget: WebTargetInfo | null = null;
  public isWebActive: boolean = false;
  public ropeState: RopeState = RopeState.HIDDEN;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private assistDirs: THREE.Vector3[] = [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0.08, 0.06, -1),
    new THREE.Vector3(-0.08, 0.06, -1),
    new THREE.Vector3(0, 0.14, -1),
    new THREE.Vector3(0.05, -0.04, -1),
    new THREE.Vector3(-0.05, -0.04, -1),
  ];
  private tmpDir: THREE.Vector3 = new THREE.Vector3();
  private tmpBase: THREE.Vector3 = new THREE.Vector3();
  private tmpTo: THREE.Vector3 = new THREE.Vector3();
  private tmpN: THREE.Vector3 = new THREE.Vector3();

  constructor(physics: SwingPhysics) {
    this.physics = physics;
    this.webRenderer = new WebRenderer();
  }

  /**
   * Scans forward from camera to find valid buildings/cranes for web-slinging.
   * Uses direct raycast + wide-cone assist + sky bias so swinging feels forgiving.
   * Falls back to the curated latch registry (antenna tips, parapets, balconies)
   * when rays hit open sky, so routes read at speed.
   */
  public scanForTargets(camera: THREE.Camera, collidables: THREE.Object3D[], playerPos?: THREE.Vector3, latchAnchors?: THREE.Vector3[]): WebTargetInfo | null {
    const origin = camera.position;

    let best: (WebTargetInfo & { penalty: number; score: number }) | null = null;

    for (let i = 0; i < this.assistDirs.length; i++) {
      this.tmpDir.copy(this.assistDirs[i]).normalize().applyQuaternion(camera.quaternion).normalize();
      this.raycaster.set(origin, this.tmpDir);
      this.raycaster.far = this.maxWebDistance;
      this.raycaster.near = 2.0;

      const hits = this.raycaster.intersectObjects(collidables, false);
      for (const hit of hits) {
        if (!hit.point) continue;
        if (playerPos && hit.point.y < playerPos.y + 1.5) {
          if (i > 0) continue;
        }
        const penalty = i * 6.0 - Math.max(0, hit.point.y - (playerPos ? playerPos.y : 0)) * 0.35;
        const score = hit.distance + penalty;
        if (!best || score < best.score) {
          const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          best = {
            isValid: true,
            point: hit.point.clone(),
            normal: n,
            distance: hit.distance,
            penalty,
            score,
          };
        }
        break;
      }
      if (best && i === 0) break;
    }

    if (best) {
      this.currentTarget = { isValid: true, point: best.point, normal: best.normal, distance: best.distance };
      return this.currentTarget;
    }

    // Latch magnet: curated anchors win over open sky
    if (latchAnchors && latchAnchors.length > 0 && playerPos) {
      this.tmpBase.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      let anchorBest: THREE.Vector3 | null = null;
      let anchorScore = Infinity;
      let anchorDist = 0;
      for (const a of latchAnchors) {
        this.tmpTo.subVectors(a, origin);
        const dist = this.tmpTo.length();
        if (dist < 5 || dist > this.maxWebDistance) continue;
        if (a.y < playerPos.y + 1.0) continue;
        this.tmpTo.normalize();
        const angle = this.tmpBase.angleTo(this.tmpTo);
        if (angle > 0.38) continue;
        const score = scoreAnchor(angle, dist, this.maxWebDistance, 0);
        if (score < anchorScore) {
          anchorScore = score;
          anchorBest = a;
          anchorDist = dist;
        }
      }
      if (anchorBest) {
        this.tmpN.subVectors(origin, anchorBest).normalize();
        this.currentTarget = { isValid: true, point: anchorBest.clone(), normal: this.tmpN.clone(), distance: anchorDist };
        return this.currentTarget;
      }
    }

    // Secondary wide-cone check for nearby skyscraper corners
    this.currentTarget = null;
    return null;
  }

  /**
   * Shoots web to active target and begins swinging.
   * Rejects anchors at/below feet so the pendulum always has height to work with.
   */
  public shootWeb(targetPoint?: THREE.Vector3, playerPos?: THREE.Vector3): boolean {
    const anchor = targetPoint || (this.currentTarget ? this.currentTarget.point : null);
    if (!anchor) return false;
    if (playerPos && anchor.y < playerPos.y + 1.0) return false;

    this.physics.attachWeb(anchor, this.currentTarget?.normal);
    this.isWebActive = true;
    this.ropeState = RopeState.TAUT;
    soundManager.playWebShoot();
    setTimeout(() => soundManager.playWebLatch(), 60);

    return true;
  }

  /**
   * Releases current web with optional slingshot boost
   */
  public releaseWeb(jumpBoost: boolean = false, lookDir?: THREE.Vector3): void {
    if (!this.isWebActive) return;

    this.physics.releaseWeb(jumpBoost, lookDir);
    this.isWebActive = false;
    this.ropeState = RopeState.HIDDEN;
    this.webRenderer.hide();
    soundManager.playWebRelease();
  }

  /**
   * Fast web zip directly to target
   */
  public triggerWebZip(targetPoint?: THREE.Vector3): boolean {
    const target = targetPoint || (this.currentTarget ? this.currentTarget.point : null);
    if (!target) return false;

    this.physics.startWebZip(target);
    this.isWebActive = true;
    this.ropeState = RopeState.ZIPPING;
    soundManager.playWebShoot();
    return true;
  }

  /**
   * Cancels active web zip into a swing-style release boost
   */
  public cancelWebZip(lookDir?: THREE.Vector3): void {
    this.physics.cancelWebZip(lookDir);
    this.isWebActive = false;
    this.ropeState = RopeState.HIDDEN;
    this.webRenderer.hide();
    soundManager.playWebRelease();
  }

  /**
   * Updates web line visualization driven by ropeState
   */
  public update(dt: number, wristWorldPos: THREE.Vector3): void {
    if (this.isWebActive && this.physics.mode === MovementMode.WEB_ZIPPING && this.physics.zipTarget) {
      this.ropeState = RopeState.ZIPPING;
      const time = performance.now() * 0.001;
      this.webRenderer.updateWeb(
        wristWorldPos,
        this.physics.zipTarget,
        this.ropeState,
        time
      );
    } else if (this.isWebActive && this.physics.webAnchor && this.physics.mode === MovementMode.SWINGING) {
      this.ropeState = this.physics.isWebTaut ? RopeState.TAUT : RopeState.SLACK;
      const time = performance.now() * 0.001;
      this.webRenderer.updateWeb(
        wristWorldPos,
        this.physics.webAnchor,
        this.ropeState,
        time
      );
    } else {
      this.ropeState = RopeState.HIDDEN;
      this.isWebActive = false;
      this.webRenderer.hide();
    }
  }
}
