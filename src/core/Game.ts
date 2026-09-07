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
import { NetSession } from '../net/NetSession';
import { RemotePlayerManager } from '../net/RemotePlayerManager';
import { DeathmatchSpawns } from '../net/DeathmatchSpawns';
import { MultiplayerHud } from '../ui/MultiplayerHud';
import { colorHexFor } from '../net/Profile';
import {
  FLAG_CROUCHING,
  FLAG_DEAD,
  FLAG_GROUNDED,
  FLAG_SPRINTING,
  FLAG_SWINGING,
  RESPAWN_SECONDS,
  STATE_HZ,
  type StatePacket,
} from '../net/NetTypes';

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

  // ---- Multiplayer ---------------------------------------------------------
  /** Null in solo. Set for the whole life of a deathmatch session. */
  public net: NetSession | null = null;
  public remotes: RemotePlayerManager;
  public mpHud: MultiplayerHud;
  private spawns: DeathmatchSpawns | null = null;
  /** Accumulator that paces transform broadcasts to STATE_HZ. */
  private stateTimer: number = 0;
  private respawnTimer: number = 0;
  /** Who last hurt us, so a death can credit the right killer. */
  private lastAttackerId: string | null = null;
  private lastAttackerAt: number = 0;
  private deathReported: boolean = false;
  private tmpStatePos: THREE.Vector3 = new THREE.Vector3();
  private tmpShotDir: THREE.Vector3 = new THREE.Vector3();
  private tmpTracerColor: THREE.Color = new THREE.Color();
  /** Paces the match status line and scoreboard, which need no frame rate. */
  private hudRefreshTimer: number = 0;
  private static readonly HUD_REFRESH_INTERVAL = 0.2;
  /** Ceiling on damage a single reported hit may claim. */
  private static readonly MAX_INCOMING_DAMAGE = 500;

  public get isMultiplayer(): boolean {
    return this.net !== null;
  }

  private isRunning: boolean = false;
  private lastTime: number = 0;
  private totalScore: number = 0;
  private wasLocked: boolean = true;

  // Hitstop (micro-pause / time-dilation on heavy crits/kills for massive punch)
  private hitstopTimer: number = 0;
  private hitstopScale: number = 1.0;

  public triggerHitstop(duration: number = 0.05, timeScale: number = 0.15): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, duration);
    this.hitstopScale = timeScale;
  }

  private readonly paperColor = new THREE.Color(0xf5eedd);
  private tmpMuzzle: THREE.Vector3 = new THREE.Vector3();
  private tmpEnd: THREE.Vector3 = new THREE.Vector3();
  private tmpLook: THREE.Vector3 = new THREE.Vector3();
  private tmpRight: THREE.Vector3 = new THREE.Vector3();
  private static readonly UP_VEC: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
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
    this.scene.fog = new THREE.FogExp2(0xf5eedd, 0.0055);

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
    this.particles.bindCollider(this.cityBuilder.getWorldCollider());
    this.scene.add(this.particles.getGroup());

    // Web line was never added to the scene — swinging was invisible
    this.scene.add(this.player.webShooter.webRenderer.mesh);

    this.enemyManager = new EnemyManager(this.scene, this.particles);
    this.enemyManager.collidableMeshes = this.cityBuilder.getCollidableMeshes();
    this.enemyManager.bindCollider(this.cityBuilder.getWorldCollider());
    this.enemyManager.onPlayerDamaged = (pos) => this.hud.noteDamageFrom(pos);

    // Simplified collision shells (no more walking through buildings)
    this.player.bindCollider(this.cityBuilder.getWorldCollider());
    this.mapBuildings = this.cityBuilder.getMapBuildings();
    this.webAnchors = this.cityBuilder.getWebAnchors();

    // Failed-web feedback wired to HUD reticle shake (plan 7.1)
    this.player.onDryWeb = () => this.hud.triggerDryWebShake();

    // Multiplayer scaffolding. Both are inert until `enterMultiplayer` runs,
    // so solo play pays nothing for them beyond an empty group in the scene.
    this.remotes = new RemotePlayerManager(this.scene);
    this.mpHud = new MultiplayerHud();
    this.mpHud.onRematch = () => this.net?.requestRematch();
    this.mpHud.onLeave = () => this.onLeaveMatchRequest?.();

    // Debug toggles (plan 33): ?showcolliders, ?showlatches, ?debugyard, ?debugrange & 7/8/9/0 keys
    this.debugToggles = new DebugToggles(
      this.scene,
      this.cityBuilder.getWorldCollider(),
      this.webAnchors,
      this.hud
    );

    // HUD wave flow + rewards
    this.enemyManager.onWaveStart = (wave) => {
      const titles = ['INK INVASION BEGINS', 'THE SKETCH FIGHTS BACK', 'RED INK RISING', 'RELENTLESS SQUAD', 'APEX DRAWING'];
      const comp = this.enemyManager.compositionFor ? this.enemyManager.compositionFor(wave) : this.enemyManager.peekNextWave();
      const mod = this.enemyManager.activeModifier;
      const subtitle = (mod && mod.name)
        ? `${mod.name} · ${mod.description}`
        : (titles[Math.min(wave - 1, titles.length - 1)] ?? 'ELIMINATE ALL INK HOSTILES');
      this.hud.showWaveAnnouncement(
        wave,
        subtitle,
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

    const ambientLight = new THREE.AmbientLight(0xfff3db, 0.90);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffeecc, 1.15);
    sunLight.position.set(40, 75, 45);
    this.scene.add(sunLight);
    InkShaderMaterial.setLightDirection(sunLight.position);

    window.addEventListener('resize', () => this.onResize());

    this.input.onLockChange = (locked) => {
      const modal = document.getElementById('instructions-modal');

      // The end-of-match leaderboard deliberately releases the pointer so its
      // buttons are clickable. That must not be mistaken for a pause.
      if (!locked && this.mpHud.isEndVisible) {
        this.hud.setPaused(false);
        if (modal) modal.style.display = 'none';
        if (typeof document !== 'undefined') document.body.classList.remove('in-game');
        return;
      }

      // Dying in deathmatch releases nothing and pauses nothing: the world
      // keeps running behind the respawn counter.
      if (this.isMultiplayer && !locked && this.isRunning) {
        this.hud.setPaused(true);
        if (modal) modal.style.display = 'none';
        if (typeof document !== 'undefined') document.body.classList.remove('in-game');
        return;
      }

      if (locked && this.isRunning) {
        if (modal) modal.style.display = 'none';
        this.hud.setPaused(false);
        soundManager.ensureContext();
        if (typeof document !== 'undefined') document.body.classList.add('in-game');
      } else if (locked) {
        // Locked but the game was never started (early click path): keep the
        // menu up so the player can never strand themselves in a frozen frame.
        if (modal) modal.style.display = 'flex';
        this.hud.setPaused(false);
        if (typeof document !== 'undefined') document.body.classList.remove('in-game');
      } else if (this.player.isDead) {
        if (modal) modal.style.display = 'flex';
        this.hud.setPaused(false);
        if (typeof document !== 'undefined') document.body.classList.remove('in-game');
      } else if (this.isRunning) {
        if (modal) modal.style.display = 'none';
        this.hud.setPaused(true);
        if (typeof document !== 'undefined') document.body.classList.remove('in-game');
      } else {
        if (modal) modal.style.display = 'flex';
        this.hud.setPaused(false);
        if (typeof document !== 'undefined') document.body.classList.remove('in-game');
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
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:999;max-width:60ch;max-height:30vh;overflow:auto;background:#d63031;color:#f5eedd;padding:10px 14px;font:12px monospace;white-space:pre-wrap;border:2px solid #152778;';
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

  // =========================================================================
  // MULTIPLAYER
  // =========================================================================

  /** Raised when the player asks to abandon the match from the leaderboard. */
  public onLeaveMatchRequest?: () => void;

  /**
   * Set by `main.ts` when the front-end menu, rather than the classic
   * instructions modal, is what the player should land on after quitting.
   */
  public suppressInstructionsOnReset: boolean = false;

  /**
   * Switches the game into deathmatch against the peers in `session`.
   *
   * The AI wave system is stood down entirely: PvP and PvE share a city but
   * not a match. Every hostile in a deathmatch is another person.
   */
  public enterMultiplayer(session: NetSession): void {
    // Re-entering the SAME session (dropping in again after a rematch) must not
    // stack a second copy of every handler onto it.
    const alreadyBound = this.net === session;
    this.net = session;
    this.enemyManager.clear();

    if (!this.spawns) {
      this.spawns = new DeathmatchSpawns(this.enemyManager.spawnNodes.map((n) => n.position));
    }

    this.mpHud.setActive(true);
    this.mpHud.hideEnd();
    this.remotes.syncRoster(session.roster);
    this.player.arms.setInk(colorHexFor(session.localProfile.colorIndex));

    if (alreadyBound) {
      this.beginMatchRound();
      return;
    }

    // The menu already owns some of these callbacks for its lobby. Chain rather
    // than replace, or the lobby silently stops updating the moment a match has
    // been played once.
    const menuRoster = session.onRosterChange;
    const menuMatchStart = session.onMatchStart;
    const menuMatchEnd = session.onMatchEnd;

    session.onRosterChange = (roster) => {
      menuRoster?.(roster);
      this.remotes.syncRoster(roster);
      this.mpHud.renderScoreboard(roster, session.hostId);
      // Recolouring mid-match is allowed, so the local gloves follow too.
      this.player.arms.setInk(colorHexFor(session.localProfile.colorIndex));
    };

    session.onRemoteState = (peerId, s) => {
      this.remotes.applyState(peerId, s, performance.now() * 0.001);
    };

    session.onRemoteShot = (peerId, o, d, weapon) => this.replicateRemoteShot(peerId, o, d, weapon);

    session.onIncomingHit = (dmg, headshot, point, from, shooterId) =>
      this.applyIncomingHit(dmg, headshot, point, from, shooterId);

    session.onRemoteDeath = (peerId, killerId, headshot) =>
      this.handleRemoteDeath(peerId, killerId, headshot);

    session.onRemoteSpawn = (peerId, pos) => {
      const rp = this.remotes.get(peerId);
      if (!rp) return;
      rp.setDead(false);
      rp.setHealth(rp.maxHealth);
      rp.pushState(
        { p: [pos[0], pos[1], pos[2]], r: [0, 0], f: 0, w: 0, h: rp.maxHealth },
        performance.now() * 0.001
      );
      this.remotes.invalidateTargets();
    };

    session.onMatchStart = (cfg, startedAt) => {
      // The menu re-opens its drop-in gate here. That is deliberate on a
      // rematch: pointer lock was released for the leaderboard, and only a
      // fresh user gesture can take it back.
      menuMatchStart?.(cfg, startedAt);
      this.beginMatchRound();
    };
    session.onMatchEnd = (standings, reason) => {
      menuMatchEnd?.(standings, reason);
      const host = session.getPeer(session.hostId);
      this.mpHud.showEnd(standings, session.selfId, session.isHost, host?.name ?? '', reason);
      // Hand the mouse back so the leaderboard buttons are clickable.
      if (document.pointerLockElement) document.exitPointerLock();
    };

    this.beginMatchRound();
  }

  /** Resets the local player for the start of a round (or a rematch). */
  private beginMatchRound(): void {
    this.mpHud.hideEnd();
    this.mpHud.hideRespawn();
    this.totalScore = 0;
    this.respawnTimer = 0;
    this.deathReported = false;
    this.lastAttackerId = null;
    this.obStage = 4; // Onboarding hints have no place in a live deathmatch.
    this.hud.showHint('');
    this.hud.hideDeathScreen();
    this.respawnLocalPlayer();
  }

  /** Tears the session down and returns every subsystem to solo defaults. */
  public exitMultiplayer(): void {
    this.net?.leave();
    this.net = null;
    this.remotes.clear();
    this.mpHud.setActive(false);
    this.respawnTimer = 0;
    this.deathReported = false;
    this.lastAttackerId = null;
  }

  /** Places the local player at the safest free spawn and tells the room. */
  private respawnLocalPlayer(): void {
    const spawn = this.spawns?.pick(
      this.remotes.all.filter((r) => !r.isDead).map((r) => r.group.position)
    );

    // `reset` returns the player to the solo spawn and zeroes the camera, so
    // the deathmatch position and facing go on afterwards.
    this.player.reset();
    this.player.lookInit();
    if (spawn) this.player.physics.position.copy(spawn);
    // Facing north every single respawn makes spawns feel canned, and puts
    // everyone who spawns together looking the same way.
    this.player.yaw = Math.random() * Math.PI * 2;
    this.player.pitch = 0;

    this.deathReported = false;
    this.respawnTimer = 0;
    this.hud.hideDeathScreen();
    this.mpHud.hideRespawn();
    const p = this.player.position;
    this.net?.reportSpawn([p.x, p.y, p.z]);
  }

  /** Draws another player's gunshot: tracer from their muzzle plus report. */
  private replicateRemoteShot(peerId: string, o: number[], d: number[], weapon: string): void {
    const origin = this.tmpMuzzle.set(o[0], o[1], o[2]);
    this.tmpShotDir.set(d[0], d[1], d[2]);
    if (this.tmpShotDir.lengthSq() < 1e-6) return;
    this.tmpShotDir.normalize();

    const reach = weapon === 'sniper' ? 220 : 90;
    this.tmpEnd.copy(origin).addScaledVector(this.tmpShotDir, reach);

    // A tracer in the shooter's own ink makes a firefight instantly readable:
    // you can tell who is shooting at you from the colour of the streak.
    const rp = this.remotes.get(peerId);
    this.tmpTracerColor.setHex(colorHexFor(rp?.colorIndex ?? 0));
    this.particles.spawnTracer(origin, this.tmpEnd, this.tmpTracerColor, weapon === 'sniper' ? 0.05 : 0.03);
    this.particles.spawnMuzzleSparks(origin, this.tmpShotDir, weapon === 'sniper' ? 10 : 6, 0xf5c542);
  }

  /**
   * Somebody says they shot us. We are authoritative over our own health, so
   * this is where a remote hit actually costs something — and where our own
   * death gets announced back to the room.
   */
  private applyIncomingHit(
    dmg: number,
    headshot: boolean,
    point: number[],
    from: number[],
    shooterId: string
  ): void {
    if (this.player.isDead || !this.isRunning) return;

    // Everything below comes off the wire from a peer we do not control, and
    // `Player.takeDamage` has no upper clamp: negative damage would heal us
    // past maximum and a NaN would make health NaN, at which point `health <= 0`
    // is never true and we could never die again. Sanitising belongs here at
    // the boundary rather than in the shared solo/AI damage path.
    if (!Number.isFinite(dmg) || dmg <= 0) return;
    const damage = Math.min(dmg, Game.MAX_INCOMING_DAMAGE);

    const fx = Number.isFinite(from[0]) ? from[0] : this.player.position.x;
    const fy = Number.isFinite(from[1]) ? from[1] : this.player.position.y;
    const fz = Number.isFinite(from[2]) ? from[2] : this.player.position.z;

    const attackerPos = this.tmpStatePos.set(fx, fy, fz);
    const applied = this.player.takeDamage(damage, attackerPos);
    if (!applied) return; // Absorbed by i-frames.

    this.lastAttackerId = shooterId;
    this.lastAttackerAt = performance.now();

    this.hud.noteDamageFrom(attackerPos);
    const px = Number.isFinite(point[0]) ? point[0] : attackerPos.x;
    const py = Number.isFinite(point[1]) ? point[1] : attackerPos.y;
    const pz = Number.isFinite(point[2]) ? point[2] : attackerPos.z;
    this.particles.spawnBlood(
      new THREE.Vector3(px, py, pz),
      this.tmpShotDir.set(0, 1, 0),
      headshot ? 1.8 : 1.0,
      headshot
    );

    if (this.player.isDead) this.reportLocalDeath();
  }

  private reportLocalDeath(): void {
    if (this.deathReported || !this.net) return;
    this.deathReported = true;
    // A hit from more than a few seconds ago is not a kill credit; that is a
    // fall or an old wound finishing the job.
    const fresh = performance.now() - this.lastAttackerAt < 6000;
    const killer = fresh ? this.lastAttackerId : null;
    this.respawnTimer = RESPAWN_SECONDS;
    this.net.reportDeath(killer, false);

    const killerName = killer ? this.net.getPeer(killer)?.name ?? null : null;
    this.mpHud.pushKill({
      killerName: killerName ?? 'THE CITY',
      killerColor: killer ? this.net.getPeer(killer)?.colorIndex ?? 0 : 5,
      victimName: this.net.getPeer(this.net.selfId)?.name ?? 'YOU',
      victimColor: this.net.getPeer(this.net.selfId)?.colorIndex ?? 0,
      headshot: false,
      involvesSelf: true,
    });
  }

  private handleRemoteDeath(peerId: string, killerId: string | null, headshot: boolean): void {
    const net = this.net;
    if (!net) return;

    this.remotes.setDead(peerId, true);

    const victim = net.getPeer(peerId);
    const killer = killerId ? net.getPeer(killerId) : null;

    this.mpHud.pushKill({
      killerName: killer?.name ?? 'THE CITY',
      killerColor: killer?.colorIndex ?? 5,
      victimName: victim?.name ?? 'SOMEONE',
      victimColor: victim?.colorIndex ?? 0,
      headshot,
      involvesSelf: killerId === net.selfId || peerId === net.selfId,
    });

    if (killerId === net.selfId) {
      const bonus = headshot ? 250 : 100;
      this.totalScore += bonus;
      this.player.addScreenShake(0.1);
      this.triggerHitstop(0.06, 0.14);
      soundManager.playKillStreak(1);
      this.hud.showScorePopup(
        headshot ? `HEADSHOT · ${victim?.name ?? ''}` : `ERASED ${victim?.name ?? ''}`,
        bonus,
        headshot ? '#d63031' : '#152778'
      );
    }
  }

  /**
   * We shot another player. Everything here is local feedback plus one packet
   * to the victim; their health is theirs to decide, so we never claim a kill,
   * we only predict one for the hitmarker's benefit.
   */
  private handlePvpHit(
    hit: { target: import('../net/RemotePlayer').RemotePlayer; damage: number; isHeadshot: boolean; point: THREE.Vector3 },
    weaponType: string,
    tracerColor: THREE.Color,
    tracerThickness: number
  ): void {
    const { target, damage, isHeadshot, point } = hit;

    if (weaponType !== 'sword') {
      this.particles.spawnTracer(this.tmpMuzzle, point, tracerColor, tracerThickness);
    }

    const dir = this.tmpShotDir.subVectors(point, this.player.camera.position);
    if (dir.lengthSq() > 1e-6) dir.normalize();
    else dir.set(0, 0, -1);

    this.particles.spawnBlood(
      point,
      dir,
      Math.max(0.6, Math.min(2.5, damage / 45)) * (isHeadshot ? 1.6 : 1),
      isHeadshot
    );
    target.flashHit();

    // Predicted health drives only the floating bar and the hitmarker's "kill"
    // flourish. The authoritative death arrives as a `died` broadcast.
    const predicted = target.health - damage;
    target.setHealth(predicted);
    const likelyKill = predicted <= 0;

    this.hud.triggerHitmarker(isHeadshot, likelyKill);

    if (weaponType === 'sword') {
      soundManager.playKatanaHit();
      this.player.addScreenShake(0.12);
      this.triggerHitstop(0.07, 0.12);
    } else {
      soundManager.playHitMarker(isHeadshot);
      this.player.addScreenShake(isHeadshot ? 0.08 : 0.03);
      if (isHeadshot) this.triggerHitstop(0.05, 0.15);
    }

    const p = this.player.position;
    this.net?.reportHit(target.id, damage, isHeadshot, [point.x, point.y, point.z], [p.x, p.y, p.z]);
  }

  /** Per-frame multiplayer work: interpolate peers, broadcast, refresh the HUD. */
  private updateMultiplayer(dt: number): void {
    const net = this.net;
    if (!net) return;

    net.tick();
    this.remotes.update(dt, performance.now() * 0.001, this.camera);
    this.broadcastState(dt);

    // The kill feed fades continuously, so it gets every frame.
    this.mpHud.update();

    // The readouts do not. The clock ticks in whole seconds and the scoreboard
    // rebuilds its rows from scratch, so refreshing either at frame rate would
    // burn a DOM rebuild per frame for information that cannot have changed.
    this.hudRefreshTimer -= dt;
    if (this.hudRefreshTimer > 0) return;
    this.hudRefreshTimer = Game.HUD_REFRESH_INTERVAL;

    const roster = net.roster;
    let leader = 0;
    for (const p of roster) if (p.kills > leader) leader = p.kills;
    this.mpHud.updateStatus(leader, net.config.killLimit, net.secondsRemaining(), roster.length);
    this.mpHud.renderScoreboard(roster, net.hostId);
  }

  /** Broadcasts our transform at a fixed rate, independent of frame rate. */
  private broadcastState(dt: number): void {
    const net = this.net;
    if (!net || net.phase !== 'playing') return;

    this.stateTimer += dt;
    const interval = 1 / STATE_HZ;
    if (this.stateTimer < interval) return;
    this.stateTimer = 0;

    let flags = 0;
    if (this.player.isSwinging) flags |= FLAG_SWINGING;
    if (this.player.isCrouching) flags |= FLAG_CROUCHING;
    if (this.player.isSprinting) flags |= FLAG_SPRINTING;
    if (this.player.isDead) flags |= FLAG_DEAD;
    if (this.player.physics.isGrounded) flags |= FLAG_GROUNDED;

    const p = this.player.position;
    const packet: StatePacket = {
      p: [round2(p.x), round2(p.y), round2(p.z)],
      r: [round3(this.player.yaw), round3(this.player.pitch)],
      f: flags,
      w: this.player.weaponManager.activeIndex,
      h: Math.round(this.player.health),
    };

    const anchor = this.player.physics.webAnchor;
    if (this.player.isSwinging && anchor) {
      packet.a = [round2(anchor.x), round2(anchor.y), round2(anchor.z)];
    }

    net.reportState(packet);
  }

  /** Death handling while a deathmatch is live: count down, then redraw. */
  private updateDeathmatchDead(dt: number): void {
    const net = this.net;
    if (!net) return;

    // The world must keep running while you are down: rivals move, ink dries,
    // and your own last transform keeps flowing out flagged as dead.
    InkShaderMaterial.update(dt);
    this.cityBuilder.update(dt);
    this.particles.update(dt);
    this.hud.update(
      dt,
      this.player,
      this.totalScore,
      0,
      0,
      null,
      this.buildExtras()
    );

    if (!this.deathReported) this.reportLocalDeath();

    if (net.phase !== 'playing') {
      // The match ended while we were down. The leaderboard owns the screen now.
      this.mpHud.hideRespawn();
      return;
    }

    this.respawnTimer -= dt;
    const killerName = this.lastAttackerId ? net.getPeer(this.lastAttackerId)?.name ?? null : null;
    this.mpHud.showRespawn(this.respawnTimer, killerName);

    if (this.respawnTimer <= 0) {
      this.respawnLocalPlayer();
    }
  }

  public start(): void {
    // From here on a click on the canvas may recapture the mouse. Until now it
    // must not: the menu is a DOM overlay and the player needs a cursor.
    this.input.pointerLockOnClick = true;
    if (this.isRunning) {
      // Re-lock flow after ESC pause
      this.input.requestPointerLock();
      this.lastTime = performance.now();
      if (typeof document !== 'undefined') document.body.classList.add('in-game');
      return;
    }
    this.isRunning = true;
    this.lastTime = performance.now();
    if (typeof document !== 'undefined') document.body.classList.add('in-game');

    // Deathmatch has no AI waves: every hostile in the city is another player.
    if (!this.isMultiplayer) {
      this.enemyManager.startNextWave(this.player.health);
    }

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
      let dt = Math.min((now - this.lastTime) * 0.001, 0.05);
      this.lastTime = now;

      // Hitstop time dilation on heavy impacts
      if (this.hitstopTimer > 0) {
        this.hitstopTimer -= dt;
        dt *= this.hitstopScale;
      }

      // Pause simulation when pointer unlocked (ESC) — still render + HUD
      const locked = this.input.isPlaying;
      if (!locked && this.wasLocked) {
        soundManager.updateWind(0, 45);
      }
      this.wasLocked = locked;

      if (locked && !this.player.isDead) {
        this.update(dt);
      } else if (this.player.isDead) {
        if (this.isMultiplayer) {
          this.updateDeathmatchDead(dt);
        } else {
          this.updateDead(dt);
        }
      } else {
        InkShaderMaterial.update(dt);
        this.cityBuilder.update(dt * 0.25);
        this.particles.update(dt);
      }

      // Networking runs on EVERY branch, including the paused one. A player on
      // the escape menu still has to broadcast, or the rest of the room watches
      // them freeze in place and eventually times them out.
      if (this.isMultiplayer) this.updateMultiplayer(dt);

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
    if (this.isMultiplayer) {
      const rivals = this.remotes.getRaycastTargets();
      for (let i = 0; i < rivals.length; i++) this.combatTargets.push(rivals[i]);
    }
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
    // In deathmatch the only things worth tracking are the other players.
    if (this.isMultiplayer) {
      for (const rp of this.remotes.all) {
        if (rp.isDead) continue;
        const css = `#${colorHexFor(rp.colorIndex).toString(16).padStart(6, '0')}`;
        list.push({ x: rp.group.position.x, z: rp.group.position.z, kind: `player:${css}` });
      }
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
      const wep = fireResult.weapon ?? this.player.weaponManager.activeWeapon;

      if (wep.type === 'sword') {
        // Sword / Katana dynamic slash arc and haptic rumble
        this.player.camera.getWorldDirection(this.tmpLook);
        this.tmpRight.crossVectors(this.tmpLook, Game.UP_VEC).normalize();
        this.particles.spawnSlashArc(
          this.player.camera.position,
          this.tmpLook,
          this.tmpRight,
          (wep as any).combo ?? 0
        );
        this.input.rumble(0.65, 0.45, 90);
      } else {
        // Muzzle sparks and smoke at barrel crown (converged aim still comes from camera)
        wep.muzzleTip.getWorldPosition(this.tmpMuzzle);
        this.particles.spawnMuzzleSparks(
          this.tmpMuzzle,
          fireResult.ray.direction,
          wep.type === 'sniper' ? 14 : (wep.type === 'smg' ? 6 : 9),
          wep.flashColorHex
        );
        this.particles.spawnMuzzleSmoke(
          this.tmpMuzzle,
          fireResult.ray.direction,
          wep.type === 'sniper' ? 5 : 2
        );

        // Gamepad haptic rumble on gunshot
        this.input.rumble(
          wep.type === 'sniper' ? 0.75 : (wep.type === 'smg' ? 0.25 : 0.45),
          0.5,
          wep.type === 'sniper' ? 140 : 60
        );
      }

      const tracerThickness = wep.tracerThickness;
      const tracerColor = wep.tracerColor;

      // Let the room see and hear the shot, whatever it went on to hit.
      if (this.isMultiplayer && wep.type !== 'sword') {
        const d = fireResult.ray.direction;
        this.net?.reportShot(
          [this.tmpMuzzle.x, this.tmpMuzzle.y, this.tmpMuzzle.z],
          [d.x, d.y, d.z],
          wep.type
        );
      }

      // PvP takes precedence over PvE: a bullet resolves against a person
      // before it is offered to the (empty, in deathmatch) AI roster.
      const pvpHit = this.isMultiplayer ? this.remotes.resolveHit(fireResult) : null;

      const hitReport = pvpHit
        ? null
        : this.enemyManager.checkBulletHits(fireResult, this.player.isSwinging, this.player.position);

      if (pvpHit) {
        this.handlePvpHit(pvpHit, wep.type, tracerColor, tracerThickness);
      } else if (hitReport) {
        // Bold 3D tracer to flesh so gunshot hits read clearly
        if (wep.type !== 'sword' && fireResult.point) {
          this.particles.spawnTracer(this.tmpMuzzle, fireResult.point, tracerColor, tracerThickness);
        }
        this.hud.triggerHitmarker(hitReport.isHeadshot, hitReport.killed);

        // Kinetic impact: screen shake & crunchy hitstop on crits / kills
        if (wep.type === 'sword') {
          soundManager.playKatanaHit();
          this.player.addScreenShake(0.12);
          this.triggerHitstop(0.07, 0.12);
        } else {
          soundManager.playHitMarker(hitReport.isHeadshot);
          if (hitReport.isHeadshot) {
            this.player.addScreenShake(0.08);
            this.triggerHitstop(0.05, 0.15);
          } else {
            this.player.addScreenShake(0.03);
          }
        }

        if (hitReport.killed && hitReport.killEvent) {
          this.player.addScreenShake(0.14);
          this.triggerHitstop(0.07, 0.12);
          const k = hitReport.killEvent;
          this.totalScore += k.scoreAwarded;
          soundManager.playKillStreak(k.killStreak);

          let tag = hitReport.isHeadshot ? 'HEADSHOT' : 'INK ERASURE';
          if (wep.type === 'sword') {
            tag = k.isSwinging ? 'AERIAL SLICE' : 'SLICED';
          } else if (k.isSwinging) {
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
        this.player.addScreenShake(wep.type === 'sword' ? 0.04 : 0.02);
        soundManager.playImpactWall();
        if (wep.type !== 'sword') {
          this.particles.spawnTracer(this.tmpMuzzle, fireResult.point, tracerColor, tracerThickness);
        }
      } else if (wep.type !== 'sword') {
        this.tmpEnd.copy(fireResult.ray.origin).addScaledVector(fireResult.ray.direction, 80);
        this.particles.spawnTracer(this.tmpMuzzle, this.tmpEnd, tracerColor, tracerThickness);
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
    this.updateOnboarding(webTarget);
    this.hud.update(
      dt,
      this.player,
      this.totalScore,
      this.enemyManager.currentWave,
      this.enemyManager.enemiesLeft,
      webTarget,
      this.buildExtras()
    );

    // In deathmatch, dying is a three-second inconvenience, not a run ending:
    // the respawn countdown owns that moment instead of the death screen.
    if (this.player.isDead && !this.isMultiplayer) {
      this.hud.showDeathScreen(this.totalScore, this.enemyManager.lastPlayerDeath);
    }
  }

  /**
   * Onboarding beats on wave 1 only: movement, then web-swinging. State triggers,
   * never timers; wave 2 dismisses instantly. Combat is left for the player to find.
   */
  private updateOnboarding(webTarget: { isValid: boolean } | null): void {
    if (this.obStage >= 4 || this.enemyManager.currentWave > 1) {
      if (this.obStage < 4) {
        this.obStage = 4;
        this.hud.showHint('');
      }
      return;
    }
    const keys = this.input.keys;
    switch (this.obStage) {
      case 0:
        this.hud.showHint('WASD WALK · MOUSE LOOK');
        if (keys['w'] || keys['a'] || keys['s'] || keys['d']) this.obStage = 1;
        break;
      case 1:
        if (this.player.isSwinging) {
          this.obSwung = true;
          this.obStage = 2;
        } else if (!this.physicsGrounded() && webTarget && webTarget.isValid) {
          this.hud.showHint('TAP E TO GRAB A WEB');
        } else {
          this.hud.showHint('JUMP, THEN TAP E TO WEB-SWING');
        }
        break;
      case 2:
        this.hud.showHint('HOLD E TO WINCH IN · TAP E TO RE-GRAB');
        if (this.obSwung && !this.player.isSwinging) {
          this.obStage = 4;
          this.hud.showHint('');
        }
        break;
      default:
        this.hud.showHint('');
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
    // Back to a cursor-driven menu: clicks must stop grabbing the pointer.
    this.input.pointerLockOnClick = false;
    if (typeof document !== 'undefined') document.body.classList.remove('in-game');
    // Quitting from the pause menu must also drop the room, or the player
    // stays a silent ghost in everyone else's match.
    if (this.isMultiplayer) this.exitMultiplayer();
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
    if (modal && !this.suppressInstructionsOnReset) {
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

/** Two decimals is plenty for a position and keeps packets small. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Three decimals on an angle is well below what anyone can perceive. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
