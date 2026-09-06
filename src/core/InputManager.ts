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

  constructor(domElement: HTMLElement = document.body) {
    this.domElement = domElement;
    this.setupListeners();
  }

  private setupListeners(): void {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
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

  public exitPointerLock(): void {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    if (!this.keys[key]) {
      // Just pressed checks
      if (key === ' ' || key === 'space') this.jumpJustPressed = true;
      if (key === 'r') this.reloadJustPressed = true;
      if (key === 'f') this.webZipJustPressed = true;
      if (key === 'e') this.webJustPressed = true;
      if (key === 'q') this.zoomJustPressed = true;
      if (key === 'v' || key === 'enter') this.fireJustPressed = true;

      if (key === '1') this.weaponSwitchIndex = 0;
      if (key === '2') this.weaponSwitchIndex = 1;
      if (key === '3') this.weaponSwitchIndex = 2;
    }
    this.keys[key] = true;
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys[e.key.toLowerCase()] = false;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.isLocked) {
      this.requestPointerLock();
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
    this.mouseDelta.x += clampedX * this.mouseSensitivity;
    this.mouseDelta.y += clampedY * this.mouseSensitivity;
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
  public isMovingForward(): boolean { return !!(this.keys['w'] || this.keys['arrowup']); }
  public isMovingBackward(): boolean { return !!(this.keys['s'] || this.keys['arrowdown']); }
  public isMovingLeft(): boolean { return !!(this.keys['a'] || this.keys['arrowleft']); }
  public isMovingRight(): boolean { return !!(this.keys['d'] || this.keys['arrowright']); }
  public isJumping(): boolean { return !!this.keys[' ']; }
  public isReelingIn(): boolean { return !!(this.keys['shift'] || this.keys['c']); }
  public isReelingOut(): boolean { return !!(this.keys['control'] || this.keys['x']); }
  public isFiring(): boolean { return !!(this.mouseButtons[0] || this.keys['v'] || this.keys['enter']); }
  public isWebHolding(): boolean { return !!(this.mouseButtons[2] || this.keys['e']); }
  public isZoomHolding(): boolean { return !!(this.keys['q'] || this.mouseButtons[1]); }
}
