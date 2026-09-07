import * as THREE from 'three';
import { Player } from '../player/Player';
import { WebTargetInfo } from '../player/WebShooter';
import { Sniper } from '../weapons/Sniper';
import { Minimap, MapBuilding, MapEnemy } from './Minimap';
import { SettingsData } from '../core/Settings';

export interface HudExtras {
  yaw: number;
  px: number;
  pz: number;
  enemies: MapEnemy[];
  buildings: MapBuilding[];
}

export interface ScorePopup {
  text: string;
  points: number;
  timer: number;
  maxTimer: number;
  yOffset: number;
  color: string;
}

export class HUD {
  private container: HTMLDivElement;
  private scorePopups: ScorePopup[] = [];
  
  // HUD DOM Elements
  private scoreElement!: HTMLElement;
  private waveElement!: HTMLElement;
  private enemiesLeftElement!: HTMLElement;
  private hpNumberElement!: HTMLElement;
  private hpBarCrosshatch!: HTMLElement;
  private ammoElement!: HTMLElement;
  private ammoBarFill!: HTMLElement;
  private weaponListElement!: HTMLElement;
  private activeWeaponNameElement!: HTMLElement;
  private activeWeaponDescElement!: HTMLElement;
  private swingStatusElement!: HTMLElement;
  private speedLinesElement!: HTMLElement;
  private damageVignetteElement!: HTMLElement;
  private scopeOverlayElement!: HTMLElement;
  private webReticleElement!: HTMLElement;
  private centerCrosshairElement!: HTMLElement;
  private spreadRingElement!: HTMLElement;
  private chTickTop!: HTMLElement;
  private chTickBottom!: HTMLElement;
  private chTickLeft!: HTMLElement;
  private chTickRight!: HTMLElement;
  private hitmarkerElement!: HTMLElement;
  private popupContainerElement!: HTMLElement;
  private announcementElement!: HTMLElement;
  private announcementCompElement!: HTMLElement;
  private reloadBarBox!: HTMLElement;
  private reloadBarFill!: HTMLElement;

  private hitmarkerTimer: number = 0;
  private announcementTimer: number = 0;
  private lastAmmoText: string = '';
  private lastScoreText: string = '';
  private lastWaveText: string = '';
  private lastPreviewText: string = '';
  private lastHp: number = 100;
  private healFlashTimer: number = 0;

  // Minimap + directional damage state
  private minimap: Minimap | null = null;
  private minimapBuildingsRef: MapBuilding[] | null = null;
  private dmgArcG: SVGGElement | null = null;
  private dmgEdgeT: HTMLElement | null = null;
  private dmgEdgeB: HTMLElement | null = null;
  private dmgEdgeL: HTMLElement | null = null;
  private dmgEdgeR: HTMLElement | null = null;
  private wavePreviewEl: HTMLElement | null = null;
  private lastDmgX: number = 0;
  private lastDmgZ: number = 0;
  private lastDmgAt: number = -10;

  constructor(private settings: SettingsData) {
    this.container = document.createElement('div');
    this.container.id = 'hud-container';
    document.body.appendChild(this.container);
    this.buildDOM();
    this.wirePauseMenu();
  }

  // Pause / settings callbacks (wired by Game, HUD never imports Game)
  public onResumeRequest?: () => void;
  public onRestartRequest?: () => void;
  public onQuitRequest?: () => void;
  public onSettingsChanged?: (s: SettingsData) => void;

