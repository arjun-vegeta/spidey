import * as THREE from 'three';
import { BaseWeapon } from './BaseWeapon';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';

export class Pistol extends BaseWeapon {
  public readonly name = 'PISTOL';
  public readonly type = 'pistol' as const;
  public readonly usableWhileSwinging = true; // Crucial: usable while web swinging!
  public readonly magazineSize = 12;
  public readonly maxReserveAmmo = 60;
  public readonly fireRate = 4.8; // Semi-auto click rate
  public readonly damage = 42;
  public readonly headshotMultiplier = 2.5;
  public readonly range = 90;
  public readonly spread = 0.009;
  public readonly recoilAmount = 0.07;
  public readonly reloadTime = 1.1;
  public readonly flavorText = 'tactical ballpoint sidearm · single-handed · swing & shoot enabled';

  public isAiming: boolean = false;

  constructor() {
    super();
    this.initAmmo();
    this.buildModel();
  }

  private buildModel(): void {
    // Metal slide & frame ink material
    const gunMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x122262),
      useUv: true,
      uvScale: 1.5
    });

    const darkMetalMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x0a1435),
      useUv: true,
      uvScale: 2.0
    });

    // Red dot reticle material
    const redDotMat = new THREE.MeshBasicMaterial({
      color: 0xd63031,
      toneMapped: false
    });

    // 1. Slide / Upper Receiver
    const slideGeom = new THREE.BoxGeometry(0.048, 0.068, 0.25);
    const slideMesh = new THREE.Mesh(slideGeom, gunMat);
    slideMesh.position.set(0, 0.038, -0.04);
    slideMesh.add(InkShaderMaterial.createEdgeLines(slideGeom));
    this.modelGroup.add(slideMesh);

    // Slide serrations (rear cocking grooves)
    const serrationGeom = new THREE.BoxGeometry(0.052, 0.045, 0.05);
    const serrationMesh = new THREE.Mesh(serrationGeom, darkMetalMat);
    serrationMesh.position.set(0, 0.04, 0.04);
    serrationMesh.add(InkShaderMaterial.createEdgeLines(serrationGeom));
    this.modelGroup.add(serrationMesh);

    // 2. Barrel with recessed tactical crown
    const barrelGeom = new THREE.CylinderGeometry(0.014, 0.014, 0.07, 10);
    const barrelMesh = new THREE.Mesh(barrelGeom, darkMetalMat);
    barrelMesh.rotation.x = Math.PI / 2;
    barrelMesh.position.set(0, 0.042, -0.18);
    barrelMesh.add(InkShaderMaterial.createEdgeLines(barrelGeom));
    this.modelGroup.add(barrelMesh);

    // 3. Lower Frame & Flared Magwell
    const frameGeom = new THREE.BoxGeometry(0.044, 0.048, 0.18);
    const frameMesh = new THREE.Mesh(frameGeom, gunMat);
    frameMesh.position.set(0, -0.01, -0.01);
    frameMesh.add(InkShaderMaterial.createEdgeLines(frameGeom));
    this.modelGroup.add(frameMesh);

    // 4. Textured Pistol Grip
    const gripGeom = new THREE.BoxGeometry(0.042, 0.14, 0.08);
    const gripMesh = new THREE.Mesh(gripGeom, darkMetalMat);
    gripMesh.position.set(0, -0.085, 0.03);
    gripMesh.rotation.x = 0.22; // Comfortable tactical rake
    gripMesh.add(InkShaderMaterial.createEdgeLines(gripGeom));
    this.modelGroup.add(gripMesh);

    // Extended basepad on magazine
    const basepadGeom = new THREE.BoxGeometry(0.044, 0.02, 0.085);
    const basepadMesh = new THREE.Mesh(basepadGeom, gunMat);
    basepadMesh.position.set(0, -0.155, 0.045);
    basepadMesh.rotation.x = 0.22;
    basepadMesh.add(InkShaderMaterial.createEdgeLines(basepadGeom));
    this.modelGroup.add(basepadMesh);

    // 5. Trigger Guard & Skeletonized Trigger
    const guardGeom = new THREE.BoxGeometry(0.026, 0.045, 0.07);
    const guardMesh = new THREE.Mesh(guardGeom, gunMat);
    guardMesh.position.set(0, -0.035, -0.035);
    guardMesh.add(InkShaderMaterial.createEdgeLines(guardGeom));
    this.modelGroup.add(guardMesh);

    const triggerGeom = new THREE.BoxGeometry(0.012, 0.025, 0.016);
    const triggerMesh = new THREE.Mesh(triggerGeom, darkMetalMat);
    triggerMesh.position.set(0, -0.032, -0.025);
    triggerMesh.rotation.x = -0.3;
    this.modelGroup.add(triggerMesh);

    // 6. Tactical Micro Red-Dot Sight (RMR reflex style)
    const sightHoodGeom = new THREE.BoxGeometry(0.038, 0.032, 0.045);
    const sightHood = new THREE.Mesh(sightHoodGeom, darkMetalMat);
    sightHood.position.set(0, 0.082, 0.01);
    sightHood.add(InkShaderMaterial.createEdgeLines(sightHoodGeom));
    this.modelGroup.add(sightHood);

    // Glowing Red Dot Reticle inside sight
    const dotGeom = new THREE.SphereGeometry(0.004, 6, 6);
    const dotMesh = new THREE.Mesh(dotGeom, redDotMat);
    dotMesh.position.set(0, 0.082, 0.01);
    this.modelGroup.add(dotMesh);

    // Front iron sight post
    const frontSightGeom = new THREE.BoxGeometry(0.008, 0.016, 0.014);
    const frontSight = new THREE.Mesh(frontSightGeom, darkMetalMat);
    frontSight.position.set(0, 0.078, -0.14);
    this.modelGroup.add(frontSight);

    this.modelGroup.scale.set(1.15, 1.15, 1.15);
  }
}
