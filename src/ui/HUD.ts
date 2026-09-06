import * as THREE from 'three';
import { Player } from '../player/Player';
import { WebTargetInfo } from '../player/WebShooter';
import { Sniper } from '../weapons/Sniper';
import { Minimap, MapBuilding, MapEnemy } from './Minimap';

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
  private tallyMarksElement!: HTMLElement;
  private weaponListElement!: HTMLElement;
  private activeWeaponNameElement!: HTMLElement;
  private activeWeaponDescElement!: HTMLElement;
  private swingStatusElement!: HTMLElement;
  private speedLinesElement!: HTMLElement;
  private damageVignetteElement!: HTMLElement;
  private scopeOverlayElement!: HTMLElement;
  private webReticleElement!: HTMLElement;
  private centerCrosshairElement!: HTMLElement;
  private hitmarkerElement!: HTMLElement;
  private popupContainerElement!: HTMLElement;
  private announcementElement!: HTMLElement;

  private hitmarkerTimer: number = 0;
  private isHeadshotHit: boolean = false;
  private announcementTimer: number = 0;
  private lastAmmoText: string = '';
  private lastScoreText: string = '';
  private lastWaveText: string = '';
  private lastPreviewText: string = '';

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

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'hud-container';
    document.body.appendChild(this.container);
    this.buildDOM();
  }

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
        <div id="hitmarker" class="hitmarker-ink">✕</div>
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
          <div id="ammo-tallies" class="ammo-tallies-text">|||| |||| ||</div>
        </div>
      </div>

      <!-- Bottom Right: Weapons Drawer & Swing Status -->
      <div class="hud-bottom-right">
        <div id="weapon-list" class="weapon-list-box">
          <div class="wep-row wep-active" data-idx="0">[1] PISTOL <span class="wep-ammo">12/60</span></div>
          <div class="wep-row" data-idx="1">[2] SMG <span class="wep-ammo">32/160</span></div>
          <div class="wep-row" data-idx="2">[3] SNIPER <span class="wep-ammo">5/25</span></div>
        </div>
        <div id="active-wep-name" class="active-wep-title">PISTOL</div>
        <div id="active-wep-desc" class="active-wep-desc">tactical ballpoint sidearm · swing & shoot enabled</div>
        <div id="swing-status" class="swing-status-badge">SWING READY</div>
      </div>

      <!-- Wave Announcement / Big Text Banner -->
      <div id="hud-announcement" class="hud-announcement-banner">
        <div class="announcement-title">WAVE 1</div>
        <div class="announcement-subtitle">INK INVASION BEGINS</div>
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
    `;

    // Cache elements safely from this.container
    this.scoreElement = this.container.querySelector('#hud-score')!;
    this.waveElement = this.container.querySelector('#hud-wave')!;
    this.enemiesLeftElement = this.container.querySelector('#hud-enemies-left')!;
    this.hpNumberElement = this.container.querySelector('#hp-number')!;
    this.hpBarCrosshatch = this.container.querySelector('#hp-bar-hatch')!;
    this.ammoElement = this.container.querySelector('#ammo-numbers')!;
    this.tallyMarksElement = this.container.querySelector('#ammo-tallies')!;
    this.weaponListElement = this.container.querySelector('#weapon-list')!;
    this.activeWeaponNameElement = this.container.querySelector('#active-wep-name')!;
    this.activeWeaponDescElement = this.container.querySelector('#active-wep-desc')!;
    this.swingStatusElement = this.container.querySelector('#swing-status')!;
    this.speedLinesElement = this.container.querySelector('#speed-lines')!;
    this.damageVignetteElement = this.container.querySelector('#damage-vignette')!;
    this.scopeOverlayElement = this.container.querySelector('#scope-overlay')!;
    this.webReticleElement = this.container.querySelector('#web-reticle')!;
    this.centerCrosshairElement = this.container.querySelector('#center-crosshair')!;
    this.hitmarkerElement = this.container.querySelector('#hitmarker')!;
    this.popupContainerElement = this.container.querySelector('#popup-container')!;
    this.announcementElement = this.container.querySelector('#hud-announcement')!;
    this.wavePreviewEl = this.container.querySelector('#wave-preview');
    this.dmgArcG = this.container.querySelector('#dmg-arc-g') as unknown as SVGGElement;
    this.dmgEdgeT = this.container.querySelector('#dmg-edge-t');
    this.dmgEdgeB = this.container.querySelector('#dmg-edge-b');
    this.dmgEdgeL = this.container.querySelector('#dmg-edge-l');
    this.dmgEdgeR = this.container.querySelector('#dmg-edge-r');
    const mapCanvas = this.container.querySelector('#minimap') as HTMLCanvasElement | null;
    if (mapCanvas) this.minimap = new Minimap(mapCanvas);
  }

  public showScorePopup(text: string, points: number, color: string = '#152778'): void {
    this.scorePopups.push({
      text,
      points,
      timer: 0,
      maxTimer: 1.6,
      yOffset: 0,
      color
    });
  }

  public triggerHitmarker(isHeadshot: boolean = false): void {
    this.hitmarkerTimer = 0.18;
    this.isHeadshotHit = isHeadshot;
    if (this.hitmarkerElement) {
      this.hitmarkerElement.textContent = isHeadshot ? '!' : '✕';
      this.hitmarkerElement.style.color = isHeadshot ? '#d63031' : '#152778';
      this.hitmarkerElement.style.transform = isHeadshot ? 'scale(1.8)' : 'scale(1.3)';
      this.hitmarkerElement.style.opacity = '1';
    }
  }

  public showWaveAnnouncement(waveNum: number, subtitle: string = 'ELIMINATE ALL INK HOSTILES'): void {
    if (!this.announcementElement) return;
    const titleEl = this.announcementElement.querySelector('.announcement-title') as HTMLElement;
    const subEl = this.announcementElement.querySelector('.announcement-subtitle') as HTMLElement;
    if (titleEl) titleEl.textContent = `WAVE ${waveNum}`;
    if (subEl) subEl.textContent = subtitle;

    this.announcementElement.classList.add('visible');
    this.announcementTimer = 2.8;
  }

  private deathEl: HTMLElement | null = null;

  public showDeathScreen(score: number, info?: string | null): void {
    if (!this.deathEl) {
      this.deathEl = document.createElement('div');
      this.deathEl.id = 'death-screen';
      this.deathEl.innerHTML = `<div class="death-title">SKETCHED OUT</div><div class="death-killer"></div><div class="death-score">SCORE 0</div><div class="death-hint">Click or press R to redraw · restart</div>`;
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

    // 3. Health bar (crosshatched bar width)
    const hp = Math.max(0, player.health);
    this.hpNumberElement.textContent = Math.ceil(hp).toString();
    this.hpBarCrosshatch.style.width = `${hp}%`;
    if (hp < 30) {
      this.hpNumberElement.style.color = '#d63031';
    } else {
      this.hpNumberElement.style.color = '#152778';
    }

    // 4. Weapon & Ammo
    const wepMgr = player.weaponManager;
    const activeWep = wepMgr.activeWeapon;
    const isSwinging = player.isSwinging;

    if (activeWep.isReloading) {
      if (this.lastAmmoText !== 'R') {
        this.ammoElement.textContent = `RELOADING...`;
        this.tallyMarksElement.textContent = ``;
        this.lastAmmoText = 'R';
      }
    } else {
      const ammoKey = `${activeWep.currentAmmo}/${activeWep.reserveAmmo}`;
      if (ammoKey !== this.lastAmmoText) {
        this.ammoElement.innerHTML = `${activeWep.currentAmmo}<span class="ammo-sub">/${activeWep.reserveAmmo}</span>`;
        // Sketched tally marks (groups of 4 with a slash, or |||| ||||)
        this.tallyMarksElement.textContent = this.generateTallyMarks(activeWep.currentAmmo);
        this.lastAmmoText = ammoKey;
      }
      if (activeWep.currentAmmo <= Math.ceil(activeWep.magazineSize * 0.25)) {
        this.ammoElement.style.color = '#d63031';
      } else {
        this.ammoElement.style.color = '';
      }
    }

    this.activeWeaponNameElement.textContent = activeWep.name;
    this.activeWeaponDescElement.textContent = activeWep.flavorText;

    // Swing Status Badge
    if (isSwinging) {
      if (activeWep.usableWhileSwinging) {
        this.swingStatusElement.textContent = 'SWING-READY · CAN FIRE';
        this.swingStatusElement.className = 'swing-status-badge swing-ready';
      } else {
        this.swingStatusElement.textContent = 'LOCKED WHILE SWINGING (USE PISTOL [1])';
        this.swingStatusElement.className = 'swing-status-badge swing-locked';
      }
    } else {
      this.swingStatusElement.textContent = activeWep.usableWhileSwinging ? 'GROUND / AERIAL READY' : 'TWO-HANDED WEAPON';
      this.swingStatusElement.className = 'swing-status-badge';
    }

    // Update weapon drawer list active highlight
    const rows = this.weaponListElement.querySelectorAll('.wep-row');
    rows.forEach((row, idx) => {
      const wep = wepMgr.weapons[idx];
      if (wep) {
        const ammoSpan = row.querySelector('.wep-ammo');
        if (ammoSpan) ammoSpan.textContent = `${wep.currentAmmo}/${wep.reserveAmmo}`;
      }
      if (idx === wepMgr.activeIndex) {
        row.classList.add('wep-active');
      } else {
        row.classList.remove('wep-active');
      }
    });

    // 5. Web Target Reticle
    if (webTarget && webTarget.isValid) {
      this.webReticleElement.classList.add('active');
      const distEl = this.webReticleElement.querySelector('.reticle-dist') as HTMLElement;
      if (distEl) distEl.textContent = `${Math.round(webTarget.distance)}m`;
    } else {
      this.webReticleElement.classList.remove('active');
    }

    // 6. Sniper Scope
    const isSniperScoped = activeWep.type === 'sniper' && (activeWep as Sniper).isScoped;
    if (isSniperScoped) {
      this.scopeOverlayElement.classList.add('active');
      this.centerCrosshairElement.style.opacity = '0';
    } else {
      this.scopeOverlayElement.classList.remove('active');
      this.centerCrosshairElement.style.opacity = '1';
    }

    // 7. Speed lines based on velocity
    const speed = player.velocity.length();
    if (speed > 20) {
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
        this.hitmarkerElement.style.opacity = '0';
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
    if (fade <= 0 || !this.dmgArcG) {
      if (this.dmgArcG) this.dmgArcG.setAttribute('opacity', '0');
      this.setEdgeOpacities(0, 0, 0, 0);
      return;
    }
    const dx = this.lastDmgX - player.position.x;
    const dz = this.lastDmgZ - player.position.z;
    if (dx * dx + dz * dz < 0.25) {
      this.dmgArcG.setAttribute('opacity', '0');
      this.setEdgeOpacities(0, 0, 0, 0);
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
    this.setEdgeOpacities(Math.max(0, c), Math.max(0, -c), Math.max(0, -s), Math.max(0, s));
  }

  private setEdgeOpacities(t: number, b: number, l: number, r: number): void {
    if (this.dmgEdgeT) this.dmgEdgeT.style.opacity = (t * 0.85).toFixed(2);
    if (this.dmgEdgeB) this.dmgEdgeB.style.opacity = (b * 0.85).toFixed(2);
    if (this.dmgEdgeL) this.dmgEdgeL.style.opacity = (l * 0.85).toFixed(2);
    if (this.dmgEdgeR) this.dmgEdgeR.style.opacity = (r * 0.85).toFixed(2);
  }

  private generateTallyMarks(ammo: number): string {
    const clamped = Math.min(ammo, 32);
    let result = '';
    const fives = Math.floor(clamped / 5);
    const rem = clamped % 5;
    for (let i = 0; i < fives; i++) {
      result += '|||| ';
    }
    for (let i = 0; i < rem; i++) {
      result += '|';
    }
    return result;
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
}