  private buildDOM(): void {
    this.container.innerHTML = `
      <!-- High Speed Vignette Lines -->
      <div id="speed-lines" class="speed-lines-overlay"></div>

      <!-- Damage Vignette -->
      <div id="damage-vignette" class="damage-vignette-overlay"></div>

      <!-- Full-Screen Sniper Scope Overlay -->
      <div id="scope-overlay" class="scope-overlay">
        <img src="/textures/sniper_reticle.png" alt="Sniper Scope" class="scope-reticle-img" />
        <div class="scope-blueprint-text">MAG: 3.5X · RANGEFINDER STADIAMETRIC · BLUEPRINT SCOPE</div>
      </div>

      <!-- Top Left: Score -->
      <div class="hud-top-left">
        <div class="hud-label">SCORE</div>
        <div id="hud-score" class="hud-value-large">0</div>
      </div>

      <!-- Top Right: Wave and Enemies Left -->
      <div class="hud-top-right">
        <div id="hud-wave" class="hud-wave-title">WAVE —</div>
        <div id="hud-enemies-left" class="hud-enemies-count">press PLAY</div>
        <div id="wave-preview" class="wave-preview"></div>
      </div>

      <!-- Floating Score Popups (YANKED, HEADSHOT, etc.) -->
      <div id="popup-container" class="popup-container"></div>

      <!-- Center Crosshair & Web Anchor Reticle -->
      <div class="center-hud-anchor">
        <svg id="dmg-ring" viewBox="0 0 100 100" width="140" height="140">
          <g id="dmg-arc-g" opacity="0">
            <path d="M 31 17.1 A 38 38 0 0 1 69 17.1" fill="none" stroke="#d63031" stroke-width="7" stroke-linecap="round"/>
          </g>
        </svg>
        <div id="spread-ring" class="spread-ring"></div>
        <div id="center-crosshair" class="crosshair-default">
          <div class="ch-dot"></div>
          <div class="ch-tick ch-top"></div>
          <div class="ch-tick ch-bottom"></div>
          <div class="ch-tick ch-left"></div>
          <div class="ch-tick ch-right"></div>
        </div>
        <div id="web-reticle" class="web-anchor-reticle">
          <div class="reticle-bracket-l">[</div>
          <div class="reticle-core">+</div>
          <div class="reticle-dist">45m</div>
          <div class="reticle-bracket-r">]</div>
        </div>
        <div id="hitmarker" class="hitmarker-ink"><span class="hm-a"></span><span class="hm-b"></span></div>
      </div>

      <!-- Bottom Left: Health & Ammo with Tally Marks -->
      <div class="hud-bottom-left">
        <div class="hp-container">
          <span class="hp-label">HP</span>
          <div class="hp-bar-box">
            <div id="hp-bar-hatch" class="hp-bar-fill"></div>
          </div>
          <span id="hp-number" class="hp-number-text">100</span>
        </div>
        <div class="ammo-container">
          <div id="ammo-numbers" class="ammo-numbers-text">12<span class="ammo-sub">/60</span></div>
          <div id="ammo-bar-box" class="ammo-bar-box">
            <div id="ammo-bar-fill" class="ammo-bar-fill"></div>
          </div>
          <div id="reload-bar-box" class="reload-bar-box" style="display:none">
            <div id="reload-bar-fill" class="reload-bar-fill"></div>
          </div>
        </div>
      </div>

      <!-- Bottom Right: Weapons Drawer & Swing Status -->
      <div class="hud-bottom-right">
        <div id="weapon-list" class="weapon-list-box">
          <div class="wep-row wep-active" data-idx="0">[1] SWORD <span class="wep-ammo">∞</span></div>
          <div class="wep-row" data-idx="1">[2] PISTOL <span class="wep-ammo">12/60</span></div>
          <div class="wep-row" data-idx="2">[3] RIFLE <span class="wep-ammo">32/160</span></div>
          <div class="wep-row" data-idx="3">[4] SNIPER <span class="wep-ammo">5/25</span></div>
        </div>
        <div id="active-wep-name" class="active-wep-title">SWORD</div>
        <div id="active-wep-desc" class="active-wep-desc">forged ink katana · quick slash combo · block to guard · aerial slice enabled</div>
        <div id="swing-status" class="swing-status-badge">GROUND / AERIAL READY</div>
      </div>

      <!-- Wave Announcement / Big Text Banner -->
      <div id="hud-announcement" class="hud-announcement-banner">
        <div class="announcement-title">WAVE 1</div>
        <div class="announcement-subtitle">INK INVASION BEGINS</div>
        <div class="announcement-comp"></div>
      </div>

      <!-- Bottom-center minimap -->
      <div id="minimap-wrap" class="minimap-wrap">
        <canvas id="minimap" width="168" height="168"></canvas>
        <div class="minimap-n">N</div>
      </div>

      <!-- Directional damage edge glows -->
      <div id="dmg-edge-t" class="dmg-edge dmg-t"></div>
      <div id="dmg-edge-b" class="dmg-edge dmg-b"></div>
      <div id="dmg-edge-l" class="dmg-edge dmg-l"></div>
      <div id="dmg-edge-r" class="dmg-edge dmg-r"></div>

      <!-- Build stamp: proves which server run this client came from -->
      <div id="build-stamp" class="build-stamp"></div>

      <!-- Onboarding hint (one at a time, bottom-center) -->
      <div id="hint-bar" class="hint-bar"></div>

      <!-- Debug Toggles Overlay (7/8/9/0) -->
      <div id="debug-overlay" class="debug-overlay" style="display:none"></div>

      <!-- Pause menu + settings -->
      <div id="pause-menu" class="pause-menu" style="display:none">
        <div class="pause-card">
          <div class="pause-title">PAUSED</div>
          <div class="pause-sub">the sketch waits for no one (except now)</div>
          <button id="resume-btn" class="play-prompt-btn pause-btn">RESUME</button>
          <button id="restart-btn" class="play-prompt-btn pause-btn pause-btn-red">RESTART</button>
          <button id="quit-btn" class="play-prompt-btn pause-btn pause-btn-quit">QUIT TO MENU</button>
          <label class="pause-row">SENSITIVITY <input id="set-sens" type="range" min="0.5" max="2" step="0.05"><span id="set-sens-v"></span></label>
          <div class="pause-note">Default 0.80x tuned for trackpads · adjust for mouse</div>
          <label class="pause-row">QUALITY
            <select id="set-quality" class="pause-select">
              <option value="high">HIGH (DPR 2, 800 FX)</option>
              <option value="low">LOW (DPR 1, 400 FX)</option>
            </select>
          </label>
          <label class="pause-row">VOLUME <input id="set-vol" type="range" min="0" max="1" step="0.05"><span id="set-vol-v"></span></label>
          <label class="pause-row">FOV <input id="set-fov" type="range" min="70" max="90" step="1"><span id="set-fov-v"></span></label>
          <label class="pause-row pause-check"><input id="set-map" type="checkbox"> MINIMAP (N)</label>
          <div class="pause-keys">WASD walk · SPACE jump · SHIFT sprint · C crouch (duck behind rails: covered, but you can't shoot) · E tap web / hold winch · F zip · Q aim · R reload · M mute</div>
        </div>
      </div>
    `;

    // Cache elements safely from this.container
    this.scoreElement = this.container.querySelector('#hud-score')!;
    this.waveElement = this.container.querySelector('#hud-wave')!;
    this.enemiesLeftElement = this.container.querySelector('#hud-enemies-left')!;
    this.hpNumberElement = this.container.querySelector('#hp-number')!;
    this.hpBarCrosshatch = this.container.querySelector('#hp-bar-hatch')!;
    this.ammoElement = this.container.querySelector('#ammo-numbers')!;
    this.ammoBarFill = this.container.querySelector('#ammo-bar-fill')!;
    this.reloadBarBox = this.container.querySelector('#reload-bar-box')!;
    this.reloadBarFill = this.container.querySelector('#reload-bar-fill')!;
    this.weaponListElement = this.container.querySelector('#weapon-list')!;
    this.activeWeaponNameElement = this.container.querySelector('#active-wep-name')!;
    this.activeWeaponDescElement = this.container.querySelector('#active-wep-desc')!;
    this.swingStatusElement = this.container.querySelector('#swing-status')!;
    this.speedLinesElement = this.container.querySelector('#speed-lines')!;
    this.damageVignetteElement = this.container.querySelector('#damage-vignette')!;
    this.scopeOverlayElement = this.container.querySelector('#scope-overlay')!;
    this.webReticleElement = this.container.querySelector('#web-reticle')!;
    this.centerCrosshairElement = this.container.querySelector('#center-crosshair')!;
    this.spreadRingElement = this.container.querySelector('#spread-ring')!;
    this.chTickTop = this.container.querySelector('.ch-top')!;
    this.chTickBottom = this.container.querySelector('.ch-bottom')!;
    this.chTickLeft = this.container.querySelector('.ch-left')!;
    this.chTickRight = this.container.querySelector('.ch-right')!;
    this.hitmarkerElement = this.container.querySelector('#hitmarker')!;
    this.popupContainerElement = this.container.querySelector('#popup-container')!;
    this.announcementElement = this.container.querySelector('#hud-announcement')!;
    this.announcementCompElement = this.container.querySelector('.announcement-comp')!;
    this.wavePreviewEl = this.container.querySelector('#wave-preview');
    this.dmgArcG = this.container.querySelector('#dmg-arc-g') as unknown as SVGGElement;
    this.dmgEdgeT = this.container.querySelector('#dmg-edge-t');
    this.dmgEdgeB = this.container.querySelector('#dmg-edge-b');
    this.dmgEdgeL = this.container.querySelector('#dmg-edge-l');
    this.dmgEdgeR = this.container.querySelector('#dmg-edge-r');
    const mapCanvas = this.container.querySelector('#minimap') as HTMLCanvasElement | null;
    if (mapCanvas) this.minimap = new Minimap(mapCanvas);
    const stamp = this.container.querySelector('#build-stamp');
    if (stamp) stamp.textContent = 'build ' + __BUILD_ID__;
    console.log('%c spidey build ' + __BUILD_ID__, 'color:#152778;font-weight:bold');
    this.pauseMenuEl = this.container.querySelector('#pause-menu');
    this.hintBarEl = this.container.querySelector('#hint-bar');
    this.debugOverlayEl = this.container.querySelector('#debug-overlay');
  }

