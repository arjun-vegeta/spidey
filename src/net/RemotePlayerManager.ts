import * as THREE from 'three';
import { RemotePlayer } from './RemotePlayer';
import type { PeerInfo, StatePacket } from './NetTypes';
import type { FireResult } from '../weapons/BaseWeapon';

export interface PvpHitReport {
  target: RemotePlayer;
  damage: number;
  isHeadshot: boolean;
  point: THREE.Vector3;
}

/**
 * Owns the 3D representation of everyone else in the room: creates an avatar
 * when a peer appears, retires it when they leave, feeds each one its stream of
 * transforms, and answers the one question combat needs — "did that shot hit
 * a person?".
 */
export class RemotePlayerManager {
  private players = new Map<string, RemotePlayer>();
  private scene: THREE.Scene;
  private group: THREE.Group;
  private raycastTargets: THREE.Object3D[] = [];
  private targetsDirty = true;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'RemotePlayers';
    this.scene.add(this.group);
  }

  public get count(): number {
    return this.players.size;
  }

  public get all(): RemotePlayer[] {
    return [...this.players.values()];
  }

  public get(id: string): RemotePlayer | undefined {
    return this.players.get(id);
  }

  /**
   * Reconciles the avatar set against the authoritative roster: adds anyone
   * new, updates names and colours, and disposes anyone who has gone.
   */
  public syncRoster(roster: PeerInfo[]): void {
    const live = new Set<string>();

    for (const info of roster) {
      if (info.isSelf) continue;
      live.add(info.id);
      const existing = this.players.get(info.id);
      if (existing) {
        // A colour or character change rebuilds the body, which replaces the
        // hit proxies our cached raycast list points at.
        if (existing.setProfile(info.name, info.colorIndex, info.characterId)) {
          this.targetsDirty = true;
        }
      } else {
        const rp = new RemotePlayer(info.id, info.name, info.colorIndex, info.characterId);
        this.players.set(info.id, rp);
        this.group.add(rp.group);
        this.group.add(rp.webRenderer.mesh);
        this.targetsDirty = true;
      }
    }

    for (const [id, rp] of this.players) {
      if (live.has(id)) continue;
      this.remove(id, rp);
    }
  }

  private remove(id: string, rp: RemotePlayer): void {
    this.group.remove(rp.group);
    this.group.remove(rp.webRenderer.mesh);
    rp.dispose();
    this.players.delete(id);
    this.targetsDirty = true;
  }

  public applyState(peerId: string, s: StatePacket, now: number): void {
    this.players.get(peerId)?.pushState(s, now);
  }

  public setDead(peerId: string, dead: boolean): void {
    const rp = this.players.get(peerId);
    if (!rp) return;
    rp.setDead(dead);
    this.targetsDirty = true;
  }

  public update(dt: number, renderTime: number, camera: THREE.Camera): void {
    for (const rp of this.players.values()) rp.update(dt, renderTime, camera);
  }

  /**
   * Meshes a bullet can hit. Dead players are excluded, so you cannot farm a
   * corpse, and the list is rebuilt only when the population actually changes.
   */
  public getRaycastTargets(): THREE.Object3D[] {
    if (this.targetsDirty) {
      this.raycastTargets.length = 0;
      for (const rp of this.players.values()) {
        if (rp.isDead) continue;
        for (const m of rp.collidableMeshes) this.raycastTargets.push(m);
      }
      this.targetsDirty = false;
    }
    return this.raycastTargets;
  }

  /** Forces the next `getRaycastTargets` to rebuild (a peer died or respawned). */
  public invalidateTargets(): void {
    this.targetsDirty = true;
  }

  /**
   * Resolves a local shot against remote players.
   *
   * This is shooter-authoritative: we decide here that we hit someone and how
   * hard, then tell them. They apply it to their own health. That keeps the
   * feel honest for the person aiming (no "I clearly hit them" moments from
   * waiting on a round trip) while leaving every player in charge of their own
   * death.
   */
  public resolveHit(fireResult: FireResult): PvpHitReport | null {
    if (!fireResult.hit || !fireResult.target) return null;

    let node: THREE.Object3D | null = fireResult.target as THREE.Object3D;
    let target: RemotePlayer | null = null;
    let isHeadshot = false;

    while (node) {
      if (node.userData?.isHead) isHeadshot = true;
      const owner = node.userData?.remotePlayer as RemotePlayer | undefined;
      if (owner) {
        target = owner;
        break;
      }
      node = node.parent;
    }

    if (!target || target.isDead) return null;

    return {
      target,
      damage: fireResult.damage,
      isHeadshot: isHeadshot || fireResult.isHeadshot,
      point: fireResult.point ? fireResult.point.clone() : target.group.position.clone(),
    };
  }

  public clear(): void {
    for (const [id, rp] of [...this.players]) this.remove(id, rp);
  }

  public dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}
