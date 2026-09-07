import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { CHARACTERS, characterById, type CharacterId } from '../characters/Characters';
import { CharacterRig } from '../characters/CharacterRig';
import { INK_COLORS, colorCssFor, colorHexFor } from '../net/Profile';

/**
 * CHARACTER SELECT — the eight designs, on a turntable, in your own ink.
 *
 * Deliberately shows the real thing: the same `CharacterRig` the match draws,
 * in the same ink shader on the same cream paper, so what you pick is exactly
 * what other players will see coming. A list of names could not do that job —
 * the whole point of the roster is the silhouette.
 *
 * Anybody may pick anything. Two players on the same design is fine and is not
 * blocked anywhere: their ink colours still tell them apart.
 *
 * The renderer only runs while the picker is on screen — `mount()` starts the
 * loop, `unmount()` stops it and drops the GPU resources — because this sits
 * in front of a game that wants the frame budget back.
 */
export class CharacterPicker {
  private root: HTMLElement;
  private listEl: HTMLElement;
  private cardEl: HTMLElement;
  private swatchEl: HTMLElement;
  private stageEl: HTMLElement;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private turntable: THREE.Group | null = null;
  private rig: CharacterRig | null = null;
  private frame = 0;
  private lastTime = 0;
  private spin = 0;
  private mounted = false;

  private characterId: CharacterId;
  private colorIndex: number;

  /** Fired on every pick. The menu persists the profile and tells the room. */
  public onChange: ((characterId: CharacterId, colorIndex: number) => void) | null = null;

  constructor(characterId: CharacterId, colorIndex: number) {
    this.characterId = characterById(characterId).id;
    this.colorIndex = colorIndex;

    this.root = document.createElement('div');
    this.root.className = 'charpick';
    this.root.innerHTML = `
      <div class="charpick-list"></div>
      <div class="charpick-stage">
        <div class="charpick-swatches"></div>
      </div>
      <div class="charpick-card"></div>
    `;
    this.listEl = this.root.querySelector('.charpick-list') as HTMLElement;
    this.stageEl = this.root.querySelector('.charpick-stage') as HTMLElement;
    this.cardEl = this.root.querySelector('.charpick-card') as HTMLElement;
    this.swatchEl = this.root.querySelector('.charpick-swatches') as HTMLElement;

    this.renderList();
    this.renderSwatches();
    this.renderCard();
  }

  public get element(): HTMLElement {
    return this.root;
  }

  public get selectedId(): CharacterId {
    return this.characterId;
  }

  /** Re-reads the profile, for when the colour was changed elsewhere. */
  public sync(characterId: CharacterId, colorIndex: number): void {
    const changedCharacter = characterId !== this.characterId;
    const changedColor = colorIndex !== this.colorIndex;
    if (!changedCharacter && !changedColor) return;
    this.characterId = characterById(characterId).id;
    this.colorIndex = colorIndex;
    this.renderList();
    this.renderSwatches();
    this.renderCard();
    if (this.mounted) this.buildRig();
  }

  // ---- DOM -----------------------------------------------------------------