  private pauseMenuEl: HTMLElement | null = null;
  private hintBarEl: HTMLElement | null = null;
  private debugOverlayEl: HTMLElement | null = null;
  private lastHintText: string = '__none__';

  private wirePauseMenu(): void {
    const menu = this.container.querySelector('#pause-menu');
    if (menu) menu.addEventListener('click', (e) => {
      // Clicking the backdrop (not buttons/sliders) resumes instantly
      if ((e.target as HTMLElement).id === 'pause-menu' && this.onResumeRequest) {
        this.onResumeRequest();
      }
    });
    const resume = this.container.querySelector('#resume-btn');
    if (resume) resume.addEventListener('click', (e) => { e.stopPropagation(); if (this.onResumeRequest) this.onResumeRequest(); });
    const restart = this.container.querySelector('#restart-btn');
    if (restart) restart.addEventListener('click', (e) => { e.stopPropagation(); if (this.onRestartRequest) this.onRestartRequest(); });
    const quit = this.container.querySelector('#quit-btn');
    if (quit) quit.addEventListener('click', (e) => { e.stopPropagation(); if (this.onQuitRequest) this.onQuitRequest(); });

    const sens = this.container.querySelector('#set-sens') as HTMLInputElement | null;
    const vol = this.container.querySelector('#set-vol') as HTMLInputElement | null;
    const fov = this.container.querySelector('#set-fov') as HTMLInputElement | null;
    const map = this.container.querySelector('#set-map') as HTMLInputElement | null;
    const qual = this.container.querySelector('#set-quality') as HTMLSelectElement | null;
    const modalSens = document.querySelector('#modal-sens') as HTMLInputElement | null;
    const modalMute = document.querySelector('#modal-mute') as HTMLInputElement | null;

    if (sens) sens.value = String(this.settings.sensitivity);
    if (vol) vol.value = String(this.settings.volume);
    if (fov) fov.value = String(this.settings.fov);
    if (map) map.checked = this.settings.minimap;
    if (qual) qual.value = this.settings.quality;
    if (modalSens) modalSens.value = String(this.settings.sensitivity);
    if (modalMute) modalMute.checked = this.settings.muted;
    this.refreshSettingLabels();

    const emit = () => {
      if (sens) this.settings.sensitivity = parseFloat(sens.value);
      if (vol) this.settings.volume = parseFloat(vol.value);
      if (fov) this.settings.fov = parseInt(fov.value, 10);
      if (map) this.settings.minimap = map.checked;
      if (qual) this.settings.quality = qual.value === 'low' ? 'low' : 'high';
      if (modalSens) modalSens.value = String(this.settings.sensitivity);
      this.refreshSettingLabels();
      if (this.onSettingsChanged) this.onSettingsChanged({ ...this.settings });
    };

    for (const el of [sens, vol, fov, map]) {
      if (el) el.addEventListener('input', emit);
    }
    if (qual) qual.addEventListener('change', emit);

    if (modalSens) {
      modalSens.addEventListener('input', () => {
        this.settings.sensitivity = parseFloat(modalSens.value);
        if (sens) sens.value = String(this.settings.sensitivity);
        this.refreshSettingLabels();
        if (this.onSettingsChanged) this.onSettingsChanged({ ...this.settings });
      });
    }

    if (modalMute) {
      modalMute.addEventListener('change', () => {
        this.settings.muted = modalMute.checked;
        this.refreshSettingLabels();
        if (this.onSettingsChanged) this.onSettingsChanged({ ...this.settings });
      });
    }
  }

