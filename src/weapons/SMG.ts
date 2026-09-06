import * as THREE from 'three';
import { BaseWeapon } from './BaseWeapon';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';

export class SMG extends BaseWeapon {
  public readonly name = 'SMG';
  public readonly type = 'smg' as const;
  public readonly usableWhileSwinging = false; // Locked while swinging!
  public readonly magazineSize = 32;
  public readonly maxReserveAmmo = 160;
  public readonly fireRate = 12.5; // Rapid 12.5 rounds/sec
  public readonly damage = 22;
  public readonly headshotMultiplier = 2.0;
  public readonly range = 75;
  public readonly spread = 0.028;
  public readonly recoilAmount = 0.045;
  public readonly reloadTime = 1.4;
  public readonly flavorText = 'tactical ink carbine · holographic reflex optic · press Q to ADS';

  public isAiming: boolean = false;

  constructor() {
    super();
    this.initAmmo();
    this.buildModel();
  }

  private buildModel(): void {
    const gunMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x132364),
      useUv: true,
      uvScale: 1.8
    });

    const darkMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x0a1435),
      useUv: true,
      uvScale: 2.2
    });

    const redReticleMat = new THREE.MeshBasicMaterial({
      color: 0xd63031,
      toneMapped: false
    });

    const blueRingMat = new THREE.MeshBasicMaterial({
      color: 0x1a2b72,
      wireframe: true
    });

    // 1. Upper Receiver Body
    const upperGeom = new THREE.BoxGeometry(0.055, 0.075, 0.38);
    const upperMesh = new THREE.Mesh(upperGeom, gunMat);
    upperMesh.position.set(0, 0.035, -0.06);
    upperMesh.add(InkShaderMaterial.createEdgeLines(upperGeom));
    this.modelGroup.add(upperMesh);

    // Picatinny top rail
    const railGeom = new THREE.BoxGeometry(0.04, 0.015, 0.34);
    const railMesh = new THREE.Mesh(railGeom, darkMat);
    railMesh.position.set(0, 0.078, -0.06);
    railMesh.add(InkShaderMaterial.createEdgeLines(railGeom));
    this.modelGroup.add(railMesh);

    // 2. Lower Receiver & Magwell
    const lowerGeom = new THREE.BoxGeometry(0.052, 0.055, 0.22);
    const lowerMesh = new THREE.Mesh(lowerGeom, darkMat);
    lowerMesh.position.set(0, -0.02, -0.02);
    lowerMesh.add(InkShaderMaterial.createEdgeLines(lowerGeom));
    this.modelGroup.add(lowerMesh);

    // 3. Ventilated Barrel Shroud & Flash Hider
    const shroudGeom = new THREE.CylinderGeometry(0.026, 0.026, 0.22, 10);
    const shroudMesh = new THREE.Mesh(shroudGeom, darkMat);
    shroudMesh.rotation.x = Math.PI / 2;
    shroudMesh.position.set(0, 0.035, -0.34);
    shroudMesh.add(InkShaderMaterial.createEdgeLines(shroudGeom));
    this.modelGroup.add(shroudMesh);

    // Flash hider muzzle
    const flashHiderGeom = new THREE.CylinderGeometry(0.022, 0.028, 0.05, 8);
    const flashHider = new THREE.Mesh(flashHiderGeom, gunMat);
    flashHider.rotation.x = Math.PI / 2;
    flashHider.position.set(0, 0.035, -0.47);
    flashHider.add(InkShaderMaterial.createEdgeLines(flashHiderGeom));
    this.modelGroup.add(flashHider);

    // 4. Curved 30-Round Magazine
    const magGeom = new THREE.BoxGeometry(0.038, 0.22, 0.075);
    const magMesh = new THREE.Mesh(magGeom, darkMat);
    magMesh.position.set(0, -0.12, -0.06);
    magMesh.rotation.x = -0.24; // Curved magazine sweep
    magMesh.add(InkShaderMaterial.createEdgeLines(magGeom));
    this.modelGroup.add(magMesh);

    // 5. Main Pistol Grip
    const gripGeom = new THREE.BoxGeometry(0.045, 0.15, 0.075);
    const gripMesh = new THREE.Mesh(gripGeom, darkMat);
    gripMesh.position.set(0, -0.09, 0.06);
    gripMesh.rotation.x = 0.26;
    gripMesh.add(InkShaderMaterial.createEdgeLines(gripGeom));
    this.modelGroup.add(gripMesh);

    // Forward Angled Foregrip
    const foregripGeom = new THREE.BoxGeometry(0.035, 0.09, 0.05);
    const foregripMesh = new THREE.Mesh(foregripGeom, darkMat);
    foregripMesh.position.set(0, -0.04, -0.22);
    foregripMesh.rotation.x = -0.15;
    foregripMesh.add(InkShaderMaterial.createEdgeLines(foregripGeom));
    this.modelGroup.add(foregripMesh);

    // 6. Tactical Stock
    const stockGeom = new THREE.BoxGeometry(0.04, 0.07, 0.18);
    const stockMesh = new THREE.Mesh(stockGeom, darkMat);
    stockMesh.position.set(0, 0.02, 0.22);
    stockMesh.add(InkShaderMaterial.createEdgeLines(stockGeom));
    this.modelGroup.add(stockMesh);

    // 7. Holographic Sight (matching reference screenshots!)
    // Base mount
    const holoBaseGeom = new THREE.BoxGeometry(0.048, 0.025, 0.09);
    const holoBase = new THREE.Mesh(holoBaseGeom, darkMat);
    holoBase.position.set(0, 0.095, -0.08);
    holoBase.add(InkShaderMaterial.createEdgeLines(holoBaseGeom));
    this.modelGroup.add(holoBase);

    // Protective square optic hood
    const hoodGeom = new THREE.BoxGeometry(0.052, 0.052, 0.075);
    const hoodMesh = new THREE.Mesh(hoodGeom, gunMat);
    hoodMesh.position.set(0, 0.13, -0.08);
    hoodMesh.add(InkShaderMaterial.createEdgeLines(hoodGeom));
    this.modelGroup.add(hoodMesh);

    // Clear aperture cutout (translucent framed glass)
    const glassGeom = new THREE.PlaneGeometry(0.038, 0.038);
    const glassMat = new THREE.MeshBasicMaterial({
      color: 0x8ea8db,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    const glassMesh = new THREE.Mesh(glassGeom, glassMat);
    glassMesh.position.set(0, 0.13, -0.08);
    this.modelGroup.add(glassMesh);

    // Sketched holographic circle reticle
    const ringGeom = new THREE.RingGeometry(0.009, 0.012, 16);
    const ringMesh = new THREE.Mesh(ringGeom, blueRingMat);
    ringMesh.position.set(0, 0.13, -0.079);
    this.modelGroup.add(ringMesh);

    // Center Red Dot
    const dotGeom = new THREE.SphereGeometry(0.0035, 6, 6);
    const dotMesh = new THREE.Mesh(dotGeom, redReticleMat);
    dotMesh.position.set(0, 0.13, -0.078);
    this.modelGroup.add(dotMesh);

    // Muzzle socket at flash-hider tip
    this.muzzleTip.position.set(0, 0.035, -0.51);
    this.modelGroup.add(this.muzzleTip);

    this.modelGroup.scale.set(1.1, 1.1, 1.1);
  }
}
