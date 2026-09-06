import * as THREE from 'three';
import { BaseWeapon } from './BaseWeapon';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';

export class Sniper extends BaseWeapon {
  public readonly name = 'SNIPER';
  public readonly type = 'sniper' as const;
  public readonly usableWhileSwinging = false; // Locked while swinging!
  public readonly magazineSize = 5;
  public readonly maxReserveAmmo = 25;
  public readonly fireRate = 1.1; // Bolt-action pacing
  public readonly damage = 145; // One-shot kill on standard grunts!
  public readonly headshotMultiplier = 3.0;
  public readonly range = 400;
  public readonly spread = 0.0005; // Pinpoint precision
  public readonly recoilAmount = 0.22;
  public readonly reloadTime = 2.2;
  public readonly flavorText = 'precision blueprint rifle · 3.5x optical scope · press Q to zoom';

  public isScoped: boolean = false;

  constructor() {
    super();
    this.initAmmo();
    this.buildModel();
  }

  private buildModel(): void {
    const gunMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x132364),
      useUv: true,
      uvScale: 1.6
    });

    const darkMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x0a1435),
      useUv: true,
      uvScale: 2.4
    });

    const scopeMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x152778),
      useUv: true,
      uvScale: 2.0
    });

    // 1. Long Rifle Chassis & Stock
    const chassisGeom = new THREE.BoxGeometry(0.055, 0.085, 0.65);
    const chassisMesh = new THREE.Mesh(chassisGeom, gunMat);
    chassisMesh.position.set(0, 0.015, 0.05);
    chassisMesh.add(InkShaderMaterial.createEdgeLines(chassisGeom));
    this.modelGroup.add(chassisMesh);

    // Sniper buttstock with adjustable cheek-pad
    const stockGeom = new THREE.BoxGeometry(0.045, 0.12, 0.28);
    const stockMesh = new THREE.Mesh(stockGeom, darkMat);
    stockMesh.position.set(0, 0.02, 0.42);
    stockMesh.add(InkShaderMaterial.createEdgeLines(stockGeom));
    this.modelGroup.add(stockMesh);

    // Rubber buttpad
    const buttpadGeom = new THREE.BoxGeometry(0.048, 0.13, 0.035);
    const buttpad = new THREE.Mesh(buttpadGeom, darkMat);
    buttpad.position.set(0, 0.02, 0.57);
    buttpad.add(InkShaderMaterial.createEdgeLines(buttpadGeom));
    this.modelGroup.add(buttpad);

    // 2. Heavy Fluted Match Barrel
    const barrelGeom = new THREE.CylinderGeometry(0.018, 0.022, 0.68, 12);
    const barrelMesh = new THREE.Mesh(barrelGeom, darkMat);
    barrelMesh.rotation.x = Math.PI / 2;
    barrelMesh.position.set(0, 0.045, -0.58);
    barrelMesh.add(InkShaderMaterial.createEdgeLines(barrelGeom));
    this.modelGroup.add(barrelMesh);

    // Heavy Muzzle Brake
    const brakeGeom = new THREE.BoxGeometry(0.038, 0.044, 0.09);
    const brakeMesh = new THREE.Mesh(brakeGeom, darkMat);
    brakeMesh.position.set(0, 0.045, -0.96);
    brakeMesh.add(InkShaderMaterial.createEdgeLines(brakeGeom));
    this.modelGroup.add(brakeMesh);

    // 3. Telescopic Optical Scope (iconic cylindrical scope from reference!)
    const scopeGeom = new THREE.CylinderGeometry(0.034, 0.034, 0.38, 14);
    const scopeMesh = new THREE.Mesh(scopeGeom, scopeMat);
    scopeMesh.rotation.x = Math.PI / 2;
    scopeMesh.position.set(0, 0.13, -0.12);
    scopeMesh.add(InkShaderMaterial.createEdgeLines(scopeGeom));
    this.modelGroup.add(scopeMesh);

    // Objective Bell (wider front lens flare)
    const bellGeom = new THREE.CylinderGeometry(0.042, 0.034, 0.08, 14);
    const bellMesh = new THREE.Mesh(bellGeom, scopeMat);
    bellMesh.rotation.x = Math.PI / 2;
    bellMesh.position.set(0, 0.13, -0.32);
    bellMesh.add(InkShaderMaterial.createEdgeLines(bellGeom));
    this.modelGroup.add(bellMesh);

    // Eyepiece Ocular Bell
    const eyeGeom = new THREE.CylinderGeometry(0.034, 0.038, 0.06, 14);
    const eyeMesh = new THREE.Mesh(eyeGeom, scopeMat);
    eyeMesh.rotation.x = Math.PI / 2;
    eyeMesh.position.set(0, 0.13, 0.08);
    eyeMesh.add(InkShaderMaterial.createEdgeLines(eyeGeom));
    this.modelGroup.add(eyeMesh);

    // Scope Turrets (Windage and Elevation knobs)
    const turretGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8);
    const topTurret = new THREE.Mesh(turretGeom, darkMat);
    topTurret.position.set(0, 0.17, -0.12);
    this.modelGroup.add(topTurret);

    const sideTurret = new THREE.Mesh(turretGeom, darkMat);
    sideTurret.rotation.z = Math.PI / 2;
    sideTurret.position.set(0.04, 0.13, -0.12);
    this.modelGroup.add(sideTurret);

    // Scope Mounting Rings
    const ringGeom = new THREE.BoxGeometry(0.042, 0.05, 0.035);
    const ringFront = new THREE.Mesh(ringGeom, darkMat);
    ringFront.position.set(0, 0.09, -0.22);
    ringFront.add(InkShaderMaterial.createEdgeLines(ringGeom));
    this.modelGroup.add(ringFront);

    const ringRear = new THREE.Mesh(ringGeom, darkMat);
    ringRear.position.set(0, 0.09, -0.02);
    ringRear.add(InkShaderMaterial.createEdgeLines(ringGeom));
    this.modelGroup.add(ringRear);

    // 4. Tactical Bipod Legs (folded forward)
    const bipodLegGeom = new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6);
    const bipodL = new THREE.Mesh(bipodLegGeom, darkMat);
    bipodL.position.set(-0.035, -0.01, -0.52);
    bipodL.rotation.x = Math.PI / 2 - 0.2;
    bipodL.rotation.z = 0.2;
    this.modelGroup.add(bipodL);

    const bipodR = new THREE.Mesh(bipodLegGeom, darkMat);
    bipodR.position.set(0.035, -0.01, -0.52);
    bipodR.rotation.x = Math.PI / 2 - 0.2;
    bipodR.rotation.z = -0.2;
    this.modelGroup.add(bipodR);

    // 5. Pistol Grip
    const gripGeom = new THREE.BoxGeometry(0.045, 0.16, 0.08);
    const gripMesh = new THREE.Mesh(gripGeom, darkMat);
    gripMesh.position.set(0, -0.09, 0.12);
    gripMesh.rotation.x = 0.32;
    gripMesh.add(InkShaderMaterial.createEdgeLines(gripGeom));
    this.modelGroup.add(gripMesh);

    // 6. Bolt Handle with Round Ball Knob
    const boltShaftGeom = new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6);
    const boltShaft = new THREE.Mesh(boltShaftGeom, darkMat);
    boltShaft.rotation.z = Math.PI / 2.6;
    boltShaft.position.set(0.05, 0.07, 0.02);
    this.modelGroup.add(boltShaft);

    const boltKnobGeom = new THREE.SphereGeometry(0.014, 8, 8);
    const boltKnob = new THREE.Mesh(boltKnobGeom, darkMat);
    boltKnob.position.set(0.085, 0.08, 0.02);
    this.modelGroup.add(boltKnob);

    // Muzzle socket at brake tip
    this.muzzleTip.position.set(0, 0.045, -1.02);
    this.modelGroup.add(this.muzzleTip);

    this.modelGroup.scale.set(1.05, 1.05, 1.05);
  }
}