  public syncSettings(s: SettingsData): void {
    this.settings = { ...s };
    const sens = this.container.querySelector('#set-sens') as HTMLInputElement | null;
    const vol = this.container.querySelector('#set-vol') as HTMLInputElement | null;
    const fov = this.container.querySelector('#set-fov') as HTMLInputElement | null;
    const map = this.container.querySelector('#set-map') as HTMLInputElement | null;
    const qual = this.container.querySelector('#set-quality') as HTMLSelectElement | null;
    if (sens) sens.value = String(this.settings.sensitivity);
    if (vol) vol.value = String(this.settings.volume);
    if (fov) fov.value = String(this.settings.fov);
    if (map) map.checked = this.settings.minimap;
    if (qual) qual.value = this.settings.quality;

    const modalSens = document.querySelector('#modal-sens') as HTMLInputElement | null;
    const modalMute = document.querySelector('#modal-mute') as HTMLInputElement | null;
    if (modalSens) modalSens.value = String(this.settings.sensitivity);
    if (modalMute) modalMute.checked = this.settings.muted;

    this.refreshSettingLabels();
  }

  private refreshSettingLabels(): void {
    const set = (id: string, text: string) => {
      const el = this.container.querySelector(id) || document.querySelector(id);
      if (el) el.textContent = text;
    };
    set('#set-sens-v', this.settings.sensitivity.toFixed(2) + 'x');
    set('#modal-sens-v', this.settings.sensitivity.toFixed(2) + 'x');
    set('#set-vol-v', Math.round(this.settings.volume * 100) + '%');
    set('#set-fov-v', String(Math.round(this.settings.fov)));
  }

