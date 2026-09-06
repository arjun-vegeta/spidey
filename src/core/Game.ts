import * as THREE from 'three';
import { CityBuilder } from '../world/CityBuilder';
import { Player } from '../player/Player';
import { InputManager } from './InputManager';
import { EnemyManager } from '../enemies/EnemyManager';
import { InkParticles } from '../effects/InkParticles';
import { HUD, HudExtras } from '../ui/HUD';
import { loadSettings, saveSettings, SettingsData } from './Settings';
import { soundManager } from './SoundManager';
import { FireResult } from '../weapons/BaseWeapon';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { DebugToggles } from './DebugToggles';

export class Game {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  public input: InputManager;
  public player: Player;
  public cityBuilder: CityBuilder;
  public enemyManager: EnemyManager;
  public particles: InkParticles;
  public hud: HUD;
  public debugToggles: DebugToggles;

  private isRunning: boolean = false;
  private lastTime: number = 0;
  private totalScore: number = 0;
  private wasLocked: boolean = true;

  private readonly paperColor = new THREE.Color(0xfaf7ee);
  private tmpMuzzle: THREE.Vector3 = new THREE.Vector3();
  private tmpEnd: THREE.Vector3 = new THREE.Vector3();
  private tmpLook: THREE.Vector3 = new THREE.Vector3();
  private hoverRay: THREE.Raycaster = new THREE.Raycaster();
  private combatTargets: THREE.Object3D[] = [];
  private webAnchors: THREE.Vector3[] = [];
  private mapBuildings: Array<{ x: number; z: number; w: number; d: number }> = [];
  private lastPreviewKey: number = -1;
  private settings: SettingsData;

