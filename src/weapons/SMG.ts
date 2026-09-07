import * as THREE from 'three';
import { BaseWeapon } from './BaseWeapon';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';

/**
 * ====================================================================
 * WEAPON TUNING SPECIFICATION [GAME_PLAN 24.2]
 * --------------------------------------------------------------------
 * Weapon:                  SMG
 * Damage:                  22
 * Headshot Multiplier:     2.0x (44 dmg)
 * Falloff Band:            Start: 10m, End: 35m, Floor: 50% (11 dmg min)
 * Rate of Fire (RoF):      12.5 rounds/s (full-auto hose)
 * Magazine / Reserve Ammo: 32 / 160
 * Spread (Hip / ADS):      0.028 rad (~1.60°) / 0.0154 rad (~0.88°)
 * Reload Time:             1.4s
 * Swing Usability:         LOCKED while swinging
 * TTK Breakpoints:         Thug (90 HP) body = 5 shots (0.32s TTK < 1.0s close hose)
 * ====================================================================
 */
export class SMG extends BaseWeapon {
  public readonly name = 'RIFLE';
  public readonly type = 'smg' as const;
  public readonly usableWhileSwinging = false; // Locked while swinging!
  public readonly magazineSize = 32;
  public readonly maxReserveAmmo = 160;
  public readonly fireRate = 12.5; // Rapid 12.5 rounds/sec
  public readonly damage = 22;
  public readonly headshotMultiplier = 2.0;
  public readonly range = 75;
  public readonly falloffStart = 10;
  public readonly falloffEnd = 35;
  public readonly falloffFloor = 0.50;
  public readonly spread = 0.028;
  public readonly recoilAmount = 0.045;
  public readonly reloadTime = 1.4;
  public readonly flavorText = 'tactical ink rifle · optical red dot reflex sight · press Q to ADS';

  // Tactile shooting feel: rapid buzzing recoil vibration, high-frequency stream
  public override camKick: [number, number] = [0.015, 0.006];
  public override fovKick: number = 1.2;
  public override shakeAmount: number = 0.038;
  public override tracerThickness: number = 0.032;
  public override tracerColor: THREE.Color = new THREE.Color(0x0984e3);
  public override flashScale: number = 0.95;
  public override flashColorHex: number = 0xff793f;

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

    // Register flash materials for 1-frame muzzle emissive pulse
    this.registerFlashMaterial(gunMat, new THREE.Color(0x132364), new THREE.Color(0x8aa8ff));
    this.registerFlashMaterial(darkMat, new THREE.Color(0x0a1435), new THREE.Color(0x5070c0));

    const redReticleMat = new THREE.MeshBasicMaterial({
      color: 0xff3333,
      toneMapped: false
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

    // 7. Tactical Optical Reflex Sight (inspired by inspiration)
    // Low-profile riser mount
    const holoBaseGeom = new THREE.BoxGeometry(0.042, 0.016, 0.075);
    const holoBase = new THREE.Mesh(holoBaseGeom, darkMat);
    holoBase.position.set(0, 0.094, -0.06);
    holoBase.add(InkShaderMaterial.createEdgeLines(holoBaseGeom));
    this.modelGroup.add(holoBase);

    // Hollow optic hood (open viewing window without solid blocks obstructing view)
    const opticFrameGroup = new THREE.Group();
    opticFrameGroup.position.set(0, 0.126, -0.06);

    const hoodW = 0.068;
    const hoodH = 0.058;
    const hoodD = 0.028;
    const hoodT = 0.005;

    // Top hood bar
    const topBarGeom = new THREE.BoxGeometry(hoodW, hoodT, hoodD);
    const topBar = new THREE.Mesh(topBarGeom, darkMat);
    topBar.position.set(0, hoodH * 0.5 - hoodT * 0.5, 0);
    topBar.add(InkShaderMaterial.createEdgeLines(topBarGeom));
    opticFrameGroup.add(topBar);

    // Bottom base bar
    const bottomBarGeom = new THREE.BoxGeometry(hoodW, hoodT, hoodD);
    const bottomBar = new THREE.Mesh(bottomBarGeom, darkMat);
    bottomBar.position.set(0, -hoodH * 0.5 + hoodT * 0.5, 0);
    bottomBar.add(InkShaderMaterial.createEdgeLines(bottomBarGeom));
    opticFrameGroup.add(bottomBar);

    // Left wall
    const leftWallGeom = new THREE.BoxGeometry(hoodT, hoodH, hoodD);
    const leftWall = new THREE.Mesh(leftWallGeom, darkMat);
    leftWall.position.set(-hoodW * 0.5 + hoodT * 0.5, 0, 0);
    leftWall.add(InkShaderMaterial.createEdgeLines(leftWallGeom));
    opticFrameGroup.add(leftWall);

    // Right wall
    const rightWallGeom = new THREE.BoxGeometry(hoodT, hoodH, hoodD);
    const rightWall = new THREE.Mesh(rightWallGeom, darkMat);
    rightWall.position.set(hoodW * 0.5 - hoodT * 0.5, 0, 0);
    rightWall.add(InkShaderMaterial.createEdgeLines(rightWallGeom));
    opticFrameGroup.add(rightWall);

    // Anti-glare optical glass lens (crystal clear aperture)
    const glassGeom = new THREE.PlaneGeometry(hoodW - hoodT * 2, hoodH - hoodT * 2);
    const glassMat = new THREE.MeshBasicMaterial({
      color: 0x74b9ff,
      transparent: true,
      opacity: 0.10,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const glassMesh = new THREE.Mesh(glassGeom, glassMat);
    glassMesh.position.set(0, 0, 0);
    opticFrameGroup.add(glassMesh);

    // Luminous reflex outer ring
    const reticleRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.008, 0.0013, 6, 24),
      redReticleMat
    );
    reticleRing.position.set(0, 0, 0.001);
    opticFrameGroup.add(reticleRing);

    // Floating center red dot
    const reticleDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.002, 8, 8),
      redReticleMat
    );
    reticleDot.position.set(0, 0, 0.002);
    opticFrameGroup.add(reticleDot);

    // Tactical micro-crosshair ticks
    const tickHGeom = new THREE.BoxGeometry(0.0035, 0.0009, 0.001);
    const tickVGeom = new THREE.BoxGeometry(0.0009, 0.0035, 0.001);
    const tickL = new THREE.Mesh(tickHGeom, redReticleMat);
    tickL.position.set(-0.0125, 0, 0.001);
    const tickR = new THREE.Mesh(tickHGeom, redReticleMat);
    tickR.position.set(0.0125, 0, 0.001);
    const tickT = new THREE.Mesh(tickVGeom, redReticleMat);
    tickT.position.set(0, 0.0125, 0.001);
    const tickB = new THREE.Mesh(tickVGeom, redReticleMat);
    tickB.position.set(0, -0.0125, 0.001);
    opticFrameGroup.add(tickL, tickR, tickT, tickB);

    this.modelGroup.add(opticFrameGroup);

    // Muzzle socket at flash-hider tip
    this.muzzleTip.position.set(0, 0.035, -0.51);
    this.modelGroup.add(this.muzzleTip);
    this.initMuzzleFlash();

    this.modelGroup.scale.set(1.1, 1.1, 1.1);
  }
}