  public setPaused(v: boolean): void {
    if (this.pauseMenuEl) this.pauseMenuEl.style.display = v ? 'flex' : 'none';
    if (!v) return;
    this.refreshSettingLabels();
  }

  /** Single onboarding hint line. Empty string hides. Cached against DOM churn. */
  public showHint(text: string): void {
    if (text === this.lastHintText) return;
    this.lastHintText = text;
    if (!this.hintBarEl) return;
    this.hintBarEl.textContent = text;
    this.hintBarEl.style.display = text.length > 0 ? 'block' : 'none';
  }

  public showScorePopup(text: string, points: number, color: string = '#152778'): void {
    while (this.scorePopups.length >= 4) {
      this.scorePopups.shift();
    }
    this.scorePopups.push({
      text,
      points,
      timer: 0,
      maxTimer: 1.6,
      yOffset: 0,
      color
    });
  }

  public triggerHitmarker(isHeadshot: boolean = false, killed: boolean = false): void {
    const el = this.hitmarkerElement;
    if (!el) return;
    this.hitmarkerTimer = killed ? 0.5 : 0.18;
    el.classList.remove('show', 'headshot', 'kill');
    // Force reflow to re-trigger the pop keyframes on rapid hits
    void el.offsetWidth;
    el.classList.add('show');
    if (killed) el.classList.add('kill');
    else if (isHeadshot) el.classList.add('headshot');
  }

  public showWaveAnnouncement(
    waveNum: number,
    subtitle: string = 'ELIMINATE ALL INK HOSTILES',
    comp?: { thugs: number; snipers: number; drones: number }
  ): void {
    if (!this.announcementElement) return;
    const titleEl = this.announcementElement.querySelector('.announcement-title') as HTMLElement;
    const subEl = this.announcementElement.querySelector('.announcement-subtitle') as HTMLElement;
    if (titleEl) titleEl.textContent = `WAVE ${waveNum}`;
    if (subEl) subEl.textContent = subtitle;

    if (this.announcementCompElement) {
      if (comp) {
        const chips: string[] = [];
        if (comp.thugs > 0) chips.push(`<span class="comp-chip"><span class="chip-shape shape-thug"></span>${comp.thugs} THUG</span>`);
        if (comp.drones > 0) chips.push(`<span class="comp-chip"><span class="chip-shape shape-drone"></span>${comp.drones} DRONE</span>`);
        if (comp.snipers > 0) chips.push(`<span class="comp-chip"><span class="chip-shape shape-sniper"></span>${comp.snipers} SNIPER</span>`);
        this.announcementCompElement.innerHTML = chips.join('<span class="comp-sep">·</span>');
        this.announcementCompElement.style.display = chips.length > 0 ? 'flex' : 'none';
      } else {
        this.announcementCompElement.innerHTML = '';
        this.announcementCompElement.style.display = 'none';
      }
    }

    this.announcementElement.classList.add('visible');
    this.announcementTimer = 2.8;
  }

  private deathEl: HTMLElement | null = null;

  public showDeathScreen(score: number, info?: string | null): void {
    if (!this.deathEl) {
      this.deathEl = document.createElement('div');
      this.deathEl.id = 'death-screen';
      this.deathEl.innerHTML = `<div class="death-title">SKETCHED OUT</div><div class="death-killer"></div><div class="death-score">SCORE 0</div><div class="death-hint">Click or press ENTER / R to redraw · restart</div>`;
      document.body.appendChild(this.deathEl);
    }
    const s = this.deathEl.querySelector('.death-score') as HTMLElement;
    if (s) s.textContent = `SCORE ${Math.round(score).toLocaleString()}`;
    const k = this.deathEl.querySelector('.death-killer') as HTMLElement;
    if (k) {
      k.textContent = info ? `killed by ${info}` : '';
      (k as HTMLElement).style.display = info ? 'block' : 'none';
    }
    this.deathEl.style.display = 'flex';
  }

  public hideDeathScreen(): void {
    if (this.deathEl) this.deathEl.style.display = 'none';
    this.scorePopups.length = 0;
    this.lastPreviewText = '';
    this.showHint('');
    if (this.wavePreviewEl) this.wavePreviewEl.textContent = '';
  }

  /** Latest damage source in world XZ, for the directional indicator. */
  public noteDamageFrom(worldPos: THREE.Vector3): void {
    this.lastDmgX = worldPos.x;
    this.lastDmgZ = worldPos.z;
    this.lastDmgAt = performance.now() * 0.001;
  }

