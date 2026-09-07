/**
 * KEYMAP CONSTANTS & CONTROLS BINDINGS (Milestone 2 Finalized):
 * - W / ArrowUp: Walk forward (ground) | Weak air nudge (air) | Tangential pump (swinging).
 * - S / ArrowDown: Walk backward (ground) | Air brake (air, fast horizontal bleed).
 * - A / D / ArrowLeft / ArrowRight: Strafe (ground/air) | Arc steering lean (swinging).
 * - Shift: SPRINT on ground (hold + W) | Web reel-in while swinging.
 *   No sprint in air — air feet don't run.
 * - C: CROUCH to rail height (0.9m) on ground | Web reel-in while swinging.
 *   Behind any railing this is real cover: enemy bullets stop in the rail and
 *   they hold fire, but your own shots hit it too. Stand to shoot. In the open,
 *   crouching blocks nothing and you shoot and get shot normally.
 *   Standing back up needs headroom or you stay down. See core/CoverMetrics.ts.
 * - Ctrl / X: Web reel-out (swinging) | Dive assist (air: pitch assist + speed boost).
 * - Space: Jump. Nothing else — no web actions live on Space.
 * - E / Right-Click: TAP = shoot web & STAY attached (tap again mid-swing to drop
 *   the line and grab a new anchor; no target = dry thwip).
 *   HOLD = winch all the way to the point you just shot, let go to fall.
 * - F: Web zip to target anchor / ledge.
 * - Left-Click / V / Enter: Primary fire active weapon (pistol works while swinging).
 * - Q / Middle-Click: Aim Down Sights (ADS) / Sniper scope toggle.
 * - 1, 2, 3 / Mouse Wheel: Weapon select (Pistol, SMG, Sniper).
 * - R: Reload weapon.
 */
export class InputManager {
  // Key states
  public keys: { [key: string]: boolean } = {};
  public mouseButtons: { [button: number]: boolean } = {};
  public mouseDelta: { x: number; y: number } = { x: 0, y: 0 };
  public mouseWheelDelta: number = 0;

  // Pointer lock state
  public isLocked: boolean = false;
  public onLockChange?: (locked: boolean) => void;
  // Headless / automated-test fallback: play button bypasses pointer lock
  public lockBypass: boolean = false;

  /**
   * Whether a click may GRAB the mouse.
   *
   * False everywhere except an actually-running game, and it has to be: the
   * mousedown listener is on `window`, so without this gate the first click on
   * any menu button — SOLO, a room code, a character card — captured the
   * pointer and the cursor vanished while the menu was still on screen, with
   * nothing left to click it with.
   *
   * `Game` opens this gate when a run starts and closes it on the way back to
   * the menu. Even while open, only clicks landing on the game canvas count,
   * so the pause and death overlays stay clickable mid-run.
   */
  public pointerLockOnClick: boolean = false;
  public get isPlaying(): boolean { return this.isLocked || this.lockBypass; }

  // Single-frame trigger states
  public fireJustPressed: boolean = false;
  public webJustPressed: boolean = false;
  public webZipJustPressed: boolean = false;
  public jumpJustPressed: boolean = false;
  public reloadJustPressed: boolean = false;
  public zoomJustPressed: boolean = false;
  public weaponSwitchIndex: number = -1;

  private domElement: HTMLElement;
  private mouseSensitivity: number = 0.0022;
  // User setting multiplier (0.5 trackpad-calm … 2.0 twitch), persisted
  public sensitivityScale: number = 1.0;

  // ADS sensitivity scaling (0 = hipfire / no scaling, 1 = full ADS scaling)
  public adsScale: number = 0;
  public fovRatio: number = 1.0;

  public setAdsScaling(adsScale: number, fovRatio: number): void {
    this.adsScale = Math.max(0, Math.min(1, adsScale));
    this.fovRatio = Math.max(0.01, Math.min(2.0, fovRatio));
  }