  // Onboarding beats (wave-1 only, trigger on state never timers)
  private obStage: number = 0;
  private obSwung: boolean = false;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = this.paperColor;
    this.scene.fog = new THREE.FogExp2(0xfaf7ee, 0.0055);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 800);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const container = document.getElementById('canvas-container') || document.body;
    container.appendChild(this.renderer.domElement);

    this.input = new InputManager(this.renderer.domElement);
    this.settings = loadSettings();
    this.hud = new HUD(this.settings);

    this.player = new Player(this.camera, this.input);

    this.cityBuilder = new CityBuilder();
    this.scene.add(this.cityBuilder.group);

    this.particles = new InkParticles();
    this.scene.add(this.particles.getGroup());

    // Web line was never added to the scene — swinging was invisible
    this.scene.add(this.player.webShooter.webRenderer.mesh);

    this.enemyManager = new EnemyManager(this.scene, this.particles);
    this.enemyManager.collidableMeshes = this.cityBuilder.getCollidableMeshes();
    this.enemyManager.onPlayerDamaged = (pos) => this.hud.noteDamageFrom(pos);

    // Simplified collision shells (no more walking through buildings)
    this.player.bindCollider(this.cityBuilder.getWorldCollider());
    this.mapBuildings = this.cityBuilder.getMapBuildings();
    this.webAnchors = this.cityBuilder.getWebAnchors();

    // Failed-web feedback wired to HUD reticle shake (plan 7.1)
    this.player.onDryWeb = () => this.hud.triggerDryWebShake();

    // Debug toggles (plan 33): ?showcolliders, ?showlatches, ?debugyard, ?debugrange & 7/8/9/0 keys
    this.debugToggles = new DebugToggles(
      this.scene,
      this.cityBuilder.getWorldCollider(),
      this.webAnchors,
      this.hud
    );

    // HUD wave flow + rewards
    this.enemyManager.onWaveStart = (wave) => {
      const titles = ['INK INVASION BEGINS', 'THE SKETCH FIGHTS BACK', 'RED INK RISING'];
      const comp = this.enemyManager.compositionFor ? this.enemyManager.compositionFor(wave) : this.enemyManager.peekNextWave();
      this.hud.showWaveAnnouncement(
        wave,
        titles[Math.min(wave - 1, titles.length - 1)] ?? 'ELIMINATE ALL INK HOSTILES',
        comp
      );
    };
    this.enemyManager.onWaveComplete = (wave) => {
      const bonus = 100 * wave;
      this.totalScore += bonus;
      this.hud.showWaveAnnouncement(wave, `WAVE CLEARED · +AMMO · +25 HP · +${bonus}`);
      this.player.weaponManager.resetAmmo();
      this.player.heal(25);
      soundManager.playWaveStart(wave + 1);
    };
    this.enemyManager.onKill = () => {
      soundManager.playEnemyDeath();
    };

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfffdf5, 1.1);
    sunLight.position.set(60, 140, 80);
    this.scene.add(sunLight);

    window.addEventListener('resize', () => this.onResize());

    this.input.onLockChange = (locked) => {
      const modal = document.getElementById('instructions-modal');
      if (locked && this.isRunning) {
        if (modal) modal.style.display = 'none';
        this.hud.setPaused(false);
        soundManager.ensureContext();
      } else if (locked) {
        // Locked but the game was never started (early click path): keep the
        // menu up so the player can never strand themselves in a frozen frame.
        if (modal) modal.style.display = 'flex';
        this.hud.setPaused(false);
      } else if (this.player.isDead) {
        if (modal) modal.style.display = 'flex';
        this.hud.setPaused(false);
      } else if (this.isRunning) {
        if (modal) modal.style.display = 'none';
        this.hud.setPaused(true);
      } else {
        if (modal) modal.style.display = 'flex';
        this.hud.setPaused(false);
      }
    };

    // Pause menu actions + persisted settings
    this.hud.onResumeRequest = () => this.input.requestPointerLock();
    this.hud.onRestartRequest = () => {
      this.restart();
      this.input.requestPointerLock();
    };
    this.hud.onQuitRequest = () => this.resetToMenu();
    this.hud.onSettingsChanged = (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    };
    this.applySettings();

    // Prove the canvas is alive before Play is ever pressed.
    // If this throws (e.g. no WebGL), the boot overlay tells the user instead of a blank page.
    try {
      this.player.lookInit();
      this.render();
    } catch (err) {
      Game.showBootError(err);
      throw err;
    }

    (window as unknown as { __spidey?: Game }).__spidey = this;
  }

  private static bootErrorEl: HTMLElement | null = null;

  /** On-screen error so a dead render loop can never fail silently again. */
  public static showBootError(err: unknown): void {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    if (!Game.bootErrorEl) {
      const el = document.createElement('pre');
      el.id = 'spidey-boot-error';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:999;max-width:60ch;max-height:30vh;overflow:auto;background:#d63031;color:#faf7ee;padding:10px 14px;font:12px monospace;white-space:pre-wrap;border:2px solid #152778;';
      document.body.appendChild(el);
      Game.bootErrorEl = el;
    }
    Game.bootErrorEl.textContent = `SPIDEY ERROR (screenshot this to me):\n${msg}`;
  }

  public toggleMinimap(): void {
    this.settings.minimap = !this.settings.minimap;
    saveSettings(this.settings);
    this.applySettings();
    this.hud.syncSettings(this.settings);
  }

  public toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    saveSettings(this.settings);
    this.applySettings();
    this.hud.syncSettings(this.settings);
  }

  public applySettings(): void {
    this.input.sensitivityScale = this.settings.sensitivity;
    soundManager.setVolume(this.settings.volume);
    if (soundManager.muted !== this.settings.muted) {
      soundManager.toggleMute();
    }
    this.player.baseFov = this.settings.fov;
    this.hud.setMinimapVisible(this.settings.minimap);

    if (this.settings.quality === 'low') {
      this.renderer.setPixelRatio(1);
      this.particles.setDensity(0.5);
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.particles.setDensity(1);
    }
  }

  public start(): void {
    if (this.isRunning) {
      // Re-lock flow after ESC pause
      this.input.requestPointerLock();
      this.lastTime = performance.now();
      return;
    }
    this.isRunning = true;
    this.lastTime = performance.now();

    this.enemyManager.startNextWave(this.player.health);

    requestAnimationFrame((t) => this.loop(t));
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop(now: number): void {
    if (!this.isRunning) return;

    // Scheduled FIRST so no per-frame exception can ever freeze the game again.
    requestAnimationFrame((t) => this.loop(t));

    try {
      const dt = Math.min((now - this.lastTime) * 0.001, 0.05);
      this.lastTime = now;

      // Pause simulation when pointer unlocked (ESC) — still render + HUD
      const locked = this.input.isPlaying;
      if (!locked && this.wasLocked) {
        soundManager.updateWind(0, 45);
      }
      this.wasLocked = locked;

      if (locked && !this.player.isDead) {
        this.update(dt);
      } else if (this.player.isDead) {
        this.updateDead(dt);
      } else {
        InkShaderMaterial.update(dt);
        this.cityBuilder.update(dt * 0.25);
        this.particles.update(dt);
      }
      this.render();

      this.input.endFrame();
    } catch (err) {
      Game.showBootError(err);
    }
  }

  private buildCombatTargets(): THREE.Object3D[] {
    this.combatTargets.length = 0;
    const city = this.cityBuilder.getCollidableMeshes();
    for (let i = 0; i < city.length; i++) this.combatTargets.push(city[i]);
    const foes = this.enemyManager.getRaycastTargets();
    for (let i = 0; i < foes.length; i++) this.combatTargets.push(foes[i]);
    return this.combatTargets;
  }

  private buildExtras(): HudExtras {
    const foes = this.enemyManager.enemies;
    const list: Array<{ x: number; z: number; kind: string }> = [];
    for (let i = 0; i < foes.length; i++) {
      const e = foes[i];
      if (e.isDead) continue;
      list.push({ x: e.group.position.x, z: e.group.position.z, kind: e.type });
    }
    return {
      yaw: this.player.yaw,
      px: this.player.position.x,
      pz: this.player.position.z,
      enemies: list,
      buildings: this.mapBuildings,
    };
  }

  private update(dt: number): void {
    InkShaderMaterial.update(dt);
    const collidables = this.cityBuilder.getCollidableMeshes();

    this.cityBuilder.update(dt);

    const combatTargets = this.buildCombatTargets();
    const fireResult: FireResult | null = this.player.update(dt, collidables, combatTargets, this.webAnchors);

    if (fireResult) {
      // Muzzle flash at the barrel tip (converged aim still comes from the camera)
      this.player.weaponManager.activeWeapon.muzzleTip.getWorldPosition(this.tmpMuzzle);
      this.particles.triggerMuzzleFlash(this.tmpMuzzle, fireResult.ray.direction);

      const hitReport = this.enemyManager.checkBulletHits(
        fireResult,
        this.player.isSwinging,
        this.player.position
      );

      if (hitReport) {
        // Tracer to flesh so hits read clearly
        if (fireResult.point) this.particles.spawnTracer(this.tmpMuzzle, fireResult.point);
        soundManager.playHitMarker(hitReport.isHeadshot);
        this.hud.triggerHitmarker(hitReport.isHeadshot, hitReport.killed);

        if (hitReport.killed && hitReport.killEvent) {
          const k = hitReport.killEvent;
          this.totalScore += k.scoreAwarded;
          soundManager.playKillStreak(k.killStreak);

          let tag = hitReport.isHeadshot ? 'HEADSHOT' : 'INK ERASURE';
          if (k.isSwinging) {
            tag = 'SWING KILL';
          } else if (k.distance > 45) {
            tag = 'LONGSHOT';
          }
          if (k.killStreak > 2) {
            tag += ` x${k.killStreak}`;
          }

          this.hud.showScorePopup(tag, k.scoreAwarded, hitReport.isHeadshot ? '#d63031' : '#152778');
        }
      } else if (fireResult.hit && fireResult.point && fireResult.normal) {
        this.particles.spawnWallImpact(fireResult.point, fireResult.normal);
        soundManager.playImpactWall();
        this.particles.spawnTracer(this.tmpMuzzle, fireResult.point);
      } else {
        this.tmpEnd.copy(fireResult.ray.origin).addScaledVector(fireResult.ray.direction, 80);
        this.particles.spawnTracer(this.tmpMuzzle, this.tmpEnd);
      }
    }

    this.enemyManager.update(dt, this.player, this.camera);

    // Crosshair hover: light up the aimed enemy's health bar (aim feedback)
    this.tmpLook.set(0, 0, -1).applyQuaternion(this.player.camera.quaternion);
    this.hoverRay.set(this.player.camera.position, this.tmpLook);
    this.hoverRay.near = 1;
    this.hoverRay.far = 120;
    const hoverHits = this.hoverRay.intersectObjects(combatTargets, false);
    if (hoverHits.length > 0) {
      const foe = hoverHits[0].object.userData?.enemy as { pingHealthBar?: () => void } | undefined;
      if (foe && typeof foe.pingHealthBar === 'function') foe.pingHealthBar();
    }

    // Next-wave preview during intermission
    if (!this.enemyManager.waveInProgress && this.enemyManager.currentWave > 0) {
      if (this.lastPreviewKey !== this.enemyManager.currentWave) {
        this.lastPreviewKey = this.enemyManager.currentWave;
        this.hud.showWavePreview(this.enemyManager.peekNextWave());
      }
    }

    this.particles.update(dt);

    const webTarget = this.player.webShooter.currentTarget;
    this.updateOnboarding(webTarget, fireResult !== null);
    this.hud.update(
      dt,
      this.player,
      this.totalScore,
      this.enemyManager.currentWave,
      this.enemyManager.enemiesLeft,
      webTarget,
      this.buildExtras()
    );

    if (this.player.isDead) {
      this.hud.showDeathScreen(this.totalScore, this.enemyManager.lastPlayerDeath);
    }
  }

  /**
   * Onboarding beats on wave 1 only. State triggers, never timers;
   * any shot fired or wave 2 dismisses instantly.
   */
  private updateOnboarding(webTarget: { isValid: boolean } | null, fired: boolean): void {
    if (this.obStage >= 4 || this.enemyManager.currentWave > 1) {
      if (this.obStage < 4) {
        this.obStage = 4;
        this.hud.showHint('');
      }
      return;
    }
    if (fired && this.obStage >= 3) {
      this.obStage = 4;
      this.hud.showHint('');
      return;
    }
    const keys = this.input.keys;
    switch (this.obStage) {
      case 0:
        this.hud.showHint('WASD MOVE · MOUSE LOOK');
        if (keys['w'] || keys['a'] || keys['s'] || keys['d']) this.obStage = 1;
        break;
      case 1:
        if (this.player.isSwinging) {
          this.obSwung = true;
          this.obStage = 2;
        } else if (!this.physicsGrounded() && webTarget && webTarget.isValid) {
          this.hud.showHint('HOLD RIGHT-CLICK TO SWING');
        } else {
          this.hud.showHint('JUMP, THEN HOLD RIGHT-CLICK TO SWING');
        }
        break;
      case 2:
        this.hud.showHint('RELEASE + SPACE FOR BOOST');
        if (this.obSwung && !this.player.isSwinging) this.obStage = 3;
        break;
      default:
        this.hud.showHint('CLICK TO SHOOT THE RED MARKERS');
        break;
    }
  }

  private physicsGrounded(): boolean {
    return this.player.physics.isGrounded;
  }

  private updateDead(dt: number): void {
    InkShaderMaterial.update(dt);
    this.particles.update(dt);
    this.enemyManager.update(dt, this.player, this.camera);
    this.hud.update(dt, this.player, this.totalScore, this.enemyManager.currentWave, this.enemyManager.enemiesLeft, null, this.buildExtras());
    this.hud.showDeathScreen(this.totalScore, this.enemyManager.lastPlayerDeath);
    if (this.input.keys['r'] || this.input.fireJustPressed) {
      this.restart();
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public restart(): void {
    this.player.reset();
    this.totalScore = 0;
    this.lastPreviewKey = -1;
    this.obStage = 0;
    this.obSwung = false;
    this.particles.clear();
    this.enemyManager.clear();
    this.enemyManager.startNextWave(this.player.health);
    this.hud.hideDeathScreen();
    this.lastTime = performance.now();
  }

  public resetToMenu(): void {
    this.isRunning = false;
    this.player.reset();
    this.totalScore = 0;
    this.lastPreviewKey = -1;
    this.obStage = 0;
    this.obSwung = false;
    this.particles.clear();
    this.enemyManager.clear();
    this.hud.setPaused(false);
    this.hud.hideDeathScreen();
    soundManager.stopAllLoops();

    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    const modal = document.getElementById('instructions-modal');
    if (modal) {
      modal.style.display = 'flex';
    }

    try {
      this.player.lookInit();
      this.render();
    } catch (err) {
      Game.showBootError(err);
    }
  }
}