  private renderList(): void {
    this.listEl.replaceChildren();
    for (const def of CHARACTERS) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'charpick-row' + (def.id === this.characterId ? ' active' : '');
      row.innerHTML = `
        <span class="charpick-row-name"></span>
        <span class="charpick-row-build"></span>
      `;
      (row.querySelector('.charpick-row-name') as HTMLElement).textContent = def.name;
      (row.querySelector('.charpick-row-build') as HTMLElement).textContent = def.vibe.build;
      row.addEventListener('click', () => this.pick(def.id));
      this.listEl.appendChild(row);
    }
  }

  private renderSwatches(): void {
    this.swatchEl.replaceChildren();
    INK_COLORS.forEach((c, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'menu-swatch' + (i === this.colorIndex ? ' active' : '');
      dot.style.background = colorCssFor(i);
      dot.title = c.name;
      dot.setAttribute('aria-label', `Ink colour ${c.name}`);
      dot.addEventListener('click', () => this.pickColor(i));
      this.swatchEl.appendChild(dot);
    });
  }

  private renderCard(): void {
    const def = characterById(this.characterId);
    this.cardEl.style.setProperty('--ink', colorCssFor(this.colorIndex));
    this.cardEl.innerHTML = `
      <div class="charpick-card-slot"></div>
      <h3 class="charpick-card-name"></h3>
      <p class="charpick-card-tagline"></p>
      <p class="charpick-card-bio"></p>
      <dl class="charpick-stats">
        <div><dt>BUILD</dt><dd data-k="build"></dd></div>
        <div><dt>READS AS</dt><dd data-k="read"></dd></div>
        <div><dt>INK</dt><dd data-k="ink"></dd></div>
      </dl>
      <p class="charpick-foot">EVERY DESIGN SHARES ONE HITBOX, ONE EYE LINE AND ONE CROUCH — PICK ON LOOKS ALONE.</p>
    `;
    const slot = CHARACTERS.findIndex((c) => c.id === def.id) + 1;
    const set = (sel: string, text: string) => {
      (this.cardEl.querySelector(sel) as HTMLElement).textContent = text;
    };
    set('.charpick-card-slot', `SHEET ${String(slot).padStart(2, '0')} / 0${CHARACTERS.length}`);
    set('.charpick-card-name', def.name);
    set('.charpick-card-tagline', def.tagline);
    set('.charpick-card-bio', def.bio);
    set('[data-k="build"]', def.vibe.build);
    set('[data-k="read"]', def.vibe.read);
    set('[data-k="ink"]', INK_COLORS[this.colorIndex]?.name ?? '');
  }

  private pick(id: CharacterId): void {
    if (id === this.characterId) return;
    this.characterId = id;
    this.renderList();
    this.renderCard();
    this.buildRig();
    this.onChange?.(this.characterId, this.colorIndex);
  }

  private pickColor(i: number): void {
    if (i === this.colorIndex) return;
    this.colorIndex = i;
    this.renderSwatches();
    this.renderCard();
    this.buildRig();
    this.onChange?.(this.characterId, this.colorIndex);
  }

  // ---- 3D ------------------------------------------------------------------

  /** Starts the preview. Safe to call repeatedly. */
  public mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0xf5eedd, 1);
    renderer.domElement.className = 'charpick-canvas';
    this.stageEl.insertBefore(renderer.domElement, this.stageEl.firstChild);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);

    this.buildRig();
    this.resize();
    this.lastTime = performance.now();
    this.loop();
  }

  /** Stops the preview and frees everything it allocated. */
  public unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;

    this.rig?.dispose();
    this.rig = null;
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.turntable = null;
  }

  private buildRig(): void {
    if (!this.turntable) return;
    if (this.rig) {
      this.turntable.remove(this.rig.group);
      this.rig.dispose();
    }
    // No hit proxies: nothing shoots at a menu.
    this.rig = new CharacterRig(this.characterId, {
      inkOverride: colorHexFor(this.colorIndex),
      hitProxies: false,
    });
    this.turntable.add(this.rig.group);
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const w = Math.max(1, this.stageEl.clientWidth);
    const h = Math.max(1, this.stageEl.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (!this.mounted || !this.renderer || !this.scene || !this.camera || !this.turntable) return;
    this.frame = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    InkShaderMaterial.update(dt);
    this.spin += dt * 0.5;
    this.turntable.rotation.y = this.spin;
    // Idle stand, so flourishes drift but the pose stays readable.
    this.rig?.update(dt, { speed: 0 });

    this.resize();
    this.camera.position.set(0, 1.05, 4.4);
    this.camera.lookAt(0, 0.92, 0);
    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    this.unmount();
    this.root.remove();
  }
}