  /** Next-wave composition row under the wave counter. */
  public showWavePreview(c: { thugs: number; snipers: number; drones: number }): void {
    const parts: string[] = [];
    if (c.thugs > 0) parts.push(`${c.thugs} THUG`);
    if (c.drones > 0) parts.push(`${c.drones} DRONE`);
    if (c.snipers > 0) parts.push(`${c.snipers} SNIPER`);
    const text = parts.length > 0 ? `NEXT · ${parts.join(' · ')}` : '';
    if (text !== this.lastPreviewText) {
      this.lastPreviewText = text;
      if (this.wavePreviewEl) this.wavePreviewEl.textContent = text;
    }
  }

  public setMinimapVisible(v: boolean): void {
    if (this.minimap) this.minimap.setVisible(v);
  }

  public get minimapVisible(): boolean {
    return this.minimap ? this.minimap.isVisible : false;
  }

  public update(
    dt: number,
    player: Player,
    score: number,
    currentWave: number,
    enemiesLeft: number,
    webTarget: WebTargetInfo | null,
    extras?: HudExtras
  ): void {
    // 1. Score (cached)
    const scoreText = Math.round(score).toLocaleString();
    if (scoreText !== this.lastScoreText) {
      this.scoreElement.textContent = scoreText;
      this.lastScoreText = scoreText;
    }

    // 2. Wave & Enemies
    const waveText = `WAVE ${currentWave}`;
    if (waveText !== this.lastWaveText) {
      this.waveElement.textContent = waveText;
      this.lastWaveText = waveText;
    }
    const leftText = player.isDead ? 'SKETCHED OUT — press R' : `${enemiesLeft} enemies left`;
    if (this.enemiesLeftElement.textContent !== leftText) {
      this.enemiesLeftElement.textContent = leftText;
    }

    // 3. Health bar (crosshatched bar width) + heal flash
    const hp = Math.max(0, player.health);
    if (hp > this.lastHp) {
      this.healFlashTimer = 0.4;
    }
    this.lastHp = hp;

    if (this.healFlashTimer > 0) {
      this.healFlashTimer -= dt;
      this.hpBarCrosshatch.classList.add('hp-heal-flash');
    } else {
      this.hpBarCrosshatch.classList.remove('hp-heal-flash');
    }

    this.hpNumberElement.textContent = Math.ceil(hp).toString();
    this.hpBarCrosshatch.style.width = `${hp}%`;
    this.hpBarCrosshatch.classList.toggle('hp-low', hp < 30);
    this.hpNumberElement.classList.toggle('hp-critical', hp < 30);

    // 4. Weapon & Ammo
    const wepMgr = player.weaponManager;
    const activeWep = wepMgr.activeWeapon;
    const isSwinging = player.isSwinging;

    if (activeWep.type === 'sword') {
      this.reloadBarBox.style.display = 'none';
      if (this.lastAmmoText !== 'SWORD_AMMO') {
        this.ammoElement.innerHTML = `∞<span class="ammo-sub"> MELEE</span>`;
        this.lastAmmoText = 'SWORD_AMMO';
      }
      this.ammoBarFill.style.width = '100%';
      this.ammoElement.classList.remove('ammo-low');
      this.ammoBarFill.classList.remove('ammo-low-fill');
    } else if (activeWep.isReloading) {
      this.ammoElement.textContent = `RELOADING...`;
      this.reloadBarBox.style.display = 'block';
      const reloadPct = Math.min(100, Math.max(0, (activeWep.reloadProgress / Math.max(0.01, activeWep.reloadTime)) * 100));
      this.reloadBarFill.style.width = `${reloadPct.toFixed(1)}%`;
      this.lastAmmoText = 'R';
    } else {
      this.reloadBarBox.style.display = 'none';
      const ammoKey = `${activeWep.currentAmmo}/${activeWep.reserveAmmo}`;
      if (ammoKey !== this.lastAmmoText) {
        this.ammoElement.innerHTML = `${activeWep.currentAmmo}<span class="ammo-sub">/${activeWep.reserveAmmo}</span>`;
        this.lastAmmoText = ammoKey;
      }
      const magFrac = activeWep.magazineSize > 0 ? activeWep.currentAmmo / activeWep.magazineSize : 0;
      this.ammoBarFill.style.width = `${Math.round(Math.max(0, Math.min(1, magFrac)) * 100)}%`;
      const lowAmmo = activeWep.currentAmmo <= Math.ceil(activeWep.magazineSize * 0.25);
      this.ammoElement.classList.toggle('ammo-low', lowAmmo);
      this.ammoBarFill.classList.toggle('ammo-low-fill', lowAmmo);
    }

    this.activeWeaponNameElement.textContent = activeWep.name;
    this.activeWeaponDescElement.textContent = activeWep.flavorText;

    // Swing Status Badge
    if (isSwinging) {
      if (activeWep.usableWhileSwinging) {
        this.swingStatusElement.textContent = 'SWING-READY · CAN SLICE / FIRE';
        this.swingStatusElement.className = 'swing-status-badge swing-ready';
      } else {
        this.swingStatusElement.textContent = 'LOCKED WHILE SWINGING (USE SWORD [1] OR PISTOL [2])';
        this.swingStatusElement.className = 'swing-status-badge swing-locked';
      }
    } else {
      this.swingStatusElement.textContent = activeWep.usableWhileSwinging ? 'GROUND / AERIAL READY' : 'HEAVY · LOCKS WHILE SWINGING';
      this.swingStatusElement.className = 'swing-status-badge';
    }

    // Update weapon drawer list active highlight
    const rows = this.weaponListElement.querySelectorAll('.wep-row');
    rows.forEach((row, idx) => {
      const wep = wepMgr.weapons[idx];
      if (wep) {
        const ammoSpan = row.querySelector('.wep-ammo');
        if (ammoSpan) {
          ammoSpan.textContent = wep.type === 'sword' ? '∞' : `${wep.currentAmmo}/${wep.reserveAmmo}`;
        }
      }
      if (idx === wepMgr.activeIndex) {
        row.classList.add('wep-active');
      } else {
        row.classList.remove('wep-active');
      }
    });

    // 5. Web Target Reticle (offset below crosshair; dot turns green on lock)
    const hasWebTarget = !!(webTarget && webTarget.isValid);
    if (hasWebTarget) {
      this.webReticleElement.classList.add('active');
      const distEl = this.webReticleElement.querySelector('.reticle-dist') as HTMLElement;
      if (distEl) distEl.textContent = `${Math.round((webTarget as WebTargetInfo).distance)}m`;
    } else {
      this.webReticleElement.classList.remove('active');
    }
    this.centerCrosshairElement.classList.toggle('web-lock', hasWebTarget);

    // 6. Sniper Scope & Dynamic Crosshair Spread Ring
    const isSniperScoped = activeWep.type === 'sniper' && (activeWep as Sniper).isScoped;
    const isAiming = player.input.isZoomHolding() && !player.isSwinging;

    if (isSniperScoped) {
      this.scopeOverlayElement.classList.add('active');
      this.centerCrosshairElement.style.opacity = '0';
      this.spreadRingElement.style.opacity = '0';
    } else {
      this.scopeOverlayElement.classList.remove('active');
      this.centerCrosshairElement.style.opacity = '1';
      this.spreadRingElement.style.opacity = '1';

      const isMoving = player.input.isMovingForward() || player.input.isMovingBackward() || player.input.isMovingLeft() || player.input.isMovingRight();
      const spreadRad = activeWep.spreadFor(isMoving, isAiming, isSwinging);
      const focalConstant = 550;
      const spreadRadius = Math.max(6, Math.round(spreadRad * focalConstant));

      this.spreadRingElement.style.width = `${spreadRadius * 2}px`;
      this.spreadRingElement.style.height = `${spreadRadius * 2}px`;

      // Expand crosshair ticks with live spread value
      const tickOffset = spreadRadius + 2;
      this.chTickTop.style.top = `calc(50% - ${tickOffset + 6}px)`;
      this.chTickBottom.style.bottom = `calc(50% - ${tickOffset + 6}px)`;
      this.chTickLeft.style.left = `calc(50% - ${tickOffset + 6}px)`;
      this.chTickRight.style.right = `calc(50% - ${tickOffset + 6}px)`;
    }

    // 7. Speed lines based on velocity (hidden while ADS / scoped)
    const speed = player.velocity.length();
    if (!isAiming && !isSniperScoped && speed > 20) {
      const speedAlpha = Math.min((speed - 20) / 22.0, 0.85);
      this.speedLinesElement.style.opacity = speedAlpha.toString();
    } else {
      this.speedLinesElement.style.opacity = '0';
    }

    // 8. Damage Vignette
    if (player.invulnerabilityTimer > 0) {
      this.damageVignetteElement.style.opacity = (player.invulnerabilityTimer / 0.4).toString();
    } else {
      this.damageVignetteElement.style.opacity = '0';
    }

    // 9. Hitmarker decay
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer -= dt;
      if (this.hitmarkerTimer <= 0) {
        this.hitmarkerElement.classList.remove('show', 'headshot', 'kill');
      }
    }