  constructor(domElement?: HTMLElement) {
    this.domElement = domElement ?? (typeof document !== 'undefined' ? document.body : ({} as HTMLElement));
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.setupListeners();
    }
  }

  public clearState(): void {
    this.keys = {};
    this.mouseButtons = {};
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.mouseWheelDelta = 0;
    this.fireJustPressed = false;
    this.webJustPressed = false;
    this.webZipJustPressed = false;
    this.jumpJustPressed = false;
    this.reloadJustPressed = false;
    this.zoomJustPressed = false;
    this.weaponSwitchIndex = -1;
  }

  private setupListeners(): void {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Window focus / visibility safeguards so keys never get stuck on alt-tab or blur
    window.addEventListener('blur', () => this.clearState());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearState();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
      if (!this.isLocked) {
        this.clearState();
      }
      if (this.onLockChange) {
        this.onLockChange(this.isLocked);
      }
    });
  }

  public requestPointerLock(): void {
    try {
      const p = this.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Headless / iframe: allow keyboard-only play so visual tests keep running
          this.lockBypass = true;
          if (this.onLockChange) this.onLockChange(true);
        });
      }
    } catch {
      this.lockBypass = true;
      if (this.onLockChange) this.onLockChange(true);
    }
    // Safety: if lock doesn't engage in 600ms (headless), bypass so game runs
    window.setTimeout(() => {
      if (!this.isLocked && !this.lockBypass && document.pointerLockElement == null) {
        this.lockBypass = true;
        if (this.onLockChange) this.onLockChange(true);
      }
    }, 600);
  }

  /** True when an event landed on the game canvas rather than on UI over it. */
  private isCanvasTarget(target: EventTarget | null): boolean {
    const el = this.domElement as HTMLElement & { contains?: (n: Node) => boolean };
    if (!el || typeof el.contains !== 'function') return false;
    return target instanceof Node && (target === el || el.contains(target));
  }

  public exitPointerLock(): void {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Mac Command/Meta key press or shortcut suppresses keyup events; clear state to prevent stuck keys
    if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') {
      this.clearState();
      return;
    }

    const key = e.key ? e.key.toLowerCase() : '';
    const code = e.code ? e.code.toLowerCase() : '';

    if ((key && !this.keys[key]) || (code && !this.keys[code])) {
      // Just pressed checks
      if (key === ' ' || key === 'space' || code === 'space') this.jumpJustPressed = true;
      if (key === 'r' || code === 'keyr') this.reloadJustPressed = true;
      if (key === 'f' || code === 'keyf') this.webZipJustPressed = true;
      if (key === 'e' || code === 'keye') this.webJustPressed = true;
      if (key === 'q' || code === 'keyq') this.zoomJustPressed = true;
      if (key === 'v' || code === 'keyv' || key === 'enter' || code === 'enter') this.fireJustPressed = true;

      if (key === '1' || code === 'digit1') this.weaponSwitchIndex = 0;
      if (key === '2' || code === 'digit2') this.weaponSwitchIndex = 1;
      if (key === '3' || code === 'digit3') this.weaponSwitchIndex = 2;
      if (key === '4' || code === 'digit4') this.weaponSwitchIndex = 3;
    }
    if (key) this.keys[key] = true;
    if (code) this.keys[code] = true;
    if (!e.shiftKey) {
      this.keys['shift'] = false;
      this.keys['shiftleft'] = false;
      this.keys['shiftright'] = false;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const key = e.key ? e.key.toLowerCase() : '';
    const code = e.code ? e.code.toLowerCase() : '';
    if (key) this.keys[key] = false;
    if (code) this.keys[code] = false;
    if (!e.shiftKey) {
      this.keys['shift'] = false;
      this.keys['shiftleft'] = false;
      this.keys['shiftright'] = false;
    }
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.isLocked) {
      // Click-to-recapture, but only inside a running game and only on the
      // canvas itself — never on a menu, a pause card or a HUD button.
      if (this.pointerLockOnClick && this.isCanvasTarget(e.target)) {
        this.requestPointerLock();
      }
      return;
    }

    this.mouseButtons[e.button] = true;
    if (e.button === 0) {
      this.fireJustPressed = true;
    }
    if (e.button === 2) {
      this.webJustPressed = true;
    }
  }

  private onMouseUp(e: MouseEvent): void {
    this.mouseButtons[e.button] = false;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isLocked) return;
    // Dampen and clamp trackpad flick spikes for silky smooth look
    const clampedX = Math.max(-120, Math.min(120, e.movementX));
    const clampedY = Math.max(-120, Math.min(120, e.movementY));
    // ADS sensitivity scaling formula: sensitivityScale * lerp(1, fovRatio, adsScale)
    const adsFactor = 1.0 + (this.fovRatio - 1.0) * this.adsScale;
    const s = this.mouseSensitivity * this.sensitivityScale * adsFactor;
    this.mouseDelta.x += clampedX * s;
    this.mouseDelta.y += clampedY * s;
  }

  private onWheel(e: WheelEvent): void {
    if (!this.isLocked) return;
    this.mouseWheelDelta += e.deltaY;
  }

  /**
   * Reset single-frame deltas at end of frame
   */
  public endFrame(): void {
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.mouseWheelDelta = 0;
    this.fireJustPressed = false;
    this.webJustPressed = false;
    this.webZipJustPressed = false;
    this.jumpJustPressed = false;
    this.reloadJustPressed = false;
    this.zoomJustPressed = false;
    this.weaponSwitchIndex = -1;
  }

  // Helper getters
  public isMovingForward(): boolean { return !!(this.keys['w'] || this.keys['arrowup'] || this.keys['keyw']); }
  public isMovingBackward(): boolean { return !!(this.keys['s'] || this.keys['arrowdown'] || this.keys['keys']); }
  public isMovingLeft(): boolean { return !!(this.keys['a'] || this.keys['arrowleft'] || this.keys['keya']); }
  public isMovingRight(): boolean { return !!(this.keys['d'] || this.keys['arrowright'] || this.keys['keyd']); }
  public isJumping(): boolean { return !!(this.keys[' '] || this.keys['space']); }
  public isJumpHeld(): boolean { return !!(this.keys[' '] || this.keys['space']); }
  public isWebHeld(): boolean { return !!(this.keys['e'] || this.keys['keye'] || this.mouseButtons[2]); }
  public isSprintHeld(): boolean { return !!(this.keys['shift'] || this.keys['shiftleft'] || this.keys['shiftright']); }
  public isCrouchHeld(): boolean { return !!(this.keys['c'] || this.keys['keyc'] || this.keys['control'] || this.keys['controlleft']); }
  public isReelingIn(): boolean { return !!(this.keys['shift'] || this.keys['shiftleft'] || this.keys['shiftright'] || this.keys['c'] || this.keys['keyc']); }
  public isReelingOut(): boolean { return !!(this.keys['control'] || this.keys['controlleft'] || this.keys['controlright'] || this.keys['x'] || this.keys['keyx']); }
  public isFiring(): boolean { return !!(this.mouseButtons[0] || this.keys['v'] || this.keys['keyv'] || this.keys['enter']); }
  public isZoomHolding(): boolean { return !!(this.keys['q'] || this.keys['keyq'] || this.mouseButtons[1] || this.mouseButtons[2]); }
  public isDiving(): boolean { return !!(this.keys['control'] || this.keys['controlleft'] || this.keys['controlright'] || this.keys['x'] || this.keys['keyx']); }

  /**
   * Gamepad vibration haptic rumble feedback (zero-alloc, fails gracefully).
   */
  public rumble(strong: number = 0.5, weak: number = 0.5, ms: number = 80): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    try {
      const pads = navigator.getGamepads();
      if (!pads) return;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (pad && (pad as any).vibrationActuator) {
          (pad as any).vibrationActuator.playEffect('dual-rumble', {
            duration: ms,
            strongMagnitude: Math.min(1, Math.max(0, strong)),
            weakMagnitude: Math.min(1, Math.max(0, weak)),
          });
        }
      }
    } catch {
      // Ignore if vibration unavailable or unsupported
    }
  }
}
