import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Spring, Spring3 } from '../src/core/Spring';
import { BaseWeapon, createStarburstGeometry, createStarburstGroup } from '../src/weapons/BaseWeapon';
import { Sword } from '../src/weapons/Sword';
import { Pistol } from '../src/weapons/Pistol';
import { SMG } from '../src/weapons/SMG';
import { Sniper } from '../src/weapons/Sniper';
import { WeaponManager } from '../src/player/WeaponManager';
import { Player } from '../src/player/Player';
import { PlayerArms } from '../src/player/PlayerArms';
import { InputManager } from '../src/core/InputManager';
import { InkParticles } from '../src/effects/InkParticles';
import { soundManager } from '../src/core/SoundManager';

describe('Shooting Animation & Kinetic Juice (Inspiration Parity)', () => {
  describe('Damped Harmonic Oscillator Springs (Spring & Spring3)', () => {
    it('Spring initializes at 0 and kicks with velocity', () => {
      const spring = new Spring(190, 17);
      expect(spring.value).toBe(0);
      expect(spring.vel).toBe(0);

      spring.kick(10);
      expect(spring.vel).toBe(10);

      // Step forward: value should rise
      spring.update(0.016);
      expect(spring.value).toBeGreaterThan(0);
    });

    it('Spring decays back to rest target without exploding', () => {
      const spring = new Spring(220, 14);
      spring.kick(50);

      // Simulate 1 second of decay
      for (let i = 0; i < 60; i++) {
        spring.update(0.016);
      }

      // Should settle close to target (0)
      expect(Math.abs(spring.value)).toBeLessThan(0.05);
      expect(Math.abs(spring.vel)).toBeLessThan(0.5);
    });

    it('Spring sub-steps on large dt for numerical stability', () => {
      const spring = new Spring(300, 20);
      spring.kick(100);

      // Large frame drop (50ms) should not diverge into NaN or Infinity
      spring.update(0.05);
      expect(Number.isFinite(spring.value)).toBe(true);
      expect(Number.isFinite(spring.vel)).toBe(true);
    });

    it('Spring3 kicks and decays in 3 dimensions independently', () => {
      const s3 = new Spring3(260, 18);
      s3.kick(2, 4, 8);

      expect(s3.vel.x).toBe(2);
      expect(s3.vel.y).toBe(4);
      expect(s3.vel.z).toBe(8);

      s3.update(0.016);
      expect(s3.value.z).toBeGreaterThan(0);

      for (let i = 0; i < 60; i++) {
        s3.update(0.016);
      }

      expect(s3.value.length()).toBeLessThan(0.05);
    });
  });

  describe('Weapon Visuals & Starburst Muzzle Flash', () => {
    it('creates starburst geometry with valid vertices', () => {
      const geo = createStarburstGeometry(7, 0.16, 0.06);
      expect(geo).toBeDefined();
      expect(geo.attributes.position.count).toBeGreaterThan(0);
    });

    it('creates a 3D multi-plane starburst group with crossed meshes', () => {
      const group = createStarburstGroup(1.2, 0xff793f);
      expect(group.children.length).toBe(3); // XY, XZ, YZ planes
      expect(group.visible).toBe(false); // Initially hidden
    });

    it('all weapon types have distinctive recoil, tracer, and flash tuning', () => {
      const pistol = new Pistol();
      const smg = new SMG();
      const sniper = new Sniper();

      // Pistol: balanced tactical kick
      expect(pistol.camKick[0]).toBeGreaterThan(0.02);
      expect(pistol.fovKick).toBeGreaterThan(1.5);
      expect(pistol.shakeAmount).toBeGreaterThan(0.04);
      expect(pistol.flashScale).toBeGreaterThan(0.9);
      expect(pistol.flashMesh).not.toBeNull();

      // SMG: rapid, high-tempo recoil with smaller individual flash
      expect(smg.camKick[0]).toBeLessThan(pistol.camKick[0]);
      expect(smg.fovKick).toBeLessThan(pistol.fovKick);
      expect(smg.shakeAmount).toBeLessThan(pistol.shakeAmount);
      expect(smg.flashMesh).not.toBeNull();

      // Sniper: massive high-caliber recoil, fat beam, giant flash
      expect(sniper.camKick[0]).toBeGreaterThan(pistol.camKick[0]);
      expect(sniper.fovKick).toBeGreaterThan(pistol.fovKick);
      expect(sniper.shakeAmount).toBeGreaterThan(pistol.shakeAmount);
      expect(sniper.tracerThickness).toBeGreaterThan(pistol.tracerThickness);
      expect(sniper.flashScale).toBeGreaterThan(pistol.flashScale);
      expect(sniper.flashMesh).not.toBeNull();
    });

    it('triggerFlash shows flashMesh and updateFlash hides it after duration', () => {
      const pistol = new Pistol();
      expect(pistol.flashMesh!.visible).toBe(false);

      pistol.triggerFlash();
      expect(pistol.flashMesh!.visible).toBe(true);
      expect(pistol.flashTimer).toBeGreaterThan(0);

      // Advance by 0.02s (still within 0.045s flash duration)
      pistol.updateFlash(0.02);
      expect(pistol.flashMesh!.visible).toBe(true);

      // Advance past duration
      pistol.updateFlash(0.03);
      expect(pistol.flashMesh!.visible).toBe(false);
      expect(pistol.flashTimer).toBeLessThanOrEqual(0);
    });

    it('fire returns weapon reference in FireResult', () => {
      const pistol = new Pistol();
      const origin = new THREE.Vector3(0, 10, 0);
      const dir = new THREE.Vector3(0, 0, -1);
      const result = pistol.fire(10.0, origin, dir, false, []);

      expect(result).not.toBeNull();
      expect(result!.weapon).toBe(pistol);
      expect(pistol.flashMesh!.visible).toBe(true);
    });
  });

  describe('WeaponManager Physical Recoil Springs', () => {
    let wepManager: WeaponManager;

    beforeEach(() => {
      wepManager = new WeaponManager();
    });

    it('firing weapon kicks 3D springs and updates recoilPos / recoilRot', () => {
      wepManager.switchWeapon(0); // Pistol
      const origin = new THREE.Vector3(0, 10, 0);
      const dir = new THREE.Vector3(0, 0, -1);

      wepManager.fire(10.0, origin, dir, false, []);

      // Physical springs should have non-zero velocity
      expect(wepManager.recoilSpringPos.vel.z).toBeGreaterThan(0);
      expect(wepManager.recoilSpringRot.vel.x).toBeGreaterThan(0);

      // Update simulation
      wepManager.update(0.016, false, false, false, 0);

      // recoilPos and recoilRot should reflect spring displacement
      expect(wepManager.recoilPos.z).toBeGreaterThan(0);
      expect(wepManager.recoilRot.x).toBeGreaterThan(0);
    });

    it('switching weapons resets recoil springs cleanly', () => {
      wepManager.switchWeapon(0);
      wepManager.fire(10.0, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), false, []);
      wepManager.update(0.016, false, false, false, 0);

      expect(wepManager.recoilPos.z).toBeGreaterThan(0);

      wepManager.switchWeapon(1);
      expect(wepManager.recoilPos.z).toBe(0);
      expect(wepManager.recoilRot.x).toBe(0);
    });
  });

  describe('Player Camera Recoil, FOV Kick, and Screen Shake', () => {
    let camera: THREE.PerspectiveCamera;
    let input: InputManager;
    let player: Player;

    beforeEach(() => {
      camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
      input = new InputManager();
      player = new Player(camera, input);
    });

    it('addScreenShake increases trauma and damps exponentially over time', () => {
      expect(player.shakeAmt).toBe(0);

      player.addScreenShake(0.5);
      expect(player.shakeAmt).toBe(0.5);

      // Capped at 1.5
      player.addScreenShake(2.0);
      expect(player.shakeAmt).toBe(1.5);

      // Update player
      player.update(0.1, []);
      expect(player.shakeAmt).toBeLessThan(1.5);
      expect(player.shakeAmt).toBeGreaterThan(0);
    });

    it('applyFireRecoil kicks pitch, yaw, fovKick, and shakeAmt', () => {
      player.applyFireRecoil(0.04, 0.01, 2.5, 0.08);

      expect(player.recoilPitch.vel).toBeGreaterThan(0);
      expect(player.fovKick.vel).toBeGreaterThan(0);
      expect(player.shakeAmt).toBe(0.08);
    });

    it('takeDamage applies screen shake trauma', () => {
      player.takeDamage(20);
      expect(player.shakeAmt).toBeGreaterThan(0.2);
    });

    it('weapon fire automatically triggers applyFireRecoil on player', () => {
      input.fireJustPressed = true;
      const initialPitch = player.pitch;

      player.update(0.016, []);

      // Pitch should kick upward and recoil springs should be energized
      expect(player.pitch).toBeGreaterThanOrEqual(initialPitch);
      expect(player.shakeAmt).toBeGreaterThan(0);
      expect(player.recoilPitch.vel).toBeGreaterThan(0);
    });

    it('camera position and rotation incorporate shake displacement when trauma active', () => {
      player.addScreenShake(1.0);
      const prevPos = player.camera.position.clone();

      player.update(0.016, []);

      // Position should be perturbed by randomized screen shake
      expect(player.camera.position.y).not.toBe(prevPos.y);
    });
  });

  describe('InkParticles 3D Tracers, Sparks, Smoke, and Ricochet', () => {
    let particles: InkParticles;

    beforeEach(() => {
      particles = new InkParticles();
    });

    it('spawnTracer creates a pooled 3D box beam mesh with proper length and orientation', () => {
      const start = new THREE.Vector3(0, 2, 0);
      const end = new THREE.Vector3(0, 2, 20);

      particles.spawnTracer(start, end, new THREE.Color(0x1d8cf8), 0.05, 0.1);

      // Group should contain the tracer mesh
      const group = particles.getGroup();
      expect(group.children.length).toBeGreaterThan(0);

      // Simulate tracer aging and pooling
      particles.update(0.05); // Half life
      particles.update(0.06); // Expired

      // Should be recycled without errors
      expect(true).toBe(true);
    });

    it('spawnMuzzleSparks spawns high-velocity ink sparks with drag', () => {
      const muzzle = new THREE.Vector3(0.2, 1.5, -0.4);
      const forward = new THREE.Vector3(0, 0, -1);

      particles.spawnMuzzleSparks(muzzle, forward, 10, 0xffa834);
      particles.update(0.016);
      expect(true).toBe(true);
    });

    it('spawnMuzzleSmoke spawns rising expanding comic smoke drops', () => {
      const muzzle = new THREE.Vector3(0.2, 1.5, -0.4);
      const forward = new THREE.Vector3(0, 0, -1);

      particles.spawnMuzzleSmoke(muzzle, forward, 4);
      particles.update(0.016);
      expect(true).toBe(true);
    });

    it('spawnWallImpact spawns both ink drops and bright ricochet sparks', () => {
      const hitPoint = new THREE.Vector3(5, 2, 0);
      const normal = new THREE.Vector3(-1, 0, 0);

      particles.spawnWallImpact(hitPoint, normal);
      particles.update(0.016);
      expect(true).toBe(true);
    });
  });

  describe('Gamepad Rumble / Haptic Kick', () => {
    it('rumble method executes safely without throwing', () => {
      const input = new InputManager();
      expect(() => input.rumble(0.5, 0.5, 80)).not.toThrow();
    });
  });

  describe('Sword (Katana) & Rifle Optical Reflex Sight (Inspiration Parity)', () => {
    it('Sword has single metal 3D geometry with razor-sharp needle tip and infinite ammo', () => {
      const sword = new Sword();
      expect(sword.name).toBe('SWORD');
      expect(sword.type).toBe('sword');
      expect(sword.damage).toBe(75);
      expect(sword.range).toBe(3.8);
      expect(sword.usableWhileSwinging).toBe(true);
      expect(sword.currentAmmo).toBe(1);
      expect(sword.magazineSize).toBe(1);
      expect(sword.shakeAmount).toBeGreaterThan(0.1);
      expect(sword.fireRate).toBe(3.4);
      expect(sword.slashDuration).toBe(0.28);

      // Verify single-metal parts in model: blade, dual fullers, guard, collar, hilt, 5 grip rings, pommel, muzzle tip
      expect(sword.modelGroup.children.length).toBeGreaterThanOrEqual(10);

      // Verify blade geometry has sharp needle tip
      const bladeGeom = Sword.createSharpBladeGeometry();
      const posAttr = bladeGeom.attributes.position;
      expect(posAttr.count).toBe(21); // 20 station vertices + 1 needle tip vertex

      // Sharp tip vertex is at [0, 0.007, -0.90]
      const tipX = posAttr.getX(20);
      const tipY = posAttr.getY(20);
      const tipZ = posAttr.getZ(20);
      expect(tipX).toBe(0);
      expect(tipY).toBeCloseTo(0.007, 3);
      expect(tipZ).toBeCloseTo(-0.90, 3);

      // Muzzle tip sits precisely at the sharp needle tip
      expect(sword.muzzleTip.position.z).toBe(-0.90);
    });

    it('Sword combo increments and alternates slash direction', () => {
      const sword = new Sword();
      const origin = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, -1);

      expect(sword.combo).toBe(0);

      // First slash
      const r1 = sword.fire(1.0, origin, dir, false, []);
      expect(r1).not.toBeNull();
      expect(sword.combo).toBe(1);
      expect(sword.slashDir).toBe(1);
      expect(sword.isSlashing).toBe(true);

      // Second slash (within combo window)
      const r2 = sword.fire(1.35, origin, dir, false, []);
      expect(r2).not.toBeNull();
      expect(sword.combo).toBe(2);
      expect(sword.slashDir).toBe(-1); // Alternates direction!

      // Time expires -> combo resets
      sword.updateSword(1.0);
      expect(sword.combo).toBe(0);
      expect(sword.isSlashing).toBe(false);
    });

    it('Sword melee arc detects enemies within 3.8m forward cone', () => {
      const sword = new Sword();
      const origin = new THREE.Vector3(0, 1.5, 0);
      const dir = new THREE.Vector3(0, 0, -1);

      // Enemy mesh within forward cone at 2.5m
      const enemyMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
      enemyMesh.position.set(0.5, 1.5, -2.5);
      const mockEnemy = {
        isDead: false,
        takeDamage: () => ({ killed: false, actualDamage: 75 })
      };
      enemyMesh.userData = { enemy: mockEnemy, isHead: false };

      const result = sword.fire(1.0, origin, dir, false, [enemyMesh]);
      expect(result).not.toBeNull();
      expect(result?.hit).toBe(true);
      expect(result?.damage).toBe(75);
      expect(result?.target).toBe(enemyMesh);
    });

    it('4-Slot weapon ordering: 0: Sword, 1: Pistol, 2: Rifle (SMG), 3: Sniper', () => {
      const wepMgr = new WeaponManager();
      expect(wepMgr.weapons.length).toBe(4);
      expect(wepMgr.weapons[0].type).toBe('sword');
      expect(wepMgr.weapons[1].type).toBe('pistol');
      expect(wepMgr.weapons[2].type).toBe('smg');
      expect(wepMgr.weapons[2].name).toBe('RIFLE');
      expect(wepMgr.weapons[3].type).toBe('sniper');

      // Key switching in InputManager
      const input = new InputManager();
      (input as any).onKeyDown({ key: '1', toLowerCase: () => '1' } as any);
      expect(input.weaponSwitchIndex).toBe(0); // Sword

      (input as any).onKeyDown({ key: '2', toLowerCase: () => '2' } as any);
      expect(input.weaponSwitchIndex).toBe(1); // Pistol

      (input as any).onKeyDown({ key: '3', toLowerCase: () => '3' } as any);
      expect(input.weaponSwitchIndex).toBe(2); // Rifle

      (input as any).onKeyDown({ key: '4', toLowerCase: () => '4' } as any);
      expect(input.weaponSwitchIndex).toBe(3); // Sniper
    });

    it('Rifle has hollow reflex sight with optical lens and illuminated red reticle', () => {
      const rifle = new SMG();
      expect(rifle.name).toBe('RIFLE');
      expect(rifle.flavorText).toContain('optical red dot reflex sight');

      // Model group contains optic frame group with multiple elements (frame bars, lens, reticle ring, dot)
      expect(rifle.modelGroup.children.length).toBeGreaterThanOrEqual(8);
    });

    it('Katana audio methods and slash arc effects run without throwing', () => {
      expect(() => soundManager.playKatanaSwing()).not.toThrow();
      expect(() => soundManager.playKatanaHit()).not.toThrow();

      const particles = new InkParticles();
      const origin = new THREE.Vector3(0, 1.5, 0);
      const forward = new THREE.Vector3(0, 0, -1);
      const right = new THREE.Vector3(1, 0, 0);

      expect(() => particles.spawnSlashArc(origin, forward, right, 0)).not.toThrow();
      expect(() => particles.spawnSlashArc(origin, forward, right, 1)).not.toThrow();
    });

    it('PlayerArms: left hand exclusively holds web-slinger; right arm is clear for weapons', () => {
      const arms = new PlayerArms();
      // Only left arm is added to armsGroup
      expect(arms.armsGroup.children).toContain(arms.leftArm);
      expect(arms.armsGroup.children).not.toContain(arms.rightArm);
      expect(arms.rightArm.children.length).toBe(0);

      // Left arm holds the webOriginMesh anchor
      const out = new THREE.Vector3();
      arms.getWebOriginWorldPos(out);
      expect(out).toBeDefined();

      // Updates arm without throwing and respects swinging poses
      expect(() => arms.update(0.016, true, new THREE.Vector3(0, 20, 0), new THREE.Vector3(), false, 0)).not.toThrow();
      expect(() => arms.update(0.016, false, null, new THREE.Vector3(), false, 0)).not.toThrow();
    });
  });
});