    // 10. Wave Announcement timer
    if (this.announcementTimer > 0) {
      this.announcementTimer -= dt;
      if (this.announcementTimer <= 0) {
        this.announcementElement.classList.remove('visible');
      }
    }

    // 11. Minimap + directional damage
    this.updateMinimap(player, extras);
    this.updateDamageDirection(player);

    // 12. Score Popups Animation
    this.updateScorePopups(dt);
  }

  private updateMinimap(player: Player, extras?: HudExtras): void {
    if (!this.minimap || !extras) return;
    if (extras.buildings !== this.minimapBuildingsRef) {
      this.minimapBuildingsRef = extras.buildings;
      this.minimap.setBuildings(extras.buildings);
    }
    this.minimap.draw(extras.px, extras.pz, extras.yaw, extras.enemies);
  }

  private updateDamageDirection(player: Player): void {
    const age = performance.now() * 0.001 - this.lastDmgAt;
    const fade = age < 1.2 ? 1 - age / 1.2 : 0;
    const hp = Math.max(0, player.health);
    const lowHpPulse = (hp < 30 && !player.isDead)
      ? (Math.sin(performance.now() * 0.0035) * 0.5 + 0.5) * 0.32
      : 0;

    if (fade <= 0 || !this.dmgArcG) {
      if (this.dmgArcG) this.dmgArcG.setAttribute('opacity', '0');
      this.setEdgeOpacities(lowHpPulse, lowHpPulse, lowHpPulse, lowHpPulse);
      return;
    }
    const dx = this.lastDmgX - player.position.x;
    const dz = this.lastDmgZ - player.position.z;
    if (dx * dx + dz * dz < 0.25) {
      this.dmgArcG.setAttribute('opacity', '0');
      this.setEdgeOpacities(lowHpPulse, lowHpPulse, lowHpPulse, lowHpPulse);
      return;
    }
    const len = Math.hypot(dx, dz);
    const nx = dx / len;
    const nz = dz / len;
    // Camera basis on XZ: forward (-sin yaw, -cos yaw), right (-fz, fx)
    const yaw = player.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    const rel = Math.atan2(nx * rx + nz * rz, nx * fx + nz * fz);
    const deg = (rel * 180) / Math.PI;
    this.dmgArcG.setAttribute('transform', `rotate(${deg.toFixed(1)} 50 50)`);
    this.dmgArcG.setAttribute('opacity', (fade * 0.95).toFixed(2));
    const c = Math.cos(rel) * fade;
    const s = Math.sin(rel) * fade;

    // Directional indicator wins while fresh; low-HP pulse blends in as directional hit fades
    const dirWeight = Math.min(1, fade * 1.5);
    const pulseBlend = lowHpPulse * (1 - dirWeight);

    this.setEdgeOpacities(
      Math.max(0, c) + pulseBlend,
      Math.max(0, -c) + pulseBlend,
      Math.max(0, -s) + pulseBlend,
      Math.max(0, s) + pulseBlend
    );
  }

  private setEdgeOpacities(t: number, b: number, l: number, r: number): void {
    if (this.dmgEdgeT) this.dmgEdgeT.style.opacity = (t * 0.85).toFixed(2);
    if (this.dmgEdgeB) this.dmgEdgeB.style.opacity = (b * 0.85).toFixed(2);
    if (this.dmgEdgeL) this.dmgEdgeL.style.opacity = (l * 0.85).toFixed(2);
    if (this.dmgEdgeR) this.dmgEdgeR.style.opacity = (r * 0.85).toFixed(2);
  }

  private updateScorePopups(dt: number): void {
    // Clear old elements
    this.popupContainerElement.innerHTML = '';

    for (let i = this.scorePopups.length - 1; i >= 0; i--) {
      const p = this.scorePopups[i];
      p.timer += dt;
      if (p.timer >= p.maxTimer) {
        this.scorePopups.splice(i, 1);
        continue;
      }

      const progress = p.timer / p.maxTimer;
      const yShift = progress * 40;
      const opacity = Math.sin(progress * Math.PI);

      const div = document.createElement('div');
      div.className = 'score-popup-item';
      div.style.transform = `translateY(-${yShift}px)`;
      div.style.opacity = opacity.toString();
      div.style.color = p.color;
      div.innerHTML = `${p.text} <span class="popup-pts">+${p.points}</span>`;
      this.popupContainerElement.appendChild(div);
    }
  }

  /**
   * Failed web feedback: trigger shake animation on the reticle (plan 7.1)
   */
  public triggerDryWebShake(): void {
    const el = this.centerCrosshairElement;
    if (!el) return;
    el.classList.remove('reticle-shake');
    // Force reflow to re-trigger CSS keyframes
    void el.offsetWidth;
    el.classList.add('reticle-shake');
    setTimeout(() => {
      el.classList.remove('reticle-shake');
    }, 220);
  }

  /**
   * Debug toggles overlay status update (plan 33)
   */
  public updateDebugOverlay(statusText: string | null): void {
    if (!this.debugOverlayEl) return;
    if (!statusText) {
      this.debugOverlayEl.style.display = 'none';
      return;
    }
    this.debugOverlayEl.style.display = 'block';
    this.debugOverlayEl.textContent = statusText;
  }
}
